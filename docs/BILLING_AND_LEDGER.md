# Subscription billing and prepaid credit ledger

This is a new SaaS design, not a reconstruction of Prottoyon operator points. The software owner controls the independently authored product and future commercial configuration; each Union tenant has its own subscription and wallet. Official fees and authority to issue certificates remain separate.

**0.5 live update · 19 October 2026:** the separate bKash v2 citizen-fee checkout, verified receipt and gateway reconciliation module is deployed. [Release evidence](RELEASE_0_5.md) records 192 passing CI tests and 18 hosted API regression groups; live Bangla/English and mobile browser checks also passed. Hosted checkout remains disabled because merchant setup is absent, and genuine provider acceptance is unverified. Nagad and bank payout reconciliation are not integrated. There is no cash collection or manual mark-paid endpoint. See [gateway payments](GATEWAY_PAYMENTS.md) for the current contract and activation requirements.

## Implemented commercial fixture

| Item | Current executable behavior | Production decision |
|---|---|---|
| Currency | BDT with integer minor units; no floating-point amounts | Confirm lawful pricing/tax/invoice requirements |
| Plan | `demo-monthly`, 20 credits, 30-day duration, zero monetary price | Owner-approved commercial plans and contracts |
| Initial seed | 20 synthetic credits and subscription valid for 90 days per demo tenant | Trial/initial entitlement policy |
| Top-up | 1–100 credits per synthetic order; zero monetary price | Price per credit, limits and live checkout |
| Application fee (only chargeable moment) | Since migration 044 (18 Nov 2026) the platform fee settles **once, at the application's first successful submit**, inside the submit transaction (`settleApplicationFee` in `apps/api/src/billing.ts`, called from the submit path in `app.ts`). Issuance charges nothing. See "Charge at submit (current model)" below | Approved commercial service credit costs |
| Renewal | Settled plan order extends from `max(valid_until, now)` by configured plan days | Renewal cadence, cancellation and grace policy |
| Credit retention | Balance persists; plan metadata includes rollover but no expiry worker/credit lots exist | Rollover/expiry policy and explicit expirations |
| SaaS settlement | Local HMAC sandbox and explicit synthetic settle action | A separate approved commercial settlement integration; citizen bKash payments do not fund SaaS credits |

These amounts/credits are engineering fixtures, not approved commercial prices or statutory fees. The seeded plan's configured price is copied into subscription orders; top-ups have an explicit zero-value fixture price. Monetary values never move through this local demo.

## Charge at submit (current model, migration 044, 18 Nov 2026)

Credit is the platform's single currency and an application's first successful submit is its
only chargeable moment. `settleApplicationFee()` runs inside the submit transaction
(`apps/api/src/billing.ts:98-166`, called from the submit path in `apps/api/src/app.ts`) and
is idempotent: once `applications.fee_settled_at` is set, a rejection followed by an edit and a
resubmit of the same application never charges or consumes again.

1. **Subscription allowance** — an ACTIVE subscription covers the submit while the month's
   allowance lasts (the limit snapshotted on the subscription at activation; one row per
   application in `subscription_allowance_consumptions`). Recorded as `fee_method = ALLOWANCE`,
   `fee_credits = 0`.
2. **Free** — the service's current credit price is 0. Recorded as `fee_method = FREE`.
3. **Credit** — otherwise the service's current owner-published credit price (default 1 where
   unpublished, `service_credit_prices`, versioned with a mandatory reason) is debited from the
   payer the owner chose in the billing settings (`application_fee_payer`, office by default).
   Recorded as `fee_method = CREDIT` with one `credit_ledger` row of kind `APPLICATION_FEE`
   (idempotency key `application-fee:<application_id>`, unique per application).

If the fee cannot be taken, the submit fails and the application stays a draft — nothing is
charged and no work is lost: insufficient office credit returns HTTP 402
`APPLICATION_FEE_INSUFFICIENT`; citizen-pays with no payment rail yet returns HTTP 402
`CITIZEN_PAYMENT_UNAVAILABLE` (citizen payment is not implemented until Phase 7).

**Where the settlement surfaces.** Application reads (`GET /api/v1/applications/{id}`, the
application list, and transition responses — all `camelRow` of the application row) include
`feeSettledAt`, `feeMethod` (`CREDIT` | `ALLOWANCE` | `FREE`), `feeCredits` and
`feePriceVersion`. All four are `null` before the first successful submit, and stay `null` for
applications submitted before migration 044 (they are never retro-charged). The wallet ledger
row carries the same `application_id`, so `GET /api/v1/wallet` and the `GET /reports` finance
summaries tie each fee to its application.

