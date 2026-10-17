# Office fees and application order workflow

**Release 0.4.0 · 17 October 2026 · LIVE; local, CI and hosted API verification passed.** The suites passed 162 tests and 11 separate local managed PostgreSQL groups. Hosted verification passed nine order, six historical-readback and five geography groups. See [release evidence](RELEASE_0_4.md) for the deployed commit, migration, network closure and evidence scope.

The user confirmed two product rules: a separate chairman/approver account grants approval, and each union configures statutory service fees separately from processing fees. The follow-up reference audit retrieved an existing approved trade PDF and processing invoice; it did not execute a new reference payment, approval or issuance. See [process parity](PROCESS_PARITY.md) and [sanitized observations](../execution/reference-workflow-observations-2026-10-13.json).

## Implemented workflow

The common frontend now starts with citizen selection, then an enabled service and blank service facts. An explicit synthetic example remains available in local demonstration mode. Changing the citizen clears unsaved service facts. Exact Astra application/certificate reference lookup opens an authorized record for viewing, download or the existing renewal flow.

An office administrator publishes a fee policy for each service. The application screen offers its permitted delivery/urgency choices and one certificate language, displays a server-calculated fee assessment, and requires review before saving. The server atomically creates the draft, payload version and accepted order snapshot. Submission, review/correction, separate authorized approval, issuance and QR verification continue through the existing state machine.

Policy-backed drafts and corrections retain their selected language. Their detail screen displays that immutable choice instead of offering an edit that the server would reject. A different certificate language requires a new application. Renewal accepts a fresh current-policy assessment rather than silently copying the original fee snapshot.

This milestone **does not collect money**. A positive assessed total blocks new issuance with `402 ORDER_PAYMENT_REQUIRED`. An explicitly configured zero total may continue through authorized DEMO issuance and the existing exactly-once SaaS credit debit. Quotations never become receipts or paid flags. Existing historical documents remain stored and unchanged.

## Accounting and configuration

| Category                                 | Representation                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| Citizen statutory service fee            | Office/service policy amount; integer BDT minor units.                                       |
| Processing, urgency and delivery charges | Separate assessment components, summed with statutory fees.                                  |
| Tenant SaaS issuance credit              | Existing integer-credit wallet and append-only issuance ledger; separate from citizen money. |

BDT 1.00 equals 100 minor units. Each component is explicitly configured from 0 through 100,000,000 minor units; empty amounts are rejected. These bounds are engineering limits, not recommended tariffs. The observed reference processing charge of BDT 15.75 is one sample and is not a default.

The administrator enters statutory, processing, urgency, office-collection and digital-copy amounts; chooses nonempty delivery/urgency lists; and supplies a publication reason. A new policy version never changes previously accepted orders. Concurrent publication uses `expectedVersion`; a conflict requires reloading and reviewing the latest policy. Fee-setting permission does not grant approval or signing authority.

## API contract

All paths below are under `/api/v1`, authenticated and scoped to the active tenant. Mutations also require CSRF. [OpenAPI](../apps/api/openapi.json) contains request/response schemas; regenerate these additions with `node scripts/update-order-openapi.mjs`.

| Method/path                               | Behavior                                                                                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /services/:no/order-options`         | `{ configured, policy }`; absent policy is `null`, not an approved zero fee.                                                                          |
| `POST /admin/services/:no/order-policies` | Admin-only immutable publication with `expectedVersion`, reason and all explicit amounts/options; returns 201.                                        |
| `POST /services/:no/order-quote`          | Citizen/staff/admin read-only calculation from `{ preferences }`; no persisted quote, reservation or charge.                                          |
| `POST /applications`                      | Adds optional `order` to the existing citizen/service/payload request; required when a policy exists. Recalculates and saves its snapshot atomically. |
| `GET /applications/:id`                   | Adds `order`, containing the immutable snapshot or `null` for legacy applications.                                                                    |
| `POST /applications/:id/renew`            | Accepts optional payload and fresh order; current policy applies even when the original application was legacy.                                       |
| `GET /applications/lookup?reference=…`    | Exact full Astra application UUID or certificate number. Citizen-own/tenant-staff scope; no cross-site or prefix lookup.                              |

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

The quote returns `policyVersion`, `preferences`, `currency: "BDT"`, four `{ code, amountMinor }` components, `totalMinor` and `paymentStatus: "NOT_COLLECTED"`. Snapshot reads additionally include application/service IDs and creation time. There is no quote ID or expiry; creation and renewal recheck the current policy version. Missing orders, stale versions and unavailable policies return 409. Invalid modes, malformed inputs or disagreement with payload `delivery_language` return 422. No generic application-create retry deduplication is claimed.

## Persistence and historical behavior

[Migration 011](../db/migrations/011_application_orders.sql) adds append-only `service_order_policies`, `application_order_snapshots` and immutable `applications.order_mode`. Both new tables use forced tenant RLS and tenant-composite foreign keys. The DB validates snapshot components against their policy and requires a snapshot for a policy-origin application. Shared/exclusive configuration locks serialize acceptance against policy publication.

Pre-migration applications retain `LEGACY` origin. Services without a policy can still create explicitly identified legacy demo drafts; this is not an assertion of zero or paid fees. Once a policy exists, new applications and renewals require it. Publishing a tariff does not reprice existing legacy drafts, accepted orders or issued PDFs. The interface states when no policy is configured.

Order preferences and fee amounts remain immutable during permitted payload correction. Submission/resubmission validates language consistency. Issue checks the payment gate before PDF creation and again in the transaction that commits certificate/state/ledger changes. Existing certificate retries return the historical stored document; approval grants, subscription and credit rules retain their existing boundaries.

## Verification and release record

Local execution passed **72 form + 63 API + 27 web = 162 tests**, including order-policy roles and isolation, integer quote arithmetic with no writes, stale/tampered orders, immutable snapshots and origin, corrections/language, historical legacy behavior, current-policy renewal, exact-reference ownership, positive-fee issuance blocking and zero-fee concurrent exactly-once issuance. Browser coverage includes blank citizen-first intake, bilingual/mobile fee review and delayed policy-response isolation.

The separate managed PostgreSQL check passed **11 groups** on a fresh isolated database with all **10 migration files through `011_application_orders.sql`**. It verified non-superuser initialization, restricted runtime privileges, forced RLS and append-only order tables. The dependency audit reported zero vulnerabilities. See [release evidence and logs](RELEASE_0_4.md), including the corrected initial browser timing failure.

Source implementation, local automated/API/browser verification and [Linux release CI](https://github.com/sajeeb-ahmeed/astra-union-services/actions/runs/39020055573): **passed**. Hosted migration 011, deployment `dep-db9jt9m1egvs73fi5bbg` of commit `de8a0c335aa2315e8ff03faf2e9100fcf7492622`, nine order groups, six historical-readback groups and five geography groups: **passed**. Existing-office tariffs were not configured by migration or QA. [Live browser checks](../execution/orders-live-browser-qa.json) passed bilingual fee retention, mobile layout, blank citizen-first intake and quote/acceptance gating without creating new domain records. See the [release evidence](RELEASE_0_4.md).

Next milestone: verified citizen payment collection with separate receipts/reconciliation and authorized provider or counter-collection rules. Service-specific geography adapters, expanded citizen addresses and official signing remain separate parity gaps. Source code uses independent Astra contracts; complete reference-process equivalence is not claimed.
