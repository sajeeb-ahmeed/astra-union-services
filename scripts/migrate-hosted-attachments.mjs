/** LEGACY (12 Nov 2026): hard-wired to the retired Render Free database dpg-db6tr43ncjis73ercfsg-a. The live database is now on Neon; kept unchanged as history. See docs/HOSTED_DEPLOYMENT.md. */
/** Bounded release-0.9 migration. Never run without review and database access authorization. */
import fs from "node:fs";
import { createHash } from "node:crypto";
import { checkServerIdentity } from "node:tls";
import pg from "pg";

const host = "dpg-db6tr43ncjis73ercfsg-a.singapore-postgres.render.com";
const database = "astra_uvug";
const migrations = ["015_attachment_quarantine.sql"];
const newTables = ["attachment_scan_events", "attachment_scanner_heartbeats"];
const scanColumns = ["scan_state", "scan_attempts", "lease_token_hash", "lease_expires_at", "next_retry_at", "scan_reason", "scanned_at", "scanned_sha256", "scan_worker_id", "scan_engine_version", "scan_signature_version", "scan_signature_updated_at"];
// Only these newly added fields and the deliberately changed legacy scan_state
// are excluded. Original bytea, MIME, lengths, identity, owner and dates are hashed.
const fingerprintExclusions = [...scanColumns, "content_sha256"];
const originalColumns = ["id", "tenant_id", "citizen_id", "uploaded_by", "mime_type", "byte_length", "bytes", "created_at", "content_sha256"];
const insertColumns = ["tenant_id", "citizen_id", "uploaded_by", "mime_type", "byte_length", "bytes"];
const evidencePath = "execution/attachment-hosted-migration.json";
const evidence = {
  release: "0.9.0", startedAt: new Date().toISOString(), status: "RUNNING", migrations,
  mutationScope: "Migration 015 and marker only: quarantine every legacy attachment, add immutable content hashes, scan metadata, tenant-scoped scan events and heartbeats. Preserve original attachment bytes/identity/ownership and all other business/account data.",
  checks: [],
};
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const quote = (name) => { requireThat(/^[a-z][a-z0-9_]*$/.test(name), "Unsafe identifier"); return `"${name}"`; };
const save = () => { fs.mkdirSync("execution", { recursive: true }); fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2)); };
const checked = (name, details = {}) => evidence.checks.push({ name, status: "PASS", ...details });
let admin, runtime, transaction = false, stage = "preflight";

async function connect(raw, role) {
  const url = new URL(raw);
  requireThat(["postgres:", "postgresql:"].includes(url.protocol) && url.hostname === host && url.pathname === `/${database}` && ["", "5432"].includes(url.port) && !url.hash && url.username === role && url.password, "Unexpected maintenance target");
  requireThat(url.searchParams.size === 1 && url.searchParams.get("sslmode") === "verify-full", "Verified TLS required");
  url.search = "";
  const client = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 10000, query_timeout: 60000, application_name: "astra-reviewed-attachment-migration" });
  try {
    await client.connect();
    const stream = client.connection.stream;
    requireThat(stream.encrypted && stream.authorized && !checkServerIdentity(host, stream.getPeerCertificate()), "TLS chain/hostname verification failed");
    const identity = (await client.query("SELECT current_user,current_database() AS database,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user")).rows[0];
    requireThat(identity.current_user === role && identity.database === database && !identity.rolsuper && !identity.rolbypassrls, "Unexpected source privileges");
    if (role === "astra_app") requireThat(!identity.rolcreatedb && !identity.rolcreaterole, "Runtime role is elevated");
    return client;
  } catch (error) { await client.end().catch(() => {}); throw error; }
}

