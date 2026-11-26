import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";

export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const backupDirectory = path.join(root, ".runtime", "backups");
const MAGIC = Buffer.from("ASTRA-ENC-PGDUMP-1\n", "ascii");
const sha256 = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const targetPattern = /^astra_restore_[a-z0-9_]{1,48}$/;
const quoteIdentifier = (name) => {
  if (!/^[a-z][a-z0-9_]*$/.test(name))
    throw new Error("Unsafe PostgreSQL identifier rejected.");
  return `"${name}"`;
};

export function requireWorkspaceBackupPath(value) {
  const candidate = path.resolve(value);
  const normalize = (name) =>
    process.platform === "win32" ? name.toLowerCase() : name;
  if (normalize(path.dirname(candidate)) !== normalize(backupDirectory))
    throw new Error(
      "Backup artifact path must remain inside workspace .runtime/backups.",
    );
  return candidate;
}

async function validateBackupStorage() {
  await fs.mkdir(path.dirname(backupDirectory), {
    recursive: true,
    mode: 0o700,
  });
  const [actualRoot, actualRuntime] = await Promise.all([
    fs.realpath(root),
    fs.realpath(path.dirname(backupDirectory)),
  ]);
  if (path.relative(actualRoot, actualRuntime) !== ".runtime")
    throw new Error(
      "Backup runtime storage must not traverse a symbolic link outside its workspace location.",
    );
  await fs.mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  const actualDirectory = await fs.realpath(backupDirectory);
  if (
    path.relative(actualRoot, actualDirectory) !==
    path.join(".runtime", "backups")
  )
    throw new Error(
      "Backup storage must not traverse a symbolic link outside its workspace location.",
    );
}

async function readBackupArtifact(value) {
  const filename = requireWorkspaceBackupPath(value);
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error(
      "Backup artifacts must be regular files, not symbolic links.",
    );
  return fs.readFile(filename);
}

async function removePlaintext(value) {
  // Remove only this individual, validated workspace file. No recursive deletion.
  await fs.rm(requireWorkspaceBackupPath(value), { force: true });
}

export async function loadConfiguration() {
  const local =
    process.env.DATABASE_ADMIN_URL && process.env.DATABASE_URL
      ? {}
      : JSON.parse(
          (
            await fs.readFile(
              path.join(root, ".runtime", "postgres.json"),
              "utf8",
            )
          ).replace(/^\uFEFF/, ""),
        );
  const admin = new URL(process.env.DATABASE_ADMIN_URL ?? local.adminUrl);
  const app = new URL(process.env.DATABASE_URL ?? local.appUrl);
  const bin =
    process.env.PG_BINARY_DIRECTORY ??
    (process.platform === "win32"
      ? path.join(root, ".runtime", "pgsql", "bin")
      : "");
  return validateConfiguration({ admin, app, bin });
}

export function validateConfiguration(configuration) {
  const { admin, app, bin } = configuration;
  if (
    !["postgres:", "postgresql:"].includes(admin.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(admin.hostname) ||
    !["55432", "5432"].includes(admin.port) ||
    decodeURIComponent(admin.pathname) !== "/astra" ||
    admin.search ||
    admin.hash
  ) {
    throw new Error(
      "Recovery scripts permit only the known loopback astra database on port 55432 or 5432.",
    );
  }
  if (
    !["postgres:", "postgresql:"].includes(app.protocol) ||
    app.search ||
    app.hash ||
    app.hostname !== admin.hostname ||
    app.port !== admin.port ||
    decodeURIComponent(app.pathname) !== "/astra" ||
    app.username === admin.username
  )
    throw new Error("Local application/database connection contract mismatch.");
  return { admin, app, bin };
}

function environmentFor(url) {
  return {
    // Libpq service/host/options variables must not redirect the validated URL.
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.toUpperCase().startsWith("PG"),
      ),
    ),
    PGHOST: url.hostname === "[::1]" ? "::1" : url.hostname,
    PGPORT: url.port,
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGCONNECT_TIMEOUT: "10",
  };
}

async function runPgTool(configuration, name, args, url, label) {
  const executable = path.join(
    configuration.bin,
    process.platform === "win32" ? `${name}.exe` : name,
  );
  const errors = [];
  await new Promise((resolve, reject) => {
    const processHandle = spawn(executable, args, {
      cwd: root,
      env: environmentFor(url),
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
    });
    processHandle.stderr.on("data", (bytes) => errors.push(bytes));
    processHandle.once("error", (error) =>
      reject(
        new Error(`${name} could not execute (${error.code ?? "unknown"}).`),
      ),
    );
    processHandle.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `${name} failed (exit ${code}); diagnostics remain in ignored runtime storage.`,
            ),
          ),
    );
  }).finally(async () => {
    if (errors.length)
      await fs.writeFile(
        requireWorkspaceBackupPath(
          path.join(backupDirectory, `${label}.stderr.log`),
        ),
        Buffer.concat(errors),
        { mode: 0o600 },
      );
  });
}

