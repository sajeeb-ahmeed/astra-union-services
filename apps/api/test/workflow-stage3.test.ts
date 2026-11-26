import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { randomUUID } from "node:crypto";
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
  for (const name of ["staff", "reviewer", "approver", "citizen", "admin"]) await login(name);
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

// --- Batch B: S-010 (identity-number access), W-013 (partial drafts), W-014 (re-apply) ---

test("S-010: plain staff cannot read full identity numbers; approver can, masked on request", async () => {
  // Put numbers on the seeded citizen's record first (admin may write them).
  const updated = await req("PATCH", `/citizens/${citizenId}/details`, { nid: "1234567890", birthReg: "19950101123456789" }, "admin");
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  const staffRead = await req("GET", `/citizens/${citizenId}/identity`, undefined, "staff");
  assert.equal(staffRead.status, 403, JSON.stringify(staffRead.body));
  assert.equal(staffRead.body.error.code, "ROLE_DENIED");
  const approverRead = await req("GET", `/citizens/${citizenId}/identity`, undefined, "approver");
  assert.equal(approverRead.status, 200, JSON.stringify(approverRead.body));
  assert.equal(approverRead.body.nid, "1234567890");
  assert.equal(approverRead.body.birthReg, "19950101123456789");
  const masked = await req("GET", `/citizens/${citizenId}/identity?masked=true`, undefined, "approver");
  assert.equal(masked.status, 200, JSON.stringify(masked.body));
  assert.equal(masked.body.nid, "••••890");
  assert.equal(masked.body.birthReg, "••••789");
  // The citizen reads their own numbers; the read is audited.
  const selfRead = await req("GET", `/citizens/${citizenId}/identity`, undefined, "citizen");
  assert.equal(selfRead.status, 200, JSON.stringify(selfRead.body));
  assert.equal(selfRead.body.nid, "1234567890");
});

test("S-010: rapid identity reads raise a distinct bulk-read audit event", async () => {
  const approverId = (
    await admin.query("SELECT id FROM platform_users WHERE email='approver@alpha.local.test'")
  ).rows[0].id;
  const tenantId = (await admin.query("SELECT id FROM tenants WHERE slug='alpha'")).rows[0].id;
  for (let i = 0; i < 25; i++) {
    const r = await req("GET", `/citizens/${citizenId}/identity`, undefined, "approver");
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  const flagged = await admin.query(
    "SELECT 1 FROM audit_events WHERE tenant_id=$1 AND actor_id=$2 AND action='CITIZEN_IDENTITY_BULK_READ' AND created_at > now() - interval '10 minutes'",
    [tenantId, approverId],
  );
  assert.ok((flagged.rowCount ?? 0) >= 1, "a CITIZEN_IDENTITY_BULK_READ audit event exists");
});

test("W-013: a partial draft saves a half-filled form; submit enforces full validation", async () => {
  const created = await req("POST", "/applications", { citizenId, serviceNo: 45, payload: {}, partial: true }, "staff");
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.state, "DRAFT");
  assert.equal(created.body.partialPayload, true);
  const id = created.body.id as string;
  // Without the partial flag the same payload is rejected (existing behavior).
  const rejected = await req("POST", "/applications", { citizenId, serviceNo: 45, payload: {} }, "staff");
  assert.equal(rejected.status, 422, JSON.stringify(rejected.body));
  assert.equal(rejected.body.error.code, "FORM_INVALID");
  // A partial draft cannot be submitted until the form is complete.
  const blocked = await req("POST", `/applications/${id}/transition`, { action: "submit" }, "staff");
  assert.equal(blocked.status, 422, JSON.stringify(blocked.body));
  assert.equal(blocked.body.error.code, "FORM_INVALID");
  const stillDraft = await req("GET", `/applications/${id}`, undefined, "staff");
  assert.equal(stillDraft.body.application.state, "DRAFT");
  // Completing the form clears the partial marker and the submit succeeds.
  const completed = await req("PATCH", `/applications/${id}`, { payload: demoPayloads[45] }, "staff");
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  assert.equal(completed.body.partialPayload, false);
  const submitted = await req("POST", `/applications/${id}/transition`, { action: "submit" }, "staff");
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  assert.equal(submitted.body.state, "SUBMITTED");
});

