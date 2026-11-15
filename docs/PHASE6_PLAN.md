# Phase 6 plan — office workflow completion

Status: **6a and 6b delivered; 6c planned** (15 November 2026). Source: the parity execution guide, Phase 6 (G16, G19, G20 and print products).

## What can be built now, and what waits for evidence

Phase 0 role captures (one Secretary and one Chairman session, `docs/evidence/prottoyon-roles/`) and the form captures are **not yet filled in**. Items that depend on them are flagged, not guessed.

| Item | Can build now | Waits for |
| --- | --- | --- |
| 6.1 Approval chain | Secretary (reviewer post) verifies → Chairman (approver post) approves, already in the state machine. Add the Chairman's **"summon the applicant"** step with a note, the plain statement that the Chairman wet-signs the printed certificate, and Astra's own two signature blocks on the certificate (template v5). | Exact labels and any extra states seen in the role captures. |
| 6.2 Manual verification console | The owner account-request queue (Phase 2d) exists. | Role evidence for what a verifier checks. |
| 6.3 Print and renewal products | Lists with single-field lookup and a date range for certificate renewal, trade-licence renewal, certificate reprint, BioData, holding and witness prints, each with its own PDF through the existing pipeline. | The observed search fields per list (until then: reference number, name, mobile, date range). |
| 6.4 Public content | Office-inclusion request flow; Astra's own FAQ describing Astra's behaviour (not the reference's 61 headings, which are not in the repository); user-guide PDF slot; office profile **Designated issuing officers** (from approval assignments). Directory, notices and price list already exist. | The 61 FAQ headings, if the owner wants topic-by-topic coverage. |

## 6b as built

- `POST /api/v1/public/office-inclusion-requests` (public, 5 per hour per address; mobile normalised) and the owner queue `GET/POST /api/v1/owner/office-inclusion-requests[/:id/status]` (NEW → CONTACTED → ACCEPTED or DECLINED with a reason; migration 033). Accepting does not create an office; the owner onboards it with the existing flow.
- Help page answers come from `apps/web/src/faq.json`: twenty questions written for Astra about how Astra works, in Bangla and English, searchable. They do not claim to match the reference system's 61 headings, which are not in the repository.
- Office public page: **Designated issuing officers** — approvers with active authority, by name, post and number of services (no contact details).
- Not done: the user-guide PDF slot, until the owner provides a guide document.

## Delivery, one pull request each

1. **6a — Approval chain:** summon step, wet-sign notice, certificate signature blocks.
2. **6b — Public content:** office-inclusion requests (public form → owner queue), FAQ, user-guide slot, designated issuing officers.
3. **6c — Print and renewal lists** with lookup and date range.