export async function openDatabase(url) {
  const client = new pg.Client({
    connectionString: url.toString(),
    connectionTimeoutMillis: 10000,
  });
  await client.connect();
  return client;
}

export async function captureState(client) {
  await client.query("SET TIME ZONE 'UTC'");
  await client.query("SET datestyle = 'ISO, YMD'");
  const names = (
    await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    )
  ).rows.map((row) => row.tablename);
  const tables = [];
  for (const name of names) {
    const result = await client.query(
      `SELECT count(*)::integer AS rows, encode(digest(coalesce(string_agg(row_digest,'' ORDER BY row_digest),''),'sha256'),'hex') AS sha256 FROM (SELECT encode(digest(to_jsonb(t)::text,'sha256'),'hex') AS row_digest FROM public.${quoteIdentifier(name)} t) hashes`,
    );
    tables.push({ name, ...result.rows[0] });
  }
  const tenants = (
    await client.query(
      `SELECT t.id, (SELECT count(*)::integer FROM citizens c WHERE c.tenant_id=t.id) AS citizens, (SELECT count(*)::integer FROM applications a WHERE a.tenant_id=t.id) AS applications, (SELECT count(*)::integer FROM certificates c WHERE c.tenant_id=t.id) AS certificates, w.balance, coalesce((SELECT sum(l.delta)::integer FROM credit_ledger l WHERE l.tenant_id=t.id),0) AS ledger_sum FROM tenants t LEFT JOIN tenant_wallets w ON w.tenant_id=t.id ORDER BY t.id`,
    )
  ).rows;
  const certificates = (
    await client.query(
      // Stage 5: the fee is charged at SUBMIT (migration 044, W-003), not at
      // issuance — the retired 'ISSUANCE' credit_ledger kind is written by
      // no code path any more. Settlement evidence therefore lives on the
      // application: fee_method + fee_settled_at, with exactly one
      // APPLICATION_FEE row (CREDIT), one allowance-consumption row
      // (ALLOWANCE), or neither (FREE). See validateState below.
      `SELECT c.id,c.tenant_id,c.status,octet_length(c.pdf)::integer AS bytes,encode(digest(c.pdf,'sha256'),'hex') AS pdf_sha256,substring(c.pdf from 1 for 5)=decode('255044462d','hex') AS pdf_header,a.fee_method,(a.fee_settled_at IS NOT NULL) AS fee_settled,(SELECT count(*)::integer FROM credit_ledger l WHERE l.tenant_id=c.tenant_id AND l.application_id=c.application_id AND l.kind='APPLICATION_FEE') AS fee_debits,(SELECT count(*)::integer FROM subscription_allowance_consumptions s WHERE s.tenant_id=c.tenant_id AND s.application_id=c.application_id) AS allowance_rows FROM certificates c JOIN applications a ON a.id=c.application_id ORDER BY c.id`,
    )
  ).rows;
  const constraints = (
    await client.query(
      "SELECT conrelid::regclass::text AS table_name,conname AS name,convalidated AS validated,pg_get_constraintdef(oid,true) AS definition FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY conrelid::regclass::text,conname",
    )
  ).rows;
  const policies = (
    await client.query(
      "SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname",
    )
  ).rows;
  const rowSecurity = (
    await client.query(
      "SELECT relname AS table_name,relrowsecurity AS enabled,relforcerowsecurity AS forced FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' ORDER BY relname",
    )
  ).rows;
  const triggers = (
    await client.query(
      "SELECT c.relname AS table_name,t.tgname AS name,t.tgenabled AS enabled,pg_get_triggerdef(t.oid,true) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal ORDER BY c.relname,t.tgname",
    )
  ).rows;
  const functionDefinitions = (
    await client.query(
      "SELECT p.proname AS name,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_functiondef(p.oid) AS definition FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind IN ('f','p') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e') ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)",
    )
  ).rows;
  const tableGrants = (
    await client.query(
      "SELECT c.relname AS table_name,coalesce(r.rolname,'PUBLIC') AS grantee,a.privilege_type,a.is_grantable FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::\"char\" ELSE 'r'::\"char\" END,c.relowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p','v','m','S') ORDER BY c.relname,coalesce(r.rolname,'PUBLIC'),a.privilege_type",
    )
  ).rows;
  const functionGrants = (
    await client.query(
      "SELECT p.proname AS name,pg_get_function_identity_arguments(p.oid) AS arguments,coalesce(r.rolname,'PUBLIC') AS grantee,a.privilege_type,a.is_grantable FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE p.pronamespace='public'::regnamespace AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e') ORDER BY p.proname,pg_get_function_identity_arguments(p.oid),coalesce(r.rolname,'PUBLIC'),a.privilege_type",
    )
  ).rows;
  const catalogQueries = {
    columns:
      "SELECT c.relname AS table_name,a.attnum AS position,a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,a.attidentity AS identity,a.attgenerated AS generated,pg_get_expr(d.adbin,d.adrelid) AS default_expression FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p','v','m') ORDER BY c.relname,a.attnum",
    columnGrants:
      "SELECT c.relname AS table_name,b.attname AS column_name,coalesce(r.rolname,'PUBLIC') AS grantee,a.privilege_type,a.is_grantable FROM pg_attribute b JOIN pg_class c ON c.oid=b.attrelid CROSS JOIN LATERAL aclexplode(b.attacl) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE c.relnamespace='public'::regnamespace AND b.attnum>0 AND NOT b.attisdropped ORDER BY c.relname,b.attname,coalesce(r.rolname,'PUBLIC'),a.privilege_type",
    indexes:
      "SELECT c.relname AS table_name,i.relname AS name,x.indisvalid AS valid,x.indisready AS ready,pg_get_indexdef(i.oid) AS definition FROM pg_index x JOIN pg_class c ON c.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid WHERE c.relnamespace='public'::regnamespace ORDER BY c.relname,i.relname",
    extensions:
      "SELECT extname AS name,extversion AS version FROM pg_extension ORDER BY extname",
    views:
      "SELECT c.relname AS name,c.relkind AS kind,pg_get_viewdef(c.oid,true) AS definition FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('v','m') ORDER BY c.relname",
    enums:
      "SELECT t.typname AS name,e.enumlabel AS label,e.enumsortorder AS position FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid WHERE t.typnamespace='public'::regnamespace ORDER BY t.typname,e.enumsortorder",
    schemaGrants:
      "SELECT n.nspname AS schema_name,coalesce(r.rolname,'PUBLIC') AS grantee,a.privilege_type,a.is_grantable FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE n.nspname='public' ORDER BY coalesce(r.rolname,'PUBLIC'),a.privilege_type",
    defaultGrants:
      "SELECT pg_get_userbyid(d.defaclrole) AS owner,coalesce(n.nspname,'*') AS schema_name,d.defaclobjtype AS object_type,coalesce(r.rolname,'PUBLIC') AS grantee,a.privilege_type,a.is_grantable FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace CROSS JOIN LATERAL aclexplode(d.defaclacl) a LEFT JOIN pg_roles r ON r.oid=a.grantee ORDER BY owner,schema_name,object_type,grantee,a.privilege_type",
    sequences:
      "SELECT sequencename AS name,data_type::text,start_value,min_value,max_value,increment_by,cycle,cache_size,last_value FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename",
  };
  const catalog = {};
  for (const [name, sql] of Object.entries(catalogQueries))
    catalog[name] = (await client.query(sql)).rows;
  let orphanTenantReferences = 0;
  const tenantTables = (
    await client.query(
      "SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='tenant_id' ORDER BY table_name",
    )
  ).rows;
  for (const { table_name: name } of tenantTables) {
    const row = (
      await client.query(
        `SELECT count(*)::integer AS invalid FROM public.${quoteIdentifier(name)} r LEFT JOIN tenants t ON t.id=r.tenant_id WHERE r.tenant_id IS NOT NULL AND t.id IS NULL`,
      )
    ).rows[0];
    orphanTenantReferences += row.invalid;
  }
  return {
    tables,
    tenants,
    certificates,
    constraints,
    policies,
    rowSecurity,
    triggers,
    functionDefinitions,
    tableGrants,
    functionGrants,
    ...catalog,
    orphanTenantReferences,
  };
}

