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
const record = (message) => {
  lines.push(message);
  console.log(message);
};

async function drill() {
  record(
    `OPS-02 encrypted PostgreSQL recovery drill; ${new Date().toISOString()}`,
  );
  const configuration = await loadConfiguration();
  const backup = await createBackup(configuration);
  const migrationCount = (await fs.readdir(path.join(root, 'db', 'migrations'))).filter(name => name.endsWith('.sql')).length;
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
  record(
    `PASS: restored only a new isolated database ${restored.targetName}; every table count/hash exactly matches the exported snapshot.`,
  );
  record(
    `PASS: all ${migrationCount} migrations, tenant rows, foreign-key definitions/validation, RLS flags/policies, function definitions/grants and append-only triggers preserved; orphan tenant references=${restored.state.orphanTenantReferences}.`,
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
    assert.equal(
      (await app.query("SELECT count(*)::integer AS count FROM citizens"))
        .rows[0].count,
      0,
    );
    await app.query("BEGIN");
    await app.query("SELECT set_config('astra.tenant_id',$1,true)", [
      restored.state.tenants[0].id,
    ]);
    const tenantRows = (
      await app.query("SELECT count(*)::integer AS count FROM citizens")
    ).rows[0].count;
    assert.equal(tenantRows, restored.state.tenants[0].citizens);
    assert.equal(
      (
        await app.query(
          "SELECT count(*)::integer AS count FROM citizens WHERE tenant_id=$1",
          [restored.state.tenants[1].id],
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
      restored.state.tenants[0].id,
    ]);
    const lockedWallets = (
      await app.query("SELECT balance FROM lock_tenant_wallet()")
    ).rows;
    assert.deepEqual(lockedWallets, [
      { balance: restored.state.tenants[0].balance },
    ]);
    await app.query("ROLLBACK");
    await app.query("BEGIN");
    await app.query("SELECT set_config('astra.tenant_id',$1,true)", [
      restored.state.tenants[0].id,
    ]);
    await assert.rejects(
      app.query(
        "UPDATE tenant_wallets SET balance=balance WHERE tenant_id=$1",
        [restored.state.tenants[0].id],
      ),
      /permission denied/,
    );
    await app.query("ROLLBACK");
    record(
      "PASS: restored tenant-context wallet helper locks only the active tenant; direct wallet UPDATE and direct trigger execution privileges remain revoked.",
    );
    await app.query("BEGIN");
    await app.query("SELECT set_config('astra.tenant_id',$1,true)", [
      restored.state.tenants[0].id,
    ]);
    await assert.rejects(
      app.query("UPDATE credit_ledger SET reason=reason WHERE tenant_id=$1", [
        restored.state.tenants[0].id,
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
  record(
    "UNVERIFIED: offsite durability, independent KMS key custody, rotation/retention, production RPO/RTO and full infrastructure disaster recovery.",
  );
}

try {
  await drill();
} catch (error) {
  record(`RESULT: OPS-02 FAIL (${error.message}); no pass is claimed.`);
  process.exitCode = 1;
} finally {
  await fs.mkdir(path.join(root, "execution"), { recursive: true });
  await fs.writeFile(
    path.join(root, "execution", "backup-restore.log"),
    lines.join("\n") + "\n",
    "utf8",
  );
}
