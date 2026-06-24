
CREATE OR REPLACE FUNCTION private.set_website_credentials(
  _website_id uuid,
  _wp_username text,
  _wp_app_password text,
  _wc_consumer_key text,
  _wc_consumer_secret text
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, private AS $$
  INSERT INTO private.website_credentials (website_id, wp_username, wp_app_password, wc_consumer_key, wc_consumer_secret)
  VALUES (_website_id, _wp_username, _wp_app_password, _wc_consumer_key, _wc_consumer_secret)
  ON CONFLICT (website_id) DO UPDATE SET
    wp_username = EXCLUDED.wp_username,
    wp_app_password = EXCLUDED.wp_app_password,
    wc_consumer_key = EXCLUDED.wc_consumer_key,
    wc_consumer_secret = EXCLUDED.wc_consumer_secret,
    updated_at = now();
$$;

REVOKE ALL ON FUNCTION private.set_website_credentials(uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.set_website_credentials(uuid, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION private.set_website_credentials(uuid, text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION private.set_website_credentials(uuid, text, text, text, text) TO service_role;

-- Also expose the read function with a public.* wrapper that's callable only via service role,
-- so PostgREST can route the RPC (private schema isn't exposed via REST).
CREATE OR REPLACE FUNCTION public.get_website_credentials_admin(_website_id uuid)
RETURNS TABLE (url text, wp_username text, wp_app_password text, wc_consumer_key text, wc_consumer_secret text)
LANGUAGE sql SECURITY DEFINER SET search_path = public, private AS $$
  SELECT * FROM private.get_website_credentials(_website_id);
$$;
REVOKE ALL ON FUNCTION public.get_website_credentials_admin(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_website_credentials_admin(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_website_credentials_admin(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_website_credentials_admin(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.set_website_credentials_admin(
  _website_id uuid, _wp_username text, _wp_app_password text,
  _wc_consumer_key text, _wc_consumer_secret text
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, private AS $$
  SELECT private.set_website_credentials(_website_id, _wp_username, _wp_app_password, _wc_consumer_key, _wc_consumer_secret);
$$;
REVOKE ALL ON FUNCTION public.set_website_credentials_admin(uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_website_credentials_admin(uuid, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.set_website_credentials_admin(uuid, text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.set_website_credentials_admin(uuid, text, text, text, text) TO service_role;
