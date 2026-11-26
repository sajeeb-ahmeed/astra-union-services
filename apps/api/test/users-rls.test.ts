// A-013 step 3 (migration 083): row-level security on platform_users, exercised
// as the restricted runtime role (DATABASE_URL / astra_app), not the owner.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { adminConnectionString, pool } from "../src/db.js";

const appRole = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const admin = new pg.Pool({ connectionString: adminConnectionString, max: 2 });
let alphaTenant: string, betaTenant: string;
let alphaAdmin: string, alphaCitizen: string, betaStaff: string;

/** One rolled-back transaction as astra_app with the given context. */
async function asRuntime<T>(
  ctx: { userId?: string; tenantId?: string; newUserId?: string },
  fn: (c: pg.PoolClient) => Promise<T>,
) {
  const c = await appRole.connect();
  try {
    await c.query("BEGIN");
    if (ctx.userId) await c.query("SELECT set_config('astra.user_id',$1,true)", [ctx.userId]);
    if (ctx.tenantId) await c.query("SELECT set_config('astra.tenant_id',$1,true)", [ctx.tenantId]);
    if (ctx.newUserId) await c.query("SELECT set_config('astra.new_user_id',$1,true)", [ctx.newUserId]);
    return await fn(c);
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
}
const id = async (email: string) =>
  (await admin.query("SELECT id FROM platform_users WHERE email=$1", [email])).rows[0].id as string;

before(async () => {
  alphaTenant = (await admin.query("SELECT id FROM tenants WHERE slug='alpha'")).rows[0].id;
  betaTenant = (await admin.query("SELECT id FROM tenants WHERE slug='beta'")).rows[0].id;
  alphaAdmin = await id("admin@alpha.local.test");
  alphaCitizen = await id("citizen@alpha.local.test");
  betaStaff = await id("staff@beta.local.test");
});
after(async () => {
  await appRole.end();
  await admin.end();
  await pool.end();
});

test("A-013 users RLS: the policies are in place and forced", async () => {
  const r = (
    await asRuntime({}, (c) =>
      c.query("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='platform_users'"),
    )
  ).rows[0];
  assert.deepEqual(r, { relrowsecurity: true, relforcerowsecurity: true });
});

test("A-013 users RLS: no context sees no account; an acting user sees only itself", async () => {
  assert.equal((await asRuntime({}, (c) => c.query("SELECT count(*)::int n FROM platform_users"))).rows[0].n, 0);
  await asRuntime({ userId: alphaAdmin }, async (c) => {
    const rows = (await c.query("SELECT id FROM platform_users")).rows.map((r) => r.id);
    assert.deepEqual(rows, [alphaAdmin], "only the acting user's own row");
    assert.equal(
      (await c.query("SELECT count(*)::int n FROM platform_users WHERE id=$1", [betaStaff])).rows[0].n,
      0,
      "no other account, not even by id",
    );
  });
});

test("A-013 users RLS: inside an office, that office's members are visible and other offices' are not", async () => {
  await asRuntime({ userId: alphaAdmin, tenantId: alphaTenant }, async (c) => {
    const visible = (await c.query("SELECT id FROM platform_users WHERE id = ANY($1)", [[alphaCitizen, betaStaff]])).rows.map((r) => r.id);
    assert.deepEqual(visible, [alphaCitizen], "alpha's citizen yes, beta's staff no");
    assert.equal(
      (await c.query("SELECT password_hash FROM platform_users WHERE id=$1", [betaStaff])).rowCount,
      0,
      "another office's password hash is unreadable",
    );
  });
});

test("A-013 users RLS: a visible member can be locked but not changed; only the acting user's own row can be", async () => {
  await asRuntime({ userId: alphaAdmin, tenantId: alphaTenant }, async (c) => {
    // Admin recovery locks the target account: allowed (UPDATE policy USING).
    assert.equal((await c.query("SELECT id FROM platform_users WHERE id=$1 FOR UPDATE", [alphaCitizen])).rowCount, 1);
    await c.query("SAVEPOINT s");
    await assert.rejects(
      c.query("UPDATE platform_users SET display_name='changed by another user' WHERE id=$1", [alphaCitizen]),
      /row-level security/,
      "changing another account is refused (WITH CHECK)",
    );
    await c.query("ROLLBACK TO SAVEPOINT s");
    const own = await c.query("UPDATE platform_users SET display_name=display_name WHERE id=$1", [alphaAdmin]);
    assert.equal(own.rowCount, 1, "the acting user's own row can be written");
    const foreign = await c.query("UPDATE platform_users SET display_name='x' WHERE id=$1", [betaStaff]);
    assert.equal(foreign.rowCount, 0, "another office's account is not even matched");
  });
});

test("A-013 users RLS: an account can be created only under the declared new id", async () => {
  const declared = randomUUID();
  await asRuntime({}, async (c) => {
    await assert.rejects(
      c.query("INSERT INTO platform_users(id,email,display_name,password_hash) VALUES($1,$2,'x','x')", [randomUUID(), `${randomUUID()}@rls.synthetic.test`]),
      /row-level security/,
    );
  });
  await asRuntime({ newUserId: declared }, async (c) => {
    const ok = await c.query("INSERT INTO platform_users(id,email,display_name,password_hash) VALUES($1,$2,'x','x')", [declared, `${randomUUID()}@rls.synthetic.test`]);
    assert.equal(ok.rowCount, 1);
  });
});

test("A-013 users RLS: the lookup functions answer narrowly and lower their flag", async () => {
  await asRuntime({}, async (c) => {
    assert.equal((await c.query("SELECT auth_user_id_by_email($1) id", ["admin@alpha.local.test"])).rows[0].id, alphaAdmin);
    assert.equal((await c.query("SELECT auth_user_id_by_email($1) id", ["nobody@rls.synthetic.test"])).rows[0].id, null);
    assert.equal((await c.query("SELECT auth_email_taken($1) t", ["ADMIN@alpha.local.test"])).rows[0].t, true, "case-insensitive");
    assert.equal((await c.query("SELECT auth_email_taken($1) t", ["nobody@rls.synthetic.test"])).rows[0].t, false);
    assert.equal((await c.query("SELECT current_setting('astra.identity_lookup', true) v")).rows[0].v, "off");
    assert.equal((await c.query("SELECT count(*)::int n FROM platform_users")).rows[0].n, 0, "nothing leaks after the lookups");
  });
});
