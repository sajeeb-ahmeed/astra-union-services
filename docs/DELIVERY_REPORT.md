# Astra website delivery — release 0.2

13 October 2026 · independently authored software · working local demonstration

The Phase 1 resident-certificate slice has been expanded into a complete website interface and a real 47-service application platform. The public design follows the audited civic layout: green masthead/navigation, Bangla-first text, service tiles, office discovery, sign-in, notices and footer. The authenticated workspace uses a responsive sidebar and role-specific actions. Branding, source, APIs and templates are independently authored.

Phase 0 was not repeated. The curated evidence remains the reference for observed UI/forms, while successful reference-site server behavior remains UNVERIFIED. Testing this implementation does not retroactively verify the reference server or establish legal issuing authority.

## Delivered modules

| Area | Working behavior | Evidence / boundary |
|---|---|---|
| Public portal | Service search/detail, office filters/pagination/availability, notice search/pagination, help/policies, submitted-application tracking, QR verification | Real APIs/database; draft/application identity details excluded from public tracking |
| Accounts | Synthetic citizen self-registration, session login/logout, self profile/password, administrator-assisted one-use recovery | Password hashing, 15-minute recovery, session revocation; no fabricated OTP/NID/BRN integration |
| Citizen/staff | Search/register citizens, create/view/edit/submit own or permitted tenant applications | Server role/tenant scope and immutable payload versions |
| 47-service engine | Current form for each service, bilingual fields, conditions, repeatable family/heir/correction lists, uploads | 93 operational historical versions plus 47 read-only reference previews; 140 stored hashes checked on clean seed |
| Review | Begin review, request reasoned correction, resubmit, approve/reject/cancel | State machine, actor checks and event history |
| Documents | Actual multilingual PDF, QR lookup, protected downloads/reprint, revocation | All 47 issue paths exercised; clearly DEMO, with no government marks or signatures |
| Renewals | Same-service/citizen/tenant successor, latest-source enforcement, cancellation/replacement and re-approval | Composite references, active-successor uniqueness and exactly one new charge; no invented statutory term |
| Information copies | Biodata, holding and witness PDF generation, saved history and safe retry | Private applicant scope; supplied information, no tax assessment/legal attestation |
| Office administration | Office profile, users/roles/activity, explicit demo approval grants, service switches/cost, notices | Audited tenant mutations; cross-tenant/suspended access denied |
| SaaS owner | Provision/suspend offices, balance/subscription overview, reasoned ledger adjustment, support inbox | No direct citizen-content or certificate-issue endpoint access |
| Billing/finance | Persisted sandbox subscription/top-up/order/settlement/invoice, CSV/PDF ledger reports | Integer credits/BDT minor units, HMAC settlement/replay checks, separate unconfigured statutory fees |
| Communications | Persistent feedback, owner resolution, saved newsletter interest, in-app certificate updates/read receipts | Outbound SMS/email delivery not configured or claimed |
| Operations | Built same-origin web serving, compressed/cached assets, runtime guards, health, encrypted local backup/restore | Local execution proven; Docker/CI/hosted infrastructure supplied but unexecuted |

## Architecture and technologies

React 19 + Vite 7.3.7 frontend; TypeScript strict types; Express 5 API; PostgreSQL 17 with restricted app role, FORCE row-level policies, composite tenant keys and transactional workflows. Shared schemas implement validation consistently in UI and API. Playwright Chromium renders escaped application-owned HTML into actual PDFs; QR tokens are cryptographically random. A modular monolith keeps approval, PDF persistence and ledger deduction in one serializable database transaction.

Applications pin schema/version/hash; corrections create new immutable payload rows. Published schema revisions and previously issued PDF bytes are preserved. Current published form coverage maps 340 observed service-specific field occurrences (206 distinct names); the 11 other distinct captured controls belong to common checkout metadata normalized into the independent service/workflow design. Exact initial controls, including 48 forms and 217 distinct named data fields, remain available as read-only evidence previews.

## Testing and quality

