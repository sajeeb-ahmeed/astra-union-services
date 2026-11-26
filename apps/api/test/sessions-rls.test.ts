// A-013 step 2 (migration 082): row-level security on `sessions`, exercised as
// the restricted runtime role (DATABASE_URL / astra_app), not the owner.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { app } from "../src/app.js";
import { pool } from "../src/db.js";
import { digest } from "../src/security.js";

let server: ReturnType<typeof app.listen>, base: string;
const appRole = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
async function login(email: string) {
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Demo-Phase1!" }),
  });
  assert.equal(r.status, 200);
  const cookie = r.headers.get("set-cookie")!.split(";")[0];
  const me = await (await fetch(`${base}/api/v1/auth/me`, { headers: { Cookie: cookie } })).json();
  return { cookie, hash: digest(cookie.slice(cookie.indexOf("=") + 1)), userId: me.user.id as string };
}
/** Run statements as astra_app in one transaction acting as `userId` (or nobody). */
async function asRuntime<T>(userId: string | null, fn: (c: pg.PoolClient) => Promise<T>) {
  const c = await appRole.connect();
  try {
    await c.query("BEGIN");
    if (userId) await c.query("SELECT set_config('astra.user_id',$1,true)", [userId]);
    return await fn(c);
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
}
let a: Awaited<ReturnType<typeof login>>, b: Awaited<ReturnType<typeof login>>;
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  a = await login("admin@alpha.local.test");
  b = await login("citizen@alpha.local.test");
});
after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await appRole.end();
  await pool.end();
});

test("A-013 sessions RLS: the policy is in place and forced", async () => {
  const r = (
    await asRuntime(null, (c) =>
      c.query("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='sessions'"),
    )
  ).rows[0];
  assert.deepEqual(r, { relrowsecurity: true, relforcerowsecurity: true });
});

test("A-013 sessions RLS: without an acting user the runtime role sees no session at all", async () => {
  const n = (await asRuntime(null, (c) => c.query("SELECT count(*)::int n FROM sessions"))).rows[0].n;
  assert.equal(n, 0);
});

test("A-013 sessions RLS: user A cannot read, expire or create user B's sessions", async () => {
  await asRuntime(a.userId, async (c) => {
    const own = (await c.query("SELECT count(*)::int n FROM sessions WHERE token_hash=$1", [a.hash])).rows[0].n;
    assert.equal(own, 1, "A sees A's own session");
    const foreign = (await c.query("SELECT count(*)::int n FROM sessions WHERE user_id=$1", [b.userId])).rows[0].n;
    assert.equal(foreign, 0, "A cannot read B's sessions");
    const expired = await c.query("UPDATE sessions SET expires_at=now() WHERE token_hash=$1", [b.hash]);
    assert.equal(expired.rowCount, 0, "A cannot expire B's session");
    await assert.rejects(
      c.query(
        "INSERT INTO sessions(token_hash,user_id,tenant_id,csrf_token,expires_at) VALUES('x'||gen_random_uuid(),$1,NULL,'csrf',now()+interval '1 hour')",
        [b.userId],
      ),
      /row-level security/,
      "A cannot create a session for B",
    );
  });
  // B's session is untouched and still works.
  const me = await fetch(`${base}/api/v1/auth/me`, { headers: { Cookie: b.cookie } });
  assert.equal((await me.json()).user.id, b.userId);
});

test("A-013 sessions RLS: auth_resolve_session finds exactly the cookie's session and lowers its flag", async () => {
  await asRuntime(null, async (c) => {
    const rows = (await c.query("SELECT * FROM auth_resolve_session($1)", [a.hash])).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_id, a.userId);
    assert.equal(rows[0].token_hash, undefined, "the token hash is not returned");
    assert.equal((await c.query("SELECT * FROM auth_resolve_session($1)", ["0".repeat(64)])).rowCount, 0);
    // The flag does not outlive the lookup: a direct read in the same
    // transaction still sees nothing.
    assert.equal((await c.query("SELECT current_setting('astra.resolve_session', true) v")).rows[0].v, "off");
    assert.equal((await c.query("SELECT count(*)::int n FROM sessions")).rows[0].n, 0);
  });
});
