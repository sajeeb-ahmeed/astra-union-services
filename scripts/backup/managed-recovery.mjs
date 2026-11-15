/**
 * Encrypted managed backups. Source modes: `neon` (the live database since 12 Nov 2026), `hosted` (the retired Render
 * database dpg-db6tr43ncjis73ercfsg-a, kept for history) and `local-managed` (test fixtures). See docs/HOSTED_DEPLOYMENT.md.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { rootCertificates } from "node:tls";
import pg from "pg";
import { root, captureState, validateState } from "./backup.mjs";

export const archiveDirectory = path.join(root, ".runtime", "managed-backups");
export const keyDirectory = path.join(os.homedir(), ".astra-recovery", "keys");
const magic = Buffer.from("ASTRA-MANAGED-RECOVERY-1\n");
const sourceId = "dpg-db6tr43ncjis73ercfsg-a";
const sourceHost = `${sourceId}.singapore-postgres.render.com`;
const sourceDatabase = "astra_uvug";
// Neon (live since 12 Nov 2026): any Neon endpoint host, the astra_prod database, and TLS that is verified.
const neonDatabase = "astra_prod";
const isNeonHost = (hostname) => /^[a-z0-9-]+(\.[a-z0-9-]+)*\.neon\.tech$/.test(hostname ?? "");
const isRemote = (url) => url?.hostname === sourceHost || isNeonHost(url?.hostname);
const digest = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const identifier = (value) => {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value))
    throw Error("Unsupported SQL identifier.");
  return `"${value}"`;
};
const binDirectory = () =>
  process.env.PG_BINARY_DIRECTORY ??
  (process.platform === "win32"
    ? path.join(root, ".runtime", "pgsql", "bin")
    : "");
const label = () =>
  `managed_${new Date().toISOString().replace(/\D/g, "")}_${crypto.randomBytes(4).toString("hex")}`;
const cleanEnvironment = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !k.toUpperCase().startsWith("PG"),
    ),
  );

export function validateSource(configuration) {
  const { url, mode, databaseId } = configuration;
  if (
    !(url instanceof URL) ||
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hash ||
    !url.username ||
    !url.password
  )
    throw Error("Invalid recovery source connection.");
  if (mode === "hosted") {
    if (
      databaseId !== sourceId ||
      url.hostname !== sourceHost ||
      !["", "5432"].includes(url.port) ||
      url.pathname !== `/${sourceDatabase}` ||
      url.search !== "?sslmode=verify-full"
    )
      throw Error(
        "Hosted recovery permits only the confirmed Render resource with verified TLS.",
      );
  } else if (mode === "neon") {
    if (
      !isNeonHost(url.hostname) ||
      !["", "5432"].includes(url.port) ||
      url.pathname !== `/${neonDatabase}` ||
      !["require", "verify-full", "verify-ca"].includes(url.searchParams.get("sslmode") ?? "")
    )
      throw Error("Neon backup permits only the astra_prod database on a Neon host with TLS required.");
  } else if (mode === "local-managed") {
    if (
      url.hostname !== "127.0.0.1" ||
      !["55432", "5432"].includes(url.port) ||
      !/^\/astra_managed_[a-z0-9_]+$/.test(url.pathname) ||
      url.search
    )
      throw Error(
        "Local managed fixtures require a dedicated loopback astra_managed_* database.",
      );
  } else throw Error("Explicit recovery source mode required.");
  if (decodeURIComponent(url.username) === "astra_app")
    throw Error("Application credentials cannot export a recovery archive.");
  return configuration;
}

export async function loadSource(mode, filename) {
  if (mode === "neon") {
    // The admin URL stays in a private file outside the repository (never printed).
    const file = filename ?? process.env.ASTRA_NEON_CONFIG;
    if (!file) throw Error("Give the private Neon configuration file (with adminUrl) or set ASTRA_NEON_CONFIG.");
    const text = await fs.readFile(path.resolve(file), "utf8");
    const saved = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    return validateSource({ mode, databaseId: "neon:astra_prod", url: new URL(saved.adminUrl) });
  }
  if (mode === "hosted") {
    const saved = JSON.parse(
      (
        await fs.readFile(
          path.join(root, ".runtime", "hosted", "render-database.json"),
          "utf8",
        )
      ).replace(/^\uFEFF/, ""),
    );
    return validateSource({
      mode,
      databaseId: saved.databaseId,
      url: new URL(saved.externalAdminUrl),
    });
  }
  const actual = path.resolve(filename ?? "");
  if (path.dirname(actual) !== path.join(root, ".runtime"))
    throw Error(
      "Local fixture configuration must be an immediate ignored runtime file.",
    );
  const saved = JSON.parse(await fs.readFile(actual, "utf8"));
  return validateSource({ mode, url: new URL(saved.adminUrl) });
}

async function privateDirectory(directory, parent) {
  await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  await fs.mkdir(directory, { mode: 0o700 }).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });
  const expectedParent = await fs.realpath(parent);
  const anchor =
    directory === archiveDirectory
      ? await fs.realpath(root)
      : await fs.realpath(os.homedir());
  const expectedRelative =
    directory === archiveDirectory ? ".runtime" : ".astra-recovery";
  if (path.relative(anchor, expectedParent) !== expectedRelative)
    throw Error("Recovery storage parent must not traverse a symbolic link.");
  const stat = await fs.lstat(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    path.dirname(await fs.realpath(directory)) !== expectedParent
  )
    throw Error(
      "Recovery storage must be a direct private directory, not a link.",
    );
}

export function artifactPaths(name) {
  if (!/^managed_[0-9]{17}_[a-f0-9]{8}$/.test(name))
    throw Error("Invalid managed archive name.");
  return {
    archivePath: path.join(archiveDirectory, `${name}.aes`),
    keyPath: path.join(keyDirectory, `${name}.key`),
  };
}

async function readRegular(filename) {
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw Error("Recovery artifact must be a regular file.");
  return fs.readFile(filename);
}

export function encryptArchive(payload, key) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(magic);
  const bytes = Buffer.from(JSON.stringify(payload));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([magic, nonce, cipher.getAuthTag(), ciphertext]);
}

export function decryptArchive(bytes, key) {
  try {
    if (
      key.length !== 32 ||
      bytes.length < magic.length + 30 ||
      !bytes.subarray(0, magic.length).equals(magic)
    )
      throw Error();
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      bytes.subarray(magic.length, magic.length + 12),
    );
    decipher.setAAD(magic);
    decipher.setAuthTag(bytes.subarray(magic.length + 12, magic.length + 28));
    const plain = Buffer.concat([
      decipher.update(bytes.subarray(magic.length + 28)),
      decipher.final(),
    ]);
    const data = JSON.parse(plain.toString("utf8"));
    if (
      data.format !== 1 ||
      !Array.isArray(data.tables) ||
      !data.state ||
      !data.security ||
      !data.schema
    )
      throw Error();
    const schema = Buffer.from(data.schema.bytes, "base64");
    if (
      !schema.subarray(0, 5).equals(Buffer.from("PGDMP")) ||
      digest(schema) !== data.schema.sha256
    )
      throw Error();
    validateArchiveData(data);
    return data;
  } catch {
    throw Error(
      "Managed archive authentication or structure validation failed.",
    );
  }
}

function connectionOptions(url) {
  const hosted = isRemote(url);
  const clean = new URL(url);
  clean.search = "";
  return {
    connectionString: clean.toString(),
    connectionTimeoutMillis: 15000,
    ...(hosted
      ? { ssl: { rejectUnauthorized: true, servername: url.hostname } }
      : {}),
  };
}
async function connect(url) {
  const client = new pg.Client(connectionOptions(url));
  await client.connect();
  return client;
}

export function pgEnvironment(url, caPath) {
  const env = cleanEnvironment();
  if (isRemote(url) && !caPath)
    throw Error("Verified hosted tools require an explicit trusted CA bundle.");
  if (url)
    Object.assign(env, {
      PGHOST: url.hostname,
      PGPORT: url.port || "5432",
      PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGCONNECT_TIMEOUT: "15",
      ...(isRemote(url)
        ? { PGSSLMODE: "verify-full", PGSSLROOTCERT: caPath }
        : { PGSSLMODE: "disable" }),
    });
  return env;
}

export async function runTool(name, args, { url, diagnostic, input } = {}) {
  let caPath;
  if (isRemote(url)) {
    caPath = path.join(archiveDirectory, `${label()}.trusted-ca.pem`);
    await fs.writeFile(caPath, rootCertificates.join("\n") + "\n", {
      flag: "wx",
      mode: 0o600,
    });
  }
  const env = pgEnvironment(url, caPath);
  const executable = path.join(
    binDirectory(),
    name + (process.platform === "win32" ? ".exe" : ""),
  );
  const chunks = [];
  let length = 0;
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: root,
      env,
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk) => {
        if (length < 65536) {
          chunks.push(chunk.subarray(0, 65536 - length));
          length += chunk.length;
        }
      });
    child.once("error", () => reject(Error(`${name} could not execute.`)));
    child.once(name === "pg_ctl" ? "exit" : "close", (code) => {
      // On Windows the detached PostgreSQL child can inherit pg_ctl's pipe
      // handles. Read pg_ctl's own exit, then close our handles, not the server.
      if (name === "pg_ctl") {
        child.stdout.destroy();
        child.stderr.destroy();
        child.stdin.destroy();
      }
      code === 0
        ? resolve()
        : reject(Error(`${name} failed; private diagnostics retained.`));
    });
    child.stdin.end(input);
  }).finally(async () => {
    try {
      if (diagnostic && chunks.length)
        await fs.writeFile(diagnostic, Buffer.concat(chunks), {
          flag: "wx",
          mode: 0o600,
        });
    } finally {
      if (caPath) await fs.unlink(caPath);
    }
  });
}

function rowFingerprint(rows) {
  return digest(
    rows
      .map((row) => digest(row))
      .sort()
      .join(""),
  );
}
function parsedTables(tables) {
  return Object.fromEntries(
    tables.map((table) => [
      table.name,
      table.rows.map((row) => JSON.parse(row)),
    ]),
  );
}
function derivedState(tables) {
  const records = parsedTables(tables);
  const tenantIds = new Set(records.tenants.map((t) => t.id));
  const count = (name, tenant) =>
    records[name].filter((row) => row.tenant_id === tenant).length;
  const tenants = records.tenants
    .map((t) => ({
      id: t.id,
      citizens: count("citizens", t.id),
      applications: count("applications", t.id),
      certificates: count("certificates", t.id),
      balance:
        records.tenant_wallets.find((row) => row.tenant_id === t.id)?.balance ??
        null,
      ledger_sum: records.credit_ledger
        .filter((row) => row.tenant_id === t.id)
        .reduce((a, row) => a + row.delta, 0),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const certificates = records.certificates
    .map((c) => {
      if (typeof c.pdf !== "string" || !/^\\x(?:[a-f0-9]{2})*$/.test(c.pdf))
        throw Error("Malformed PDF byte representation.");
      const bytes = Buffer.from(c.pdf.slice(2), "hex");
      return {
        id: c.id,
        tenant_id: c.tenant_id,
        status: c.status,
        bytes: bytes.length,
        pdf_sha256: digest(bytes),
        pdf_header: bytes.subarray(0, 5).equals(Buffer.from("%PDF-")),
        issuance_debits: records.credit_ledger.filter(
          (l) =>
            l.tenant_id === c.tenant_id &&
            l.certificate_id === c.id &&
            l.kind === "ISSUANCE",
        ).length,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  let orphanTenantReferences = 0;
  for (const table of tables)
    for (const row of records[table.name])
      if (row.tenant_id != null && !tenantIds.has(row.tenant_id))
        orphanTenantReferences++;
  return { tenants, certificates, orphanTenantReferences };
}

export function validateArchiveData(data) {
  const names = new Set();
  const tenantIds = new Set(
    data.tables
      .find((t) => t.name === "tenants")
      ?.rows.map((row) => JSON.parse(row).id),
  );
  for (const table of data.tables) {
    identifier(table.name);
    if (
      names.has(table.name) ||
      !Array.isArray(table.rows) ||
      new Set(table.rows).size !== table.rows.length ||
      table.rows.length !== table.count ||
      rowFingerprint(table.rows) !== table.sha256
    )
      throw Error("Incomplete or duplicate table payload.");
    names.add(table.name);
    if (
      table.scope === "tenant" &&
      table.rows.some((row) => !tenantIds.has(JSON.parse(row).tenant_id))
    )
      throw Error("Tenant payload is incomplete.");
    if (table.scope === "account") {
      const users = new Set(
        data.tables
          .find((t) => t.name === "platform_users")
          .rows.map((row) => JSON.parse(row).id),
      );
      if (table.rows.some((row) => !users.has(JSON.parse(row).user_id)))
        throw Error("Account payload is incomplete.");
    }
  }
  if (
    JSON.stringify([...names].sort()) !==
    JSON.stringify(data.state.tables.map((t) => t.name).sort())
  )
    throw Error("Table inventory mismatch.");
  for (const table of data.tables) {
    const expected = data.state.tables.find((t) => t.name === table.name);
    if (expected.rows !== table.count || expected.sha256 !== table.sha256)
      throw Error("Table state mismatch.");
  }
  const derived = derivedState(data.tables);
  for (const name of ["tenants", "certificates", "orphanTenantReferences"])
    if (JSON.stringify(derived[name]) !== JSON.stringify(data.state[name]))
      throw Error("Domain state mismatch.");
  validateState(data.state);
}

async function inventory(client, owner) {
  const schemas = (
    await client.query(
      "SELECT nspname FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname NOT IN ('public','information_schema')",
    )
  ).rows;
  if (schemas.length)
    throw Error("Unsupported user schema; export refuses omissions.");
  if (
    (await client.query("SELECT 1 FROM pg_largeobject_metadata LIMIT 1"))
      .rowCount
  )
    throw Error("Large objects need a dedicated backup contract.");
  if (
    (
      await client.query(
        "SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind NOT IN ('r','i') LIMIT 1",
      )
    ).rowCount
  )
    throw Error(
      "Partition, sequence, view or foreign object needs a dedicated backup contract.",
    );
  const tables = (
    await client.query(`SELECT c.relname name,c.relrowsecurity rls,c.relforcerowsecurity forced,pg_get_userbyid(c.relowner) owner,
    EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.attnum>0 AND NOT a.attisdropped) tenant_column,
    EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.attnotnull) tenant_not_null,
    EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='user_id' AND a.attnotnull) account_not_null,
    EXISTS(SELECT 1 FROM pg_constraint f JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='user_id' WHERE f.conrelid=c.oid AND f.contype='f' AND f.confrelid='public.platform_users'::regclass AND f.convalidated AND f.conkey=ARRAY[a.attnum]::smallint[]) account_fk,
    EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND (a.attidentity<>'' OR a.attgenerated<>'')) generated
    FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' ORDER BY c.relname`)
  ).rows;
  const paths = (
    await client.query(`WITH RECURSIVE edges AS (
    SELECT f.conrelid source,f.confrelid target,src.attname source_column,dst.attname target_column
    FROM pg_constraint f CROSS JOIN LATERAL unnest(f.conkey,f.confkey) k(source_key,target_key)
    JOIN pg_attribute src ON src.attrelid=f.conrelid AND src.attnum=k.source_key
    JOIN pg_attribute dst ON dst.attrelid=f.confrelid AND dst.attnum=k.target_key
    WHERE f.contype='f' AND f.convalidated
  ), reachable AS (
    SELECT 'public.tenants'::regclass::oid relation,'id'::name column_name
    UNION SELECT e.source,e.source_column FROM edges e JOIN reachable r ON e.target=r.relation AND e.target_column=r.column_name WHERE e.source_column='tenant_id'
  ) SELECT c.relname name FROM reachable r JOIN pg_class c ON c.oid=r.relation WHERE r.column_name='tenant_id'`)
  ).rows;
  for (const table of tables) {
    table.tenant_fk = paths.some((p) => p.name === table.name);
    table.scope = !table.rls
      ? "global"
      : table.tenant_column
        ? "tenant"
        : "account";
  }
  const policies = (
    await client.query(
      "SELECT tablename,policyname,roles::text[] roles,cmd,qual,with_check,permissive FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname",
    )
  ).rows;
  validateInventory(tables, policies, owner);
  return tables;
}

export function validateInventory(tables, policies, owner) {
  const tenantExpression = (value) =>
    typeof value === "string" &&
    value.replace(/\s/g, "") ===
      "(tenant_id=(NULLIF(current_setting('astra.tenant_id'::text,true),''::text))::uuid)";
  const ownerTables = new Map([
    [
      "public_definer_owner_read",
      new Set([
        "certificates",
        "applications",
        "notices",
        "password_recovery_tokens",
      ]),
    ],
    ["callback_owner_read", new Set(["gateway_payment_intents"])],
    // Migrations 029/030: the points ledger trigger and the owner recharge queue run as the owner.
    ["definer_ledger_read", new Set(["point_ledger"])],
    ["definer_queue_read", new Set(["recharge_requests"])],
    ["definer_wallet_maintenance", new Set(["point_wallets"])],
  ]);
  // The wallet trigger also writes balances, so its owner policy covers all commands.
  const ownerWritePolicies = new Set(["definer_wallet_maintenance"]);
  for (const table of tables) {
    if (table.owner !== owner || table.generated)
      throw Error("Unsupported table ownership or generated column.");
    const rules = policies.filter((p) => p.tablename === table.name);
    if (table.scope === "global") {
      if (table.rls || table.forced || rules.length)
        throw Error("Unscoped RLS table requires a specific export contract.");
      continue;
    }
    if (table.scope === "account") {
      const expression =
        "(user_id=(NULLIF(current_setting('astra.account_id'::text,true),''::text))::uuid)";
      if (
        !["account_mfa", "account_security_events"].includes(table.name) ||
        !table.rls ||
        !table.forced ||
        !table.account_not_null ||
        !table.account_fk ||
        rules.length !== 1 ||
        rules[0].policyname !== "account_scope" ||
        rules[0].cmd !== "ALL" ||
        JSON.stringify(rules[0].roles) !== '["public"]' ||
        rules[0].permissive !== "PERMISSIVE" ||
        rules[0].qual?.replace(/\s/g, "") !== expression ||
        rules[0].with_check?.replace(/\s/g, "") !== expression
      )
        throw Error("Unknown account policy; export fails closed.");
      continue;
    }
    if (
      !table.rls ||
      !table.forced ||
      !table.tenant_not_null ||
      !table.tenant_fk
    )
      throw Error(`Tenant table completeness cannot be proved: ${table.name}.`);
    const tenant = rules.filter((p) => p.policyname === "tenant_scope");
    if (
      tenant.length !== 1 ||
      tenant[0].cmd !== "ALL" ||
      JSON.stringify(tenant[0].roles) !== '["public"]' ||
      tenant[0].permissive !== "PERMISSIVE" ||
      !tenantExpression(tenant[0].qual) ||
      !tenantExpression(tenant[0].with_check)
    )
      throw Error("Unknown tenant policy; export fails closed.");
    for (const rule of rules.filter((p) => p.policyname !== "tenant_scope"))
      if (
        !ownerTables.get(rule.policyname)?.has(table.name) ||
        rule.cmd !== (ownerWritePolicies.has(rule.policyname) ? "ALL" : "SELECT") ||
        rule.qual !== "true" ||
        rule.with_check !== (ownerWritePolicies.has(rule.policyname) ? "true" : null) ||
        rule.permissive !== "PERMISSIVE" ||
        JSON.stringify(rule.roles) !== JSON.stringify([owner])
      )
        throw Error("Unknown additional tenant policy.");
  }
}

/**
 * `allowOwnerBypass` is set only for Neon: roles made in the Neon console get BYPASSRLS from the platform and no
 * user role can remove it. The application role must still have no bypass, and the archive records the fact.
 */
