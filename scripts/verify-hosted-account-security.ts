/** Existing synthetic QA accounts only. Never rotate a hosted password or create financial records. */
import fs from "node:fs";
import assert from "node:assert/strict";
import { qaOutput } from "./qa-output.js";

const url = new URL(process.env.ASTRA_LIVE_URL ?? "");
assert.equal(url.protocol, "https:");
assert.equal(url.pathname, "/");
assert.equal(url.username + url.password + url.search + url.hash, "");
const base = url.origin;
const config = JSON.parse(
  fs.readFileSync(".runtime/hosted/credentials.json", "utf8"),
);
assert.equal(config.publicOrigin, base);
const prior = JSON.parse(
  fs.readFileSync("execution/hosted-orders-qa.json", "utf8"),
);
const qa = JSON.parse(
  fs.readFileSync(".runtime/hosted/qa-credentials.json", "utf8"),
).runs.find((run: any) => run.runId === prior.runId);
assert.equal(prior.status, "PASS");
assert.equal(qa.kind, "HOSTED_ORDERS_QA");
assert.equal(qa.baseUrl, base);
assert.equal(qa.lastStatus, "PASS");
const output = qaOutput("security-hosted-qa.json");
const evidence: any = {
  startedAt: new Date().toISOString(),
  baseUrl: base,
  sourceRunId: qa.runId,
  status: "RUNNING",
  scope:
    "Existing synthetic QA staff session revocation and audit only. No password changes, citizen/financial records or provider calls.",
  checks: [],
};
type Session = { cookie: string; csrf: string };
const sessions: Record<string, Session> = {};
const save = () =>
  fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + "\n");
async function request(
  method: string,
  route: string,
  session?: Session,
  body?: unknown,
  csrf = true,
) {
  assert.ok(
    [
      "/auth/login",
      "/auth/logout",
      "/auth/me",
      "/auth/sessions",
      "/auth/sessions/revoke-others",
      "/payments/configuration",
    ].includes(route),
  );
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
            ...(csrf ? { "X-CSRF-Token": session.csrf } : {}),
          }
        : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json(),
  };
}
async function check(name: string, action: () => Promise<unknown>) {
  try {
    evidence.checks.push({ name, status: "PASS", evidence: await action() });
    console.log(`PASS ${name}`);
  } catch {
    evidence.checks.push({ name, status: "FAIL" });
    throw Error(`${name} failed; response values withheld.`);
  } finally {
    save();
  }
}
try {
  await check(
    "01 Secure login and aggregate self-session summary",
    async () => {
      for (const [key, role] of [
        ["staffOther", "staff"],
        ["staff", "staff"],
        ["admin", "admin"],
      ]) {
        const account = qa.accounts[role];
        const response = await request("POST", "/auth/login", undefined, {
          email: account.email,
          password: account.password,
        });
        assert.equal(response.status, 200);
        assert.equal(response.body.user.tenantId, qa.offices.primary.id);
        const cookie = response.headers.get("set-cookie")!;
        assert.match(cookie, /Secure/);
        assert.match(cookie, /HttpOnly/);
        assert.match(cookie, /SameSite=Strict/);
        sessions[key] = {
          cookie: cookie.split(";")[0],
          csrf: response.body.csrfToken,
        };
      }
      const summary = await request("GET", "/auth/sessions", sessions.staff);
      assert.equal(summary.status, 200);
      assert.ok(summary.body.otherSessions >= 1);
      assert.deepEqual(Object.keys(summary.body).sort(), [
        "activeSessions",
        "currentSessionExpiresAt",
        "otherSessions",
      ]);
      assert.equal(summary.body.activeSessions, summary.body.otherSessions + 1);
      return {
        secureCookies: true,
        aggregateOnly: true,
        multipleSyntheticSessions: true,
      };
    },
  );
  await check(
    "02 Missing session, CSRF and wrong password denied",
    async () => {
      assert.equal((await request("GET", "/auth/sessions")).status, 401);
      assert.equal(
        (
          await request(
            "POST",
            "/auth/sessions/revoke-others",
            sessions.staff,
            { currentPassword: qa.accounts.staff.password },
            false,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            "POST",
            "/auth/sessions/revoke-others",
            sessions.staff,
            { currentPassword: "deliberately-incorrect-synthetic-password" },
          )
        ).status,
        422,
      );
      assert.equal(
        (await request("GET", "/auth/me", sessions.staffOther)).status,
        200,
      );
      return {
        unauthenticated: 401,
        csrf: 403,
        wrongPassword: 422,
        otherSessionPreserved: true,
      };
    },
  );
  await check(
    "03 Revoke others preserves current and different account sessions",
    async () => {
      const result = await request(
        "POST",
        "/auth/sessions/revoke-others",
        sessions.staff,
        { currentPassword: qa.accounts.staff.password },
      );
      assert.equal(result.status, 200);
      assert.ok(result.body.revoked >= 1);
      assert.equal(result.body.remainingSessions, 1);
      assert.equal(
        (await request("GET", "/auth/me", sessions.staffOther)).status,
        401,
      );
      assert.equal(
        (await request("GET", "/auth/me", sessions.admin)).status,
        200,
      );
      const summary = await request("GET", "/auth/sessions", sessions.staff);
      assert.equal(summary.status, 200);
      assert.equal(summary.body.otherSessions, 0);
      assert.equal(summary.body.activeSessions, 1);
      return {
        revoked: result.body.revoked,
        currentPreserved: true,
        otherAccountPreserved: true,
      };
    },
  );
  await check("04 Payment collection stays disabled", async () => {
    const result = await request(
      "GET",
      "/payments/configuration",
      sessions.admin,
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.available, false);
    assert.equal(result.body.configured, false);
    assert.equal(result.body.environment, "DISABLED");
    return { collectionEnabled: false };
  });
  evidence.status = "PASS";
} catch (reason) {
  evidence.status = "FAIL";
  console.error((reason as Error).message);
  process.exitCode = 1;
} finally {
  evidence.loggedOut = [];
  for (const key of ["staff", "admin"])
    if (sessions[key]) {
      try {
        if (
          (await request("POST", "/auth/logout", sessions[key], {})).status ===
          200
        )
          evidence.loggedOut.push(key);
      } catch {
        /* No mutation retry. */
      }
    }
  evidence.finishedAt = new Date().toISOString();
  save();
}
