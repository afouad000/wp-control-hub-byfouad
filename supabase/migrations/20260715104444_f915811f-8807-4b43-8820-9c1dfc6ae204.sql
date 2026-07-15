
-- ============================================================================
-- Phase 1 completion: security hardening
-- pgcrypto lives in `extensions` schema on Supabase; qualify digest() calls.
-- ============================================================================

-- 1) provisioning_state ------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'website_provisioning_state') THEN
    CREATE TYPE public.website_provisioning_state AS ENUM ('pending', 'probing', 'provisioned', 'failed');
  END IF;
END $$;

ALTER TABLE public.websites
  ADD COLUMN IF NOT EXISTS provisioning_state public.website_provisioning_state
    NOT NULL DEFAULT 'provisioned';

-- 2) rate_limit_events -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rate_limit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rate_limit_events_user_key_time_idx
  ON public.rate_limit_events (user_id, key, created_at DESC);

GRANT SELECT, INSERT, DELETE ON public.rate_limit_events TO authenticated;
GRANT ALL ON public.rate_limit_events TO service_role;
ALTER TABLE public.rate_limit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own rate limit rows" ON public.rate_limit_events;
CREATE POLICY "own rate limit rows"
  ON public.rate_limit_events
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 3) idempotency_keys --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.idempotency_keys (
  user_id uuid NOT NULL,
  key text NOT NULL,
  response jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  PRIMARY KEY (user_id, key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.idempotency_keys TO authenticated;
GRANT ALL ON public.idempotency_keys TO service_role;
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own idempotency rows" ON public.idempotency_keys;
CREATE POLICY "own idempotency rows"
  ON public.idempotency_keys
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 4) Invitation token hashing ------------------------------------------------
ALTER TABLE public.website_invitations
  ADD COLUMN IF NOT EXISTS token_hash text;

UPDATE public.website_invitations
   SET token_hash = encode(extensions.digest(token, 'sha256'), 'hex')
 WHERE token_hash IS NULL
   AND token IS NOT NULL;

ALTER TABLE public.website_invitations
  ALTER COLUMN token DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS website_invitations_token_hash_key
  ON public.website_invitations (token_hash);

CREATE UNIQUE INDEX IF NOT EXISTS website_invitations_one_pending_per_email
  ON public.website_invitations (website_id, lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE OR REPLACE FUNCTION public.get_invitation_by_token(_token text)
RETURNS TABLE(
  website_id uuid,
  website_name text,
  email text,
  role text,
  invited_by_email text,
  expires_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
  WITH hash_input AS (
    SELECT encode(extensions.digest(_token, 'sha256'), 'hex') AS h
  ),
  inv AS (
    SELECT i.*
    FROM public.website_invitations i, hash_input
    WHERE i.token_hash = hash_input.h
       OR (i.token_hash IS NULL AND i.token = _token)
    LIMIT 1
  )
  SELECT
    inv.website_id,
    w.name AS website_name,
    CASE
      WHEN position('@' in inv.email) > 1 THEN
        substr(inv.email, 1, 1) || '***' || substr(inv.email, position('@' in inv.email))
      ELSE '***'
    END AS email,
    inv.role,
    CASE
      WHEN p.email IS NULL THEN NULL
      WHEN position('@' in p.email) > 1 THEN
        substr(p.email, 1, 1) || '***' || substr(p.email, position('@' in p.email))
      ELSE NULL
    END AS invited_by_email,
    inv.expires_at,
    inv.accepted_at,
    inv.revoked_at
  FROM inv
  JOIN public.websites w ON w.id = inv.website_id
  LEFT JOIN public.profiles p ON p.id = inv.invited_by;
$function$;

CREATE OR REPLACE FUNCTION public.accept_invitation(_token text)
RETURNS TABLE(ok boolean, website_id uuid, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  inv public.website_invitations%ROWTYPE;
  caller_email text;
  role_perms jsonb;
  h text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid, 'You must be signed in to accept.'::text; RETURN;
  END IF;

  h := encode(extensions.digest(_token, 'sha256'), 'hex');
  SELECT * INTO inv FROM public.website_invitations
   WHERE token_hash = h OR (token_hash IS NULL AND token = _token)
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, 'Invitation not found.'::text; RETURN;
  END IF;
  IF inv.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT false, inv.website_id, 'Invitation was revoked.'::text; RETURN;
  END IF;
  IF inv.accepted_at IS NOT NULL THEN
    RETURN QUERY SELECT false, inv.website_id, 'Invitation was already accepted.'::text; RETURN;
  END IF;
  IF inv.expires_at < now() THEN
    RETURN QUERY SELECT false, inv.website_id, 'Invitation has expired.'::text; RETURN;
  END IF;

  SELECT lower(email) INTO caller_email FROM auth.users WHERE id = auth.uid();
  IF caller_email IS NULL OR caller_email <> lower(inv.email) THEN
    RETURN QUERY SELECT false, inv.website_id,
      ('This invitation was sent to a different email. Sign in with ' || inv.email)::text;
    RETURN;
  END IF;

  UPDATE public.website_invitations
     SET accepted_at = now(), accepted_by = auth.uid()
   WHERE id = inv.id AND accepted_at IS NULL AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, inv.website_id, 'Invitation is no longer valid.'::text; RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.website_members
                  WHERE website_id = inv.website_id AND user_id = auth.uid()) THEN
    role_perms := COALESCE(NULLIF(inv.permissions, '{}'::jsonb), '{}'::jsonb);
    INSERT INTO public.website_members (
      website_id, user_id, permission, role, permissions,
      invitation_status, accepted_at
    ) VALUES (
      inv.website_id, auth.uid(),
      CASE inv.role WHEN 'viewer' THEN 'view' ELSE 'edit' END,
      inv.role, role_perms,
      'accepted', now()
    );
  END IF;

  INSERT INTO public.audit_logs (user_id, website_id, action, entity_type, entity_id, new_value)
  VALUES (auth.uid(), inv.website_id, 'website.invitation_accepted', 'invitation', inv.id::text,
          jsonb_build_object('role', inv.role));

  RETURN QUERY SELECT true, inv.website_id, 'Joined.'::text;
END; $function$;
