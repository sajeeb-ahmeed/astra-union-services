import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { hashPassword, digest, randomToken } from "../src/security.js";
import {
  logMailProvider,
  setMailProvider,
  type MailMessage,
} from "../src/mailer.js";
import {
  decryptMfaSecret,
  encryptMfaSecret,
  matchTotp,
  newTotpSecret,
  totpCode,
} from "../src/mfa-crypto.js";

const originalKey = process.env.MFA_ENCRYPTION_KEY;
process.env.MFA_ENCRYPTION_KEY = randomBytes(32).toString("hex");
const db = new pg.Pool({ connectionString: adminConnectionString });
const password = "Synth-MFA-Test-P1!",
  run = randomUUID().slice(0, 8);
let server: ReturnType<typeof app.listen>,
  base: string,
  tenantId: string,
  otherTenant: string;
type Session = { cookie: string; csrf: string; user: any };
async function request(
  method: string,
  path: string,
  body?: any,
  session?: Session,
  headers: Record<string, string> = {},
) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(session
        ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf }
        : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json(),
  };
}
function sessionFrom(response: Awaited<ReturnType<typeof request>>): Session {
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return {
    cookie: response.headers.get("set-cookie")!.split(";")[0]!,
    csrf: response.body.csrfToken,
    user: response.body.user,
  };
}
async function createUser(name: string, role = "citizen", tenant = tenantId) {
  const email = `${name}-${run}@mfa.synthetic.test`;
  const id = (
    await db.query(
      "INSERT INTO platform_users(email,display_name,password_hash,platform_role) VALUES($1,'Synthetic MFA account',$2,$3) RETURNING id",
      [email, hashPassword(password), role === "owner" ? "owner" : null],
    )
  ).rows[0].id;
  if (role !== "owner")
    await db.query(
      "INSERT INTO staff_memberships(user_id,tenant_id,role) VALUES($1,$2,$3)",
      [id, tenant, role],
    );
  return {
    id,
    email,
    session: sessionFrom(
      await request("POST", "/auth/login", { email, password }),
    ),
  };
}
async function enroll(user: Awaited<ReturnType<typeof createUser>>) {
  const setup = await request(
    "POST",
    "/auth/mfa/enrollment",
    { currentPassword: password },
    user.session,
  );
  assert.equal(setup.status, 201, setup.body.error?.code);
  const code = totpCode(setup.body.secret, Math.floor(Date.now() / 30_000));
  const enabled = await request(
    "POST",
    "/auth/mfa/activate",
    { code },
    user.session,
  );
  assert.equal(enabled.status, 200, enabled.body.error?.code);
  return {
    secret: setup.body.secret as string,
    code,
    codes: enabled.body.recoveryCodes as string[],
  };
}
async function challenge(
  user: Awaited<ReturnType<typeof createUser>>,
  secret = password,
) {
  const response = await request("POST", "/auth/login", {
    email: user.email,
    password: secret,
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.mfaRequired, true);
  assert.equal(response.headers.get("set-cookie"), null);
  return response.body.challengeToken as string;
}
async function verify(challengeToken: string, code: string) {
  return request("POST", "/auth/mfa/verify", { challengeToken, code });
}
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  for (const suffix of ["a", "b"]) {
    const id = (
      await db.query(
        "WITH t AS (INSERT INTO tenants(slug,name_bn,name_en) VALUES($1,'পরীক্ষা অফিস','Synthetic MFA office') RETURNING id) INSERT INTO tenant_wallets(tenant_id) SELECT id FROM t RETURNING tenant_id",
        [`mfa-${run}-${suffix}`],
      )
    ).rows[0].tenant_id;
    if (suffix === "a") tenantId = id;
    else otherTenant = id;
  }
});
after(async () => {
  if (originalKey === undefined) delete process.env.MFA_ENCRYPTION_KEY;
  else process.env.MFA_ENCRYPTION_KEY = originalKey;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await db.end();
});

