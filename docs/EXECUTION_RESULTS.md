# Release 0.2 — execution results

**History notice · 17 October 2026:** this page retains release 0.2 results. For source 0.4.0, see [current local verification](RELEASE_0_4.md): 162 tests and 11 managed PostgreSQL groups passed; hosted migration/deployment remains pending. The 0.3 hosted record is maintained separately in [HOSTED_DEPLOYMENT.md](HOSTED_DEPLOYMENT.md).

Executed on 13 October 2026, Windows, Node 24.18.0/npm 10.9.8, PostgreSQL 17.11 and Playwright Chromium. All records and payments are synthetic. Phase 0 was not repeated. Tests establish this independently authored system's behavior, not the reference website's unobserved server behavior.

## Verified release

**129 tests passed, zero failures:** 72 shared form/schema tests, 40 API/database/security/static-serving tests, and 17 frontend tests (nine real browser journeys and eight renderer tests). Repeating the API cases on a fresh database is reproducibility evidence, not another 40 unique tests.

| Execution | Actual result | Evidence |
|---|---|---|
| Shared forms | 72/72; 47 current forms, immutable historical hashes, conditions, repeatables, attachment metadata, exact sanitized reference reconciliation | [forms-current.log](../execution/forms-current.log) |
| API and PostgreSQL | 40/40; real transactions and HTTP, all 47 service workflows, authorization, billing, renewal, recovery, documents and security | [clean-bootstrap.log](../execution/clean-bootstrap.log) |
| Browser and renderer | 17/17; desktop and mobile, genuine database interactions and downloads | [frontend-expanded.log](../execution/frontend-expanded.log), [summary](../execution/frontend-qa-summary.json) |
| Build | Strict TypeScript and Vite production build, exit 0; gzip/Brotli assets generated | [build-current.log](../execution/build-current.log) |
| Clean bootstrap | Seven migrations, 32 tables, 47 services, 13 fixture users, two fixture offices; repeat seed preserves one grant per office; all 140 stored schema hashes match | [clean-bootstrap.log](../execution/clean-bootstrap.log) |
| Deployment initialization | Empty local database, restricted app role, migrations and initializer twice; one unique owner, 47 services, zero sample citizens/offices | [deployment-bootstrap.log](../execution/deployment-bootstrap.log) |
| PDF output | Actual issued template-4 resident documents in three languages; family/trade/renewal samples fit one page; private copies, report and invoice PDFs rendered | [pdf-qa.json](../execution/pdf-qa.json), [expanded-pdf-qa.json](../execution/expanded-pdf-qa.json) |
| QR | Rasterized browser certificate QR decoded, URL matched, live local lookup returned minimal issued status with a 256-bit token | [qr-qa.json](../execution/qr-qa.json) |
| Recovery | Encrypted consistent snapshot restored to a new database; 32 tables, 17 tenants, 184 PDF hashes, seven migrations, 617 total credits; RLS/grants/triggers, corruption/wrong-key/unsafe-target checks passed | [backup-restore.log](../execution/backup-restore.log) |
| Performance smoke | Built site, no page errors or horizontal overflow at 1440×1024 and 390×844; 100 directory reads at concurrency 10: median 12 ms, p95 121 ms | [performance-smoke.json](../execution/performance-smoke.json) |
| Dependencies | Zero known advisories reported at scan time | [dependency-audit.json](../execution/dependency-audit.json) |

The browser suite exercises draft, submission, staff visibility, correction, resubmission, authorized approval, issuance, PDF download, public verification, safe retry, family/trade validation, private uploads, sandbox settlement, citizen registration, owner adjustments, directory pagination, notices, account recovery, new-service creation, renewal, public tracking, profile changes, private copies and financial exports. Screenshots are in [execution/screenshots](../execution/screenshots/).

`all-services-qa.json` records 47 locally executed issue journeys. Their current form versions are v2 except resident service #45, which retains v1. All operational history (93 versions) plus 47 exact reference previews remains immutable. Template 4 is used for newly issued certificates; older stored PDFs are preserved.