**Ledger-history note.** `credit_ledger` kind `ISSUANCE` (one debit per certificate, key
`issuance:<certificate_id>`) is the **pre-044 historical model only**: rows written before
migration 044 keep their kind and still reconcile; no new `ISSUANCE` rows are written.
Post-044 rows for the platform fee are kind `APPLICATION_FEE`, linked to the application, not
to a certificate.

## Append-only accounting

`credit_ledger` is the durable source of credit movements. Each row records tenant, integer `delta`, kind, unique idempotency key, actor, reason, balance after and timestamp. Kinds are `PLAN_GRANT`, `TOPUP`, `ISSUANCE` (pre-044 rows only — see above), `APPLICATION_FEE` (post-044 platform fee) and `ADJUSTMENT`. Negative `APPLICATION_FEE` entries reference an application (`application_id`, unique per application); negative historical `ISSUANCE` entries reference a certificate; non-issuance entries cannot reference one. Updates/deletes are rejected by an immutable trigger.

`tenant_wallets.balance` is a transactionally maintained cache. The application database role has **no UPDATE privilege** on this table. The owner-trusted ledger INSERT trigger, with a fixed `public,pg_temp` search path, locks the wallet, checks idempotency and sufficient balance, sets `balance_after` and updates the cache. PUBLIC has no execute permission on that trigger function. The narrow `lock_tenant_wallet()` function derives its target from the transaction-local tenant context and exposes a locking read only.

