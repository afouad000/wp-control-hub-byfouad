-- Team invitations for per-website membership.
-- Owners / managers create a signed link; invitee accepts after signing in.

CREATE TABLE public.website_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id uuid NOT NULL REFERENCES public.websites(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'viewer',
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  revoked_at timestamptz,
  accepted_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT website_invitations_role_check CHECK (role IN ('admin','editor','viewer'))
);

CREATE INDEX website_invitations_website_id_idx ON public.website_invitations(website_id);
CREATE INDEX website_invitations_email_idx ON public.website_invitations(lower(email));

-- Enforce email normalization
CREATE OR REPLACE FUNCTION public.website_invitations_normalize()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.email := lower(trim(NEW.email));
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

CREATE TRIGGER website_invitations_normalize_biu
  BEFORE INSERT OR UPDATE ON public.website_invitations
  FOR EACH ROW EXECUTE FUNCTION public.website_invitations_normalize();

-- Grants: only authenticated. Accept flow uses SECURITY DEFINER.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.website_invitations TO authenticated;
GRANT ALL ON public.website_invitations TO service_role;

ALTER TABLE public.website_invitations ENABLE ROW LEVEL SECURITY;

-- Managers of the website can see and manage its invitations.
CREATE POLICY "Managers select invitations"
  ON public.website_invitations FOR SELECT TO authenticated
  USING (public.user_can_website(website_id, 'manage_team'));

CREATE POLICY "Managers insert invitations"
  ON public.website_invitations FOR INSERT TO authenticated
  WITH CHECK (
    public.user_can_website(website_id, 'manage_team')
    AND invited_by = auth.uid()
  );

CREATE POLICY "Managers update invitations"
  ON public.website_invitations FOR UPDATE TO authenticated
  USING (public.user_can_website(website_id, 'manage_team'))
  WITH CHECK (public.user_can_website(website_id, 'manage_team'));

CREATE POLICY "Managers delete invitations"
  ON public.website_invitations FOR DELETE TO authenticated
  USING (public.user_can_website(website_id, 'manage_team'));

-- Public-ish accessor: fetch invitation summary by token (no credentials).
-- Returns website name + inviter email, or empty rowset if invalid.
CREATE OR REPLACE FUNCTION public.get_invitation_by_token(_token text)
RETURNS TABLE (
  website_id uuid,
  website_name text,
  email text,
  role text,
  invited_by_email text,
  expires_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    i.website_id,
    w.name AS website_name,
    i.email,
    i.role,
    p.email AS invited_by_email,
    i.expires_at,
    i.accepted_at,
    i.revoked_at
  FROM public.website_invitations i
  JOIN public.websites w ON w.id = i.website_id
  LEFT JOIN public.profiles p ON p.id = i.invited_by
  WHERE i.token = _token
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_invitation_by_token(text) TO authenticated, anon;

-- Accept flow: requires an authenticated caller whose email matches the invite.
-- Inserts a website_members row and marks the invitation accepted.
CREATE OR REPLACE FUNCTION public.accept_invitation(_token text)
RETURNS TABLE (ok boolean, website_id uuid, message text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv public.website_invitations%ROWTYPE;
  caller_email text;
  role_perms jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid, 'You must be signed in to accept.'::text; RETURN;
  END IF;

  SELECT * INTO inv FROM public.website_invitations WHERE token = _token;
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
      'This invitation was sent to a different email. Sign in with ' || inv.email || '.'::text;
    RETURN;
  END IF;

  -- If they're already a member, just mark accepted.
  IF EXISTS (SELECT 1 FROM public.website_members
             WHERE website_id = inv.website_id AND user_id = auth.uid()) THEN
    UPDATE public.website_invitations
       SET accepted_at = now(), accepted_by = auth.uid()
     WHERE id = inv.id;
    RETURN QUERY SELECT true, inv.website_id, 'Already a member.'::text; RETURN;
  END IF;

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

  UPDATE public.website_invitations
     SET accepted_at = now(), accepted_by = auth.uid()
   WHERE id = inv.id;

  INSERT INTO public.audit_logs (user_id, website_id, action, entity_type, entity_id, new_value)
  VALUES (auth.uid(), inv.website_id, 'website.invitation_accepted', 'invitation', inv.id::text,
          jsonb_build_object('role', inv.role, 'email', inv.email));

  RETURN QUERY SELECT true, inv.website_id, 'Joined.'::text;
END; $$;

GRANT EXECUTE ON FUNCTION public.accept_invitation(text) TO authenticated;
