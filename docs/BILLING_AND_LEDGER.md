# Subscription billing and prepaid credit ledger

This is a new SaaS design, not a reconstruction of Prottoyon operator points. The software owner controls the independently authored product and future commercial configuration; each Union tenant has its own subscription and wallet. Official fees and authority to issue certificates remain separate.

## Implemented commercial fixture

| Item | Current executable behavior | Production decision |
|---|---|---|
| Currency | BDT with integer minor units; no floating-point amounts | Confirm lawful pricing/tax/invoice requirements |
| Plan | `demo-monthly`, 20 credits, 30-day duration, zero monetary price | Owner-approved commercial plans and contracts |
| Initial seed | 20 synthetic credits and subscription valid for 90 days per demo tenant | Trial/initial entitlement policy |
| Top-up | 1–100 credits per synthetic order; zero monetary price | Price per credit, limits and live checkout |
| Issuance cost | Tenant service configuration; seeded 1 credit for each operational demo service | Approved commercial service credit costs |
| Renewal | Settled plan order extends from `max(valid_until, now)` by configured plan days | Renewal cadence, cancellation and grace policy |
| Credit retention | Balance persists; plan metadata includes rollover but no expiry worker/credit lots exist | Rollover/expiry policy and explicit expirations |
| Settlement | Local HMAC sandbox and explicit synthetic settle action | Contracted live payment provider and reconciliation |

These amounts/credits are engineering fixtures, not approved commercial prices or statutory fees. The seeded plan's configured price is copied into subscription orders; top-ups have an explicit zero-value fixture price. Monetary values never move through this local demo.

## Append-only accounting

`credit_ledger` is the durable source of credit movements. Each row records tenant, integer `delta`, kind, unique idempotency key, actor, reason, balance after and timestamp. Kinds are `PLAN_GRANT`, `TOPUP`, `ISSUANCE` and `ADJUSTMENT`. Negative issuance entries must reference a certificate; non-issuance entries cannot reference one. Updates/deletes are rejected by an immutable trigger.

`tenant_wallets.balance` is a transactionally maintained cache. The application database role has **no UPDATE privilege** on this table. The owner-trusted ledger INSERT trigger, with a fixed `public,pg_temp` search path, locks the wallet, checks idempotency and sufficient balance, sets `balance_after` and updates the cache. PUBLIC has no execute permission on that trigger function. The narrow `lock_tenant_wallet()` function derives its target from the transaction-local tenant context and exposes a locking read only.

