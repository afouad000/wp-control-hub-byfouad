
-- Private schema for SECURITY DEFINER helpers (bypasses RLS, hidden from API)
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

-- Helper: can the user access the given website? Runs as definer, bypassing RLS.
CREATE OR REPLACE FUNCTION private.user_has_website_access(_website_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.websites w
    WHERE w.id = _website_id AND w.owner_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.website_members m
    WHERE m.website_id = _website_id AND m.user_id = auth.uid()
  )
  OR public.is_super_admin(auth.uid())
$$;

REVOKE ALL ON FUNCTION private.user_has_website_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.user_has_website_access(uuid) TO authenticated;

-- Replace recursive websites policies
DROP POLICY IF EXISTS "websites_owner_select" ON public.websites;
DROP POLICY IF EXISTS "websites_owner_insert" ON public.websites;
DROP POLICY IF EXISTS "websites_owner_update" ON public.websites;
DROP POLICY IF EXISTS "websites_owner_delete" ON public.websites;

CREATE POLICY "websites_select_accessible"
ON public.websites FOR SELECT TO authenticated
USING (private.user_has_website_access(id));

CREATE POLICY "websites_insert_own"
ON public.websites FOR INSERT TO authenticated
WITH CHECK (owner_id = auth.uid());

CREATE POLICY "websites_update_owner_or_admin"
ON public.websites FOR UPDATE TO authenticated
USING (owner_id = auth.uid() OR public.is_super_admin(auth.uid()))
WITH CHECK (owner_id = auth.uid() OR public.is_super_admin(auth.uid()));

CREATE POLICY "websites_delete_owner"
ON public.websites FOR DELETE TO authenticated
USING (owner_id = auth.uid());

-- Replace recursive website_members policies (they queried public.websites directly)
DROP POLICY IF EXISTS "members_select" ON public.website_members;
DROP POLICY IF EXISTS "members_manage" ON public.website_members;

-- Helper: is the user the owner of a website? Bypasses RLS.
CREATE OR REPLACE FUNCTION private.user_owns_website(_website_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.websites w
    WHERE w.id = _website_id
      AND (w.owner_id = auth.uid() OR public.is_super_admin(auth.uid()))
  )
$$;
REVOKE ALL ON FUNCTION private.user_owns_website(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.user_owns_website(uuid) TO authenticated;

CREATE POLICY "members_select_accessible"
ON public.website_members FOR SELECT TO authenticated
USING (user_id = auth.uid() OR private.user_owns_website(website_id));

CREATE POLICY "members_manage_owner"
ON public.website_members FOR ALL TO authenticated
USING (private.user_owns_website(website_id))
WITH CHECK (private.user_owns_website(website_id));

-- Connection health columns
ALTER TABLE public.websites
  ADD COLUMN IF NOT EXISTS connection_status TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS last_error TEXT;
