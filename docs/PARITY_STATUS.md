# Parity status — phases 2 to 6

Status as of **16 November 2026**. Source: the parity execution guide. This page re-scores the gap items the guide assigns to phases 2–6. The full G1–G25 matrix lives in the owner's gap-plan document; items not named in the guide's phase text are **not** re-scored here and should be checked against that document before sign-off.

Legend: **Done** — built, tested and merged. **Sandbox** — built and tested; live use needs an owner business step. **Deferred** — not built, with the reason. **Blocked** — waits for Phase 0 evidence the owner captures.

## Phase 2 — accounts and identity

| Item | Status | Where |
| --- | --- | --- |
| Account types by post, mapped onto roles | Done | [Phase 2 plan](PHASE2_PLAN.md), migration 020 |
| Sign-in with mobile / NID / birth registration (keyed digest) | Done (needs `IDENTIFIER_SECRET` on the server) | [Account security](ACCOUNT_SECURITY.md) |
| Mobile verification by one-time code | Done with the log provider; live SMS deferred until the owner chooses a provider | migration 022 |
| Email verification at registration | Done with the log provider (digest-stored one-use link, never a sign-in gate); live delivery needs the owner's SMTP account (`EMAIL_PROVIDER=smtp`) | migration 039, [Account security](ACCOUNT_SECURITY.md) |
| Office account registration with owner verification | Done | migration 023 |
| Upazila / district / divisional oversight accounts | Deferred (owner decision: separate jurisdiction-wide read path) | Phase 2 plan |

## Phase 3 — citizen record (G5–G7)

| Item | Status | Where |
| --- | --- | --- |
| Gender (incl. other), parents, spouse (BN/EN), blood group, "no mobile" | Done | migration 024 |
| NID / birth-registration numbers, encrypted and printable, one per office | Done (needs `CITIZEN_DATA_KEY`) | migration 024, [Account security](ACCOUNT_SECURITY.md) |
| Completeness gate, warn first, enforce per office | Done | migration 025 |
| NID / birth-registration image through quarantine | Done | migration 026 |
| Thana, post office/postcode, municipal and city wards, ownership type | Deferred (owner decision: needs a documented source dataset) | [Phase 3 plan](PHASE3_PLAN.md) |

## Phase 4 — services and checkout (G10, G11, G13)

| Item | Status | Where |
| --- | --- | --- |
| 4.1 Service form schemas v3 from captures | **Blocked** — the 47 capture files in `docs/evidence/prottoyon-forms/` are still unfilled templates | [Evidence](evidence/README.md) |
| Fee breakdown, language on the order | Done (already present before this phase) | [Order workflow](ORDER_WORKFLOW.md) |
| G10 per-service price list with citizen-charter time, public view | Done | migration 027 |
| G11 coupons | Done | migration 028 |
| G13 public witness generator | Done as a free public flow at `/witness` (utility PDF, nothing stored, 10/17-digit NID). The religion and certificate-type options are an **owner-maintained list** (migration 034) — empty until the owner enters them from the captures, so nothing is guessed | `apps/api/src/witness.ts` |
| 4.4 certificate layout | Done in DigitalUnion's own artwork: portrait A4, one Chairman signature block (template 6, Phase W); QR/token verification kept | migration-free, Phase 6a/W |

## Phase 5 — money (G8, G9)

| Item | Status | Where |
| --- | --- | --- |
| Points wallet, 1 BDT = 1 point, owner per-service prices, deduction at issuance | Done | migration 029, [Billing and ledger](BILLING_AND_LEDGER.md) |
| Bank recharge with slip, owner confirmation | Done (owner adds the deposit accounts) | migration 030 |
| Owner adjustments only through the ledger | Done (verified for credits and points) | Billing and ledger |
| Citizen payments via an aggregator, per-office merchants | **Sandbox** (SSLCommerz). Live needs the office's approved store, `MERCHANT_SECRET_KEY` and `SSLCOMMERZ_LIVE_ENABLED=true` | migration 031, [Gateway payments](GATEWAY_PAYMENTS.md) |
| Refund state machine, 3–5 working days shown | Done for SSLCommerz and bKash | migration 032 |
| Single `BKASH_TENANT_ID` binding | Done: bKash credentials are per office too (migration 035); the deployment-wide setting remains only as a fallback | Gateway payments |

## Phase 6 — office workflow (G16, G19, G20)

| Item | Status | Where |
| --- | --- | --- |
| Chairman verifies → approves = issues in one step; summon step; wet-sign statement. **No secretary step** (Phase W, owner decision 16 Nov 2026: citizen self-applies, the Chairman verifies and his approval issues the certificate; a blocked issuance records the approval and completes via the issue endpoint) | Done | [Certificate state machine](CERTIFICATE_STATE_MACHINE.md) |
| Manual verification console with role evidence | **Blocked** on the role captures (`docs/evidence/prottoyon-roles/`) | [Phase 6 plan](PHASE6_PLAN.md) |
| Print and renewal products as lists with lookup and date range | See Phase 6 plan (6c) | Phase 6 plan |
| Office inclusion requests, FAQ, designated issuing officers | Done; FAQ is DigitalUnion's own content, not the reference's 61 headings | Phase 6 plan |
| Citizen status notifications | Done: in-app feed (Phase W) plus email and status SMS on issuance and rejection (Phase X), sent after the decision commits through the mailer/SMS provider gates; real SMS delivery deferred until the owner chooses a provider | `apps/api/src/status-notifications.ts` |
| User guide | Done: bilingual guide by role at `/guide` (Citizens, office staff, Secretary, Chairman, office admin/finance, owner), printable as PDF. The owner can replace it with an official guide later | `apps/web/src/UserGuide.tsx` |

## Operations and recovery (Phase 8 groundwork)

| Item | Status | Where |
| --- | --- | --- |
| Encrypted backup of the live database | Done for Neon; first backup restored with an exact match (15 Nov 2026). Offsite copy and schedule are the owner's steps | [Hosted deployment](HOSTED_DEPLOYMENT.md) |
| Scanner and queue monitoring | Done: owner Operations panel with alerts | migration 037 |
| Confirm server keys without signing in | Done: health reports true/false per key | #34 |
| cPanel single-role deployment track | Done: bundle builder, single-role bootstrap/migration runner, Passenger entry, runbook; verified locally end-to-end (fresh single-role DB, boot, login, PDF). Live deploy awaits the owner's cPanel probe | [cPanel deployment](DEPLOY-CPANEL.md) |
| Demo → official issuance flip | Done: `ISSUANCE_MODE=official` flips health to OFFICIAL and drops certificate DEMO branding (honesty lines kept); default unchanged. Activation is the owner's decision | `apps/api/src/app.ts`, `apps/api/src/certificate-template.ts` |

## Before release sign-off (Phase 7.4)

- Owner fills the Phase 0 form and role captures, or accepts 4.1, 4.3 and 6.2 as deferred.
- Owner sets `IDENTIFIER_SECRET`, `CITIZEN_DATA_KEY` and `MERCHANT_SECRET_KEY` on Render and keeps copies with the backups.
- Owner decides on the remaining production items (Phase 8): durable hosting, pilot office, live merchant, SMS provider.
- **The release is tagged only after the owner's sign-off.**
