# Account and session protection

This merchant-independent increment addresses part of the P0 account-protection backlog. It uses the existing PostgreSQL schema and requires no migration, provider credentials, new service or paid infrastructure. Identity verification and MFA remain separate acceptance gates.

## User behavior

- Signed-in users can see how many of their sessions remain active, how many belong to other browser sessions, and when the current session expires. These are login sessions, not a reliable count of physical devices.
- Users can enter their current password to sign out every other session belonging to their account. The current session remains usable. This works for citizens, staff, approvers, finance, administrators and the platform owner.
- Changing a password preserves the current session, expires other sessions and consumes previously issued password-recovery links for that account across its office memberships. A link issued before the password change cannot subsequently replace the new password.
- The existing tenant-admin recovery flow remains restricted to active non-admin users who belong to only that office. It uses a hashed, one-use, 15-minute token delivered manually through a trusted channel. This release does not introduce email/SMS reset delivery or privileged-account recovery.

## API contract

All routes require the normal session cookie. Mutation routes also require the session CSRF token and allowed Origin; unknown JSON properties are rejected.

| Method and route | Input | Successful response |
| --- | --- | --- |
| `GET /api/v1/auth/sessions` | No account or office selector | `{ "activeSessions": 2, "otherSessions": 1, "currentSessionExpiresAt": "ISO timestamp" }` |
| `POST /api/v1/auth/sessions/revoke-others` | `{ "currentPassword": "…" }` | `{ "revoked": 1, "remainingSessions": 1 }` |
| `POST /api/v1/auth/password` | Existing `{ "currentPassword": "…", "newPassword": "…" }` | Existing `{ "changed": true }` |

The summary excludes expired sessions and sessions whose office membership or office is inactive. It exposes no session token, token digest, CSRF secret, IP address, browser fingerprint or other user's information. Revocation expires all unexpired sessions of the authenticated account other than the requesting session, including any tied to other office memberships. `revoked` counts rows expired by that action; an already inactive office session may be included in that count.

Incorrect current passwords return `422 / PASSWORD_MISMATCH`; expired or revoked sessions return `401 / SESSION_INACTIVE`. The two password-rechecking actions share a process-local budget of 10 requests per authenticated account per minute. Excess attempts return `429 / RATE_LIMIT` and `Retry-After`. This budget is independent of other users sharing an IP address; a distributed limiter remains future work.

## Transaction and audit guarantees

Login locks the account row before verifying the password, then creates the session in that same transaction. Password change, password recovery creation/completion and other-session revocation coordinate through the same account lock. A login waiting behind a password rotation cannot create a session using a previously read password hash.

Account actions recheck the requesting session after acquiring the lock. This prevents a request which passed middleware before another request revoked its session from using that stale authorization to change a password or revoke the remaining sessions. Expiry checks use the actual database clock after lock waits, not the transaction-start timestamp.

Password changes invalidate recovery tokens under each account membership's tenant context; tenant RLS remains enforced. Password recovery acquires the account lock before locking its token, preventing credential-update/token lock-order inversion. Existing application, certificate, fee and credit records are not modified by these account actions.

Tenant-bound password changes and session revocations append immutable `PASSWORD_CHANGED` / `OTHER_SESSIONS_REVOKED` audit events with only the number of revoked sessions. Passwords, cookies, recovery tokens and CSRF values are excluded. The platform owner has no tenant audit destination in the existing schema: successful owner actions emit a sanitized structured operational log after commit. **These logs are not a durable global owner-security audit trail**, and retention depends on hosting log configuration.

## Verification

The focused suite is [account-security.test.ts](../apps/api/test/account-security.test.ts):

1. Summary authentication, own-account isolation, expiry filtering and response minimization.
2. Current-password recheck, CSRF, strict request body, neighbor-account preservation, repeat revocation and immutable tenant audit metadata.
3. Password change consumes recovery links across memberships and invalidates other sessions.
4. Deterministic PostgreSQL lock test: login waiting behind a password rotation cannot use the old password.
5. Deterministic PostgreSQL lock test: an already authenticated request loses authorization when its session is revoked while waiting.
6. Concurrent recovery and password change have exactly one successful credential update, with no reusable recovery link.
7. Owner session management works without a tenant and remains scoped to that owner.
8. Per-account password-recheck budget blocks repeated guesses without consuming neighboring users' budgets.

Run `node --import tsx --test --test-concurrency=1 apps/api/test/account-security.test.ts` against the synthetic local test database, then the required full release checks. Hosted/browser checks and runtime commit identity must be recorded separately in the current release evidence; local tests alone do not establish deployment.

## Remaining limits

- No MFA, external identity/OTP verification, SMS/email recovery, or owner/admin assisted recovery was added. Citizen identity remains `SYNTHETIC_DEMO`, and certificates remain **DEMO / NOT OFFICIAL**.
- Revocation stops subsequent authenticated requests. A business operation already authorized and executing outside these account-security transactions may finish; this release does not cancel in-flight application or payment transactions.
- No device inventory, individual-session revocation, idle-session timeout, security-event dashboard or global durable owner audit table exists. Sessions retain their existing eight-hour maximum lifetime.
- Process-local attempt budgets reset on application restart and do not coordinate replicas. Shared rate limiting, privileged access reviews, MFA/recovery, file quarantine/scanning and production identity remain in the [delivery backlog](DELIVERY_BACKLOG.md).
- All payment merchant/provider acceptance requirements remain unchanged; this release does not activate collection.
