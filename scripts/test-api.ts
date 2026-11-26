/**
 * T-003 + Stage 0 "non-idempotent test:api": run the API suite against a
 * DISPOSABLE database so every run starts from the same fresh seed.
 *
 * Test tenants carry append-only audit_events, and deleting them would need
 * the audit-immutability trigger disabled (refused — never weaken it). So
 * instead of cleaning up, each run creates its own database, migrates and
 * seeds it, runs the suite against it, and drops the whole database. The
 * shared database named by DATABASE_URL is never written by the API suite,
 * so later suites (test:web) and the next test:api run see the pristine seed.
 *
 *   npm run test:api                         # disposable DB (default)
 *   npm run test:api -- apps/api/test/x.test.ts   # subset, still disposable
 *   TEST_API_SHARED_DB=true npm run test:api  # legacy: run on DATABASE_URL as is
 *   KEEP_TEST_DB=true npm run test:api        # keep the disposable DB for debugging
 *
 * Needs DATABASE_ADMIN_URL with CREATEDB (CI's admin user and local
 * superusers have it) and DATABASE_URL for the restricted astra_app role.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const appUrl = process.env.DATABASE_URL;
const args = process.argv.slice(2);
const files = args.length
  ? args
  : fs
      .readdirSync("apps/api/test")
      .filter((n) => n.endsWith(".test.ts"))
      .sort()
      .map((n) => path.join("apps/api/test", n));

function run(cmd: string[], env: NodeJS.ProcessEnv, label: string) {
  const r = spawnSync(process.execPath, cmd, { stdio: "inherit", env, windowsHide: true });
  if (r.status !== 0) throw Error(`${label} failed (exit ${r.status ?? r.signal}).`);
}
function suite(env: NodeJS.ProcessEnv): number {
  const r = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", "--test-concurrency=1", ...files],
    { stdio: "inherit", env, windowsHide: true },
  );
  return r.status ?? 1;
}
function withDatabase(url: string, db: string) {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

if (process.env.TEST_API_SHARED_DB === "true") {
  process.exitCode = suite(process.env);
} else {
  if (!adminUrl || !appUrl)
    throw Error(
      "test:api needs DATABASE_ADMIN_URL and DATABASE_URL (or TEST_API_SHARED_DB=true to use .runtime/postgres.json as before).",
    );
  const base = new URL(appUrl).pathname.slice(1) || "astra";
  const db = `${base}_api_${randomBytes(4).toString("hex")}`;
  if (!/^[a-z0-9_]+$/.test(db)) throw Error(`Refusing unsafe database name ${db}.`);
  const root = new pg.Client({ connectionString: adminUrl });
  await root.connect();
  await root.query(`CREATE DATABASE ${db}`);
  console.log(`test:api: disposable database ${db} (T-003 isolation)`);
  const env = {
    ...process.env,
    DATABASE_ADMIN_URL: withDatabase(adminUrl, db),
    DATABASE_URL: withDatabase(appUrl, db),
  };
  let code = 1;
  try {
    run(["--import", "tsx", "scripts/bootstrap-db.ts"], env, "bootstrap-role");
    run(["--import", "tsx", "scripts/migrate.ts"], env, "migrate");
    run(["scripts/decode-assets.mjs"], env, "decode-assets");
    run(["--import", "tsx", "scripts/seed.ts"], env, "seed");
    code = suite(env);
  } finally {
    if (process.env.KEEP_TEST_DB === "true") console.log(`test:api: kept ${db}`);
    else await root.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await root.end();
  }
  process.exitCode = code;
}