async function captureSecurity(client, owner, { allowOwnerBypass = false } = {}) {
  const roles = (
    await client.query(
      "SELECT rolname name,rolsuper superuser,rolbypassrls bypass,rolcreatedb createdb,rolcreaterole createrole,rolreplication replication FROM pg_roles WHERE rolname=ANY($1::text[]) ORDER BY rolname",
      [[owner, "astra_app"]],
    )
  ).rows;
  if (
    roles.length !== 2 ||
    roles.some((r) => r.superuser || r.replication || (r.bypass && !(allowOwnerBypass && r.name === owner))) ||
    roles.find((r) => r.name === "astra_app").createrole ||
    roles.find((r) => r.name === "astra_app").createdb
  )
    throw Error("Source roles do not meet the managed privilege contract.");
  if (
    (
      await client.query("SELECT pg_has_role('astra_app',$1,'MEMBER') member", [
        owner,
      ])
    ).rows[0].member
  )
    throw Error("Application must not inherit the owner.");
  const memberships = (
    await client.query(
      "SELECT r.rolname role,m.rolname member,a.admin_option FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles m ON m.oid=a.member WHERE r.rolname=ANY($1::text[]) OR m.rolname=ANY($1::text[]) ORDER BY role,member",
      [[owner, "astra_app"]],
    )
  ).rows;
  // The migration owner may be a provider-managed group member. No memberships
  // are recreated in the recovery cluster; the original metadata remains encrypted.
  const owners = (
    await client.query(
      "SELECT 'relation' kind,c.relname name,pg_get_userbyid(c.relowner) owner FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' UNION ALL SELECT 'routine',p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',pg_get_userbyid(p.proowner) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind IN ('f','p') AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e') ORDER BY kind,name",
    )
  ).rows;
  if (owners.some((o) => o.owner !== owner))
    throw Error(
      "Multiple application object owners need explicit recovery policy.",
    );
  return {
    owner,
    app: "astra_app",
    ownerBypassRls: roles.find((r) => r.name === owner).bypass,
    roles,
    memberships,
    owners,
    restoredRolePolicy:
      "NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION; no source passwords or memberships",
  };
}

