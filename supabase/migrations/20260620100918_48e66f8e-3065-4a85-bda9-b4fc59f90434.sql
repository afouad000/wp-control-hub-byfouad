-- Public tables were missing role grants, which PostgREST surfaces as
-- "row-level security policy violation" even when the policy itself passes.
-- RLS remains the source of truth for row visibility; these grants only
-- expose the tables to the API roles so the policies can be evaluated.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.websites TO authenticated;
GRANT ALL ON public.websites TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.website_members TO authenticated;
GRANT ALL ON public.website_members TO service_role;

GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;