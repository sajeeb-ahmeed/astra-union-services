/** Regression tests for the T-003 test-isolation reset.
 * Runs against the local test database (the same one the suites use):
 * it inserts a scratch order-policy row for tenant alpha / service 99
 * (a service no suite uses), runs the reset, and asserts the row is
 * gone. Guards are tested with no database access at all. */
import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { resetTestOrderPolicies } from "./reset-test-order-policies.js";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const appUrl = process.env.DATABASE_URL;

test("reset: refuses to run outside NODE_ENV=test", async () => {
  await assert.rejects(
    resetTestOrderPolicies({ NODE_ENV: "development", DATABASE_ADMIN_URL: adminUrl }),
    /TEST_RESET_REFUSED.*NODE_ENV=test/,
  );
});

test("reset: refuses a non-loopback database host", async () => {
  await assert.rejects(
    resetTestOrderPolicies({
      NODE_ENV: "test",
      DATABASE_ADMIN_URL:
        "postgresql://astra_admin:x@db.example.invalid:5432/astra",
    }),
    /TEST_RESET_REFUSED.*non-loopback/,
  );
});

test("reset: refuses to run with no database URL", async () => {
  await assert.rejects(
    resetTestOrderPolicies({ NODE_ENV: "test" }),
    /TEST_RESET_REFUSED.*DATABASE_ADMIN_URL/,
  );
});

test("reset: deletes test-created order policies and leaves the seed state", async (t) => {
  if (!adminUrl || !appUrl) t.skip("DATABASE_ADMIN_URL / DATABASE_URL not set");
  const db = new pg.Pool({ connectionString: adminUrl });
  try {
    // Start clean: a previous failed run may have left a scratch row.
    await resetTestOrderPolicies({
      NODE_ENV: "test",
      DATABASE_ADMIN_URL: adminUrl,
    });
    const tenant = (
      await db.query("SELECT id FROM tenants WHERE slug='alpha' LIMIT 1")
    ).rows[0];
    assert.ok(tenant, "seeded alpha tenant must exist");
    const creator = (
      await db.query(
        `SELECT u.id FROM platform_users u
         JOIN staff_memberships m ON m.user_id = u.id
         WHERE m.tenant_id = $1 LIMIT 1`,
        [tenant.id],
      )
    ).rows[0];
    assert.ok(creator, "seeded alpha user must exist");
    // Scratch row on a configured service (the FK requires a
    // tenant_service_configuration row): service 42, version 999 — a
    // version no suite publishes, so the assertions below target only it.
    await db.query(
      `INSERT INTO service_order_policies(tenant_id,service_no,version,statutory_fee_minor,processing_fee_minor,emergency_surcharge_minor,office_collection_fee_minor,digital_copy_fee_minor,delivery_modes,urgencies,reason,created_by,charter_days,required_documents)
       VALUES($1,42,999,0,0,0,0,0,ARRAY['office_collection'],'{normal}','T-003 reset regression scratch row',$2,NULL,'[]'::jsonb)`,
      [tenant.id, creator.id],
    );
    const before = (
      await db.query(
        "SELECT count(*)::int n FROM service_order_policies WHERE service_no=42 AND version=999",
      )
    ).rows[0].n as number;
    assert.equal(before, 1);
    const deleted = await resetTestOrderPolicies({
      NODE_ENV: "test",
      DATABASE_ADMIN_URL: adminUrl,
    });
    assert.ok(deleted >= 1, `expected at least the scratch row deleted, got ${deleted}`);
    const after = (
      await db.query(
        "SELECT count(*)::int n FROM service_order_policies WHERE service_no=42 AND version=999",
      )
    ).rows[0].n as number;
    assert.equal(after, 0);
    // The reset is idempotent: a second run deletes nothing.
    assert.equal(
      await resetTestOrderPolicies({ NODE_ENV: "test", DATABASE_ADMIN_URL: adminUrl }),
      0,
    );
    // The append-only trigger is left enabled: a direct DELETE must raise.
    await db.query(
      `INSERT INTO service_order_policies(tenant_id,service_no,version,statutory_fee_minor,processing_fee_minor,emergency_surcharge_minor,office_collection_fee_minor,digital_copy_fee_minor,delivery_modes,urgencies,reason,created_by,charter_days,required_documents)
       VALUES($1,42,999,0,0,0,0,0,ARRAY['office_collection'],'{normal}','T-003 trigger check',$2,NULL,'[]'::jsonb)`,
      [tenant.id, creator.id],
    );
    await assert.rejects(
      db.query("DELETE FROM service_order_policies WHERE version=999"),
      /Append-only record/,
    );
    // Clean the scratch row via the reset itself.
    assert.equal(
      await resetTestOrderPolicies({ NODE_ENV: "test", DATABASE_ADMIN_URL: adminUrl }),
      1,
    );
  } finally {
    await db.end();
  }
});