export async function createManagedBackup(configuration) {
  validateSource(configuration);
  await privateDirectory(archiveDirectory, path.join(root, ".runtime"));
  await privateDirectory(
    keyDirectory,
    path.join(os.homedir(), ".astra-recovery"),
  );
  const name = label();
  const paths = artifactPaths(name);
  const schemaPath = path.join(
    archiveDirectory,
    `${name}.schema.plaintext.dump`,
  );
  const client = await connect(configuration.url);
  let began = false;
  let ownsSchema = false;
  try {
    const owner = (await client.query("SELECT current_user name")).rows[0].name;
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    began = true;
    await client.query("SET LOCAL search_path=public,pg_catalog");
    await client.query("SET TIME ZONE 'UTC'");
    await client.query("SET datestyle='ISO, YMD'");
    const snapshot = (await client.query("SELECT pg_export_snapshot() id"))
      .rows[0].id;
    const startedAt = new Date().toISOString();
    const serverVersion = (
      await client.query("SELECT current_setting('server_version_num') version")
    ).rows[0].version;
    const databaseLocale = (
      await client.query(
        "SELECT datcollate,datctype,pg_encoding_to_char(encoding) encoding FROM pg_database WHERE datname=current_database()",
      )
    ).rows[0];
    if (!/^17\d{4}$/.test(serverVersion))
      throw Error("Managed recovery requires PostgreSQL 17.");
    const security = await captureSecurity(client, owner, { allowOwnerBypass: configuration.mode === "neon" });
    const catalog = await inventory(client, owner);
    const tenantIds = (
      await client.query("SELECT id FROM tenants ORDER BY id")
    ).rows.map((t) => t.id);
    const accountIds = (
      await client.query("SELECT id FROM platform_users ORDER BY id")
    ).rows.map((t) => t.id);
    const tables = [];
    for (const table of catalog) {
      const rows = [];
      if (table.scope !== "global") {
        const column = table.scope === "tenant" ? "tenant_id" : "user_id";
        for (const scopeId of table.scope === "tenant"
          ? tenantIds
          : accountIds) {
          await client.query("SELECT set_config($1,$2,true)", [
            table.scope === "tenant" ? "astra.tenant_id" : "astra.account_id",
            scopeId,
          ]);
          const part = (
            await client.query(
              `SELECT to_jsonb(t)::text row FROM public.${identifier(table.name)} t WHERE ${column}=$1`,
              [scopeId],
            )
          ).rows.map((r) => r.row);
          if (part.some((row) => JSON.parse(row)[column] !== scopeId))
            throw Error("Unexpected cross-scope export row.");
          rows.push(...part);
        }
      } else
        rows.push(
          ...(
            await client.query(
              `SELECT to_jsonb(t)::text row FROM public.${identifier(table.name)} t`,
            )
          ).rows.map((r) => r.row),
        );
      tables.push({
        name: table.name,
        scope: table.scope,
        count: rows.length,
        sha256: rowFingerprint(rows),
        rows,
      });
    }
    const derived = derivedState(tables);
    // Reuse the comprehensive catalog/security checker; substitute complete logical
    // data results because a managed owner deliberately cannot bypass tenant RLS.
    const proxy = {
      query: async (sql, args) => {
        const match = sql.match(/AS row_digest FROM public\."([a-z0-9_]+)" t/);
        if (match) {
          const t = tables.find((t) => t.name === match[1]);
          return { rows: [{ rows: t.count, sha256: t.sha256 }] };
        }
        if (sql.startsWith("SELECT t.id, (SELECT count"))
          return { rows: derived.tenants };
        if (sql.startsWith("SELECT c.id,c.tenant_id,c.status,octet_length"))
          return { rows: derived.certificates };
        if (sql.includes("AS invalid FROM public."))
          return { rows: [{ invalid: 0 }] };
        return client.query(sql, args);
      },
    };
    const state = await captureState(proxy);
    state.orphanTenantReferences = derived.orphanTenantReferences;
    validateState(state);
    const handle = await fs.open(schemaPath, "wx", 0o600);
    ownsSchema = true;
    await handle.close();
    await runTool(
      "pg_dump",
      [
        "--schema-only",
        "--format=custom",
        `--snapshot=${snapshot}`,
        `--file=${schemaPath}`,
      ],
      {
        url: configuration.url,
        diagnostic: path.join(archiveDirectory, `${name}.dump.log`),
      },
    );
    const schemaBytes = await fs.readFile(schemaPath);
    const archive = {
      format: 1,
      startedAt,
      source: {
        mode: configuration.mode,
        databaseId:
          configuration.mode === "hosted"
            ? sourceId
            : configuration.mode === "neon"
              ? "neon:astra_prod"
              : "LOCAL_MANAGED_FIXTURE",
        serverVersion,
        databaseLocale,
      },
      security,
      tables,
      state,
      schema: {
        sha256: digest(schemaBytes),
        bytes: schemaBytes.toString("base64"),
      },
    };
    validateArchiveData(archive);
    await client.query("COMMIT");
    began = false;
    const key = crypto.randomBytes(32);
    const encrypted = encryptArchive(archive, key);
    await fs.writeFile(paths.keyPath, key, { flag: "wx", mode: 0o600 });
    await fs.writeFile(paths.archivePath, encrypted, {
      flag: "wx",
      mode: 0o600,
    });
    return {
      name,
      ...paths,
      archive,
      evidence: {
        status: "PASS",
        exportedAt: new Date().toISOString(),
        source: archive.source,
        name,
        tables: tables.length,
        tenants: tenantIds.length,
        certificates: state.certificates.length,
        encryptedBytes: encrypted.length,
        archiveSha256: digest(encrypted),
        sourceReadOnly: true,
        rlsPoliciesChanged: false,
        keyOutsideWorkspace: true,
        independentKeyCustody: false,
        offsiteReplication: false,
      },
    };
  } finally {
    if (began) await client.query("ROLLBACK").catch(() => {});
    await client.end();
    if (ownsSchema) await fs.unlink(schemaPath);
  }
}

