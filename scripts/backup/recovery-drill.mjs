import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import {
  backupDirectory,
  root,
  loadConfiguration,
  openDatabase,
  createBackup,
  restoreBackup,
  generatedRestoreName,
} from "./backup.mjs";

const lines = [];
const evidence = {
  executedAt: new Date().toISOString(),
  scope:
    "Local synthetic PostgreSQL only; no hosted backup or disaster recovery claim.",
  status: "RUNNING",
  checks: [],
};
const evidencePrefix =
  process.env.ASTRA_BACKUP_EVIDENCE_PREFIX ?? "security-backup";
if (!/^[a-z][a-z0-9-]{0,60}$/.test(evidencePrefix))
  throw new Error("Unsafe backup evidence filename prefix.");
const record = (message) => {
  lines.push(message);
  if (message.startsWith("PASS:")) evidence.checks.push(message.slice(6));
  console.log(message);
};

async function drill() {
  record(
    `OPS-02 encrypted PostgreSQL recovery drill; ${new Date().toISOString()}`,
  );
  const configuration = await loadConfiguration();
  const backup = await createBackup(configuration);
  const migrationCount = (
    await fs.readdir(path.join(root, "db", "migrations"))
  ).filter((name) => name.endsWith(".sql")).length;
  assert(
    backup.manifest.state.tenants.length >= 2,
    "Drill needs two populated synthetic tenants.",
  );
  assert(
    backup.manifest.state.certificates.length >= 1,
    "Drill needs an actual issued certificate PDF.",
  );
  assert(
    backup.manifest.state.tables.find(
      (table) => table.name === "schema_migrations",
    ).rows === migrationCount,
    "Final drill needs every published migration applied.",
  );
  record(
    `PASS: real pg_dump exported snapshot; tables=${backup.manifest.state.tables.length}, tenants=${backup.manifest.state.tenants.length}, certificates=${backup.manifest.state.certificates.length}.`,
  );
  const archive = await fs.readFile(backup.archivePath);
  assert(!archive.subarray(0, 5).equals(Buffer.from("PGDMP")));
  record(
    `PASS: encrypted AES-256-GCM archive (${archive.length} bytes); plaintext dump and identity values are not printed.`,
  );
  const restored = await restoreBackup({ ...backup, configuration });
  const primaryTenant = restored.state.tenants.find(
    (tenant) => tenant.certificates > 0 && tenant.citizens > 0,
  );
  assert(
    primaryTenant,
    "Isolation/immutability probes need a tenant with actual issued records.",
  );
  const otherTenant = restored.state.tenants.find(
    (tenant) => tenant.id !== primaryTenant.id && tenant.citizens > 0,
  );
  assert(
    otherTenant,
    "Isolation probe needs a distinct second tenant with citizen records.",
  );
  evidence.snapshot = {
    tables: restored.state.tables.length,
    tenants: restored.state.tenants.length,
    certificates: restored.state.certificates.length,
    migrationFiles: migrationCount,
    applicationRoutines: restored.state.functionDefinitions.length,
    columnGrants: restored.state.columnGrants.length,
    indexes: restored.state.indexes.length,
    encryptedBytes: archive.length,
    archiveSha256: crypto.createHash("sha256").update(archive).digest("hex"),
  };
  record(
    `PASS: restored only a new isolated database ${restored.targetName}; every table count/hash exactly matches the exported snapshot.`,
  );
  record(
    `PASS: all ${migrationCount} migrations, tenant rows, foreign-key definitions/validation, RLS flags/policies, function definitions/grants and append-only triggers preserved; orphan tenant references=${restored.state.orphanTenantReferences}.`,
  );
  record(
    `PASS: ${restored.state.functionDefinitions.length} application routines, ${restored.state.columnGrants.length} column grants, ${restored.state.indexes.length} indexes, column definitions, views/enums/sequences, extensions and schema/default grants match.`,
  );
  const totalBalance = restored.state.tenants.reduce(
    (total, row) => total + row.balance,
    0,
  );
  record(
    `PASS: ${restored.state.tenants.length} tenant wallet balances equal append-only ledger sums; total credits=${totalBalance}.`,
  );
  record(
    `PASS: ${restored.state.certificates.length} actual certificate PDFs retain SHA-256 hashes, %PDF- headers and one issuance debit each.`,
  );

  const appUrl = new URL(configuration.app);
  appUrl.pathname = "/" + restored.targetName;
  const app = await openDatabase(appUrl);
  try {
    const restricted = (
      await app.query(
        "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
      )
    ).rows[0];
    assert.equal(restricted.rolsuper, false);
    assert.equal(restricted.rolbypassrls, false);
    const scopedTables = (
      await app.query(
        "SELECT c.relname AS name FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='tenant_id' WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' AND c.relrowsecurity ORDER BY c.relname",
      )
    ).rows;
    for (const { name } of scopedTables) {
      assert.match(name, /^[a-z][a-z0-9_]*$/);
      assert.equal(
        (await app.query(`SELECT count(*)::integer AS count FROM "${name}"`))
          .rows[0].count,
        0,
        `Unscoped access denied for ${name}`,
      );
    }
    record(
      `PASS: restored restricted application role sees zero unscoped rows across all ${scopedTables.length} tenant-scoped RLS tables.`,
    );
    const paymentPrivileges = (
      await app.query(
        "SELECT has_column_privilege(current_user,'gateway_payment_intents','status','UPDATE') AS status_update,has_column_privilege(current_user,'gateway_payment_intents','amount_minor','UPDATE') AS amount_update,has_table_privilege(current_user,'gateway_payment_receipts','UPDATE') AS receipt_update",
      )
    ).rows[0];
    assert.deepEqual(paymentPrivileges, {
      status_update: true,
      amount_update: false,
      receipt_update: false,
    });
    assert.equal(
      (
        await app.query(
          "SELECT * FROM resolve_gateway_callback('invalid-backup-drill-token')",
        )
      ).rowCount,
      0,
    );
    record(
      "PASS: restored gateway allows operational status updates but denies amount/receipt edits; invalid callback token resolves no tenant or payment.",
    );
    assert.equal(
      (await app.query("SELECT count(*)::integer AS count FROM citizens"))
        .rows[0].count,
      0,
    );
    await app.query("BEGIN");
    await app.query("SELECT set_config('astra.tenant_id',$1,true)", [
      primaryTenant.id,
    ]);
    const tenantRows = (
      await app.query("SELECT count(*)::integer AS count FROM citizens")
    ).rows[0].count;
    assert.equal(tenantRows, primaryTenant.citizens);
    assert.equal(
      (
        await app.query(
          "SELECT count(*)::integer AS count FROM citizens WHERE tenant_id=$1",
          [otherTenant.id],
        )
      ).rows[0].count,
      0,
    );
    await app.query("ROLLBACK");
    record(
      "PASS: restored restricted application account sees no unscoped citizens; tenant A cannot read tenant B citizens.",
    );
    assert.equal(
      (
        await app.query(
          "SELECT count(*)::integer AS count FROM lock_tenant_wallet()",
        )
      ).rows[0].count,
      0,
    );
    const privileges = (
      await app.query(
        "SELECT has_table_privilege(current_user,'tenant_wallets','UPDATE') AS wallet_update,has_function_privilege(current_user,'lock_tenant_wallet()','EXECUTE') AS lock_execute,has_function_privilege(current_user,'apply_ledger()','EXECUTE') AS trigger_execute",
      )
    ).rows[0];
    assert.equal(privileges.wallet_update, false);
    assert.equal(privileges.lock_execute, true);
    assert.equal(privileges.trigger_execute, false);
    await app.query("BEGIN");
    await app.query("SELECT set_config('astra.tenant_id',$1,true)", [
      primaryTenant.id,
    ]);
    const lockedWallets = (
      await app.query("SELECT balance FROM lock_tenant_wallet()")
    ).rows;
    assert.deepEqual(lockedWallets, [{ balance: primaryTenant.balance }]);
    await app.query("ROLLBACK");
    await app.query("BEGIN");
    await app.query("SELECT set_config('astra.tenant_id',$1,true)", [
      primaryTenant.id,
    ]);
    await assert.rejects(
      app.query(
        "UPDATE tenant_wallets SET balance=balance WHERE tenant_id=$1",
        [primaryTenant.id],
      ),
      /permission denied/,
    );
    await app.query("ROLLBACK");
    record(
      "PASS: restored tenant-context wallet helper locks only the active tenant; direct wallet UPDATE and direct trigger execution privileges remain revoked.",
    );
    await app.query("BEGIN");
    await app.query("SELECT set_config('astra.tenant_id',$1,true)", [
      primaryTenant.id,
    ]);
    await assert.rejects(
      app.query("UPDATE credit_ledger SET reason=reason WHERE tenant_id=$1", [
        primaryTenant.id,
      ]),
      /Append-only record/,
    );
    await app.query("ROLLBACK");
    record(
      "PASS: restored ledger still rejects modification through the real database trigger.",
    );
  } finally {
    await app.end();
  }

  const administrator = await openDatabase(configuration.admin);
  try {
    const before = (
      await administrator.query(
        "SELECT datname FROM pg_database WHERE datname LIKE 'astra_restore_%' ORDER BY datname",
      )
    ).rows;
    const corrupted = Buffer.from(archive);
    corrupted[corrupted.length - 1] ^= 0x01;
    const corruptedPath = path.join(
      backupDirectory,
      `corrupt_${crypto.randomBytes(4).toString("hex")}.pgdump.aes`,
    );
    await fs.writeFile(corruptedPath, corrupted, { mode: 0o600 });
    try {
      await assert.rejects(
        restoreBackup({
          archivePath: corruptedPath,
          keyPath: backup.keyPath,
          targetName: generatedRestoreName(),
          configuration,
        }),
        /Backup authentication failed/,
      );
      record(
        "PASS: modified ciphertext rejected by actual restore path before plaintext/database creation.",
      );
    } finally {
      await fs.rm(corruptedPath);
    }
    await assert.rejects(
      restoreBackup({
        ...backup,
        configuration,
        targetName: generatedRestoreName(),
        keyOverride: crypto.randomBytes(32),
      }),
      /Backup authentication failed/,
    );
    record(
      "PASS: wrong encryption key rejected by actual restore path before plaintext/database creation.",
    );
    await assert.rejects(
      restoreBackup({ ...backup, configuration, targetName: "astra" }),
      /main astra is forbidden/,
    );
    await assert.rejects(
      restoreBackup({
        ...backup,
        configuration,
        targetName: restored.targetName,
      }),
      /already exists/,
    );
    const reservedTarget = generatedRestoreName();
    const reservedPath = path.join(
      backupDirectory,
      `${reservedTarget}.restore.plaintext.dump`,
    );
    const sentinel = crypto.randomBytes(32);
    await fs.writeFile(reservedPath, sentinel, { flag: "wx", mode: 0o600 });
    try {
      await assert.rejects(
        restoreBackup({ ...backup, configuration, targetName: reservedTarget }),
        /EEXIST/,
      );
      assert.deepEqual(await fs.readFile(reservedPath), sentinel);
      assert.equal(
        (
          await administrator.query(
            "SELECT 1 FROM pg_database WHERE datname=$1",
            [reservedTarget],
          )
        ).rowCount,
        0,
      );
      record(
        "PASS: pre-existing restore scratch file remains byte-for-byte unchanged; collision creates no database and cleanup cannot remove an unowned file.",
      );
    } finally {
      await fs.rm(reservedPath);
    }
    record(
      "PASS: main database and existing restore targets cannot be overwritten or dropped.",
    );
    const after = (
      await administrator.query(
        "SELECT datname FROM pg_database WHERE datname LIKE 'astra_restore_%' ORDER BY datname",
      )
    ).rows;
    assert.deepEqual(after, before);
    const plaintextFiles = (await fs.readdir(backupDirectory)).filter((name) =>
      name.includes(".plaintext.dump"),
    );
    assert.deepEqual(plaintextFiles, []);
    record(
      "PASS: no plaintext backup/restore dump files remain; failed authentication created no database.",
    );
  } finally {
    await administrator.end();
  }
  record(
    "RESULT: OPS-02 local encrypted backup/restore drill PASS. Main astra received only snapshot SELECTs; no writes/drop/restore targeted it.",
  );
  evidence.status = "PASS";
  record(
    "UNVERIFIED: offsite durability, independent KMS key custody, rotation/retention, production RPO/RTO and full infrastructure disaster recovery.",
  );
}

try {
  await drill();
} catch (error) {
  evidence.status = "FAIL";
  record(`RESULT: OPS-02 FAIL (${error.message}); no pass is claimed.`);
  process.exitCode = 1;
} finally {
  evidence.durationMs = Date.now() - Date.parse(evidence.executedAt);
  await fs.mkdir(path.join(root, "execution"), { recursive: true });
  await fs.appendFile(
    path.join(root, "execution", `${evidencePrefix}-restore.log`),
    lines.join("\n") + "\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(root, "execution", `${evidencePrefix}-qa.json`),
    JSON.stringify(evidence, null, 2) + "\n",
    "utf8",
  );
}
