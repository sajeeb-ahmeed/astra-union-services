import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { app } from "../src/app.js";
import { pool, adminConnectionString, asUser } from "../src/db.js";
import { digest, hashPassword } from "../src/security.js";
import {
  SESSION_IDLE_TIMEOUT_MS,
  SESSION_ABSOLUTE_LIFETIME_MS,
  sessionCookieName,
  buildSessionCookie,
  clearSessionCookie,
  isSessionIdle,
  sessionExpiryAfterTouch,
  touchSession,
  expireSession,
} from "../src/session-hygiene.js";
import {
  logPlatformSecurityEvent,
  hashClientIp,
} from "../src/security-audit.js";

const db = new pg.Pool({ connectionString: adminConnectionString });
const password = "Synth-Hygiene-P1!";
const run = randomUUID().slice(0, 8);
let server: ReturnType<typeof app.listen>, base: string;
let tenantId: string;
type Session = { cookie: string; csrf: string; user: any };
async function request(
  method: string,
  path: string,
  data?: unknown,
  session?: Session,
) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      ...(session
        ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf }
        : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json().catch(() => ({})),
  };
}
async function login(email: string, secret = password): Promise<Session> {
  const response = await request("POST", "/auth/login", {
    email,
    password: secret,
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return {
    cookie: response.headers.get("set-cookie")!.split(";")[0],
    csrf: response.body.csrfToken,
    user: response.body.user,
  };
}
async function user(name: string, role = "citizen") {
  const email = `${name}-${run}@hygiene.synthetic.test`;
  const id = (
    await db.query(
      "INSERT INTO platform_users(email,display_name,password_hash,platform_role) VALUES($1,'Synthetic hygiene test',$2,$3) RETURNING id",
      [email, hashPassword(password), role === "owner" ? "owner" : null],
    )
  ).rows[0].id;
  if (role !== "owner")
    await db.query(
      "INSERT INTO staff_memberships(user_id,tenant_id,role) VALUES($1,$2,$3)",
      [id, tenantId, role],
    );
  return { id, email, session: await login(email) };
}
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  tenantId = (
    await db.query(
      "WITH created AS (INSERT INTO tenants(slug,name_bn,name_en) VALUES($1,'পরীক্ষা অফিস','Synthetic hygiene office') RETURNING id) INSERT INTO tenant_wallets(tenant_id) SELECT id FROM created RETURNING tenant_id AS id",
      [`hygiene-${run}`],
    )
  ).rows[0].id;
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await db.end();
});

test("S-005: cookie naming is __Host- in production and plain elsewhere", () => {
  assert.equal(sessionCookieName({ NODE_ENV: "production" }), "__Host-astra_session");
  assert.equal(sessionCookieName({ NODE_ENV: "test" }), "astra_session");
  assert.equal(sessionCookieName({}), "astra_session");
  const prod = buildSessionCookie("tok", { NODE_ENV: "production" });
  assert.match(prod, /^__Host-astra_session=tok;/);
  assert.match(prod, /; Secure/);
  assert.match(prod, /Max-Age=28800/);
  const testCookie = buildSessionCookie("tok", { NODE_ENV: "test" });
  assert.match(testCookie, /^astra_session=tok;/);
  assert.doesNotMatch(testCookie, /Secure/);
  assert.match(clearSessionCookie({ NODE_ENV: "production" }), /^__Host-astra_session=;/);
  assert.match(clearSessionCookie({ NODE_ENV: "test" }), /^astra_session=;/);
});

test("S-005: idle math — 45 min idle, 8 h absolute cap", () => {
  const now = new Date("2026-11-26T10:00:00Z");
  assert.equal(
    isSessionIdle({ last_seen_at: new Date(now.getTime() - 44 * 60_000) }, now),
    false,
  );
  assert.equal(
    isSessionIdle({ last_seen_at: new Date(now.getTime() - 46 * 60_000) }, now),
    true,
  );
  assert.equal(SESSION_IDLE_TIMEOUT_MS, 45 * 60_000);
  assert.equal(SESSION_ABSOLUTE_LIFETIME_MS, 8 * 60 * 60_000);
  // Activity early in life slides expiry to now + 45 min.
  assert.equal(
    sessionExpiryAfterTouch(
      { created_at: new Date("2026-11-26T09:00:00Z") },
      now,
    ).toISOString(),
    "2026-11-26T10:45:00.000Z",
  );
  // Activity near the end of life is capped at created_at + 8 h, never beyond.
  assert.equal(
    sessionExpiryAfterTouch(
      { created_at: new Date("2026-11-26T02:30:00Z") },
      now,
    ).toISOString(),
    "2026-11-26T10:30:00.000Z",
  );
});

