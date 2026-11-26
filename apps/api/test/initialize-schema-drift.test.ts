// A-006: scripts/initialize.ts must tolerate a changed catalog PREVIEW row
// (version 0, regenerated every release) but still fail closed on real drift
// (a published v1+ row whose stored hash no longer matches the code).
// Runs against its own throwaway database so the shared test seed is untouched.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import pg from "pg";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const dbName = `astra_a006_${randomBytes(4).toString("hex")}`;

function urlFor(db: string) {
  const u = new URL(adminUrl!);
  u.pathname = `/${db}`;
  return u.toString();
}

function run(script: string, env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, ["--import", "tsx", script], {
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 300_000,
  });
}

test("A-006: initialize refreshes an unpinned v0 preview row and still rejects v1+ drift", { skip: !adminUrl }, async () => {
  const root = new pg.Client({ connectionString: adminUrl });
  await root.connect();
  await root.query(`CREATE DATABASE ${dbName}`);
  const env = {
    DATABASE_ADMIN_URL: urlFor(dbName),
    OWNER_EMAIL: "a006-owner@example.test",
    OWNER_PASSWORD: randomBytes(18).toString("base64url"),
  };
  const db = new pg.Client({ connectionString: env.DATABASE_ADMIN_URL });
  try {
    const migrate = run("scripts/migrate.ts", env);
    assert.equal(migrate.status, 0, migrate.stderr);
    const first = run("scripts/initialize.ts", env);
    assert.equal(first.status, 0, first.stderr);
    await db.connect();
    const expected = (
      await db.query("SELECT schema_hash FROM service_versions WHERE service_no=1 AND version=0")
    ).rows[0].schema_hash;
    // Simulate a release that changed the preview: the stored v0 row is now stale.
    const tamper = async (version: number) => {
      await db.query("ALTER TABLE service_versions DISABLE TRIGGER immutable");
      await db.query(
        "UPDATE service_versions SET schema_hash=repeat('0',64) WHERE service_no=1 AND version=$1",
        [version],
      );
      await db.query("ALTER TABLE service_versions ENABLE TRIGGER immutable");
    };
    await tamper(0);
    const second = run("scripts/initialize.ts", env);
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /Refreshed catalog preview schema for service 1 \(version 0/);
    const refreshed = (
      await db.query("SELECT schema_hash FROM service_versions WHERE service_no=1 AND version=0")
    ).rows[0].schema_hash;
    assert.equal(refreshed, expected, "v0 preview row restored to the code's schema");
    // The immutability trigger is back on after the refresh.
    const trigger = (
      await db.query(
        "SELECT tgenabled FROM pg_trigger WHERE tgrelid='service_versions'::regclass AND tgname='immutable'",
      )
    ).rows[0].tgenabled;
    assert.equal(trigger, "O", "immutable trigger re-enabled");
    // A published version (v1) that drifted is real drift: still fail closed.
    const v1 = (
      await db.query("SELECT 1 FROM service_versions WHERE service_no=1 AND version=1")
    ).rowCount;
    if (v1) {
      await tamper(1);
      const third = run("scripts/initialize.ts", env);
      assert.notEqual(third.status, 0, "v1 drift must abort initialization");
      assert.match(third.stderr, /Service 1 version 1 is immutable/);
    }
  } finally {
    await db.end().catch(() => {});
    await root.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await root.end();
  }
});