async function fingerprints(client, tables, tenants, accounts) {
  const result = {};
  for (const table of tables) {
    if (table.name === "schema_migrations") continue;
    const exclusions = table.name === "attachments" ? fingerprintExclusions : [];
    const base = `SELECT count(*)::integer count,encode(digest(coalesce(jsonb_agg(r ORDER BY r::text)::text,'[]'),'sha256'),'hex') sha256 FROM (SELECT to_jsonb(t)-$1::text[] r FROM public.${quote(table.name)} t`;
    if (!table.rls) { result[table.name] = (await client.query(`${base}) data`, [exclusions])).rows[0]; continue; }
    const accountScoped = ["account_mfa", "account_security_events"].includes(table.name);
    requireThat(accountScoped ? table.userColumn && !table.tenantColumn : table.tenantColumn, "Unexpected existing RLS scope");
    const scope = accountScoped ? accounts : tenants;
    const column = accountScoped ? "user_id" : "tenant_id";
    const setting = accountScoped ? "astra.account_id" : "astra.tenant_id";
    result[table.name] = [];
    for (const item of scope) {
      await client.query("SELECT set_config($1,$2,true)", [setting, item.id]);
      result[table.name].push((await client.query(`${base} WHERE ${quote(column)}=$2) data`, [exclusions, item.id])).rows[0]);
    }
  }
  // Published evidence contains counts only, never tenant/account IDs or row hashes.
  return result;
}
const routines = async (client) => (await client.query("SELECT p.proname,pg_get_function_identity_arguments(p.oid) arguments,pg_get_functiondef(p.oid) definition,pg_get_userbyid(p.proowner) owner,p.prosecdef,p.proconfig,p.proacl::text privileges FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e') ORDER BY p.proname,arguments")).rows;
const policies = async (client) => (await client.query("SELECT tablename,policyname,cmd,qual,with_check,roles::text[] roles,permissive FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname")).rows;

