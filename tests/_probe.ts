import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false, storage: undefined }});
const s = JSON.parse(process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON!);
await supabase.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token });
const { data: u } = await supabase.auth.getUser();
console.log("user", u.user?.id, u.user?.role);
const { data, error } = await supabase.rpc('has_role', { _user_id: u.user!.id, _role: 'client' });
console.log("has_role client", data, error?.message);
// raw select on websites
const { data: list, error: e2 } = await supabase.from('websites').select('id, owner_id').limit(3);
console.log("list", list, e2?.message);
