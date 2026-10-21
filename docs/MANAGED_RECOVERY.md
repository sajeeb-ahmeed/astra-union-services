# Managed PostgreSQL export and independent recovery

This operator tooling addresses the first merchant-independent preservation priority. It creates an encrypted, consistent logical snapshot under the existing **NOSUPERUSER / NOBYPASSRLS migration owner** and restores it to a new independent PostgreSQL 17 cluster. The application role is never elevated; no public backup endpoint exists.

## Completed hosted recovery rehearsal — 21 October 2026

The actual hosted database was exported successfully at **07:28:07 UTC / 13:28:07 Asia/Dhaka**: **49 tables, 3 tenants and 2 stored certificate PDFs**. The encrypted archive is 9,887,482 bytes. A fresh independent local cluster restored the same archive with exact data/PDF hashes, financial invariants, schema/security values and application object ownership preserved. **Eight SQL/runtime checks and six real HTTP checks passed — 14 combined acceptance groups.** These are completed recovery results, not a claim that a new application release has been deployed.

The actual restored application passed PostgreSQL health, built frontend and 47-service availability, correct and invalid QR verification, existing QA citizen login, byte-identical protected PDF delivery, unauthorized access rejection, disabled payment configuration and logout. The recovery server and its owned cluster have been stopped; recovered files remain available. Restoring and testing this archive made no remote database connection or hosted business-data change. Temporary hosted external access was removed after export; the provider's empty external IP allowlist was verified at **07:28:31 UTC**.

Private artifacts for this run:

- Encrypted archive, relative to the project: `.runtime/managed-backups/managed_20261021072732629_da76544e.aes`.
- Separate key file: `%USERPROFILE%\.astra-recovery\keys\managed_20261021072732629_da76544e.key`.
- Private restored connection details: `.runtime/managed-backups/managed_20261021072732629_da76544e.recovered.json`.
- Public archive integrity reference: SHA-256 `e9ac1f6f7c6a6076bbdad69a8403439cc2dd150ebce93cf363322639844d9d34`.

Never commit or attach the archive, key, private connection details or raw diagnostic files. **The owner explicitly chose encrypted local storage for this run and postponed offsite storage.** Keeping the key in a different directory on this workstation does not establish independent custody. This is a manual point-in-time snapshot: no scheduled backup, retention service, guaranteed RPO or approved production RTO has been established. Records created after the snapshot are not included.

Two initial restore attempts failed and were retained honestly. The first encountered a provider `postgres` default-ACL identity missing from the new cluster; the bounded, non-login catalog-role handling described below resolved it. The second encountered different catalog query ordering; exact unordered-collection comparison resolved it without relaxing any data/hash/security value check. Both failed clusters were stopped and their files retained; the original encrypted archive remained unchanged. A separate private HTTP wrapper initially selected a nonexistent QA account entry. Selecting the existing QA citizen credentials corrected that wrapper; it was not a product failure and required no recovered business-record change.

This archive was created before database locale metadata was added to the exporter. Its **source locale is explicitly unknown**, while the rehearsal target reports `C`/`C`, UTF8. Catalog comparison preserves all values but does not prove identical locale-dependent runtime behavior. The result is **not a cutover approval**. Durable hosting, source locale compatibility, independent key escrow/offsite storage and recurring recovery operations remain open.

Evidence: [hosted export](../execution/managed-hosted-backup.json), [independent restore](../execution/managed-independent-restore.json), [actual restored HTTP acceptance](../execution/recovery-mfa-restored-http.json), [attempt history](../execution/managed-hosted-restore-attempts.json), [external access closed](../execution/recovery-mfa-network-qa.json).

## Scope and safety contract

`scripts/backup/managed-recovery.mjs` pins hosted access to Render database `dpg-db6tr43ncjis73ercfsg-a`, its Singapore external hostname and database `astra_uvug`. It reads the ignored `.runtime/hosted/render-database.json` internally. Node connections require certificate/hostname verification; PostgreSQL tools use `sslmode=verify-full` with an explicit temporary PEM bundle from Node's trusted root certificates, avoiding Windows OpenSSL default-path ambiguity. Invalid host, database, resource ID, application-role credentials, TLS downgrade, URL query override or fragment fail before connection. External network access must be managed separately by the authorized operator; the script never changes a firewall rule.

