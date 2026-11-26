// A-009: GET /auth/me is ONE handler with explicit auth branching (it used to
// be two handlers whose behaviour depended on mount order). Pins both
// response shapes and the cases between them.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.js";
import { pool } from "../src/db.js";
import { sessionCookieName } from "../src/session-hygiene.js";

let server: ReturnType<typeof app.listen>, base: string;
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});
async function me(cookie?: string, path = "/api/v1/auth/me") {
  const r = await fetch(`${base}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
  return { status: r.status, body: await r.json() };
}
const anonymous = { user: null, tenant: null, csrfToken: null, anonymous: true };

test("A-009: /auth/me without a session cookie answers anonymously (200), including an empty cookie value and a case variant", async () => {
  assert.deepEqual(await me(), { status: 200, body: anonymous });
  assert.deepEqual(await me(`${sessionCookieName()}=`), { status: 200, body: anonymous });
  assert.deepEqual(await me("unrelated=1"), { status: 200, body: anonymous });
  assert.deepEqual(await me(undefined, "/api/v1/AUTH/ME"), { status: 200, body: anonymous });
});

test("A-009: /auth/me with an invalid session cookie still 401s (client session-drop depends on it)", async () => {
  const r = await me(`${sessionCookieName()}=${"a".repeat(64)}`);
  assert.equal(r.status, 401);
  assert.equal(r.body.error.code, "SESSION_INACTIVE");
});

test("A-009: /auth/me with a valid session returns the signed-in caller; other cookie-less routes still 401", async () => {
  const login = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@alpha.local.test", password: "Demo-Phase1!" }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const r = await me(cookie);
  assert.equal(r.status, 200);
  assert.equal(r.body.user.email, "admin@alpha.local.test");
  assert.equal(r.body.user.role, "admin");
  assert.ok(r.body.tenant?.id, "tenant record");
  assert.ok(r.body.csrfToken);
  assert.equal(r.body.anonymous, undefined);
  // The anonymous pass-through is ONLY for GET /auth/me.
  assert.equal((await fetch(`${base}/api/v1/applications`)).status, 401);
  assert.equal((await fetch(`${base}/api/v1/auth/logout`, { method: "POST" })).status === 200, false);
});
