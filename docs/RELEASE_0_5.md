# Release 0.5.0 — gateway payments, receipts and reconciliation

19 October 2026. Release 0.5 is live; local verification, final Linux CI, hosted migration and 18 hosted API regression groups passed. Live Bangla/English and mobile browser checks also passed. Runtime `b86908b9a4654cc31cd1b517fc5e8ad3ae086878` passed all 192 tests and its Docker build in [GitHub Actions run 39125266096](https://github.com/sajeeb-ahmeed/astra-union-services/actions/runs/39125266096). This release adds an independently authored bKash v2 adapter. **The user has no merchant account yet, so hosted money collection remains disabled. Nagad is not integrated.** Local provider mocks are not bKash sandbox acceptance.

## Implemented behavior

- An approved application's immutable fee assessment determines the amount and invoice. Tenant scope, citizen ownership and role authorization are checked before checkout.
- The bKash hosted checkout handles wallet authentication. Astra never collects a wallet PIN or OTP. Provider redirects and credentials stay environment-bound.
- One durable checkout and execution claim prevents repeated execution after a timeout. Query and transaction search must independently match the payment, invoice, amount, currency and receiving merchant.
- Confirmation and one immutable bilingual PDF receipt commit together. Duplicate callbacks, request retries and concurrent verification cannot create duplicate paid records or receipts.
- Payment register, Dhaka-date totals, protected receipt downloads and CSV exports support office finance work. Transaction reconciliation is distinct from bank payout reconciliation, which remains unconnected.
- A later decisive mismatch holds new issuance until a subsequent verified match; the historical receipt remains intact. Separate approver authorization, subscriptions and exactly-once SaaS credit deduction still apply.
- Encrypted PostgreSQL token cache, committed authentication-attempt reservations, callback/query limits, six forced-RLS tables and restricted update grants protect the new module.
- Bangla/English responsive payment screens report setup, uncertain results, review holds and unconnected services explicitly.

Details and merchant configuration: [GATEWAY_PAYMENTS.md](GATEWAY_PAYMENTS.md). API contract: [OpenAPI 0.5](../apps/api/openapi.json). Deployed release identity and results: [consolidated metadata](../execution/payments-live-release.json).

## Verification

| Check | Result / evidence |
| --- | --- |
| Final Linux CI | 192/192 passed in one run: 72 forms, 89 API and 31 web; Docker build, production build and dependency audit passed, with zero reported vulnerabilities — [metadata](../execution/payments-ci-qa.json), [summary](../execution/payments-ci-summary.log) |
| Shared forms | 72/72 passed — [log](../execution/payments-forms.log) |
| API/database/security | 89/89 passed; all 16 changed payment cases passed again after final finance refinements — [log](../execution/payments-api.log) |
| Browser/renderer | 30/31 initially passed; a browser closed during one legacy screenshot. Its four-test file rerun passed 4/4, including that case. All four new payment browser cases passed — [suite](../execution/payments-web.log), [rerun](../execution/payments-web-retry.log) |
| Final language regression | 4/4 payment browser cases passed after fixing reactive Bangla/English return notices — [log](../execution/payments-browser-i18n-regression.log) |
| Production build | Strict TypeScript, Vite and gzip/Brotli passed — [log](../execution/payments-build.log). Existing 991 KB entry bundle retains a chunk-size warning. |
| Managed PostgreSQL | 14 groups passed on an isolated NOSUPERUSER/NOBYPASSRLS database; all 11 migrations — [log](../execution/payments-managed-postgres.log), [details](../execution/managed-postgres-qa.json) |
| PDF receipt | One A4 page, readable Bangla/English, exact components and explicit sandbox/no-money watermark — [result](../execution/payments-receipt-qa.json), [synthetic PDF](../execution/payments-synthetic-receipt.pdf) |
| Dependency scan | Zero reported vulnerabilities — [result](../execution/payments-dependency-audit.json) |
| Hosted migration | Migration 012 committed; all 66 recorded domain fingerprints across three existing offices remained unchanged; runtime privileges and idempotent replay passed — [result](../execution/payments-hosted-migration.json), [log](../execution/payments-hosted-migration.log) |
| Database network closure | Empty Render database allowlist, blocked fresh external connection and HTTP 200 application health confirmed on 19 October — [result](../execution/payments-network-qa.json), [dashboard](../execution/payments-database-private.png) |
| Render runtime | `dep-dbaob6s9v7es739a8j30` is live on the CI-tested commit, completed 19 October at 02:53:25.665787 UTC — [result](../execution/payments-render-deploy.json) |
| Hosted payment API | 7/7 groups passed: disabled checkout, empty registers, access controls and unchanged domain records — [result](../execution/payments-hosted-qa.json) |
| Hosted historical readback | 6/6 groups passed; original PDF, wallet, issuance debit and application events unchanged — [result](../execution/payments-hosted-readback.json) |
| Hosted geography | 5/5 read-only groups passed — [result](../execution/payments-hosted-geography.json) |
| Live frontend assets | Entry JavaScript and CSS hashes match the tested local build; immutable cache headers present — [result](../execution/payments-live-assets.json) |
| Live browser | Bangla/English register, reconciliation and approved-application payment card passed; no horizontal overflow at 390 × 844 and no console warnings/errors — [result](../execution/payments-live-browser-qa.json) |

Tests use real local PostgreSQL, HTTP endpoints and PDF generation with controlled provider responses. They cover forged callbacks, seven evidence mismatch types, concurrent retries, timeout recovery, immutable receipts, atomic rollback, tenant/citizen privacy, approval and credit invariants, persisted token reservations and reconciliation rate limits. No private reference-site data was used, and Phase 0 was not repeated.

## Hosted migration and preservation

The bounded migration completed on **18 October 2026 at 12:20:40.723 UTC**. It applied only `012_gateway_payments.sql` and its migration marker through TLS with certificate-chain and hostname verification. It created no office, user, tariff, application, payment, receipt or ledger record. The database now has eleven migration files installed; the repository intentionally has no migration 005.

Before/after counts remained **three offices, twelve users and two certificates**. All **66 tenant-scoped domain fingerprints** matched, covering the 22 recorded tables in each existing office. The original fixture retained its 114,286-byte PDF and SHA-256, 24-credit balance, single three-credit issuance debit and five application events. The preservation report records the exact hashes without exposing citizen payloads or credentials.

The runtime role remains a non-superuser without RLS bypass. All six new gateway tables have forced RLS. Token-cache updates and narrowly scoped intent updates are permitted; payment history remains immutable. The callback resolver and office isolation checks passed. Replaying the runner skipped migration SQL and preserved its single marker and domain fingerprints.

External access was verified closed on **19 October 2026**: Render reported an empty database IP allowlist, its dashboard showed that all internet traffic was blocked, and a fresh external database connection failed while application health returned HTTP 200. The network evidence records this verification time separately from migration completion. Migration and network checks are separate from runtime deployment and provider acceptance.

## Live deployment and checks

[Astra is live](https://astra-union-services.onrender.com/) on the exact CI-tested runtime above. Render completed deployment at **08:53:25 Asia/Dhaka on 19 October**. Hosted checks reused existing synthetic accounts and records, then logged out all test sessions. No provider mock, real payment, new office or financial record was created online.

The seven payment groups confirmed `BKASH` environment `DISABLED`, `MERCHANT_SETUP_REQUIRED`, Nagad `NOT_INTEGRATED` and bank payouts `NOT_CONNECTED`. The existing approved BDT 152.10 application stayed unpaid without a receipt. Checkout returned `503 GATEWAY_NOT_CONFIGURED` before creating an intent; the payment register, reconciliation totals and CSV stayed empty. Unauthorized requests and forged callbacks were rejected. Six historical readback groups and five geography groups passed separately. Historical 0.4 evidence files are preserved; this release uses the `payments-` evidence files linked above.

Live browser checks passed for Bangla/English payment screens and mobile layout, with no console warnings or errors. The BDT 152.10 application showed disabled checkout and no receipt in both languages. At 390 × 844, the measured page width was 375 pixels with no horizontal overflow. Inspection ended signed out, login inputs cleared and viewport restored. See [English reconciliation](../execution/payments-live-reconciliation-en.png), [Bangla mobile reconciliation](../execution/payments-live-reconciliation-mobile-bn.png), [Bangla mobile payment card](../execution/payments-live-application-mobile-bn.png) and [final homepage](../execution/payments-live-home-bn.png). Later documentation/evidence-only Git commits may differ from the deployed runtime SHA; Auto-Deploy remains off.

## Known limits and next milestone

No merchant account, genuine provider sandbox transaction, real-money payment or bank payout reconciliation has been verified. Configuration currently supports one explicitly bound office merchant per deployment. Nagad, signed provider IPN, refunds/disputes, replacement checkout attempts and unknown-create operational recovery are pending. One attempt per application deliberately prevents automatic recharge; these recovery paths must be implemented and provider-tested before normal commercial activation.

Next: obtain approved bKash merchant/sandbox access, add provider-supported recovery and notifications, run genuine sandbox acceptance, then separately authorize a controlled live payment. Integrate Nagad using its merchant-issued API contract. Continue preserving the 47-service reference evidence limitations and DEMO / NOT OFFICIAL certificate boundary. The current Render Free database expires on 12 November 2026; durable hosting/backups are a separate production requirement.
