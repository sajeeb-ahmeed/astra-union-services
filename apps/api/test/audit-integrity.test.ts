import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { connectionString, pool } from "../src/db.js";

test("AUDIT-INTEGRITY: NOT NULL validation detects hidden legacy rows without weakening forced RLS or rewriting data", async () => {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    const role = (
      await client.query(
        "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
      )
    ).rows[0];
    assert.equal(role.rolsuper, false);
    assert.equal(role.rolbypassrls, false);
    // Temporary relations are owned by the same non-bypass role, matching the
    // hosted migration owner's FORCE RLS behavior without touching real audit data.
    await client.query(
      "CREATE TEMP TABLE audit_integrity_probe(tenant_id uuid,marker text) ON COMMIT DROP",
    );
    const tenantId = randomUUID();
    await client.query(
      "INSERT INTO audit_integrity_probe VALUES(NULL,'legacy hidden'),($1,'scoped')",
      [tenantId],
    );
    await client.query(
      "ALTER TABLE audit_integrity_probe ENABLE ROW LEVEL SECURITY",
    );
    await client.query(
      "ALTER TABLE audit_integrity_probe FORCE ROW LEVEL SECURITY",
    );
    await client.query(
      "CREATE POLICY tenant_scope ON audit_integrity_probe USING(tenant_id=nullif(current_setting('astra.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('astra.tenant_id',true),'')::uuid)",
    );
    await client.query("SELECT set_config('astra.tenant_id',$1,true)", [
      tenantId,
    ]);
    assert.equal(
      (
        await client.query(
          "SELECT count(*)::int AS n FROM audit_integrity_probe",
        )
      ).rows[0].n,
      1,
    );
    const sql = fs
      .readFileSync("db/migrations/014_audit_tenant_integrity.sql", "utf8")
      .replaceAll("audit_events", "pg_temp.audit_integrity_probe");
    await client.query("SAVEPOINT validation");
    await assert.rejects(
      client.query(sql),
      (error: any) => error.code === "23502",
    );
    await client.query("ROLLBACK TO SAVEPOINT validation");
    const state = (
      await client.query(
        "SELECT c.relrowsecurity,c.relforcerowsecurity,a.attnotnull FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid WHERE c.oid='pg_temp.audit_integrity_probe'::regclass AND a.attname='tenant_id'",
      )
    ).rows[0];
    assert.deepEqual(state, {
      relrowsecurity: true,
      relforcerowsecurity: true,
      attnotnull: false,
    });
    assert.equal(
      (await client.query("SELECT marker FROM audit_integrity_probe")).rows[0]
        .marker,
      "scoped",
    );

    await client.query(
      "CREATE TEMP TABLE audit_integrity_valid(tenant_id uuid,marker text) ON COMMIT DROP",
    );
    await client.query(
      "INSERT INTO audit_integrity_valid VALUES($1,'preserved')",
      [tenantId],
    );
    await client.query(
      "ALTER TABLE audit_integrity_valid ENABLE ROW LEVEL SECURITY",
    );
    await client.query(
      "ALTER TABLE audit_integrity_valid FORCE ROW LEVEL SECURITY",
    );
    await client.query(
      "CREATE POLICY tenant_scope ON audit_integrity_valid USING(tenant_id=nullif(current_setting('astra.tenant_id',true),'')::uuid)",
    );
    await client.query(
      sql.replaceAll("audit_integrity_probe", "audit_integrity_valid"),
    );
    assert.equal(
      (
        await client.query(
          "SELECT attnotnull FROM pg_attribute WHERE attrelid='pg_temp.audit_integrity_valid'::regclass AND attname='tenant_id'",
        )
      ).rows[0].attnotnull,
      true,
    );
    assert.deepEqual(
      (await client.query("SELECT * FROM audit_integrity_valid")).rows,
      [{ tenant_id: tenantId, marker: "preserved" }],
    );
  } finally {
    await client.query("ROLLBACK");
    await client.end();
    await pool.end();
  }
});