For local tests, only dedicated `astra_managed_*` databases on loopback port 55432/5432 are permitted. The main development database is not a valid logical-export test target. Independent restore accepts only loopback port **55433**, authenticates the entire archive before making database changes and requires a cluster with no application database or source role already present. Existing databases, roles and directories are never overwritten or dropped.

The source transaction is `REPEATABLE READ READ ONLY`. Global tables export once. Tenant tables export under each enumerated tenant with an **explicit tenant predicate**, even where existing owner-only SELECT policies permit wider access. The two reviewed MFA account tables export under each platform account with an explicit `user_id` predicate. This avoids missing account rows and duplicating records from public-verification owner policies.

Completeness is structural: every table must fit a supported inventory; tenant/account scope columns must be non-null and connected to their scope directory by validated foreign keys. Only exact reviewed RLS expressions and owner-only public lookup policies are accepted. Other policies, sequences, views, partitioned/foreign tables, generated/identity columns, extra user schemas, large objects or multiple application object owners fail closed. Such additions need a reviewed exporter extension; they cannot be silently omitted.

**Migration 014 is required.** Historically `audit_events.tenant_id` was nullable although its forced tenant policy hid null-scope rows. The exporter refuses that ambiguous schema. Migration 014 makes the column NOT NULL, with PostgreSQL checking all existing rows; a legacy null makes the migration fail without deleting it. Global account security records belong to the new account-scoped audit table. No tenant policy is relaxed for backup.

## Runbook

Use PostgreSQL 17 client binaries. Windows defaults to `.runtime/pgsql/bin`; `PG_BINARY_DIRECTORY` can select a trusted directory. Credentials pass through child environment variables, never command-line arguments. Inherited `PG*` values are removed before setting the validated connection. Private diagnostics are capped at 64 KiB per PostgreSQL command.

```powershell
# Fast safety tests: no database access or mutations.
node --test scripts/backup/managed-recovery.test.mjs

# Synthetic managed owner on a new local database; fresh independent restore cluster.
# The existing local database must contain a previously generated demonstration PDF.
node scripts/backup/managed-drill.mjs

# Hosted export only after reviewed migrations and authorized narrow network access.
node scripts/backup/managed-recovery.mjs backup --hosted

# Save the exact managed_... archive name printed by the successful export.
# Start a new, empty, independent loopback cluster. An occupied port fails safely.
node scripts/backup/managed-cluster.mjs start
node scripts/backup/managed-recovery.mjs restore <managed_archive_name>

# Stop only the owned recovery cluster. Data remains available for inspection.
node scripts/backup/managed-cluster.mjs stop
```

Close temporary hosted external access after export, including on failure. The restore reads the encrypted local archive and needs no live database connection. Never run a restore against the existing hosted database. Keep the old hosted environment until a separate reversible cutover is approved and verified.

## What the artifact and restore contain

The encrypted archive contains the schema-only `pg_dump` custom archive, all logical row values, exact PostgreSQL JSON row fingerprints, the comprehensive data/security manifest and original object ownership metadata. Actual certificate/attachment `bytea` values survive. Source database credentials and role passwords are never exported. Password hashes, sessions, recovery tokens, encrypted MFA/gateway data and citizen records **are application data** and therefore inside the encrypted archive; treat every archive as sensitive.

Restore creates the original owner/application role names with fresh passwords, `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`, and no source memberships. Provider-specific group membership and administrative capability are not reproduced. Schema ownership and SECURITY DEFINER ownership are preserved. Pre-data objects load first, rows second, then constraints, indexes, RLS and triggers; this prevents credit-ledger triggers from replaying issuance.

Render's schema dump also contains default privileges owned by its `postgres` provider identity. When the encrypted catalog manifest references this identity, restore creates a **NOLOGIN, NOINHERIT** catalog role with every administrative privilege disabled, no password and no memberships. This preserves the exact default ACLs without reproducing provider authentication or power. Unknown extra catalog roles fail before recovery database writes and require a reviewed policy. The local managed fixture includes this provider-style default ACL case and verifies the auxiliary role restrictions.

Acceptance compares every table count/hash, tenant totals, PDFs, one issuance debit per certificate, wallet/ledger totals, migrations, constraints, RLS policies, function definitions and grants, column/schema/default grants, indexes and application object owners. Runtime probes verify restricted application-role attributes, zero unscoped tenant/account reads, cross-tenant isolation, denied wallet/payment/receipt edits, append-only ledger enforcement and existing/invalid QR token behavior.

