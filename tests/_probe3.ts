const s = JSON.parse(process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON!);
const [, payload] = s.access_token.split('.');
console.log(JSON.parse(Buffer.from(payload, 'base64url').toString()));
