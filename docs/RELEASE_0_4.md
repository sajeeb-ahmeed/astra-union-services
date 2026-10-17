# Release 0.4.0 — local verification

**17 October 2026 · locally verified · hosted migration/deployment pending.** The last documented live release remains 0.3. No 0.4 CI result, deployed commit or Render deployment ID is claimed here. All verification records use synthetic data; Phase 0 was not repeated.

## Implemented changes

- Citizen-first intake with blank service facts, reset on applicant change and return from registration. Synthetic example insertion is restricted to local demo mode.
- Exact Astra application/certificate reference lookup with citizen ownership and office isolation, feeding existing viewing/download/renewal flows.
- Office/service fee policy versions with explicit statutory, processing, urgency and delivery amounts in integer BDT minor units; separate from tenant SaaS credits.
- Shared Bangla/English application options, server-calculated fee review and immutable accepted snapshots. Stale policies, client prices and language disagreement are rejected.
- Separate authorized approver workflow remains required. Uncollected positive-fee orders cannot issue; explicitly configured zero-fee orders retain exactly-once SaaS credit deduction.
- PostgreSQL migration `011`, historical legacy compatibility, current-policy renewal and OpenAPI 0.4 documentation.

See [workflow/API details](ORDER_WORKFLOW.md) and [reference parity/remaining gaps](PROCESS_PARITY.md).

## Executed results

| Check | Actual result | Evidence |
| --- | --- | --- |
| Shared forms | **72/72 passed**, zero failures | [orders-forms.log](../execution/orders-forms.log) |
| API/database/security | **63/63 passed**, zero failures | [orders-api.log](../execution/orders-api.log) |
| Browser/renderer | **27/27 passed**, zero failures | [orders-web.log](../execution/orders-web.log) |
| Managed PostgreSQL compatibility | **11 groups passed** on a fresh isolated database; all 10 migration files through `011` applied | [orders-managed-postgres.log](../execution/orders-managed-postgres.log), [structured checks](../execution/managed-postgres-qa.json) |
| Dependency audit | **Zero reported vulnerabilities** at execution time | [orders-dependency-audit.json](../execution/orders-dependency-audit.json) |
| Final release build | **Passed** strict TypeScript and Vite production build; four JS/CSS assets compressed with gzip/Brotli | [orders-build.log](../execution/orders-build.log) |
| PDF render/content checks | Resident Bangla/English/bilingual, family, trade and renewal samples each **one page**; private copies and finance documents checked | [orders-pdf-qa.log](../execution/orders-pdf-qa.log), [resident results](../execution/pdf-qa.json), [expanded results](../execution/expanded-pdf-qa.json) |
| New CI / hosted migration / deployment / readback | **Pending** | [hosted history](HOSTED_DEPLOYMENT.md) |

The form/API/web total is **162 tests**, not 173: the 11 managed PostgreSQL checks are reported separately. Passing local compatibility checks does not establish that the hosted database has been migrated.

Ten new order API scenarios cover policy opt-in/legacy origin, administrator role enforcement, exact integer arithmetic without writes, atomic rejection of stale/tampered orders, concurrent publication, forced RLS/immutability, correction language, positive-fee no-debit blocking, historical legacy issuance, zero-fee concurrent issuance and current-policy renewal. Six lookup scenarios cover exact matching, permissions, indistinguishable unavailable responses, invalid input, unchanged records/credits on repeated reads and retained state/renewal restrictions. Existing suites continue to cover all 47 service schemas and application/approval/PDF/QR/ledger behavior.

Browser coverage includes citizen-first blank forms, language/input retention, returning from registration, hidden sample insertion on a hosted-style hostname, exact-reference opening, explicit admin policy amounts, quote acceptance, immutable details and delayed-response isolation. The first web run passed 26/27: one immediate enabled-state assertion ran before the parent React effect settled. The test was changed to wait for the enabled locator, then the **entire web suite** passed 27/27. The initial log remains [orders-web-initial.log](../execution/orders-web-initial.log); it is not the final result.

Managed PostgreSQL verification used a non-superuser/non-bypass migration owner and restricted application role. It checked geography initialization, forced RLS, owner-only policies, append-only order tables, bounded public functions, cross-tenant denial and wallet restrictions. This was a local isolated compatibility exercise, not a Render production write.

The first Linux CI run (`39019827032`) passed the Docker build, all 72 form tests and all 63 API tests, but passed 26/27 web tests: the same order journey read the disabled state before the parent update after a preference change. The test now waits for the old quote to disappear and the save control to become disabled before asserting. Both focused order browser tests passed locally afterward; the full Linux rerun is pending. Evidence: [initial CI log](../execution/orders-ci-initial-failure.log), [focused regression](../execution/orders-web-state-regression.log). No application logic or database schema changed in this test repair.

The build retains Vite's warning for a main chunk over 500 kB: 989,102 raw bytes, 143,381 gzip bytes and 108,678 Brotli bytes. Additional code splitting remains a performance improvement. The finance PDF spans six pages because the test database contains accumulated synthetic records. Some Bengali ligature text extraction remains imperfect with the Nirmala/Chromium PDF mapping; layout and approved-language checks are recorded separately from extraction fidelity.

## Release and operational limits

The repository implementation is ahead of the documented live deployment. Hosted migration, CI, deployment and authenticated live readback must finish before the new features are presented as live. Preserve existing citizens, offices, PDFs and balances during migration; record concrete release and verification identifiers after execution.

Citizen payment collection, counter receipts, provider settlement/reconciliation/refunds, coupons, separate present/permanent address models, service-specific geography adapters, identity/OTP and official signing are not implemented by this slice. Positive-fee issuance is deliberately blocked until verified payment support exists. Old legacy drafts retain their pre-policy workflow; unconfigured policies are not silently represented as paid or approved zero fees.

Output remains **DEMO / NOT OFFICIAL**. The user-confirmed separate approver and per-union tariff rules guide the independent implementation; complete reference-process equivalence has not been established. The existing Render Free database is documented to expire **12 November 2026**; no paid upgrade is included.

Next implementation milestone: verified citizen fee collection with distinct receipts and reconciliation under approved office/provider rules, alongside service-form geography adapters. Any actual production claim still requires authorized identity/signing integrations and operational acceptance.
