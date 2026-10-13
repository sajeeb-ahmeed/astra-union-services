/**
 * Verify persisted hosted QA data after a redeploy without creating domain records.
 * ASTRA_LIVE_URL=https://your-app.onrender.com npx tsx scripts/verify-hosted-readback.ts
 * Only login/logout mutate remote session state. Credentials stay under .runtime/hosted/.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";

const supplied = process.env.ASTRA_LIVE_URL;
assert.ok(
  supplied,
  "Set ASTRA_LIVE_URL to the authorized deployed HTTPS origin.",
);
const url = new URL(supplied);
assert.equal(url.protocol, "https:");
assert.equal(url.username + url.password + url.search + url.hash, "");
assert.equal(url.pathname, "/");
const base = url.origin;
const privateConfig = JSON.parse(
  fs.readFileSync(".runtime/hosted/credentials.json", "utf8"),
);
assert.equal(
  base,
  privateConfig.publicOrigin,
  "Origin must match the authorized origin bound to private credentials.",
);
const original = JSON.parse(
  fs.readFileSync("execution/hosted-qa.json", "utf8"),
);
assert.equal(original.status, "PASS", "Initial hosted QA must have passed.");
assert.equal(original.baseUrl, base);
const privateRuns = JSON.parse(
  fs.readFileSync(".runtime/hosted/qa-credentials.json", "utf8"),
);
const qa = privateRuns.runs.find((item: any) => item.runId === original.runId);
assert.ok(
  qa,
  "No matching private credentials for the original hosted QA run.",
);
assert.equal(qa.baseUrl, base);
assert.equal(qa.lastStatus, "PASS");
const originalCheck = (prefix: string) => {
  const record = original.checks.find((item: any) =>
    item.name.startsWith(prefix),
  );
  assert.ok(
    record?.status === "PASS",
    `Missing original evidence for check ${prefix}.`,
  );
  return record.evidence;
};
const expected = originalCheck("13 ");
const applicationId = originalCheck("07 ").applicationId;
assert.equal(applicationId, qa.applicationId);
assert.equal(expected.certificateId, qa.certificateId);
assert.equal(expected.balanceAfter, 24);
assert.equal(expected.issuanceEntries, 1);
const publicLink = new URL(original.verificationUrl);
assert.equal(publicLink.origin, base);
assert.match(publicLink.pathname, /^\/verify\/[a-f0-9]{64}$/);
type Session = { cookie: string; csrf: string };
const sessions: Record<string, Session> = {};
const evidence: any = {
  sourceRunId: original.runId,
  baseUrl: base,
  startedAt: new Date().toISOString(),
  status: "RUNNING",
  mutationScope:
    "Login and logout sessions only; existing QA domain records are read-only.",
  checks: [],
};
const file = "execution/hosted-redeploy-qa.json";
const save = () => fs.writeFileSync(file, JSON.stringify(evidence, null, 2));
save();
async function request(
  method: "GET" | "POST",
  route: string,
  role?: string,
  body?: unknown,
) {
  assert.ok(route.startsWith("/") && !route.startsWith("//"));
  assert.ok(
    method === "GET" || ["/auth/login", "/auth/logout"].includes(route),
    "Readback must not mutate domain data.",
  );
  const session = role ? sessions[role] : undefined;
  const response = await fetch(`${base}/api/v1${route}`, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(180_000),
    headers: {
      Origin: base,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(session
        ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf }
        : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(
    response.status,
    200,
    `${method} ${route} must return HTTP 200.`,
  );
  return {
    headers: response.headers,
    body: response.headers.get("content-type")?.includes("application/json")
      ? await response.json()
      : Buffer.from(await response.arrayBuffer()),
  };
}
async function check(name: string, run: () => Promise<unknown>) {
  const start = Date.now();
  try {
    evidence.checks.push({
      name,
      status: "PASS",
      evidence: await run(),
      durationMs: Date.now() - start,
    });
    save();
    console.log(`PASS ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Readback failed.";
    evidence.checks.push({
      name,
      status: "FAIL",
      message,
      durationMs: Date.now() - start,
    });
    save();
    throw new Error(`${name}: ${message}`);
  }
}
try {
  await check("01 PostgreSQL is healthy after redeployment", async () => {
    const r = await request("GET", "/health");
    assert.equal(r.body.status, "ok");
    assert.equal(r.body.database, "PostgreSQL");
    assert.equal(r.body.mode, "DEMO_ONLY");
    return { database: "PostgreSQL", status: "ok" };
  });
  await check(
    "02 Existing citizen and finance accounts still authenticate securely",
    async () => {
      for (const role of ["citizen", "finance"]) {
        const account = qa.accounts[role];
        assert.ok(
          typeof account?.email === "string" &&
            typeof account?.password === "string",
        );
        const r = await request("POST", "/auth/login", undefined, {
          email: account.email,
          password: account.password,
        });
        const cookie = r.headers.get("set-cookie");
        assert.ok(
          cookie &&
            cookie.includes("Secure") &&
            cookie.includes("HttpOnly") &&
            cookie.includes("SameSite=Strict"),
        );
        assert.equal(r.body.user.role, role);
        assert.equal(r.body.user.tenantId, qa.offices.primary.id);
        assert.ok(typeof r.body.csrfToken === "string");
        sessions[role] = {
          cookie: cookie.split(";")[0]!,
          csrf: r.body.csrfToken,
        };
      }
      return {
        roles: ["citizen", "finance"],
        samePrimaryOffice: true,
        secureCookie: true,
      };
    },
  );
  await check(
    "03 Existing wallet retains 24 credits and one issuance debit",
    async () => {
      const r = await request("GET", "/wallet", "finance");
      assert.equal(r.body.balance, expected.balanceAfter);
      const debits = r.body.ledger.filter(
        (item: any) => item.kind === "ISSUANCE",
      );
      assert.equal(debits.length, expected.issuanceEntries);
      assert.equal(debits[0].delta, -expected.deductedCredits);
      assert.equal(r.body.ledger.length, 3);
      assert.equal(r.body.subscription.status, "ACTIVE");
      return {
        balance: r.body.balance,
        issuanceEntries: debits.length,
        issuanceDelta: debits[0].delta,
        totalLedgerEntries: r.body.ledger.length,
      };
    },
  );
  await check(
    "04 Same issued application, certificate and audit transitions persist",
    async () => {
      const r = await request(
        "GET",
        `/applications/${applicationId}`,
        "citizen",
      );
      assert.equal(r.body.application.state, "ISSUED");
      assert.equal(r.body.certificate.id, expected.certificateId);
      assert.equal(r.body.certificate.applicationId, applicationId);
      assert.equal(
        r.body.certificate.verificationUrl,
        original.verificationUrl,
      );
      for (const action of ["create", "submit", "review", "approve", "issue"])
        assert.equal(
          r.body.events.filter((item: any) => item.action === action).length,
          1,
        );
      assert.equal(r.body.events.length, 5);
      return {
        applicationId,
        certificateId: r.body.certificate.id,
        state: "ISSUED",
        unchangedEventCount: 5,
      };
    },
  );
  await check("05 Stored PDF remains byte-for-byte identical", async () => {
    const r = await request(
      "GET",
      `/certificates/${expected.certificateId}/pdf`,
      "citizen",
    );
    assert.ok(Buffer.isBuffer(r.body));
    assert.equal(r.body.subarray(0, 5).toString(), "%PDF-");
    const hash = createHash("sha256").update(r.body).digest("hex");
    assert.equal(hash, original.artifacts.pdf.sha256);
    assert.equal(r.body.length, original.artifacts.pdf.bytes);
    return {
      certificateId: expected.certificateId,
      sha256: hash,
      bytes: r.body.length,
      identicalToInitialDownload: true,
    };
  });
  await check(
    "06 Existing public QR verification and tracking remain minimal",
    async () => {
      const verified = await request("GET", publicLink.pathname);
      assert.equal(verified.body.status, "ISSUED");
      assert.equal(verified.body.serviceNo, 45);
      assert.equal(verified.body.demo, true);
      assert.deepEqual(
        Object.keys(verified.body).sort(),
        [
          "status",
          "officeBn",
          "officeEn",
          "serviceNo",
          "serviceBn",
          "serviceEn",
          "issuedAt",
          "demo",
        ].sort(),
      );
      const tracked = await request("GET", `/track/${applicationId}`);
      assert.equal(tracked.body.status, "ISSUED");
      assert.deepEqual(
        Object.keys(tracked.body).sort(),
        [
          "status",
          "officeBn",
          "officeEn",
          "serviceNo",
          "serviceBn",
          "serviceEn",
          "createdAt",
          "demo",
        ].sort(),
      );
      return {
        verificationStatus: "ISSUED",
        trackingStatus: "ISSUED",
        publicVerificationFields: Object.keys(verified.body),
        publicTrackingFields: Object.keys(tracked.body),
      };
    },
  );
  evidence.status = "PASS";
} catch (error) {
  evidence.status = "FAIL";
  console.error(
    error instanceof Error ? error.message : "Hosted readback failed.",
  );
  process.exitCode = 1;
} finally {
  const loggedOut: string[] = [];
  for (const role of Object.keys(sessions)) {
    try {
      await request("POST", "/auth/logout", role, {});
      loggedOut.push(role);
    } catch {
      /* No retry after a mutation with an unknown remote outcome. */
    }
  }
  evidence.loggedOutRoles = loggedOut;
  evidence.finishedAt = new Date().toISOString();
  evidence.passed = evidence.checks.filter(
    (item: any) => item.status === "PASS",
  ).length;
  evidence.failed = evidence.checks.filter(
    (item: any) => item.status === "FAIL",
  ).length;
  save();
  console.log(
    `${evidence.status}: ${evidence.passed} post-redeploy checks passed; ${evidence.failed} failed. Evidence: ${file}`,
  );
}