`docs/TEST_MATRIX.md` maps the supplied acceptance IDs. Inspectable evidence includes form tests, real PostgreSQL/API tests, browser journeys, clean initialization, PDF/QR QA and recovery logs. `execution/all-services-qa.json` records all 47 locally executed downstream journeys. The clean-database run verifies all migrations, repeated seed, 140 immutable schema hashes, 32 tables and full backend tests.

Tests cover tenant/role attacks, revoked/suspended access, invalid conditions/repeatables, private uploads, corrections, renewal lineage, forged/replayed settlements, insufficient credit, injected transaction failure, concurrent issuance, safe retries, minimal public data and financial UTC boundaries. Browser tests use real API/database interactions, desktop/mobile viewports, labels/error associations and download verification. They do not constitute a full assistive-technology/WCAG certification.

The source is built with strict TypeScript, an optimized production frontend and lazy administration/utility chunks. Static serving negotiates Brotli/gzip and caches hashed assets. Read queries have limits/indexes; PDF work is bounded. `execution/asset-sizes.json` and `performance-smoke.json` contain measurements for this local machine, not production SLAs. The final dependency scan reports zero known vulnerabilities at audit time; it is not a guarantee against future vulnerabilities.

## Security and privacy

Sessions are HttpOnly/SameSiteStrict, Secure in production mode; mutations use Origin and CSRF checks. Request inputs are server-validated. Tenant context comes from active membership, with database RLS/FKs underneath. Password recovery uses hashed opaque expiring tokens, one-use transactions and complete session revocation. Public status responses exclude names, identity values and payloads. PDF rendering blocks remote resources; templates escape text. Headers include CSP/frame restrictions/nosniff/referrer protections. No private reference identities, credentials or government seals are redistributed.

The cached wallet cannot be directly updated by the app role. Issuance locks/rechecks authority, application, subscription and balance; PDF bytes, certificate, ledger, state and audit commit together. Unique constraints make retries return the same certificate without a second debit. Database administrators remain trusted privileged operators; RLS is not a defense against stolen migration/service credentials.

## Known limits

1. Every current service is an independently validated **demonstration workflow**. Domain eligibility, legally approved templates/signatories, actual fees/taxes and lawful official issuance require separate acceptance. Holding service does not implement an unprovided statutory assessment formula.
2. Identity is `SYNTHETIC_DEMO`. No external OTP/NID/BRN/biometric provider is connected. Recovery delivery is manual through a trusted office channel; owner/admin recovery needs an operational process.
3. Billing uses a local signed sandbox with zero commercial prices. Real gateway settlement, refunds/chargebacks, tax invoices and credit-lot expiry/rollover policies are not implemented. Government fees are separate and unconfigured.
4. Uploads are private and size/signature checked, but remain UNSCANNED. Full malware/content sanitization is absent. Citizen/file database storage needs production encryption/key/retention decisions.
5. Email/SMS/newsletter transport, external support integration and platform-wide operational alerting are not connected. In-app notifications and support storage work.
6. Historical forms and PDFs are immutable. Some Bangla ligatures render correctly but have imperfect copy/text extraction in Chromium/Nirmala PDFs. The generic data-driven templates are not a reproduction of unobserved official certificate wording.
7. Local Windows runtime, built-site serving and clean initialization are tested. Docker, Linux deployment, GitHub Actions, HTTPS issuance, distributed rate limiting, full WCAG assessment, offsite recovery and production workload testing remain unverified. Recovery keys kept beside local encrypted backups are a development convenience.
8. The reference's external agency links, exact government brand assets, proprietary content, unseen approval behavior and provider integrations are not copied. Reference-success claims remain UNVERIFIED in the parity matrix.

## Delivery and next milestone

The archive contains original source, dependency lockfile, migrations, sanitized reference handoff, API contract, docs, setup/deployment recipes and synthetic execution evidence. It excludes the private audit, local credentials/keys/database, node_modules and downloaded binaries. `deliverables/WEBSITE_SOURCE_MANIFEST.json` records SHA-256 hashes.

Next milestone: deploy this release to an authorized staging environment, select approved identity/payment/storage/scanning providers and retention/commercial policies, complete domain review of each schema/template, then execute the supplied acceptance matrix on that infrastructure. Official activation requires the relevant office authority; removing DEMO labels alone is not an implementation milestone.
