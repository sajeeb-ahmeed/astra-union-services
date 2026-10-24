# Astra 0.9 — attachment quarantine and PC malware scanner

Work date: **24 October 2026**. This file describes the implementation. Hosted release evidence will be added only after the exact revision passes CI and live acceptance. Until then, the last verified hosted release remains 0.8. Payment collection remains disabled.

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

## Verification before rollout

On24October2026, local suites passed **293/293**: backup18, scanner/orchestration19, forms72, API121, web63. Production build and dependency audit passed (0 known vulnerabilities). Real ClamAV checks passed5/5 and isolated HTTP/PostgreSQL/worker/ClamAV workflow passed8/8; these separate acceptance checks are not added to the suite total. A missing synthetic MFA test key caused the first browser run to fail; the correctly configured complete rerun passed63/63. Dependencies were updated to Zod4.6.7 and body-parser2.4.0 for newly reported high-severity advisories. See [local evidence](../execution/attachment-local-qa.json). CI/hosted results will be recorded after execution.

## Deployment and recovery

1. Pass the complete test suite, build, dependency audit, Docker build and real-engine CI on the intended Git commit.
2. Review exact migration 015 hash. Temporarily allow only the authorized current `/32` maintenance IP for the existing database, run the bounded migration helper, verify data/security invariants, then remove the rule. Do not expose the database to all addresses.
3. Generate a unique scanner secret outside the repository in `%USERPROFILE%/.astra-scanner/worker.json`, with fields `origin`, `secret`, `workerId` and `clamdPort`. Restrict its ACL. Set only `ATTACHMENT_SCANNER_SECRET` on the existing Render service using merge semantics. Environment updates may automatically start a deploy even when Git auto-deploy is off; inspect the resulting deploy before triggering another.
4. Wait for the exact deployment to become live, verify pending denial with the worker stopped, start the real PC worker, and verify synthetic clean/rejected cases and historical/payment regressions. Publish sanitized evidence, not credentials or uploaded bytes.

**Rollback boundary:** never roll back to 0.8 or earlier after this release: those binaries serve unscanned attachments. Roll forward or deploy a quarantine-aware compatible build. Preserve migration 015, the scan history, migration 013/014 and the original MFA encryption key. Stopping the worker is a safe operational pause; it never releases pending files. No destructive down migration is provided.

## Known limitations and next milestone

This is signature-based malware screening, not content disarm/reconstruction or a sandbox guarantee. The PC must be available; continuous scanner uptime is not promised. Rejected/error files remain private in PostgreSQL; deletion/retention duration requires the owner's policy and is not guessed. No new paid storage or hosting was provisioned. Backups remain local encrypted copies pending the owner's offsite decision. The currently recorded free database expiry is **12 November 2026**; durable hosting and independent recovery remain owner decisions. Certificates remain DEMO / NOT OFFICIAL and the reference audit's evidence limitations remain unchanged.

Next unblocked engineering milestone: operational monitoring/incident handling, scanner queue-age alerts and shared rate limiting. Always-on scanner hosting, attachment retention, offsite backup/key custody and official service authority require explicit owner/provider decisions. Payment gateway remains deferred.
