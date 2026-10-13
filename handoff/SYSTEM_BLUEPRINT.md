# SYSTEM BLUEPRINT — OWNED UNION PARISHAD SaaS

## 0. Authority and product boundaries

- **IP owner:** one private platform owner; exclusive ownership of independently developed source code, SaaS product, infrastructure, product brand and licensing.
- **Customer:** each contracted, approved Union Parishad is a tenant, not a code owner.
- **Official authority:** authorization to issue a legal certificate remains with a properly appointed office official, irrespective of the platform owner.
- **Citizen data:** protection, permitted processing, retention, access and export subject to applicable laws and service contracts. Do not assume private ownership of citizens' personal records.
- **Reference:** replicate legitimate user-facing *capabilities*, not source code, seals, government designs or identity.

## 1. Reference coverage vs NEW proposal

| Capability | Reference evidence | Target implementation | Readiness |
|---|---|---|---|
| Public homepage, directory, login, registration, coverage, search, notices, FAQ | Public captured routes/forms | Recreate independently, Bangla-first responsive | Design/build |
| UDC citizen registration, lookup and citizen profile | UDC UI and form metadata | New citizen identity model and staff-assisted registration | Design/build |
| 47 service entries; 48 first-step forms | All initial service DOM forms | Versioned configurable service catalog and form renderer | Design/build |
| Application creation, listing, filtering and editing | Forms, lists and client flow | Persistent drafts, submit, review, correction, approve, reject | Partially unverified in reference |
| Renewal, trade license, biodata, holding information, printing | UI and forms | State-machine implementations with full lifecycle | Success paths unverified |
| Verification/QR and PDF certificate | Public/UDC entry points | Cryptographically hard-to-guess verification token, controlled public response, multilingual PDF | Success paths unverified |
| UDC points recharge and history | Screens/inputs and history filters | Implement own **per-tenant** credit ledger and subscription billing | New commercial specification |
| Other roles and SaaS owner portal | NOT audited | Newly specified owner, union approver and staff roles | New product features |

## 2. Four apps, one platform

- Public portal: accessible services, authority coverage, enrollment awareness, track status, verify issued certificate, help/policies.
- Citizen portal: registration/OTP, profile, allowed household/address data, applications, corrections, payments where authorized, downloadable issued certificates.
- Union portal: tenant office profile, service settings, UDC/counter staff, verified applicant lookup, review queues, approval, signed issuance, reprint, renewals, logs, municipal fee reporting.
- SaaS owner portal: onboarding, plans, tenant provisioning, subscription/credit management, invoices, top-ups, webhook/event status, discounts, feature flags, audit and service analytics.

## 3. Suggested TypeScript modular monolith

- Apps: `apps/web` (React, Vite, TypeScript, Tailwind), `apps/api` (Express/Node, TypeScript).
- Packages: `packages/ui`, `packages/shared-schemas`, `packages/config`.
- Storage: PostgreSQL (primary), Redis (jobs/cache), private S3-compatible objects (attachments, certificates), background worker (PDF, SMS/email, webhooks).
- Use SQL migrations, Zod request schemas, OpenAPI route contracts, policy-driven RBAC, tenant-scoped access and optional PostgreSQL RLS in depth.
- Local: `docker compose` for Postgres, Redis, MinIO and SMTP capture. Staging before production.
- Tests: unit and integration tests (Vitest), API contract checks, Playwright E2E, security/tenant boundary tests, migrations, automated CI.
- Build independent `/api/v1/...` endpoints. Reference paths are evidence of the old UI only; they are not your API design specification.

## 4. Minimum data model with boundaries

**Organization and identity**: `platform_users`, `tenants`, `tenant_offices`, `staff_memberships`, `roles`, `permissions`, `citizens`, `citizen_addresses`, `identity_verification_events`, `audit_events`.

**Service engine**: `service_catalog`, `service_versions`, `service_field_schemas`, `tenant_service_configuration`, `certificate_template_versions`, `service_fee_schedules`.

**Processing**: `applications`, `application_payload_versions`, `application_attachments`, `application_events`, `review_assignments`, `approval_steps`, `certificates`, `certificate_revisions`, `certificate_revocations`, `renewal_links`.

**SaaS billing**: `subscription_plans`, `tenant_subscriptions`, `plan_credit_grants`, `tenant_wallets`, `credit_ledger`, `credit_idempotency`, `payment_orders`, `payment_events`, `invoices`, `tenant_usage_rollups`.

**Official costs**: `government_fee_schedules`, `government_fee_assessments`, `government_payment_records` kept separate from SaaS wallets and invoices.

Always store `tenant_id` on tenant-owned rows. Unique constraints, FK constraints, row-level access policies and tests are mandatory. Sensitive identity details need column protections and strict authorized lookups; public QR lookup must reveal minimum information.

### Why a dynamic form engine?

The audit has 26 common order/payment forms and 21 specialized first-step forms, with repeatable heir rows, localized fields, file inputs and condition-dependent fields. Implement data-driven versioned schemas and a renderer; do not hard-code 47 unrelated pages with inconsistent validation. Preserve exact required/label findings **as evidence** but define final server validation independently with domain approvals. Field groups F01-F39 and C1 are reference *groupings*, not production ORM tables.

## 5. Application state machine (proposed)

