# Phase 5 plan — money parity (points, recharge, citizen payments, refunds)

Status: **5a delivered (migration 029); 5b delivered (migration 030); 5c delivered to sandbox (migration 031); 5d delivered for SSLCommerz (migration 032).** Owner decisions recorded 14 November 2026. Source: the parity execution guide, Phase 5 (G8, G9). Ledger invariants from [billing and ledger](BILLING_AND_LEDGER.md) must not regress.

## Owner decisions

| Question | Decision |
| --- | --- |
| Points and the existing credits | **Keep both.** Credits stay for the SaaS plan and its per-issuance credit charge. Points are a second, separate wallet for per-certificate fees: 1 BDT = 1 point, kept in poisha (two decimals, e.g. ৳15.75). |
| Who prices a certificate in points | **The platform owner, per service**, one price list for all offices. Versioned and audited; a service without a price costs no points. |
| Who confirms a bank recharge | **The platform owner**, in an owner queue. The office uploads its deposit slip, which goes through the existing quarantine and malware scan. |
| First citizen payment aggregator | **SSLCommerz**, sandbox first. Live merchant onboarding is the owner's business step; the build stops at sandbox. |

## Delivery, one pull request each

1. **5a — Points wallet and owner price list.** `point_wallets` + append-only `point_ledger` (integer poisha, kinds RECHARGE / ISSUANCE / ADJUSTMENT / REVERSAL, idempotency key, balance after, no direct balance edits) maintained by a trigger like the credit ledger. Owner per-service point prices (versioned). The issuance transaction deducts the current price exactly once per certificate (unique per certificate), with `402 POINTS_INSUFFICIENT` leaving the application approved. Office wallet page; owner adjustment through the ledger only. Reconciliation test: balance = sum of entries.
2. **5b — Bank recharge.** Owner-managed bank list. Office recharge request (amount, bank, deposit reference, deposit slip as a quarantined office document). Owner confirms (points credited by one ledger RECHARGE entry, idempotent) or rejects with a reason. Full audit trail.
3. **5c — Citizen payments through SSLCommerz.** A `PaymentProvider` interface, with the existing bKash adapter as the reference for execute-once and double verification. Per-office merchant credentials (encrypted), replacing the single `BKASH_TENANT_ID` binding. Sandbox only; validation API checked before any order is marked paid.
4. **5d — Refunds.** Order refund state machine: requested → approved → sent to provider → settled (or failed), with the 3–5 working day expectation shown to the citizen, ledger-reconciled and audited.

## Not in Phase 5

Live merchant credentials and real money movement (owner's business step), Nagad/Rocket direct integrations beyond what the aggregator provides, and tax/invoice rules for points (owner decision before production).
