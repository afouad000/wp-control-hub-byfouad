# Next batch: Phase 1 completion — Production security hardening

Priorities 1 (basic security cleanup), 2 (Vitest), and 4 (Invitations MVP) are done. The full Phase 1 list from the spec still has significant gaps. Rather than jumping ahead to workspaces (Phase 3) on top of a still-leaky security base, this batch closes Phase 1 completely.

Phases 3–18 remain as-planned and unblocked after this lands.

## Scope

### 1. Environment hardening
- Detach tracked `.env` from git (`git rm --cached .env`) — flag to user; agent cannot run git.
- Add `src/lib/env.server.ts` that asserts required server envs (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `LOVABLE_API_KEY`) at first server-fn call, with a clear error naming the missing var.
- Confirm `.env.example` has only placeholders. Confirm no `VITE_*` variable leaks a secret.

### 2. Credential encryption at rest
- Migration: add `pgcrypto`-based encrypt/decrypt wrapper around `private.website_credentials`. New columns store ciphertext; `set_website_credentials` / `get_website_credentials` re-implemented to encrypt/decrypt using a server-side key.
- Key material: `APP_CREDENTIAL_ENCRYPTION_KEY` env — generated via `secrets--generate_secret` if missing. Never exposed to browser.
- Data migration: re-encrypt existing rows in the same migration (read plaintext → write ciphertext → drop plaintext columns).
- Confirm nothing in `public.websites`, generated types, or server-fn responses leaks credentials. Add a test that greps types.ts for credential column names.

### 3. Authorization order in server functions
Audit every server fn touching WooCommerce (`reconnectWebsite`, `testConnection`, `syncOrders`, `updateOrder`, etc.) and enforce this exact order:
1. `requireSupabaseAuth` (auth)
2. `can_access_website` check (site access)
3. `user_can_website(_, permission)` check (permission)
4. DB fetch of website row + credentials
5. External API call

Fix any function that fetches credentials or hits WooCommerce before the permission check. Add a `authorizeSiteAction(websiteId, permission)` helper so this order is centralized.

### 4. Transactional website provisioning
- Add `provisioning_state` enum column to `websites`: `pending | probing | provisioned | failed`.
- `createWebsite` server fn:
  1. Insert website row with `state='pending'`.
  2. Store credentials (encrypted).
  3. Probe WP + WC APIs.
  4. On success: mark `provisioned`, create owner `website_members` row, audit log.
  5. On any failure: delete the website row + credentials (cleanup) and return a typed error. Idempotent retry supported by unique constraint on `(owner_id, normalized_url)`.

### 5. Rate limiting
- Table: `public.rate_limit_events(id, user_id, key, created_at)` with an index on `(user_id, key, created_at desc)`.
- Server helper `enforceRateLimit({ key, userId, max, windowSeconds })` that counts recent events and inserts one; throws typed error on exceed.
- Apply to: login attempts (via edge-callable fn), `testConnection`, `reconnectWebsite`, sync/bulk actions, exports, invitation creation, refund creation.
- Documented as ad-hoc (per `no-backend-rate-limiting` guidance) — user has already implicitly opted in via spec.

### 6. Invitation token hardening
- Store only `token_hash` (SHA-256) in `website_invitations`. `token` column dropped; raw token returned once at creation and never queryable.
- `get_invitation_by_token(_token)` hashes input, returns MASKED emails (e.g. `f***@example.com`) for unauthenticated lookups; full emails only after auth.
- `accept_invitation` marks accepted atomically and prevents reuse.
- Revoke any existing pending invitation for the same `(website_id, lower(email))` when a new one is created.
- Add `Referrer-Policy: no-referrer` header on `/invite/$token` route.

### 7. Idempotency
- Table: `public.idempotency_keys(user_id, key, response jsonb, created_at)` unique on `(user_id, key)`.
- Helper `withIdempotency(key, fn)` used by: refund create, bulk update job create, website provisioning, sync job create, export create, invitation accept.

### 8. Tests
- Unit: rate-limit window math, idempotency wrapper, token hashing/masking.
- Integration (bun script style, like existing `rls-website-creation`): authorization ordering (permission failure never hits WC), provisioning rollback on probe failure, invitation single-use, credential round-trip encryption.

## Out of scope
- Workspaces (Phase 3).
- Full sync/webhooks infra (Phase 11).
- Products bulk update UI (Phase 8).
- CI workflow file (Phase 2 leftover) — 1 tiny follow-up.

## Acceptance
- `.env` no longer tracked; startup fails clearly on missing envs.
- Credentials in DB are ciphertext; `types.ts` contains no plaintext credential columns.
- Every WC-touching server fn does auth → access → permission before any external call (verified by grep + tests).
- Failed `createWebsite` leaves no orphan rows.
- Invitations use hashed tokens; anonymous lookup returns masked emails; tokens are one-time.
- Repeated refund/bulk/provision calls with the same idempotency key return the first result, not duplicates.
- `bun run test` and `bun run build` pass.

## Delivery
Single batch, ~6–8 files + 3 migrations. I'll pause for approval on the migrations (Supabase migration tool requires it) but not between code edits.

Approve to proceed, or say "skip to Phase 3 (workspaces)" / "skip to Phase 6 (Products completion)" and I'll re-plan.
