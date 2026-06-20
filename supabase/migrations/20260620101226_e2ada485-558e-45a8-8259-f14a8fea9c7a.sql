-- Replace the SELECT policy so direct ownership is checked first.
-- The previous version delegated entirely to a SECURITY DEFINER helper,
-- whose nested SELECT against public.websites doesn't see the just-inserted
-- row during INSERT ... RETURNING, causing PostgREST to reject creation
-- with "new row violates row-level security policy" even though the WITH
-- CHECK clause passes. Owner-id check is direct (no recursion) and the
-- shared-access path stays the helper.

DROP POLICY IF EXISTS websites_select_accessible ON public.websites;

CREATE POLICY websites_select_accessible
ON public.websites
FOR SELECT
TO authenticated
USING (
  owner_id = auth.uid()
  OR private.user_has_website_access(id)
);

-- Clean up debug helpers.
DROP FUNCTION IF EXISTS public.debug_uid();
DROP FUNCTION IF EXISTS public.debug_uid_sd();