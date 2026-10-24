# Astra Union Services

Attachment quarantine and PC malware scanner: [0.9 notes](docs/RELEASE_0_9.md) · [operator runbook](docs/ATTACHMENT_SCANNER_RUNTIME.md). Hosted status is recorded separately; source version alone does not establish deployment.

Release **0.9.0 is live**, verified 24 October 2026. Independently authored Bangla/English React frontend, Express/TypeScript backend and real PostgreSQL. The commissioning user owns the original software; third-party licenses are retained separately.

## Attachment protection and verified release

Private uploads enter quarantine and cannot be downloaded or used for submission, approval or new issuance before a clean scan. The actual ClamAV worker on the owner’s PC released a clean test PDF and rejected the harmless antivirus fixture. Bangla/English scan status, authorized retry and tenant isolation are implemented. **293 CI tests, 25 live API groups, 8 bilingual/mobile browser groups and 9 deployed asset hashes passed.** Separate real-engine and full scanner-workflow checks passed 5/5 and 8/8; production/Docker builds and a zero-vulnerability audit passed. Runtime `9aadc93b29cbc76a669db4ffa1c37a2f4f220528`.

**Keep the PC awake and online with the scanner/worker running.** Files wait quarantined while it is unavailable. After Windows restarts, run the startup command in the [operator runbook](docs/ATTACHMENT_SCANNER_RUNTIME.md); no automatic startup task was installed. Earlier optional MFA/account-security and verified encrypted backup/restore remain available. The existing backup predates migration 015 and the new scanner fixtures.