test("S-005: touch slides expiry but never past created_at + 8 h", async () => {
  const target = await user("touch");
  const other = await login(target.email);
  const hash = digest(other.cookie.split("=")[1]);
  // Age the session: created 7 h 50 min ago, last seen 10 min ago.
  await db.query(
    "UPDATE sessions SET created_at=now()-interval '7 hours 50 minutes', last_seen_at=now()-interval '10 minutes', expires_at=now()+interval '10 minutes' WHERE token_hash=$1",
    [hash],
  );
  // A-013 (migration 082): without an acting user the runtime role cannot see
  // the session at all; the app always touches it as the session's own user.
  assert.equal(await touchSession(pool, hash, new Date()), 0, "RLS: no acting user, no row");
  const touched = await asUser(target.id, (c) => touchSession(c, hash, new Date()));
  assert.equal(touched, 1);
  const row = (
    await db.query(
      "SELECT created_at, last_seen_at, expires_at FROM sessions WHERE token_hash=$1",
      [hash],
    )
  ).rows[0];
  // expires_at is capped at created_at + 8 h (10 min from now), not now + 45 min.
  const cap = new Date(row.created_at).getTime() + 8 * 60 * 60_000;
  assert.ok(Math.abs(new Date(row.expires_at).getTime() - cap) < 5_000);
  assert.ok(Date.now() - new Date(row.last_seen_at).getTime() < 60_000);
  // An expired session is not touched.
  await db.query(
    "UPDATE sessions SET expires_at=now()-interval '1 minute' WHERE token_hash=$1",
    [hash],
  );
  assert.equal(await asUser(target.id, (c) => touchSession(c, hash, new Date())), 0);
  assert.equal(await asUser(target.id, (c) => expireSession(c, hash)), 0);
});

test("S-005: per-session revoke kills exactly one session; current and foreign ids refused", async () => {
  const target = await user("revoke-one");
  const other = await login(target.email);
  const list = await request("GET", "/auth/sessions/list", undefined, target.session);
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.sessions.length, 2);
  const current = list.body.sessions.find((s: any) => s.current);
  const otherRow = list.body.sessions.find((s: any) => !s.current);
  assert.ok(current?.id && otherRow?.id && current.id !== otherRow.id);
  assert.ok(!JSON.stringify(list.body).includes(target.session.csrf));
  assert.ok(!JSON.stringify(list.body).includes(other.csrf));
  // Wrong password, unknown id, and the current session are all refused.
  assert.equal(
    (
      await request(
        "POST",
        "/auth/sessions/revoke",
        { sessionId: otherRow.id, currentPassword: "wrong" },
        target.session,
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await request(
        "POST",
        "/auth/sessions/revoke",
        { sessionId: randomUUID(), currentPassword: password },
        target.session,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        "POST",
        "/auth/sessions/revoke",
        { sessionId: current.id, currentPassword: password },
        target.session,
      )
    ).status,
    409,
  );
  // Revoking the other session succeeds and leaves the current one working.
  const revoked = await request(
    "POST",
    "/auth/sessions/revoke",
    { sessionId: otherRow.id, currentPassword: password },
    target.session,
  );
  assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
  assert.equal(revoked.body.revoked, 1);
  assert.equal(revoked.body.remainingSessions, 1);
  assert.equal((await request("GET", "/auth/me", undefined, other)).status, 401);
  assert.equal(
    (await request("GET", "/auth/me", undefined, target.session)).status,
    200,
  );
  const events = (
    await db.query(
      "SELECT action, metadata FROM account_security_events WHERE user_id=$1 AND action='SESSION_REVOKED' ORDER BY created_at DESC LIMIT 1",
      [target.id],
    )
  ).rows;
  assert.equal(events.length, 1);
  assert.equal(events[0].metadata.sessionId, otherRow.id);
  // Revoking the same session again is a 404 — it is already expired.
  assert.equal(
    (
      await request(
        "POST",
        "/auth/sessions/revoke",
        { sessionId: otherRow.id, currentPassword: password },
        target.session,
      )
    ).status,
    404,
  );
});

