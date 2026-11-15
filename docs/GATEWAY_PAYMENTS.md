# Citizen gateway payments, receipts and transaction reconciliation

**Release 0.5 is live as of 19 October 2026:** 192 final Linux CI tests, Docker build, hosted migration and 18 hosted API regression groups passed; live Bangla/English and mobile browser checks also passed. See the [release evidence](RELEASE_0_5.md). The selected first adapter is **bKash tokenized checkout v2 without agreement**. The user has no configured merchant account yet. Hosted checkout therefore remains disabled. **Nagad is not integrated.** No external sandbox or real-money payment has been tested.

The integration collects the exact fee from an application's immutable office assessment. It is separate from Astra's existing zero-money SaaS subscription/top-up fixtures and credit ledger. Paying a citizen fee never grants SaaS credits. Certificate PDFs retain **DEMO / NOT OFFICIAL**; connecting a payment provider does not confer legal issuing authority.

## Checkout and verification

Checkout is available only for an **APPROVED** application with a positive policy-backed assessment. The server selects the tenant, merchant configuration, amount, BDT currency and unique invoice reference. Caller-supplied prices, paid flags and tenant overrides are rejected. An unresolved payment attempt must be recovered before another attempt can be started.

bKash's v2 flow redirects the payer to its hosted page; wallet authentication takes place there. Astra must not collect a wallet PIN or OTP. The returned checkout URL is validated against the configured provider environment and used unchanged. A browser callback is a continuation signal, not proof of payment. These boundaries follow the [bKash checkout guide](https://developer.bka.sh/docs/tokenized-without-agreement).

