# A-013: Authorization for the identity tables (design, not yet implemented)

Status: **design for review.** No code or migration changes come with this document.

## Problem
RLS (row-level security) covers the workflow, finance and attachment tables, but not the four identity tables: `sessions`, `platform_users`, `staff_memberships` and `tenants`.

The restricted runtime role `astra_app` has `SELECT`, `INSERT` and `UPDATE` on all four with no row policy. Tenant and user scoping therefore rests entirely on the `WHERE` clauses in the API code (about 108 queries in 14 files). One missing predicate or injection would expose:
- every user's email and password hash,
- every session's token hash and CSRF token,
- every office's memberships.

Phase 4 (Stage 5, Batch A) showed that a plain `tenant_id = astra.tenant_id` policy is wrong for these tables. The auth middleware reads them **before** a tenant is known, and some reads span tenants on purpose. With such a policy, every tenant sign-in returns 401 and the recovery guard silently changes meaning.

## Access patterns (from the current code)
| # | Pattern | Examples | Mechanism |
|---|---|---|---|
| P1 | **Pre-tenant authentication**: resolve a session token; find a login candidate by email or identifier digest; recovery | `app.ts` session middleware (sessions ⋈ users ⋈ memberships ⋈ tenants), login, `mfa.ts` login, `management.ts` recovery | Narrow `SECURITY DEFINER` functions returning only the columns the caller needs, e.g. `auth_resolve_session(token_hash)` and `auth_login_candidate(email_or_digest)`. This is the same pattern as `locate_password_recovery` (migration 042) and A-012. |
| P2 | **The caller's own account**: profile, password change, own sessions, MFA, email verification | `account-security.ts`, `portal-tools.ts`, `session-hygiene.ts`, `management.ts` password and sign-out-other-sessions | Policy `user_id = current_setting('astra.user_id')`. The request transaction sets `astra.user_id` next to `astra.tenant_id` (one line in `db.ts`). |
| P3 | **Office administration inside one tenant**: list, create or update memberships; office settings | `management.ts` users, account types, approver checks | Policy on `staff_memberships` and `tenants`: `tenant_id = astra.tenant_id` (for `tenants`, `id = astra.tenant_id`), used only inside `transaction(tenant)`. |
| P4 | **Platform owner**: create or suspend offices, list all offices, statistics | `management.ts` owner routes, `owner-statistics.ts`, `app.ts` owner office list | `SECURITY DEFINER` functions that check `astra.platform_role='owner'`, or a separate `astra_owner` role. A setting by itself is not enough: anything that can run SQL could set it. |
| P5 | **Public directory**: office list and page, verification, signup office check | `management.ts` public `/offices`, signup, `office-registration.ts` | `tenants` SELECT policy `status='ACTIVE'` plus a public-column view. `platform_users` and `sessions` are never public. |

## Policies (target)
- **`sessions`:** `FORCE RLS`. SELECT, UPDATE and INSERT are allowed only when `user_id = astra.user_id`. Lookup by token goes through P1 only, and the token hash never leaves that function.
- **`platform_users`:** `FORCE RLS`. SELECT and UPDATE are allowed when `id = astra.user_id`, or when the user has a membership in `astra.tenant_id` and the caller is an office admin. Login, recovery and duplicate-email checks go through P1/P4 functions. INSERT happens only through definer functions (signup, office creation, staff creation).
- **`staff_memberships`:** `FORCE RLS`. Allowed when `tenant_id = astra.tenant_id` or `user_id = astra.user_id`. The cross-tenant recovery guard moves into a definer function, so it keeps today's meaning.
- **`tenants`:** RLS. SELECT is allowed when `status='ACTIVE'` (public directory) or `id = astra.tenant_id`. UPDATE is allowed only when `id = astra.tenant_id`. Owner writes go through P4.

## Rollout (one table per PR, each releasable on its own)
1. `db.ts` sets `astra.user_id` in every authenticated transaction. Add a test harness that runs queries as `astra_app` with a chosen tenant and user, like the vault RLS test in `citizen-documents-vault.test.ts`.
2. **`sessions`:** add the P1 function `auth_resolve_session` and switch the middleware to it. Policy plus negative tests: one user can't read or expire another user's sessions.
3. **`platform_users`:** P1/P4 functions for login, recovery and signup. Self policy. Negative tests: no cross-user email or hash reads, no cross-office reads.
4. **`staff_memberships`:** move the recovery guard and approver lookups into functions. Tenant/self policy. Negative tests across offices.
5. **`tenants`:** public, self and owner paths. Negative test: an office admin can't update another office.

Acceptance for each step:
- The full `test:api` and `test:web` suites stay green, including sign-in for every role, recovery and MFA.
- The new negative tests pass, run as `astra_app`.
- `pg_policies` shows the policy.
- The migration matrix (clean, and upgrade from every supported base) stays identical.

## Risks
- **Auth outage:** a mis-scoped policy turns into 401s for everyone. Mitigations: one table per release, the full browser suite on every step, and each migration ships with its reverse (disable the policy) in the rollback plan.
- **Hosted single-role databases** (cPanel): `migrate-cpanel.ts` substitutes the single database user for `astra_app`. If that user owns the tables, RLS does not apply to it unless `FORCE ROW LEVEL SECURITY` is set. The definer functions must be owned by a role that is not the runtime user. Check this on the cPanel database before step 2.
