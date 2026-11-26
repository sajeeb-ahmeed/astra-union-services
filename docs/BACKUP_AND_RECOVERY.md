# Backup and recovery readiness

This runbook covers the merchant-independent recovery tooling delivered with the 0.6 security work. It does **not** claim that the hosted database has an offsite backup, a tested disaster-recovery environment or an extended hosting lifetime. The existing Render Free database was recorded as expiring on **12 November 2026**; recheck the provider dashboard before planning the cutover.

## Run the safe local workflow

The database must contain valid synthetic tenants, issued demonstration certificates and every published SQL migration. Finish any fixture tests that intentionally corrupt balances before taking the final drill snapshot.

```powershell
# Start the existing isolated runtime if stopped; this does not reset it.
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/runtime/start-postgres.ps1

# Fast safety tests, with no database writes or gateway credentials.
node --test scripts/backup/backup.test.mjs

# Full real pg_dump / pg_restore exercise against a NEW local database.
node scripts/backup/recovery-drill.mjs

# Or create an individual backup and use the concrete filenames it reports.
node scripts/backup/backup.mjs backup
node scripts/backup/backup.mjs restore .runtime/backups/backup_NAME.pgdump.aes .runtime/backups/backup_NAME.key
```

The tool reads ignored `.runtime/postgres.json`, or both `DATABASE_ADMIN_URL` and `DATABASE_URL` supplied by the operator. Both connections must address the same loopback `astra` database on port 55432 or 5432, with distinct administrator/application roles and no URL query or fragment overrides. The backup role must bypass RLS or be a local superuser so a partial tenant export cannot be mistaken for a full backup. It never opens production network access or modifies source security policies.

Windows binaries default to `.runtime/pgsql/bin`. On Linux, matching PostgreSQL tools can be found on `PATH`; `PG_BINARY_DIRECTORY` may select their directory. Use a client version compatible with the database server. Connection passwords are passed through the child environment, never command arguments or public evidence. Inherited `PG*` options are removed before the validated connection is passed to PostgreSQL tools.

The restore target is a newly generated `astra_restore_*` database in the same local cluster. The main database, existing database names, external hosts and artifact paths outside the immediate `.runtime/backups` directory are rejected. Existing scratch files are neither overwritten nor removed. No database-drop command exists in these scripts. Successful and failed partial restore databases remain available for operator inspection; they are never connected to live application traffic.

## Deleted citizen artifacts (A-011)

There is no soft delete anywhere in the product: removing a citizen
photo (`DELETE /citizens/:id/photo`) NULLs the stored bytes, and
removing a sign-in identifier (`DELETE /account/identifiers/:kind`)
deletes the row. Both are deliberate — keeping the bytes would defeat
the removal — so recovery is from backup, not from the row:

- Every such removal writes an append-only record that survives the
  deletion itself: photo removals write `CITIZEN_PHOTO_REMOVED` to
  `audit_events` **and** a row in `citizen_artifact_deletions`
  (migration 072, immutable trigger, mime type + byte count, never the
  bytes); identifier removals write `SIGN_IN_IDENTIFIER_REMOVED` to the
  append-only `account_security_events`; support-contact key removals
  are history-tracked in `platform_setting_changes`. Use the ledger row
  to establish *what* was removed, *when*, and *by whom* before
  restoring.
- To recover removed bytes or rows, restore the affected table from
  the encrypted backup archive (see the workflow above) into a scratch
  database and copy only the needed rows back; never restore a whole
  production database over live data to recover one photo. The
  append-only ledger rows themselves are part of the backup and must
  never be edited to "undo" a deletion — a restore is a new, auditable
  act, not an edit of history.
- A future soft-delete (retain bytes with a `deleted_at` flag) was
  considered and not built: it would keep personal bytes the user
  asked to remove. If retention law ever requires it, it needs an
  owner decision and a retention policy first.

## What is checked

An exported repeatable-read, read-only PostgreSQL snapshot supplies the custom-format dump and its encrypted manifest. The archive contains real table/PDF/attachment bytes, not a seed script or a reconstruction from API responses.

| Area                | Verification                                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data                | Every public table count and SHA-256 content fingerprint; all published migrations present                                                                  |
| Tenant consistency  | No orphan tenant references; wallet balances match ledger sums                                                                                              |
| Certificates        | Actual PDF bytes/hash/header and exactly one issuance debit per certificate                                                                                 |
| Database structure  | Constraint definitions/validation; column types/defaults/identity; indexes ready and valid; views, enums, sequences and extension versions                  |
| Security            | All application routines, RLS flags/policies, trigger definitions/enabled state, table/function/column/schema/default grants                                |
| Runtime behavior    | Restricted application role; no unscoped access across tenant-scoped RLS tables; cross-tenant read isolation; ledger immutability; wallet helper privileges |
| Payment protections | Operational status column update grant retained; payment amount and receipt edits denied; invalid callback token resolves no payment                        |
| Archive integrity   | AES-256-GCM authenticates metadata and dump; wrong key, modified archive and malformed payload rejected before restore writes                               |
| Restore safety      | Existing database and scratch-file collisions rejected; handled operations leave no plaintext dump remnants                                                 |