test("MFA-CRYPTO: RFC 6238 six-digit vectors, drift window, replay counter and account-bound authenticated encryption", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  for (const [seconds, expected] of [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ] as const)
    assert.equal(totpCode(secret, Math.floor(seconds / 30)), expected);
  const now = 1234567890000,
    counter = Math.floor(now / 30_000),
    code = totpCode(secret, counter);
  assert.equal(matchTotp(secret, code, now, counter - 1), counter);
  assert.equal(matchTotp(secret, code, now, counter), null);
  assert.equal(matchTotp(secret, totpCode(secret, counter + 2), now, -1), null);
  assert.equal(matchTotp(secret, "12345x", now, -1), null);
  const account = randomUUID(),
    encrypted = encryptMfaSecret(secret, account);
  assert.equal(decryptMfaSecret(encrypted, account), secret);
  assert.throws(() => decryptMfaSecret(encrypted, randomUUID()), /unavailable/);
  assert.throws(
    () =>
      decryptMfaSecret(
        encrypted.slice(0, -1) + (encrypted.endsWith("0") ? "1" : "0"),
        account,
      ),
    /unavailable/,
  );
  assert.match(newTotpSecret(), /^[A-Z2-7]{32}$/);
});

test("MFA-SETUP: current password, CSRF, origin and strict body required; setup remains optional, encrypted and private", async () => {
  const user = await createUser("setup");
  assert.equal((await request("GET", "/auth/mfa")).status, 401);
  assert.deepEqual(
    (await request("GET", "/auth/mfa", undefined, user.session)).body,
    {
      enabled: false,
      available: true,
      pendingExpiresAt: null,
      recoveryCodesRemaining: 0,
    },
  );
  assert.equal(
    (
      await request(
        "POST",
        "/auth/mfa/enrollment",
        { currentPassword: "wrong" },
        user.session,
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await request(
        "POST",
        "/auth/mfa/enrollment",
        { currentPassword: password, userId: randomUUID() },
        user.session,
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await request(
        "POST",
        "/auth/mfa/enrollment",
        { currentPassword: password },
        user.session,
        { "X-CSRF-Token": "wrong" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "POST",
        "/auth/mfa/enrollment",
        { currentPassword: password },
        user.session,
        { Origin: "https://evil.invalid" },
      )
    ).status,
    403,
  );
  const setup = await request(
    "POST",
    "/auth/mfa/enrollment",
    { currentPassword: password },
    user.session,
  );
  assert.equal(setup.status, 201);
  assert.equal(setup.headers.get("cache-control"), "no-store");
  assert.match(setup.body.secret, /^[A-Z2-7]{32}$/);
  assert.match(setup.body.otpauthUri, /^otpauth:\/\/totp\//);
  assert.match(setup.body.qrDataUrl, /^data:image\/png;base64,/);
  const row = (
    await db.query("SELECT * FROM account_mfa WHERE user_id=$1", [user.id])
  ).rows[0];
  assert.equal(row.enabled_at, null);
  assert.ok(!row.pending_secret.includes(setup.body.secret));
  assert.equal(
    decryptMfaSecret(row.pending_secret, user.id),
    setup.body.secret,
  );
  // An unconfirmed setup does not lock the user out or silently enable MFA.
  assert.ok(
    (await request("POST", "/auth/login", { email: user.email, password })).body
      .csrfToken,
  );
  const summary = (await request("GET", "/auth/mfa", undefined, user.session))
    .body;
  assert.equal(summary.enabled, false);
  assert.ok(summary.pendingExpiresAt);
  assert.ok(!JSON.stringify(summary).includes(setup.body.secret));
});

test("MFA-ENABLED: confirmation revokes old sessions and password links, shows recovery codes once, and gates sessions", async () => {
  const user = await createUser("enabled"),
    other = sessionFrom(
      await request("POST", "/auth/login", { email: user.email, password }),
    );
  const recovery = randomToken();
  await db.query(
    "INSERT INTO password_recovery_tokens(token_hash,tenant_id,user_id,created_by,expires_at) VALUES($1,$2,$3,$3,now()+interval '15 minutes')",
    [digest(recovery), tenantId, user.id],
  );
  const configured = await enroll(user);
  assert.equal(configured.codes.length, 10);
  assert.equal(new Set(configured.codes).size, 10);
  const state = (
    await db.query("SELECT * FROM account_mfa WHERE user_id=$1", [user.id])
  ).rows[0];
  assert.equal(state.pending_secret, null);
  assert.equal(state.recovery_hashes.length, 10);
  assert.ok(
    configured.codes.every(
      (code) => !state.recovery_hashes.includes(code.replace(/-/g, "")),
    ),
  );
  assert.equal(
    (await request("GET", "/auth/me", undefined, other)).status,
    401,
  );
  assert.ok(
    (
      await db.query(
        "SELECT consumed_at FROM password_recovery_tokens WHERE token_hash=$1",
        [digest(recovery)],
      )
    ).rows[0].consumed_at,
  );
  const pending = await challenge(user);
  assert.equal(
    (
      await request("GET", "/auth/me", undefined, {
        cookie: `astra_session=${pending}`,
        csrf: pending,
        user: null,
      })
    ).status,
    401,
  );
  const replayedTotp = await verify(pending, configured.code);
  assert.equal(replayedTotp.status, 422);
  assert.equal(replayedTotp.body.error.code, "MFA_CODE_INVALID");
  const completed = await verify(pending, configured.codes[0]!);
  const signedIn = sessionFrom(completed);
  assert.equal(signedIn.user.id, user.id);
  assert.equal(
    (await verify(pending, configured.codes[1]!)).body.error.code,
    "MFA_CHALLENGE_INVALID",
  );
  const summary = (await request("GET", "/auth/mfa", undefined, signedIn)).body;
  assert.equal(summary.recoveryCodesRemaining, 9);
  assert.ok(!JSON.stringify(summary).includes(configured.secret));
});

test("MFA-CONCURRENCY: one challenge and one recovery code can create only one session", async () => {
  const user = await createUser("concurrency"),
    enrolled = await enroll(user),
    token = await challenge(user);
  const before = (
    await db.query("SELECT count(*)::int AS n FROM sessions WHERE user_id=$1", [
      user.id,
    ])
  ).rows[0].n;
  const results = await Promise.all([
    verify(token, enrolled.codes[0]!),
    verify(token, enrolled.codes[0]!),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 422]);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM sessions WHERE user_id=$1",
        [user.id],
      )
    ).rows[0].n,
    before + 1,
  );
  const again = await challenge(user);
  assert.equal(
    (await verify(again, enrolled.codes[0]!)).body.error.code,
    "MFA_CODE_INVALID",
  );
  assert.equal((await verify(again, enrolled.codes[1]!)).status, 200);
});

test("MFA-TOTP: a fresh authenticator code succeeds once; a later challenge cannot replay it", async () => {
  const user = await createUser("totp"),
    enrolled = await enroll(user);
  const code = totpCode(enrolled.secret, Math.floor(Date.now() / 30_000) + 1);
  assert.equal((await verify(await challenge(user), code)).status, 200);
  assert.equal(
    (await verify(await challenge(user), code)).body.error.code,
    "MFA_CODE_INVALID",
  );
});

test("MFA-RATE: shared database budget survives a new challenge, commits failures and isolates neighboring accounts", async () => {
  const user = await createUser("rate"),
    enrolled = await enroll(user),
    neighbor = await createUser("rate-neighbor");
  const neighborEnrolled = await enroll(neighbor),
    token = await challenge(user);
  for (let i = 0; i < 4; i++)
    assert.equal((await verify(token, "not-a-code")).status, 422);
  const blocked = await verify(token, "not-a-code");
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("retry-after"), "300");
  assert.equal((await verify(token, enrolled.codes[0]!)).status, 429);
  assert.equal(
    (await request("POST", "/auth/login", { email: user.email, password }))
      .status,
    429,
  );
  assert.equal(
    (
      await db.query(
        "SELECT failed_attempts FROM account_mfa WHERE user_id=$1",
        [user.id],
      )
    ).rows[0].failed_attempts,
    5,
  );
  assert.equal(
    (await verify(await challenge(neighbor), neighborEnrolled.codes[0]!))
      .status,
    200,
  );
  await db.query(
    "UPDATE account_mfa SET attempt_window_at=now()-interval '6 minutes' WHERE user_id=$1",
    [user.id],
  );
  assert.equal((await verify(token, enrolled.codes[0]!)).status, 200);
});

