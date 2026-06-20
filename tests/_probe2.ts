import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false, storage: undefined }});
const s = JSON.parse(process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON!);
await supabase.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token });
const { data: u } = await supabase.auth.getUser();
console.log("uid:", u.user!.id);
const ins = await supabase.from('websites').insert({ owner_id: u.user!.id, name: 't', url: 'https://x.test/'+Date.now(), status:'connected', connection_status:'connected'}).select();
console.log("insert:", ins.error, ins.data);
// try without owner_id (use default)
const ins2 = await supabase.from('websites').insert({ name: 't2', url: 'https://x2.test/'+Date.now(), status:'connected', connection_status:'connected'}).select();
console.log("insert2:", ins2.error, ins2.data);
