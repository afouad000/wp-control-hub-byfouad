
CREATE OR REPLACE FUNCTION public.user_can_website(_website_id uuid, _permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private AS $$
  SELECT private.user_can(_website_id, _permission);
$$;
GRANT EXECUTE ON FUNCTION public.user_can_website(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_website_permissions(_website_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private AS $$
  SELECT
    CASE
      WHEN EXISTS (SELECT 1 FROM public.websites WHERE id = _website_id AND owner_id = auth.uid())
        OR public.is_super_admin(auth.uid())
      THEN '{"view_dashboard":true,"view_orders":true,"edit_orders":true,"view_products":true,"edit_products":true,"view_customers":true,"edit_customers":true,"view_coupons":true,"manage_coupons":true,"view_reports":true,"manage_website_settings":true,"manage_team":true,"view_activity_logs":true,"is_owner":true}'::jsonb
      ELSE COALESCE(
        (SELECT permissions FROM public.website_members
         WHERE website_id = _website_id AND user_id = auth.uid()
           AND invitation_status = 'accepted' AND revoked_at IS NULL
         LIMIT 1),
        '{}'::jsonb
      )
    END
$$;
GRANT EXECUTE ON FUNCTION public.list_my_website_permissions(uuid) TO authenticated;
