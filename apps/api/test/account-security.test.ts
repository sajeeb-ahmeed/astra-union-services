import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { digest, hashPassword, randomToken } from "../src/security.js";
import {
  logMailProvider,
  setMailProvider,
  type MailMessage,
} from "../src/mailer.js";

const db = new pg.Pool({ connectionString: adminConnectionString });
const password = "Synth-Security-P1!";
const run = randomUUID().slice(0, 8);
let server: ReturnType<typeof app.listen>, base: string;
let tenantId: string, otherTenantId: string, officeAdmin: Session;
type Session = { cookie: string; csrf: string; user: any };
async function request(
  method: string,
  path: string,
  data?: unknown,
  session?: Session,
  headers: Record<string, string> = {},
) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      ...(session
        ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf }
        : {}),
      ...headers,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json(),
  };
}
async function login(email: string, secret = password): Promise<Session> {
  const response = await request("POST", "/auth/login", {
    email,
    password: secret,
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return {
    cookie: response.headers.get("set-cookie")!.split(";")[0]!,
    csrf: response.body.csrfToken,
    user: response.body.user,
  };
}
async function user(name: string, office = tenantId, role = "citizen") {
  const email = `${name}-${run}@security.synthetic.test`;
  const id = (
    await db.query(
      "INSERT INTO platform_users(email,display_name,password_hash,platform_role) VALUES($1,'Synthetic security test',$2,$3) RETURNING id",
      [email, hashPassword(password), role === "owner" ? "owner" : null],
    )
  ).rows[0].id;
  if (role !== "owner")
    await db.query(
      "INSERT INTO staff_memberships(user_id,tenant_id,role) VALUES($1,$2,$3)",
      [id, office, role],
    );
  return { id, email, session: await login(email) };
}
async function blockedAccountQuery(fragment: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await db.query(
      "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND usename='astra_app' AND wait_event_type='Lock' AND query LIKE $1",
      [`%${fragment}%`],
    );
    if (result.rowCount) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(
    "Expected account request to wait for the held database row lock",
  );
}
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  for (const suffix of ["a", "b"]) {
    const row = (
      await db.query(
        "WITH created AS (INSERT INTO tenants(slug,name_bn,name_en) VALUES($1,'পরীক্ষা অফিস','Synthetic security office') RETURNING id) INSERT INTO tenant_wallets(tenant_id) SELECT id FROM created RETURNING tenant_id AS id",
        [`security-${run}-${suffix}`],
      )
    ).rows[0];
    if (suffix === "a") tenantId = row.id;
    else otherTenantId = row.id;
  }
  officeAdmin = (await user("admin", tenantId, "admin")).session;
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await db.end();
});

test("SEC-SESSION: own aggregate summary, expiry filtering and authorization expose no session secrets", async () => {
  const target = await user("summary"),
    neighbor = await user("neighbor", otherTenantId);
  await login(target.email);
  const expired = await login(target.email);
  await db.query(
    "UPDATE sessions SET expires_at=now()-interval '1 minute' WHERE user_id=$1 AND csrf_token=$2",
    [target.id, expired.csrf],
  );
  assert.equal((await request("GET", "/auth/sessions")).status, 401);
  const result = await request(
    "GET",
    "/auth/sessions",
    undefined,
    target.session,
  );
  assert.equal(result.status, 200);
  assert.deepEqual(Object.keys(result.body).sort(), [
    "activeSessions",
    "currentSessionExpiresAt",
    "otherSessions",
  ]);
  assert.equal(result.body.activeSessions, 2);
  assert.equal(result.body.otherSessions, 1);
  assert.ok(Date.parse(result.body.currentSessionExpiresAt) > Date.now());
  assert.ok(!JSON.stringify(result.body).includes(target.session.csrf));
  assert.equal(
    (await request("GET", "/auth/sessions", undefined, neighbor.session)).body
      .activeSessions,
    1,
  );
});

