
-- Strengthen websites.owner_id defaults and INSERT policy
ALTER TABLE public.websites
  ALTER COLUMN owner_id SET DEFAULT auth.uid();

ALTER TABLE public.websites
  ALTER COLUMN owner_id SET NOT NULL;

-- Replace INSERT policy with explicit authenticated + owner check
DROP POLICY IF EXISTS websites_insert_own ON public.websites;
DROP POLICY IF EXISTS "Users can create owned websites" ON public.websites;

CREATE POLICY "Users can create owned websites"
ON public.websites
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND owner_id = auth.uid()
);

-- Allow owners to manage member rows for their websites (in case it isn't already)
DROP POLICY IF EXISTS members_insert_owner ON public.website_members;
CREATE POLICY members_insert_owner
ON public.website_members
FOR INSERT
TO authenticated
WITH CHECK (private.user_owns_website(website_id));
