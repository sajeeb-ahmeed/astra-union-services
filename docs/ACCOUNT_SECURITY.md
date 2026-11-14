# Account and session protection

This document covers the existing session controls and the optional authenticator protection introduced in release 0.8. The new controls require migration `013_account_mfa.sql` and a separate `MFA_ENCRYPTION_KEY` deployment secret. They require no merchant account, SMS provider or paid service. Runtime deployment and test results are recorded separately in [Release 0.8](RELEASE_0_8.md).

## Authenticator protection — release 0.8

Users may enable two-step sign-in from their account security panel. Setup requires the current password, a scan/manual entry in a compatible authenticator, and a correct six-digit code before it takes effect. The existing accounts are not automatically enrolled. A pending setup expires after ten minutes. After activation, ten recovery codes appear once: save them privately before closing the panel. Each code works only once and still requires the account password at login.

An enrolled account receives a five-minute login challenge after the password succeeds; no session cookie or protected workspace is granted until a fresh authenticator code or an unused recovery code succeeds. TOTP uses RFC 6238 with SHA-1, six digits and 30-second steps, allowing one adjacent step in either direction. A successfully used counter cannot be reused, including between enrollment, sign-in and sensitive account actions. Wait for the next code if the current one was already used.

MFA state and its attempt budget live in PostgreSQL. Five incorrect factor attempts within five minutes block further attempts for that window, across new challenges and application restarts. This is an account-specific MFA budget, not a replacement for the remaining process-local general login/IP limits. Account-row locking makes concurrent recovery-code use exactly once. Challenge redemption rechecks credentials, MFA revision, account activation, office membership and office status.

Enabling MFA, rotating recovery codes or disabling MFA expires other sessions and invalidates pending login challenges and old password-recovery links. Disabling or rotating requires both current password and a valid second factor. Password changes retain MFA and invalidate pending setup/challenges. Existing password recovery is blocked for enrolled users: an office administrator cannot reset a password to bypass MFA. Assisted owner/admin or lost-password-plus-lost-factor recovery needs an approved identity and dual-control policy and is not implemented.

| Route under `/api/v1` | Input / response |
| --- | --- |
| `GET /auth/mfa` | Own enabled/available flags, pending expiry and remaining recovery-code count; never secret material |
| `POST /auth/mfa/enrollment` | Current password; returns pending manual key, local QR data URL and expiry |
| `POST /auth/mfa/activate` | Six-digit code; returns the ten one-use recovery codes once |
| `POST /auth/login` | Existing email/password; either existing login response or `mfaRequired`, opaque challenge and expiry |
| `POST /auth/mfa/verify` | Challenge and authenticator/recovery code; returns session only after verification |
| `POST /auth/mfa/recovery-codes` | Current password and second factor; replaces all old recovery codes |
| `POST /auth/mfa/disable` | Current password and second factor; removes protection and revokes other sessions |
| `GET /auth/security-events` | Latest 50 own security events; no arbitrary account selector |

Authenticated mutations require the normal CSRF token and allowed Origin. All security responses use `Cache-Control: no-store`. Secret values remain only in short-lived browser component state and are cleared on unmount/sign-out; they are not URL parameters or local-storage entries. Passwords, authenticator seeds, recovery codes, challenge tokens and cookies must never be added to screenshots, public logs or support messages.

## Keys and recovery operations

`MFA_ENCRYPTION_KEY` is an independently generated 32-byte key represented as 64 hexadecimal characters. AES-256-GCM encrypts pending/active authenticator seeds with a fresh nonce and account-bound authenticated data. Recovery codes have 96 bits of randomness and only account-bound SHA-256 hashes are stored. Challenges are stored as hashes and bound to the current password digest and MFA revision.

Configure the key through deployment secrets and retain a protected recovery copy separately from database archives. Losing the key prevents decryption of authenticator seeds; changing it is not a supported rotation procedure. Do not set a replacement key to make login work. Missing configuration disables new enrollment and enrolled password-login fails closed; it does not silently fall back to password-only access. A database recovery must retain the matching key and independently verify factor acceptance before a cutover. The software does not provide key escrow or an emergency MFA bypass.