## Invariants demonstrated

- An eight-way issuance race returns one certificate and one credit debit. Retry and reprint do not charge again.
- Insufficient credit, expired subscription, revoked authority and an injected failure after debit leave no partially committed issuance.
- The restricted database account cannot directly update the wallet or mutate the append-only ledger. Tenant RLS, composite keys, role checks and ownership checks reject cross-tenant access.
- Renewal preserves tenant/citizen/service lineage, permits one active successor, requires fresh review and incurs one new charge only upon issuance.
- Signed sandbox settlement rejects tampering/replay and separates subscription money, prepaid credit and unconfigured statutory fees.
- Recovery tokens expire, are hashed at rest, are consumed once, and invalidate old sessions. Drafts and citizen identity are excluded from public tracking.
- Finance date boundaries use UTC even when the database session timezone changes. Protected PDF routes enforce scope; support/newsletter data is persisted without claiming email delivery.

## Findings repaired during QA

The release fixes accessible select labels, directory/notice pagination, public draft visibility expectations, UTC report boundaries, immutable schema version publication, production configuration checks, compressed asset delivery and PDF pagination. Template 4 keeps short family/trade declarations and QR footers together. Browser startup failures/disconnections can be retried without retaining a rejected renderer promise. Vite was patched to 7.3.7 after dependency review.

Final independent review also found and fixed partial profile edits clearing omitted fields, mixed-case URL rate-limit bypasses, and missing exact proxy trust in the Docker recipe. Regression assertions prove omitted profile values survive while explicit empty strings clear them; six focused hardening tests exercise mixed-case requests, trusted and untrusted forwarded headers, independent client buckets and configuration rejection. The full clean-database API suite was rerun after these repairs. See [profile-regression.log](../execution/profile-regression.log) and [http-hardening-final.log](../execution/http-hardening-final.log).

The main bundle is approximately 860 KB before compression because it includes the form catalog/history, 116 KB with gzip and 91 KB with Brotli. Vite reports a chunk-size warning; administration and utility screens are separate chunks. Local first-contentful-paint readings were 300 ms desktop and 104 ms mobile with roughly 126 KB transferred. These loopback measurements are smoke checks, not production Core Web Vitals or a capacity SLA. Further schema loading splits are a valid future optimization.

## Evidence interpretation and limits

Current result files are the ones linked above. Older Phase 1 logs and sample files are retained as historical evidence in the workspace; the release package includes current evidence only. Clean-database certificate samples belong to the isolated database identified in the clean-bootstrap log; their QR tokens will resolve only against that database. The browser QR sample belongs to the running main demonstration database. The separate `template-v4-layout-*` proofs are unregistered synthetic layout fixtures, not issued certificates.

The database recovery counts describe the exact snapshot taken at the time of the drill. Later tests add synthetic records. Records are not deleted to make counts match.

Original reference success paths, lawful official authority, external OTP/NID/BRN, live gateway settlement, statutory fees/templates/signatures, malware scanning, outbound email/SMS, full WCAG review, Linux/Docker/hosted CI, production load, offsite key custody and full infrastructure recovery remain unverified or unimplemented. Some Bangla ligatures render correctly but have imperfect PDF text extraction. See [DELIVERY_REPORT.md](DELIVERY_REPORT.md) for the complete limits and next milestone.

## Reproduction

```powershell
npm run build
npm test
node --import tsx apps/api/scripts/verify-clean-bootstrap.ts
node --import tsx scripts/verify-deployment-bootstrap.ts
node scripts/backup/recovery-drill.mjs
node --import tsx scripts/performance-smoke.ts
python scripts/pdf-qa.py
node --import tsx scripts/qr-qa.ts
```

PDF QA requires `pypdf` and `pypdfium2`; this host used its bundled Python. Run browser tests before QR QA to create the browser certificate and keep the local app running for verification. Tests create synthetic data and belong in development/test databases. Clean-bootstrap and recovery retain isolated databases for inspection without dropping or replacing the main database. Runtime credentials, keys, encrypted backups and private reference data are excluded from the source package.