The Create response binds the local attempt to `paymentId`, its returned URL and callback `signature`. The browser callback uses `paymentID`, `status` and `signature`; the server checks them against the stored attempt. Provider field spelling differs between the v2 API and callback, so examples from older APIs must not be substituted. See [Create Payment v2](https://developer.bka.sh/docs/create-payment-3).

Execution is recorded durably before the external call. A payment ID must not be executed twice, including after a timeout or restart. Recovery queries the existing attempt; no missing response is interpreted as failure or permission to recharge. bKash documents this one-execution rule and recovery through Query Payment in [Execute Payment v2](https://developer.bka.sh/docs/execute-payment-4).

Before Astra confirms a payment, its server requires provider-confirmed completion and checks payment ID, invoice, exact amount, currency and sale intent. Query uses `merchantInvoice`, while Execute uses `merchantInvoiceNumber`. A matching transaction lookup additionally verifies the transaction ID and destination merchant account. These checks join the [Query Payment](https://developer.bka.sh/docs/query-payment) and [Search Transaction](https://developer.bka.sh/docs/search-transaction) responses; a receipt cannot be created from a user-entered transaction ID alone.

Confirmation and the one receipt record commit atomically. Duplicate callbacks, status refreshes and concurrent requests return the same result. Unique provider transaction and application receipt constraints prevent a second receipt or settlement. Pending, failed verification and mismatched provider data do not satisfy issuance. Certificate issuance still performs the independent approver, service, subscription and exactly-once credit checks.

## Receipts and finance access

The receipt preserves the accepted fee components, total, office/application context, provider environment, transaction identity and verified completion time. It is distinct from a SaaS invoice. Protected downloads enforce tenant scope and applicant ownership; finance receives payment details without gaining access to raw service-form payloads or private uploads. Stored receipt bytes and identity remain stable across retries and later profile changes.

Receipt and payment history are append-only financial records. There is no manual “mark paid” control, fabricated gateway response or cash-confirmation substitute in this release. Demonstration labeling remains explicit on documents and sandbox records.

## Reconciliation scope

Reconciliation rechecks a recorded payment against authenticated bKash Query/Search responses and records whether the transaction, amount, currency, invoice and merchant match. It does not infer success from a redirect or from Astra's own prior status. Repeated checks preserve their observations rather than editing the original receipt.

A later decisive mismatch places the application's effective payment state on **REVIEW_REQUIRED** and blocks new issuance. The historical receipt and original paid record remain intact. An inconclusive error or pending response does not clear that hold; a subsequent verified match restores eligibility. This is an issuance safeguard, not a refund or an alteration of the original financial evidence.

**Bank payout reconciliation is NOT CONNECTED.** Transaction completion, merchant fees, discounts, refundable amount and money deposited into a bank are different facts. Provider search exposes fee and coupon-related fields, but this release does not treat them as a bank statement or invent a net deposit calculation. Refunds, disputes, chargebacks and automatic financial corrections remain outside this milestone. [Provider transaction fields](https://developer.bka.sh/docs/search-transaction) are the basis for that distinction.

The daily report groups payment attempts by their creation date in Asia/Dhaka; its check-result counts use each check's date. These are separate activity counts, not daily bank deposits. CSV exports include minor-unit amounts and distinguish the provider environment.

## API and access

Paths below are relative to `/api/v1`. Session-protected mutations require CSRF. Only the opaque-token callback is public, and it requires the stored provider payment/signature match.

| Method and path | Purpose |
| --- | --- |
| `GET /payments/configuration` | Current office's provider availability; reports missing setup and Nagad's integration status. |
| `GET /applications/:id/payment` | Authorized application's assessment, attempt, receipt and eligibility. |
| `POST /applications/:id/payments` | Citizen-own/staff/admin checkout with `{ provider: "BKASH", requestKey }`; no caller price. |
| `GET /payments/bkash/callback/:token` | Validates the provider return and claims execution at most once; redirects to the app's result screen. |
| `GET /payments/:id` | Authorized attempt status; checkout URL is exposed only while ready. |
| `POST /payments/:id/reconcile` | Citizen-own/staff/admin/finance provider status check using `{ requestKey }`. |
| `GET /payments` | Staff/admin/finance tenant list with bounded pagination and optional status/date filters. |
| `GET /payments/reconciliation` | Admin/finance daily summary using `businessDate=YYYY-MM-DD`. |
| `GET /payments/reconciliation/export.csv` | Admin/finance CSV for that date. |
| `GET /receipts/:id` and `GET /receipts/:id/pdf` | Tenant/application-authorized receipt metadata or stored PDF. |

The migration adds `gateway_token_cache`, `gateway_payment_intents`, `gateway_payment_events`, `gateway_payment_confirmations`, `gateway_payment_receipts` and `gateway_payment_reconciliations`. The financial request and provider identity are immutable; operational status is controlled separately. Confirmation requires its receipt in the same commit. Forced RLS, tenant-composite relationships and restricted runtime privileges apply to the new tables.

## Merchant setup and secret handling

Activation requires a bKash-approved merchant account and the correct environment's username, password, application key and application secret, together with the expected receiving merchant identity and an HTTPS callback origin. The integration binds credentials to an explicitly configured tenant; one office cannot silently collect through another office's merchant account. Confirm the account's approved v2 endpoint/environment with bKash before enabling it.

Credentials belong in deployment secrets, never source, browser code, chat, screenshots or public logs. Token storage is encrypted and keyed to the merchant environment; concurrent requests and restarts share its durable cache. Authentication calls are capped because bKash documents a two-calls-per-hour limit and an hour-long block when exceeded. See [Grant Token](https://developer.bka.sh/docs/grant-token) and [Refresh Token](https://developer.bka.sh/docs/refresh-token).

Changing credentials, tenant binding, encryption key or environment is an operational change. Preserve the ability to resolve outstanding attempts under their original merchant configuration; do not switch their ownership or reinterpret sandbox records as live payments.

The adapter configuration is server-only:

| Setting | Purpose |
| --- | --- |
| `BKASH_ENVIRONMENT` | `disabled` by default; `sandbox` or `live` selects the approved environment. |
| `BKASH_TENANT_ID` | The one office allowed to use this deployment's merchant credentials. |
| `BKASH_USERNAME`, `BKASH_PASSWORD`, `BKASH_APP_KEY`, `BKASH_APP_SECRET` | Provider-issued credentials for that environment. |
| `BKASH_MERCHANT_ACCOUNT` | Expected receiving merchant wallet, checked against provider transaction data. |
| `BKASH_TOKEN_ENCRYPTION_KEY` | Separate 32-byte secret, represented by 64 hexadecimal characters, for stored token encryption. |
| `BKASH_LIVE_ENABLED` | Explicit `true` is additionally required for the live environment. |
| `PUBLIC_ORIGIN` | Exact HTTPS application origin used for callback construction. |

Multiple unions do not share a merchant account implicitly. This first adapter supports one configured tenant per deployment; onboarding additional merchant accounts requires extending configuration and token isolation deliberately. Missing or invalid configuration leaves checkout unavailable.

## Evidence and release limits

The local [API execution](../execution/payments-api.log) passed **89 tests**, including ten bKash adapter tests and sixteen payment workflow tests. These use a local mock provider and real PostgreSQL to exercise amount/merchant mismatch, callback forgery, duplicate confirmation, single execution, timeout recovery, token persistence/rate limits, receipt immutability, tenant/role restrictions, mismatch holds and unchanged SaaS balances. They verify Astra's behavior against controlled responses; they do not certify bKash connectivity or merchant readiness.

The isolated non-superuser [managed PostgreSQL check](../execution/payments-managed-postgres.log) passed **14 groups** over eleven migration files, including all six new tables' RLS/privileges and the restricted callback resolver. The [synthetic receipt evidence](../execution/payments-receipt-qa.json) records a one-page PDF, its hash, demonstration marker and Bengali text. Its explicit mode is `LOCAL_MOCK_NOT_PROVIDER_SANDBOX`, and `realMoneyCollected` is false.

Before activation: obtain merchant approval and credentials, complete genuine provider-sandbox acceptance, verify the registered callback and receiving merchant, and authorize a controlled real transaction. Until then the live UI must say that bKash configuration is required and Nagad is unavailable. No receipt or real-money result is claimed from merely deploying the disabled integration.

This first version keeps **one payment attempt per application**. A repeated checkout request returns that existing attempt. It does not automatically replace an unknown, cancelled, failed or expired checkout. When a provider payment ID is known, Query/Search can recover a completed transaction; an unknown creation outcome without a payment ID requires provider investigation. There is currently no operator reset, replacement-attempt or refund endpoint. These recovery limitations must be resolved and provider-tested before normal live collection is enabled.

Runtime `b86908b9a4654cc31cd1b517fc5e8ad3ae086878` passed [Linux CI run 39125266096](https://github.com/sajeeb-ahmeed/astra-union-services/actions/runs/39125266096): 72 form, 89 API and 31 web tests, production build, Docker build and zero reported dependency vulnerabilities. [Sanitized metadata](../execution/payments-ci-qa.json) and [test summary](../execution/payments-ci-summary.log) record that run. Its [live deployment](../execution/payments-render-deploy.json) passed [seven hosted payment groups](../execution/payments-hosted-qa.json), [six historical readback groups](../execution/payments-hosted-readback.json) and [five geography groups](../execution/payments-hosted-geography.json). Hosted payment checks confirm safe disabled behavior and empty collections; they do not verify a genuine provider transaction. Primary documentation above was read on 17 October 2026; this implementation targets its v2 contract, not the older v1.2 checkout examples.

Local browser verification on 18 October: all four new payment cases passed. A legacy screenshot encountered a closed test browser; its four-case file passed on rerun. Evidence: [suite](../execution/payments-web.log), [rerun](../execution/payments-web-retry.log). Paid receipt counts retain historical facts; review counts and the REVIEW_REQUIRED filter also include paid applications under a later mismatch hold, so these groups can overlap.

## SSLCommerz (Phase 5c, sandbox)

A second provider, **SSLCommerz** (cards and mobile wallets on one hosted page, API v4), runs beside bKash through the same `Gateway` interface and the same verification rules. Checked against the [SSLCommerz developer documentation](https://developer.sslcommerz.com/doc/v4/) on 15 November 2026.

- **Per-office merchant.** Each office admin saves its own store ID and store password (`PUT /api/v1/admin/payment-merchants/sslcommerz`; finance may read the status). The password is write-only, stored AES-256-GCM encrypted under `MERCHANT_SECRET_KEY` and bound to the office and environment (migration 031). One office can never collect through another's store; bKash keeps its deployment-level binding.
- **Environments.** SANDBOX works once saved. LIVE credentials can be saved but collect nothing until the deployment sets `SSLCOMMERZ_LIVE_ENABLED=true` — live merchant approval is the owner's business step.
- **Checkout.** `POST /applications/:id/payments` with `{ provider: "SSLCOMMERZ", requestKey }`. Astra opens a session (`gwprocess/v4/api.php`) with the exact fee and the invoice as `tran_id`, and redirects only to a `GatewayPageURL` on the expected SSLCommerz host. The provider's mandatory customer fields are sent as neutral values, not the citizen's personal data.
- **Return and IPN.** SSLCommerz POSTs the browser return and the IPN to `/api/v1/payments/sslcommerz/callback/:token`. The global origin guard admits only `sandbox.sslcommerz.com` / `securepay.sslcommerz.com` (or no Origin) on that one path. The opaque token finds the attempt and the returned `tran_id` must equal its invoice. Neither the return nor the IPN is proof of payment.
- **Verification.** A payment is accepted only when the session query (`merchantTransIDvalidationAPI.php?sessionkey=`) reports VALID/VALIDATED for the same invoice, amount and currency **and** order validation (`validationserverAPI.php?val_id=`) agrees. A risk-flagged payment (`risk_level` ≠ 0) or any disagreement is not accepted. The confirmation, receipt (number `…SSLC-…`, verification `SSLCOMMERZ_SESSION_QUERY_AND_VALIDATION`, enforced by the receipt trigger) and paid state commit together, exactly as for bKash; reconciliation reuses the same checks.
- **Not done here.** Live merchant credentials, real-money tests, refunds (5d) and bank payout reconciliation.

## Refunds (Phase 5d)

Refunds are their own audited state machine (`application_refunds`, migration 032): **REQUESTED → APPROVED → SENT → SETTLED**, or REQUESTED → REJECTED, or SENT → FAILED. The database enforces the allowed moves, keeps the request fields fixed, refuses deletion and allows one live refund per application.

- **Request.** The applicant (own application) or office staff/admin: `POST /api/v1/applications/:id/refunds` `{ reason, amountMinor? }` (default: the full verified payment; never more). Refused once a certificate has been issued.
- **Decide.** Office admin or finance: `POST /api/v1/refunds/:id/decision` `{ decision, note? }`; a rejection needs a reason. Approval sets the expected date (5 working days, Sunday–Thursday) and sends the refund at once.
- **Send once.** Astra stores its own `refund_trans_id` and marks the refund SENT **before** calling the SSLCommerz Refund API, so an unknown outcome is retried with the same id (the provider answers "processing" rather than refunding twice). The bank transaction id needed by the provider is kept in the payment confirmation evidence from order validation.
- **Settle.** `POST /api/v1/refunds/:id/refresh` asks the Refund Query API; only "refunded" settles it.
- **Effect.** From approval the application's payment state is REFUND_PENDING, then REFUNDED; neither satisfies issuance. The original payment, confirmation and receipt are never edited.
- **bKash** refunds use the v2 Refund API (`/refund/payment/transaction`, checked against developer.bka.sh on 15 November 2026). bKash completes a refund at once, so an approved bKash refund settles immediately. Following bKash's rule, Astra always calls Refund Status (`/refund/payment/status`) before a refund request, so a retry after an unanswered call never refunds twice. Refunds are possible for 60 days after payment.

## Office-owned bKash merchants

Following the guide's rule "credentials per office, never one global tenant binding", each office admin can now save the office's **own** bKash merchant in the Online payments tab (`PUT /api/v1/admin/payment-merchants/bkash`; finance may read the status). The merchant number and the four API credentials (app key, app secret, username, password) are stored encrypted under `MERCHANT_SECRET_KEY`, bound to the office, provider and environment (migration 035), and are never returned. The office's encrypted token cache uses a key derived from `MERCHANT_SECRET_KEY`, so no extra token key is needed. LIVE needs `BKASH_LIVE_ENABLED=true` on the deployment as before.

Checkout, verification, receipts and refunds use the office's own merchant. The older deployment-wide configuration (`BKASH_TENANT_ID` and the `BKASH_*` variables) remains only as a fallback for an office that has not saved its own merchant, and can be removed once offices have moved.