`DRAFT → SUBMITTED → UNDER_REVIEW → CORRECTION_REQUIRED → RESUBMITTED → APPROVED → ISSUANCE_PENDING → ISSUED`

Alternative terminal paths: `REJECTED`, `CANCELLED`, `REVOKED` (post-issuance), `EXPIRED`. Re-open/correct using immutable versions and authorized transitions only. Log actor, time, before/after states and reasons. GET requests do not mutate records.

### First working vertical slice

Use **Permanent Resident Certificate (#45)** with synthetic data: citizen registration, one application, authenticated union review, authorized approval, document generation, QR verification, and one credit deduction upon issuance. Mark certificates `DEMO / NOT OFFICIAL` in development. Then test **Family (#2)** repeatable heir rows and **Trade License (#42)** multi-section form/renewal before scaling the engine to all 47. This gives breadth of form complexity with end-to-end proof.

## 6. Credit and subscription business design

- Subscription plans can grant recurring credits; tenants can buy extra top-ups; optional credit rollover/expiry is a **configurable policy to be approved**.
- Per-union wallet ledger is append-only. Idempotency key uniquely identifies issuance charge (`tenant_id + certificate_id + charge_kind`). Manual changes must be compensating entries with reason and admin audit; do not edit balances manually.
- At issuance: in ONE serializable/retryable DB transaction, lock wallet and issuance record; validate authorized final approval, sufficient credit and idempotency; finalize certificate record; debit ledger exactly once; publish outbox event. Retry safely after network failures. Transaction failure creates neither issued certificate nor partial debit.
- If insufficient credits: keep application APPROVED/ISSUANCE_PENDING with clear actionable message; do not issue or delete it.
- Billing currency/credits, plan limits, prices, free trial, payment provider and user-facing government fees are not specified by the reference. Keep configurable; do not invent prices or payment contracts.
- Payment callbacks: verify gateway signatures and amounts, idempotent event IDs, state machine, reconciled accounting. Sandbox first, live credentials/registration only by authorized owner.
- Differentiate old UDC points UI from new owner-controlled tenant subscription/credit semantics.

## 7. Certificate safety

- Access must require a legally authorized official and approved tenant configuration, never inferred solely from the logged-in UDC role.
- Use versioned templates, BN+EN font shaping, QR pointing to independent public verification of signed/opaque token, no raw NID/BRN in URL. Public verification returns only minimal status/office/service/issue date and an allowed partial name if approved by policy.
- PDF output is restricted until authorized; development and tests use DEMO watermark and synthetic fixture identities. Revocation/expiry reflected in public lookup.

## 8. Roadmap and deliverables

| Phase | Actual build | Must demonstrate to pass |
|---|---|---|
| P1 | PRD, complete source-traceability, UX sitemap, role/permission matrix, signed-off schema and state diagrams | Every observed service mapped; every unverified capability marked |
| P2 | Monorepo, Docker, PostgreSQL, auth, tenant scopes, RBAC, migrations | Local boot, repeatable migration, denied cross-tenant access |
| P3 | Service engine, citizen identity/profile, #45 vertical slice | Citizen to office review works in DB using synthetic data |
| P4 | Certificate PDF/QR/issuance + atomic debit | Valid/revoked lookup, one issuance charge, zero duplicate charges |
| P5 | All 47 service initial forms + constraints/conditional fields | Automated test of each form schema and saved payload |
| P6 | Union workflows, documents, corrections, search, trade-license renewal, biodata, holding and reports | Full scenarios via real backend, not mock responses |
| P7 | SaaS owner dashboard, subscriptions, credit purchases, invoices, gateway sandbox | Billing reconciliation + refund/reversal audit |
| P8 | Accessibility/BN fonts, reliability, rate limit, privacy, threat model, backup/restore, observability | Regression suite and recovery drill pass |
| P9 | Authorized staging and one-union pilot | Business acceptance, rollback plan, officials approval |
| P10 | Expand to eight tenants, operational support and rollout | All tenants isolated under production-like load |

Build in phases but preserve vertical integration throughout. Do not claim 47 fully working certificate workflows merely because 47 entry forms render.

## 9. Deliverables expected from Astra in Phase 1

1. `docs/PRD.md` with user stories and edge cases.
2. `docs/REFERENCE_PARITY.csv`: all 47 services, exact first-step fields and source evidence, verified / inferred / proposed flags, missing downstream behavior.
3. `docs/ROLES_AND_PERMISSIONS.md` including owner, union head, authorized approver, reviewer, UDC operator, finance, citizen.
4. `docs/WORKFLOW_STATES.md`, `docs/ERD.md` (mermaid), `docs/ARCHITECTURE.md`, `docs/SECURITY_AND_COMPLIANCE_GAPS.md`.
5. `docs/BILLING_SPEC.md` and an executable idempotency/atomicity test specification.
6. Prioritized GitHub-style milestones with testable Definition of Done.
7. A first vertically integrated runnable skeleton **only if workspace/repository is accessible**; never claim code was executed if it was only drafted.

### Evidence discipline

Each finding needs a source: audited DOM filename, public route, screenshot, or report page. Each speculative workflow needs label `PROPOSED`. Unknown = `UNVERIFIED`. Do not fill gaps by guessing existing system behavior.
