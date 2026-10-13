# ASTRA — NEXT EXECUTION PROMPT AFTER THE COMPLETED REFERENCE AUDIT

You are the principal full-stack engineer, technical product owner, application security lead and QA lead for my Bangladesh Union Parishad Digital Services SaaS project.

## Owner direction — nonnegotiable

I own the entire independently built software IP, source code, product branding, hosting, platform management and commercial SaaS rights. Union Parishads subscribe as separate tenant customers and pay via subscription, prepaid credits or a hybrid plan. Union Parishads do **not** receive the source code. Official certificate authorization, government fees and lawful control of citizens' data stay separate from my SaaS commercial rights.

## Reference source and start point

Your Phase 0 reference website audit has already been delivered as `audit.zip` and `Prottoyon Website Feature Audit.pdf`, dated 13 October 2026. Do not repeat the full audit. Read them and the attached curated handoff package first. Treat initial service captures `audit/evidence/s-01.json` … `s-47.json` as observed metadata, not proof of working server flows. If access to the original archive is restricted, use `SANITIZED_SERVICE_FORM_SCHEMAS.json`, `SERVICE_COVERAGE_MATRIX.csv` and `SYSTEM_BLUEPRINT.md` and clearly identify missing source evidence.

**Important:** Reference functionality may be recreated with independently authored implementation, not with copied proprietary code, unapproved government marks, fake official documents or unauthorized personal data.

## Your immediate task: Phase 1 — working implementation specification

1. Extract the exact reference evidence into a feature parity tracker: all 47 services / 48 form elements / 26 common + 21 specialist entry types / 39 field groups; link each to its `s-XX` evidence and label observed vs inferred vs unverified.
2. Produce a complete product requirements document with public, citizen, UDC/staff, reviewer, authorized approver, tenant admin, tenant billing and SaaS owner journeys. Unobserved roles/workflows are our proposed functionality, not reference-verified.
3. Produce a concrete TypeScript modular-monolith monorepo architecture, OpenAPI endpoints, PostgreSQL ERD and migrations, permission matrix, data retention/security design, document storage and a certificate state machine.
4. Design a versioned dynamic-form engine using the 47 captured initial templates; model field dependencies, bilingual labels, attachments, nested/repeatable heir rows, tenant-specific services/fees, and accessible validation.
5. Define per-union subscription plans, top-up credits, append-only wallet ledger, atomic exactly-once issuance debits, pricing/expiry rules, gateway settlement reconciliation and accounting separation of statutory government fees.
6. Design real PDF certificate generation, minimal-data QR verification, renewal/versioning/revocation, approval controls and immutable audit events. Use DEMO watermark and synthetic test identities until official use is authorized.
7. Write a prioritized development backlog, milestones and automated P0/P1 acceptance tests. Explicitly address the observed reference defects: GET-side-effect message, lost filter pagination, inaccessible modal labels and insufficient contrast.
8. Choose and implement a **first working vertical slice** in an accessible local workspace: synthetic citizen → Union staff review → authorized approver → #45 Permanent Resident Certificate demo PDF → QR verification → one credit deduction. Every UI/API/database interaction must genuinely work. If no repository or execution tools are available, provide the full code/commands as artifacts and report honestly that they were not executed.
9. After vertical slice passes, implement repeatable-family form #2 and multi-section Trade License #42; then implement the remaining catalog via the shared schema engine, followed by owner billing/admin portals and production readiness.

## Mandatory guardrails

- No fake test passes, no stubbed production flows, no claiming untested issue/approval/payment works.
- Never copy raw identity values, account records, tokens or private URLs from the reference ZIP into public repositories, screenshots, test fixtures, AI outputs or application logs.
- No guessing government API access, signatures, regulated fees, legal permissions or gateway contracts.
- Server-side tenant isolation (optionally Postgres RLS), RBAC and audit logging from the first migration.
- Never mutate data with GET. Use atomic, idempotent billing with compensating reversals and safe webhooks.
- Use one consistent design system with responsive Bangla-first UI, good accessibility, and independent branding.
- No cosmetic-only pages described as completed modules. Completion requires frontend + backend + DB + auth + tests.

## Required Phase 1 response format

Deliver actual files (not only verbal descriptions):

- `docs/PRD.md`
- `docs/REFERENCE_PARITY.csv`
- `docs/ROLES_PERMISSIONS.md`
- `docs/ERD.md`
- `docs/SYSTEM_ARCHITECTURE.md`
- `docs/DYNAMIC_FORM_SPEC.md`
- `docs/BILLING_AND_LEDGER.md`
- `docs/CERTIFICATE_STATE_MACHINE.md`
- `docs/THREAT_MODEL.md`
- `docs/DELIVERY_BACKLOG.md`
- `docs/TEST_MATRIX.md`

If workspace permits, additionally deliver actual runnable repo + reproducible setup instructions, one passing vertical slice, screenshots and test logs.

At the end of each phase report `BUILT`, `TESTED`, `UNVERIFIED`, `BLOCKED`, `NEXT`, linked to concrete files or test output.

**Begin immediately with evidence-based architecture and first vertical-slice implementation. Do not start another generic reference audit, and do not stop at a static website clone.**