export async function readManagedArchive(name) {
  const { archivePath, keyPath } = artifactPaths(name);
  return decryptArchive(
    await readRegular(archivePath),
    await readRegular(keyPath),
  );
}

/** Provider default ACLs may name postgres even when the application's owner is
 * a separate non-superuser. Preserve the catalog identity without reproducing
 * provider privileges, logins, passwords or memberships. Unknown roles fail shut.
 */
export function auxiliaryRecoveryRoles(archive) {
  const primary = new Set([
    archive.security.owner,
    archive.security.app,
    "PUBLIC",
    "pg_database_owner",
  ]);
  const referenced = new Set();
  for (const key of [
    "tableGrants",
    "functionGrants",
    "columnGrants",
    "schemaGrants",
    "defaultGrants",
  ])
    for (const grant of archive.state[key] ?? [])
      for (const role of [grant.owner, grant.grantee])
        if (role && !primary.has(role)) referenced.add(role);
  if ([...referenced].some((role) => role !== "postgres"))
    throw Error(
      "Unknown auxiliary catalog role requires a reviewed recovery policy.",
    );
  return [...referenced].sort();
}

// PostgreSQL ORDER BY text uses the source database collation. Catalog arrays are
// sets of complete rows, so compare a deterministic multiset ordering across
// hosts while retaining duplicates and every value (including positions/flags).
export function canonicalRecoveryState(state) {
  const unordered = new Set([
    "tables",
    "tenants",
    "certificates",
    "constraints",
    "policies",
    "rowSecurity",
    "triggers",
    "functionDefinitions",
    "tableGrants",
    "functionGrants",
    "columns",
    "columnGrants",
    "indexes",
    "extensions",
    "views",
    "enums",
    "schemaGrants",
    "defaultGrants",
    "sequences",
    "objectOwners",
  ]);
  const stableKeys = (value) =>
    Array.isArray(value)
      ? value.map(stableKeys)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, stableKeys(value[key])]),
          )
        : value;
  return Object.fromEntries(
    Object.keys(state)
      .sort()
      .map((key) => {
        const value = stableKeys(state[key]);
        if (unordered.has(key) && Array.isArray(value))
          value.sort((a, b) => {
            const left = JSON.stringify(a),
              right = JSON.stringify(b);
            return left < right ? -1 : left > right ? 1 : 0;
          });
        return [key, value];
      }),
  );
}

