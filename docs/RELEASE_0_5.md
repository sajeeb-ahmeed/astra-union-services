# Release 0.5.0 — gateway payments, receipts and reconciliation

18 October 2026. Local implementation and verification are complete; CI and hosted deployment are pending. This release adds an independently authored bKash v2 adapter. **The user has no merchant account yet, so hosted money collection remains disabled. Nagad is not integrated.** Local provider mocks are not bKash sandbox acceptance.

## Implemented behavior

- An approved application's immutable fee assessment determines the amount and invoice. Tenant scope, citizen ownership and role authorization are checked before checkout.
- The bKash hosted checkout handles wallet authentication. Astra never collects a wallet PIN or OTP. Provider redirects and credentials stay environment-bound.
- One durable checkout and execution claim prevents repeated execution after a timeout. Query and transaction search must independently match the payment, invoice, amount, currency and receiving merchant.
- Confirmation and one immutable bilingual PDF receipt commit together. Duplicate callbacks, request retries and concurrent verification cannot create duplicate paid records or receipts.
- Payment register, Dhaka-date totals, protected receipt downloads and CSV exports support office finance work. Transaction reconciliation is distinct from bank payout reconciliation, which remains unconnected.
- A later decisive mismatch holds new issuance until a subsequent verified match; the historical receipt remains intact. Separate approver authorization, subscriptions and exactly-once SaaS credit deduction still apply.
- Encrypted PostgreSQL token cache, committed authentication-attempt reservations, callback/query limits, six forced-RLS tables and restricted update grants protect the new module.
- Bangla/English responsive payment screens report setup, uncertain results, review holds and unconnected services explicitly.

Details and merchant configuration: [GATEWAY_PAYMENTS.md](GATEWAY_PAYMENTS.md). API contract: [OpenAPI 0.5](../apps/api/openapi.json).

## Verification

| Check | Result / evidence |
| --- | --- |
| Shared forms | 72/72 passed — [log](../execution/payments-forms.log) |
| API/database/security | 89/89 passed; all 16 changed payment cases passed again after final finance refinements — [log](../execution/payments-api.log) |
| Browser/renderer | 30/31 initially passed; a browser closed during one legacy screenshot. Its four-test file rerun passed 4/4, including that case. All four new payment browser cases passed — [suite](../execution/payments-web.log), [rerun](../execution/payments-web-retry.log) |
| Production build | Strict TypeScript, Vite and gzip/Brotli passed — [log](../execution/payments-build.log). Existing 991 KB entry bundle retains a chunk-size warning. |
| Managed PostgreSQL | 14 groups passed on an isolated NOSUPERUSER/NOBYPASSRLS database; all 11 migrations — [log](../execution/payments-managed-postgres.log), [details](../execution/managed-postgres-qa.json) |
| PDF receipt | One A4 page, readable Bangla/English, exact components and explicit sandbox/no-money watermark — [result](../execution/payments-receipt-qa.json), [synthetic PDF](../execution/payments-synthetic-receipt.pdf) |
| Dependency scan | Zero reported vulnerabilities — [result](../execution/payments-dependency-audit.json) |

Tests use real local PostgreSQL, HTTP endpoints and PDF generation with controlled provider responses. They cover forged callbacks, seven evidence mismatch types, concurrent retries, timeout recovery, immutable receipts, atomic rollback, tenant/citizen privacy, approval and credit invariants, persisted token reservations and reconciliation rate limits. No private reference-site data was used, and Phase 0 was not repeated.

## Known limits and next milestone

No merchant account, genuine provider sandbox transaction, real-money payment or bank payout reconciliation has been verified. Configuration currently supports one explicitly bound office merchant per deployment. Nagad, signed provider IPN, refunds/disputes, replacement checkout attempts and unknown-create operational recovery are pending. One attempt per application deliberately prevents automatic recharge; these recovery paths must be implemented and provider-tested before normal commercial activation.

Next: obtain approved bKash merchant/sandbox access, add provider-supported recovery and notifications, run genuine sandbox acceptance, then separately authorize a controlled live payment. Integrate Nagad using its merchant-issued API contract. Continue preserving the 47-service reference evidence limitations and DEMO / NOT OFFICIAL certificate boundary. The current Render Free database expires on 12 November 2026; durable hosting/backups are a separate production requirement.
