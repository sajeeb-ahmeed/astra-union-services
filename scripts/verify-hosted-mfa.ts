/** Release-0.8 hosted acceptance. Creates one named synthetic account, then deactivates it. */
import fs from "node:fs";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { totpCode } from "../apps/api/src/mfa-crypto.js";
import { qaOutput } from "./qa-output.js";

const url = new URL(process.env.ASTRA_LIVE_URL ?? "");
assert.equal(url.protocol, "https:");
assert.equal(url.pathname, "/");
assert.equal(url.username + url.password + url.search + url.hash, "");
const base = url.origin;
const config = JSON.parse(
  fs.readFileSync(".runtime/hosted/credentials.json", "utf8"),
);
assert.equal(base, config.publicOrigin);
const source = JSON.parse(
  fs.readFileSync("execution/hosted-orders-qa.json", "utf8"),
);
assert.equal(source.status, "PASS");
const qa = JSON.parse(
  fs.readFileSync(".runtime/hosted/qa-credentials.json", "utf8"),
).runs.find((r: any) => r.runId === source.runId);
assert.equal(qa.kind, "HOSTED_ORDERS_QA");
assert.equal(qa.baseUrl, base);
assert.equal(qa.lastStatus, "PASS");
const output = qaOutput("recovery-mfa-hosted-auth.json");
const id = `${Date.now()}-${randomBytes(3).toString("hex")}`;
const privateFile = `.runtime/hosted/mfa-qa-${id}.json`;
const fixture: any = {
  baseUrl: base,
  kind: "SYNTHETIC_MFA_QA",
  email: `mfa-qa-${id}@synthetic.example.test`,
  password: randomBytes(24).toString("hex"),
};
const evidence: any = {
  release: "0.8.0",
  baseUrl: base,
  startedAt: new Date().toISOString(),
  status: "RUNNING",
  scope:
    "One new synthetic staff account in an existing QA office; MFA setup/login/recovery/disable plus immutable security events. Account deactivated at cleanup; no applications, payments, fees, certificates or credits modified.",
  checks: [],
};
type Session = { cookie: string; csrf: string };
let admin: Session | undefined,
  user: Session | undefined,
  enabled = false,
  creationAttempted = false,
  activatedCounter = -1,
  stage = "preflight";
const sessions: Session[] = [];
const save = () =>
  fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + "\n");
const savePrivate = () =>
  fs.writeFileSync(privateFile, JSON.stringify(fixture, null, 2), {
    mode: 0o600,
  });