PostgreSQL requires UPDATE privilege for ordinary locking SELECTs. The dedicated helper avoids restoring wallet UPDATE privileges to the application. This behavior is documented in the [PostgreSQL 17 SELECT documentation](https://www.postgresql.org/docs/17/sql-select.html).

The tested invariant is `wallet.balance = sum(ledger.delta)` with a nonnegative integer balance. Tenant-scoped unique idempotency keys and a partial unique `(tenant_id, certificate_id)` issuance index provide additional protection. Duplicate seed grants do not change the wallet: the trigger checks for the existing key **after** taking the wallet lock, before any update.

## Atomic exactly-once issuance

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
    API->>DB: Lock active subscription and tenant wallet
    API->>DB: Insert certificate/PDF and one issuance debit
    API->>DB: Set ISSUED; append audit/event/outbox
    API->>DB: COMMIT
    DB-->>API: One certificate and one credit charge
    API-->>Official: PDF link and opaque verification URL
```

Document preparation happens before the final transaction. The transaction repeats authorization and state/version checks, so a suspension, revoked authorization or concurrent issue during rendering cannot slip through. The application, subscription and wallet are locked. Serialization/deadlock errors retry the complete transaction up to five retries. Concurrent callers may prepare redundant temporary PDFs; only one document record and charge commit.

Successful retry after a lost response returns the existing certificate, even when the application is already issued or subsequently revoked. There is no new debit. The natural operation identity is the tenant/application's unique certificate; its charge key is `issuance:<certificate_id>`. A certificate's PDF bytes are stored in the same PostgreSQL transaction as the charge, avoiding an external artifact/ledger commit gap in this slice.

Insufficient credits and expired/inactive subscription return HTTP 402 with an actionable code and leave the application `APPROVED`. No issued certificate, debit or outbox record commits. A database exception after the attempted debit rolls back document, charge, state and events together. The injected after-debit failure exists only when `NODE_ENV=test`.

An outbox record proves durable enqueueing, not SMS/email delivery. No delivery worker is implemented. Proposed workers must use idempotent recipients and auditable retries.

## Synthetic settlement and invoice flow

1. Tenant admin/finance creates a `topup` or `subscription` order. The server chooses plan entitlement, amount and currency from configuration; callers cannot provide an arbitrary amount.
2. The sandbox event contains `eventId`, `orderId`, `tenantId`, `amountMinor`, `currency` and `status='SETTLED'`. `X-Demo-Signature` is hex HMAC-SHA256 over the exact raw JSON bytes using an ignored runtime secret.
3. The webhook verifies signature before processing and checks the immutable server order's amount/currency. Invalid signature, unsuccessful status, unknown order or amount mismatch cannot grant credits.
4. A serializable transaction locks the order, stores the event/body digest, appends the one grant, updates subscription when relevant, marks the order settled, inserts a separate SaaS invoice and audits the event.
5. Same event/content is a safe replay. Reusing an event with changed content is rejected. A new event ID for an already settled order cannot grant again. Invoice uniqueness is `(tenant_id, order_id)`; grant key is `payment:<order_id>`.

The explicit `demo-settle` UI action constructs and signs a local synthetic event and invokes the same settlement service. It is not evidence of a bank/gateway callback, actual cash movement, production signature scheme or statutory receipt. Current payment event rows retain accepted signed settlements; a comprehensive failed-event inbox, provider polling and reconciliation dashboard are future work.

## Adjustments, revocation and government fees

Only the SaaS owner can append a wallet `ADJUSTMENT` through `/owner/tenants/:id/adjust`. A nonzero integer amount, an eight-character minimum reason, actor and audit event are required. A negative adjustment cannot produce a negative wallet. Existing rows are never edited. The owner has no official approval/issuance permission. Manual adjustment requests currently use a generated operation key; production support should add caller-supplied idempotency and dual-control approval before using them for financial corrections.

Revocation changes the certificate/public status and application history; it does **not** automatically reverse an issuance charge. A refund decision must create a separate compensating entry with reason and approval. General live refunds, chargebacks and gateway reversals are not implemented.

`government_fee_assessments` has separate amounts, authority references and status. No official fee schedule, collection endpoint or statutory payment record is configured; billing reports return `NOT_CONFIGURED_SEPARATE_ACCOUNTING`. Government amounts cannot be posted as SaaS wallet money or a SaaS invoice by the implemented API. Production requires office-approved schedules, official payment types/receipts and reports separate from commercial credit usage.

## Completion evidence and remaining gates

Release 0.2 adds tenant-scoped finance reports at `GET /reports` with inclusive `from`/`to` calendar dates interpreted as UTC. JSON summaries and CSV/PDF exports use real ledger entries and application state counts, with bounded ranges and row counts. `GET /invoices/:id/pdf` renders the persisted sandbox invoice and order for authorized finance/administrator users. Every output is a demonstration document; no payment is collected and it is not a statutory tax invoice. The browser and API suites verify exports, date boundaries, roles and protected downloads.

Sources: [API](../apps/api/src/app.ts), [DB transaction/retry](../apps/api/src/db.ts), [migrations](../db/migrations/), [OpenAPI](../apps/api/openapi.json). Tests WAL-01/02/03/04/05/06 and BILL-01/02 run against real PostgreSQL; [integration tests](../apps/api/test/integration.test.ts), [successful log](../execution/clean-bootstrap.log).

Before production: approve prices/fees/taxes, credit expiry/rollover and refund terms; define a ledger reconciliation and discrepancy response; configure provider credentials and sandbox certification; add failed-event ingestion, expiry/grace handling, operational alerts, adjustment idempotency/dual control, immutable external audit protection and encrypted recovery. The local database administrator remains trusted and can bypass application privileges; administrator access must be separated and audited.
