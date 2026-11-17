# Attachment scanner on the operator's Windows PC

The owner selected a local PC scanner. New attachments remain quarantined until an authorized worker receives a successful scan result from a current ClamAV engine. The PC must be awake, connected to the internet, and running both ClamAV and the DigitalUnion outbound worker. Stopping the PC leaves files waiting; it does not approve them. Payment gateways remain disabled separately.

## Runtime and trust

The portable runtime uses **ClamAV 1.4.6 LTS, Windows x64**. The installer downloads the ZIP and detached signature from the [official ClamAV downloads](https://www.clamav.net/downloads). It imports the [Cisco Talos public key linked by the installation documentation](https://docs.clamav.net/manual/Installing.html) into an isolated keyring, pins fingerprint `5BADCA2665EF59DCF8A23D8B707F0DB480836771`, and requires a successful matching GPG `VALIDSIG` before extraction. The recorded SHA-256 is additional inventory evidence, not a replacement for that signature verification. GPG's "unknown trust" warning reflects the isolated personal trust database; the accepted key is anchored to the official HTTPS source and pinned fingerprint.

Requirements: Windows x64, PowerShell 7 (`pwsh`), Git for Windows (its bundled GnuPG is supported), internet access to the official ClamAV database service, and enough free memory for the engine and definition updates. The verified engine used approximately 956 MiB resident memory on this PC; allow several GiB free for database validation and reloads. No Windows service, administrator installation, antivirus exclusion, inbound firewall allowance, or public scanner port is created.

All binaries, signatures, definitions, logs, PID ownership records and temporary files live in Git-ignored `.runtime/clamav/`. Its ACL grants access only to the current Windows user, SYSTEM and administrators. The upload worker streams bytes to ClamD; **ClamD may spool bytes or extracted content to private temporary files** in `.runtime/clamav/tmp/`. `LeaveTemporaryFiles no` asks ClamD to remove them after scanning. A crash can leave temporary files behind, and deletion is not secure erasure. Keep this PC protected and review temporary files after an abnormal termination. Never disable Windows antivirus to make a test pass.

## Install, start and stop

Run from the repository directory in PowerShell 7:

```powershell
pwsh -NoProfile -File scripts/runtime/install-clamav.ps1 -UpdateDefinitions
pwsh -NoProfile -File scripts/runtime/start-clamav.ps1
npm run scanner:check
```

Installation verifies the official signed release and generates bounded configuration. `-UpdateDefinitions` obtains and validates official signature databases. The initial update may log `NotifyClamd: Connection refused` because the daemon has not started yet; the updater must otherwise exit successfully and database validation must pass. A later start updates definitions by default, starts ClamD in a hidden process, validates its VERSION timestamp and listener, then starts FreshClam in another hidden process. FreshClam checks for official updates every two hours while the PC is awake and notifies ClamD to reload.

`start-clamav.ps1 -SkipDefinitionUpdate` is useful immediately after a successful update or during an idempotent restart. It still requires definitions no older than 48 hours. It does not bypass freshness checks. Startup refuses any other listener on port 3310 and refuses configuration that would bind beyond `127.0.0.1`.

Start the **separate outbound worker** only after its private configuration has been provisioned:

```powershell
pwsh -NoProfile -File scripts/runtime/start-attachment-worker.ps1
```

Its configuration is outside the repository at `%USERPROFILE%/.astra-scanner/worker.json`. Provision the authorized application URL and scanner credential using the worker's deployment instructions. Never commit or paste the credential into documentation or browser URLs. The worker makes outbound HTTPS requests to DigitalUnion; Render does not connect to the PC's ClamD port. Running only ClamAV does not process application attachments.

The private JSON file accepts these exact fields:

| Field | Value |
|---|---|
| `origin` | Authorized HTTPS origin, e.g. `https://astra-union-services.onrender.com`; no path, query or credentials |
| `secret` | A generated 32-byte secret encoded as 64 lowercase hexadecimal characters, matching the application's private `ATTACHMENT_SCANNER_SECRET` environment value |
| `workerId` | A stable non-sensitive identifier such as `operator-pc`; 1–80 letters, digits, underscores, dots or hyphens, beginning with a letter or digit |
| `clamdPort` | `3310` |

The deployment operator provisions the matching secret in the two private locations. Credential generation, transfer and rotation must not print the secret. Keep `worker.json` readable only by the owner, SYSTEM and administrators. The startup wrapper enforces the private directory ACL and rejects a symlinked configuration file. Worker events rotate at 1 MiB into one previous file under the same private directory; do not publish these operational logs without review.

Stop the worker before stopping its engine:

```powershell
pwsh -NoProfile -File scripts/runtime/stop-attachment-worker.ps1
pwsh -NoProfile -File scripts/runtime/stop-clamav.ps1
```

Stop validates the recorded PID, exact executable path and process start time before terminating only the workspace-owned processes. It refuses a mismatched or reused PID. Repeated start reuses the validated existing processes. These scripts do not install automatic login/startup tasks: after restarting Windows, start the engine and worker again. Machine execution policy is left unchanged; PowerShell 7 was used for the verified run.

## Applied scan limits

| Setting | Applied value | Consequence |
|---|---|---|
| TCP listener | `127.0.0.1:3310` | Accessible only on this PC; no authentication is provided by ClamD itself |
| Official database only | Enabled | No local test signature can masquerade as real malware coverage |
| Maximum stream / file | 2 MiB / 2 MiB | Matches the application's upload size ceiling |
| Expanded content | 16 MiB | Bounds decompression work |
| Recursion / extracted files | 10 / 100 | Bounds nested containers |
| Scan / read / initial-command timeout | 20 seconds / 30 seconds / 5 seconds | Prevents an unbounded scan or stalled connection |
| Threads / queue | 2 / 8 | Bounds concurrent resource use |
| Bytecode timeout | 5 seconds | Bounds signature bytecode execution |
| Encrypted content / exceeded limits | Alerts enabled | A file that cannot be fully inspected must not be released as clean |
| Concurrent database reload | Disabled | Reduces reload memory peak; scans can wait or retry during reload |
| Engine self-check | Every 10 minutes | Detects updated signature databases |
| Logs | 2 MiB with rotation | Bounded ClamAV log retention; logs can contain detection names |

The worker also validates engine identity, signature freshness and known clean/EICAR probes before processing uploads. Engine errors, stale definitions, scan limits and worker outages must remain fail-closed. A clean result means that current signatures found no threat; it cannot guarantee that a file contains no unknown threat.

## Local runtime execution evidence — 2026-10-24

- Official ZIP detached signature: **PASS**, matching the pinned Cisco Talos fingerprint.
- FreshClam download and database validation: **PASS**; daily `28163`, main `63`, bytecode `339`.
- Actual VERSION response: `ClamAV 1.4.6/28163/Sat Oct 24 12:26:10 2026` (Asia/Dhaka; `2026-10-24T06:26:10Z`). Definitions were less than one hour old during verification.
- Actual engine readiness: **PASS** for PING, INSTREAM support, a clean probe and the standard EICAR antivirus test bytes.
- Actual benign synthetic PDF and PNG scans: **PASS**.
- Valid PDF containing an EmbeddedFile with the standard antivirus fixture: **PASS**, rejected by the actual engine's signatures. Client-side stream ceiling above 2 MiB: **PASS**. The final `scanner:check` run passed all five recorded checks.
- Hidden process start, idempotent start, validated stop and restart: **PASS**.
- Altered process ownership record: **PASS**, stop refused before terminating either daemon.
- Listener inspection: **PASS**, only `127.0.0.1:3310` owned by this workspace's ClamD.

The acceptance script generates antivirus fixtures in application memory and never saves an EICAR fixture to the repository. ClamD's internal temporary-file behavior remains as described above. Complete current application/worker test results are recorded separately in `execution/attachment-real-engine.json` and the release verification document; the runtime evidence alone is not proof of a hosted release.

## Hosted runtime acceptance — 2026-10-24

The production scanner credential was provisioned privately on the existing Render service and this PC. At `2026-10-24T07:25:10Z`, the hidden outbound worker started successfully after the five real-engine readiness checks. A repeated start reused the validated owned worker. Live acceptance verified a clean PDF became downloadable and the valid embedded antivirus-fixture PDF was rejected; pending files had first been verified inaccessible with the worker stopped. The worker log then reported IDLE. The worker, ClamD and FreshClam were left running, with ClamD listening only on `127.0.0.1:3310`. [Sanitized runtime evidence](../execution/attachment-pc-runtime-qa.json), [hosted results](../execution/attachments-hosted-qa.json).

An optional negative outbound-wrapper lifecycle test was blocked before execution by automatic tool policy without a specific reason; no pass is claimed for that test. The engine lifecycle tests above and actual production worker startup/idempotency/live scanning were executed successfully. No startup persistence was added: run `start-attachment-worker.ps1` again after Windows restarts.

## Diagnosis and maintenance

1. Inspect `.runtime/clamav/logs/freshclam.log` for update errors and `.runtime/clamav/logs/clamd.log` / `clamd.stderr.log` for engine errors. No attachment bodies or scanner credentials should be added to logs.
2. If the official database service rate-limits or refuses an update, honor its retry interval. Do not switch to an untrusted mirror or remove freshness checks. Files stay quarantined until a successful current scan.
3. After sleep, network loss or restart, check `npm run scanner:check` and the worker status. If definitions are stale, let FreshClam update them before resuming work.
4. Stop the worker and ClamAV before changing the pinned engine version or generated configuration. Review the new official release and signing key, update the installer deliberately, rerun signature validation and all real-engine tests, then restart.
5. Do not publish port 3310, use router forwarding, or share its TCP endpoint. Moving scanning to an always-on server is a later infrastructure milestone. The current PC arrangement has availability limits whenever the user signs out, sleeps the PC, loses connectivity or stops either process.