const allowed = new Set([
  "/auth/login",
  "/auth/logout",
  "/auth/me",
  "/auth/mfa",
  "/auth/mfa/enrollment",
  "/auth/mfa/activate",
  "/auth/mfa/verify",
  "/auth/mfa/disable",
  "/auth/mfa/recovery-codes",
  "/auth/security-events",
  "/payments/configuration",
  "/admin/users",
]);
async function request(
  method: string,
  route: string,
  body?: unknown,
  session?: Session,
  withCsrf = true,
) {
  assert.ok(allowed.has(route) || route === `/admin/users/${fixture.userId}`);
  const response = await fetch(`${base}/api/v1${route}`, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(45000),
    headers: {
      Origin: base,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(session
        ? {
            Cookie: session.cookie,
            ...(withCsrf ? { "X-CSRF-Token": session.csrf } : {}),
          }
        : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json(),
    headers: response.headers,
  };
}
function session(response: Awaited<ReturnType<typeof request>>) {
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie")!;
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  const result = {
    cookie: cookie.split(";")[0]!,
    csrf: response.body.csrfToken,
  };
  sessions.push(result);
  return result;
}
async function check(name: string, action: () => Promise<void>) {
  stage = name;
  try {
    await action();
    evidence.checks.push({ name, status: "PASS" });
    console.log(`PASS ${name}`);
  } catch {
    evidence.checks.push({ name, status: "FAIL" });
    throw Error("Hosted MFA acceptance failed; sensitive responses withheld.");
  } finally {
    save();
  }
}
try {
  await check(
    "01 Dedicated synthetic account and optional MFA baseline",
    async () => {
      admin = session(
        await request("POST", "/auth/login", {
          email: qa.accounts.admin.email,
          password: qa.accounts.admin.password,
        }),
      );
      savePrivate();
      creationAttempted = true;
      const created = await request(
        "POST",
        "/admin/users",
        {
          email: fixture.email,
          password: fixture.password,
          displayName: "Synthetic MFA acceptance",
          role: "staff",
        },
        admin,
      );
      assert.equal(created.status, 201);
      fixture.userId = created.body.id;
      savePrivate();
      user = session(
        await request("POST", "/auth/login", {
          email: fixture.email,
          password: fixture.password,
        }),
      );
      const state = await request("GET", "/auth/mfa", undefined, user);
      assert.equal(state.status, 200);
      assert.equal(state.body.enabled, false);
      assert.equal(state.body.available, true);
    },
  );
  await check(
    "02 Password, CSRF, missing-session and secret-cache boundaries",
    async () => {
      assert.equal((await request("GET", "/auth/mfa")).status, 401);
      assert.equal(
        (
          await request(
            "POST",
            "/auth/mfa/enrollment",
            { currentPassword: fixture.password },
            user,
            false,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            "POST",
            "/auth/mfa/enrollment",
            { currentPassword: "incorrect-synthetic-password" },
            user,
          )
        ).status,
        422,
      );
      const setup = await request(
        "POST",
        "/auth/mfa/enrollment",
        { currentPassword: fixture.password },
        user,
      );
      assert.equal(setup.status, 201);
      assert.match(setup.headers.get("cache-control") ?? "", /no-store/);
      assert.match(setup.body.secret, /^[A-Z2-7]{32}$/);
      assert.match(setup.body.qrDataUrl, /^data:image\/png;base64,/);
      fixture.secret = setup.body.secret;
      savePrivate();
      const state = await request("GET", "/auth/mfa", undefined, user);
      assert.equal(state.body.enabled, false);
      assert.equal(state.body.secret, undefined);
      assert.equal(state.body.qrDataUrl, undefined);
    },
  );
  await check(
    "03 Activate with real TOTP and return recovery codes once",
    async () => {
      // Keep a full accepted window for slow hosted responses; login waits for the next step.
      const remaining = 30000 - (Date.now() % 30000);
      if (remaining < 5000)
        await new Promise((r) => setTimeout(r, remaining + 250));
      activatedCounter = Math.floor(Date.now() / 30000);
      const code = totpCode(fixture.secret, activatedCounter);
      const active = await request(
        "POST",
        "/auth/mfa/activate",
        { code },
        user,
      );
      assert.equal(active.status, 200);
      assert.equal(active.body.enabled, true);
      enabled = true;
      fixture.recoveryCodes = active.body.recoveryCodes;
      savePrivate();
      assert.equal(fixture.recoveryCodes.length, 10);
      assert.match(active.headers.get("cache-control") ?? "", /no-store/);
      const state = await request("GET", "/auth/mfa", undefined, user);
      assert.equal(state.body.recoveryCodesRemaining, 10);
      assert.equal(state.body.recoveryCodes, undefined);
    },
  );
  await check(
    "04 Password-only challenge grants no session; current TOTP completes login",
    async () => {
      if (Math.floor(Date.now() / 30000) <= activatedCounter)
        await new Promise((r) =>
          setTimeout(r, (activatedCounter + 1) * 30000 - Date.now() + 250),
        );
      const login = await request("POST", "/auth/login", {
        email: fixture.email,
        password: fixture.password,
      });
      assert.equal(login.body.mfaRequired, true);
      assert.equal(login.headers.get("set-cookie"), null);
      assert.equal(login.body.user, undefined);
      assert.equal((await request("GET", "/auth/me")).status, 401);
      const code = totpCode(fixture.secret, Math.floor(Date.now() / 30000));
      const success = await request("POST", "/auth/mfa/verify", {
        challengeToken: login.body.challengeToken,
        code,
      });
      user = session(success);
      assert.equal(
        (
          await request("POST", "/auth/mfa/verify", {
            challengeToken: login.body.challengeToken,
            code,
          })
        ).status,
        422,
      );
    },
  );
  await check(
    "05 Concurrent recovery-code use succeeds exactly once",
    async () => {
      const login = await request("POST", "/auth/login", {
        email: fixture.email,
        password: fixture.password,
      });
      const body = {
        challengeToken: login.body.challengeToken,
        code: fixture.recoveryCodes[0],
      };
      const results = await Promise.all([
        request("POST", "/auth/mfa/verify", body),
        request("POST", "/auth/mfa/verify", body),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 422]);
      user = session(results.find((r) => r.status === 200)!);
      fixture.recoveryCodes.shift();
      savePrivate();
      assert.equal(
        (await request("GET", "/auth/mfa", undefined, user)).body
          .recoveryCodesRemaining,
        9,
      );
    },
  );
  await check(
    "06 Own-account security events disclose no secret material",
    async () => {
      const events = await request(
        "GET",
        "/auth/security-events",
        undefined,
        user,
      );
      assert.equal(events.status, 200);
      assert.ok(events.body.items.some((e: any) => e.action === "MFA_ENABLED"));
      assert.ok(
        events.body.items.some((e: any) => e.action === "MFA_LOGIN_SUCCEEDED"),
      );
      assert.ok(
        events.body.items.some(
          (e: any) => e.action === "MFA_RECOVERY_CODE_USED",
        ),
      );
      const serialized = JSON.stringify(events.body);
      for (const secret of [
        fixture.password,
        fixture.secret,
        ...fixture.recoveryCodes,
      ])
        assert.ok(!serialized.includes(secret));
      const other = await request(
        "GET",
        "/auth/security-events",
        undefined,
        admin,
      );
      assert.ok(
        other.body.items.every(
          (e: any) => !events.body.items.some((mine: any) => mine.id === e.id),
        ),
      );
    },
  );
  await check(
    "07 Password plus recovery factor disables MFA and collection stays off",
    async () => {
      const disabled = await request(
        "POST",
        "/auth/mfa/disable",
        { currentPassword: fixture.password, code: fixture.recoveryCodes[0] },
        user,
      );
      assert.equal(disabled.status, 200);
      assert.equal(disabled.body.enabled, false);
      enabled = false;
      fixture.recoveryCodes = [];
      delete fixture.secret;
      savePrivate();
      assert.equal(
        (await request("GET", "/auth/mfa", undefined, user)).body.enabled,
        false,
      );
      const payment = await request(
        "GET",
        "/payments/configuration",
        undefined,
        admin,
      );
      assert.equal(payment.status, 200);
      assert.equal(payment.body.environment, "DISABLED");
      assert.equal(payment.body.available, false);
      assert.equal(payment.body.configured, false);
    },
  );
  evidence.status = "PASS";
} catch {
  evidence.status = "FAIL";
  evidence.failedStage = stage;
  process.exitCode = 1;
  console.error(
    `MFA verification failed at ${stage}; response values withheld.`,
  );
} finally {
  let cleaned = true;
  let creationResolved = !creationAttempted || Boolean(fixture.userId);
  if (creationAttempted && !fixture.userId && admin) {
    try {
      const users = await request("GET", "/admin/users", undefined, admin);
      assert.equal(users.status, 200);
      assert.ok(Array.isArray(users.body.items));
      const exact = users.body.items.filter(
        (item: any) => item.email === fixture.email,
      );
      assert.ok(exact.length <= 1);
      if (exact.length === 1) {
        fixture.userId = exact[0].id;
        savePrivate();
      }
      creationResolved = true;
    } catch {
      cleaned = false;
    }
  }
  if (enabled && user && fixture.recoveryCodes?.length) {
    try {
      const r = await request(
        "POST",
        "/auth/mfa/disable",
        {
          currentPassword: fixture.password,
          code: fixture.recoveryCodes.at(-1),
        },
        user,
      );
      cleaned = r.status === 200;
      enabled = !cleaned;
    } catch {
      cleaned = false;
    }
  }
  if (fixture.userId && admin) {
    try {
      cleaned =
        (
          await request(
            "PATCH",
            `/admin/users/${fixture.userId}`,
            { active: false },
            admin,
          )
        ).status === 200 && cleaned;
    } catch {
      cleaned = false;
    }
  }
  for (const s of sessions) {
    try {
      const r = await request("POST", "/auth/logout", {}, s);
      if (![200, 401].includes(r.status)) cleaned = false;
    } catch {
      cleaned = false;
    }
  }
  cleaned = cleaned && creationResolved;
  evidence.cleanup = cleaned
    ? fixture.userId
      ? "SYNTHETIC_ACCOUNT_DEACTIVATED_AND_SESSIONS_CLOSED"
      : "NO_SYNTHETIC_ACCOUNT_CREATED_AND_SESSIONS_CLOSED"
    : "REQUIRES_OPERATOR_REVIEW";
  if (!cleaned) {
    evidence.status = "FAIL";
    process.exitCode = 1;
  }
  if (cleaned) {
    delete fixture.secret;
    fixture.recoveryCodes = [];
  }
  fixture.cleanup = evidence.cleanup;
  savePrivate();
  evidence.finishedAt = new Date().toISOString();
  save();
}
