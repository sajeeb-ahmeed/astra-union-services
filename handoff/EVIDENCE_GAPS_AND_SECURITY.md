# EVIDENCE GAPS, LIMITATIONS AND DATA SAFETY

## Confirmed scope

Public screens, UDC dashboard, citizen record operations, 47 first-stage service forms, 61 FAQ headings, review of common fees UI, application list/renewal/printing screens, and operator points recharge/history were captured as UI/DOM evidence. Source PDF: `audit/output/Prottoyon Website Feature Audit.pdf`, pages 1–30. Raw evidence in `audit.zip` remains the authoritative capture set.

## NOT confirmed by the audit

- Registration OTP delivery, secure reset, admin approval and UDC account provisioning end-to-end.
- Other authenticated roles (union chair/secretary, official approver, finance, citizen portal).
- Server-side validation of any of the 47 forms; submissions, save/approval flow, final certificate issuance, actual PDF content, revocation.
- Payment gateway callbacks, money movement, recharge settlement, wallet debits, refund reconciliation.
- Real API response schemas for AJAX calls; external JS scripts failed retrieval; exact REST contracts do not exist in evidence.
- Comprehensive mobile/responsive, keyboard, screen reader, accessibility, security pen testing, database/source inspection.
- Successful integration with NID/Birth Registration systems or authority to access such services.

## Specific evidence-backed design pitfalls to fix, not copy

1. `GET /portal/udc/existing/application/apply` produced a message indicating preliminary save; do not attach mutations to GET routes.
2. Union coverage filter was lost on next pagination page; preserve query state.
3. FAQ/service heading contrast needs WCAG checks.
4. Some modal titles did not match content.
5. Wallet result range sometimes displayed 0-to-0 despite populated rows.
6. Notices page did not consistently surface newer entries seen via search.
7. CSRF token appeared in read-only query strings; avoid leaking secrets in URLs.
8. Native required controls and accessible labels were inconsistent; generate accessible controls from the new schema.
9. Reused deceased/heir fields in unrelated services require product review, not blind cloning.

## Private evidence policy

The original archive includes captured DOM text, record-specific pages and URLs. Automated inspection found several files containing phone/identity-like strings and record-specific URL data. Whether any individual sequence identifies a real person was not verified; treat them as sensitive regardless. Do not circulate raw `audit.zip` outside authorized project staff, paste its raw text into prompts indiscriminately, or commit it to any public repo. Do not include any raw personal record fixtures in tests. This handoff contains no captured citizen values or record URLs.

The source PDF states personal names, balances and concrete IDs were excluded from the **report**. That promise does not extend automatically to every raw JSON evidence capture in the accompanying ZIP.

## Authorization and legal gates

- Independently confirm written permission to run the software for a Union Parishad, and office authority/signatory requirements.
- Confirm allowed data processing, retention, cross-office access, hosting location, fees, public verification disclosure, refunds and audit responsibilities with appropriate counsel/authority.
- Never substitute demonstration seals/signatures for official credentials.
- Deactivate legal certificate issuance in development and initial staging until approvals are granted.