[Live website](https://astra-union-services.onrender.com/) · [Release results](docs/RELEASE_0_9.md) · [Bangla status and next steps](docs/STATUS_AND_NEXT_STEPS.md) · [Deployment instructions](docs/DEPLOYMENT.md) · [Recovery runbook](docs/MANAGED_RECOVERY.md).

Payment collection remains disabled and certificates remain DEMO / NOT OFFICIAL. Backup is local-only by owner choice; offsite/key custody and durable hosting before **12 November 2026** remain open. The next unblocked milestone is operational monitoring, scanner queue-age alerts and shared rate limiting. Attachment retention and always-on scanner hosting remain owner decisions. Historical release sections below retain their original scope and measurements.

## Release 0.7 usability — historical

- Start from role-specific daily tasks; use the mobile page picker, simpler application search and clear filters.
- Follow citizen/service/form steps, readable validation links and state-specific guidance for drafts, corrections, approval, fee verification and certificate downloads.
- Find services with Bangla or English names/numerals; open focused service details instead of scrolling past all 47 cards. Homepage shortcuts reach application tracking and certificate verification.
- Show or hide the login password with a keyboard-accessible bilingual control; submission masks it and sign-out clears the fields.

Runtime `56fb7f56bd77cfde2887a52384d3a9b4706a421e` passed **49/49 local web tests**, typecheck and the production build. [CI run 39552222856](https://github.com/sajeeb-ahmeed/astra-union-services/actions/runs/39552222856) passed **223/223 tests** (5 backup, 72 forms, 97 API, 49 web), production/Docker builds and a zero-vulnerability audit. Render deployment `dep-dbc596mi0phs73aeldug` finished live on **21 October 2026 at 12:01:21 Asia/Dhaka**. **22 hosted API groups, eight live browser groups and all eight deployed JS/CSS asset hashes passed**. See [0.7 release notes](docs/RELEASE_0_7.md), [local test evidence](execution/usability-local-qa.json) and [live acceptance](execution/usability-live-release.json). Gateway work remains deferred. Hosted backup/independent restore, MFA, file scanning and durable hosting before **12 November 2026** remain open.

## Historical 0.6 baseline

**0.6 · merchant-independent work:** own-session controls, password/recovery race protection, lighter public-page loading and stronger encrypted local recovery are implemented. **210 local and 210 CI tests passed** (5 backup, 72 forms, 97 API, 36 web), plus 17 separate local database recovery checks. Runtime `402903fb113799f5d7e5ec8d62307ba88f625318` passed [CI run 39199410740](https://github.com/sajeeb-ahmeed/astra-union-services/actions/runs/39199410740), its Docker build and dependency audit. Render deployment `dep-dbappb8m7kps739q5ivg` finished live at `2026-10-19T04:31:36.05317Z`; the exact runtime was reconfirmed on 21 October. **22 hosted API groups, five live browser groups and all seven deployed JS/CSS asset hashes passed.** [Release evidence](docs/RELEASE_0_6.md). Payment onboarding/activation is deferred at the owner's request.

The first CI attempt caught an environment-dependent development React bundle exceeding the public-size budget. Production-build configuration was corrected without weakening that budget; four focused tests passed with the same `NODE_ENV=test` environment. [CI attempt history](execution/security-ci-attempts.json) records the failed attempt and correction.

**পরে কাজ চালিয়ে যাওয়ার নোট:** [বর্তমান অবস্থা, সম্পন্ন কাজ, bKash onboarding ও পরবর্তী করণীয়](docs/STATUS_AND_NEXT_STEPS.md)। Engineering priorities and acceptance criteria: [current delivery backlog](docs/DELIVERY_BACKLOG.md).

**Open:** [live demo](https://astra-union-services.onrender.com) or [local website](http://127.0.0.1:5173). **Read:** [hosted deployment and live test results](docs/HOSTED_DEPLOYMENT.md), [delivery report](docs/DELIVERY_REPORT.md), [deployment instructions](docs/DEPLOYMENT.md), [acceptance evidence](docs/TEST_MATRIX.md).

The 0.6 release ran on the same Render Free/PostgreSQL 17 service. Its hosted checks passed: **four account-security, seven payment, six historical-record readback and five geography groups**. Existing PDF bytes and credit records remained unchanged. Five live browser groups and seven JS/CSS asset hashes passed at that milestone. See [historical 0.6 live results](execution/security-live-release.json); historical 0.7 acceptance is recorded above. The Free database expires on **12 November 2026**, and the web service can sleep when idle. Live identity and merchant payment collection remain unconfigured.

This release expands Phase 1 into **47 operational demonstration services**. Every service has been exercised through draft, submission, review, authorized approval, real PDF, QR lookup and exactly one credit debit. These tests prove this independently built implementation. Original reference-site success paths remain unverified. Documents remain DEMO / NOT OFFICIAL; live identity, legal authority and commercial payment-provider integrations are not configured.

## 0.6 security, performance and recovery

- **My profile / Account security → Account sessions:** see own active-session counts and expiry; confirm the current password to sign out other sessions. Password changes also invalidate earlier recovery links across memberships. Account locks prevent stale-password and revoked-session races. Bangla/English controls work for citizen, office and owner accounts. [Account security](docs/ACCOUNT_SECURITY.md).
- Public JavaScript falls from **990,769 to 352,929 bytes (64.4%)**; gzip falls from 143,977 to 96,575 bytes. All 47 public services remain available; the authenticated workspace/form schemas load after a valid session, with bilingual loading/error recovery. This measures build size, not field page-load time. [Performance evidence](execution/security-performance-qa.json).
- Format-2 encrypted recovery verifies all application routines, narrow column grants, indexes and RLS behavior, plus real data/PDF/ledger hashes. The local drill restored 46 tables, 117 synthetic tenants and 435 PDFs into a new database. [Recovery runbook and limits](docs/BACKUP_AND_RECOVERY.md), [local test results](execution/security-local-qa.json).

No database migration or merchant credentials are needed for this increment. **Hosted full export, independent offsite restore and durable hosting before the recorded 12 November expiry remain the next operational priority.** MFA, privileged-account recovery, file quarantine/scanning and external identity verification remain open. Local encrypted archives do not establish hosted disaster recovery.

## Historical 0.5 payment update

The deployed module includes bKash v2 checkout, server verification, immutable payment receipts and transaction reconciliation. Merchant access is not available, so checkout stays disabled; no real money or provider-sandbox transaction is claimed. Nagad and bank payout reconciliation are not connected. The release preserves independent approver authorization and SaaS credit accounting. See [0.5 implementation and verification](docs/RELEASE_0_5.md) and [gateway configuration and recovery limits](docs/GATEWAY_PAYMENTS.md).

The final 0.5 runtime passed **192 Linux CI tests** (72 forms, 89 API, 31 web), its production and Docker builds, and a dependency audit with **zero vulnerabilities**. [Run 39125266096](https://github.com/sajeeb-ahmeed/astra-union-services/actions/runs/39125266096) tested commit `b86908b9a4654cc31cd1b517fc5e8ad3ae086878`, previously deployed as Render deployment `dep-dbaob6s9v7es739a8j30`. Hosted checks verified disabled checkout, empty collections, access restrictions and unchanged application/PDF/credit records.

## Historical 0.4 order workflow

Release 0.4 added citizen-first blank applications, exact Astra application/certificate lookup, per-office/service statutory and processing fee policies, permitted language/delivery/urgency choices, and immutable server-calculated assessments. Separate approver authorization and SaaS credits remain in force. At that milestone positive citizen-fee totals blocked issuance; 0.5 now requires verified gateway evidence and a receipt, with collection still disabled pending merchant setup.

Its local and Linux CI verification passed **162 tests** (72 form, 63 API and 27 web); the Docker build and dependency audit passed with **zero vulnerabilities**. Eleven additional local managed PostgreSQL compatibility groups passed. Commit `de8a0c3` was deployed as `dep-db9jt9m1egvs73fi5bbg`; its entry asset hashes matched the tested build. Hosted QA used a new synthetic office and did not configure tariffs in existing offices. Its Chrome checks passed for Bangla/English fees, mobile layout, blank citizen-first intake and quote acceptance gating, with no console warnings/errors. See [0.4 release evidence](docs/RELEASE_0_4.md), [order workflow](docs/ORDER_WORKFLOW.md), [process parity and remaining gaps](docs/PROCESS_PARITY.md), and [OpenAPI](apps/api/openapi.json).

## Geography and language update

Release 0.3 adds the supplied Bangladesh hierarchy: **8 divisions, 64 districts, 495 upazilas, 4,586 unions and 41,274 derived rural wards**. Public registration, staff citizen entry, profiles, office onboarding and directory filters use validated parent-linked records stored in PostgreSQL. Geographic coverage and actual participating offices remain distinct. Existing domain records remain compatible.

The interface uses a restrained responsive design and a persistent **বাংলা / English** switch across public pages and role-based workspaces. Form labels, navigation, messages and service titles follow the selected language; API identifiers and saved inputs retain their original values. Read [geography provenance and integration](docs/GEOGRAPHY_INTEGRATION.md) and [language/UI guide](docs/LANGUAGE_AND_UI.md).

The community dataset is not an official current national register. Ward numbers are derived; city-corporation and municipality wards are excluded. Government identity, official issuance and commercial payments remain separate integrations.

## Delivered functionality

- Civic-style responsive public homepage, 47-service discovery, office directory with retained filters/pagination, service availability, searchable notices, help, feedback inbox and saved update preferences.
- Synthetic signup, sessions/logout, own profile/password, office-assisted single-use recovery, protected applications and minimal public status/QR verification; 0.6 adds deployed own-session controls and credential-race protection.
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
# Synthetic local development key only; never use this value on a hosted service.
$env:MFA_ENCRYPTION_KEY = ('1' * 64)
npm run dev
```

Ports: PostgreSQL 55432, API 3001, frontend 5173, all loopback. Generated administrator/restricted app connection strings stay in ignored `.runtime/postgres.json`. No system service/global database is installed. Repeated seed preserves applications/balances and checks schema hashes. After stopping the app, stop the DB with `scripts/runtime/stop-postgres.ps1`.

Local synthetic accounts use **Demo-Phase1!**:

| Account                  | Access                                             |
| ------------------------ | -------------------------------------------------- |
| citizen@alpha.demo.test  | Own applications, profile, copies and certificates |
| staff@alpha.demo.test    | Register/find citizens and prepare applications    |
| reviewer@alpha.demo.test | Review, correction and rejection                   |
| approver@alpha.demo.test | Granted demo approval, issuance and revocation     |
| admin@alpha.demo.test    | Office/staff administration and billing            |
| finance@alpha.demo.test  | Billing, invoices and reports                      |
| owner@astra.demo.test    | Tenant provisioning, adjustments and support       |

Equivalent tenant accounts exist at `@beta.demo.test`. Hosted setup uses `db:initialize` and a unique owner password, **not** development seed; see deployment instructions.

## Verify

Use the same synthetic key in the test terminal. If an API/dev stack is already running without it, stop that stack and restart it with the key before testing; the web runner reuses an existing local API. A hosted deployment requires its own stable secret and protected recovery copy.

```powershell
$env:MFA_ENCRYPTION_KEY = ('1' * 64)
npm run build
npm test
node --import tsx apps/api/scripts/verify-clean-bootstrap.ts
node --import tsx scripts/verify-deployment-bootstrap.ts
node scripts/backup/recovery-drill.mjs
```

Tests create synthetic rows and sandbox payments; use test/development databases. Clean-bootstrap creates a new DB, applies all migrations, seeds twice, verifies every schema hash and runs the entire API suite. Recovery restores into a new DB without dropping the source. `test:web` starts the local stack if necessary.

## Source map

| Folder                  | Contents                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------ |
| apps/web                | Responsive React UI, dynamic renderer, browser/renderer tests                        |
| apps/api                | Auth, roles, workflow, billing, management, documents, integration tests and OpenAPI |
| packages/shared-schemas | 47 current schemas, historical versions, sanitized previews and validation           |
| db/migrations           | PostgreSQL/RLS, immutable history, wallet protection, renewal/recovery               |
| scripts                 | Setup, initialization, backups, QA, compression and packaging                        |
| deployment              | HTTPS reverse-proxy example                                                          |
| docs                    | Specifications, deployment, evidence and limitations                                 |
| execution               | Actual synthetic logs, screenshots, PDFs and measurements                            |
| handoff                 | Nine curated reference files; private audit excluded                                 |

The Docker image was built and deployed successfully on Render. GitHub Actions application verification and the separate Docker build job passed. Docker/Compose remains an alternative deployment recipe; Compose execution was not performed on this Windows host. See the [hosted deployment record](docs/HOSTED_DEPLOYMENT.md) for deployed commits, CI links, live evidence, update procedures, and hosting limits.

## Limits

This is working demonstration software, not an authorized government service. External OTP/NID/BRN, live payment settlement, official signatures/templates/fees, always-on scanner operations and attachment retention, outbound email/SMS, production retention/key management and infrastructure acceptance remain integration work. Full WCAG/screen-reader and production load assessments are not claimed. See the delivery report for the next milestone.

Ownership: [LICENSE](LICENSE). Dependencies/fonts: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