test("SEC-REVOKE: reauthentication, CSRF and strict body protect own-session revocation and immutable audit", async () => {
  const target = await user("revoke"),
    neighbor = await user("revoke-neighbor", otherTenantId);
  const other = await login(target.email);
  const path = "/auth/sessions/revoke-others";
  assert.equal(
    (
      await request(
        "POST",
        path,
        { currentPassword: password },
        target.session,
        { "X-CSRF-Token": "wrong" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "POST",
        path,
        { currentPassword: password, userId: neighbor.id },
        target.session,
      )
    ).status,
    422,
  );
  assert.equal(
    (await request("POST", path, { currentPassword: "wrong" }, target.session))
      .status,
    422,
  );
  assert.equal(
    (await request("GET", "/auth/me", undefined, other)).status,
    200,
  );
  const result = await request(
    "POST",
    path,
    { currentPassword: password },
    target.session,
  );
  assert.deepEqual(result.body, { revoked: 1, remainingSessions: 1 });
  assert.equal(
    (await request("GET", "/auth/me", undefined, other)).status,
    401,
  );
  assert.equal(
    (await request("GET", "/auth/me", undefined, target.session)).status,
    200,
  );
  assert.equal(
    (await request("GET", "/auth/me", undefined, neighbor.session)).status,
    200,
  );
  assert.equal(
    (await request("POST", path, { currentPassword: password }, target.session))
      .body.revoked,
    0,
  );
  const events = (
    await db.query(
      "SELECT tenant_id,metadata FROM audit_events WHERE actor_id=$1 AND action='OTHER_SESSIONS_REVOKED' ORDER BY created_at",
      [target.id],
    )
  ).rows;
  assert.equal(events.length, 2);
  assert.equal(events[0].tenant_id, tenantId);
  assert.deepEqual(events[0].metadata, { revokedSessions: 1 });
  assert.ok(!JSON.stringify(events).includes(password));
});

test("SEC-PASSWORD: change consumes previously issued recovery links across account memberships", async () => {
  const target = await user("password");
  // S-007: the grant no longer returns the token — it is delivered
  // out-of-band to the account holder's email. Capture the mail to
  // exercise the token, then restore the log provider.
  const mailSent: MailMessage[] = [];
  setMailProvider({ async send(m) { mailSent.push(m); } });
  const grant = await request(
    "POST",
    `/admin/users/${target.id}/recovery`,
    {},
    officeAdmin,
  );
  setMailProvider(logMailProvider);
  assert.equal(grant.status, 201);
  assert.equal(grant.body.token, undefined, "S-007: no plaintext token in the response");
  assert.equal(grant.body.recoveryUrl, undefined);
  assert.equal(grant.body.delivery, "EMAIL");
  const grantToken = mailSent[0].text.match(/#token=([a-f0-9]{64})/)?.[1];
  assert.ok(grantToken, "the out-of-band email carries the fragment link");
  const secondToken = randomToken();
  await db.query(
    "INSERT INTO staff_memberships(user_id,tenant_id,role) VALUES($1,$2,'citizen')",
    [target.id, otherTenantId],
  );
  // A historical token in another membership must not survive a global password change.
  await db.query(
    "INSERT INTO password_recovery_tokens(token_hash,tenant_id,user_id,created_by,expires_at) VALUES($1,$2,$3,$4,now()+interval '10 minutes')",
    [digest(secondToken), otherTenantId, target.id, officeAdmin.user.id],
  );
  const second = await login(target.email);
  const changed = await request(
    "POST",
    "/auth/password",
    { currentPassword: password, newPassword: "Upd-Security-Pa1!" },
    target.session,
  );
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal(
    (await request("GET", "/auth/me", undefined, second)).status,
    401,
  );
  for (const token of [grantToken!, secondToken])
    assert.equal(
      (await request("POST", "/auth/recover", { token, newPassword: password }))
        .status,
      422,
    );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM password_recovery_tokens WHERE user_id=$1 AND consumed_at IS NULL",
        [target.id],
      )
    ).rows[0].n,
    0,
  );
  const event = (
    await db.query(
      "SELECT metadata FROM audit_events WHERE actor_id=$1 AND action='PASSWORD_CHANGED'",
      [target.id],
    )
  ).rows[0];
  assert.deepEqual(event.metadata, { revokedSessions: 1 });
  await login(target.email, "Upd-Security-Pa1!");
});

