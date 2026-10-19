# Release 0.6 — account safety, recovery checks and public-page loading

This release advances the merchant-independent backlog. bKash onboarding and activation are deferred by the product owner. Payment collection remains disabled; Nagad, bank settlement and official identity/issuance remain unavailable. No fee, ledger, certificate or payment schema migration is required.

## Delivered scope

| Area | Working change | Acceptance |
| --- | --- | --- |
| Account sessions | Profile shows aggregate active sign-ins and current expiry. A current-password check allows signing out other sessions while retaining the current one. Counts include the same account's office memberships; no session secrets or device tracking are exposed. | PostgreSQL authorization/concurrency tests, bilingual mobile browser test, hosted synthetic-account checks |
| Credential safety | Login, password change and trusted-channel recovery coordinate on the account row. Password change consumes pending recovery links and revokes other sessions. Sensitive actions recheck the active session after acquiring the lock. | Deterministic stale-password/stale-session race tests, concurrent recovery test, cross-membership invalidation |
| Security audit | Tenant security actions append immutable audit events. Password-confirmed mutations have a bounded per-account attempt budget. | Tenant isolation, immutable audit, CSRF, strict-input and limiter tests |
| Public loading | Public pages use a compact 47-service name catalog. Authenticated workspace/form history and secondary tools load only when needed. Failed module loading offers bilingual recovery. | Canonical catalog parity and built-asset browser request checks; existing complete workflow regressions |
| Backup verification | Encrypted snapshot backup/isolated restore checks now include every application routine, column/default/schema grants, column metadata, indexes, sequences and other database structure. Invalid archives, unsafe targets and consistency errors fail closed. | Safety tests plus real local PostgreSQL dump/restore, row/PDF/ledger/security comparisons |

See [account security](ACCOUNT_SECURITY.md) and [backup and recovery](BACKUP_AND_RECOVERY.md) for exact guarantees and operating instructions. API contracts are recorded in [OpenAPI](../apps/api/openapi.json).

## Verification and deployment

Local verification on 19 October 2026 passed **210/210 tests** (5 backup safety, 72 form, 97 API and 36 web), the production build and a zero-vulnerability dependency audit. After the final navigation/fixture refinements, the focused 8 API, 1 account-browser and 4 production-bundle tests also passed. See [local results](../execution/security-local-qa.json) and [test log](../execution/security-local-qa.log). An initial targeted browser rerun needed its local dev server started; that infrastructure failure and the successful rerun are recorded.

The isolated real PostgreSQL recovery drill passed **17 checks**, comparing 46 tables, 117 synthetic tenants, 435 PDF certificates, 18 application routines, 7 column grants, 94 indexes and 30 tenant-RLS tables. This is local synthetic-data evidence: [restore report](../execution/security-backup-qa.json), [execution log](../execution/security-backup-restore.log).

Public entry JavaScript fell from **990,769 to 352,929 raw bytes** (64.4%) and **143,977 to 96,575 gzip bytes** (32.9%). Four production-bundle tests verify actual public request boundaries, catalog parity, language/login/logout and failed-download recovery. The API is mocked only in those bundle-boundary tests; the complete workflow tests use real local PostgreSQL. [Performance evidence](../execution/security-performance-qa.json).

CI and the exact hosted runtime/deployment will be recorded after those checks complete. Source changes alone do not establish live deployment.

## Scope limits and next work

- The backup drill exercises the local synthetic database and its existing role identities. Hosted full export, independent offsite storage/key custody, cross-host restore, recurring backup alerts and permanent hosting remain open. The current Free PostgreSQL expiry is **12 November 2026**; local backup tests do not protect that hosted data.
- MFA, verified identity/OTP, privileged account recovery, private file quarantine/scanning and durable global owner-audit storage remain open. Owner account actions emit sanitized operational logs; their durable retention is not established.
- Rate limits remain per process. Multi-replica/shared limits are a later operational requirement.
- The authenticated schema/workspace chunk remains larger than 500 KB. Public-page savings do not imply the entire application's total JavaScript became smaller or establish field performance under real mobile networks.
- Existing trusted-channel recovery scope, provider-free demonstration subscriptions/credits, reference evidence gaps and DEMO certificate status remain documented.

The next merchant-independent operational milestone is a complete protected **hosted** export and independent restore, followed by approved durable hosting before expiry. The next account milestone is MFA and privileged recovery with approved identity/security policy. Merchant-specific work resumes only when requested with the required provider access.
