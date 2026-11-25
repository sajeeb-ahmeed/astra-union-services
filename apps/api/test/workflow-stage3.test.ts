import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { demoPayloads } from "@astra/shared-schemas";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";

// Phase 4 Stage 3 workflows — Batch A: S-011 (per-service authorization on
// negative decisions), A-015 (cancel from RESUBMITTED), W-023 (correction
// cycle cap), W-011 (awaiting-citizen queue group).
process.env.NODE_ENV = "test";
let server: ReturnType<typeof app.listen>, base: string, citizenId: string;
type Session = { cookie: string; csrf: string };
const s: Record<string, Session> = {};
const admin = new pg.Pool({ connectionString: adminConnectionString });
async function req(method: string, path: string, data?: unknown, who?: string) {
  const session = who ? s[who] : undefined;
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      ...(session ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return { status: response.status, body: await response.json() };
}
async function login(name: string) {
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `${name}@alpha.local.test`, password: "Demo-Phase1!" }),
  });
  const json = await r.json();
  assert.equal(r.status, 200, JSON.stringify(json));
  s[name] = { cookie: r.headers.get("set-cookie")!.split(";")[0], csrf: json.csrfToken };
}
async function submittedApplication(serviceNo = 45) {
  const created = await req("POST", "/applications", { citizenId, serviceNo, payload: demoPayloads[serviceNo] }, "staff");
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id as string;
  const submitted = await req("POST", `/applications/${id}/transition`, { action: "submit" }, "staff");
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  assert.equal(submitted.body.state, "SUBMITTED");
  return id;
}
async function setApproverAuthorization(serviceNo: number, active: boolean) {
  const approverId = (
    await admin.query("SELECT id FROM platform_users WHERE email='approver@alpha.local.test'")
  ).rows[0].id;
  const tenantId = (
    await admin.query("SELECT tenant_id FROM staff_memberships WHERE user_id=$1", [approverId])
  ).rows[0].tenant_id;
  await admin.query(
    "UPDATE approval_authorizations SET active=$1 WHERE tenant_id=$2 AND user_id=$3 AND service_no=$4",
    [active, tenantId, approverId, serviceNo],
  );
}

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  for (const name of ["staff", "reviewer", "approver", "citizen"]) await login(name);
  citizenId = (await req("GET", "/citizens", undefined, "citizen")).body.items[0].id;
});

after(async () => {
  // S-011's negative test toggles the authorization off and back on inside the
  // test itself; this is a backstop so a failure mid-test cannot leave the
  // seeded approver unauthorized for the rest of the suite.
  await setApproverAuthorization(45, true);
  server.close();
  await admin.end();
  await pool.end();
});

test("S-011: approver without service authorization gets 403 on reject and correction", async () => {
  const id = await submittedApplication(45);
  try {
    await setApproverAuthorization(45, false);
    const rejected = await req("POST", `/applications/${id}/transition`, { action: "reject", reason: "test rejection" }, "approver");
    assert.equal(rejected.status, 403, JSON.stringify(rejected.body));
    assert.equal(rejected.body.error.code, "APPROVAL_AUTHORITY_REQUIRED");
    const corrected = await req("POST", `/applications/${id}/transition`, { action: "request_correction", reason: "test correction" }, "approver");
    assert.equal(corrected.status, 403, JSON.stringify(corrected.body));
    assert.equal(corrected.body.error.code, "APPROVAL_AUTHORITY_REQUIRED");
  } finally {
    await setApproverAuthorization(45, true);
  }
  // With the authorization restored, the same decision succeeds.
  const rejected = await req("POST", `/applications/${id}/transition`, { action: "reject", reason: "test rejection" }, "approver");
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
  assert.equal(rejected.body.state, "REJECTED");
});

test("S-011: reviewer gets 403 on reject and correction (approver-only since Phase W)", async () => {
  const id = await submittedApplication(45);
  const rejected = await req("POST", `/applications/${id}/transition`, { action: "reject", reason: "test rejection" }, "reviewer");
  assert.equal(rejected.status, 403, JSON.stringify(rejected.body));
  assert.equal(rejected.body.error.code, "ROLE_DENIED");
  const corrected = await req("POST", `/applications/${id}/transition`, { action: "request_correction", reason: "test correction" }, "reviewer");
  assert.equal(corrected.status, 403, JSON.stringify(corrected.body));
  assert.equal(corrected.body.error.code, "ROLE_DENIED");
});