export function validateState(state) {
  if (state.orphanTenantReferences !== 0)
    throw new Error("Recovery consistency check: orphan tenant references.");
  if (state.tenants.some((tenant) => tenant.balance !== tenant.ledger_sum))
    throw new Error("Recovery consistency check: wallet/ledger mismatch.");
  // Stage 5: exactly-once SUBMIT-time settlement (migration 044, W-003).
  // A certificate must come from a settled application, and the settlement
  // evidence must match the recorded method exactly once: CREDIT → one
  // APPLICATION_FEE ledger row; ALLOWANCE → one allowance-consumption row;
  // FREE → neither. Anything else (unsettled, double-charged, or
  // method/evidence mismatch) fails the restore. The old
  // 'one ISSUANCE debit per certificate' check described the retired
  // issuance-charge model and can never pass on a current-model database.
  if (
    state.certificates.some(
      (certificate) =>
        !certificate.pdf_header ||
        certificate.bytes < 1000 ||
        !certificate.fee_settled ||
        (certificate.fee_method === "CREDIT" &&
          !(certificate.fee_debits === 1 && certificate.allowance_rows === 0)) ||
        (certificate.fee_method === "ALLOWANCE" &&
          !(certificate.allowance_rows === 1 && certificate.fee_debits === 0)) ||
        (certificate.fee_method === "FREE" &&
          !(certificate.fee_debits === 0 && certificate.allowance_rows === 0)) ||
        !["CREDIT", "ALLOWANCE", "FREE"].includes(certificate.fee_method),
    )
  )
    throw new Error(
      "Recovery consistency check: PDF bytes/header or exactly-once submit-time settlement mismatch.",
    );
  if (state.constraints.some((constraint) => !constraint.validated))
    throw new Error("Recovery consistency check: unvalidated constraints.");
  if (state.indexes?.some((index) => !index.valid || !index.ready))
    throw new Error(
      "Recovery consistency check: invalid or unfinished indexes.",
    );
}

