import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import {
  validateSource,
  validateInventory,
  encryptArchive,
  decryptArchive,
  artifactPaths,
  archiveDirectory,
  keyDirectory,
  pgEnvironment,
} from "./managed-recovery.mjs";

const sha256 = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
function validPayload() {
  const names = [
    "applications",
    "certificates",
    "citizens",
    "credit_ledger",
    "platform_users",
    "tenant_wallets",
    "tenants",
  ];
  const tables = names.map((name) => ({
    name,
    scope: "global",
    count: 0,
    rows: [],
    sha256: sha256(""),
  }));
  const schema = Buffer.from("PGDMPsynthetic-schema-only");
  return {
    format: 1,
    security: { owner: "fixture_owner", app: "astra_app" },
    schema: { bytes: schema.toString("base64"), sha256: sha256(schema) },
    tables,
    state: {
      tables: tables.map((t) => ({ name: t.name, rows: 0, sha256: t.sha256 })),
      tenants: [],
      certificates: [],
      orphanTenantReferences: 0,
      constraints: [],
      indexes: [],
    },
  };
}

const hosted = () => ({
  mode: "hosted",
  databaseId: "dpg-db6tr43ncjis73ercfsg-a",
  url: new URL(
    "postgresql://fixture_owner:synthetic@dpg-db6tr43ncjis73ercfsg-a.singapore-postgres.render.com/astra_uvug?sslmode=verify-full",
  ),
});
test("managed source pins resource, database and verified TLS; no URL redirection", () => {
  assert.doesNotThrow(() => validateSource(hosted()));
  for (const modify of [
    (c) => (c.databaseId = "other"),
    (c) => (c.url.hostname = "attacker.test"),
    (c) => (c.url.pathname = "/postgres"),
    (c) => (c.url.search = "?sslmode=require"),
    (c) => (c.url.search = "?sslmode=verify-full&host=attacker.test"),
    (c) => (c.url.hash = "#other"),
    (c) => (c.url.username = "astra_app"),
    (c) => (c.url.port = "55432"),
  ]) {
    const c = hosted();
    modify(c);
    assert.throws(() => validateSource(c));
  }
});
test("local managed test source cannot silently select main database or remote host", () => {
  const c = {
    mode: "local-managed",
    url: new URL(
      "postgresql://fixture_owner:synthetic@127.0.0.1:55432/astra_managed_fixture",
    ),
  };
  assert.doesNotThrow(() => validateSource(c));
  for (const value of [
    "postgresql://fixture_owner:x@127.0.0.1:55432/astra",
    "postgresql://fixture_owner:x@remote.test:55432/astra_managed_fixture",
    "postgresql://fixture_owner:x@127.0.0.1:55433/astra_managed_fixture",
  ])
    assert.throws(() => validateSource({ ...c, url: new URL(value) }));
});
test("libpq retains hostname verification and explicit trusted roots while discarding inherited redirects", () => {
  const oldOptions = process.env.PGOPTIONS,
    oldHost = process.env.PGHOST;
  process.env.PGOPTIONS = "-c role=unexpected";
  process.env.PGHOST = "attacker.test";
  try {
    assert.throws(() => pgEnvironment(hosted().url), /trusted CA/);
    const env = pgEnvironment(hosted().url, "/trusted/node-roots.pem");
    assert.equal(env.PGSSLMODE, "verify-full");
    assert.equal(env.PGSSLROOTCERT, "/trusted/node-roots.pem");
    assert.equal(env.PGHOST, hosted().url.hostname);
    assert.equal(env.PGOPTIONS, undefined);
    assert.equal(env.PGDATABASE, "astra_uvug");
  } finally {
    if (oldOptions === undefined) delete process.env.PGOPTIONS;
    else process.env.PGOPTIONS = oldOptions;
    if (oldHost === undefined) delete process.env.PGHOST;
    else process.env.PGHOST = oldHost;
  }
});
const tenantTable = () => ({
  name: "citizens",
  owner: "fixture_owner",
  generated: false,
  scope: "tenant",
  rls: true,
  forced: true,
  tenant_not_null: true,
  tenant_fk: true,
});
const tenantPolicy = () => ({
  tablename: "citizens",
  policyname: "tenant_scope",
  roles: ["public"],
  cmd: "ALL",
  permissive: "PERMISSIVE",
  qual: "(tenant_id = (NULLIF(current_setting('astra.tenant_id'::text, true), ''::text))::uuid)",
  with_check:
    "(tenant_id = (NULLIF(current_setting('astra.tenant_id'::text, true), ''::text))::uuid)",
});
test("tenant export rejects absent FK, nullable scope, unsupported ownership and unknown policies", () => {
  assert.doesNotThrow(() =>
    validateInventory([tenantTable()], [tenantPolicy()], "fixture_owner"),
  );
  for (const patch of [
    { tenant_not_null: false },
    { tenant_fk: false },
    { forced: false },
    { generated: true },
    { owner: "other" },
  ])
    assert.throws(() =>
      validateInventory(
        [{ ...tenantTable(), ...patch }],
        [tenantPolicy()],
        "fixture_owner",
      ),
    );
  for (const patch of [
    { qual: "false" },
    { roles: ["other"] },
    { permissive: "RESTRICTIVE" },
    { cmd: "SELECT" },
  ])
    assert.throws(() =>
      validateInventory(
        [tenantTable()],
        [{ ...tenantPolicy(), ...patch }],
        "fixture_owner",
      ),
    );
  assert.throws(() =>
    validateInventory(
      [tenantTable()],
      [tenantPolicy(), { ...tenantPolicy(), policyname: "unknown" }],
      "fixture_owner",
    ),
  );
});
test("owner-wide selectors are accepted only on bounded existing owner policy tables", () => {
  const table = { ...tenantTable(), name: "certificates" };
  const scope = { ...tenantPolicy(), tablename: "certificates" };
  const extra = {
    tablename: "certificates",
    policyname: "public_definer_owner_read",
    roles: ["fixture_owner"],
    cmd: "SELECT",
    qual: "true",
    with_check: null,
    permissive: "PERMISSIVE",
  };
  assert.doesNotThrow(() =>
    validateInventory([table], [scope, extra], "fixture_owner"),
  );
  assert.throws(() =>
    validateInventory(
      [table],
      [scope, { ...extra, roles: ["astra_app"] }],
      "fixture_owner",
    ),
  );
});
test("account scopes require known tables, validated account FK and exact account policy", () => {
  const table = {
    name: "account_mfa",
    owner: "fixture_owner",
    scope: "account",
    rls: true,
    forced: true,
    account_not_null: true,
    account_fk: true,
  };
  const expression =
    "(user_id = (NULLIF(current_setting('astra.account_id'::text, true), ''::text))::uuid)";
  const rule = {
    tablename: "account_mfa",
    policyname: "account_scope",
    roles: ["public"],
    cmd: "ALL",
    qual: expression,
    with_check: expression,
    permissive: "PERMISSIVE",
  };
  assert.doesNotThrow(() =>
    validateInventory([table], [rule], "fixture_owner"),
  );
  assert.throws(() =>
    validateInventory(
      [{ ...table, account_fk: false }],
      [rule],
      "fixture_owner",
    ),
  );
  assert.throws(() =>
    validateInventory(
      [{ ...table, name: "unreviewed_account" }],
      [{ ...rule, tablename: "unreviewed_account" }],
      "fixture_owner",
    ),
  );
});
test("global nullable tenant columns may export once but never accept hidden RLS", () => {
  const table = {
    name: "sessions",
    owner: "fixture_owner",
    scope: "global",
    rls: false,
    forced: false,
  };
  assert.doesNotThrow(() => validateInventory([table], [], "fixture_owner"));
  assert.throws(() =>
    validateInventory([{ ...table, rls: true }], [], "fixture_owner"),
  );
});
test("archive names cannot escape storage; keys are outside workspace archive location", () => {
  const paths = artifactPaths("managed_20261021090000000_123456ab");
  assert.equal(path.dirname(paths.archivePath), archiveDirectory);
  assert.equal(path.dirname(paths.keyPath), keyDirectory);
  assert(!keyDirectory.startsWith(path.dirname(archiveDirectory)));
  for (const name of [
    "../credentials",
    "managed_20261021090000000_123456ab/other",
    "",
    "C:\\secret",
  ])
    assert.throws(() => artifactPaths(name));
});
test("AES-GCM rejects changed bytes, wrong keys and authenticated malformed archives", () => {
  const key = crypto.randomBytes(32);
  const payload = validPayload();
  const encrypted = encryptArchive(payload, key);
  assert.deepEqual(decryptArchive(encrypted, key), payload);
  assert.throws(
    () => decryptArchive(encryptArchive({ test: "synthetic" }, key), key),
    /authentication or structure/,
  );
  for (const offset of [0, 24, 36, encrypted.length - 1]) {
    const changed = Buffer.from(encrypted);
    changed[offset] ^= 1;
    assert.throws(
      () => decryptArchive(changed, key),
      /authentication or structure/,
    );
  }
  assert.throws(
    () => decryptArchive(encrypted, crypto.randomBytes(32)),
    /authentication or structure/,
  );
});
test("authenticated payload cannot omit tables, corrupt schema, alter counts or duplicate rows", () => {
  const key = crypto.randomBytes(32);
  for (const modify of [
    (data) => data.tables.pop(),
    (data) => data.tables[0].count++,
    (data) => (data.schema.sha256 = "wrong"),
    (data) => data.tables.push(data.tables[0]),
    (data) => (data.state.orphanTenantReferences = 1),
    (data) => {
      data.tables[0].rows = ["{}", "{}"];
      data.tables[0].count = 2;
      data.tables[0].sha256 = sha256(
        [sha256("{}"), sha256("{}")].sort().join(""),
      );
    },
  ]) {
    const data = validPayload();
    modify(data);
    assert.throws(
      () => decryptArchive(encryptArchive(data, key), key),
      /authentication or structure/,
    );
  }
});
