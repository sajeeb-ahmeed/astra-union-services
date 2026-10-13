# Astra — working citizen-services website

Release 0.2 · 13 October 2026. Independently authored Bangla-first React frontend, Express/TypeScript backend and real PostgreSQL database. The commissioning user owns the original software; third-party licenses are retained separately.

**Open:** [local website](http://127.0.0.1:5173). **Read:** [delivery report](docs/DELIVERY_REPORT.md), [deployment instructions](docs/DEPLOYMENT.md), [acceptance evidence](docs/TEST_MATRIX.md).

This release expands Phase 1 into **47 operational demonstration services**. Every service has been exercised through draft, submission, review, authorized approval, real PDF, QR lookup and exactly one credit debit. These tests prove this independently built implementation. Original reference-site success paths remain unverified. Documents remain DEMO / NOT OFFICIAL; live identity, legal authority and commercial payment-provider integrations are not configured.

## Delivered functionality

- Civic-style responsive public homepage, 47-service discovery, office directory with retained filters/pagination, service availability, searchable notices, help, feedback inbox and saved update preferences.
- Synthetic signup, sessions/logout, own profile/password, office-assisted single-use recovery, protected applications and minimal public status/QR verification.
- All 47 dynamic forms: bilingual fields, conditions, repeatable family/heir/correction rows and private uploads. Historical schema versions remain immutable.
- Citizen/staff applications, search/pagination, corrections, review, approval, rejection, cancellation, issuance, reprint, renewal lineage and revocation.
- Bangla/English/bilingual DEMO PDFs, family/trade tables, QR codes and tenant/citizen-protected downloads.
- Private biodata, holding-information and witness-statement PDFs with persistent history and retry protection.
- Per-office subscription sandbox, top-ups/settlement/invoices, append-only prepaid ledger, finance CSV/PDF reports and compensating adjustments.
- Office settings, staff roles/activity, explicit service approval grants, service enablement/cost and notice publishing.
- Owner tenant creation/suspension, billing summaries and support inbox; no direct citizen-document or issuing permission.
- In-app certificate notifications and persistent read receipts.

## Run on Windows — executed path

Install Node 24, then run from this directory:

```powershell
npm ci --no-audit --no-fund
powershell -ExecutionPolicy Bypass -File scripts/runtime/install-postgres.ps1
powershell -ExecutionPolicy Bypass -File scripts/runtime/start-postgres.ps1
npm run db:migrate
npm run db:seed
npx playwright install chromium
npm run dev
```

Ports: PostgreSQL 55432, API 3001, frontend 5173, all loopback. Generated administrator/restricted app connection strings stay in ignored `.runtime/postgres.json`. No system service/global database is installed. Repeated seed preserves applications/balances and checks schema hashes. After stopping the app, stop the DB with `scripts/runtime/stop-postgres.ps1`.

Local synthetic accounts use **Demo-Phase 1!**:

| Account | Access |
|---|---|
| citizen@alpha.demo.test | Own applications, profile, copies and certificates |
| staff@alpha.demo.test | Register/find citizens and prepare applications |
| reviewer@alpha.demo.test | Review, correction and rejection |
| approver@alpha.demo.test | Granted demo approval, issuance and revocation |
| admin@alpha.demo.test | Office/staff administration and billing |
| finance@alpha.demo.test | Billing, invoices and reports |
| owner@astra.demo.test | Tenant provisioning, adjustments and support |

Equivalent tenant accounts exist at `@beta.demo.test`. Hosted setup uses `db:initialize` and a unique owner password, **not** development seed; see deployment instructions.

## Verify

```powershell
npm run build
npm test
node --import tsx apps/api/scripts/verify-clean-bootstrap.ts
node --import tsx scripts/verify-deployment-bootstrap.ts
node scripts/backup/recovery-drill.mjs
```

Tests create synthetic rows and sandbox payments; use test/development databases. Clean-bootstrap creates a new DB, applies all migrations, seeds twice, verifies every schema hash and runs the entire API suite. Recovery restores into a new DB without dropping the source. `test:web` starts the local stack if necessary.

## Source map

| Folder | Contents |
|---|---|
| apps/web | Responsive React UI, dynamic renderer, browser/renderer tests |
| apps/api | Auth, roles, workflow, billing, management, documents, integration tests and OpenAPI |
| packages/shared-schemas | 47 current schemas, historical versions, sanitized previews and validation |
| db/migrations | PostgreSQL/RLS, immutable history, wallet protection, renewal/recovery |
| scripts | Setup, initialization, backups, QA, compression and packaging |
| deployment | HTTPS reverse-proxy example |
| docs | Specifications, deployment, evidence and limitations |
| execution | Actual synthetic logs, screenshots, PDFs and measurements |
| handoff | Nine curated reference files; private audit excluded |

Docker/Compose and GitHub Actions recipes are included. Docker is unavailable on this host: container execution and hosted CI remain **unverified**. Built frontend serving, compression, clean initialization and configuration safeguards were tested locally.

## Limits

This is working demonstration software, not an authorized government service. External OTP/NID/BRN, live payment settlement, official signatures/templates/fees, malware scanning, outbound email/SMS, production retention/key management and infrastructure acceptance remain integration work. Full WCAG/screen-reader and production load assessments are not claimed. See the delivery report for the next milestone.

Ownership: [LICENSE](LICENSE). Dependencies/fonts: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
