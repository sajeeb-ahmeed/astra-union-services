# Public Data Retention — feedback & subscriptions (S-015)

- **Date:** 2026-11-26 (Phase 4 Stage 5 Batch B)
- **Code:** `apps/api/src/portal-tools.ts` (budgets + purge endpoint),
  `db/migrations/080_public_data_purge_delete.sql` (DELETE grant).

## Why this exists

`POST /api/v1/public/feedback` and `POST /api/v1/public/subscribe` are
unauthenticated writes that store PII (name, email, message) with no
expiry. The register (S-015) records them as postable at 60/min/IP with
no retention/disposal policy stated.

## Abuse budget

- **10 writes per IP per hour, per endpoint** (feedback and subscribe
  have separate budgets), enforced by the shared DB-backed limiter
  (`rate_limit_buckets`, same store as S-004) on top of the existing
  60/min per-IP mutation limiter in `http-hardening.ts`. A shared budget
  survives restarts and multi-process deploys; the in-memory fallback
  applies only when the DB check cannot run.
- The 11th write in an hour gets `429 RATE_LIMIT` with `Retry-After`.

## CAPTCHA: OWNER DECISION REQUIRED (not implemented)

No CAPTCHA provider exists anywhere in this stack, and Stage 1 already
records S-006 (per-number throttling / CAPTCHA on verify/track) as an
open owner decision: choosing a provider, its keys, its privacy impact,
and its failure mode (what happens when the provider is unreachable) is
an owner call, not an engineering default. **Do not invent or integrate
a CAPTCHA provider in a fix batch.** The 10/hour budget above is the
abuse control that is safe to ship without one; it bounds spam volume
but does not prove humanness, and that limitation is stated here
plainly.

## Retention policy (decided for this batch)

| Table | Rule |
|---|---|
| `support_requests` | A `RESOLVED` row is eligible 90 days after `resolved_at`. Any row — even still `OPEN` — is eligible 2 years after `created_at` (stale / unactioned). An `OPEN` row younger than 2 years is never purged. |
| `subscriptions_interest` | Eligible 12 months after `consent_at`. |

## Purge

- `POST /api/v1/owner/public-data/purge`, owner only, body
  `{dryRun?: boolean}` (default `false`).
- `dryRun: true` reports `{eligible, purged: {supportRequests: 0,
  subscriptions: 0}}` without deleting anything.
- A real purge returns `{eligible, purged, policy}` and writes a
  `PUBLIC_DATA_PURGED` row (with the counts) to the durable platform
  audit stream (S-014), so a deletion is always attributable.
- **The purge is manual and operator-run only. Automatic silent
  deletion is OWNER DECISION REQUIRED** and is not implemented: an
  automatic job could delete an `OPEN` request the owner had not yet
  read (the 2-year stale rule exists precisely because such rows are
  unactioned, and the owner should see the counts before they go).
- The app role needed a DELETE grant on both tables (migration 074;
  migration 006 gave SELECT/INSERT/UPDATE only). The purge endpoint is
  the only DELETE path on these tables.
