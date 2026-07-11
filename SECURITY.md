# Security Model — WP Control Hub

WP Control Hub is a multi-tenant SaaS dashboard for managing WordPress and
WooCommerce sites on behalf of agencies and their clients. This document
describes the security model, the trust boundaries, and how to report a
vulnerability.

## Reporting a vulnerability

Please email security reports privately to the maintainer at
**security@madebyfouad.com**. Do not open a public GitHub issue for
security-sensitive problems.

Include: a description, reproduction steps, the affected component
(auth / RLS / server function / connection wizard / WooCommerce proxy),
and the impact you were able to demonstrate.

## Trust boundaries

1. **Browser (untrusted)** — React app. Ships only the Supabase publishable
   (anon) key and app UI code. Never receives WordPress / WooCommerce
   credentials or the Supabase service-role key.
2. **Server functions (trusted)** — `createServerFn` handlers running in
   the Cloudflare Worker runtime. Authenticated with the caller's Supabase
   bearer token via `requireSupabaseAuth`. Perform all outbound calls to
   customer WordPress / WooCommerce sites.
3. **Supabase Postgres (trusted core)** — Row Level Security is enabled on
   every user-facing table. All authorization decisions live in Postgres,
   not in the client.
4. **Customer WordPress / WooCommerce sites (semi-trusted)** — Treated as
   untrusted HTML sources. All responses are validated; all rendered HTML
   is sanitized (see below).

## Authentication

- Supabase Auth (email/password and Google OAuth via the Lovable broker).
- Sessions live in browser `localStorage` and are attached to every
  server-function call by a client middleware in `src/start.ts`.
- The protected route subtree lives at `src/routes/_authenticated/*` and
  is gated client-side by an integration-managed layout. Every protected
  server function additionally re-validates the bearer token — the client
  gate is defence-in-depth, not the authorization boundary.

## Authorization

- **Row Level Security** is enabled on `websites`, `website_members`,
  `user_roles`, `profiles`, and `audit_logs`.
- Role checks use a `SECURITY DEFINER` function (`has_role`) to avoid
  recursive policies on `user_roles`.
- Website access uses `can_access_website(user, website)` and
  `user_can_website(website, permission)`, both `SECURITY DEFINER` with
  a locked `search_path`.
- The client-side sidebar and route guards call
  `list_my_website_permissions` for UX only — backend server functions
  independently re-check permission before every mutation.

## Credential storage (WordPress / WooCommerce)

Per-site credentials (WordPress username + application password,
WooCommerce consumer key + secret) are:

- Stored in the `private` schema, **not** in `public.websites`.
- Read and written only through `SECURITY DEFINER` accessors
  (`get_website_credentials_admin`, `set_website_credentials_admin`)
  which check `can_access_website` before returning anything.
- Never included in Supabase-generated types, never selected into
  server-function responses, never logged. Activity logs record that a
  credential was updated but never the value.

The Supabase service-role key is server-only, never appears in any
`VITE_*` variable, and is not readable from the Lovable dashboard.

## SSRF protection

Every outbound HTTP call from a server function to a user-supplied URL
goes through `safeFetch` in `src/lib/safe-fetch.ts`:

- Only `http:` and `https:` schemes are allowed.
- IPv4 literals in loopback / private (10/8, 172.16/12, 192.168/16) /
  CGNAT (100.64/10) / link-local (169.254/16 — includes the cloud
  metadata IP) / benchmarking / TEST-NET / multicast / reserved ranges
  are rejected.
- IPv6 loopback (`::1`), unspecified (`::`), link-local (`fe80::/10`),
  unique local (`fc00::/7`), and multicast (`ff00::/8`) are rejected.
  IPv4-mapped IPv6 addresses are unwrapped and re-validated.
- Hostnames like `localhost`, `*.local`, `*.internal`, `*.lan`,
  `metadata.google.internal` are rejected outright.
- Every redirect hop (up to 3) is re-validated so a public origin
  cannot bounce us to an internal one.
- A hard timeout (default 15s) is enforced via `AbortController`.

Site URLs entered in the connection wizard are additionally rejected at
the Zod schema layer with the same `assertSafeUrl` check.

## HTML sanitization

External WordPress / WooCommerce HTML (product descriptions, order
notes, post titles) is passed through `sanitizeHtml` in
`src/lib/sanitize.ts` before being rendered with
`dangerouslySetInnerHTML`. The allowlist is limited to simple
formatting tags and known-safe attributes; `<script>`, `<iframe>`,
event handlers (`on*=`), and `javascript:` URLs are stripped.

## Secrets and environment variables

- `.env` is **git-ignored**. Only `.env.example` (placeholders) is
  tracked. If you cloned an older revision that tracked `.env`, run
  `git rm --cached .env` once to detach it.
- On Lovable Cloud, real environment values are injected automatically
  and are not stored in the repository.
- `VITE_*` variables ship to the browser bundle — never put a secret
  behind that prefix. Server-only secrets use the plain name
  (`SUPABASE_SERVICE_ROLE_KEY`, `LOVABLE_API_KEY`).
- Missing required env vars cause a clear runtime error at the Supabase
  client entry points rather than a silent misconfiguration.

## Out of scope

- The security of individual WordPress installations the user connects.
  If a customer site is compromised, the credentials stored here grant
  the same access to WP Control Hub that they granted to the site's
  own admin.
- Denial of service against the app itself. There is no application-
  level rate limiter today; rely on Cloudflare's edge protections.
- Any usage of the service-role key. It is not exposed to code that a
  regular customer request can reach.