Security events now persist for every account, including the platform owner, in a forced-RLS, append-only account table. The logged metadata is limited to action, time and relevant counts. The account view shows its own latest events. This does not create a cross-account privileged access review console or independent external tamper-evident audit. Database administrators still have schema authority. Event/challenge retention cleanup is pending an approved retention policy.

References: [RFC 6238](https://datatracker.ietf.org/doc/html/rfc6238), [OWASP MFA guidance](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html). Automated coverage lives in [MFA API tests](../apps/api/test/mfa.test.ts); release evidence distinguishes local and hosted acceptance.

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

Tenant-bound password changes and session revocations retain their immutable tenant audit events. Release 0.8 also writes durable own-account security events for all roles, including owners without a tenant. Only action/count metadata is recorded; passwords, cookies, recovery codes, tokens and CSRF values are excluded. The earlier 0.6 owner operational logs remain historical and were not backfilled as database events.

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

- MFA is optional; mandatory enrollment, external identity/OTP verification, SMS/email recovery, and owner/admin assisted recovery remain open. Citizen identity remains `SYNTHETIC_DEMO`, and certificates remain **DEMO / NOT OFFICIAL**.
- Revocation stops subsequent authenticated requests. A business operation already authorized and executing outside these account-security transactions may finish; this release does not cancel in-flight application or payment transactions.
- No device inventory, individual-session revocation, idle timeout or cross-account privileged access review exists. Sessions retain their existing eight-hour maximum lifetime. The new history panel is own-account only.
- General process-local attempt budgets reset on application restart and do not coordinate replicas; the new MFA factor budget is database-backed. Shared general throttling, privileged recovery/access reviews, file quarantine/scanning and production identity remain in the [delivery backlog](DELIVERY_BACKLOG.md).
- All payment merchant/provider acceptance requirements remain unchanged; this release does not activate collection.

## Sign-in identifiers (Phase 2b)

Besides email, an account can sign in with a **mobile, NID or birth-registration number** it has added on the Account security page (current password required; each change is recorded in the account's security history). The numbers are normalised (Bangla digits, `+880`, spaces and dashes accepted) and stored **only as an HMAC-SHA-256 digest** keyed with the server secret `IDENTIFIER_SECRET`, plus a masked hint such as `017******78` for the owner's own page. A number can belong to one account only.

`POST /api/v1/auth/login` accepts `{ identifierType, identifier, password }` as well as the original `{ email, password }`. An unknown identifier, a malformed one and a wrong password all return the same `401 INVALID_LOGIN`, and an unknown account now costs the same password check as a known one, so response time does not reveal registered emails or numbers. Besides the per-address limit, ten **failed** attempts for one identifier pause it for five minutes, the same for every kind; a successful sign-in clears the count.

`IDENTIFIER_SECRET` must be 32+ random characters and must not be changed once numbers are stored. If it is missing in production, the server still starts: email sign-in works and the other identifiers report `503 IDENTIFIERS_UNAVAILABLE`.

## Mobile verification at registration (Phase 2c)

Self-registration can add a **mobile number confirmed by a one-time code** (optional for now). `POST /api/v1/auth/otp/signup` sends a six-digit code and returns only an opaque challenge token; `POST /api/v1/auth/otp/verify` checks the code; `POST /api/v1/auth/signup` then accepts `mobile` with that `otpToken`, consumes the challenge in the same transaction and stores the number as a mobile sign-in identifier (Phase 2b). The token and the code are stored only as digests and the number only as its keyed digest. A code expires after 10 minutes, allows five tries and makes one account; a new code for the same number needs a 60-second wait and at most five an hour.

**Provider (owner decision: development only).** `OTP_PROVIDER=log` writes the code to the server log and, outside production, to the git-ignored `.runtime/otp-outbox.log`; it is the default outside production. In production nothing is sent unless `OTP_PROVIDER` is set, and the page hides the step (`GET /api/v1/auth/otp/status` reports `available: false`); registration without a mobile works as before. A real SMS provider is a later, owner-chosen step. Email stays required at registration, and there is no CAPTCHA (rate limits apply instead).
