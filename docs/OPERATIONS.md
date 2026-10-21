# Operations and verified local recovery

## Recovery tooling inherited from 0.6

Release 0.7 is deployed on Render and retains the 0.6 recovery tooling with its local verification. Current hosted application acceptance is recorded in [0.7 release evidence](RELEASE_0_7.md); these application checks do not constitute a hosted backup/restore or a new recovery drill. Follow [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md) for the current format-2 archive contract, complete commands, collision safeguards and evidence. The detailed runbook is authoritative for new backups; preserve older format-1 archives together with their matching 0.5 verifier.

Executed **19 October 2026**: five focused safety tests and **17 real local recovery checks passed**. The snapshot contained 46 public tables, 117 synthetic tenants, 435 demonstration PDFs, all 11 migration files (highest numbered 012), 18 application routines, 7 column grants and 94 indexes. All hashes, balances and database security comparisons matched; the restricted role saw no unscoped rows across 30 tenant RLS tables. See [current JSON](../execution/security-backup-qa.json) and [current log](../execution/security-backup-restore.log).

```powershell
npm run test:backup
npm run db:backup
npm run db:recovery-drill
```

Run the final recovery drill after synthetic fixture tests settle. It reads the source, restores only into a new local `astra_restore_*` database and preserves existing targets and scratch files. It includes narrow gateway column permissions and invalid-callback checks without contacting a payment provider. It does not require a merchant account, production network access or a schema migration.

**Immediate operational priority remains hosted full export, independent protected restore and durable hosting before the recorded 12 November 2026 Free database expiry.** Reconfirm the provider's current expiry. Local encrypted archives/keys on one workstation do not close this priority. Offsite storage, separate key custody, scheduled backups/alerts and measured recovery objectives still need implementation and acceptance. See [prioritized backlog](DELIVERY_BACKLOG.md).

## Historical 13 October recovery record

The sections below preserve the original seven-migration recovery result. Their evidence path and counts are historical; current execution writes `execution/security-backup-restore.log` and `execution/security-backup-qa.json` instead.

## Scope and execution

This phase uses a real isolated PostgreSQL 17.11 instance on `127.0.0.1:55432`. Windows runtime setup/start/stop commands live in `scripts/runtime/README.md`. Credentials, cluster data, encrypted backups, key files and diagnostic stderr remain in ignored `.runtime/`; never publish that directory.

Run the meaningful recovery drill after migrations, seeding and certificate issuance tests have populated the database:

```powershell
node scripts/backup/recovery-drill.mjs
```

The original script produced safe execution results in `execution/backup-restore.log`. It used the isolated local PostgreSQL runtime and did not change a Windows service or a global setting. Current commands/output and stronger checks are described above and in the current runbook.

Executed local result on 13 October 2026: **PASS**. The snapshot included all seven migrations, 32 public tables, 17 synthetic tenants and 184 issued demonstration PDFs. Every restored table matched the source snapshot. All tenant ledger sums matched their wallet balances (617 credits combined); all 184 certificate byte hashes and exactly-once issuance debits matched. Tenant-isolation, ledger-immutability and narrowed wallet-helper permission tests passed on the restored database. Corruption, wrong-key and unsafe/existing-target attempts were rejected. Later QA may add synthetic records; these counts describe the exact tested snapshot. See the concrete [execution log](../execution/backup-restore.log).

## Encrypted backup and controlled restore

```powershell
node scripts/backup/backup.mjs backup
node scripts/backup/backup.mjs restore .runtime/backups/backup_NAME.pgdump.aes .runtime/backups/backup_NAME.key
```

Use the concrete archive/key paths printed by the first command. Key contents are never printed. The restore command generates a new `astra_restore_*` database. An optional final argument may select a new database with that prefix; arbitrary names, the main `astra` database and existing targets are rejected. The scripts contain no database-drop operation.

The dump uses PostgreSQL custom format and an exported repeatable-read snapshot. All verification metadata is captured from that same snapshot, so concurrent office activity does not produce inconsistent source comparisons. PostgreSQL administrators perform the dump/restore; application requests retain the restricted `astra_app` account.

The payload contains the dump and a manifest with every public table's count/hash, tenant wallet/ledger totals, certificate PDF hashes and database security definitions. The complete payload is encrypted with AES-256-GCM, a random 256-bit per-backup key and a fresh 96-bit nonce. The format identifier is authenticated associated data. Modified archives and incorrect keys fail authentication before a plaintext restore file or target database is created.

Plaintext custom dumps exist temporarily inside `.runtime/backups` while PostgreSQL tools execute; `finally` cleanup removes individual validated files after success or a handled failure. The scripts do not guarantee recovery from process termination, OS crashes or full disks during cleanup. Treat the runtime disk as sensitive and encrypted; monitor for `.plaintext.dump` remnants before exporting any directory. Keys beside encrypted archives are a local demonstration only and do not protect against compromise of the entire workstation.

## Recovery acceptance checks

The executable drill verifies actual restored data instead of reporting only a successful `pg_restore` exit:

- Every public table count and content hash matches the exact exported source snapshot.
- Tenant references have no orphan records; foreign keys remain validated.
- Every tenant's cached wallet balance equals its append-only credit-ledger sum.
- Every existing certificate keeps its actual PDF bytes/hash/header and exactly one issuance debit.
- Row-security flags/policies, application function definitions, table/function grants and append-only triggers match the source.
- The restored restricted application role sees no unscoped citizens and cannot read another tenant's citizens.
- A real ledger update is denied by the restored append-only trigger.
- The restored schema includes every published migration (seven in this release). The tenant-context wallet helper returns only the active tenant; direct wallet UPDATE and direct balance-trigger execution remain revoked for the application account.
- Corrupted ciphertext and an incorrect key cannot create a restore database or plaintext file.
- Main-database and existing-target overwrite attempts are denied; no plaintext dump remains after handled operations.

The new restore database stays available for inspection. It is never wired to the frontend or production traffic. Removal of a restore database requires a separate explicit administrative procedure; these scripts intentionally do not drop it.

## Production readiness gaps

The successful local drill establishes recoverability of the current database snapshot and in-database PDF/attachment bytes. It does not establish production disaster recovery. Before pilot operation, define and test:

1. Independent offsite backup storage with immutable versions and retention policies.
2. KMS/HSM or equivalent independent key custody, access control, escrow, rotation and key-loss recovery; keys must not travel alongside backups.
3. Encrypted storage/TLS, WAL archiving and point-in-time recovery with approved RPO/RTO.
4. Backup scheduling/monitoring, capacity controls and documented failure alerts.
5. Isolated recovery infrastructure and an authorized exercise that includes secret/config restoration, application startup, object storage, queue/outbox replay and certificate verification.
6. Citizen-data retention/deletion requirements, lawful access, restricted operator handling and an audit of backup permissions.

No live gateway keys, lawful identity-provider contracts, official certificate permissions, production retention schedules or government-fee policies are assumed by this local implementation.
