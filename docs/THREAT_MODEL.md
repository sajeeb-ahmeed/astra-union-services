# Astra 0.2 threat model and security boundaries

This records implemented controls and remaining risks for the independent demonstration system. It is not a penetration-test certification or legal-compliance determination. The reference audit did not establish private server/database details or successful official issuance/payment behavior; those limits remain unchanged.

## Assets and trust boundaries

Protected assets include credentials/session/recovery tokens, citizen records, application history/private uploads, approval grants, certificate/print PDFs, QR tokens, subscriptions/wallet/ledger, HMAC secrets and backups. Fixtures are synthetic. Original private audit material is excluded from the app and source delivery.

Browser input is untrusted. The API derives identity/tenant context and validates role/state/ownership. FORCE RLS supplements that trusted context: compromised DB service credentials can select another scope and must never be issued to tenants. Migration/backup administrators can bypass normal controls and need separate custody. Local Chromium is a separate renderer. Public SECURITY DEFINER functions expose narrow safe projections with fixed search paths and restricted execution privileges. Sandbox webhook requests are protected by HMAC, not a live gateway contract.

Software ownership does not authorize unrestricted citizen access. Lawful processing, retention, hosting and official authority must be settled by the responsible parties before real data.

## Controls and residual risks

| Threat | Implemented control and evidence | Remaining boundary |
|---|---|---|
| Tenant IDOR/context tampering | Session scope, citizen ownership joins, FORCE RLS, composite FKs, generic unavailable-record errors; DB/API/browser tests | RLS trusts the service's tenant context; privileged DB access needs external governance |
| Suspended/stale access | Active user/membership/tenant checked each request; suspension hides public office and blocks existing sessions | First-active-office login; no office switcher, MFA or full session UI |
| Administrative escalation | Scoped memberships/grants; admin cannot remove own administration; grants require active approver | Official appointment evidence, grant expiry and dual control are absent |
| Recovery replay/escalation | 256-bit token, hashed storage, 15-minute expiry, transaction-locked one-use redemption, eligibility recheck, all-session expiry; concurrency/expiry tests | Excludes owner/admin/foreign/multi-office accounts. Manual trusted delivery only; token-bearing logs/screenshots must stay private |
| Credential attacks/CSRF | Salted scrypt, generic login errors, hashed sessions, HttpOnly/SameSite/Secure cookies, CSRF and exact Origin checks including public authentication | Rate limits are process-local per-IP, not distributed. Public fixture passwords are development-only |
| XSS/clickjacking | React/HTML escaping, CSP, frame denial, no-sniff and restrictive referrer/permissions headers; security tests | Formal dependency/XSS review and production browser verification remain |
| SQL injection/error leakage | Bound SQL, strict Zod/shared validation, generic API errors | Non-wallet app-role privileges trust the service; service compromise is a separate threat |
| Duplicate/partial issuance | Serializable retry, row locks, unique certificate/app and debit/cert, atomic PDF/ledger/state/audit/outbox; concurrent/fault tests | External signing/storage would require equivalent consistency |
| Wallet/history manipulation | App wallet UPDATE revoked; fixed-search-path ledger trigger/lock helper; append-only accounting/payload/event/audit/schema triggers | Administrator can alter triggers. Compromised service can insert ledger entries; external tamper evidence is future work |
| Renewal substitution | Same tenant/citizen/service trigger/FKs, one active successor, source lock/recheck; cross-tenant/revocation/concurrency tests | Legal eligibility, expiry and supersession policies remain undefined |
| Forged/replayed settlement | Raw HMAC, authoritative amount/currency/order, immutable event and grant/invoice uniqueness | Zero-money sandbox only; no provider contract, refund flow or bank reconciliation |
| Public privacy/enumeration | 256-bit QR tokens, minimal verify/track projections, public lookup throttling, private drafts/payloads excluded | Shared limiter, security telemetry and token-disclosure policy remain |
| Malicious uploads | 2 MiB cap, MIME signature/end markers, private applicant handles, protected download; invalid/oversize/IDOR tests | UNSCANNED; not a full parser, active-content sanitizer or malware scan |
| Renderer exhaustion/injection | Escaped text, embedded QR, remote requests blocked, 15-second content load, four active/32 queued, 503 backpressure, browser failure reset | No production load/CPU/memory benchmark, isolated renderer container or formal Chromium audit |
| Utility/report data leakage | Private idempotent print records/snapshots, scoped reports, UTC date bounds, safe CSV and protected PDFs | Holding/witness/biodata prints do not verify official registries or statutory receipts |
| Evidence/log secret leak | Curated metadata and synthetic fixtures; runtime/backup keys excluded from source; public responses minimized | Production log redaction, secret scanning and access review must be maintained |
| Availability/recovery | PostgreSQL transactions, indexes/pagination, compressed assets, readiness and encrypted local restore proof | No executed Docker/cloud rollout, production RPO/RTO, offsite custody, HA or capacity certification |

