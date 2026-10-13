# Acceptance matrix — release 0.2

13 October 2026. PASS means the independently built local DEMO behavior was executed. It never verifies Prottoyon's unseen server behavior or legal production authority. All tests use synthetic records.

| ID | Current result | Executed evidence / limit |
|---|---|---|
| TEN-01 / TEN-02 | PASS | Real PostgreSQL RLS, API role scope, foreign UUID/tenant tampering and composite-key rejection |
| AUTH-01 | PASS | Citizen/staff/reviewer/approver/admin/finance/owner action matrix; explicit service-specific grants |
| AUTH-02 | PASS | User/membership/tenant suspension checked on existing sessions; denied sensitive actions |
| REG-01 | PARTIAL | Real self-registration persists user/membership/profile/audit. Identity remains SYNTHETIC_DEMO; lawful external verification is not integrated |
| CIT-01 | PASS | Staff register/search, duplicate handling, calendar dates; real browser/API |
| FOR-01 | PASS | All 47 current forms and 48 initial reference previews; exact observed-name mapping retained; actual 47 database saves and issuance |
| FOR-02 | PASS | Conditional, bilingual, date, number, nested/repeatable, declarations, invalid/unknown/inactive fields; UI associated errors |
| FOR-03 | PARTIAL | 2 MiB limit, MIME signature/end markers, ownership, private download and malformed handle rejection pass. No deep malware/active-content scanner |
| APP-01 | PASS | Draft→submit→review→correction→resubmit→approve, immutable payload/event history; browser + API |
| APP-02 | PASS | GET lookup/preview does not create/update applications, charges or print requests |
| APP-03 | PASS | Cross-tenant approval denial/audit, staff/owner issue denial |
| APP-04 | PASS | Saved values and pinned schema survive reopening and correction; historical schemas preserved |
| CER-01 | PASS (DEMO) | Real #45 BN/EN/bilingual PDF + 47 service-specific payload PDFs generated after review/approval |
| CER-02 / PUB-02 | PASS | Decoded opaque QR; exact minimal public fields; invalid tokens return safe errors |
| CER-03 | PASS | Revoked status immediately visible through existing verification token |
| CER-04 | PASS | Role, current membership and service authority rechecked at issuance commit |
| CER-05 | PASS (DEMO) | General/trade renewal same-tenant/service/citizen lineage, latest-source and one-active-successor rules, cancellation/replacement, retry-safe new issue |
| WAL-01 | PASS | One atomic issued document and one charge for each of 47 services |
| WAL-02 | PASS | Eight concurrent requests, retries and renewal retry produce one certificate/charge |
| WAL-03 | PASS | Insufficient balance retains approved application without partial issuance/debit |
| WAL-04 | PASS | Injected failure after ledger insert rolls back certificate/debit/state/audit |
| WAL-05 | PASS (sandbox) | HMAC, exact amount/currency, event replay and no duplicate credit; live provider not configured |
| WAL-06 | PASS | Reasoned append-only compensating entries; direct wallet update denied |
| BILL-01 | PASS (sandbox) | Subscription/top-up orders, settlement, credits and immutable invoice; invoice/report PDF and CSV |
| BILL-02 | PARTIAL | SaaS ledger/invoices and government-fee table/report flag stay separate. Statutory assessment/collection is unconfigured |
| PUB-01 | PASS | Directory filter/page 2 retained in URL; server-filtered counts and active offices, notice search/pagination |
| UX-01 | PARTIAL | Desktop/mobile no-overflow, labels, field/group errors, keyboard and browser smoke pass. Full screen-reader/contrast audit not completed |
| OPS-01 | PASS (local DB) | Empty generated PostgreSQL database: all migrations, repeat seed, 32 tables, 140 schema hashes, 13 fixture users, 2 tenants and complete backend suite. Clean OS/Linux/containers unverified |
| OPS-02 | PASS (local recovery) | Authenticated encrypted dump, isolated restore, row/hash/schema/RLS/ledger/PDF verification. Offsite/key custody/recovery SLA not tested |
| SEC-01 | PASS (package scope) | Runtime secret scan and excluded private audit/runtime; seeded account passwords are intentional local fixtures. Production log/secret operations remain deployment work |
| SEC-02 | PASS | Citizen/application/attachment/renewal/copy/notice/membership/recovery IDs tested across tenants and roles |

## Additional executed checks

- All 47 operational schemas have valid/invalid tests; family/trade v1 hashes remain unchanged with new v2 forms. Manifest pins 93 immutable operational versions.
- Administrator-assisted recovery: role/tenant eligibility, token expiry/replay, old-session revocation and no fake outbound delivery.
- Office provisioning/configuration, membership grants/suspension, draft/published notices and owner restrictions.
- Private biodata/holding/witness PDFs, idempotency keys, history filters and unauthorized-download denial.
- Profile fields cannot set email/role/tenant; audit metadata omits profile values.
- In-app notifications are applicant/tenant scoped and read receipts idempotent.
- Finance CSV/PDF date ranges use explicit UTC boundaries, independently of PostgreSQL server timezone.
- Public application tracking hides drafts and returns only status/office/service/date/demo.
- Security headers, Origin rejection, bounded rate limiter, Retry-After/expiry and production environment guards.
- Built SPA supports gzip/Brotli/immutable assets; unknown API paths never fall through to HTML.
- Clean non-fixture initialization repeated twice produces one unique owner and 47 services with no sample citizen/office data.

## Evidence index

| Artifact | Purpose |
|---|---|
| execution/forms-current.log | 72 form/schema cases |
| execution/clean-bootstrap.log | Fresh database, seed/hash proof and 40 API/security/static-delivery tests |
| execution/all-services-qa.json | 47 actual issue journeys and PDF sizes |
| execution/frontend-expanded.log | Final browser/renderer suite (see exact counts in log) |
| execution/deployment-bootstrap.log | Unique-owner initialization, repeated safely |
| execution/pdf-qa.json / expanded-pdf-qa.json | Parsed/rendered PDF language/output checks |
| execution/qr-qa.json | Actual raster QR decoding and minimal public lookup |
| execution/backup-restore.log | Encrypted recovery drill |
| execution/asset-sizes.json / performance-smoke.json | Built assets and local performance smoke |
| execution/dependency-audit.json | Dependency advisory result at delivery time |
| execution/screenshots | Synthetic desktop/mobile and workflow evidence |

Repeated runs of the same cases on a new database are reproducibility evidence, not extra unique tests. Docker/CI configuration files do not count as executed hosted tests.
