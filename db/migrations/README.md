# Database migrations

Migrations run in filename order (`scripts/migrate.ts`) and are history:
never edit an applied migration to change behaviour. New behaviour goes
in a new numbered migration. The next number after the latest file is
the next free integer; check `ls db/migrations` before creating one.

## Numbering notes

- **005 was never issued.** No `005_*.sql` file exists in the repo or in
  git history, and `schema_migrations` never recorded one. The gap is
  intentional history, not a missing file: do not create a 005 later,
  or fresh installs and already-migrated databases will diverge.
  (A-008, Phase 4 Stage 5.)
- **006's `applications_tenant_state_time` statement is dead DDL.**
  Migration 004 already created `applications_tenant_state_time` on
  `(tenant_id, state, updated_at DESC)`; 006's `CREATE INDEX IF NOT
  EXISTS applications_tenant_state_time ... (tenant_id, state,
  created_at DESC)` never applied because the name already existed.
  No `created_at` variant was created, deliberately: the queue query
  (`apps/api/src/app.ts`, applications list) orders by
  `updated_at DESC`, which the 004 index serves. Do not "fix" 006 by
  renaming the statement unless a query is found that orders or
  filters by `created_at` on that key. (A-010, Phase 4 Stage 5.)

## Retired tables

- **`government_fee_assessments` was created in 001 and dropped in
  018** (`018_drop_government_fee_assessments.sql`, which aborts if the
  table ever held rows). Nothing reads or writes it. Its replacement
  is the per-order fee model: `application_orders` +
  `service_order_policies` (migration 044 charges at submit). New
  readers should start there, not trace the dropped table.
  (A-020, Phase 4 Stage 5.)

## Row-level security on the identity tables (A-013)

RLS covers the workflow, finance and attachment tables. It deliberately
does **not** cover `sessions`, `platform_users`, `staff_memberships`
or `tenants`, and that is a known residual risk, not an oversight:

- The sign-in path queries `sessions JOIN platform_users JOIN
  staff_memberships JOIN tenants` by token hash **before any tenant
  context exists** (`apps/api/src/app.ts`, auth middleware). A
  tenant_scope policy on any of those tables would make that join see
  no rows and reject every tenant sign-in.
- `staff_memberships` is also read **across tenants on purpose** in
  tenant-scoped code: `recoveryEligible`
  (`apps/api/src/management.ts`) refuses recovery for a user who holds
  a membership in any other office
  (`NOT EXISTS (... other.tenant_id <> $2)`), and the sign-in
  membership lookup (`apps/api/src/mfa.ts`, `membershipFor`) picks the
  caller's active membership without a tenant filter. A strict
  tenant_scope policy would silently make the recovery guard vacuous
  (a multi-office user would wrongly become recovery-eligible) instead
  of failing loudly. This was demonstrated on a scratch database in
  Stage 5 Batch A (see
  `qa-audit/remediation/fragments/stage5-batch-a-db.md`); the policy
  was not kept.
- A policy with an "unless a tenant is set" escape (`... OR
  current_setting('astra.tenant_id') IS NULL`) would be a no-op for
  exactly the paths that matter (auth runs with no tenant set) while
  looking like a barrier, so it was not added either.

Residual risk: a leaked application-DB credential can read password
hashes (`platform_users.password_hash`) and session tokens
(`sessions.token_hash`); RLS trusts the app-set tenant context, so it
is not a second barrier for these tables. The barrier remains the API
layer (token-hash lookup, membership/active checks, CSRF, rate
limits) plus credential custody. Closing this properly needs the
cross-tenant reads above to move into SECURITY DEFINER functions first
(the same pattern as `locate_password_recovery`, migration 042), so a
tenant_scope policy can be added without changing their semantics;
that refactor is a follow-up, not a one-line policy change.