test("S-014: owner revoke-others writes the durable platform audit row (no raw IP)", async () => {
  const target = await user("owner-audit", "owner");
  const other = await login(target.email);
  const revoked = await request(
    "POST",
    "/auth/sessions/revoke-others",
    { currentPassword: password },
    target.session,
  );
  assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
  assert.equal(revoked.body.revoked, 1);
  const rows = (
    await db.query(
      "SELECT actor_id, actor_role, action, ip_hash, metadata FROM platform_security_events WHERE actor_id=$1 AND action='OWNER_SESSIONS_REVOKED' ORDER BY created_at DESC LIMIT 1",
      [target.id],
    )
  ).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actor_role, "owner");
  assert.equal(rows[0].metadata.revokedSessions, 1);
  assert.equal(rows[0].ip_hash, null);
  assert.equal((await request("GET", "/auth/me", undefined, other)).status, 401);
});

test("S-014: owner password change writes the durable platform audit row", async () => {
  const target = await user("owner-pw", "owner");
  const temp = "Temp-Hygiene-1!"; // <= 18 chars: the shared password rule (S-002) caps at 18.
  try {
    const changed = await request(
      "POST",
      "/auth/password",
      { currentPassword: password, newPassword: temp },
      target.session,
    );
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    const rows = (
      await db.query(
        "SELECT action, metadata FROM platform_security_events WHERE actor_id=$1 AND action='OWNER_PASSWORD_CHANGED' ORDER BY created_at DESC LIMIT 1",
        [target.id],
      )
    ).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].metadata.revokedSessions, 0);
  } finally {
    // Restore the original password so later files see a clean account.
    const restored = await request(
      "POST",
      "/auth/password",
      { currentPassword: temp, newPassword: password },
      target.session,
    );
    assert.equal(restored.status, 200, JSON.stringify(restored.body));
  }
});

test("S-014: platform audit stores hashed IPs, never raw ones, and is append-only", async () => {
  const target = await user("platform-audit");
  const ip = "203.0.113.51";
  await logPlatformSecurityEvent(pool, {
    actorId: target.id,
    actorRole: "citizen",
    action: "LOGIN_FAILED",
    identifierKind: "mobile",
    ip,
    metadata: { reason: "INVALID_LOGIN" },
  });
  await logPlatformSecurityEvent(pool, {
    action: "LOGIN_FAILED",
    identifierKind: "unknown",
    ip,
    metadata: { reason: "INVALID_LOGIN" },
  });
  const rows = (
    await db.query(
      "SELECT actor_id, action, identifier_kind, ip_hash, metadata FROM platform_security_events WHERE action='LOGIN_FAILED' AND ip_hash=$1 ORDER BY created_at DESC LIMIT 2",
      [hashClientIp(ip)],
    )
  ).rows;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].identifier_kind, "unknown");
  assert.equal(rows[0].actor_id, null);
  assert.equal(rows[1].identifier_kind, "mobile");
  assert.equal(rows[1].metadata.reason, "INVALID_LOGIN");
  assert.ok(!JSON.stringify(rows).includes(ip));
  assert.equal(hashClientIp(ip), digest(ip));
  // Append-only: UPDATE and DELETE are refused by the trigger.
  const id = (
    await db.query(
      "SELECT id FROM platform_security_events WHERE ip_hash=$1 ORDER BY created_at DESC LIMIT 1",
      [hashClientIp(ip)],
    )
  ).rows[0].id;
  await assert.rejects(
    db.query("UPDATE platform_security_events SET metadata='{}' WHERE id=$1", [id]),
    /Append-only record/,
  );
  await assert.rejects(
    db.query("DELETE FROM platform_security_events WHERE id=$1", [id]),
    /Append-only record/,
  );
});
