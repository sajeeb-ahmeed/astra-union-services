# Release 0.8 — recovery and authenticator protection

**Live and verified, 21 October 2026.** [Open Astra](https://astra-union-services.onrender.com/).

## Delivered

- Optional authenticator sign-in, password-confirmed setup and ten one-use recovery codes.
- Database-backed factor attempts, replay prevention and serialized concurrent code redemption; no session before an enrolled account passes its factor.
- Own-account durable security history, including the platform owner, with Bangla/English and mobile UI.
- Managed PostgreSQL encrypted export and independently restored application/PDF/QR verification.

## Verification

Runtime `695942dff49f088ad7862718ba32192d0a8011c2` passed **255/255 Linux CI tests**: 18 backup safety, 72 forms, 112 API and 53 web cases. Production and Docker builds passed; the dependency audit reported zero vulnerabilities. [CI 39562961916](https://github.com/sajeeb-ahmeed/astra-union-services/actions/runs/39562961916), [CI evidence](../execution/recovery-mfa-ci-qa.json). The earlier frozen-source local run passed 252 tests; the three subsequent recovery regressions and all 18 backup tests passed locally. Those focused reruns are not additional full-suite executions.

Render deployment `dep-dbc6oq8n74is73fitgbg` finished **live at 2026-10-21T07:42:34.165139Z**. Post-deployment acceptance passed **29 API groups** (7 MFA, 4 existing account security, 7 disabled-payment, 6 historical readback, 5 geography), **6 Bangla/English/mobile browser groups**, and **9 exact JS/CSS asset hashes**. Existing PDF bytes, the original 24-credit wallet, one three-credit issuance debit and five application events were preserved. The new synthetic MFA fixture was deactivated and sessions closed. Real users were not automatically enrolled. [Consolidated live evidence](../execution/recovery-mfa-live-release.json).

Public entry JavaScript is 362,177 raw / 101,484 gzip bytes, below the 400 KB raw budget. The authenticated workspace is still 669,783 raw bytes and needs further splitting. These are bundle measurements, not field latency claims.

## Hosted preservation and recovery

Migrations 013/014 passed four verification groups, preserving 45 existing tables, 105 fingerprints and 18 routines. The actual encrypted hosted snapshot contains **49 tables, three tenants and two PDFs**. Temporary external database access was closed after export. Independent restoration passed eight SQL/security groups and six actual application HTTP groups, with exact data, ownership, grants and PDF hashes. A separate synthetic rehearsal passed 22 checks. [Migration](../execution/recovery-mfa-hosted-migration.json), [backup](../execution/managed-hosted-backup.json), [restore](../execution/managed-independent-restore.json), [restored HTTP](../execution/recovery-mfa-restored-http.json), [network closure](../execution/recovery-mfa-network-qa.json).

Two initial restore attempts exposed a missing provider default-ACL identity and collation-dependent catalog ordering. Bounded tooling fixes preserve a non-login, unprivileged provider identity and exact unordered catalog values; no data/hash/security assertions were relaxed. The original archive is unchanged. Its source locale was not captured; the local C/UTF8 recovery target is a rehearsal, not an approved cutover. [Attempt history](../execution/managed-hosted-restore-attempts.json).

The owner requested a local encrypted copy and deferred offsite storage. Archive/key folders remain on the same workstation; this is not independent key custody or disaster recovery. The manual snapshot precedes the new live QA security events and provides no recurring RPO/SLA. See [managed recovery runbook](MANAGED_RECOVERY.md) for private locations and operational limits.

## Execution history

The initial local suite encountered a Vite reload while another frontend edit was active. The exact affected test and focused MFA cases passed, then the frozen-source 252-test suite passed. Final CI includes the three later recovery regressions and passed all 255 cases.

Saving the MFA environment key through the Render connector unexpectedly started a build before the final CI had completed. That build was canceled before replacing the live runtime. After CI passed, the same verified commit was explicitly deployed and accepted. Future environment updates must follow the CI gate because they can trigger builds even with Git Auto-Deploy off. [Deployment attempts](../execution/recovery-mfa-deploy-attempts.json).

The first payment regression run overlapped a staff-session revocation test, which correctly invalidated two synthetic sessions including the parallel test session. The unchanged payment suite passed all seven groups when run sequentially afterward. The interrupted result is retained in [payment attempt evidence](../execution/recovery-mfa-hosted-payments-interrupted.json); it did not create a collection or provider attempt. Session-revocation tests must finish before other tests use that QA account.

## Remaining work

Payment collection remains disabled; merchant onboarding, genuine provider acceptance, Nagad and bank payouts remain deferred. Certificates remain **DEMO / NOT OFFICIAL**, and the 47-service audit evidence limitations are unchanged. Optional MFA does not provide mandatory enrollment, assisted privileged recovery, cross-account access review or key rotation/escrow. Do not roll back to password-only 0.7 after MFA enrollment; retain schema and key and use a compatible MFA-aware runtime.

The next unblocked engineering milestone is **attachment quarantine with fail-closed scan states and tenant/owner access checks**, followed by scanner and retention acceptance. Offsite/key custody and durable hosting require the owner's separate decisions before the recorded **12 November 2026 database expiry**. No paid plan was purchased.

See [account security](ACCOUNT_SECURITY.md), [deployment](DEPLOYMENT.md), and [Bangla status/next steps](STATUS_AND_NEXT_STEPS.md).
