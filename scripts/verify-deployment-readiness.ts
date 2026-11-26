/**
 * Post-deployment readiness / smoke checks (Batch C / A-002).
 *
 * Catches incomplete deployments BEFORE sign-off — in particular the
 * SCHEMA_UNAVAILABLE recurrence: after the r9 deploy (24 Nov 2026) live
 * applications failed with 422 SCHEMA_UNAVAILABLE because the post-deploy
 * initialization step (`npm run db:initialize-cpanel`) had been skipped, so
 * the service versions the bundle's code defines were never published to
 * `service_versions`. A deployment is not done until this script passes.
 *
 * Two modes (run from the repository root, or from the deployed bundle):
 *
 *   Database mode (local dev, or on the server after db:initialize-cpanel):
 *     DATABASE_ADMIN_URL=... node --import tsx scripts/verify-deployment-readiness.ts --db
 *     1. every db/migrations/*.sql file is recorded in schema_migrations
 *     2. service_versions holds every canonical schema version the bundle's
 *        code defines, with matching hashes (same source as initialize.ts)
 *     3. service_catalog holds the 47 services
 *     4. a platform owner account exists
 *
 *   Live mode (public endpoints only, no credentials):
 *     node --import tsx scripts/verify-deployment-readiness.ts --live https://digitalunion.com.bd [--expect-commit <sha>] [--expect-package <id>]
 *     1. /api/v1/health answers 200 with status ok and database PostgreSQL
 *     2. the reported release commit / package id match the deployed bundle
 *        (when --expect-* is given), and the reported migration version is
 *        the latest migration file in this repo
 *     3. the homepage returns the real app shell (contains id="root");
 *        the bot-challenge page does not, so a challenge substitution fails
 *        the check instead of passing as a 200
 *     4. /api/v1/services returns the 47 services
 *     5. /api/v1/services/1/schema returns 200 — the direct probe for the
 *        SCHEMA_UNAVAILABLE recurrence (unpublished versions answer 422)
 *     6. plain HTTP does not serve the app: /login over http:// must
 *        redirect to https:// (301/308) or be refused with 421 (S-008
 *        strict mode — the app fails closed when the proxy omits
 *        X-Forwarded-Proto). A 200 here means credentials could travel in
 *        cleartext: turn on cPanel Force HTTPS Redirect and re-check.
 *
 * Exit 0 only when every check passes; otherwise exit 1 with the failing
 * checks listed. Prints a PASS/FAIL line per check plus a JSON summary.
 * No credentials are printed, and live mode performs no mutation.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import pg from "pg";
import {
  serviceCatalog,
  allServiceSchemaVersions,
  getCatalogPreviewSchema,
  stableSchemaJson,
} from "@astra/shared-schemas";

const args = process.argv.slice(2);
const mode = args.includes("--db") ? "db" : args.includes("--live") ? "live" : null;
if (!mode) {
  console.error("Usage: node --import tsx scripts/verify-deployment-readiness.ts --db | --live <origin> [--expect-commit <sha>] [--expect-package <id>]");
  process.exit(2);
}
const flag = (name: string): string | null => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};

type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
function check(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name} — ${detail}`);
}

function migrationFiles(): string[] {
  return fs
    .readdirSync(path.join("db", "migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort();
}

async function dbMode() {
  const connectionString = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Set DATABASE_ADMIN_URL (or DATABASE_URL) for --db mode.");
    process.exit(2);
  }
  const pool = new pg.Pool({ connectionString });
  try {
    // 1. Every migration file applied.
    const files = migrationFiles();
    const applied = new Set(
      (
        await pool.query("SELECT name FROM schema_migrations")
      ).rows.map((r: any) => r.name as string),
    );
    const missing = files.filter((f) => !applied.has(f));
    check(
      "migrations-applied",
      missing.length === 0,
      missing.length === 0
        ? `${files.length} migration files, all recorded in schema_migrations`
        : `missing from schema_migrations: ${missing.join(", ")} — run the migration step before sign-off`,
    );
    // 2. Canonical service versions published with matching hashes.
    const expected: Array<{ serviceNo: number; version: number; hash: string }> = [];
    for (const service of serviceCatalog) {
      for (const schema of [getCatalogPreviewSchema(service.service_no), ...allServiceSchemaVersions.filter((s) => s.serviceNo === service.service_no)]) {
        expected.push({
          serviceNo: schema.serviceNo,
          version: schema.version,
          hash: createHash("sha256").update(stableSchemaJson(schema)).digest("hex"),
        });
      }
    }
    const stored = new Map(
      (
        await pool.query("SELECT service_no, version, schema_hash FROM service_versions")
      ).rows.map((r: any) => [`${r.service_no}:${r.version}`, r.schema_hash as string]),
    );
    const absent = expected.filter((e) => !stored.has(`${e.serviceNo}:${e.version}`));
    const mismatched = expected.filter((e) => stored.get(`${e.serviceNo}:${e.version}`) && stored.get(`${e.serviceNo}:${e.version}`) !== e.hash);
    check(
      "service-versions-published",
      absent.length === 0 && mismatched.length === 0,
      absent.length || mismatched.length
        ? [
            ...(absent.length ? [`${absent.length} canonical versions absent (e.g. service ${absent[0].serviceNo} v${absent[0].version}) — run db:initialize-cpanel`] : []),
            ...(mismatched.length ? [`${mismatched.length} hash mismatches (e.g. service ${mismatched[0].serviceNo} v${mismatched[0].version}) — publish a reconcile migration, never edit service_versions by hand`] : []),
          ].join("; ")
        : `${expected.length} canonical schema versions published with matching hashes`,
    );
    // 3. Service catalog complete.
    const services = (await pool.query("SELECT count(*)::int AS n FROM service_catalog")).rows[0].n as number;
    check("service-catalog", services === 47, `${services}/47 services in service_catalog`);
    // 4. Owner account exists.
    const owners = (await pool.query("SELECT count(*)::int AS n FROM platform_users WHERE platform_role='owner'")).rows[0].n as number;
    check("owner-account", owners >= 1, `${owners} platform owner account(s)`);
    // 5. S-012: tenant isolation is actually enforced by the database, not
    //    just by application WHERE clauses. Migration 055 scope-gates the
    //    definer policies; without it, any office-scoped request could read
    //    other offices' applications/certificates/attachments. This is the
    //    same assertion the API suite runs (tenant-isolation-055.test.ts),
    //    against whichever database this script is pointed at.
    const isolationTables = [
      "applications",
      "certificates",
      "citizens",
      "attachments",
      "point_wallets",
      "tenant_service_configuration",
      "notices",
      "password_recovery_tokens",
      "application_refunds",
      "point_ledger",
      "service_order_policies",
      "application_order_snapshots",
      "audit_events",
    ];
    const migration055 = (
      await pool.query("SELECT 1 FROM schema_migrations WHERE name=$1", [
        "055_definer_read_scope_and_verify_holder.sql",
      ])
    ).rowCount;
    const flags = (
      await pool.query(
        "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1)",
        [isolationTables],
      )
    ).rows as Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>;
    const unforced = flags.filter((r) => !r.relrowsecurity || !r.relforcerowsecurity).map((r) => r.relname);
    const missingTables = isolationTables.filter((t) => !flags.some((r) => r.relname === t));
    const openDefiner = (
      await pool.query(
        `SELECT policyname FROM pg_policies WHERE policyname IN
         ('public_definer_owner_read','definer_operations_read','callback_owner_read',
          'definer_ledger_read','definer_wallet_maintenance','definer_queue_read',
          'definer_office_info_read') AND (qual = 'true' OR qual NOT LIKE '%astra.tenant_id%')`,
      )
    ).rows as Array<{ policyname: string }>;
    const isolationOk =
      migration055 === 1 &&
      missingTables.length === 0 &&
      unforced.length === 0 &&
      openDefiner.length === 0;
    check(
      "tenant-isolation-rls",
      isolationOk,
      isolationOk
        ? `migration 055 applied; RLS + FORCE RLS on ${flags.length} tenant tables; all definer policies scope-gated`
        : [
            ...(migration055 !== 1 ? ["migration 055 NOT recorded in schema_migrations — tenant isolation is pre-055"] : []),
            ...(missingTables.length ? [`tables missing: ${missingTables.join(", ")}`] : []),
            ...(unforced.length ? [`RLS/FORCE RLS missing on: ${unforced.join(", ")}`] : []),
            ...(openDefiner.length ? [`definer policies not scope-gated: ${[...new Set(openDefiner.map((r) => r.policyname))].join(", ")}`] : []),
          ].join("; "),
    );
  } finally {
    await pool.end();
  }
}

async function liveMode() {
  const origin = flag("--live")!;
  const base = new URL(origin);
  if (base.protocol !== "https:" && base.hostname !== "127.0.0.1") {
    console.error("--live requires an https:// origin (127.0.0.1 allowed for local checks).");
    process.exit(2);
  }
  const expectCommit = flag("--expect-commit");
  const expectPackage = flag("--expect-package");
  const latestMigration = migrationFiles().at(-1) ?? null;

  const healthRes = await fetch(`${base.origin}/api/v1/health`);
  let health: any = null;
  try {
    health = await healthRes.json();
  } catch {
    health = null;
  }
  check(
    "live-health",
    healthRes.status === 200 && health?.status === "ok" && health?.database === "PostgreSQL",
    `HTTP ${healthRes.status}, status=${health?.status ?? "unparseable"}, database=${health?.database ?? "?"}`,
  );
  if (health?.release) {
    check(
      "live-release-commit",
      !expectCommit || health.release.commit === expectCommit,
      expectCommit ? `reported commit ${health.release.commit ?? "null"}, expected ${expectCommit}` : `reported commit ${health.release.commit ?? "null"} (no --expect-commit given)`,
    );
    check(
      "live-release-package",
      !expectPackage || health.release.packageId === expectPackage,
      expectPackage ? `reported package ${health.release.packageId ?? "null"}, expected ${expectPackage}` : `reported package ${health.release.packageId ?? "null"} (no --expect-package given)`,
    );
    check(
      "live-migration-version",
      !latestMigration || health.release.migrationVersion === latestMigration,
      `reported migration ${health.release.migrationVersion ?? "null"}, latest file ${latestMigration}`,
    );
  } else {
    check("live-release-commit", false, "health response carries no release object — the deployment predates A-002 or is not this app");
    check("live-release-package", false, "health response carries no release object");
    check("live-migration-version", false, "health response carries no release object");
  }

  const homeRes = await fetch(`${base.origin}/`, { headers: { Accept: "text/html" } });
  const homeText = await homeRes.text();
  check(
    "live-homepage-shell",
    homeRes.status === 200 && homeText.includes('id="root"'),
    homeRes.status === 200
      ? homeText.includes('id="root"')
        ? "homepage returns the real app shell"
        : "HTTP 200 but no app shell (id=\"root\" absent) — the response is not the app, e.g. a bot-challenge page"
      : `HTTP ${homeRes.status}`,
  );

  const servicesRes = await fetch(`${base.origin}/api/v1/services`);
  let services: any = null;
  try {
    services = await servicesRes.json();
  } catch {
    services = null;
  }
  check(
    "live-services",
    servicesRes.status === 200 && Array.isArray(services?.items) && services.items.length === 47,
    `HTTP ${servicesRes.status}, ${services?.items?.length ?? "?"} services`,
  );

  const schemaRes = await fetch(`${base.origin}/api/v1/services/1/schema`);
  const schemaText = await schemaRes.text();
  check(
    "live-schema-published",
    schemaRes.status === 200,
    schemaRes.status === 200
      ? "service 1 schema resolves (initialization published it)"
      : `HTTP ${schemaRes.status} ${schemaText.slice(0, 120)} — ${schemaRes.status === 422 ? "SCHEMA_UNAVAILABLE recurrence: run db:initialize-cpanel on the server" : "schema endpoint not serving"}`,
  );

  // S-008: plain HTTP must never serve the app. 301/308 to https:// is the
  // edge redirect; 421 is the app failing closed when the proxy omits
  // X-Forwarded-Proto (strict mode) — still safe, but turn on cPanel Force
  // HTTPS Redirect so the edge redirects instead of the app refusing.
  let plainStatus = 0;
  let plainLocation = "";
  try {
    const plainRes = await fetch(`http://${base.host}/login`, {
      redirect: "manual",
    });
    plainStatus = plainRes.status;
    plainLocation = plainRes.headers.get("location") ?? "";
  } catch (error) {
    plainStatus = 0;
    plainLocation = `fetch failed: ${(error as Error).message}`;
  }
  const plainRedirects =
    [301, 308].includes(plainStatus) && plainLocation.startsWith("https://");
  check(
    "live-plain-http-redirect",
    plainRedirects || plainStatus === 421,
    plainRedirects
      ? `HTTP ${plainStatus} to ${plainLocation} — plain HTTP redirects to HTTPS`
      : plainStatus === 421
        ? "HTTP 421 — app refuses plain HTTP without X-Forwarded-Proto (S-008 strict mode, fail-closed); turn on cPanel Force HTTPS Redirect so the edge redirects instead"
        : plainStatus === 0
          ? `${plainLocation} — could not reach plain HTTP at all; verify the domain answers on port 80 and re-check`
          : `HTTP ${plainStatus} — plain HTTP serves the app; credentials could travel in cleartext. Turn on cPanel Force HTTPS Redirect and re-check`,
  );
}

await (mode === "db" ? dbMode() : liveMode());
const failed = checks.filter((c) => !c.pass);
console.log(JSON.stringify({ mode, passed: checks.length - failed.length, failed: failed.length, checks }, null, 2));
if (failed.length) {
  console.error(`\nDeployment readiness FAILED: ${failed.length}/${checks.length} checks failed. Do not sign off this deployment.`);
  process.exit(1);
}
console.log(`\nDeployment readiness PASS: ${checks.length}/${checks.length} checks passed.`);
