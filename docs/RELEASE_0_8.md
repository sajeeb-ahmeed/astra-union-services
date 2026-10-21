# Release 0.8 — recovery and authenticator protection

Status: **candidate under verification**, 21 October 2026. The last verified hosted runtime remains 0.7 until a specific 0.8 deployment and hosted acceptance are recorded here.

## Scope

The merchant-independent P0 work begins with protected hosted export and independent restore tooling, followed by optional authenticator MFA, one-use recovery codes and durable own-account security history. Payment collection remains disabled. All certificates retain DEMO / NOT OFFICIAL and the 47-service reference limitations remain unchanged.

- Logical managed-PostgreSQL recovery must preserve forced tenant/account RLS and object ownership, rather than assuming the managed migration role can bypass RLS.
- MFA setup is optional and password-confirmed; enrollment requires a correct authenticator code. Password-only login cannot create a session for an enrolled account.
- Recovery-code use, TOTP replay protection, challenge state and factor-attempt limits are serialized in PostgreSQL. Security history is available in Bangla and English for citizens, office roles and the platform owner.
- Migration 013 adds authentication tables only; it must preserve all existing citizen/application/PDF/fee/payment/ledger data. It does not enroll existing users or alter their passwords.

## Verification

The frozen-source local run passed **252/252 tests**: 15 backup safety, 72 form-engine, 112 API and 53 web cases. Typecheck, production build and dependency audit passed with zero advisories. Public entry JavaScript is 362,177 raw bytes / 101,484 gzip bytes, within the 400 KB raw budget. The authenticated workspace remains 669,783 raw bytes and needs further splitting.

The managed-owner synthetic backup/independent-cluster rehearsal passed **22 checks** across 49 tables, two tenants and two real PDF files, including actual HTTP startup, protected PDF delivery and public QR. It is distinct from the pending hosted archive/restore. [Local results](../execution/recovery-mfa-local-qa.json), [full test log](../execution/recovery-mfa-local-qa.log), [recovery rehearsal](../execution/managed-recovery-local-qa.json).

The initial full run had one interrupted account-security browser test because a frontend edit triggered Vite reload while the test was active. The exact existing test and four MFA tests passed a focused rerun; the frozen-source full run then passed all cases. Assertions were not weakened.

Candidate `cd6b5c8a7deb8d4f5be4b6b7ee6eded8358b4479` is pushed. [CI 39558153809](https://github.com/sajeeb-ahmeed/astra-union-services/actions/runs/39558153809) passed all **252 tests**, the production/Docker builds and a zero-vulnerability audit. [CI evidence](../execution/recovery-mfa-ci-qa.json). Hosted migration fingerprints, exact deployment identity and post-deployment checks will be recorded after execution. An implemented route or local test is not a live deployment claim.

## Hosted execution checkpoint

The 0.8 migration and deployment have not run. Current database metadata confirms availability, an empty external allowlist and expiry `2026-11-12T07:28:16.203893Z`. The narrow temporary maintenance rule is prepared but unsaved. Action-time browser consent has been requested for the existing database's migration/export window. No paid plan, provider activation or external-access change has been made.

After consent: apply reviewed migrations with unchanged-data fingerprints; export the encrypted hosted snapshot; close temporary access; restore and verify the archive on a separate local cluster, including actual HTTP startup/readback; configure the separately retained MFA key; deploy the verified commit; run seven MFA API groups, six MFA browser groups, existing 22 API groups and exact asset-hash checks. Each result must be recorded from execution, not this plan.

## Operational limits

Separate local archive/key folders are not independent key custody or offsite retention. Durable hosting is still a separate owner decision before the currently recorded **12 November 2026** database expiry. MFA does not implement assisted privileged recovery, mandatory staff enrollment, passkeys, external identity, malware scanning or a complete access review system. Gateway onboarding and collection remain deferred.

See [account security](ACCOUNT_SECURITY.md) and [delivery priorities](DELIVERY_BACKLOG.md).
