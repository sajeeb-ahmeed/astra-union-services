import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import {
  backupDirectory,
  decryptPayload,
  encryptPayload,
  generatedRestoreName,
  requireWorkspaceBackupPath,
  validateConfiguration,
  validateState,
} from "./backup.mjs";

function configuration() {
  return {
    admin: new URL("postgresql://local_admin:synthetic@127.0.0.1:55432/astra"),
    app: new URL("postgresql://local_app:synthetic@127.0.0.1:55432/astra"),
    bin: "",
  };
}

test("backup configuration only accepts the local source and distinct application role", () => {
  assert.doesNotThrow(() => validateConfiguration(configuration()));
  for (const value of [
    "postgresql://admin:synthetic@db.example.test:55432/astra",
    "postgresql://admin:synthetic@127.0.0.1:6543/astra",
    "postgresql://admin:synthetic@127.0.0.1:55432/postgres",
    "postgresql://admin:synthetic@127.0.0.1:55432/astra?host=db.example.test",
    "postgresql://admin:synthetic@127.0.0.1:55432/astra?options=-csearch_path=other",
    "postgresql://admin:synthetic@127.0.0.1:55432/astra#ignored",
  ]) {
    assert.throws(
      () =>
        validateConfiguration({ ...configuration(), admin: new URL(value) }),
      /known loopback/,
    );
  }
  const invalidApp = configuration();
  invalidApp.app = new URL(invalidApp.admin);
  assert.throws(() => validateConfiguration(invalidApp), /contract mismatch/);
  invalidApp.app = new URL(
    "postgresql://local_app:synthetic@127.0.0.1:55432/astra?host=remote",
  );
  assert.throws(() => validateConfiguration(invalidApp), /contract mismatch/);
});

test("artifact paths cannot escape backup directory or select nested link directories", () => {
  assert.equal(
    requireWorkspaceBackupPath(path.join(backupDirectory, "test.aes")),
    path.join(backupDirectory, "test.aes"),
  );
  for (const value of [
    backupDirectory,
    path.join(backupDirectory, "..", "credentials.json"),
    path.join(backupDirectory, "nested", "test.aes"),
    backupDirectory + "-sibling/test.aes",
  ])
    assert.throws(
      () => requireWorkspaceBackupPath(value),
      /must remain inside/,
    );
  const names = new Set(
    Array.from({ length: 50 }, () => generatedRestoreName()),
  );
  assert.equal(names.size, 50);
  for (const name of names)
    assert.match(name, /^astra_restore_[a-z0-9_]{1,48}$/);
});

function archiveFixture() {
  const dump = Buffer.from("PGDMPsynthetic-opaque-archive");
  const metadata = Buffer.from(
    JSON.stringify({
      format: 2,
      dumpSha256: crypto.createHash("sha256").update(dump).digest("hex"),
    }),
  );
  const length = Buffer.alloc(4);
  length.writeUInt32BE(metadata.length);
  const key = crypto.randomBytes(32);
  return {
    dump,
    key,
    archive: encryptPayload(Buffer.concat([length, metadata, dump]), key),
  };
}

test("encrypted archive authenticates metadata, nonce, tag and dump", () => {
  const { dump, key, archive } = archiveFixture();
  assert.deepEqual(decryptPayload(archive, key).dump, dump);
  assert.throws(
    () => decryptPayload(archive, crypto.randomBytes(32)),
    /authentication failed/,
  );
  for (const byte of [0, 18, 25, 37, archive.length - 1]) {
    const changed = Buffer.from(archive);
    changed[byte] ^= 1;
    assert.throws(() => decryptPayload(changed, key), /authentication failed/);
  }
  assert.throws(
    () => decryptPayload(archive.subarray(0, 20), key),
    /authentication failed/,
  );
  assert.throws(
    () => decryptPayload(archive, Buffer.alloc(31)),
    /authentication failed/,
  );
});

test("authenticated but malformed manifest or changed dump hash cannot restore", () => {
  const key = crypto.randomBytes(32);
  for (const payload of [
    Buffer.from([0, 0, 0, 255, 1]),
    Buffer.from([0, 0, 0, 2, 123, 125, 80, 71, 68, 77, 80]),
    Buffer.from([0, 0, 0, 2, 123, 93, 80, 71, 68, 77, 80]),
  ])
    assert.throws(
      () => decryptPayload(encryptPayload(payload, key), key),
      /authentication failed/,
    );
});

test("recovery rejects corrupt financial, PDF and schema invariants", () => {
  const state = {
    orphanTenantReferences: 0,
    tenants: [{ balance: 7, ledger_sum: 7 }],
    certificates: [{ pdf_header: true, bytes: 2000, issuance_debits: 1 }],
    constraints: [{ validated: true }],
    indexes: [{ valid: true, ready: true }],
  };
  assert.doesNotThrow(() => validateState(state));
  for (const changed of [
    { orphanTenantReferences: 1 },
    { tenants: [{ balance: 9, ledger_sum: 7 }] },
    { certificates: [{ pdf_header: true, bytes: 2000, issuance_debits: 2 }] },
    { certificates: [{ pdf_header: false, bytes: 2000, issuance_debits: 1 }] },
    { constraints: [{ validated: false }] },
    { indexes: [{ valid: true, ready: false }] },
  ])
    assert.throws(
      () => validateState({ ...state, ...changed }),
      /Recovery consistency check/,
    );
});
