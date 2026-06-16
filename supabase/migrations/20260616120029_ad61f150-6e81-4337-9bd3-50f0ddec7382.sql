
-- Roles enum and table
CREATE TYPE public.app_role AS ENUM ('super_admin','client','team_member');

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_self_select" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles_self_update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles_self_insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "roles_self_select" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'super_admin')
$$;

-- Allow super admins to read all roles
CREATE POLICY "roles_admin_all" ON public.user_roles FOR ALL TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

-- Websites
CREATE TABLE public.websites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  client_name TEXT,
  logo_url TEXT,
  wp_username TEXT,
  wp_app_password TEXT, -- store as-is; treat as secret (RLS-protected)
  wc_consumer_key TEXT,
  wc_consumer_secret TEXT,
  status TEXT NOT NULL DEFAULT 'unknown', -- connected | error | unknown
  last_checked_at TIMESTAMPTZ,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.websites TO authenticated;
GRANT ALL ON public.websites TO service_role;
ALTER TABLE public.websites ENABLE ROW LEVEL SECURITY;

-- Members (assignments)
CREATE TABLE public.website_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id UUID NOT NULL REFERENCES public.websites(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL DEFAULT 'view', -- view | edit | admin
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(website_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.website_members TO authenticated;
GRANT ALL ON public.website_members TO service_role;
ALTER TABLE public.website_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_access_website(_user uuid, _website uuid)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    public.is_super_admin(_user)
    OR EXISTS (SELECT 1 FROM public.websites w WHERE w.id = _website AND w.owner_id = _user)
    OR EXISTS (SELECT 1 FROM public.website_members m WHERE m.website_id = _website AND m.user_id = _user)
$$;

CREATE POLICY "websites_owner_select" ON public.websites FOR SELECT TO authenticated
USING (owner_id = auth.uid() OR public.is_super_admin(auth.uid())
       OR EXISTS (SELECT 1 FROM public.website_members m WHERE m.website_id = id AND m.user_id = auth.uid()));
CREATE POLICY "websites_owner_insert" ON public.websites FOR INSERT TO authenticated
WITH CHECK (owner_id = auth.uid() OR public.is_super_admin(auth.uid()));
CREATE POLICY "websites_owner_update" ON public.websites FOR UPDATE TO authenticated
USING (owner_id = auth.uid() OR public.is_super_admin(auth.uid()));
CREATE POLICY "websites_owner_delete" ON public.websites FOR DELETE TO authenticated
USING (owner_id = auth.uid() OR public.is_super_admin(auth.uid()));

CREATE POLICY "members_select" ON public.website_members FOR SELECT TO authenticated
USING (public.can_access_website(auth.uid(), website_id));
CREATE POLICY "members_manage" ON public.website_members FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.websites w WHERE w.id = website_id AND (w.owner_id = auth.uid() OR public.is_super_admin(auth.uid()))))
WITH CHECK (EXISTS (SELECT 1 FROM public.websites w WHERE w.id = website_id AND (w.owner_id = auth.uid() OR public.is_super_admin(auth.uid()))));

-- Audit logs
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  website_id UUID REFERENCES public.websites(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_select_self_or_admin" ON public.audit_logs FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_super_admin(auth.uid())
       OR (website_id IS NOT NULL AND public.can_access_website(auth.uid(), website_id)));
CREATE POLICY "audit_insert_self" ON public.audit_logs FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER trg_websites_updated BEFORE UPDATE ON public.websites FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-create profile + default role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'avatar_url')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'client')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