test("MFA-LIFETIME: expired, superseded and disabled-membership challenges never create a session", async () => {
  const user = await createUser("lifetime"),
    enrolled = await enroll(user);
  const old = await challenge(user),
    current = await challenge(user);
  assert.equal(
    (await verify(old, enrolled.codes[0]!)).body.error.code,
    "MFA_CHALLENGE_INVALID",
  );
  await db.query(
    "UPDATE mfa_login_challenges SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
    [digest(current)],
  );
  assert.equal(
    (await verify(current, enrolled.codes[0]!)).body.error.code,
    "MFA_CHALLENGE_INVALID",
  );
  const membershipToken = await challenge(user);
  await db.query("UPDATE staff_memberships SET active=false WHERE user_id=$1", [
    user.id,
  ]);
  assert.equal((await verify(membershipToken, enrolled.codes[0]!)).status, 403);
  assert.equal(
    (
      await db.query(
        "SELECT cardinality(recovery_hashes) AS n FROM account_mfa WHERE user_id=$1",
        [user.id],
      )
    ).rows[0].n,
    10,
  );
});

test("MFA-ENROLLMENT-LIFETIME: expired setup cannot be confirmed and pending-code attempts share the durable budget", async () => {
  const user = await createUser("enrollment-lifetime");
  const setup = await request(
    "POST",
    "/auth/mfa/enrollment",
    { currentPassword: password },
    user.session,
  );
  const code = totpCode(setup.body.secret, Math.floor(Date.now() / 30_000));
  await db.query(
    "UPDATE account_mfa SET pending_expires_at=now()-interval '1 second' WHERE user_id=$1",
    [user.id],
  );
  assert.equal(
    (await request("POST", "/auth/mfa/activate", { code }, user.session)).body
      .error.code,
    "MFA_ENROLLMENT_EXPIRED",
  );
  await request(
    "POST",
    "/auth/mfa/enrollment",
    { currentPassword: password },
    user.session,
  );
  for (let i = 0; i < 4; i++)
    assert.equal(
      (
        await request(
          "POST",
          "/auth/mfa/activate",
          { code: "invalid" },
          user.session,
        )
      ).status,
      422,
    );
  const denied = await request(
    "POST",
    "/auth/mfa/activate",
    { code: "invalid" },
    user.session,
  );
  assert.equal(denied.status, 429);
  assert.equal(denied.headers.get("retry-after"), "300");
  assert.equal(
    (
      await request(
        "POST",
        "/auth/mfa/enrollment",
        { currentPassword: password },
        user.session,
      )
    ).status,
    429,
  );
  assert.equal(
    (await request("GET", "/auth/mfa", undefined, user.session)).body.enabled,
    false,
  );
});