async function verifyAuxiliaryRoles(client, roles) {
  for (const role of roles) {
    const attributes = (
      await client.query(
        "SELECT rolcanlogin,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication,rolinherit FROM pg_roles WHERE rolname=$1",
        [role],
      )
    ).rows[0];
    assert.deepEqual(attributes, {
      rolcanlogin: false,
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
      rolinherit: false,
    });
    assert.equal(
      (
        await client.query(
          "SELECT count(*)::int n FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid OR r.oid=a.member WHERE r.rolname=$1",
          [role],
        )
      ).rows[0].n,
      0,
    );
  }
}

export async function restoreManagedArchive(name, recoveryUrl) {
  if (
    !(recoveryUrl instanceof URL) ||
    recoveryUrl.hostname !== "127.0.0.1" ||
    recoveryUrl.port !== "55433" ||
    recoveryUrl.pathname !== "/postgres" ||
    recoveryUrl.search ||
    recoveryUrl.hash
  )
    throw Error(
      "Independent restore permits only its separate loopback cluster on port 55433.",
    );
  const archive = await readManagedArchive(name); // Authenticate before any DB writes.
  const auxiliaryRoles = auxiliaryRecoveryRoles(archive);
  const control = await connect(recoveryUrl);
  const target = `astra_recovered_${crypto.randomBytes(8).toString("hex")}`;
  const restoreUrl = new URL(recoveryUrl);
  restoreUrl.pathname = `/${target}`;
  const schemaPath = path.join(
    archiveDirectory,
    `${name}.${target}.schema.plaintext.dump`,
  );
  let ownsSchema = false;
  try {
    const existing = (
      await control.query(
        "SELECT datname FROM pg_database WHERE datname NOT IN ('postgres','template0','template1')",
      )
    ).rows;
    if (existing.length)
      throw Error(
        "Recovery requires a fresh independent cluster; existing databases are preserved.",
      );
    for (const role of [
      archive.security.owner,
      archive.security.app,
      ...auxiliaryRoles,
    ]) {
      identifier(role);
      if (
        (await control.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role]))
          .rowCount
      )
        throw Error(
          "Recovery source role already exists; attributes will not be overwritten.",
        );
    }
    const roleCredentials = {};
    for (const role of [archive.security.owner, archive.security.app]) {
      const password = crypto.randomBytes(32).toString("hex");
      roleCredentials[role] = password;
      const sql = (
        await control.query(
          "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L',$1::text,$2::text) sql",
          [role, password],
        )
      ).rows[0].sql;
      await control.query(sql);
    }
    for (const role of auxiliaryRoles)
      await control.query(
        `CREATE ROLE ${identifier(role)} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT`,
      );
    await verifyAuxiliaryRoles(control, auxiliaryRoles);
    await control.query(
      `CREATE DATABASE ${identifier(target)} OWNER ${identifier(archive.security.owner)} TEMPLATE template0 ENCODING 'UTF8'`,
    );
    await fs.writeFile(
      schemaPath,
      Buffer.from(archive.schema.bytes, "base64"),
      { flag: "wx", mode: 0o600 },
    );
    ownsSchema = true;
    await runTool(
      "pg_restore",
      [
        "--exit-on-error",
        "--section=pre-data",
        `--dbname=${target}`,
        schemaPath,
      ],
      {
        url: restoreUrl,
        diagnostic: path.join(archiveDirectory, `${name}.${target}.pre.log`),
      },
    );
    const restored = await connect(restoreUrl);
    try {
      await restored.query("BEGIN");
      // The fresh recovery superuser loads actual rows before post-data triggers and
      // RLS. No source settings or privileges are changed; ledger effects never replay.
      for (const table of archive.tables)
        for (let offset = 0; offset < table.rows.length; offset += 100) {
          const json =
            "[" + table.rows.slice(offset, offset + 100).join(",") + "]";
          await restored.query(
            `INSERT INTO public.${identifier(table.name)} SELECT * FROM jsonb_populate_recordset(NULL::public.${identifier(table.name)},$1::jsonb)`,
            [json],
          );
        }
      await restored.query("COMMIT");
      await runTool(
        "pg_restore",
        [
          "--exit-on-error",
          "--section=post-data",
          `--dbname=${target}`,
          schemaPath,
        ],
        {
          url: restoreUrl,
          diagnostic: path.join(archiveDirectory, `${name}.${target}.post.log`),
        },
      );
      await restored.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await restored.query("SET LOCAL search_path=public,pg_catalog");
      const state = await captureState(restored);
      validateState(state);
      assert.deepEqual(
        canonicalRecoveryState(state),
        canonicalRecoveryState(archive.state),
        "Independent restore data/schema/security fingerprints differ.",
      );
      const owners = (await captureSecurity(restored, archive.security.owner))
        .owners;
      assert.deepEqual(
        canonicalRecoveryState({ objectOwners: owners }),
        canonicalRecoveryState({ objectOwners: archive.security.owners }),
        "SECURITY DEFINER/object ownership changed.",
      );
      await verifyAuxiliaryRoles(restored, auxiliaryRoles);
      const restoredDatabaseLocale = (
        await restored.query(
          "SELECT datcollate,datctype,pg_encoding_to_char(encoding) encoding FROM pg_database WHERE datname=current_database()",
        )
      ).rows[0];
      await restored.query("COMMIT");
      const appUrl = new URL(restoreUrl);
      appUrl.username = archive.security.app;
      appUrl.password = roleCredentials[archive.security.app];
      const checks = await verifyRecoveredRuntime(appUrl, archive);
      const settings = {
        database: target,
        adminUrl: restoreUrl.toString(),
        appUrl: appUrl.toString(),
        ownerRole: archive.security.owner,
        ownerPassword: roleCredentials[archive.security.owner],
        sourceArchive: name,
        paymentCollection: "DISABLED",
      };
      await fs.writeFile(
        path.join(archiveDirectory, `${name}.recovered.json`),
        JSON.stringify(settings),
        { flag: "wx", mode: 0o600 },
      );
      return {
        status: "PASS",
        restoredAt: new Date().toISOString(),
        name,
        target,
        independentClusterPort: 55433,
        tables: state.tables.length,
        tenants: state.tenants.length,
        certificates: state.certificates.length,
        exactStateMatch: true,
        ownershipPreserved: true,
        sourceDatabaseLocale:
          archive.source.databaseLocale ?? "NOT_CAPTURED_IN_THIS_ARCHIVE",
        restoredDatabaseLocale,
        databaseLocaleMatchesSource: archive.source.databaseLocale
          ? JSON.stringify(archive.source.databaseLocale) ===
            JSON.stringify(restoredDatabaseLocale)
          : null,
        catalogComparison:
          "Exact complete values; only reviewed unordered top-level collections sorted; duplicates and nested array order retained",
        cutoverReady: false,
        sourceCredentialsReused: false,
        sourceMembershipsRecreated: false,
        auxiliaryCatalogRoles: auxiliaryRoles.length,
        auxiliaryRolesRestrictedNoLogin: true,
        checks,
        independentKeyCustody: false,
        offsiteReplication: false,
      };
    } finally {
      await restored.end();
    }
  } finally {
    await control.end();
    if (ownsSchema) await fs.unlink(schemaPath);
  }
}

