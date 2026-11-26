# Office fees and application order workflow

**0.5 source update · 17 October 2026:** bKash v2 checkout, receipts and gateway reconciliation are implemented, with merchant setup absent and checkout disabled. This document does not assert 0.5 QA, CI, deployment or real-provider acceptance. See [gateway payments](GATEWAY_PAYMENTS.md) and the separate release evidence.

Historical **0.4.0** evidence remains: 162 local/CI tests, 11 local managed PostgreSQL groups, nine hosted order, six historical-readback and five geography groups passed. [Release 0.4 evidence](RELEASE_0_4.md) pins its exact deployed commit, migration and network closure; those results are not substituted for 0.5 verification.

The user confirmed two product rules: a separate chairman/approver account grants approval, and each union configures statutory service fees separately from processing fees. The follow-up reference audit retrieved an existing approved trade PDF and processing invoice; it did not execute a new reference payment, approval or issuance. See [process parity](PROCESS_PARITY.md) and [sanitized observations](../execution/reference-workflow-observations-2026-10-13.json).

## Implemented workflow

The common frontend now starts with citizen selection, then an enabled service and blank service facts. An explicit synthetic example remains available in local demonstration mode. Changing the citizen clears unsaved service facts. Exact DigitalUnion application/certificate reference lookup opens an authorized record for viewing, download or the existing renewal flow.

An office administrator publishes a fee policy for each service. The application screen offers its permitted delivery/urgency choices and one certificate language, displays a server-calculated fee assessment, and requires review before saving. The server atomically creates the draft, payload version and accepted order snapshot. Submission, review/correction, separate authorized approval, issuance and QR verification continue through the existing state machine.

Policy-backed drafts and corrections retain their selected language. Their detail screen displays that immutable choice instead of offering an edit that the server would reject. A different certificate language requires a new application. Renewal accepts a fresh current-policy assessment rather than silently copying the original fee snapshot.

The 0.5 source inserts online payment after separate application approval: an available bKash merchant connection creates checkout for the exact positive saved total. A verified provider confirmation and stored receipt are required before new issuance. Missing/unconfirmed payment or a later `REVIEW_REQUIRED` mismatch blocks issuance with `402 ORDER_PAYMENT_REQUIRED`. With merchant setup absent, hosted checkout remains disabled and no real payment is claimed. Nagad and cash collection are not implemented. An explicitly configured zero total retains the existing authorized DEMO issuance; the platform fee was already settled once at submit and issuance debits nothing (migration 044 — the pre-044 "exactly-once SaaS credit debit at issuance" no longer applies). Quotations never become receipts or paid flags.

> **Correction note (Phase 4 Stage 3, 2026-11-26 — D-1/D-8):** bKash checkout uses the office's own saved merchant connection; the deployment-wide `BKASH_TENANT_ID` configuration is only a fallback for an office that has not saved its own merchant (migration 035; see [gateway payments](GATEWAY_PAYMENTS.md)). Nagad and cash remain unimplemented.

The browser return URL only selects an authorized application. The server verifies the saved callback identity/signature, claims execution at most once, then queries/searches the provider to match the amount, invoice, currency, transaction and merchant. A later mismatch preserves the immutable receipt but holds new issuance until a later matching check. Existing issued certificates and receipt bytes remain unchanged. Bank payout reconciliation and refunds are outside this milestone; see [gateway payments](GATEWAY_PAYMENTS.md).

## Accounting and configuration

| Category                                 | Representation                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| Citizen statutory service fee            | Office/service policy amount; integer BDT minor units.                                       |
| Processing, urgency and delivery charges | Separate assessment components, summed with statutory fees.                                  |
| Tenant SaaS platform fee                 | Integer-credit wallet and append-only ledger; settled **once at the application's first submit** as kind `APPLICATION_FEE` (migration 044) — issuance debits nothing and pre-044 `ISSUANCE` rows are historical only. Separate from citizen money. |

BDT 1.00 equals 100 minor units. Each component is explicitly configured from 0 through 100,000,000 minor units; empty amounts are rejected. These bounds are engineering limits, not recommended tariffs. The observed reference processing charge of BDT 15.75 is one sample and is not a default.

