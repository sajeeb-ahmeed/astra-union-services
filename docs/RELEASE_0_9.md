# Astra 0.9 — attachment quarantine and PC malware scanner

**Live and verified: 24 October 2026.** Runtime `9aadc93b29cbc76a669db4ffa1c37a2f4f220528` became live at `2026-10-24T07:24:34.82211Z` (13:24:34 Bangladesh time), deployment `dep-dbe5pabrjlhs7394ljug`. [Open Astra](https://astra-union-services.onrender.com/). Payment collection remains disabled. [Consolidated release evidence](../execution/attachment-live-release.json).

## User workflow

Upload a PDF, PNG or JPEG up to 2 MiB in a service form. The document enters **Quarantined**, then **Scanning**. Drafts can be saved while scanning. Submission, resubmission, approval and new certificate issuance require a completed clean result for every referenced document. A clean result means no threat was detected by the recorded signatures, not a guarantee against all malware. Existing issued certificates retain their historical download/idempotency behavior.

The form shows Bangla/English status, an explicit refresh button, scanner-offline guidance, and a download link only after the server confirms CLEAN. Rejected documents must be replaced. Transient errors retry at most three scan attempts with a 60-second cooldown; eligible users can explicitly request a retry. Polling is visible-only, stops after twelve intervals and is cancelled on unmount/authentication loss. Late upload responses cannot attach a document to another application.

The owner selected their PC as the scanner. **PC sleep/shutdown, disconnected internet, stale definitions or a stopped worker leave files waiting in quarantine.** Nothing bypasses scanning when the PC is unavailable. After Windows restarts, start the scanner and worker again with the documented PowerShell 7 command; no automatic-start task has been installed. See [operator runbook](ATTACHMENT_SCANNER_RUNTIME.md).

## Implementation and security

- Migration 015 backfills content SHA-256 and quarantines legacy uploads. File bytes, ownership, MIME and length remain unchanged. New uploads cannot enter a completed state, content is immutable, and completed results cannot be altered through normal runtime privileges.
- A private tenant-scoped scan-event history records claims, completion, errors, expiry and retries. Tenant-scoped heartbeats report availability. No scanner database superuser or RLS bypass is used.
- Claim scheduling visits every active tenant and uses a database-serialized least-recently-served queue so one busy union cannot indefinitely starve another. Status polling reads metadata, not document bytes.
- A scan lease lasts 120 seconds. Completion requires the same tenant, attachment, unexpired lease token, SHA-256 and engine/signature identity. Concurrent claims, stale results and duplicate finishes cannot release other bytes. Final issuance rechecks and locks attachments after PDF generation before recording certificate/credit changes.
- The Windows worker pulls queued bytes over HTTPS, streams them only to loopback ClamD, and sends a bound verdict. It refuses HTTP origins in normal operation, redirects, URL credentials, unknown response fields, oversized responses, hash/length mismatches and non-canonical base64. The loopback HTTP option is only an explicit synthetic test constructor argument.
- Scanner API access uses a separate random 256-bit service secret. Browser cookies, Origin headers and ordinary user/admin sessions cannot authenticate it. This credential is trusted to retrieve queued private files and attest results across active tenants: protect the PC and rotate the credential if compromised.
- Engine startup requires fresh official signatures and actual clean/EICAR probes. The client accepts only one complete exact `stream: OK` record as clean; errors, incomplete/multiple responses, limits, timeouts and definition reload during a scan fail closed.
- No third-party scanning website receives documents. ClamD can create private temporary spool/extraction files on this PC; normal cleanup is not secure erasure. Private directory ACLs, signature verification, loopback binding and bounded engine limits are in the runbook.

## API additions

| Method and URL | Purpose / authorization |
|---|---|
| `POST /api/v1/attachments` | Existing private upload, now returns scan metadata. Citizen own file or permitted office staff/admin; normal session and CSRF. Body: citizenId, MIME, canonical base64. |
| `GET /api/v1/attachments/:id/status` | Authorized metadata-only lookup. Returns scanState, downloadAllowed, retryAllowed, retryAfter, reasonCode, scannedAt and scannerAvailable. |
| `GET /api/v1/attachments/:id` | Authorized byte download only after a clean bound scan; otherwise 409 with no file bytes. |
| `POST /api/v1/attachments/:id/retry` | Empty JSON object, normal CSRF. Own citizen/staff/admin, eligible ERROR only; rejected files cannot be forced clean. |
| `POST /api/v1/internal/attachment-scans/claim` | Service bearer credential only. workerId, engineVersion, signatureVersion, signatureUpdatedAt. Returns no job or a bounded immutable byte/hash/lease job. |
| `POST /api/v1/internal/attachment-scans/finish` | Same service credential. tenantId, attachmentId, leaseToken, sha256, verdict, reasonCode and exact engine identity. |

Application payloads still contain only `{attachmentId,mimeType,byteLength}`. Status information is never accepted as client authority. Workflow 409 `ATTACHMENT_NOT_READY` returns field paths and bilingual issues; unauthorized/foreign handles do not reveal another tenant's file. Full request/response contracts are in [OpenAPI](../apps/api/openapi.json).

## Verification and hosted acceptance

On 24 October 2026, local suites passed **293/293**: backup 18, scanner/orchestration 19, forms 72, API 121, web 63. Production build and dependency audit passed (0 known vulnerabilities). Real ClamAV checks passed 5/5 and isolated HTTP/PostgreSQL/worker/ClamAV workflow passed 8/8; these separate acceptance checks are not added to the suite total. A missing synthetic MFA test key caused the first browser run to fail; the correctly configured complete rerun passed 63/63. Dependencies were updated to Zod 4.6.7 and body-parser 2.4.0 for newly reported high-severity advisories. See [local evidence](../execution/attachment-local-qa.json). Final [Linux CI run40073018586](https://github.com/sajeeb-ahmeed/astra-union-services/actions/runs/40073018586) passed all293 tests, Docker build and real ClamAV checks on commit `9aadc93b29cbc76a669db4ffa1c37a2f4f220528`; [CI evidence](../execution/attachment-ci-qa.json). The initial run passed the regular suite/Docker build but its scanner loaded stale prepackaged definitions. That superseded run was cancelled; the final workflow requires a successful official FreshClam update before starting ClamD. Both final engine and real workflow used signature28163 (`2026-10-24T06:26:10Z`). The optional negative Windows worker-wrapper lifecycle test was rejected before execution by automatic tool policy without a specific reason and is not claimed as passed. Actual production worker startup and idempotent reuse subsequently passed, followed by actual hosted clean/rejected scan acceptance.

Hosted migration 015 passed **6 verification groups**, preserving 48 existing tables, three tenants, 14 accounts and 18 routines; no legacy hosted uploads required backfill. The temporary authorized `/32` database rule was removed before deployment. Final provider metadata confirms the database is available with an empty external IP allowlist. [Migration](../execution/attachment-hosted-migration.json), [network closure](../execution/attachment-final-network-qa.json), [deployment](../execution/attachment-render-deploy.json).

Hosted acceptance passed **25 API groups**: seven paused-worker preparation, five real-scanner verification, seven disabled-payment checks and six historical readback checks. The real PC worker released the clean PDF, rejected the valid PDF containing the harmless standard antivirus fixture, and left pending downloads denied before startup. Cross-tenant/unauthenticated access and cookie-only scanner authentication were denied. One clearly synthetic citizen and two private uploads were added; no new application, payment attempt, certificate or credit debit was created. These retained fixtures/audit events are intentional. Existing PDF bytes, 24 credits and one issuance debit remain unchanged. [Preparation](../execution/attachments-hosted-prepare.json), [actual scanner](../execution/attachments-hosted-qa.json), [payments](../execution/attachments-payments-regression.json), [readback](../execution/attachments-readback-regression.json).

**Eight Bangla/English mobile browser groups** passed at 390×844, with zero page errors or unintended mutations and the session signed out. All **nine live JS/CSS assets** match the tested build hashes and immutable-cache expectations. Browser acceptance covers navigation and existing application guidance; attachment state component/race tests are in the 63-case local/CI web suite, while real scan outcomes are verified through hosted HTTP. [Browser](../execution/attachments-live-browser-qa.json), [asset hashes](../execution/attachments-live-assets.json).

The actual PC scanner, updater and outbound worker were left running. Idempotent worker startup reused the owned process. Local event readback recorded one CLEAN, one REJECTED and then IDLE; the only ClamD listener is `127.0.0.1:3310`. [Runtime evidence](../execution/attachment-pc-runtime-qa.json). No automatic Windows startup task is installed. Later documentation-only commits do not change the deployed runtime because Git Auto-Deploy is off.

## Deployment and recovery

1. Pass the complete test suite, build, dependency audit, Docker build and real-engine CI on the intended Git commit.
2. Review exact migration 015 hash. Temporarily allow only the authorized current `/32` maintenance IP for the existing database, run the bounded migration helper, verify data/security invariants, then remove the rule. Do not expose the database to all addresses.
3. Generate a unique scanner secret outside the repository in `%USERPROFILE%/.astra-scanner/worker.json`, with fields `origin`, `secret`, `workerId` and `clamdPort`. Restrict its ACL. Set only `ATTACHMENT_SCANNER_SECRET` on the existing Render service using merge semantics. Environment updates may automatically start a deploy even when Git auto-deploy is off; inspect the resulting deploy before triggering another.
4. Wait for the exact deployment to become live, verify pending denial with the worker stopped, start the real PC worker, and verify synthetic clean/rejected cases and historical/payment regressions. Publish sanitized evidence, not credentials or uploaded bytes.

**Rollback boundary:** never roll back to 0.8 or earlier after this release: those binaries serve unscanned attachments. Roll forward or deploy a quarantine-aware compatible build. Preserve migration 015, the scan history, migration 013/014 and the original MFA encryption key. Stopping the worker is a safe operational pause; it never releases pending files. No destructive down migration is provided.

## Known limitations and next milestone

This is signature-based malware screening, not content disarm/reconstruction or a sandbox guarantee. The PC must be available; continuous scanner uptime is not promised. Rejected/error files remain private in PostgreSQL; deletion/retention duration requires the owner's policy and is not guessed. No new paid storage or hosting was provisioned. Backups remain local encrypted copies pending the owner's offsite decision. The currently recorded free database expiry is **12 November 2026**; durable hosting and independent recovery remain owner decisions. Certificates remain DEMO / NOT OFFICIAL and the reference audit's evidence limitations remain unchanged.

Next unblocked engineering milestone: operational monitoring/incident handling, scanner queue-age alerts and shared rate limiting. Always-on scanner hosting, attachment retention, offsite backup/key custody and official service authority require explicit owner/provider decisions. Payment gateway remains deferred.
