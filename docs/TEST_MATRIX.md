# Acceptance matrix and evidence boundaries

## Release 0.8 acceptance scope

Frozen-source local verification passed **252/252 cases** (15 backup, 72 forms, 112 API, 53 web), production build, typecheck and a zero-vulnerability dependency audit. An additional **22-check independent managed recovery rehearsal** restored 49 tables, two synthetic tenants and two actual PDFs, including real HTTP startup. These counts do not include duplicate focused reruns. [Local evidence](../execution/recovery-mfa-local-qa.json), [recovery rehearsal](../execution/managed-recovery-local-qa.json), [release status](RELEASE_0_8.md).

Final runtime `695942dff49f088ad7862718ba32192d0a8011c2` also passed **255/255 Linux CI cases** (18 backup, 72 forms, 112 API, 53 web). The three additional backup regressions passed locally. Hosted migration passed four groups, actual hosted restore passed 8 SQL plus 6 HTTP groups, and live acceptance passed **29 API + 6 browser groups + 9 asset hashes**. [Live evidence](../execution/recovery-mfa-live-release.json). Source locale was absent from the snapshot; local restore is not cutover approval.

| Area               | Executed acceptance                                                                                                                                                                                                         | Boundary                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| MFA                | Password-confirmed pending enrollment, real TOTP activation/login, no cookie before factor, wrong/expired/replayed code denial, one-use recovery, rotation/disable, concurrent redemption, account/office/revision rechecks | Synthetic PostgreSQL/API fixtures; no privileged assisted reset or compulsory enrollment              |
| Account history    | Account-scoped reads, owner events, restricted grants and immutable history                                                                                                                                                 | Service-context RLS; no independent external audit store or cross-account review console              |
| Browser            | Real factor/recovery journey, BN/EN mobile, keyboard labels, unavailable configuration, navigation and delayed-response/pagehide secret clearing                                                                            | Local Chromium; not full WCAG/screen-reader certification                                             |
| Managed export     | All tenant/account scopes, nullable global rows exactly once, source read-only, canonical-policy and completeness checks, encrypted authenticated archive                                                                   | Strict supported schema; unknown security topology fails closed                                       |
| Restore            | Tamper/wrong-key rejection before connection, new cluster, fresh restricted role passwords, exact data/security/owner/PDF/ledger match, real server/login/PDF/QR acceptance                                                 | Independent local cluster; not offsite or infrastructure/key-escrow recovery                          |
| Audit completeness | Hidden NULL tenant audit rows cause migration 014 to fail; valid histories remain unchanged                                                                                                                                 | Isolated temporary test tables; hosted migration passed its separate four-group preservation evidence |

## Release 0.7 acceptance scope — historical

