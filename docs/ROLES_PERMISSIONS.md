# Roles, permissions and issuing authority

The roles below are **new product policy**. Phase 0 observed a UDC interface; other role behavior and official appointment requirements were not verified. Runtime source: [app.ts](../apps/api/src/app.ts), database membership/authorization in [migration](../db/migrations/001_initial.sql). Role names do not establish legal authority.

## Implemented role matrix

`Own` means the citizen profile/application is linked to the current user. `Tenant` means only the server-selected active tenant. `Authority` additionally requires an active service-specific approval authorization. A dash means the API denies the action.

| Capability | Public | Citizen | Staff / UDC | Reviewer | Authorized approver | Tenant admin | Finance | SaaS owner |
|---|---|---|---|---|---|---|---|---|
| Service catalog/schema preview | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Minimal opaque-token verification | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Citizen search/read | — | Own | Tenant | Tenant | Tenant | Tenant | — | — |
| Register synthetic citizen | — | Own, if no profile | Tenant | — | — | Tenant | — | — |
| Create draft / edit eligible payload | — | Own | Tenant | — | — | Tenant | — | — |
| List/read applications | — | Own | Tenant | Tenant | Tenant | Tenant | — | — |
| Submit/resubmit/cancel eligible application | — | Own | Tenant | — | — | Tenant | — | — |
| Begin review / request correction | — | — | — | Tenant | — | — | — | — |
| Reject active submitted/review application | — | — | — | Tenant | Tenant | — | — | — |
| Approve current reviewed payload | — | — | — | — | Authority | — | — | — |
| Issue / retry DEMO certificate | — | — | — | — | Authority | — | — | — |
| Revoke certificate with reason | — | — | — | — | Authority | — | — | — |
| Download protected PDF | — | Own | Tenant | Tenant | Tenant | Tenant | — | — |
| Upload private attachment | — | Own | Tenant | — | — | Tenant | — | — |
| Download private attachment | — | Own | Tenant | Tenant | Tenant | Tenant | — | — |
| Read tenant wallet/ledger | — | — | — | — | Tenant | Tenant | Tenant | — |
| Read billing/plans/orders/invoices | — | — | — | — | — | Tenant | Tenant | — |
| Create/settle synthetic billing order | — | — | — | — | — | Tenant | Tenant | — |
| List tenant status/balance/subscription | — | — | — | — | — | — | — | Yes |
| Append compensating tenant credit adjustment | — | — | — | — | — | — | — | Yes, reason required |
| Published office directory and notices | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Create synthetic account | Yes | — | — | — | — | — | — | — |
| Renew eligible issued certificate | — | Own | Tenant | — | — | Tenant | — | — |
| Manage office profile, memberships, notices and service settings | — | — | — | — | — | Tenant | — | — |
| Grant/revoke demo service authority for active approver | — | — | — | — | — | Tenant, audited | — | — |
| Create/suspend/reactivate tenants | — | — | — | — | — | — | — | Yes |

Actual membership role values are `citizen`, `staff`, `reviewer`, `approver`, `admin` and `finance`. The global platform role is `owner`. Union-head administrative responsibilities can later be mapped to `admin`, but that role cannot approve/issue in this release. The office may separately appoint a legally authorized approver; real appointment onboarding is not implemented. The seeded approver's authority note explicitly says DEMO ONLY.

The SaaS owner owns the independent software and commercial platform; this is not an entitlement to inspect citizen records, approve an application, impersonate an official or issue a legal certificate. Owner billing routes are deliberate cross-tenant commercial operations. They set the target tenant context after owner policy checks and expose no citizen payloads. Adjustments append a reasoned ledger entry; they cannot rewrite existing accounting.

## Server-side authorization sequence

1. A valid server-side session must identify an active user. Existing sessions are checked against current membership and tenant state on every request; suspension denies sensitive access.
2. The tenant is loaded from the session's membership. Body/query tenant values cannot override it. The current release selects the first active membership at login; a deliberate account switcher is future work.
3. The route checks role before invoking a tenant-scoped database transaction. Citizen operations also join against `citizens.user_id`; knowing a UUID does not grant access.
4. PostgreSQL FORCE RLS restricts tenant rows and composite foreign keys prevent mixed-tenant associations. A non-superuser/non-bypass app role is used. The context is local to the transaction, preventing pool leakage.
5. Approval, issuance and revocation require `approval_authorizations(tenant_id,user_id,service_no)` to be active. Active user, approver membership and tenant are rechecked under share locks. Final issuance repeats this check after PDF preparation.
6. Workflow state and approved payload version must also match. Role permission alone cannot jump from draft to issue. Subscription, service enablement and credit checks are additional issuance conditions.

Rejection currently requires reviewer/approver role and tenant/state policy, without a separate service authorization. No review assignment table limits a reviewer to claimed applications yet. Those distinctions must be preserved in UI labels and future permission design.

## UI and audit behavior

Frontend controls are shown for the current role and eligible state. The API is the enforcement boundary; hidden buttons are not a security mechanism. Invalid role actions return 403; unavailable tenant records return generic 404. Tenant-scoped denied access is audited with attempted resource, actor, method/route and code without disclosing another tenant's record. Mutation events include actor and state; correction/rejection/revocation/cancellation and wallet adjustments require reasons.

Global owner denials and authentication failures do not yet have a dedicated immutable platform audit stream. Login throttling is in-memory, so distributed production authentication requires a shared limiter and security telemetry. Session management UI, delegated support access and impersonation are absent.

## Implemented administration and authority limits

Tenant administrators can create local accounts/memberships, change roles or activity, edit office profiles, publish notices, configure enabled services/integer credit costs and grant service-specific DEMO approval authority. They cannot remove their own administrative membership. Another admin must do that. Grants require an existing active approver in the same office and an audit reason; they never elevate an admin directly into issuing authority. A role change to approver still requires a separate grant. Owners can create an office and its administrator, but new offices start with zero credits and an expired subscription until sandbox funding. Suspension invalidates existing tenant sessions and hides the office publicly while preserving records.

Self-registration creates a synthetic citizen account/profile with a DEMO reference. Password changes verify the current password under a row lock and invalidate other sessions. This is a local development identity flow, with no real OTP/NID verification or email delivery. The active session can continue. The first-active-membership login rule is unchanged.

## Proposed authority design

Contracted production onboarding still needs staff invitations, appointment evidence, dated grant expiry and independent approval. Consider dual-control grant/revoke operations. Official service/fee/template changes need domain approval and version history beyond the demo service settings. Never derive legal authority from SaaS ownership or a dropdown role.

Add assignment-aware reviewer queues, multi-step approval policies and separation-of-duties constraints approved by each office. Owner support access, if permitted at all, should be a distinct limited, expiring, tenant-authorized permission with reason/audit and no automatic issuing authority. Lawful citizen identity/OTP, guardianship and consent flows must be defined before processing real applicants. No such external provider or government access is guessed here.

Evidence: AUTH-01/02, TEN-01/02, APP-03, CER-04 and SEC-02 in [integration tests](../apps/api/test/integration.test.ts), [backend log](../execution/clean-bootstrap.log), with actual browser role behavior in [TEST_MATRIX.md](TEST_MATRIX.md). See [state policy](CERTIFICATE_STATE_MACHINE.md) and [threat model](THREAT_MODEL.md).