test("MFA-LOCK-RACE: a challenge waiting behind password rotation cannot create a session from stale credentials", async () => {
  const user = await createUser("lock-race"),
    enrolled = await enroll(user),
    token = await challenge(user);
  const blocker = await db.connect();
  let attempt: ReturnType<typeof verify> | undefined;
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT 1 FROM platform_users WHERE id=$1 FOR UPDATE", [
      user.id,
    ]);
    attempt = verify(token, enrolled.codes[0]!);
    let waiting = false;
    for (let i = 0; i < 100; i++) {
      const active = await db.query(
        "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND usename='astra_app' AND wait_event_type='Lock' AND query LIKE '%SELECT * FROM platform_users WHERE id=$1 FOR UPDATE%'",
      );
      if (active.rowCount) {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(waiting, "MFA request should wait on the credential lock");
    // The direct fixture update deliberately leaves the challenge row untouched;
    // verifying its credential digest is a second defense against stale grants.
    await blocker.query(
      "UPDATE platform_users SET password_hash=$2 WHERE id=$1",
      [user.id, hashPassword("Rot-Synth-MFA-Pa1!")],
    );
    await blocker.query("COMMIT");
    assert.equal((await attempt).body.error.code, "MFA_CHALLENGE_INVALID");
    assert.equal(
      (
        await db.query(
          "SELECT cardinality(recovery_hashes) AS n FROM account_mfa WHERE user_id=$1",
          [user.id],
        )
      ).rows[0].n,
      10,
    );
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
    if (attempt) await attempt;
  }
});

test("MFA-PASSWORD: password changes invalidate challenges and pending enrollment without removing active MFA", async () => {
  const user = await createUser("password"),
    enrolled = await enroll(user),
    token = await challenge(user);
  const changed = "Chg-Synth-MFA-Pa1!";
  assert.equal(
    (
      await request(
        "POST",
        "/auth/password",
        { currentPassword: password, newPassword: changed },
        user.session,
      )
    ).status,
    200,
  );
  assert.equal(
    (await verify(token, enrolled.codes[0]!)).body.error.code,
    "MFA_CHALLENGE_INVALID",
  );
  assert.equal(
    (await request("POST", "/auth/login", { email: user.email, password }))
      .status,
    401,
  );
  assert.equal(
    (await verify(await challenge(user, changed), enrolled.codes[0]!)).status,
    200,
  );
  const pendingUser = await createUser("pending-password");
  const pending = await request(
    "POST",
    "/auth/mfa/enrollment",
    { currentPassword: password },
    pendingUser.session,
  );
  await request(
    "POST",
    "/auth/password",
    { currentPassword: password, newPassword: changed },
    pendingUser.session,
  );
  assert.equal(
    (
      await request(
        "POST",
        "/auth/mfa/activate",
        {
          code: totpCode(pending.body.secret, Math.floor(Date.now() / 30_000)),
        },
        pendingUser.session,
      )
    ).body.error.code,
    "MFA_ENROLLMENT_EXPIRED",
  );
});