Sources: [API](../apps/api/src/app.ts), [management](../apps/api/src/management.ts), [HTTP hardening](../apps/api/src/http-hardening.ts), [renderer](../apps/api/src/pdf.ts), [migrations](../db/migrations/), [tests](../apps/api/test/). [TEST_MATRIX.md](TEST_MATRIX.md) distinguishes executed assertions from remaining work.

## Identity and official use

Signup/staff registration creates `SYNTHETIC_DEMO` profiles with DEMO references. Calendar-valid dates, self-entered service facts and uploads are not identity verification. No lawful NID/BRN/OTP provider, biometric check, legally appointed signatory or official certificate integration is configured. Offices/plans remain demo-constrained and PDFs clearly say DEMO/NOT OFFICIAL; there is no casual official-mode switch.

All47 independent workflows function, but domain owners must approve eligibility, sensitive fields, guardianship, templates, appointment authority, statutory fees, disclosure and expiry. The administrator grant UI records demonstration authority only. Local passing tests cannot verify the reference site's unknown backend behavior.

## Data handling and retention

| Data | Current handling | Required production decision |
|---|---|---|
| Citizen/service facts | Tenant-private profile/payload with synthetic label | Minimization, lawful identity/consent, sensitive-field access and retention |
| Applications/history | Immutable versions/events; controlled edits; no deletion route | Holds, governed corrections/disposal/anonymization and subject requests |
| Uploads/PDFs | Private DB bytes; authenticated routes; uploads UNSCANNED | Quarantine/scanning, encryption, document expiry/disposal |
| Credits/payments/invoices | Append-only SaaS records separate from statutory assessments | Commercial retention, refunds/reconciliation and approved fee policy |
| Recovery/sessions | Hashed tokens, expiry, one-use redemption/session invalidation | Cleanup, secure admin delivery and monitored recovery policy |
| Feedback/subscription interest | Explicit persisted requests; owner resolution; no delivery claim | Abuse, consent/retention, contact access and unsubscribe/delivery policy |
| Reference evidence | Private archive outside app fixtures/delivery | Authorized custody/sharing/deletion; never publish captured identities |

No jurisdiction-specific retention duration is invented. Append-only history protects integrity but does not implement legally governed erasure. Tenant export/closure is absent and requires explicit scoped authorization, encrypted delivery, retention/holds, session revocation and audit. Owner commercial permissions do not authorize unrestricted citizen exports.

## Encryption and privileged operations

Password/token hashes are not encryption of profile fields or files. Local PostgreSQL stores payload/artifact bytes and protected QR tokens at the database layer. Production needs transport/disk/backup encryption, managed keys/rotation and separated service/migration/backup roles.

Ignored `.runtime` credentials/HMAC files are local convenience, not a secret manager. Source archives exclude runtime databases, keys and backups. The local recovery drill uses authenticated AES256-GCM and checks schema/ledger consistency; offsite storage, separate key custody and operational restore targets remain unverified. Never publish recovery tokens, cookies, real applicants or runtime secrets in logs/screenshots.

Narrow definer functions have fixed search paths/restricted execution. They do not make PostgreSQL a tenant-facing SQL service. Administrators retain powerful access and need custody, access reviews and independent audit.

## Deployment and release gates

Production startup rejects missing HTTPS origin, restricted DB URL or unique HMAC secret. Proxy trust accepts one explicitly configured literal IP and optional loopback; broad CIDRs and untrusted forwarded headers are rejected. Mixed-case routes receive the same rate limits as lowercase routes. Docker/Compose/Caddy examples and initialization scripts exist, but Docker/hosted TLS execution was unavailable and is unverified. Windows real-PostgreSQL and same-origin built assets are the executed paths. See [DEPLOYMENT.md](DEPLOYMENT.md).

Before real office use: approve lawful identity/data processing, domain rules/templates and appointments; integrate approved live providers/pricing if required; configure HTTPS, managed secrets, malware quarantine/shared throttling; validate offsite recovery and incident processes; measure capacity and complete independent security/role/IDOR/accessibility review. These are remaining work items, not implemented compliance claims.

The commissioning user owns the independent source. Third-party dependencies/fonts retain their licenses. Private reference code, government marks and captured citizen values are excluded.
