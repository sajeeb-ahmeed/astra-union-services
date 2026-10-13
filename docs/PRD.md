# Product requirements — release 0.2

Astra is an independently owned multi-office citizen-services platform. The commissioning user owns the original software/source/branding; office customers subscribe to hosted use. Software ownership does not establish legal certificate authority or ownership of citizen information. Third-party software remains under its respective licenses.

## Scope and evidence

Phase 0 reference audit is complete. The nine curated handoff files record 47 services, 48 initial forms, 26 common/21 specialist entries, 39 F-groups plus C1 and 217 distinct named data controls. They prove initial UI metadata, not unseen server success. Exact previews remain separate from independently authored operational validation. Do not reclassify original success paths as verified based on Astra tests.

## Delivered journeys

| User | Journey and acceptance |
|---|---|
| Public | Discover services, filter/page offices and notices, read help, save feedback/preferences, track submitted status and verify opaque QR. No private identities in status responses |
| Citizen | Create synthetic account, update own profile/password, prepare/submit applications, correct immutable versions, follow status, download/reprint/renew permitted documents and generate private information copies |
| Staff | Register/find synthetic citizens, assist applications and copies within own office; cannot review/approve by staff status alone |
| Reviewer | Review submitted/resubmitted applications, request reasoned corrections or reject; cannot issue |
| Authorized approver | Explicit service grant, approve reviewed version, issue/retry/revoke DEMO certificate, retaining one charge per certificate |
| Tenant admin | Office profile, memberships, service switches/cost, notices, scoped assisted account recovery and finance access; approval needs separate role/grant |
| Finance | Persistent subscription/top-up sandbox, orders/invoices, ledger/report exports; no citizen-content access |
| Owner | Onboard/suspend offices, view commercial summaries, append reasoned compensating credits, resolve public feedback; no direct citizen or issue access |

## Functional requirements

1. Every enabled service uses a published versioned schema; forms validate on client and server. Conditions, bilingual values, repeated heirs/family/corrections and private file handles work. All 47 are demonstrated end to end.
2. Application changes create immutable payload versions. State transitions require role/current authority and legal preceding state. GETs never save, charge or transition.
3. Approval is tied to a specific payload version. Issuance atomically persists the PDF/certificate/debit/state/audit/outbox after rechecking current permission, subscription and balance. Retry returns the existing certificate.
4. Renewal derives tenant/citizen/service from the prior issued source; it cannot cross tenants, reuse a superseded source or bypass review. Rejection/cancellation releases an abandoned active successor. Revocation remains visible via existing QR.
5. Lists provide retained search/filter behavior. Private copies support safe retry and saved history. Billing dates use UTC explicitly. Reports distinguish SaaS credits from unconfigured government fees.
6. Recovery uses an authorized office administrator, expiring hashed single-use token and revoked sessions. No external identity verification is fabricated. Notification and support storage are functional even though outbound delivery is not connected.
7. The responsive public design resembles the civic information architecture of the reference, with original Astra assets/branding, accessible labels/focus/errors and role-specific workspace navigation.

## Nonfunctional requirements and acceptance

PostgreSQL tenant RLS/composite keys; active memberships checked per request; input validation, hashed passwords/tokens, CSRF/Origin checks, security headers and no sensitive error output. PDF jobs block remote resources and have bounded concurrency. Private artifacts are no-store. Built assets are compressed/cached. Migrations, initialization, tests and local encrypted restore are reproducible. See TEST_MATRIX.md and DEPLOYMENT.md for actual execution boundaries.

## Explicit integration decisions

Identity/OTP providers, official appointment evidence, eligibility/template wording, statutory fees/taxes, live gateway contracts, commercial prices/refunds/credit expiry, malware scanning, lawful retention/hosting, operational keys, outbound notification providers and production recovery/availability objectives require owner/domain/provider decisions. Current values are synthetic engineering fixtures, not guessed policies. The next milestone is authorized staging/provider/domain acceptance, described in DELIVERY_BACKLOG.md.