export function encryptPayload(payload, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(MAGIC);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptPayload(archive, key) {
  if (
    key.length !== 32 ||
    archive.length <= MAGIC.length + 28 ||
    !archive.subarray(0, MAGIC.length).equals(MAGIC)
  )
    throw new Error("Backup authentication failed.");
  const iv = archive.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = archive.subarray(MAGIC.length + 12, MAGIC.length + 28);
  const ciphertext = archive.subarray(MAGIC.length + 28);
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(MAGIC);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    const manifestBytes = plain.readUInt32BE(0);
    if (manifestBytes < 2 || manifestBytes > plain.length - 4)
      throw new Error("Invalid encrypted manifest.");
    const manifest = JSON.parse(
      plain.subarray(4, manifestBytes + 4).toString("utf8"),
    );
    const dump = plain.subarray(manifestBytes + 4);
    if (
      manifest.dumpSha256 !== sha256(dump) ||
      !dump.subarray(0, 5).equals(Buffer.from("PGDMP"))
    )
      throw new Error("Invalid encrypted PostgreSQL dump.");
    return { manifest, dump };
  } catch {
    throw new Error("Backup authentication failed.");
  }
}

export async function createBackup(configuration) {
  configuration ??= await loadConfiguration();
  validateConfiguration(configuration);
  await validateBackupStorage();
  const label = `backup_${new Date().toISOString().replace(/[^0-9]/g, "")}_${crypto.randomBytes(4).toString("hex")}`;
  const dumpPath = requireWorkspaceBackupPath(
    path.join(backupDirectory, `${label}.plaintext.dump`),
  );
  const archivePath = requireWorkspaceBackupPath(
    path.join(backupDirectory, `${label}.pgdump.aes`),
  );
  const keyPath = requireWorkspaceBackupPath(
    path.join(backupDirectory, `${label}.key`),
  );
  const client = await openDatabase(configuration.admin);
  let began = false;
  let ownsPlaintext = false;
  try {
    const role = (
      await client.query(
        "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
      )
    ).rows[0];
    if (!role.rolsuper && !role.rolbypassrls)
      throw new Error(
        "Full local snapshot requires an administrator that can read every forced-RLS tenant; partial exports are forbidden.",
      );
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    began = true;
    const snapshot = (await client.query("SELECT pg_export_snapshot() AS id"))
      .rows[0].id;
    const state = await captureState(client);
    validateState(state);
    const reserved = await fs.open(dumpPath, "wx", 0o600);
    ownsPlaintext = true;
    await reserved.close();
    await runPgTool(
      configuration,
      "pg_dump",
      [
        "--format=custom",
        "--no-owner",
        `--snapshot=${snapshot}`,
        `--file=${dumpPath}`,
      ],
      configuration.admin,
      label,
    );
    await client.query("COMMIT");
    began = false;
    const dump = await fs.readFile(dumpPath);
    const manifest = {
      format: 2,
      createdAt: new Date().toISOString(),
      sourceDatabase: "astra",
      sourceServer: "loopback",
      dumpSha256: sha256(dump),
      state,
    };
    const metadata = Buffer.from(JSON.stringify(manifest), "utf8");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(metadata.length);
    const key = crypto.randomBytes(32);
    await fs.writeFile(keyPath, key, { flag: "wx", mode: 0o600 });
    await fs.writeFile(
      archivePath,
      encryptPayload(Buffer.concat([length, metadata, dump]), key),
      { flag: "wx", mode: 0o600 },
    );
    return { archivePath, keyPath, manifest };
  } finally {
    if (began) await client.query("ROLLBACK").catch(() => {});
    await client.end();
    if (ownsPlaintext) await removePlaintext(dumpPath);
  }
}