async function verifyRecoveredRuntime(appUrl, archive) {
  const app = await connect(appUrl);
  const checks = [];
  try {
    const role = (
      await app.query(
        "SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user",
      )
    ).rows[0];
    assert.deepEqual(role, {
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
    });
    checks.push("Restricted recovered application role.");
    for (const table of archive.tables.filter((t) => t.scope !== "global"))
      assert.equal(
        (
          await app.query(
            `SELECT count(*)::int n FROM public.${identifier(table.name)}`,
          )
        ).rows[0].n,
        0,
      );
    checks.push("All tenant/account tables deny unscoped runtime reads.");
    const accountTables = archive.tables.filter((t) => t.scope === "account");
    const accounts = parsedTables(archive.tables).platform_users;
    if (accountTables.length && accounts.length >= 2) {
      for (const account of accounts.slice(0, 2)) {
        await app.query("BEGIN");
        await app.query("SELECT set_config('astra.account_id',$1,true)", [
          account.id,
        ]);
        for (const table of accountTables) {
          const expected = table.rows.filter(
            (row) => JSON.parse(row).user_id === account.id,
          ).length;
          assert.equal(
            (
              await app.query(
                `SELECT count(*)::int n FROM public.${identifier(table.name)}`,
              )
            ).rows[0].n,
            expected,
          );
          assert.equal(
            (
              await app.query(
                `SELECT count(*)::int n FROM public.${identifier(table.name)} WHERE user_id<>$1`,
                [account.id],
              )
            ).rows[0].n,
            0,
          );
        }
        await app.query("ROLLBACK");
      }
      checks.push(
        "MFA and durable account audit obey account isolation with restored account context.",
      );
    }
    const tenants = archive.state.tenants.filter((t) => t.citizens > 0);
    if (tenants.length < 2)
      throw Error("Recovery acceptance needs two populated tenants.");
    await app.query("BEGIN");
    await app.query("SELECT set_config('astra.tenant_id',$1,true)", [
      tenants[0].id,
    ]);
    assert.equal(
      (await app.query("SELECT count(*)::int n FROM citizens")).rows[0].n,
      tenants[0].citizens,
    );
    assert.equal(
      (
        await app.query(
          "SELECT count(*)::int n FROM citizens WHERE tenant_id=$1",
          [tenants[1].id],
        )
      ).rows[0].n,
      0,
    );
    await app.query("ROLLBACK");
    checks.push("Tenant A reads its rows and cannot read tenant B.");
    const grants = (
      await app.query(
        "SELECT has_table_privilege(current_user,'tenant_wallets','UPDATE') wallet,has_column_privilege(current_user,'gateway_payment_intents','amount_minor','UPDATE') amount,has_table_privilege(current_user,'gateway_payment_receipts','UPDATE') receipt",
      )
    ).rows[0];
    assert.deepEqual(grants, { wallet: false, amount: false, receipt: false });
    checks.push(
      "Wallet, payment amount and receipt modification privileges remain denied.",
    );
    await app.query("BEGIN");
    await app.query("SELECT set_config('astra.tenant_id',$1,true)", [
      tenants[0].id,
    ]);
    await assert.rejects(
      app.query("UPDATE credit_ledger SET reason=reason WHERE tenant_id=$1", [
        tenants[0].id,
      ]),
      /Append-only record/,
    );
    await app.query("ROLLBACK");
    checks.push("Ledger trigger rejects modification.");
    const certificates = parsedTables(archive.tables).certificates;
    if (!certificates.length)
      throw Error("Recovery acceptance requires an actual certificate.");
    for (const cert of certificates)
      assert.equal(
        (await app.query("SELECT * FROM public_verify($1)", [cert.token_hash]))
          .rowCount,
        1,
      );
    assert.equal(
      (await app.query("SELECT * FROM public_verify('invalid-recovery-token')"))
        .rowCount,
      0,
    );
    checks.push(
      "Every existing certificate resolves through bounded QR verification; invalid token is hidden.",
    );
    assert.equal(
      (
        await app.query(
          "SELECT * FROM resolve_gateway_callback('invalid-recovery-callback')",
        )
      ).rowCount,
      0,
    );
    checks.push("Invalid gateway callback resolves no record.");
    return checks;
  } finally {
    await app.end();
  }
}

