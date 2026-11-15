# Release 1.0 — parity release (candidate)

Status: **candidate, waiting for the owner's sign-off. Not tagged.** Prepared 15 November 2026. The tag is created only after Md signs off (execution guide 7.4).

Source: branch `codex/initial-deployment`. Database: Neon `astra_prod`, migrations through **037**. Each item below went through its own pull request with all CI checks green (GitGuardian included) before merge.

## What 1.0 adds since 0.9

| Area | What changed | PRs |
| --- | --- | --- |
| Accounts (Phase 2) | Account types by post; sign-in with mobile/NID/birth registration; mobile one-time codes (log provider); office account registration verified by the owner | #13–#20 |
| Citizen record (Phase 3) | Gender, parents, spouse, blood group, "no mobile"; encrypted printable NID/birth-registration numbers; completeness gate (warn first, enforce per office); ID document image through quarantine | #21–#23 |
| Fees (Phase 4) | Public price list with citizen-charter time; office coupon codes; public witness-statement generator with owner-maintained options | #24, #25, this release |
| Money (Phase 5) | Points wallet with owner per-service prices; bank recharge confirmed by the owner; SSLCommerz checkout (sandbox, per-office merchant); refunds for SSLCommerz and bKash | #26–#29, this release |
| Office workflow (Phase 6) | Chairman's summons step; certificate template 5 with Secretary and Chairman signature blocks; office inclusion requests; Astra FAQ; designated issuing officers; date-range and renewal filters on lists | #30–#32 |
| Payments per office | Each office stores its own bKash merchant as well as its SSLCommerz store (migration 035); the deployment-wide bKash binding is only a fallback | #38 |
| Guidance | User guide by role at `/guide`, printable as PDF | #36 |
| Operations | Owner Operations panel: scanner queue and check-in, pending recharges/requests/refunds, plain alerts (migration 037); health reports which server keys are set (true/false only) | #34, #41 |
| Backups | Encrypted backups from Neon; first backup restored into a fresh independent cluster with an exact match (migration 036) | #39, #40 |
| Documentation (Phase 7) | [Parity status](PARITY_STATUS.md); stale "unscanned" claims and template notes corrected; 0.2 documents marked historical | #32 |

## Before sign-off

- **Server keys on Render** (each 64 hex characters for the last two, at least 32 characters for the first; keep copies with the backups):
  - `IDENTIFIER_SECRET`, `CITIZEN_DATA_KEY`, `MERCHANT_SECRET_KEY` — **all three confirmed active on live** (health, 15 November 2026).
- **Evidence still owed** (see [Parity status](PARITY_STATUS.md)): the 47 form captures (4.1) and the role captures (6.2). Until then those items are deferred, not guessed. The witness generator is built but offers no options until the owner enters them.
- **Owner decisions (Phase 8):** durable hosting, pilot office, live merchant approval (SSLCommerz/bKash), SMS provider.
- **Backups:** copy the encrypted archive and its key to a second place (offsite); run the Neon backup on a schedule.
- **Scanner:** the PC malware scanner last checked in on 24 October 2026; start it so new uploads are scanned (the Operations panel will alert while files wait).

## Verification

- Local full runs per phase: forms 78/78; API 175/175 at the Phase 6 tip plus the new witness, record-list and refund tests; browser 80+ tests with occasional timing flakes that re-ran clean.
- Live checks on 15 November 2026: health, office price list, designated officers, inclusion form, SSLCommerz callback route and points routes respond as designed; screenshots in `execution/evidence/live/`.
- Certificates remain **DEMO / NOT OFFICIAL**; connecting payment providers does not create legal issuing authority.