export function generatedRestoreName() {
  return `astra_restore_${new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 14)}_${crypto.randomBytes(4).toString("hex")}`;
}

export async function restoreBackup({
  archivePath,
  keyPath,
  targetName = generatedRestoreName(),
  configuration,
  keyOverride,
}) {
  configuration ??= await loadConfiguration();
  validateConfiguration(configuration);
  if (
    !targetPattern.test(targetName) ||
    targetName.length > 63 ||
    targetName === "astra"
  )
    throw new Error(
      "Restore target must be a new generated astra_restore_* database; main astra is forbidden.",
    );
  archivePath = requireWorkspaceBackupPath(archivePath);
  keyPath = requireWorkspaceBackupPath(keyPath);
  await validateBackupStorage();
  // Complete GCM authentication before writing plaintext or creating any database.
  const { manifest, dump } = decryptPayload(
    await readBackupArtifact(archivePath),
    keyOverride ?? (await readBackupArtifact(keyPath)),
  );
  if (manifest.format !== 2)
    throw new Error(
      "This verifier requires a format-2 manifest. Keep older backups with their matching verifier; do not silently skip security checks.",
    );
  const dumpPath = requireWorkspaceBackupPath(
    path.join(backupDirectory, `${targetName}.restore.plaintext.dump`),
  );
  const administrator = await openDatabase(configuration.admin);
  const restoredUrl = new URL(configuration.admin);
  restoredUrl.pathname = "/" + targetName;
  let ownsPlaintext = false;
  try {
    if (
      (
        await administrator.query(
          "SELECT 1 FROM pg_database WHERE datname=$1",
          [targetName],
        )
      ).rowCount
    )
      throw new Error(
        "Restore target already exists; automatic overwrite/drop is forbidden.",
      );
    await fs.writeFile(dumpPath, dump, { flag: "wx", mode: 0o600 });
    ownsPlaintext = true;
    await administrator.query(
      `CREATE DATABASE ${quoteIdentifier(targetName)} WITH TEMPLATE template0 ENCODING 'UTF8'`,
    );
    await runPgTool(
      configuration,
      "pg_restore",
      ["--exit-on-error", "--no-owner", `--dbname=${targetName}`, dumpPath],
      restoredUrl,
      targetName,
    );
    const restored = await openDatabase(restoredUrl);
    try {
      const state = await captureState(restored);
      validateState(state);
      if (JSON.stringify(state) !== JSON.stringify(manifest.state))
        throw new Error(
          "Recovery snapshot/table/tenant/ledger/PDF/security comparison failed.",
        );
      return { targetName, state, manifest };
    } finally {
      await restored.end();
    }
  } finally {
    await administrator.end();
    if (ownsPlaintext) await removePlaintext(dumpPath);
  }
}

async function main() {
  const [mode, ...argumentsList] = process.argv.slice(2);
  if (mode === "backup") {
    const result = await createBackup();
    console.log(
      `Encrypted backup ready: ${path.relative(root, result.archivePath)}`,
    );
    console.log(
      `Local key file: ${path.relative(root, result.keyPath)} (contents never printed)`,
    );
    console.log(
      `Snapshot tables=${result.manifest.state.tables.length}; tenants=${result.manifest.state.tenants.length}; certificates=${result.manifest.state.certificates.length}`,
    );
  } else if (mode === "restore") {
    const [archive, key, targetName] = argumentsList;
    if (!archive || !key)
      throw new Error(
        "Usage: node scripts/backup/backup.mjs restore .runtime/backups/archive.pgdump.aes .runtime/backups/archive.key [astra_restore_newname]",
      );
    const result = await restoreBackup({
      archivePath: path.resolve(root, archive),
      keyPath: path.resolve(root, key),
      targetName,
    });
    console.log(
      `Verified restore ready: ${result.targetName}; exact snapshot/table/tenant/ledger/PDF/security comparison passed.`,
    );
  } else
    throw new Error(
      "Usage: node scripts/backup/backup.mjs backup | restore <archive> <key> [new target]",
    );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(`Recovery operation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