try {
  requireThat(process.argv[2] === "--apply-reviewed-attachment-migration" && process.argv.length === 4, "Reviewed migration flag and SHA-256 required");
  const expected = process.argv[3];
  requireThat(/^[a-f0-9]{64}$/.test(expected), "Expected reviewed SHA-256 required");
  requireThat(process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0", "TLS must not be disabled");
  const sources = migrations.map((name) => ({ name, sql: fs.readFileSync(`db/migrations/${name}`, "utf8").replace(/\r\n/g, "\n") }));
  requireThat(createHash("sha256").update(sources.map((s) => s.name + "\n" + s.sql).join("\n")).digest("hex") === expected, "Migration changed after review");
  evidence.sqlSha256 = expected;
  const config = JSON.parse(fs.readFileSync(".runtime/hosted/render-database.json", "utf8"));
  requireThat(config.databaseId === "dpg-db6tr43ncjis73ercfsg-a", "Database binding mismatch");
  admin = await connect(config.externalAdminUrl, "astra_admin");
  runtime = await connect(config.externalAppUrl, "astra_app");
  checked("Exact authorized database, verified TLS and non-bypass identities");
  stage = "transactional migration";
  await admin.query("BEGIN"); transaction = true;
  await admin.query("SET LOCAL lock_timeout='10s'");
  await admin.query("SET LOCAL statement_timeout='60s'");
  await admin.query("SELECT pg_advisory_xact_lock(73009015)");
  const beforeMigrations = (await admin.query("SELECT name,applied_at FROM schema_migrations ORDER BY name")).rows;
  const localMigrations = fs.readdirSync("db/migrations").filter((n) => n.endsWith(".sql")).sort();
  const toApply = sources.filter((s) => !beforeMigrations.some((row) => row.name === s.name));
  requireThat(same(beforeMigrations.map((row) => row.name), localMigrations.filter((n) => !toApply.some((s) => s.name === n))), "Migration baseline mismatch");
  const allTables = (await admin.query("SELECT c.relname name,c.relrowsecurity rls,EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND NOT a.attisdropped) AS \"tenantColumn\",EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='user_id' AND NOT a.attisdropped) AS \"userColumn\" FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' ORDER BY c.relname")).rows;
  requireThat(allTables.length && allTables.some((t) => t.name === "attachments"), "Expected baseline tables missing");
  if (toApply.length) requireThat(newTables.every((name) => !allTables.some((t) => t.name === name)), "Unmarked partial scan schema exists");
  await admin.query(`LOCK TABLE ${allTables.map((t) => `public.${quote(t.name)}`).join(",")} IN SHARE MODE`);
  const tenants = (await admin.query("SELECT id FROM tenants ORDER BY id")).rows;
  const accounts = (await admin.query("SELECT id FROM platform_users ORDER BY id")).rows;
  const before = await fingerprints(admin, allTables, tenants, accounts);
  const historyBefore = await routines(admin);
  const policiesBefore = await policies(admin);
  for (const source of toApply) {
    await admin.query(source.sql);
    await admin.query("INSERT INTO schema_migrations(name) VALUES($1)", [source.name]);
  }
  const after = await fingerprints(admin, allTables, tenants, accounts);
  requireThat(same(before, after), "Existing data fingerprints changed; rolling back");
  const historyAfter = await routines(admin);
  for (const existing of historyBefore) requireThat(same(existing, historyAfter.find((p) => p.proname === existing.proname && p.arguments === existing.arguments)), "Existing routine security changed");
  const addedRoutines = historyAfter.filter((p) => !historyBefore.some((old) => old.proname === p.proname && old.arguments === p.arguments));
  requireThat(addedRoutines.length === toApply.length && addedRoutines.every((p) => p.proname === "protect_attachment_content" && p.arguments === "" && p.owner === "astra_admin" && !p.prosecdef && same(p.proconfig, ["search_path=public, pg_catalog"])), "Unexpected new routine or unsafe attachment guard");
  const policiesAfter = await policies(admin);
  requireThat(same(policiesBefore, policiesAfter.filter((p) => !toApply.length || !newTables.includes(p.tablename))), "Existing RLS policies changed");
  const afterMigrations = (await admin.query("SELECT name,applied_at FROM schema_migrations ORDER BY name")).rows;
  requireThat(same(beforeMigrations, afterMigrations.filter((m) => !toApply.some((s) => s.name === m.name))) && same(afterMigrations.map((m) => m.name), localMigrations), "Migration marker integrity changed");
  checked("All existing global, tenant and account data preserved", { tables: Object.keys(before).length, tenants: tenants.length, accounts: accounts.length, routines: historyBefore.length, originalAttachmentFieldsPreserved: true });

  const scanTables = (await admin.query("SELECT c.relname name,c.relrowsecurity rls,c.relforcerowsecurity forced,pg_get_userbyid(c.relowner) owner FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY($1) ORDER BY c.relname", [["attachments", ...newTables]])).rows;
  requireThat(scanTables.length === 3 && scanTables.every((t) => t.owner === "astra_admin" && t.rls && t.forced), "Attachment ownership/FORCE RLS contract failed");
  const newPolicies = policiesAfter.filter((p) => newTables.includes(p.tablename));
  const expectedPolicy = "(tenant_id=(NULLIF(current_setting('astra.tenant_id'::text,true),''::text))::uuid)";
  requireThat(newPolicies.length === 2 && newPolicies.every((p) => p.policyname === "tenant_scope" && p.cmd === "ALL" && p.qual.replace(/\s/g, "") === expectedPolicy && p.with_check === p.qual && same(p.roles, ["public"]) && p.permissive === "PERMISSIVE"), "Scanner tenant policy contract changed");
  const constraints = (await admin.query("SELECT conname,convalidated FROM pg_constraint WHERE conrelid='attachments'::regclass AND conname=ANY($1)", [["attachment_content_integrity", "attachment_scan_state", "attachment_scan_attempts", "attachment_scan_reason", "attachment_scan_lease", "attachment_scan_result", "attachment_clean_reason"]])).rows;
  requireThat(constraints.length === 7 && constraints.every((c) => c.convalidated), "Attachment scan constraints incomplete");
  requireThat((await admin.query("SELECT attnotnull FROM pg_attribute WHERE attrelid='attachments'::regclass AND attname='content_sha256'")).rows[0]?.attnotnull, "Attachment hash must be NOT NULL");
  const triggers = (await admin.query("SELECT c.relname,t.tgname,t.tgenabled,t.tgtype,p.proname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_proc p ON p.oid=t.tgfoid WHERE NOT t.tgisinternal AND ((c.relname='attachments' AND t.tgname='attachment_content_guard') OR (c.relname='attachment_scan_events' AND t.tgname='immutable')) ORDER BY c.relname")).rows;
  requireThat(triggers.length === 2 && triggers.every((t) => t.tgenabled === "O" && (t.relname === "attachments" ? t.tgtype === 31 && t.proname === "protect_attachment_content" : t.tgtype === 27 && t.proname === "immutable_record")), "Attachment immutability triggers incomplete");

  let legacyAttachments = 0;
  for (const tenant of tenants) {
    await admin.query("SELECT set_config('astra.tenant_id',$1,true)", [tenant.id]);
    const check = (await admin.query("SELECT count(*)::integer count,count(*) FILTER(WHERE content_sha256<>encode(digest(bytes,'sha256'),'hex') OR byte_length<>octet_length(bytes))::integer invalid,count(*) FILTER(WHERE scan_state<>'QUARANTINED' OR scan_reason<>'PENDING_SCAN' OR scan_attempts<>0 OR lease_token_hash IS NOT NULL OR lease_expires_at IS NOT NULL OR next_retry_at IS NOT NULL OR scanned_at IS NOT NULL OR scanned_sha256 IS NOT NULL OR scan_worker_id IS NOT NULL OR scan_engine_version IS NOT NULL OR scan_signature_version IS NOT NULL OR scan_signature_updated_at IS NOT NULL)::integer not_quarantined FROM attachments WHERE tenant_id=$1", [tenant.id])).rows[0];
    requireThat(check.invalid === 0, "Attachment byte/hash integrity failed");
    if (toApply.length) {
      requireThat(check.not_quarantined === 0, "Legacy attachment was not quarantined");
      for (const name of newTables) requireThat((await admin.query(`SELECT count(*)::integer count FROM ${quote(name)} WHERE tenant_id=$1`, [tenant.id])).rows[0].count === 0, "Migration must not create scanner attestations");
    }
    legacyAttachments += check.count;
  }
  checked(toApply.length ? "All legacy attachments quarantined without pre-approved scan results" : "Existing attachment byte/hash integrity verified", { attachments: legacyAttachments, scanTables });

  const privileges = (await admin.query("SELECT a.attname,has_column_privilege('astra_app','attachments',a.attname,'INSERT') can_insert,has_column_privilege('astra_app','attachments',a.attname,'UPDATE') can_update FROM pg_attribute a WHERE a.attrelid='attachments'::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum")).rows;
  requireThat(privileges.every((p) => p.can_insert === insertColumns.includes(p.attname) && p.can_update === scanColumns.includes(p.attname)), "Attachment column grants changed");
  requireThat(originalColumns.every((name) => privileges.some((p) => p.attname === name && !p.can_update)), "Original content/identity mutable by runtime");
  const grants = (await admin.query("SELECT has_table_privilege('astra_app','attachments','SELECT') attachment_read,has_table_privilege('astra_app','attachments','UPDATE,INSERT,DELETE,TRUNCATE') attachment_broad_mutate,has_table_privilege('astra_app','attachment_scan_events','SELECT') events_read,has_table_privilege('astra_app','attachment_scan_events','INSERT') events_append,has_table_privilege('astra_app','attachment_scan_events','UPDATE,DELETE,TRUNCATE') events_mutate,has_table_privilege('astra_app','attachment_scanner_heartbeats','SELECT') heartbeats_read,has_table_privilege('astra_app','attachment_scanner_heartbeats','INSERT') heartbeats_insert,has_table_privilege('astra_app','attachment_scanner_heartbeats','UPDATE') heartbeats_update,has_table_privilege('astra_app','attachment_scanner_heartbeats','DELETE,TRUNCATE') heartbeats_delete")).rows[0];
  requireThat(grants.attachment_read && !grants.attachment_broad_mutate && grants.events_read && grants.events_append && !grants.events_mutate && grants.heartbeats_read && grants.heartbeats_insert && grants.heartbeats_update && !grants.heartbeats_delete, "Scanner runtime grants incorrect");
  requireThat((await admin.query("SELECT count(*)::integer count FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY($1) AND a.grantee=0", [["attachments", ...newTables]])).rows[0].count === 0, "PUBLIC has scanner table privileges");
  checked("Column-scoped updates, immutable content and append-only scan audit grants");
  await admin.query("COMMIT"); transaction = false;
  checked("Reviewed migration committed", { applied: toApply.map((s) => s.name) });
  stage = "runtime isolation readback";
  await runtime.query("SELECT set_config('astra.tenant_id','',false)");
  for (const name of ["attachments", ...newTables]) requireThat((await runtime.query(`SELECT count(*)::integer count FROM ${quote(name)}`)).rows[0].count === 0, "Unscoped attachment data exposed");
  requireThat(!(await runtime.query("SELECT pg_has_role(current_user,'astra_admin','MEMBER') inherited")).rows[0].inherited, "Runtime inherits owner");
  checked("Runtime unscoped reads reveal no attachment, scan event or heartbeat rows");
  evidence.status = "PASS"; evidence.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: evidence.status, checks: evidence.checks.length, evidence: evidencePath }));
} catch (error) {
  if (transaction) await admin?.query("ROLLBACK").catch(() => {});
  evidence.status = "FAIL"; evidence.failedStage = stage;
  evidence.errorCode = typeof error.code === "string" ? error.code : "VALIDATION_FAILED";
  // SQL diagnostics can contain row values or credentials; keep them out of reports.
  save(); console.error(`Hosted attachment migration failed at ${stage}; no credentials were printed.`); process.exitCode = 1;
} finally { await admin?.end(); await runtime?.end(); }
