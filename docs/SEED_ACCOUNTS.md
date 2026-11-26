# Seed demo accounts — production guard and removal procedure

## The guard (S-003 / A-004)

`scripts/seed.ts` creates 13 accounts that all share the published password
`Demo-Phase1!`:

- `owner@astra.demo.test` (platform owner), and
- 6 roles × 2 demo tenants: `admin@`, `approver@`, `reviewer@`, `staff@`,
  `finance@`, `citizen@` on `alpha.local.test` and `beta.local.test`.

The seed is a **test/development-only** operation. `scripts/seed-guard.ts`
refuses to run unless `NODE_ENV` / `APP_ENV` is explicitly non-production
(`test`, `development`, `dev` or `local`); production, an unrecognised
environment, and an unset environment all fail loudly before any database
connection is opened. There is no override flag. The seeded accounts
themselves are unchanged — the local test suites sign in with them.

## If a seed account is found on a live database

This procedure is documentation only. It is executed by the owner/DBA with
authorised live-database access; nothing here runs automatically and no live
access exists from this repository. Treat any seed account on a live
database as a **compromise until proven otherwise**: the password is
published, so assume it has been tried.

### 1. Detect (read-only)

```sql
-- Seed accounts: the owner address and the demo-tenant role addresses.
SELECT id, email, platform_role, active, created_at
FROM platform_users
WHERE email = 'owner@astra.demo.test'
   OR email LIKE '%@alpha.local.test'
   OR email LIKE '%@beta.local.test'
ORDER BY email;

-- Demo tenants (seeded alongside the accounts).
SELECT id, slug, demo, status FROM tenants WHERE demo = true;

-- Any session still live for those accounts.
SELECT s.user_id, u.email, s.expires_at
FROM sessions s JOIN platform_users u ON u.id = s.user_id
WHERE u.email = 'owner@astra.demo.test'
   OR u.email LIKE '%@alpha.local.test'
   OR u.email LIKE '%@beta.local.test';
```

### 2. Contain (immediately)

Disable the accounts and expire their sessions before investigating
further. Do this in one transaction so no new session can slip in between:

```sql
BEGIN;
UPDATE platform_users SET active = false
WHERE email = 'owner@astra.demo.test'
   OR email LIKE '%@alpha.local.test'
   OR email LIKE '%@beta.local.test';
UPDATE sessions SET expires_at = now()
WHERE user_id IN (
  SELECT id FROM platform_users
  WHERE email = 'owner@astra.demo.test'
     OR email LIKE '%@alpha.local.test'
     OR email LIKE '%@beta.local.test'
);
COMMIT;
```

### 3. Investigate

Check `audit_events` for those actor ids (sign-ins, password changes,
recovery grants, office or membership changes) and confirm whether any
real office, citizen, application or payment data was created or touched
while the seed accounts were live. Keep the audit rows; do not delete
them as part of the cleanup.

### 4. Remove or rotate

- **Demo tenants (`alpha` / `beta`) on a live database are not real
  offices.** If no real data references them, remove the seed accounts
  and their memberships (`staff_memberships`, `citizens` rows for the
  seeded citizen profiles) and the demo tenants, in the owner's
  maintenance window, after a backup.
- **Never rotate a seed account into a real account** by merely changing
  its password: the email addresses are `.test` / demo addresses that
  must not receive production mail. Real accounts are created through
  the normal signup/admin flows with real email addresses.
- If a seed account id is referenced by real data (it should not be —
  seed ids are deterministic `astra-demo:` hashes), keep the row
  disabled and escalate to the owner instead of deleting it.

### 5. Verify and record

- Re-run the detection queries: zero active seed accounts, zero live
  sessions.
- Confirm the platform owner can still sign in with the real owner
  account (created at deployment, step 5 of `docs/DEPLOY-CPANEL.md`),
  and that no office lost its admin.
- Record the incident in the remediation log: when the accounts were
  found, what the audit showed, and what was removed.
