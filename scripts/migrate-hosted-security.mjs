/** LEGACY (12 Nov 2026): hard-wired to the retired Render Free database dpg-db6tr43ncjis73ercfsg-a. The live database is now on Neon; kept unchanged as history. See docs/HOSTED_DEPLOYMENT.md. */
/** Bounded release-0.8 migration; run only against the existing authorized Render database. */
import fs from "node:fs";
import { createHash } from "node:crypto";
import { checkServerIdentity } from "node:tls";
import pg from "pg";

const host = "dpg-db6tr43ncjis73ercfsg-a.singapore-postgres.render.com";
const database = "astra_uvug";
const migrations = ["013_account_mfa.sql", "014_audit_tenant_integrity.sql"];
const newTables = [
  "account_mfa",
  "account_security_events",
  "mfa_login_challenges",
];
const evidencePath = "execution/recovery-mfa-hosted-migration.json";
const evidence = {
  release: "0.8.0",
  startedAt: new Date().toISOString(),
  status: "RUNNING",
  migrations,
  mutationScope:
    "Migrations 013/014 and markers only: add authentication tables and validate audit tenant NOT NULL. No user enrollment, application, fee, payment, certificate or ledger changes.",
  checks: [],
};
const requireThat = (condition, message) => {
  if (!condition) throw new Error(message);
};
const quote = (name) => {
  requireThat(/^[a-z][a-z0-9_]*$/.test(name), "Unsafe database identifier");
  return `"${name}"`;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const save = () =>
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
const checked = (name, details) =>
  evidence.checks.push({ name, status: "PASS", ...details });
let admin,
  runtime,
  transaction = false,
  stage = "preflight";
async function connect(raw, role) {
  const url = new URL(raw);
  requireThat(
    ["postgres:", "postgresql:"].includes(url.protocol) &&
      url.hostname === host &&
      url.pathname === `/${database}` &&
      ["", "5432"].includes(url.port) &&
      !url.hash &&
      url.username === role &&
      url.password,
    "Unexpected maintenance target",
  );
  requireThat(
    url.searchParams.size === 1 &&
      url.searchParams.get("sslmode") === "verify-full",
    "Verified TLS required",
  );
  url.search = "";
  const client = new pg.Client({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 10000,
    query_timeout: 60000,
    application_name: "astra-reviewed-security-migration",
  });
  try {
    await client.connect();
    const stream = client.connection.stream;
    requireThat(
      stream.encrypted &&
        stream.authorized &&
        !checkServerIdentity(host, stream.getPeerCertificate()),
      "TLS chain/hostname verification failed",
    );
    const identity = (
      await client.query(
        "SELECT current_user,current_database() AS database,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user",
      )
    ).rows[0];
    requireThat(
      identity.current_user === role &&
        identity.database === database &&
        !identity.rolsuper &&
        !identity.rolbypassrls,
      "Unexpected source privileges",
    );
    if (role === "astra_app")
      requireThat(
        !identity.rolcreatedb && !identity.rolcreaterole,
        "Runtime role is elevated",
      );
    return client;
  } catch (error) {
    await client.end().catch(() => {});
    throw error;
  }
}
async function fingerprints(client, tables, tenants) {
  const result = {};
  for (const table of tables) {
    if (table.name === "schema_migrations") continue;
    if (table.rls) {
      requireThat(
        table.tenantColumn,
        "Unexpected existing non-tenant RLS table",
      );
      result[table.name] = [];
      for (const tenant of tenants) {
        await client.query("SELECT set_config('astra.tenant_id',$1,true)", [
          tenant.id,
        ]);
        const row = (
          await client.query(
            `SELECT count(*)::integer AS count,encode(digest(coalesce(jsonb_agg(r ORDER BY r::text)::text,'[]'),'sha256'),'hex') AS sha256 FROM (SELECT to_jsonb(t) AS r FROM public.${quote(table.name)} t WHERE tenant_id=$1) data`,
            [tenant.id],
          )
        ).rows[0];
        // Tenant identity stays private: published evidence contains aggregate counters only.
        result[table.name].push(row);
      }
    } else
      result[table.name] = (
        await client.query(
          `SELECT count(*)::integer AS count,encode(digest(coalesce(jsonb_agg(r ORDER BY r::text)::text,'[]'),'sha256'),'hex') AS sha256 FROM (SELECT to_jsonb(t) AS r FROM public.${quote(table.name)} t) data`,
        )
      ).rows[0];
  }
  return result;
}
try {
  requireThat(
    process.argv[2] === "--apply-reviewed-security-migration" &&
      process.argv.length === 4,
    "Reviewed migration flag and SHA-256 required",
  );
  const expected = process.argv[3];
  requireThat(
    /^[a-f0-9]{64}$/.test(expected),
    "Expected reviewed SHA-256 required",
  );
  requireThat(
    process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
    "TLS must not be disabled",
  );
  const sources = migrations.map((name) => ({
    name,
    sql: fs
      .readFileSync(`db/migrations/${name}`, "utf8")
      .replace(/\r\n/g, "\n"),
  }));
  requireThat(
    createHash("sha256")
      .update(sources.map((s) => s.name + "\n" + s.sql).join("\n"))
      .digest("hex") === expected,
    "Migrations changed after review",
  );
  evidence.sqlSha256 = expected;
  const config = JSON.parse(
    fs.readFileSync(".runtime/hosted/render-database.json", "utf8"),
  );
  requireThat(
    config.databaseId === "dpg-db6tr43ncjis73ercfsg-a",
    "Database binding mismatch",
  );
  admin = await connect(config.externalAdminUrl, "astra_admin");
  runtime = await connect(config.externalAppUrl, "astra_app");
  checked("TLS and non-bypass identities");
  stage = "transactional migration";
  await admin.query("BEGIN");
  transaction = true;
  await admin.query("SET LOCAL lock_timeout='10s'");
  await admin.query("SET LOCAL statement_timeout='60s'");
  await admin.query("SELECT pg_advisory_xact_lock(73008013)");
  const beforeMigrations = (
    await admin.query(
      "SELECT name,applied_at FROM schema_migrations ORDER BY name",
    )
  ).rows;
  const localMigrations = fs
    .readdirSync("db/migrations")
    .filter((n) => n.endsWith(".sql"))
    .sort();
  const toApply = sources.filter(
    (s) => !beforeMigrations.some((row) => row.name === s.name),
  );
  requireThat(
    same(
      beforeMigrations.map((row) => row.name),
      localMigrations.filter((n) => !toApply.some((s) => s.name === n)),
    ),
    "Migration baseline mismatch",
  );
  const allTables = (
    await admin.query(
      `SELECT c.relname AS name,c.relrowsecurity AS rls,EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND NOT a.attisdropped) AS "tenantColumn" FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' ORDER BY c.relname`,
    )
  ).rows;
  const tables = allTables.filter((row) => !newTables.includes(row.name));
  await admin.query(
    `LOCK TABLE ${allTables.map((t) => `public.${quote(t.name)}`).join(",")} IN SHARE MODE`,
  );
  const tenants = (await admin.query("SELECT id FROM tenants ORDER BY id"))
    .rows;
  const before = await fingerprints(admin, tables, tenants);
  const historyBefore = (
    await admin.query(
      `SELECT p.proname,pg_get_function_identity_arguments(p.oid) arguments,pg_get_functiondef(p.oid) definition,pg_get_userbyid(p.proowner) owner FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e') ORDER BY p.proname,arguments`,
    )
  ).rows;
  for (const source of toApply) {
    await admin.query(source.sql);
    await admin.query("INSERT INTO schema_migrations(name) VALUES($1)", [
      source.name,
    ]);
  }
  const after = await fingerprints(admin, tables, tenants);
  requireThat(
    same(before, after),
    "Existing table fingerprints changed; rolling back",
  );
  const historyAfter = (
    await admin.query(
      `SELECT p.proname,pg_get_function_identity_arguments(p.oid) arguments,pg_get_functiondef(p.oid) definition,pg_get_userbyid(p.proowner) owner FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e') ORDER BY p.proname,arguments`,
    )
  ).rows;
  requireThat(
    same(historyBefore, historyAfter),
    "Existing routine security changed",
  );
  checked("Existing global and tenant data preserved", {
    tables: Object.keys(before).length,
    tenants: tenants.length,
    fingerprints: Object.values(before).reduce(
      (n, v) => n + (Array.isArray(v) ? v.length : 1),
      0,
    ),
    routines: historyBefore.length,
  });
  const securityTables = (
    await admin.query(
      `SELECT c.relname name,c.relrowsecurity rls,c.relforcerowsecurity forced,pg_get_userbyid(c.relowner) owner FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY($1) ORDER BY c.relname`,
      [newTables],
    )
  ).rows;
  requireThat(
    securityTables.length === 3 &&
      securityTables.every(
        (t) =>
          t.owner === "astra_admin" &&
          (t.name === "mfa_login_challenges" || (t.rls && t.forced)),
      ),
    "New ownership/RLS contract failed",
  );
  if (toApply.some((s) => s.name === migrations[0]))
    for (const table of newTables)
      requireThat(
        (
          await admin.query(
            `SELECT count(*)::integer AS count FROM public.${quote(table)}`,
          )
        ).rows[0].count === 0,
        "Migration must not enroll users",
      );
  requireThat(
    (
      await admin.query(
        "SELECT attnotnull FROM pg_attribute WHERE attrelid='audit_events'::regclass AND attname='tenant_id'",
      )
    ).rows[0].attnotnull,
    "Audit tenant completeness invariant failed",
  );
  const policies = (
    await admin.query(
      "SELECT tablename,policyname,cmd,qual,with_check,roles::text[] roles,permissive FROM pg_policies WHERE schemaname='public' AND tablename=ANY($1) ORDER BY tablename,policyname",
      [["account_mfa", "account_security_events"]],
    )
  ).rows;
  const expectedPolicy =
    "(user_id=(NULLIF(current_setting('astra.account_id'::text,true),''::text))::uuid)";
  requireThat(
    policies.length === 2 &&
      policies.every(
        (p) =>
          p.policyname === "account_scope" &&
          p.cmd === "ALL" &&
          p.qual.replace(/\s/g, "") === expectedPolicy &&
          p.with_check === p.qual &&
          same(p.roles, ["public"]) &&
          p.permissive === "PERMISSIVE",
      ),
    "Account policy contract changed",
  );
  const trigger = (
    await admin.query(
      "SELECT t.tgenabled,t.tgtype,t.tgfoid='public.immutable_record()'::regprocedure AS correct_function FROM pg_trigger t WHERE t.tgrelid='public.account_security_events'::regclass AND t.tgname='immutable' AND NOT t.tgisinternal",
    )
  ).rows[0];
  requireThat(
    trigger?.tgenabled === "O" &&
      trigger.tgtype === 27 &&
      trigger.correct_function,
    "Account history immutability trigger changed",
  );
  await admin.query("COMMIT");
  transaction = false;
  checked("Schema and audit completeness guards committed", {
    applied: toApply.map((s) => s.name),
    securityTables,
  });
  stage = "runtime privilege readback";
  for (const table of ["account_mfa", "account_security_events"])
    requireThat(
      (
        await runtime.query(
          `SELECT count(*)::integer AS count FROM public.${quote(table)}`,
        )
      ).rows[0].count === 0,
      "Unscoped account data exposed",
    );
  const immutable = (
    await runtime.query(
      "SELECT has_table_privilege(current_user,'account_security_events','UPDATE,DELETE,TRUNCATE') AS can_mutate,has_table_privilege(current_user,'account_security_events','SELECT') AS can_read,has_table_privilege(current_user,'account_security_events','INSERT') AS can_log",
    )
  ).rows[0];
  requireThat(
    !immutable.can_mutate && immutable.can_read && immutable.can_log,
    "Security history privileges incorrect",
  );
  requireThat(
    !(
      await runtime.query(
        "SELECT pg_has_role(current_user,'astra_admin','MEMBER') AS inherited",
      )
    ).rows[0].inherited,
    "Runtime inherits owner",
  );
  checked("Runtime account isolation and immutable audit grants");
  evidence.status = "PASS";
  evidence.finishedAt = new Date().toISOString();
  save();
  console.log(
    JSON.stringify({
      status: evidence.status,
      checks: evidence.checks.length,
      evidence: evidencePath,
    }),
  );
} catch (error) {
  if (transaction) await admin?.query("ROLLBACK").catch(() => {});
  evidence.status = "FAIL";
  evidence.failedStage = stage;
  // Do not expose server errors: SQL diagnostics can include row values or credentials.
  evidence.errorCode =
    typeof error.code === "string" ? error.code : "VALIDATION_FAILED";
  save();
  console.error(
    `Hosted security migration failed at ${stage}; no credentials were printed.`,
  );
  process.exitCode = 1;
} finally {
  await admin?.end();
  await runtime?.end();
}