Runtime `56fb7f56bd77cfde2887a52384d3a9b4706a421e` passed **49/49 local web tests**, typecheck and the production build on 21 October 2026. [CI 39552222856](https://github.com/sajeeb-ahmeed/astra-union-services/actions/runs/39552222856) passed **223/223 cases** (5 backup, 72 forms, 97 API, 49 web), production/Docker builds and a zero-vulnerability audit. Render deployment `dep-dbc596mi0phs73aeldug` finished live at `2026-10-21T06:01:21.514444Z`; **22 hosted API groups, eight live browser groups and eight deployed JS/CSS asset hashes passed**. [Live acceptance](../execution/usability-live-release.json).

| ID    | Executed usability coverage                                                                                                                            | Evidence boundary                                                                             |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| UX-03 | Role-specific task entry, mobile page picker, bilingual search/filter retention, readable validation summary and field focus, draft-to-submit guidance | Real local browser/API/PostgreSQL workflows; navigation does not grant additional permissions |
| UX-04 | Draft, correction, review, approval, fee-verification, issuance, revoked/rejected/cancelled guidance                                                   | Guidance uses server state and is read-only; approval is not payment or issuance              |
| UX-05 | Public tracking/verification shortcuts, Bangla-digit search, empty-result recovery, focused selected-service details and return to catalog             | All 47 catalog entries retained; local mobile/bilingual browser checks                        |
| UX-06 | Keyboard password visibility toggle does not submit; login and logout preserve masking/empty-field behavior                                            | Local synthetic account; no account/authentication policy changed                             |

Evidence: [local summary](../execution/usability-local-qa.json), [web test log](../execution/usability-web-tests.log), [release notes](RELEASE_0_7.md). The 49-test web suite includes earlier regressions; focused reruns are not extra unique tests. Local results alone do not prove hosted deployment. These checks are not a complete WCAG audit, user study or field-performance measurement.

Hosted acceptance separately passed [four security groups](../execution/usability-hosted-security.json), [seven disabled-payment groups](../execution/usability-hosted-payments.json), [six preserved-record readback groups](../execution/usability-hosted-readback.json) and [five geography groups](../execution/usability-hosted-geography.json). [Eight live browser groups](../execution/usability-live-browser-qa.json) covered the public and authenticated usability changes in Bangla/English/mobile, with no page errors and signed-out cleanup. [Eight asset hashes](../execution/usability-live-assets.json) matched the tested build with immutable caching. [Database metadata](../execution/usability-network-qa.json) confirmed availability and an empty external IP allowlist; no migration or network opening occurred. Payment collection remains disabled and the original PDF/credit records remain unchanged.

## Historical release 0.6 acceptance scope

Merchant-independent increment, deployed runtime `402903fb113799f5d7e5ec8d62307ba88f625318`. **210 local and 210 CI tests passed**: 5 backup safety, 72 form/schema, 97 API/PostgreSQL and 36 web. The production build and dependency audit passed; 17 separate real local recovery checks also passed. [CI 39199410740](https://github.com/sajeeb-ahmeed/astra-union-services/actions/runs/39199410740) is **SUCCESS**, including its Docker build and audit. Render deployment `dep-dbappb8m7kps739q5ivg` finished live on 19 October and was reconfirmed on 21 October. **22 hosted API groups, five live browser groups and all seven deployed JS/CSS hashes passed on 21 October.** [Live release evidence](../execution/security-live-release.json).

| ID      | Executed coverage                                                                                                                                                                           | Evidence boundary                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| AUTH-03 | Own active-session counts/expiry, expired/inactive filtering, no other-account selectors or session identifiers                                                                             | Real local PostgreSQL/API and hosted synthetic-account checks; sessions are not physical device inventory          |
| AUTH-04 | Current-password and CSRF verification; revoke other sessions, preserve current and neighboring accounts; replay and attempt-budget checks                                                  | Tenant audit rows; owner structured logs are not a durable global security audit                                   |
| AUTH-05 | Password rotation consumes prior recovery links across memberships; account locks prevent stale-password login, revoked-session use and competing credential-update races                   | Deterministic database-lock tests; no MFA or privileged recovery acceptance                                        |
| UX-02   | Bangla/English profile-session controls, correct/error states and mobile behavior                                                                                                           | Local tests plus hosted Bangla/English and 390×844 browser checks; full accessibility review remains open          |
| PERF-02 | Exact 47-service public catalog parity; authenticated chunks absent from public loading; language/login/logout and bilingual chunk-failure recovery                                         | Four production-bundle tests; 64.4% raw public-entry reduction is not measured field latency                       |
| OPS-03  | Format-2 encrypted dump/isolated restore; complete public data/PDF/ledger comparison, all routines/column grants/indexes/RLS; tamper, wrong-key and target/scratch-file collision rejection | 17 real local checks plus five safety tests; hosted/offsite recovery and independent key custody remain unverified |

Evidence: [local results](../execution/security-local-qa.json), [local log](../execution/security-local-qa.log), [performance](../execution/security-performance-qa.json), [recovery results](../execution/security-backup-qa.json), [recovery log](../execution/security-backup-restore.log), [account contract](ACCOUNT_SECURITY.md), [recovery runbook](BACKUP_AND_RECOVERY.md). Focused reruns of existing cases are not added to the 210 unique-test total. No migration or merchant credentials are required; payment onboarding/activation is deferred.

Hosted acceptance used existing synthetic accounts and records: [4 account-security groups](../execution/security-hosted-qa.json), [7 payment groups](../execution/security-hosted-payments.json), [6 historical readback groups](../execution/security-hosted-readback.json) and [5 geography groups](../execution/security-hosted-geography.json). Existing PDF bytes and credit records were unchanged. [Five browser groups](../execution/security-live-browser-qa.json) verified both account-navigation locations, blank password fields, public/login/logout behavior and mobile language controls with no page errors. [Seven asset hashes](../execution/security-live-assets.json) match the tested build with immutable caching. [Database network verification](../execution/security-network-qa.json) confirmed an available database and empty external IP allowlist. No migration, real payment, merchant call or hosted full backup was performed for this increment.

The first CI attempt passed all 97 API and 35 of 36 web cases; the public-size-budget case caught an environment-dependent development React bundle. Production-build configuration was fixed without weakening the budget; four focused bundle tests under `NODE_ENV=test` and the new candidate's full 210-test CI run passed. See [attempt evidence](../execution/security-ci-attempts.json) and [execution narrative](EXECUTION_RESULTS.md).

## Historical release 0.5 acceptance scope

The bKash v2 citizen-payment implementation has local mock-provider/API/browser acceptance cases. **Release 0.5 was deployed on 19 October: final Linux CI passed all 192 tests (72 forms, 89 API, 31 web), the Docker build and a zero-vulnerability dependency audit. Hosted migration and 7 payment + 6 historical readback + 5 geography groups passed; live Bangla/English and mobile browser checks also passed.** See [Release 0.5](RELEASE_0_5.md), [CI metadata](../execution/payments-ci-qa.json) and [CI summary](../execution/payments-ci-summary.log). Merchant credentials are absent; genuine bKash sandbox and live acceptance remain pending. Nagad, cash collection and bank payout matching are not implemented. See [gateway payments](GATEWAY_PAYMENTS.md).

| ID     | Coverage / required outcome                                                                                                                                      | Evidence boundary                                                            |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| PAY-01 | Disabled configuration refuses checkout without inserting an intent; approved positive assessment, current payload and role/tenant/ownership required            | Real local API/PostgreSQL cases; not provider acceptance                     |
| PAY-02 | Server amount/currency/invoice/merchant binding; no caller price or paid flag; exact environment checkout hostname                                               | Adapter and API tests with controlled provider responses                     |
| PAY-03 | Durable single create/execute claims; duplicate callbacks, retries, signature mismatch and concurrent requests cannot charge or confirm twice                    | Mock provider records call counts; no external transaction claimed           |
| PAY-04 | Query plus Search must match before atomic confirmation/receipt; transaction reuse and amount/currency/invoice/merchant mismatches rejected                      | Real database constraints with mock provider evidence                        |
| PAY-05 | Stored receipt/PDF hash survives replay; confirmation and receipt roll back together on injected failure; citizen payment never grants SaaS credits              | Local integration assertions, not a tax-invoice certification                |
| PAY-06 | Later decisive mismatch holds new issuance as REVIEW_REQUIRED; PENDING/ERROR cannot clear hold; fresh MATCHED restores eligibility; historical receipt unchanged | Separate reconciliation observations, no refund or receipt rewrite           |
| PAY-07 | Durable encrypted token cache, environment binding, restart sharing and token rate limits                                                                        | Adapter tests do not prove the merchant's issued credentials work            |
| PAY-08 | Payment register, Dhaka-date summary/CSV, exact roles, tenant isolation, private receipt downloads and CSV escaping                                              | Gateway records only; bank settlement explicitly NOT_CONNECTED               |
| PAY-09 | Forged success URL stays unpaid; unconfigured checkout disabled; Bangla/English mobile display; delayed checkout cannot redirect a departed view                 | Browser/API fixtures; no wallet PIN/OTP fields or fake public provider route |
| PAY-10 | Provider sandbox approval, registered callback, exact receiving merchant and controlled real transaction                                                         | **PENDING external merchant/provider acceptance**                            |

Coverage sources: [adapter tests](../apps/api/test/bkash.test.ts), [payment API tests](../apps/api/test/payments.test.ts), [payment browser tests](../apps/web/test/payments-browser.test.ts). Re-run all relevant suites after final source changes; do not add historical test counts to a new release total.

Hosted evidence: [payment checks](../execution/payments-hosted-qa.json), [readback](../execution/payments-hosted-readback.json), [geography](../execution/payments-hosted-geography.json), [migration](../execution/payments-hosted-migration.json), [network closure](../execution/payments-network-qa.json), [deployment](../execution/payments-render-deploy.json), [asset hashes](../execution/payments-live-assets.json) and [live browser](../execution/payments-live-browser-qa.json). The hosted payment checks used existing synthetic records and disabled configuration; no successful provider payment or paid receipt was fabricated online.

## Historical release 0.4

[Release 0.4 evidence](RELEASE_0_4.md) records its 162 local/CI tests, 11 local managed PostgreSQL groups and scoped hosted checks. Those results verify the prior fee-assessment milestone and are preserved separately from 0.5 provider work.

## Historical release 0.2

13 October 2026. The table below is the original release 0.2 record. PASS means that independently built local DEMO behavior was executed at that time; historical "unconfigured" limitations and counts are not the current 0.6 feature inventory. It never verifies Prottoyon's unseen server behavior or legal production authority. All tests use synthetic records.

| ID              | Current result        | Executed evidence / limit                                                                                                                                                                    |
| --------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEN-01 / TEN-02 | PASS                  | Real PostgreSQL RLS, API role scope, foreign UUID/tenant tampering and composite-key rejection                                                                                               |
| AUTH-01         | PASS                  | Citizen/staff/reviewer/approver/admin/finance/owner action matrix; explicit service-specific grants                                                                                          |
| AUTH-02         | PASS                  | User/membership/tenant suspension checked on existing sessions; denied sensitive actions                                                                                                     |
| REG-01          | PARTIAL               | Real self-registration persists user/membership/profile/audit. Identity remains SYNTHETIC_DEMO; lawful external verification is not integrated                                               |
| CIT-01          | PASS                  | Staff register/search, duplicate handling, calendar dates; real browser/API                                                                                                                  |
| FOR-01          | PASS                  | All 47 current forms and 48 initial reference previews; exact observed-name mapping retained; actual 47 database saves and issuance                                                          |
| FOR-02          | PASS                  | Conditional, bilingual, date, number, nested/repeatable, declarations, invalid/unknown/inactive fields; UI associated errors                                                                 |
| FOR-03          | PARTIAL               | 2 MiB limit, MIME signature/end markers, ownership, private download and malformed handle rejection pass. No deep malware/active-content scanner                                             |
| APP-01          | PASS                  | Draft→submit→review→correction→resubmit→approve, immutable payload/event history; browser + API                                                                                              |
| APP-02          | PASS                  | GET lookup/preview does not create/update applications, charges or print requests                                                                                                            |
| APP-03          | PASS                  | Cross-tenant approval denial/audit, staff/owner issue denial                                                                                                                                 |
| APP-04          | PASS                  | Saved values and pinned schema survive reopening and correction; historical schemas preserved                                                                                                |
| CER-01          | PASS (DEMO)           | Real #45 BN/EN/bilingual PDF + 47 service-specific payload PDFs generated after review/approval                                                                                              |
| CER-02 / PUB-02 | PASS                  | Decoded opaque QR; exact minimal public fields; invalid tokens return safe errors                                                                                                            |
| CER-03          | PASS                  | Revoked status immediately visible through existing verification token                                                                                                                       |
| CER-04          | PASS                  | Role, current membership and service authority rechecked at issuance commit                                                                                                                  |
| CER-05          | PASS (DEMO)           | General/trade renewal same-tenant/service/citizen lineage, latest-source and one-active-successor rules, cancellation/replacement, retry-safe new issue                                      |
| WAL-01          | PASS                  | One atomic issued document and one charge for each of 47 services                                                                                                                            |
| WAL-02          | PASS                  | Eight concurrent requests, retries and renewal retry produce one certificate/charge                                                                                                          |
| WAL-03          | PASS                  | Insufficient balance retains approved application without partial issuance/debit                                                                                                             |
| WAL-04          | PASS                  | Injected failure after ledger insert rolls back certificate/debit/state/audit                                                                                                                |
| WAL-05          | PASS (sandbox)        | HMAC, exact amount/currency, event replay and no duplicate credit; live provider not configured                                                                                              |
| WAL-06          | PASS                  | Reasoned append-only compensating entries; direct wallet update denied                                                                                                                       |
| BILL-01         | PASS (sandbox)        | Subscription/top-up orders, settlement, credits and immutable invoice; invoice/report PDF and CSV                                                                                            |
| BILL-02         | PARTIAL               | SaaS ledger/invoices and government-fee table/report flag stay separate. Statutory assessment/collection is unconfigured                                                                     |
| PUB-01          | PASS                  | Directory filter/page 2 retained in URL; server-filtered counts and active offices, notice search/pagination                                                                                 |
| UX-01           | PARTIAL               | Desktop/mobile no-overflow, labels, field/group errors, keyboard and browser smoke pass. Full screen-reader/contrast audit not completed                                                     |
| OPS-01          | PASS (local DB)       | Empty generated PostgreSQL database: all migrations, repeat seed, 32 tables, 140 schema hashes, 13 fixture users, 2 tenants and complete backend suite. Clean OS/Linux/containers unverified |
| OPS-02          | PASS (local recovery) | Authenticated encrypted dump, isolated restore, row/hash/schema/RLS/ledger/PDF verification. Offsite/key custody/recovery SLA not tested                                                     |
| SEC-01          | PASS (package scope)  | Runtime secret scan and excluded private audit/runtime; seeded account passwords are intentional local fixtures. Production log/secret operations remain deployment work                     |
| SEC-02          | PASS                  | Citizen/application/attachment/renewal/copy/notice/membership/recovery IDs tested across tenants and roles                                                                                   |

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

| Artifact                                            | Purpose                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------- |
| execution/forms-current.log                         | 72 form/schema cases                                                      |
| execution/clean-bootstrap.log                       | Fresh database, seed/hash proof and 40 API/security/static-delivery tests |
| execution/all-services-qa.json                      | 47 actual issue journeys and PDF sizes                                    |
| execution/frontend-expanded.log                     | Final browser/renderer suite (see exact counts in log)                    |
| execution/deployment-bootstrap.log                  | Unique-owner initialization, repeated safely                              |
| execution/pdf-qa.json / expanded-pdf-qa.json        | Parsed/rendered PDF language/output checks                                |
| execution/qr-qa.json                                | Actual raster QR decoding and minimal public lookup                       |
| execution/backup-restore.log                        | Encrypted recovery drill                                                  |
| execution/asset-sizes.json / performance-smoke.json | Built assets and local performance smoke                                  |
| execution/dependency-audit.json                     | Dependency advisory result at delivery time                               |
| execution/screenshots                               | Synthetic desktop/mobile and workflow evidence                            |

Repeated runs of the same cases on a new database are reproducibility evidence, not extra unique tests. Docker/CI configuration files do not count as executed hosted tests.


## Attachment quarantine acceptance (0.9)

- `ATT-01..09`, `apps/api/test/attachments.test.ts`: scanner auth/identity; immutable content; foreign ownership; leases/concurrency/replay/expiry; bounded retry; all workflow gates including final issuance race; fair tenant scheduling; FORCE RLS backfill under a non-bypass owner. Isolated generated test database only.
- `scripts/scanner/*.test.ts`: complete/truncated/multiple clamd records, size/time limits, stale definitions, clean+EICAR readiness, exact hash/bytes/lease, redirects and changed engine identity. These are protocol simulations, distinct from real engine evidence.
- `apps/web/test/attachment-browser.test.ts`: nine BN/EN lifecycle tests including polling, retry/CSRF, stale navigation responses, rejected replacement and readonly state. `form-render.test.ts` covers the rendered fail-closed handle.
- `scripts/verify-hosted-attachments.test.ts`: offline rehearsal of phased hosted checks with synthetic state and fully replaced network requests.
- `npm run scanner:check`: real official ClamAV definition identity, clean documents, standard EICAR and valid EmbeddedFile PDF rejection, client ceiling.
- `scripts/scanner/real-flow.ts`: real API/PostgreSQL/worker/ClamAV upload, byte-identical download, threat blocking, role-controlled PDF/exactly-once credit and offline/resume behavior. Only isolated loopback `astra_attachment_*` databases accepted.
- GitHub Actions runs unit/integration/browser suites, Docker build and a separate mandatory actual ClamAV+PostgreSQL flow. Hosted verification is a distinct post-deploy prepare/verify procedure; CI does not prove live rollout.
