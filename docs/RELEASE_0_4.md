# Release 0.4.0 — live deployment and verification

**17 October 2026 · LIVE; local, Linux CI, hosted API and browser checks passed.** Runtime commit `de8a0c335aa2315e8ff03faf2e9100fcf7492622` passed [CI run 39020055573](https://github.com/sajeeb-ahmeed/astra-union-services/actions/runs/39020055573), including Docker build and all 162 tests. Render deployment `dep-db9jt9m1egvs73fi5bbg` became live at `2026-10-17T09:26:11.236745Z` (15:26:11 Asia/Dhaka). All verification records use synthetic data; Phase 0 was not repeated. See [consolidated live release metadata](../execution/orders-live-release.json).

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
| Linux CI and Docker | **Passed**, 162 tests and zero audit vulnerabilities on the candidate commit | [CI metadata](../execution/orders-ci-qa.json), [summary](../execution/orders-ci-summary.log) |
| Hosted migration 011 | **Passed** preservation, runtime privilege/RLS and replay checks | [migration report](../execution/orders-hosted-migration.json), [log](../execution/orders-hosted-migration.log) |
| Render deployment | **Live**, exact CI-tested commit above | [deployment metadata](../execution/orders-render-deploy.json) |
| Hosted order workflow | **9/9 groups passed** in a new dedicated synthetic office | [report](../execution/hosted-orders-qa.json), [log](../execution/orders-hosted-qa.log) |
| Original hosted fixture readback | **6/6 groups passed**; original PDF, events and balance unchanged | [report](../execution/hosted-redeploy-qa.json), [log](../execution/orders-hosted-readback.log) |
| Hosted geography regression | **5/5 groups passed**, read-only requests | [report](../execution/geography-hosted-qa.json), [log](../execution/orders-hosted-geography.log) |
| Assets / network closure | **Passed** matching entry JS/CSS hashes and blocked external DB connection with healthy app | [assets](../execution/orders-live-assets.json), [network](../execution/orders-network-qa.json), [database access screenshot](../execution/orders-database-private.png) |
| Live UI browser inspection | **Passed** Bangla/English fee retention, mobile layout, blank citizen-first intake, server quote and unchecked-acceptance save blocking; no console warnings/errors | [browser report](../execution/orders-live-browser-qa.json), [mobile fee settings](../execution/orders-live-admin-mobile-bn.png), [mobile quote](../execution/orders-live-quote-mobile-en.png) |

The form/API/web total is **162 tests**. The 11 local managed PostgreSQL groups and 20 hosted groups (9 order + 6 readback + 5 geography) are reported separately. Actual hosted migration/deployment evidence above establishes the live release; local compatibility checks alone do not.

Ten new order API scenarios cover policy opt-in/legacy origin, administrator role enforcement, exact integer arithmetic without writes, atomic rejection of stale/tampered orders, concurrent publication, forced RLS/immutability, correction language, positive-fee no-debit blocking, historical legacy issuance, zero-fee concurrent issuance and current-policy renewal. Six lookup scenarios cover exact matching, permissions, indistinguishable unavailable responses, invalid input, unchanged records/credits on repeated reads and retained state/renewal restrictions. Existing suites continue to cover all 47 service schemas and application/approval/PDF/QR/ledger behavior.

Browser coverage includes citizen-first blank forms, language/input retention, returning from registration, hidden sample insertion on a hosted-style hostname, exact-reference opening, explicit admin policy amounts, quote acceptance, immutable details and delayed-response isolation. The first web run passed 26/27: one immediate enabled-state assertion ran before the parent React effect settled. The test was changed to wait for the enabled locator, then the **entire web suite** passed 27/27. The initial log remains [orders-web-initial.log](../execution/orders-web-initial.log); it is not the final result.

Managed PostgreSQL verification used a non-superuser/non-bypass migration owner and restricted application role. It checked geography initialization, forced RLS, owner-only policies, append-only order tables, bounded public functions, cross-tenant denial and wallet restrictions. This was a local isolated compatibility exercise, not a Render production write.

The first Linux CI run (`39019827032`) passed the Docker build, all 72 form tests and all 63 API tests, but passed 26/27 web tests: the same order journey read the disabled state before the parent update after a preference change. The test now waits for the old quote to disappear and the save control to become disabled before asserting. Both focused order browser tests passed locally afterward; the full Linux rerun passed all 162 tests. Evidence: [initial CI log](../execution/orders-ci-initial-failure.log), [focused regression](../execution/orders-web-state-regression.log), [passing CI summary](../execution/orders-ci-summary.log). No application logic or database schema changed in this test repair.

The build retains Vite's warning for a main chunk over 500 kB: 989,102 raw bytes, 143,381 gzip bytes and 108,678 Brotli bytes. Additional code splitting remains a performance improvement. The finance PDF spans six pages because the test database contains accumulated synthetic records. Some Bengali ligature text extraction remains imperfect with the Nirmala/Chromium PDF mapping; layout and approved-language checks are recorded separately from extraction fidelity.

## Hosted migration and synthetic QA scope

The first maintenance preflight stopped before changes because its historical expectation was seven users while the database contained eight. Fresh read-only review confirmed the eighth user was existing data. All eight were preserved; only the private maintenance runner's count expectation changed. The CI-tested migration SQL remained unchanged. Initial preflight evidence is retained in [JSON](../execution/orders-hosted-migration-preflight.json) and [log](../execution/orders-hosted-migration-preflight.log).

With the user's approved temporary single-IP access and certificate-verified TLS, migration 011 completed at `2026-10-17T09:22:35.934Z`. Before/after counts remained two offices, eight users and one certificate; both offices' recorded domain fingerprints matched. The original PDF retained its 114,286 bytes and hash, its wallet retained 24 credits, and its one three-credit issuance debit/five application events remained unchanged. Migration created no tariffs, snapshots or domain records. Runtime grants, forced RLS and idempotent replay passed. The temporary IP rule was removed; the external connection probe was blocked while app health remained HTTP 200.

The subsequent live order QA deliberately added **one isolated synthetic office, four role accounts, one citizen profile, two fee policies, two applications and one DEMO certificate**. A zero-money sandbox subscription granted 20 test credits. Concurrent zero-fee issuance and retry produced exactly one three-credit debit, leaving 17 credits and one issue event. The approved positive assessment of **15,210 minor units (BDT 152.10)** returned `402 ORDER_PAYMENT_REQUIRED`, stayed `NOT_COLLECTED`, and produced neither certificate nor debit. These rates are synthetic test fixtures, not default office tariffs. Existing offices received no fee policy changes.

The new PDF and minimal public verification matched the single issued certificate. Original-fixture readback afterward again confirmed the old PDF hash, 24-credit balance, one debit and five events. Geography checks were all unauthenticated reads. New immutable QA records are intentionally retained, and the QA API sessions were logged out. Entry JavaScript and CSS downloaded from the live origin matched local build hashes.

Live Chrome inspection verified service #45 policy version 2 retained the synthetic BDT amounts across English/Bangla: statutory 121.01, processing 23.02, urgency 7.03, office collection 2.05 and digital copy 1.04. At 390 × 844, the document scroll width was 375 pixels with no horizontal overflow. Citizen-first intake hid service facts until selection, then opened blank fields; hosted sample insertion was absent. English + digital copy + urgent produced the server total BDT 152.10 and unpaid-issuance warning. Acceptance remained unchecked and Save draft stayed disabled. No new domain records were created through the UI. Console warning/error logs were empty. Inspection ended signed out with cleared login inputs, restored viewport and the Bangla homepage open. Evidence: [English admin](../execution/orders-live-admin-en.png), [Bangla mobile admin](../execution/orders-live-admin-mobile-bn.png), [English mobile quote](../execution/orders-live-quote-mobile-en.png), [final homepage](../execution/orders-live-home-bn.png).

## Release and operational limits

Release 0.4 is live at [astra-union-services.onrender.com](https://astra-union-services.onrender.com/). The runtime/deployment identifiers above are distinct from any later documentation-only repository commit. Hosted API and browser evidence proves the exercised synthetic paths at the recorded time, not continuous availability or all untested office workflows.

Citizen payment collection, counter receipts, provider settlement/reconciliation/refunds, coupons, separate present/permanent address models, service-specific geography adapters, identity/OTP and official signing are not implemented by this slice. Positive-fee issuance is deliberately blocked until verified payment support exists. Old legacy drafts retain their pre-policy workflow; unconfigured policies are not silently represented as paid or approved zero fees.

Output remains **DEMO / NOT OFFICIAL**. The user-confirmed separate approver and per-union tariff rules guide the independent implementation; complete reference-process equivalence has not been established. The existing Render Free database is documented to expire **12 November 2026**; no paid upgrade is included.

Next implementation milestone: verified citizen fee collection with distinct receipts and reconciliation under approved office/provider rules, alongside service-form geography adapters. Any actual production claim still requires authorized identity/signing integrations and operational acceptance.