All non-extension application routines are compared, including gateway and account-recovery functions. The original checker only listed four early routines and did not compare payment column privileges. PostgreSQL's pretty deparser canonicalizes equivalent CHECK expressions; this avoids falsely rejecting restored constraints when PostgreSQL flattens redundant AND parentheses.

Sequence counters are not MVCC data. If future application versions introduce active sequences, quiesce writes during the drill; changing sequence state can correctly cause an exact comparison to fail. This checker does not claim an online point-in-time sequence snapshot under concurrent writes.

## Encryption, custody and compatibility

Each archive uses a random 256-bit key, a fresh 96-bit nonce and AES-256-GCM with authenticated format bytes. The encrypted payload contains a `format: 2` manifest and the PostgreSQL custom dump. No identity values, database URL, key contents or actual document bytes enter the safe execution report.

The current verifier requires the expanded format-2 manifest. Preserve older format-1 archives and the matching 0.5 verifier from Git history; do not delete them or silently accept missing security checks. Never mix a newer archive with an older verifier and claim equivalent coverage.

Local key files remain beside archives under ignored `.runtime/backups`. This is useful for a development drill but **does not provide independent key custody**. Do not upload this whole directory, add it to Git or export keys with archives. For operational backups, use approved offsite encrypted storage and a separate controlled key store, with a recoverable key escrow procedure.

The dump and restored manifest are currently loaded into memory. Budget memory and disk for the actual database size; this tooling has been exercised with the local test dataset, not a large production database. Plaintext scratch dumps exist briefly on the local disk. Handled errors remove only files created by that operation; process termination, OS failure or full disks still require private-disk inspection and cleanup. Prefer encrypted disks and restricted workstation accounts.

The dump intentionally excludes global roles and does not rewrite ownership on restore. The local drill reuses the existing cluster's role identities. It validates application data/security within that context; recovery on a different host also needs reviewed roles, memberships, ownership mappings, secrets, TLS and server configuration. It does not back up externally stored objects, application environment variables or operating-system configuration.

## Evidence and CI

Executed **19 October 2026, 04:19:30 UTC**: **PASS**, 17 full-drill checks and 5 focused safety tests. The verified local snapshot contained 46 public tables, 117 synthetic tenants, 435 issued demonstration PDFs, all 11 migration files (highest numbered migration 012), 18 application routines, 7 column grants and 94 indexes. All 30 tenant-scoped RLS tables denied unscoped reads. The complete drill took approximately 10.3 seconds on this workstation; this is not a production RTO measurement. Snapshot counts will change as later tests create more fixtures.

- Safety tests: `node --test scripts/backup/backup.test.mjs`.
- Latest full drill: [security-backup-qa.json](../execution/security-backup-qa.json).
- Every run of the new drill appends its actual results to [security-backup-restore.log](../execution/security-backup-restore.log). The existing 0.1 recovery evidence remains historical.
- `ASTRA_BACKUP_EVIDENCE_PREFIX` can select a separate lowercase filename prefix for a future release; it cannot escape `execution/`.
- Add safety tests to regular CI. Run the full drill after database migration, seeding and API issuance tests, with PostgreSQL 17 `pg_dump` and `pg_restore` available. Serialize it after fixture mutations settle.
- A successful backup command alone is not restore acceptance. Require the restored data comparison and application-role checks to pass before labelling an archive verified.

## Hosted expiry and independent recovery checklist

These steps need no payment merchant account. They remain operational work until independently executed and evidenced:

1. Confirm the current database expiry, data volume, hosting choice, backup operator and approved recovery objectives. A paid upgrade is a separate owner decision.
2. Arrange a complete protected hosted export or provider snapshot that includes every tenant under forced RLS. Do not disable RLS, widen application privileges or accept a filtered export. No public credentials or long-lived unrestricted IP rule is needed in this runbook.
3. Store the archive offsite with integrity verification, retention and restricted access; store its key separately. Record the backup timestamp and completeness evidence without citizen data.
4. Restore to an isolated recovery environment and validate all tenant rows, PDFs, ledger balances, current migrations, roles, ownership, grants and public verification behavior. Rehearse application startup using recovery-specific secrets; keep gateways and outgoing notifications disabled.
5. Measure elapsed restore time and data-loss window against agreed RTO/RPO. Keep the old environment until a reversible cutover and readback are accepted.
6. Configure recurring backup jobs, stale/failed-backup alerts, retention cleanup, key rotation/escrow and periodic independent restore exercises. Record who responds and how to recover after that operator or workstation is unavailable.

The local PASS result is one prerequisite for this plan, not evidence that the hosted expiry risk or offsite recovery work has been resolved.