test("MFA-ROTATE-DISABLE: password and factor required; old recovery codes and challenges cannot survive rotation or disabling", async () => {
  const user = await createUser("rotate"),
    enrolled = await enroll(user),
    oldChallenge = await challenge(user);
  assert.equal(
    (
      await request(
        "POST",
        "/auth/mfa/recovery-codes",
        { currentPassword: "wrong", code: enrolled.codes[0] },
        user.session,
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await request(
        "POST",
        "/auth/mfa/disable",
        { currentPassword: password, code: "invalid" },
        user.session,
      )
    ).status,
    422,
  );
  const rotated = await request(
    "POST",
    "/auth/mfa/recovery-codes",
    { currentPassword: password, code: enrolled.codes[0] },
    user.session,
  );
  assert.equal(rotated.status, 200);
  assert.equal(rotated.body.recoveryCodes.length, 10);
  assert.equal(
    (await verify(oldChallenge, rotated.body.recoveryCodes[0])).body.error.code,
    "MFA_CHALLENGE_INVALID",
  );
  const next = await challenge(user);
  assert.equal(
    (await verify(next, enrolled.codes[1]!)).body.error.code,
    "MFA_CODE_INVALID",
  );
  const disabled = await request(
    "POST",
    "/auth/mfa/disable",
    { currentPassword: password, code: rotated.body.recoveryCodes[0] },
    user.session,
  );
  assert.equal(disabled.status, 200);
  assert.equal(disabled.body.enabled, false);
  assert.equal(
    (await verify(next, rotated.body.recoveryCodes[1])).body.error.code,
    "MFA_CHALLENGE_INVALID",
  );
  assert.ok(
    (await request("POST", "/auth/login", { email: user.email, password })).body
      .csrfToken,
  );
  const state = (
    await db.query(
      "SELECT encrypted_secret,recovery_hashes FROM account_mfa WHERE user_id=$1",
      [user.id],
    )
  ).rows[0];
  assert.equal(state.encrypted_secret, null);
  assert.deepEqual(state.recovery_hashes, []);
});

test("MFA-RECOVERY: tenant admin password reset cannot bypass enrolled MFA and does not disclose another office", async () => {
  const user = await createUser("recovery-target"),
    admin = await createUser("recovery-admin", "admin"),
    neighbor = await createUser("recovery-other", "citizen", otherTenant);
  // S-007: the grant no longer returns the token — it is delivered
  // out-of-band to the account holder's email. Capture the mail to
  // exercise the token, then restore the log provider.
  const mailSent: MailMessage[] = [];
  setMailProvider({ async send(m) { mailSent.push(m); } });
  const before = await request(
    "POST",
    `/admin/users/${user.id}/recovery`,
    {},
    admin.session,
  );
  setMailProvider(logMailProvider);
  assert.equal(before.status, 201);
  assert.equal(before.body.token, undefined, "S-007: no plaintext token in the response");
  assert.equal(before.body.recoveryUrl, undefined);
  const beforeToken = mailSent[0].text.match(/#token=([a-f0-9]{64})/)?.[1] as string;
  assert.ok(beforeToken, "the out-of-band email carries the fragment link");
  await enroll(user);
  assert.equal(
    (
      await request(
        "POST",
        `/admin/users/${user.id}/recovery`,
        {},
        admin.session,
      )
    ).body.error.code,
    "MFA_RECOVERY_REQUIRED",
  );
  assert.equal(
    (
      await request("POST", "/auth/recover", {
        token: beforeToken,
        newPassword: "Rec-Synth-MFA-Pa1!",
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await request(
        "POST",
        `/admin/users/${neighbor.id}/recovery`,
        {},
        admin.session,
      )
    ).status,
    404,
  );
  // Even an operator-issued token inserted after enrollment cannot bypass MFA.
  const token = randomToken();
  await db.query(
    "INSERT INTO password_recovery_tokens(token_hash,tenant_id,user_id,created_by,expires_at) VALUES($1,$2,$3,$4,now()+interval '15 minutes')",
    [digest(token), tenantId, user.id, admin.id],
  );
  assert.equal(
    (
      await request("POST", "/auth/recover", {
        token,
        newPassword: "Rec-Synth-MFA-Pa1!",
      })
    ).body.error.code,
    "MFA_RECOVERY_REQUIRED",
  );
});

test("MFA-OWNER-AUDIT: owner MFA works without tenant; own security history is durable, minimized, isolated and immutable", async () => {
  const owner = await createUser("owner", "owner"),
    neighbor = await createUser("audit-other");
  const enrolled = await enroll(owner),
    loggedIn = sessionFrom(
      await verify(await challenge(owner), enrolled.codes[0]!),
    );
  assert.equal(loggedIn.user.role, "owner");
  assert.equal(loggedIn.user.tenantId, null);
  const response = await request(
    "GET",
    "/auth/security-events",
    undefined,
    loggedIn,
  );
  assert.equal(response.status, 200);
  assert.ok(
    response.body.items.some((event: any) => event.action === "MFA_ENABLED"),
  );
  assert.ok(
    response.body.items.some(
      (event: any) => event.action === "MFA_RECOVERY_CODE_USED",
    ),
  );
  assert.ok(
    response.body.items.every(
      (event: any) =>
        Object.keys(event).sort().join(",") === "action,createdAt,id,metadata",
    ),
  );
  assert.ok(!JSON.stringify(response.body).includes(enrolled.secret));
  // CH-007: a plain-password sign-in is now recorded (SIGNED_IN), and
  // createUser mints the neighbour's session with exactly such a sign-in —
  // so the neighbour's history holds that one event, and nothing of the
  // owner's. Isolation is that no MFA event leaks across, not that the
  // neighbour's own sign-in is invisible.
  const neighborItems = (
    await request("GET", "/auth/security-events", undefined, neighbor.session)
  ).body.items;
  assert.equal(neighborItems.length, 1);
  assert.equal(neighborItems[0].action, "SIGNED_IN");
  assert.deepEqual(Object.keys(neighborItems[0]).sort(), [
    "action",
    "createdAt",
    "id",
    "metadata",
  ]);
  assert.equal((await request("GET", "/auth/security-events")).status, 401);
  const client = await pool.connect();
  try {
    assert.equal(
      (await client.query("SELECT count(*)::int AS n FROM account_mfa")).rows[0]
        .n,
      0,
    );
    assert.equal(
      (
        await client.query(
          "SELECT count(*)::int AS n FROM account_security_events",
        )
      ).rows[0].n,
      0,
    );
    await assert.rejects(
      client.query(
        "UPDATE account_security_events SET action='MFA_DISABLED' WHERE id=$1",
        [response.body.items[0].id],
      ),
      /permission denied/,
    );
  } finally {
    client.release();
  }
  await assert.rejects(
    db.query("DELETE FROM account_security_events WHERE id=$1", [
      response.body.items[0].id,
    ]),
    /Append-only/,
  );
});

test("MFA-UNAVAILABLE: missing or wrong encryption key fails closed; unprotected accounts can still log in", async () => {
  const user = await createUser("unavailable"),
    enrolled = await enroll(user),
    plain = await createUser("plain"),
    token = await challenge(user);
  const key = process.env.MFA_ENCRYPTION_KEY;
  try {
    delete process.env.MFA_ENCRYPTION_KEY;
    assert.equal(
      (await request("GET", "/auth/mfa", undefined, user.session)).body
        .available,
      false,
    );
    assert.equal(
      (await request("POST", "/auth/login", { email: user.email, password }))
        .status,
      503,
    );
    assert.equal(
      (
        await request(
          "POST",
          "/auth/mfa/enrollment",
          { currentPassword: password },
          plain.session,
        )
      ).status,
      503,
    );
    assert.ok(
      (await request("POST", "/auth/login", { email: plain.email, password }))
        .body.csrfToken,
    );
    process.env.MFA_ENCRYPTION_KEY = randomBytes(32).toString("hex");
    assert.equal(
      (
        await verify(
          token,
          totpCode(enrolled.secret, Math.floor(Date.now() / 30_000) + 1),
        )
      ).status,
      503,
    );
  } finally {
    process.env.MFA_ENCRYPTION_KEY = key;
  }
});
