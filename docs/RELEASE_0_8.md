# Release 0.8 — recovery and authenticator protection

Status: **candidate under verification**, 21 October 2026. The last verified hosted runtime remains 0.7 until a specific 0.8 deployment and hosted acceptance are recorded here.

## Scope

The merchant-independent P0 work begins with protected hosted export and independent restore tooling, followed by optional authenticator MFA, one-use recovery codes and durable own-account security history. Payment collection remains disabled. All certificates retain DEMO / NOT OFFICIAL and the 47-service reference limitations remain unchanged.

- Logical managed-PostgreSQL recovery must preserve forced tenant/account RLS and object ownership, rather than assuming the managed migration role can bypass RLS.
- MFA setup is optional and password-confirmed; enrollment requires a correct authenticator code. Password-only login cannot create a session for an enrolled account.
- Recovery-code use, TOTP replay protection, challenge state and factor-attempt limits are serialized in PostgreSQL. Security history is available in Bangla and English for citizens, office roles and the platform owner.
- Migration 013 adds authentication tables only; it must preserve all existing citizen/application/PDF/fee/payment/ledger data. It does not enroll existing users or alter their passwords.

## Verification

Candidate tests, full CI, migration fingerprints, exact deployment identity and post-deployment checks will be recorded after execution. An implemented route or local test is not a live deployment claim.

## Operational limits

Separate local archive/key folders are not independent key custody or offsite retention. Durable hosting is still a separate owner decision before the currently recorded **12 November 2026** database expiry. MFA does not implement assisted privileged recovery, mandatory staff enrollment, passkeys, external identity, malware scanning or a complete access review system. Gateway onboarding and collection remain deferred.

See [account security](ACCOUNT_SECURITY.md) and [delivery priorities](DELIVERY_BACKLOG.md).