test("SEC-RACE: login waiting on password rotation cannot create a session from the old password", async () => {
  const target = await user("login-race"),
    held = await db.connect();
  let pending: ReturnType<typeof request> | undefined;
  try {
    await held.query("BEGIN");
    await held.query("SELECT id FROM platform_users WHERE id=$1 FOR UPDATE", [
      target.id,
    ]);
    pending = request("POST", "/auth/login", { email: target.email, password });
    // A-013 (migration 083): login finds the account by email through the
    // lookup function, then locks its own row by id.
    await blockedAccountQuery("SELECT * FROM platform_users WHERE id=$1 FOR UPDATE");
    await held.query("UPDATE platform_users SET password_hash=$2 WHERE id=$1", [
      target.id,
      hashPassword("Rot-Security-Pa1!"),
    ]);
    await held.query(
      "UPDATE sessions SET expires_at=clock_timestamp() WHERE user_id=$1",
      [target.id],
    );
    await held.query("COMMIT");
    assert.equal((await pending).status, 401);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM sessions WHERE user_id=$1 AND expires_at>now()",
          [target.id],
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await held.query("ROLLBACK");
    held.release();
    if (pending) await pending;
  }
});

test("SEC-RACE: a request authenticated before revocation rechecks its session after waiting", async () => {
  const target = await user("session-race"),
    other = await login(target.email),
    held = await db.connect();
  let pending: ReturnType<typeof request> | undefined;
  try {
    await held.query("BEGIN");
    await held.query("SELECT id FROM platform_users WHERE id=$1 FOR UPDATE", [
      target.id,
    ]);
    pending = request(
      "POST",
      "/auth/sessions/revoke-others",
      { currentPassword: password },
      target.session,
    );
    await blockedAccountQuery("WHERE id=$1 FOR UPDATE");
    await held.query(
      "UPDATE sessions SET expires_at=clock_timestamp() WHERE user_id=$1 AND csrf_token=$2",
      [target.id, target.session.csrf],
    );
    await held.query("COMMIT");
    assert.equal((await pending).status, 401);
    assert.equal(
      (await request("GET", "/auth/me", undefined, other)).status,
      200,
    );
  } finally {
    await held.query("ROLLBACK");
    held.release();
    if (pending) await pending;
  }
});

test("SEC-RACE: concurrent recovery and password change have one winner without a reusable recovery token", async () => {
  const target = await user("recovery-race");
  const grant = await request(
    "POST",
    `/admin/users/${target.id}/recovery`,
    {},
    officeAdmin,
  );
  const outcomes = await Promise.all([
    request(
      "POST",
      "/auth/password",
      { currentPassword: password, newPassword: "Chg-Concurrent-P1!" },
      target.session,
    ),
    request("POST", "/auth/recover", {
      token: grant.body.token,
      newPassword: "Rec-Concurrent-P1!",
    }),
  ]);
  assert.equal(
    outcomes.filter((outcome) => outcome.status === 200).length,
    1,
    JSON.stringify(outcomes),
  );
  assert.ok(
    outcomes.every((outcome) => [200, 401, 422].includes(outcome.status)),
  );
  assert.equal(
    (
      await request("POST", "/auth/recover", {
        token: grant.body.token,
        newPassword: password,
      })
    ).status,
    422,
  );
  await login(
    target.email,
    outcomes[0].status === 200
      ? "Chg-Concurrent-P1!"
      : "Rec-Concurrent-P1!",
  );
});

test("SEC-OWNER: platform owner can inspect and revoke own sessions without a tenant or cross-account access", async () => {
  const target = await user("owner", tenantId, "owner"),
    other = await login(target.email);
  assert.equal(
    (await request("GET", "/auth/sessions", undefined, target.session)).body
      .activeSessions,
    2,
  );
  assert.equal(
    (
      await request(
        "POST",
        "/auth/sessions/revoke-others",
        { currentPassword: password },
        target.session,
      )
    ).body.revoked,
    1,
  );
  assert.equal(
    (await request("GET", "/auth/me", undefined, other)).status,
    401,
  );
  assert.equal(
    (await request("GET", "/auth/me", undefined, target.session)).status,
    200,
  );
});

test("SEC-LIMIT: password rechecks have an authenticated per-account budget independent of neighboring users", async () => {
  const target = await user("limit"),
    neighbor = await user("limit-neighbor");
  for (let attempt = 0; attempt < 10; attempt++)
    assert.equal(
      (
        await request(
          "POST",
          "/auth/sessions/revoke-others",
          { currentPassword: "incorrect" },
          target.session,
        )
      ).status,
      422,
    );
  const blocked = await request(
    "POST",
    "/auth/password",
    { currentPassword: password, newPassword: "Budget-New-Pass!" },
    target.session,
  );
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  assert.equal(
    (
      await request(
        "POST",
        "/auth/sessions/revoke-others",
        { currentPassword: password },
        neighbor.session,
      )
    ).status,
    200,
  );
});