The administrator enters statutory, processing, urgency, office-collection and digital-copy amounts; chooses nonempty delivery/urgency lists; and supplies a publication reason. A new policy version never changes previously accepted orders. Concurrent publication uses `expectedVersion`; a conflict requires reloading and reviewing the latest policy. Fee-setting permission does not grant approval or signing authority.

## API contract

All order paths below are under `/api/v1`, authenticated and scoped to the active tenant. Mutations also require CSRF. [OpenAPI](../apps/api/openapi.json) contains request/response schemas. If regenerating older order additions with `node scripts/update-order-openapi.mjs`, run `node scripts/update-payment-openapi.mjs` afterwards to restore the current payment projections and 0.5 contract.

| Method/path                               | Behavior                                                                                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /services/:no/order-options`         | `{ configured, policy }`; absent policy is `null`, not an approved zero fee.                                                                          |
| `POST /admin/services/:no/order-policies` | Admin-only immutable publication with `expectedVersion`, reason and all explicit amounts/options; returns 201.                                        |
| `POST /services/:no/order-quote`          | Citizen/staff/admin read-only calculation from `{ preferences }`; no persisted quote, reservation or charge.                                          |
| `POST /applications`                      | Adds optional `order` to the existing citizen/service/payload request; required when a policy exists. Recalculates and saves its snapshot atomically. |
| `GET /applications/:id`                   | Adds `order`, containing the immutable snapshot or `null` for legacy applications.                                                                    |
| `POST /applications/:id/renew`            | Accepts optional payload and fresh order; current policy applies even when the original application was legacy.                                       |
| `GET /applications/lookup?reference=…`    | Exact full DigitalUnion application UUID or certificate number. Citizen-own/tenant-staff scope; no cross-site or prefix lookup.                              |

Policy amounts are `statutoryFeeMinor`, `processingFeeMinor`, `emergencySurchargeMinor` and `deliveryFeesMinor: { office_collection, digital_copy }`. `deliveryModes` is a nonempty unique subset of `office_collection` / `digital_copy`; `urgencies` is a nonempty unique subset of `normal` / `urgent`. `expectedVersion` is 0 initially, otherwise the current version. Publication reason is trimmed, 3–500 characters.

`order` is `{ policyVersion, preferences }`. Preferences are exactly:

```json
{
  "addressBasis": "registered_profile",
  "certificateLanguage": "bn",
  "deliveryMode": "office_collection",
  "urgency": "normal"
}
```

Certificate language is `bn` or `en`; historical bilingual applications remain compatible. Registered profile/current tenant is the only address/office basis in this slice. There are no applicant-supplied tenant, signer, price, total or paid fields. Delivery selection does not imply outbound email/SMS integration or physical dispatch tracking.

The quote returns `policyVersion`, `preferences`, `currency: "BDT"`, four `{ code, amountMinor }` components, `totalMinor` and `paymentStatus: "NOT_COLLECTED"`. Snapshot reads additionally include application/service IDs and creation time; positive-fee `paymentStatus` is a read-time projection of gateway evidence (`NOT_COLLECTED`, `PENDING`, `COLLECTED` or `REVIEW_REQUIRED`), without rewriting saved preferences/amounts. The separate payment-summary route reports zero-fee `NOT_REQUIRED`; zero-fee assessment snapshots keep their original marker. There is no quote ID or expiry; creation and renewal recheck the current policy version. Missing orders, stale versions and unavailable policies return 409. Invalid modes, malformed inputs or disagreement with payload `delivery_language` return 422. No generic application-create retry deduplication is claimed.

## Persistence and historical behavior

[Migration 011](../db/migrations/011_application_orders.sql) adds append-only `service_order_policies`, `application_order_snapshots` and immutable `applications.order_mode`. Both new tables use forced tenant RLS and tenant-composite foreign keys. The DB validates snapshot components against their policy and requires a snapshot for a policy-origin application. Shared/exclusive configuration locks serialize acceptance against policy publication.

Pre-migration applications retain `LEGACY` origin. Services without a policy can still create explicitly identified legacy demo drafts; this is not an assertion of zero or paid fees. Once a policy exists, new applications and renewals require it. Publishing a tariff does not reprice existing legacy drafts, accepted orders or issued PDFs. The interface states when no policy is configured.

Order preferences and fee amounts remain immutable during permitted payload correction. Submission/resubmission validates language consistency. Issue checks the payment gate before PDF creation and again in the transaction that commits certificate/state/ledger changes. Existing certificate retries return the historical stored document; approval grants, subscription and credit rules retain their existing boundaries.

## Historical 0.4 verification and release record

Local execution passed **72 form + 63 API + 27 web = 162 tests**, including order-policy roles and isolation, integer quote arithmetic with no writes, stale/tampered orders, immutable snapshots and origin, corrections/language, historical legacy behavior, current-policy renewal, exact-reference ownership, positive-fee issuance blocking and zero-fee concurrent exactly-once issuance. Browser coverage includes blank citizen-first intake, bilingual/mobile fee review and delayed policy-response isolation.

The separate managed PostgreSQL check passed **11 groups** on a fresh isolated database with all **10 migration files through `011_application_orders.sql`**. It verified non-superuser initialization, restricted runtime privileges, forced RLS and append-only order tables. The dependency audit reported zero vulnerabilities. See [release evidence and logs](RELEASE_0_4.md), including the corrected initial browser timing failure.

Source implementation, local automated/API/browser verification and [Linux release CI](https://github.com/sajeeb-ahmeed/astra-union-services/actions/runs/39020055573): **passed**. Hosted migration 011, deployment `dep-db9jt9m1egvs73fi5bbg` of commit `de8a0c335aa2315e8ff03faf2e9100fcf7492622`, nine order groups, six historical-readback groups and five geography groups: **passed**. Existing-office tariffs were not configured by migration or QA. [Live browser checks](../execution/orders-live-browser-qa.json) passed bilingual fee retention, mobile layout, blank citizen-first intake and quote/acceptance gating without creating new domain records. See the [release evidence](RELEASE_0_4.md).

The 0.5 addition is documented in [gateway payments](GATEWAY_PAYMENTS.md). Its local mock-provider verification, release CI and hosted migration must be reported separately from the historical results above. Genuine provider sandbox/merchant acceptance is still required before enabling real collection. Next operational milestone: merchant onboarding, provider acceptance and recovery procedures; service-specific geography, expanded addresses and official signing remain separate parity gaps. Complete reference-process equivalence is not claimed.

## Public price list and citizen-charter time (Phase 4a)

A fee policy version may state a citizen-charter service time (`charterDays`, 1–365, optional; migration 027). Each office's public page (`GET /api/v1/offices/:slug`) lists every enabled service with its latest published fee (statutory + processing), urgent surcharge, delivery fees and charter time. A service without a published policy is shown as "fee not yet published", never with an invented price.

## Coupon codes (Phase 4b)

- Office admins manage coupons at `GET/POST /api/v1/admin/coupons` and switch them on or off with `PATCH /api/v1/admin/coupons/:code` (finance may read). Coupons are never deleted, because fee snapshots refer to them.
- A coupon is a percentage (1–100) or fixed taka discount on the assessed total, optionally for listed services, inside a validity window and up to a redemption limit (migration 028). Codes are case-insensitive and stored upper-case.
- `POST /services/:no/order-quote` and the application `order` accept `couponCode`. The quote adds a negative `coupon_discount` line; `totalMinor` is the net amount and never below zero. A coupon that is unknown, off, outside its dates, not for this service or used up returns `422 COUPON_INVALID`.
- The discount is stored on the immutable order snapshot (`coupon_code`, `discount_minor`). The database recomputes it with `coupon_discount()` on insert, so a snapshot cannot carry an invented discount. Each use is an append-only `coupon_redemptions` row; the coupon row is locked while applying, so the limit holds under concurrency.
- Payment and issuance use the net total: a coupon that brings it to zero means no payment is needed.