test("W-011: counts expose awaitingCitizen for CORRECTION_REQUIRED applications", async () => {
  const beforeCounts = (await req("GET", "/applications/counts", undefined, "approver")).body;
  const id = await submittedApplication(45);
  const corrected = await req("POST", `/applications/${id}/transition`, { action: "request_correction", reason: "needs a fix" }, "approver");
  assert.equal(corrected.status, 200, JSON.stringify(corrected.body));
  const afterCounts = (await req("GET", "/applications/counts", undefined, "approver")).body;
  assert.equal(afterCounts.awaitingCitizen, beforeCounts.awaitingCitizen + 1);
  assert.equal(afterCounts.awaitingCitizen, afterCounts.counts.CORRECTION_REQUIRED);
  // The awaiting-citizen group is not office-pending work: the two office
  // groups do not absorb it.
  assert.equal(afterCounts.awaitingReview, beforeCounts.awaitingReview);
});

test("A-015: a resubmitted application can be cancelled by the citizen", async () => {
  const id = await submittedApplication(45);
  const corrected = await req("POST", `/applications/${id}/transition`, { action: "request_correction", reason: "needs a fix" }, "approver");
  assert.equal(corrected.status, 200, JSON.stringify(corrected.body));
  const edited = await req("PATCH", `/applications/${id}`, { payload: demoPayloads[45] }, "citizen");
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  const resubmitted = await req("POST", `/applications/${id}/transition`, { action: "resubmit" }, "citizen");
  assert.equal(resubmitted.status, 200, JSON.stringify(resubmitted.body));
  assert.equal(resubmitted.body.state, "RESUBMITTED");
  const cancelled = await req("POST", `/applications/${id}/transition`, { action: "cancel", reason: "withdrawing the application" }, "citizen");
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.state, "CANCELLED");
});

test("A-015: cancel from a terminal state is still rejected", async () => {
  const id = await submittedApplication(45);
  const rejected = await req("POST", `/applications/${id}/transition`, { action: "reject", reason: "not eligible" }, "approver");
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
  const cancelled = await req("POST", `/applications/${id}/transition`, { action: "cancel", reason: "too late" }, "citizen");
  assert.equal(cancelled.status, 409, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.error.code, "STATE_CONFLICT");
});

test("W-023: correction cycles cap at 3, then the Chairman must decide", async () => {
  const id = await submittedApplication(45);
  for (let cycle = 1; cycle <= 3; cycle++) {
    const corrected = await req("POST", `/applications/${id}/transition`, { action: "request_correction", reason: `fix round ${cycle}` }, "approver");
    assert.equal(corrected.status, 200, JSON.stringify(corrected.body));
    assert.equal(corrected.body.state, "CORRECTION_REQUIRED");
    assert.equal(corrected.body.correctionCount, cycle, `cycle ${cycle} count`);
    const edited = await req("PATCH", `/applications/${id}`, { payload: demoPayloads[45] }, "citizen");
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    const resubmitted = await req("POST", `/applications/${id}/transition`, { action: "resubmit" }, "citizen");
    assert.equal(resubmitted.status, 200, JSON.stringify(resubmitted.body));
    assert.equal(resubmitted.body.state, "RESUBMITTED");
  }
  const fourth = await req("POST", `/applications/${id}/transition`, { action: "request_correction", reason: "one more fix" }, "approver");
  assert.equal(fourth.status, 409, JSON.stringify(fourth.body));
  assert.equal(fourth.body.error.code, "CORRECTION_LIMIT_REACHED");
  // The cap is recorded as an event, and the Chairman can still decide.
  const tenantId = (await admin.query("SELECT id FROM tenants WHERE slug='alpha'")).rows[0].id;
  const limitEvents = await admin.query(
    "SELECT 1 FROM outbox_events WHERE tenant_id=$1 AND resource_id=$2 AND kind='APPLICATION_CORRECTION_LIMIT'",
    [tenantId, id],
  );
  assert.equal(limitEvents.rowCount, 1, "one APPLICATION_CORRECTION_LIMIT event");
  const rejected = await req("POST", `/applications/${id}/transition`, { action: "reject", reason: "cannot be corrected" }, "approver");
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
  assert.equal(rejected.body.state, "REJECTED");
});
