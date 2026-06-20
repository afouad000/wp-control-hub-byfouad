/**
 * End-to-end RLS test: create a website as an authenticated user and verify
 * the owner row in `website_members` is also allowed by RLS.
 *
 * Why a script and not vitest? The project doesn't ship a test runner.
 * This file is meant to be run as a script:
 *
 *     bun run tests/rls-website-creation.test.ts
 *
 * Auth: provide either
 *   - LOVABLE_BROWSER_SUPABASE_SESSION_JSON  (sandbox-injected)
 *   - or TEST_USER_EMAIL + TEST_USER_PASSWORD
 *
 * Required env:
 *   - VITE_SUPABASE_URL  (or SUPABASE_URL)
 *   - VITE_SUPABASE_PUBLISHABLE_KEY  (or SUPABASE_PUBLISHABLE_KEY)
 *
 * The test:
 *   1. Authenticates as the configured user.
 *   2. INSERTs a row into `websites` with owner_id = auth.uid().
 *   3. INSERTs a row into `website_members` with permission = 'owner'.
 *   4. SELECTs both back to confirm RLS allows reads.
 *   5. Cleans up by deleting the website (cascades members + audit logs).
 *   6. Confirms an INSERT with a forged owner_id is rejected by RLS.
 */
import { createClient } from "@supabase/supabase-js";

const URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;

if (!URL || !KEY) {
  console.error("Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY env vars.");
  process.exit(1);
}

const supabase = createClient(URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
});

async function authenticate(): Promise<{ id: string }> {
  const sessionJson = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
  if (sessionJson) {
    const session = JSON.parse(sessionJson);
    const { data, error } = await supabase.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
    if (error || !data.user) throw new Error(`setSession failed: ${error?.message}`);
    return { id: data.user.id };
  }
  const email = process.env.TEST_USER_EMAIL;
  const password = process.env.TEST_USER_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "No auth available. Provide LOVABLE_BROWSER_SUPABASE_SESSION_JSON or TEST_USER_EMAIL+TEST_USER_PASSWORD.",
    );
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(`signIn failed: ${error?.message}`);
  return { id: data.user.id };
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error("ASSERT FAIL:", msg);
    process.exit(1);
  }
}

async function main() {
  console.log("→ Authenticating…");
  const user = await authenticate();
  console.log("  signed in as", user.id);

  const url = `https://rls-test-${Date.now()}.example.com`;

  console.log("→ INSERT websites (owner_id = auth.uid())…");
  const { data: site, error: insertErr } = await supabase
    .from("websites")
    .insert({
      owner_id: user.id,
      name: "RLS Test Site",
      url,
      wp_username: "rls-test",
      wp_app_password: "redacted",
      status: "connected",
      connection_status: "connected",
    })
    .select("id, owner_id, url")
    .single();
  assert(!insertErr, `websites insert blocked by RLS: ${insertErr?.message}`);
  assert(site && site.owner_id === user.id, "owner_id mismatch after insert");
  console.log("  ✓ website created", site!.id);

  console.log("→ INSERT website_members (owner row)…");
  const { error: memberErr } = await supabase
    .from("website_members")
    .insert({ website_id: site!.id, user_id: user.id, permission: "owner" });
  // Server fn also creates this; if a trigger or earlier call inserted it,
  // a unique-violation is fine. Any other error fails the test.
  if (memberErr && !/duplicate|unique/i.test(memberErr.message)) {
    assert(false, `website_members insert blocked by RLS: ${memberErr.message}`);
  }
  console.log("  ✓ owner membership allowed");

  console.log("→ SELECT both back to confirm read RLS…");
  const { data: readSite } = await supabase.from("websites").select("id").eq("id", site!.id).maybeSingle();
  const { data: readMember } = await supabase
    .from("website_members")
    .select("user_id, permission")
    .eq("website_id", site!.id)
    .eq("user_id", user.id)
    .maybeSingle();
  assert(readSite?.id === site!.id, "owner cannot read their own website");
  assert(readMember?.permission === "owner", "owner cannot read their own membership row");
  console.log("  ✓ reads allowed");

  console.log("→ Negative test: INSERT with forged owner_id must fail…");
  const fakeOwner = "00000000-0000-0000-0000-000000000000";
  const { error: forgedErr } = await supabase.from("websites").insert({
    owner_id: fakeOwner,
    name: "should not save",
    url: `${url}-forged`,
    wp_username: "x",
    wp_app_password: "x",
  });
  assert(forgedErr, "RLS allowed an insert with a forged owner_id (security regression)");
  console.log("  ✓ forged insert rejected:", forgedErr!.code ?? forgedErr!.message);

  console.log("→ Cleanup…");
  await supabase.from("websites").delete().eq("id", site!.id);
  console.log("  ✓ deleted");

  console.log("\nALL CHECKS PASSED");
}

main().catch((e) => {
  console.error("TEST FAILED:", e);
  process.exit(1);
});