Catalog `ORDER BY text` results can differ between database collations. Comparison sorts only the reviewed **unordered top-level manifest collections**, retaining complete row values, duplicate counts, column/enum positions, nested array order and SQL definition strings. Table/PDF hashes are never normalized or relaxed. New archives record database collation, character type and encoding; older archives without this metadata explicitly report `NOT_CAPTURED_IN_THIS_ARCHIVE`. A loopback cluster using the workstation's locale is a recovery rehearsal, **not an approved cutover target**; source locale/extension compatibility must be established separately before a real migration.

The local drill creates two synthetic tenants and two account scopes, uses actual previously generated PDF bytes, and tests nullable global session rows. Its source is a non-superuser managed-owner fixture. It does not exercise a genuine hosted export. Every execution report retains its own timestamp and scope.

The drill also starts the **real application server** on a dynamic loopback HTTP port, connected only to the independently restored restricted database role. It uses fresh recovery environment secrets, explicitly disabled bKash, and no inherited merchant configuration. It checks PostgreSQL health, built frontend availability, all 47 catalog entries, valid/invalid QR verification, real-password QA login, byte-identical authorized PDF delivery, anonymous/invalid-session/cross-tenant PDF rejection, disabled gateway configuration and logout. The QR token exposes bounded verification data; PDF delivery still requires an authorized session.

`verifyRecoveredHttp({name, archive, accounts})` is exported from `scripts/backup/managed-drill.mjs`; importing it does not run the synthetic drill. A separate private operator script can use it for an actual hosted archive after restore. Read `archive` with `readManagedArchive(name)` and supply an array of separately held QA credentials `{email, password, certificateId}`. Do not put these values in source, command arguments or public evidence. The helper never contacts the source database and changes only login/logout state in the recovered environment. An enabled MFA challenge is not treated as a successful login or bypassed; use an appropriate approved QA account or separately implement the preserved-factor acceptance with escrowed keys.

## Encryption, storage and operational limits

Each archive uses a random 256-bit AES-GCM key, a fresh 96-bit nonce and authenticated format bytes. Archives are written exclusively under ignored `.runtime/managed-backups`. Keys are written under the user's **`.astra-recovery/keys` outside the repository**; values are never printed. Wrong keys, altered ciphertext, malformed metadata, missing table records, count/hash mismatches and duplicate row payloads are rejected. New artifact paths cannot traverse to other directories; symlinked artifact files are refused.

Different directories on one workstation **are not independent key custody**. Neither offsite replication, workstation-loss recovery, key escrow, retention automation nor scheduled alerts are established by these scripts. Approved storage and a separate recoverable key custodian remain required. On Windows, filesystem modes do not replace an operator review of inherited NTFS access; keep the workstation account/disk protected.

Schema plaintext is briefly present in ignored private runtime storage; handled errors remove only scratch files created by the operation. Abrupt OS/process failures require operator inspection. Row data and encryption operate in memory and are intended for the current small database, not a measured large-volume RTO. Failed recovery clusters remain intact for inspection. Nothing here deletes source records or old backups automatically.

MFA and gateway ciphertext require the corresponding application encryption keys at future application recovery. These database artifacts do not include Render environment secrets, object stores or OS configuration. Use a separate approved secret escrow and **new recovery-only session/application configuration**; never activate payment or outbound notifications in a recovery rehearsal. The HTTP acceptance above covers application startup and the specified readback paths; production TLS/proxy, independently escrowed keys, enabled-factor recovery, external object stores and complete infrastructure disaster recovery remain separate gates.

## Evidence

- `execution/managed-recovery-local-qa.json`: actual synthetic independent-cluster drill results.
- `execution/managed-hosted-backup.json`: created only by an actual successful hosted export.
- `execution/managed-independent-restore.json`: created by an actual successful CLI restore.
- `execution/recovery-mfa-restored-http.json`: six passing application HTTP groups against the actual hosted archive restored locally.
- `execution/managed-hosted-restore-attempts.json`: two failed restore attempts, the successful retry and unchanged archive integrity.
- `execution/recovery-mfa-network-qa.json`: empty hosted external IP allowlist after export.
- `.runtime/managed-backups/<name>.recovered.json`: private recovery credentials and target information; never publish it.

A source commit or successful export alone does not prove recovery. Require completed restore comparison and runtime checks. Hosted offsite/key-custody and durable-hosting gates remain open until separately executed; the recorded free-database expiry still needs current provider verification and a hosting decision.
