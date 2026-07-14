## Next batch: Priority 4 — Team & invitations hardening

Priorities 1 (security cleanup) and 2 (Vitest + guard tests) are done. The next highest-leverage batch is finishing the Team/invitations surface so agencies can actually onboard clients and staff. Everything else (Products completion, Sync tables, Reports, SaaS plans) depends on having reliable per-site membership.

### Scope

1. **Invitations table + RLS**
   - `public.website_invitations` (id, website_id, email, role, permissions jsonb, invited_by, token, expires_at, accepted_at, revoked_at, created_at).
   - GRANTs: `authenticated` SELECT/INSERT/UPDATE, `service_role` ALL. No `anon`.
   - RLS: only users with `manage_team` on the website can insert/select/revoke; invitee can select their own row by token via a `SECURITY DEFINER` accessor.

2. **Server functions** (`src/lib/invitations.functions.ts`)
   - `listInvitations({ websiteId })` — requires `manage_team`.
   - `createInvitation({ websiteId, email, role, permissions })` — validates email, generates opaque token, 7-day expiry, writes audit log.
   - `revokeInvitation({ id })` — sets `revoked_at`, audit log.
   - `getInvitationByToken({ token })` — public-ish (no auth required); returns website name + inviter email only, never credentials.
   - `acceptInvitation({ token })` — requires auth; inserts `website_members` row, marks accepted, audit log. Rejects if email mismatch, expired, revoked, or already accepted.

3. **UI**
   - Extend `_authenticated/users.tsx` with an "Invitations" tab: list pending, resend (regenerate token), revoke.
   - New public route `src/routes/invite.$token.tsx` — shows website + inviter, "Sign in to accept" if unauth, "Accept invitation" button if auth.
   - Wire `RequirePermission permission="manage_team"` around the invitations tab.

4. **Email (deferred stub)**
   - Return the invitation URL from `createInvitation` so the inviter can copy/share it manually for now. No email sending this turn — that lands with the transactional-email phase.

5. **Tests**
   - Unit: token generation length/entropy, expiry check helper.
   - RLS-style integration (matches `tests/rls-website-creation.test.ts`): non-team-manager cannot list/create/revoke; wrong-email cannot accept; expired token rejected; happy path creates `website_members` row.

### Out of scope
- Email delivery (needs Resend/SES setup — separate phase).
- Bulk invite / CSV.
- Changing existing `website_members` UI beyond adding the tab.

### Acceptance
- Owner can invite a teammate, copy the link, teammate signs up/in, accepts, appears in members list with the granted permissions.
- Non-managers see 403 on all invitation endpoints.
- All new tables have GRANTs + RLS.
- `bun test` still green; build passes.

Approve to proceed, or say "swap to Priority 6 (Products completion)" / "swap to Priority 11 (Reports & CSV)" and I'll re-plan.
