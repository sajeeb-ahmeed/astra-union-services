import test from "node:test";
import assert from "node:assert/strict";
import { getDemoPayload } from "@astra/shared-schemas";
import { app } from "../src/app.js";
import { pool } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";

/**
 * Phase 5 (5A): session/CSRF integrity.
 *
 * The live failure (17 Nov E2E campaign): in one browser used for several accounts, an open
 * tab's requests started failing with CSRF_REQUIRED / LOGIN_REQUIRED / ROLE_DENIED, sign-out
 * clicks did nothing, and the sidebar later showed a different account. The server contract
 * behind it is pinned here: a session's CSRF token is bound to that session alone, a stale
 * token is rejected, /auth/me always reports the session the cookie actually holds (the
 * resync source the web client now uses), and ending one session never touches another.
 * The long single-account campaign pattern is pinned too: one citizen session submitting
 * many applications in sequence must never degrade.
 */

type Session = { cookie: string; csrf: string; user: any };
let server: ReturnType<typeof app.listen>, base: string;
const password = "Demo-Phase1!";

test.before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}/api/v1`;
});
test.after(async () => {
  server?.close();
  await closePdfBrowser().catch(() => {});
  await pool.end();
});

async function request(
  method: string,
  path: string,
  opts: { cookie?: string; csrf?: string; body?: unknown } = {},
) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(opts.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
      ...(opts.cookie ? { Cookie: opts.cookie } : {}),
      ...(opts.csrf ? { "X-CSRF-Token": opts.csrf } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => ({})),
    setCookie: response.headers.get("set-cookie") ?? "",
  };
}
async function login(email: string): Promise<Session> {
  const r = await request("POST", "/auth/login", { body: { email, password } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return {
    cookie: r.setCookie.split(";")[0],
    csrf: r.body.csrfToken,
    user: r.body.user,
  };
}

test("campaign pattern: one citizen session submits many applications in sequence, identity stable, sign-out works", async () => {
  const citizen = await login("citizen@alpha.local.test");
  const own = await request("GET", "/citizens", citizen);
  assert.equal(own.status, 200);
  const citizenId = own.body.items[0].id;
  assert.ok(citizenId);
  // The 47-service campaign pattern, reduced to a representative spread: create + submit in
  // sequence, ordinary navigation interleaved, identity checked throughout.
  for (const serviceNo of [45, 1, 12, 30, 47, 23]) {
    const created = await request("POST", "/applications", {
      ...citizen,
      body: {
        citizenId,
        serviceNo,
        payload: getDemoPayload(serviceNo),
      },
    });
    assert.equal(created.status, 201, `service ${serviceNo}: ${JSON.stringify(created.body)}`);
    const submitted = await request(
      "POST",
      `/applications/${created.body.id}/transition`,
      { ...citizen, body: { action: "submit" } },
    );
    assert.equal(submitted.status, 200, `submit service ${serviceNo}`);
    const me = await request("GET", "/auth/me", citizen);
    assert.equal(me.status, 200, `me after service ${serviceNo}: ${JSON.stringify(me.body)}`);
    assert.equal(me.body.user.id, citizen.user.id);
    assert.equal(me.body.csrfToken, citizen.csrf);
    const list = await request("GET", "/applications?pageSize=5", citizen);
    assert.equal(list.status, 200);
  }
  const out = await request("POST", "/auth/logout", citizen);
  assert.equal(out.status, 200);
  const meAfter = await request("GET", "/auth/me", citizen);
  assert.equal(meAfter.status, 401);
});

test("cross-session: a stale token is rejected, /auth/me resyncs the current session, and only that session ends", async () => {
  const citizen = await login("citizen@alpha.local.test");
  const staff = await login("staff@alpha.local.test");
  // The broken-tab state from the live campaign: the browser cookie now holds the staff
  // session while the open tab still sends the citizen session's CSRF token.
  const stale = await request("POST", "/auth/logout", {
    cookie: staff.cookie,
    csrf: citizen.csrf,
  });
  assert.equal(stale.status, 403);
  assert.equal(stale.body.error.code, "CSRF_REQUIRED");
  // CSRF validation is not weakened for any other route either.
  const stalePost = await request("POST", "/applications", {
    cookie: staff.cookie,
    csrf: citizen.csrf,
    body: { citizenId: "00000000-0000-0000-0000-000000000000", serviceNo: 45, payload: {} },
  });
  assert.equal(stalePost.status, 403);
  assert.equal(stalePost.body.error.code, "CSRF_REQUIRED");
  // The resync source: /auth/me reports the session the cookie actually holds.
  const me = await request("GET", "/auth/me", { cookie: staff.cookie });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.id, staff.user.id);
  assert.equal(me.body.csrfToken, staff.csrf);
  // With the resynced pair the current session can be ended — sign-out works again.
  const out = await request("POST", "/auth/logout", {
    cookie: staff.cookie,
    csrf: me.body.csrfToken,
  });
  assert.equal(out.status, 200);
  assert.equal((await request("GET", "/auth/me", { cookie: staff.cookie })).status, 401);
  // The other account's session (another browser) is untouched by all of this.
  const citizenMe = await request("GET", "/auth/me", citizen);
  assert.equal(citizenMe.status, 200);
  assert.equal(citizenMe.body.user.id, citizen.user.id);
});

test("two sessions of one user: cross-pairing is rejected and ending one leaves the other alive", async () => {
  const first = await login("citizen@alpha.local.test");
  const second = await login("citizen@alpha.local.test");
  assert.notEqual(first.csrf, second.csrf);
  assert.notEqual(first.cookie, second.cookie);
  const cross = await request("POST", "/auth/logout", {
    cookie: second.cookie,
    csrf: first.csrf,
  });
  assert.equal(cross.status, 403);
  assert.equal(cross.body.error.code, "CSRF_REQUIRED");
  const out = await request("POST", "/auth/logout", second);
  assert.equal(out.status, 200);
  assert.equal((await request("GET", "/auth/me", second)).status, 401);
  const firstMe = await request("GET", "/auth/me", first);
  assert.equal(firstMe.status, 200);
  assert.equal(firstMe.body.user.id, first.user.id);
});
