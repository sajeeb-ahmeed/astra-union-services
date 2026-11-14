# Phase 3 plan — citizen record and completeness

Status: **3a delivered (migration 024); 3b delivered (migration 025); 3c delivered (migration 026).** Owner decisions recorded 14 November 2026. Source: the parity execution guide, Phase 3 (G5–G7).

## Today

A citizen record holds the Bangla/English name, date of birth, the registered (permanent) address with division → ward geography, and a separate present address (PAR-06, migration 016). It has **no** gender, parents, spouse, blood group, NID or birth-registration number, mobile or document image. Identity stays `SYNTHETIC_DEMO`: nothing is checked against an external register.

## Owner decisions

| Question | Decision |
| --- | --- |
| Rolling out the completeness gate | **Warn first, enforce per office.** Every screen shows what is missing; issuance is refused for an incomplete profile only in offices whose admin switches enforcement on. Nothing in progress is blocked on deploy day. |
| Storing NID / birth-registration numbers | **Encrypted and printable** (AES-256-GCM with a new server key `CITIZEN_DATA_KEY`), plus a keyed digest for duplicate checks and a masked hint for lists. Without the key the server still runs; entering these numbers reports "not enabled". |
| What "100% complete" requires | Name (BN/EN), date of birth, registered address with geography (all already required), **plus an NID or birth-registration number, plus a mobile number or an explicit "no mobile" declaration.** Gender, parents, spouse, blood group and the document image are collected but optional. |
| Thana, post office/postcode, municipality and city-corporation wards | **Deferred** until the owner provides or chooses a documented source dataset. |

## Delivery, one pull request each

1. **3a — Citizen identity and personal fields.** Migration: gender (female / male / other), father, mother and spouse names (BN/EN), blood group (A+, A−, B+, B−, AB+, AB−, O+, O−), encrypted NID and birth-registration numbers with digest and hint (one record per number per office), contact mobile or a "no mobile" declaration. Citizen create/edit API and the staff and self-service forms; staff see full numbers, lists show hints.
2. **3b — Completeness.** One shared `citizenProfileCompleteness(citizen)` in `@astra/shared-schemas` returning a percentage and the missing items, used by the API and the web app. A per-office setting turns enforcement on; with it on, issuance is refused with the missing items listed, and with it off the approver sees a warning. Indicator on citizen screens and in the application flow.
3. **3c — Document image.** Optional NID/birth-registration image attached to the citizen through the existing quarantine and malware-scan pipeline (only a CLEAN scan is usable).

Each PR keeps existing records valid (new columns are nullable) and ships API and browser tests.

## 3b as built

- `citizenProfileCompleteness(citizen, { geographyRequired })` in `@astra/shared-schemas` returns `{ percent, complete, missing }`. The address area counts only in offices that use structured geography.
- `GET /api/v1/applications/:id` returns `profileCompleteness` (with `enforced`). Approvers see a warning, or a blocking notice in an enforcing office.
- `PUT /api/v1/admin/office/profile-completeness` `{ requireCompleteProfile }` (office admin only, audited `PROFILE_COMPLETENESS_ENFORCEMENT_CHANGED`). Off by default.
- With enforcement on, `POST /applications/:id/issue` returns `409 PROFILE_INCOMPLETE` with `issues.missing`; nothing is issued or charged.
- The citizen details panel (staff and the citizen's own profile) shows the same indicator.

## 3c as built

- `PUT /api/v1/citizens/:id/identity-document` `{ document: { attachmentId, kind: "nid" | "birth_reg" } | null }` (office staff/admin, or the citizen for their own record), audited as `CITIZEN_IDENTITY_DOCUMENT_LINKED` / `_REMOVED`.
- The image is uploaded through `POST /attachments`, so it is quarantined and can be opened only after a CLEAN scan.
- The database refuses a link to an attachment of another citizen or office (composite key `citizens_identity_document_own`).
- The citizen details panel shows the document, its scan status, and add/replace/remove controls.

## Not in Phase 3

Thana, post office and urban ward data (deferred), identity verification against a government register, and printing the new fields on certificates (that belongs to the certificate layout work in Phase 4).