test("W-013: a partial edit after a correction blocks resubmit until the form is complete", async () => {
  const id = await submittedApplication(45);
  const corrected = await req("POST", `/applications/${id}/transition`, { action: "request_correction", reason: "needs a fix" }, "approver");
  assert.equal(corrected.status, 200, JSON.stringify(corrected.body));
  const partialEdit = await req("PATCH", `/applications/${id}`, { payload: {}, partial: true }, "citizen");
  assert.equal(partialEdit.status, 200, JSON.stringify(partialEdit.body));
  assert.equal(partialEdit.body.partialPayload, true);
  const blocked = await req("POST", `/applications/${id}/transition`, { action: "resubmit" }, "citizen");
  assert.equal(blocked.status, 422, JSON.stringify(blocked.body));
  assert.equal(blocked.body.error.code, "FORM_INVALID");
  const fixed = await req("PATCH", `/applications/${id}`, { payload: demoPayloads[45] }, "citizen");
  assert.equal(fixed.status, 200, JSON.stringify(fixed.body));
  const resubmitted = await req("POST", `/applications/${id}/transition`, { action: "resubmit" }, "citizen");
  assert.equal(resubmitted.status, 200, JSON.stringify(resubmitted.body));
  assert.equal(resubmitted.body.state, "RESUBMITTED");
});

test("W-013 follow-up (Stage 4): a partial draft carries the order snapshot for a policy-configured service", async () => {
  // Service 44 is unused elsewhere in this file, so publishing a policy
  // for it cannot change the other tests' LEGACY creation path. The
  // current version is read first so the test stays green on re-runs
  // against a polluted seed (expectedVersion must match the latest).
  const options = await req("GET", "/services/44/order-options", undefined, "admin");
  const currentVersion = options.body.configured ? (options.body.policy.version as number) : 0;
  const published = await req(
    "POST",
    "/admin/services/44/order-policies",
    {
      expectedVersion: currentVersion,
      reason: "Synthetic W-013 follow-up policy; not a government tariff",
      statutoryFeeMinor: 1000,
      processingFeeMinor: 50,
      emergencySurchargeMinor: 500,
      deliveryFeesMinor: { office_collection: 0, digital_copy: 100 },
      deliveryModes: ["office_collection", "digital_copy"],
      urgencies: ["normal", "urgent"],
      charterDays: 5,
      requiredDocuments: [],
    },
    "admin",
  );
  assert.equal(published.status, 201, JSON.stringify(published.body));
  const version = published.body.policy.version as number;
  const order = {
    policyVersion: version,
    preferences: {
      addressBasis: "registered_profile",
      certificateLanguage: "bn",
      deliveryMode: "office_collection",
      urgency: "normal",
    },
  };
  // A half-filled form with the delivery options chosen: the partial
  // draft saves with the order snapshot instead of being refused.
  const created = await req(
    "POST",
    "/applications",
    { citizenId, serviceNo: 44, payload: {}, partial: true, order },
    "staff",
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.state, "DRAFT");
  assert.equal(created.body.partialPayload, true);
  assert.equal(created.body.orderMode, "POLICY");
  const read = await req("GET", `/applications/${created.body.id}`, undefined, "staff");
  assert.ok(read.body.order, "the order snapshot is stored on the partial draft");
  assert.equal(read.body.order.policyVersion, version);
});

test("W-014: a rejected application can be re-applied for, linked to the original", async () => {
  const id = await submittedApplication(45);
  const rejected = await req("POST", `/applications/${id}/transition`, { action: "reject", reason: "not eligible" }, "approver");
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
  const key = randomUUID();
  const first = await req("POST", `/applications/${id}/reapply`, { requestKey: key }, "citizen");
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.state, "DRAFT");
  assert.equal(first.body.serviceNo, 45);
  assert.equal(first.body.reapplicationOf, id);
  assert.equal(first.body.sourceApplicationId, id);
  assert.equal(first.body.partialPayload, false);
  // A retried reapply with the same key returns the same draft, not a second one.
  const replay = await req("POST", `/applications/${id}/reapply`, { requestKey: key }, "citizen");
  assert.equal(replay.status, 201, JSON.stringify(replay.body));
  assert.equal(replay.body.id, first.body.id);
  // The detail view shows the link, and the carried payload matches the
  // original application's stored payload.
  const originalDetail = await req("GET", `/applications/${id}`, undefined, "citizen");
  const detail = await req("GET", `/applications/${first.body.id}`, undefined, "citizen");
  assert.equal(detail.body.application.reapplicationOf, id);
  assert.deepEqual(detail.body.payload, originalDetail.body.payload);
  // The new draft submits normally under its own reference and fee.
  const submitted = await req("POST", `/applications/${first.body.id}/transition`, { action: "submit" }, "citizen");
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  assert.equal(submitted.body.state, "SUBMITTED");
  assert.notEqual(submitted.body.reference, rejected.body.reference);
});