async function main() {
  const [mode, argument] = process.argv.slice(2);
  await fs.mkdir(path.join(root, "execution"), { recursive: true });
  if (mode === "backup") {
    const source =
      argument === "--hosted"
        ? await loadSource("hosted")
        : argument === "--neon"
          ? await loadSource("neon", process.argv[4])
          : await loadSource("local-managed", argument);
    const result = await createManagedBackup(source);
    await fs.writeFile(
      path.join(root, "execution", `managed-${source.mode}-backup.json`),
      JSON.stringify(result.evidence, null, 2) + "\n",
    );
    console.log(
      `Managed encrypted backup PASS: ${result.name}; ${result.evidence.tables} tables, ${result.evidence.tenants} tenants, ${result.evidence.certificates} PDFs. Key values omitted.`,
    );
  } else if (mode === "restore") {
    const saved = JSON.parse(
      await fs.readFile(
        path.join(root, ".runtime", "managed-recovery-cluster.json"),
        "utf8",
      ),
    );
    const evidence = await restoreManagedArchive(
      argument,
      new URL(saved.adminUrl),
    );
    await fs.writeFile(
      path.join(root, "execution", "managed-independent-restore.json"),
      JSON.stringify(evidence, null, 2) + "\n",
    );
    console.log(
      `Independent restore PASS: ${evidence.tables} tables, ${evidence.tenants} tenants, ${evidence.certificates} PDFs; ${evidence.checks.length} runtime checks.`,
    );
  } else
    throw Error(
      "Usage: managed-recovery.mjs backup --hosted | backup .runtime/managed-fixture.json | restore <archive name>",
    );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch(async (error) => {
    await fs
      .writeFile(
        path.join(root, ".runtime", "managed-recovery-error.log"),
        String(error.stack ?? error),
        { mode: 0o600 },
      )
      .catch(() => {});
    console.error(
      `Managed recovery failed (${error.code ?? error.name ?? "error"}); private .runtime/managed-recovery-error.log retained; no successful recovery is claimed.`,
    );
    process.exitCode = 1;
  });
