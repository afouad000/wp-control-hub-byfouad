
-- Lock down credential columns on public.websites so members (and even owners)
-- cannot SELECT them via the Data API. Server functions read credentials only
-- through a SECURITY DEFINER helper in the `private` schema.

REVOKE SELECT (wp_app_password, wc_consumer_key, wc_consumer_secret, wp_username)
  ON public.websites FROM authenticated;
REVOKE SELECT (wp_app_password, wc_consumer_key, wc_consumer_secret, wp_username)
  ON public.websites FROM anon;

-- Recreate read function used by server fns (owners + members may read creds).
CREATE OR REPLACE FUNCTION private.get_website_credentials(_website_id uuid)
RETURNS TABLE (
  url text,
  wp_username text,
  wp_app_password text,
  wc_consumer_key text,
  wc_consumer_secret text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT w.url, w.wp_username, w.wp_app_password, w.wc_consumer_key, w.wc_consumer_secret
  FROM public.websites w
  WHERE w.id = _website_id
    AND public.can_access_website(auth.uid(), w.id)
$$;

GRANT EXECUTE ON FUNCTION private.get_website_credentials(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION private.get_website_credentials(uuid) FROM anon, public;