test("W-014: reapply from a non-rejected application is rejected", async () => {
  const id = await submittedApplication(45);
  const reapplied = await req("POST", `/applications/${id}/reapply`, {}, "citizen");
  assert.equal(reapplied.status, 409, JSON.stringify(reapplied.body));
  assert.equal(reapplied.body.error.code, "REAPPLY_SOURCE_INVALID");
});

// W-015: the charter clock runs from the latest submit/resubmit, and the
// list, detail and counts all expose the due date and the overdue flag.
// Service 42 is the shared policy testbed in alpha (the seed ships a
// zero-fee v1; certificate-assets and integration publish further versions
// the same way), so the policy versions published here persist like theirs
// — policies are append-only by design (migration 011) and are never
// deleted. The overdue fixture is built with INSERTs only: application
// events are append-only too, so the backdated submit event is inserted
// with its old timestamp rather than created-then-updated.
async function alphaTenantId() {
  const approverId = (
    await admin.query("SELECT id FROM platform_users WHERE email='approver@alpha.local.test'")
  ).rows[0].id;
  return (
    await admin.query("SELECT tenant_id FROM staff_memberships WHERE user_id=$1", [approverId])
  ).rows[0].tenant_id as string;
}
async function publishCharterPolicy() {
  const tenantId = await alphaTenantId();
  const currentVersion = (
    await admin.query(
      "SELECT COALESCE(MAX(version),0)::int v FROM service_order_policies WHERE tenant_id=$1 AND service_no=42",
      [tenantId],
    )
  ).rows[0].v as number;
  const published = await req(
    "POST",
    "/admin/services/42/order-policies",
    {
      expectedVersion: currentVersion,
      reason: "Synthetic charter regression; not a government tariff",
      statutoryFeeMinor: 0,
      processingFeeMinor: 0,
      emergencySurchargeMinor: 0,
      deliveryFeesMinor: { office_collection: 0, digital_copy: 0 },
      deliveryModes: ["office_collection", "digital_copy"],
      urgencies: ["normal"],
      charterDays: 5,
    },
    "admin",
  );
  assert.equal(published.status, 201, JSON.stringify(published.body));
  return published.body.policy.version as number;
}
const w015Preferences = {
  addressBasis: "registered_profile",
  certificateLanguage: "en",
  deliveryMode: "office_collection",
  urgency: "normal",
};

test("W-015: charter due date is exposed on list/detail/counts", async () => {
  const version = await publishCharterPolicy();
  let id = "";
  try {
    const created = await req(
      "POST",
      "/applications",
      {
        citizenId,
        serviceNo: 42,
        payload: { ...demoPayloads[42], delivery_language: "en" },
        order: { policyVersion: version, preferences: w015Preferences },
      },
      "staff",
    );
    assert.equal(created.status, 201, JSON.stringify(created.body));
    id = created.body.id as string;
    const submitted = await req("POST", `/applications/${id}/transition`, { action: "submit" }, "staff");
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
    const list = (await req("GET", "/applications?state=SUBMITTED&pageSize=100", undefined, "approver")).body;
    const row = list.items.find((item: any) => item.id === id);
    assert.ok(row, "submitted application missing from the list");
    assert.equal(row.charterDays, 5);
    const due = new Date(row.dueAt as string).getTime();
    assert.ok(Math.abs(due - (Date.now() + 5 * 86_400_000)) < 120_000, `dueAt ${row.dueAt} is not ~5 days out`);
    assert.equal(row.overdue, false);
    const detail = (await req("GET", `/applications/${id}`, undefined, "approver")).body;
    assert.equal(detail.application.charterDays, 5);
    assert.equal(detail.application.dueAt, row.dueAt);
    assert.equal(detail.application.overdue, false);
    const counts = (await req("GET", "/applications/counts", undefined, "approver")).body;
    assert.equal(counts.overdue, 0);
  } finally {
    if (id) await req("POST", `/applications/${id}/transition`, { action: "cancel" }, "citizen");
  }
});

