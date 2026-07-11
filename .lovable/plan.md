## Next phase: Priorities 1 & 2 — production security cleanup + automated testing

The remaining priorities (3–18) are a multi-week roadmap. To keep each turn reviewable and safe, I want to tackle them in small, verifiable batches. This first batch closes the two blockers that gate everything else: getting secrets out of the repo, and getting a real test runner in place so future refactors don't regress the working Orders/Products/Customers/Coupons/Websites/Team/Activity pages.

Phases 3, 10 and parts of 4/5 are already done from earlier turns — I'll audit before touching them, not rebuild.

### Priority 1 — Security cleanup

1. **Remove `.env` from tracking.** `.env` currently contains the real Supabase URL, project id and publishable key. Publishable/anon values are safe to expose, but tracking the file at all is wrong: on Lovable Cloud the real `.env` is provisioned automatically, and committing it means future secret rotations (or an accidentally added service-role/API key) leak through git history.
   - `git rm --cached .env` (file stays on disk)
   - Add `.env`, `.env.local`, `.env.*.local` to `.gitignore` (keep `.env.example` tracked)
2. **Confirm no other secrets are committed** — grep the repo for `SERVICE_ROLE`, `sb_secret_`, `wc_consumer`, `wp_app_password`, `LOVABLE_API_KEY=` outside `.env.example`.
3. **Graceful env failure.** `src/integrations/supabase/client.ts` and `client.server.ts` already throw a clear message on missing vars — verify and extend the same pattern to `src/lib/config.server.ts` if it reads env at module scope. Server functions that read `process.env.LOVABLE_API_KEY` should return a typed `{ ok:false, error }` shape instead of crashing SSR.
4. **`SECURITY.md`** at repo root documenting: threat model, credential storage (private schema + SECURITY DEFINER accessors), SSRF protections in `safe-fetch.ts`, RLS model, HTML sanitization, how to report a vulnerability, and what is explicitly out of scope (e.g. self-hosted WP sites the user connects).

### Priority 2 — Test runner + guard tests

The repo has one test file (`tests/rls-website-creation.test.ts`) but no runner script.

1. **Add Vitest** (already transitively present via Vite) with `bun add -D vitest @vitest/coverage-v8`.
2. **`package.json` scripts:** `test`, `test:unit`, `test:watch`, `test:coverage`. Skip `test:e2e` for now — Playwright e2e would double this phase's size; I'll propose it in the UX polish phase.
3. **`vitest.config.ts`** with the existing `@/` alias and a `tests/` include glob.
4. **Unit tests (pure, no network, no DB):**
   - `safe-fetch.test.ts` — IPv4 private ranges, IPv6 loopback/link-local, blocked schemes, blocked suffixes (`.local`, `.internal`), redirect re-validation, timeout via mocked `fetch`.
   - `sanitize.test.ts` — strips `<script>`, `on*=` handlers, `javascript:` URLs, `<iframe>`; preserves allowed WooCommerce markup (`<p>`, `<a href="https://…">`, `<img>` with safe src).
   - `permissions.test.ts` — `can()` / `canOnSite()` from `use-permissions` helpers with a mocked summary (super-admin bypass, empty summary, per-site override).
5. **Integration-style tests** using the existing Supabase publishable key against the real dev DB (matches the pattern of `rls-website-creation.test.ts`, no service key needed):
   - auth guard on `_authenticated/route.tsx` (unauth → `/auth`)
   - RLS on `websites`, `website_members`, `audit_logs` — non-owner cannot select/update
   - `get_website_credentials_admin` / `set_website_credentials_admin` reject non-owners
   - `list_my_website_permissions` returns `{}` for non-members, full map for owners
6. **CI-friendly:** tests must run with `bun test` **and** `npm test`. No new secrets required — reuse `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` from `.env`.

### Out of scope for this turn
Priorities 3–18. I'll propose each as its own plan once this lands, so you can review the diff for each area (Team/invitations, Products completion, Sync tables, Reports/CSV, SaaS plans, etc.) separately.

### Acceptance for this batch
- `.env` no longer tracked; `.env.example` still tracked; `git status` clean.
- `SECURITY.md` exists.
- `bun test` and `npm test` both pass, exercising safe-fetch, sanitize, permissions, and the RLS/permission RPCs.
- No changes to Orders / Products / Customers / Coupons / Websites / Team / Activity UI or server functions.
- Build still passes.

Approve to proceed, or tell me to swap in a different priority (e.g. jump straight to Priority 4 Team/invitations or Priority 6 Products completion).