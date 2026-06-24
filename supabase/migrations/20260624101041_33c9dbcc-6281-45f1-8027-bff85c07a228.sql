
-- ===== 1. WEBSITE_MEMBERS upgrade =====
ALTER TABLE public.website_members
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'viewer',
  ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS invitation_status text NOT NULL DEFAULT 'accepted',
  ADD COLUMN IF NOT EXISTS invited_email text,
  ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invite_token text,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $mig$
DECLARE
  full_perms jsonb := '{"view_dashboard":true,"view_orders":true,"edit_orders":true,"view_products":true,"edit_products":true,"view_customers":true,"edit_customers":true,"view_coupons":true,"manage_coupons":true,"view_reports":true,"manage_website_settings":true,"manage_team":true,"view_activity_logs":true}'::jsonb;
  manager_perms jsonb := '{"view_dashboard":true,"view_orders":true,"edit_orders":true,"view_products":true,"edit_products":true,"view_customers":true,"edit_customers":true,"view_coupons":true,"manage_coupons":true,"view_reports":true,"manage_website_settings":false,"manage_team":false,"view_activity_logs":true}'::jsonb;
  viewer_perms jsonb := '{"view_dashboard":true,"view_orders":true,"edit_orders":false,"view_products":true,"edit_products":false,"view_customers":true,"edit_customers":false,"view_coupons":true,"manage_coupons":false,"view_reports":true,"manage_website_settings":false,"manage_team":false,"view_activity_logs":false}'::jsonb;
BEGIN
  UPDATE public.website_members
  SET
    role = CASE WHEN permission = 'owner' THEN 'owner' WHEN permission = 'edit' THEN 'store_manager' ELSE 'viewer' END,
    permissions = CASE WHEN permission = 'owner' THEN full_perms WHEN permission = 'edit' THEN manager_perms ELSE viewer_perms END
  WHERE permissions = '{}'::jsonb;
END $mig$;

CREATE INDEX IF NOT EXISTS website_members_invite_token_idx ON public.website_members (invite_token) WHERE invite_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS website_members_invited_email_idx ON public.website_members (lower(invited_email)) WHERE invited_email IS NOT NULL;

DROP TRIGGER IF EXISTS trg_website_members_updated ON public.website_members;
CREATE TRIGGER trg_website_members_updated BEFORE UPDATE ON public.website_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Update access helper to also require accepted, non-revoked membership.
CREATE OR REPLACE FUNCTION private.user_has_website_access(_website_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.websites WHERE id = _website_id AND owner_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.website_members
    WHERE website_id = _website_id AND user_id = auth.uid()
      AND invitation_status = 'accepted' AND revoked_at IS NULL
  )
  OR public.is_super_admin(auth.uid())
$$;

-- New permission helper
CREATE OR REPLACE FUNCTION private.user_can(_website_id uuid, _permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.websites WHERE id = _website_id AND owner_id = auth.uid())
    OR public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.website_members m
      WHERE m.website_id = _website_id AND m.user_id = auth.uid()
        AND m.invitation_status = 'accepted' AND m.revoked_at IS NULL
        AND COALESCE((m.permissions ->> _permission)::boolean, false) = true
    )
$$;

GRANT EXECUTE ON FUNCTION private.user_can(uuid, text) TO authenticated, service_role;

-- ===== 2. PRIVATE SCHEMA: secure credentials =====
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM anon;
REVOKE ALL ON SCHEMA private FROM authenticated;
GRANT USAGE ON SCHEMA private TO service_role;

CREATE TABLE IF NOT EXISTS private.website_credentials (
  website_id uuid PRIMARY KEY REFERENCES public.websites(id) ON DELETE CASCADE,
  wp_username text,
  wp_app_password text,
  wc_consumer_key text,
  wc_consumer_secret text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON private.website_credentials FROM PUBLIC;
REVOKE ALL ON private.website_credentials FROM anon;
REVOKE ALL ON private.website_credentials FROM authenticated;
GRANT ALL ON private.website_credentials TO service_role;

DROP TRIGGER IF EXISTS trg_website_credentials_updated ON private.website_credentials;
CREATE TRIGGER trg_website_credentials_updated BEFORE UPDATE ON private.website_credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DO $mig2$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='websites' AND column_name='wp_app_password') THEN
    INSERT INTO private.website_credentials (website_id, wp_username, wp_app_password, wc_consumer_key, wc_consumer_secret)
    SELECT id, wp_username, wp_app_password, wc_consumer_key, wc_consumer_secret
    FROM public.websites
    WHERE wp_username IS NOT NULL OR wp_app_password IS NOT NULL
       OR wc_consumer_key IS NOT NULL OR wc_consumer_secret IS NOT NULL
    ON CONFLICT (website_id) DO NOTHING;
  END IF;
END $mig2$;

ALTER TABLE public.websites
  DROP COLUMN IF EXISTS wp_username,
  DROP COLUMN IF EXISTS wp_app_password,
  DROP COLUMN IF EXISTS wc_consumer_key,
  DROP COLUMN IF EXISTS wc_consumer_secret;

-- Replace credentials reader to join the new table
CREATE OR REPLACE FUNCTION private.get_website_credentials(_website_id uuid)
RETURNS TABLE (
  url text, wp_username text, wp_app_password text,
  wc_consumer_key text, wc_consumer_secret text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private AS $$
  SELECT w.url, c.wp_username, c.wp_app_password, c.wc_consumer_key, c.wc_consumer_secret
  FROM public.websites w
  LEFT JOIN private.website_credentials c ON c.website_id = w.id
  WHERE w.id = _website_id
$$;

REVOKE ALL ON FUNCTION private.get_website_credentials(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.get_website_credentials(uuid) FROM anon;
REVOKE ALL ON FUNCTION private.get_website_credentials(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION private.get_website_credentials(uuid) TO service_role;

-- ===== 3. AUDIT LOGS upgrade =====
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS entity_type text,
  ADD COLUMN IF NOT EXISTS entity_id text,
  ADD COLUMN IF NOT EXISTS old_value jsonb,
  ADD COLUMN IF NOT EXISTS new_value jsonb,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'success',
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS ip_address text,
  ADD COLUMN IF NOT EXISTS user_agent text;

CREATE INDEX IF NOT EXISTS audit_logs_website_id_idx ON public.audit_logs (website_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_user_id_idx ON public.audit_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON public.audit_logs (action);

DROP POLICY IF EXISTS "audit_logs_select_members_with_permission" ON public.audit_logs;
CREATE POLICY "audit_logs_select_members_with_permission" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (website_id IS NOT NULL AND private.user_owns_website(website_id))
    OR (website_id IS NOT NULL AND private.user_can(website_id, 'view_activity_logs'))
  );