test("W-015: an application past its charter date is flagged overdue", async () => {
  const version = await publishCharterPolicy();
  const tenantId = await alphaTenantId();
  const staffId = (
    await admin.query("SELECT id FROM platform_users WHERE email='staff@alpha.local.test'")
  ).rows[0].id as string;
  const schema = (
    await admin.query(
      "SELECT version, schema_hash FROM service_versions WHERE service_no=42 ORDER BY version DESC LIMIT 1",
    )
  ).rows[0];
  const countsBefore = (await req("GET", "/applications/counts", undefined, "approver")).body;
  // A submit event ten days ago against a 5-day charter: due five days ago.
  // The application + its order snapshot + the event go in one transaction:
  // a POLICY application requires a snapshot (deferred constraint), and the
  // snapshot must match the published policy's zero fees.
  const id = randomUUID();
  const reference = `2026${String(Math.floor(Math.random() * 1e12)).padStart(12, "0")}`;
  const fixture = await admin.connect();
  try {
    await fixture.query("BEGIN");
    await fixture.query(
      "INSERT INTO applications(id,tenant_id,citizen_id,service_no,schema_version,schema_hash,state,created_by,order_mode,reference) VALUES($1,$2,$3,42,$4,$5,'SUBMITTED',$6,'POLICY',$7)",
      [id, tenantId, citizenId, schema.version, schema.schema_hash, staffId, reference],
    );
    await fixture.query(
      "INSERT INTO application_order_snapshots(tenant_id,application_id,service_no,policy_version,address_basis,certificate_language,delivery_mode,urgency,statutory_fee_minor,processing_fee_minor,emergency_surcharge_minor,delivery_fee_minor,total_minor,currency) VALUES($1,$2,42,$3,'registered_profile','en','office_collection','normal',0,0,0,0,0,'BDT')",
      [tenantId, id, version],
    );
    await fixture.query(
      "INSERT INTO application_events(tenant_id,application_id,actor_id,action,from_state,to_state,created_at) VALUES($1,$2,$3,'submit','DRAFT','SUBMITTED',now() - interval '10 days')",
      [tenantId, id, staffId],
    );
    await fixture.query("COMMIT");
  } catch (error) {
    await fixture.query("ROLLBACK");
    throw error;
  } finally {
    fixture.release();
  }
  try {
    const list = (await req("GET", "/applications?state=SUBMITTED&pageSize=100", undefined, "approver")).body;
    const row = list.items.find((item: any) => item.id === id);
    assert.ok(row, "overdue application missing from the list");
    assert.equal(row.charterDays, 5);
    assert.equal(row.overdue, true);
    const due = new Date(row.dueAt as string).getTime();
    assert.ok(Math.abs(due - (Date.now() - 5 * 86_400_000)) < 120_000, `dueAt ${row.dueAt} is not ~5 days ago`);
    const detail = (await req("GET", `/applications/${id}`, undefined, "approver")).body;
    assert.equal(detail.application.overdue, true);
    const countsAfter = (await req("GET", "/applications/counts", undefined, "approver")).body;
    assert.equal(countsAfter.overdue, countsBefore.overdue + 1);
    assert.equal(version > 0, true);
  } finally {
    // Cancelling through the API leaves a coherent CANCELLED row behind
    // (its events are append-only); the overdue count drops back.
    await req("POST", `/applications/${id}/transition`, { action: "cancel" }, "citizen");
  }
});

test("W-015: without a charter policy there is no due date and nothing is overdue", async () => {
  const id = await submittedApplication(45);
  const list = (await req("GET", "/applications?state=SUBMITTED&pageSize=100", undefined, "approver")).body;
  const row = list.items.find((item: any) => item.id === id);
  assert.ok(row, "submitted application missing from the list");
  assert.equal(row.charterDays, null);
  assert.equal(row.dueAt, null);
  assert.equal(row.overdue, false);
});