PostgreSQL requires UPDATE privilege for ordinary locking SELECTs. The dedicated helper avoids restoring wallet UPDATE privileges to the application. This behavior is documented in the [PostgreSQL 17 SELECT documentation](https://www.postgresql.org/docs/17/sql-select.html).

The tested invariant is `wallet.balance = sum(ledger.delta)` with a nonnegative integer balance. Tenant-scoped unique idempotency keys and a partial unique `(tenant_id, application_id)` `APPLICATION_FEE` index (migration 044; the historical `(tenant_id, certificate_id)` issuance index covers pre-044 rows) provide additional protection. Duplicate seed grants do not change the wallet: the trigger checks for the existing key **after** taking the wallet lock, before any update.

## Atomic exactly-once issuance (no charge since migration 044)

Issuance no longer touches money: the platform fee was settled once at submit (see "Charge at
submit" above), so the issuance transaction locks the application, persists the certificate and
PDF, and records state/events/outbox — it does not lock the subscription or wallet and debits
nothing. The gates `SUBSCRIPTION_INACTIVE`, `INSUFFICIENT_CREDITS` and `POINTS_INSUFFICIENT`
are gone (`apps/api/src/app.ts`, Phase 3B note).

```mermaid
sequenceDiagram
    participant Official as Authorized demo approver
    participant API as API
    participant PDF as Chromium
    participant DB as PostgreSQL
    Official->>API: POST application/id/issue
    API->>DB: Read approved payload and current authority
    DB-->>API: Frozen approved version or existing certificate
    API->>PDF: Prepare real DEMO PDF/QR in memory
    PDF-->>API: PDF bytes
    API->>DB: BEGIN SERIALIZABLE + tenant context
    API->>DB: Lock application; recheck authority/version
    API->>DB: Return existing certificate if committed
    API->>DB: Insert certificate/PDF
    API->>DB: Set ISSUED; append audit/event/outbox
    API->>DB: COMMIT
    DB-->>API: One certificate, no charge
    API-->>Official: PDF link and opaque verification URL
```

Document preparation happens before the final transaction. The transaction repeats authorization and state/version checks, so a suspension, revoked authorization or concurrent issue during rendering cannot slip through. The application is locked. Serialization/deadlock errors retry the complete transaction up to five retries. Concurrent callers may prepare redundant temporary PDFs; only one document record commits.

Successful retry after a lost response returns the existing certificate, even when the application is already issued or subsequently revoked. There is no new debit — issuance never debits. A certificate's PDF bytes are stored in the same PostgreSQL transaction as the certificate record, avoiding an external artifact commit gap in this slice.

Historical (pre-044) issuance-charge model, kept for the record: issuance debited one credit per certificate (`issuance:<certificate_id>` key, `credit_ledger` kind `ISSUANCE`) plus the service's point price from the points wallet, and insufficient credits or an expired/inactive subscription returned HTTP 402 and left the application `APPROVED`. That model ended with migration 044 (18 Nov 2026); pre-044 ledger rows keep kind `ISSUANCE` and are never rewritten.

A database exception during the final transaction rolls back document, state and events together. The injected failure point keeps its historical name (`after-debit`, `NODE_ENV=test` only) and still proves the whole issuance transaction rolls back.

An outbox record proves durable enqueueing, not SMS/email delivery. No delivery worker is implemented. Proposed workers must use idempotent recipients and auditable retries.

## Synthetic settlement and invoice flow

1. Tenant admin/finance creates a `topup` or `subscription` order. The server chooses plan entitlement, amount and currency from configuration; callers cannot provide an arbitrary amount.
2. The sandbox event contains `eventId`, `orderId`, `tenantId`, `amountMinor`, `currency` and `status='SETTLED'`. `X-Demo-Signature` is hex HMAC-SHA256 over the exact raw JSON bytes using an ignored runtime secret.
3. The webhook verifies signature before processing and checks the immutable server order's amount/currency. Invalid signature, unsuccessful status, unknown order or amount mismatch cannot grant credits.
4. A serializable transaction locks the order, stores the event/body digest, appends the one grant, updates subscription when relevant, marks the order settled, inserts a separate SaaS invoice and audits the event.
5. Same event/content is a safe replay. Reusing an event with changed content is rejected. A new event ID for an already settled order cannot grant again. Invoice uniqueness is `(tenant_id, order_id)`; grant key is `payment:<order_id>`.

The explicit `demo-settle` UI action constructs and signs a local synthetic event and invokes the same settlement service. Because it signs with the server's own secret, the route exists only when `DEMO_SETTLE_ENABLED=true`; in every other case (including `NODE_ENV=production` without the flag) it answers 404 as if unregistered, and the UI hides the button (`GET /api/v1/billing` reports `demoSettleEnabled`). It is not evidence of a bank/gateway callback, actual cash movement, production signature scheme or statutory receipt. These legacy SaaS payment events retain accepted signed synthetic settlements. They remain separate from the 0.5 citizen-fee gateway events, query/search verification and reconciliation register.

## Adjustments, revocation and government fees

Only the SaaS owner can append a wallet `ADJUSTMENT` through `/owner/tenants/:id/adjust`. A nonzero integer amount, an eight-character minimum reason, actor and audit event are required. A negative adjustment cannot produce a negative wallet. Existing rows are never edited. The owner has no official approval/issuance permission. Manual adjustment requests currently use a generated operation key; production support should add caller-supplied idempotency and dual-control approval before using them for financial corrections.

Revocation changes the certificate/public status and application history; it does **not** automatically reverse the submit-time application fee (a pre-044 issuance charge is likewise not reversed by revocation). A refund decision must create a separate compensating entry with reason and approval. General live refunds, chargebacks and gateway reversals are not implemented.

The legacy billing report flag `NOT_CONFIGURED_SEPARATE_ACCOUNTING` is not the 0.5 citizen-payment source of truth. The older, never-used `government_fee_assessments` table was dropped by migration 018 (see [DECISIONS.md](DECISIONS.md)). Since 0.4, versioned `service_order_policies` and `application_order_snapshots` preserve each office's accepted statutory, processing, urgency and delivery fees. The 0.5 gateway tables separately store checkout intent, provider confirmation, receipt and reconciliation observations. No statutory tariff is inferred from the reference invoice or code defaults.

For an approved positive-fee application, checkout uses its exact saved total and one durable intent. The public bKash callback verifies the saved payment identity and provider signature before any execution claim; confirmation additionally requires matching Query Payment and Search Transaction responses. Immutable confirmation and PDF receipt commit together. No citizen-fee payment adds SaaS credits or creates a SaaS invoice. Issuance checks approval (plus the order-payment, profile, service and renewal gates in the state machine); the platform fee was already settled at submit and issuance debits nothing.

The current application payment state becomes `REVIEW_REQUIRED` if a later decisive gateway check mismatches an earlier confirmed payment. New issuance is held until a later `MATCHED` observation restores eligibility. The original receipt, confirmation and existing certificate are preserved; this is neither a refund nor an edited payment history. See [gateway payments](GATEWAY_PAYMENTS.md) for recovery limits and one-attempt semantics.

## Completion evidence and remaining gates

Historical release 0.2 added tenant-scoped finance reports at `GET /reports` with inclusive `from`/`to` calendar dates interpreted as UTC. JSON summaries and CSV/PDF exports use real ledger entries and application state counts, with bounded ranges and row counts. `GET /invoices/:id/pdf` renders the persisted sandbox SaaS invoice for authorized finance/administrator users. These outputs remain demonstration documents and are not statutory tax invoices. Their historical browser/API results do not establish 0.5 provider acceptance. The new citizen-payment register and daily gateway CSV use Asia/Dhaka dates and keep bank settlement explicitly `NOT_CONNECTED`.

Sources: [API](../apps/api/src/app.ts), [DB transaction/retry](../apps/api/src/db.ts), [migrations](../db/migrations/), [OpenAPI](../apps/api/openapi.json). Tests WAL-01/02/03/04/05/06 and BILL-01/02 run against real PostgreSQL; [integration tests](../apps/api/test/integration.test.ts), [successful log](../execution/clean-bootstrap.log).

Before real collection: obtain approved merchant credentials, complete genuine bKash sandbox acceptance, verify receiving-merchant and callback bindings, authorize controlled live acceptance, and resolve pending-attempt operations. Local mock-provider tests establish software behavior only. Also approve prices/fees/taxes, credit expiry/rollover and refund terms; configure bank payout reconciliation, operational alerts, adjustment idempotency/dual control, immutable external audit protection and encrypted recovery. The local database administrator remains trusted and can bypass application privileges; administrator access must be separated and audited.

## Points wallet (Phase 5a)

Beside the credit wallet above (owner decision "keep both"), each office has a **points wallet**: 1 point = ৳1, held in poisha as integers (`point_wallets`, `point_ledger`, migration 029). The same discipline applies: the append-only `point_ledger` is the source of truth, the balance is a cache written only by the owner-trusted `apply_point_ledger()` trigger, `astra_app` cannot update balances, and every wallet equals the sum of its entries (tested). Kinds are RECHARGE, ISSUANCE (pre-044 rows only — issuing no longer deducts points, see below), ADJUSTMENT and REVERSAL; historical ISSUANCE entries name their certificate and are unique per certificate.

- **Prices.** The platform owner sets one price per service for all offices (`POST /api/v1/owner/point-prices/:no`, versioned with `expectedVersion`; `service_point_prices` is append-only and records who, when and why). 0 or no price means no deduction.
- **Issuance (retired with migration 044, 18 Nov 2026).** Issuing a certificate no longer deducts points (and no longer debits credits — see "Charge at submit" above). `point_ledger` kind `ISSUANCE` rows exist only for certificates issued before migration 044; they keep their kind and are never rewritten. The per-service point prices below remain settable and readable, but nothing spends points now; converting funded point balances is an owner decision, not a defined conversion.
- **Adjustments.** `POST /api/v1/owner/tenants/:id/points/adjust` writes an ADJUSTMENT entry; a client `requestKey` makes a retried request apply once. Balances cannot go negative.
- **Views.** Offices see their balance, prices and recent movements on the billing page (`GET /api/v1/wallet/points`); the owner sets prices and adjusts offices in Platform management.
- **Managed PostgreSQL.** The wallet triggers run as the migration owner, which forced row-level security also restricts when it is not a superuser, so migration 029 gives that owner explicit policies (as migration 009 does).

## Bank recharge of points (Phase 5b)

- The owner keeps the list of deposit accounts (`PUT /api/v1/owner/recharge-banks/:code`; switched off, never deleted).
- An office admin or finance user sends `POST /api/v1/recharges` with amount, account, deposit reference, deposit date (not in the future) and the deposit slip. The slip is stored as an office document (`attachments.purpose='recharge_proof'`, no citizen; migration 030) and goes through the same quarantine and malware scan; it is not reachable through the citizen attachment routes. A deposit reference can fund one live request per bank (`409 DEPOSIT_ALREADY_USED`); a rejected reference may be sent again.
- The owner works the cross-office queue (`GET /api/v1/owner/recharges`, metadata only through `owner_recharge_queue()`), opens a slip only after a clean scan, and decides with `POST /api/v1/owner/recharges/:id/decision` inside that office's tenant context. Confirming requires a clean slip and credits exactly one RECHARGE ledger entry keyed `recharge:<id>`; rejecting requires a reason. A decided request is final (database trigger), and every step is audited.
