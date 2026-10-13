# Prottoyon Audit → Astra Phase 1 Handoff

Prepared from the 13 October 2026 `audit.zip` with independent ZIP-inventory and metadata reconciliation. **This is a planning/handoff package, not a completed system.**

## What has been validated from the bundle

- 47 distinct service selectors in 10 service categories, with 47 initial entry pages.
- 48 form elements total across the 47 service captures. Service 42 (Trade License) includes a secondary existing-license verification form.
- 26 service entries open a common order/payment page; 21 start on specialist additional-information pages.
- 217 distinct named non-hidden data field names, excluding named submit/button fields; 25 hidden field names; 39 reusable documented group definitions.
- `api-summary.json` reports 10 distinct inline JavaScript AJAX endpoint/method pairs, 81 distinct form endpoint/method pairs across broader captured pages. **Neither means backend success is verified.**
- Public citizen/account/office registration, union coverage, search, certificate status/verification, notices/FAQ and one authenticated UDC role were documented.
- 30 rendered final PDF QA page images exist. The PDF in `audit.zip` exactly matches the separately uploaded `Prottoyon Website Feature Audit.pdf` by SHA-256.

## Critical evidence limits

- Other authenticated administrative roles, citizen dashboard, successful submission, issuance, official digital signing, successful PDF generation/printing, actual transaction settlement, refund handling, and completed renewals were NOT validated.
- The original site backend/source/database were not inspected; client-inferred API details are NOT official API contracts.
- UI metadata is sufficient to design the form engine, but no screenshot was captured for every distinct specialist service page; exact pixel-level parity is unsupported.
- 47 forms are **initial step metadata only**, not proof of the full form-to-issuance journey.
- Some existing-application GET navigation displayed a premature preliminary-save notice; design the new system so GET has no mutation side effects.

## Commercial architecture, separate from reference

User owns the full SaaS IP, code, domain, infrastructure and pricing. Union offices are isolated SaaS customers. Each tenant gets an organization account and subscription + optional prepaid credit wallet. Implement 100% independent code and branding. A tenant wallet is not automatically the same as a UDC operator points wallet visible in the reference. Government fees and owner SaaS fees must remain distinct.

## Files

1. `ASTRA_NEXT_EXECUTION_PROMPT.md` – paste this with handoff in Astra; begins Phase 1 without repeating Phase 0.
2. `SYSTEM_BLUEPRINT.md` – modules, data model, workflows, architecture, billing, phases and quality gates.
3. `SERVICE_COVERAGE_MATRIX.csv` – 47 rows; editable implementation tracker.
4. `SANITIZED_SERVICE_FORM_SCHEMAS.json` – observed field metadata for initial 47 pages and all 48 forms.
5. `REFERENCE_AJAX_INVENTORY.json` – only observed/inferred endpoint and parameter metadata.
6. `ACCEPTANCE_TESTS.md` – exact release-critical tests.
7. `EVIDENCE_GAPS_AND_SECURITY.md` – audit limits and careful data handling.

## Handling the original `audit.zip`

Treat the original ZIP as **private**. Its DOM captures can include account records, identifier-like values or record-specific URLs even though the PDF excluded them. Do not upload raw evidence into a public Git repository, store it in prompt logs unnecessarily, or redistribute without removing sensitive information. Do not treat this derived package as a substitute for approved hands-on verification.
