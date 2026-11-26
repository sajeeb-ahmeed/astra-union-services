import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { demoPayloads } from "@astra/shared-schemas";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";

// CHAIRMAN-DASH-01: the office applications service filter and the per-state
// counts behind the Pending applications queue. Counts assertions are delta
// based: the seeded database is shared with other suites, so this file proves
// its own mix moves the numbers by exactly the mix, and nothing else's data
// leaks across the tenant boundary.
process.env.NODE_ENV = "test";
const admin = new pg.Pool({ connectionString: adminConnectionString });
let server: ReturnType<typeof app.listen>, base: string, alphaId: string;
let alphaCitizenId: string;
type Session = { cookie: string; csrf: string };
const s: Record<string, Session> = {};
async function req(method: string, path: string, data?: unknown, session?: Session) {
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
async function login(key: string, email: string) {
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Demo-Phase1!" }),
  });
  const json = await r.json();
  assert.equal(r.status, 200, JSON.stringify(json));
  s[key] = { cookie: r.headers.get("set-cookie")!.split(";")[0], csrf: json.csrfToken };
}
async function createApplication(serviceNo: number, citizenId = alphaCitizenId) {
  const created = await req(
    "POST",
    "/applications",
    { citizenId, serviceNo, payload: demoPayloads[serviceNo] },
    s.staff,
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body.id as string;
}
async function transition(id: string, action: string, session: Session, reason?: string) {
  const r = await req(
    "POST",
    `/applications/${id}/transition`,
    { action, ...(reason ? { reason } : {}) },
    session,
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}
async function counts(session: Session) {
  const r = await req("GET", "/applications/counts", undefined, session);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body as {
    counts: Record<string, number>;
    awaitingReview: number;
    awaitingIssuance: number;
  };
}

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  await login("staff", "staff@alpha.local.test");
  await login("approver", "approver@alpha.local.test");
  await login("admin", "admin@alpha.local.test");
  await login("citizen", "citizen@alpha.local.test");
  await login("betaStaff", "staff@beta.local.test");
  alphaCitizenId = (await req("GET", "/citizens", undefined, s.citizen)).body.items[0].id;
  alphaId = (await admin.query("SELECT id FROM tenants WHERE slug='alpha'")).rows[0]?.id;
  assert.ok(alphaId, "the alpha demo office exists");
});
after(async () => {
  // Shared demo office: always leave the profile gate off, as seeded.
  await admin.query("UPDATE tenants SET require_complete_profile=false WHERE id=$1", [alphaId]);
  await closePdfBrowser();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await admin.end();
});

test("CHAIRMAN-DASH-01: the applications list filters by service and composes with state and search", async () => {
  const for45 = await createApplication(45);
  const for1 = await createApplication(1);

  const only45 = await req("GET", "/applications?serviceNo=45&pageSize=100", undefined, s.staff);
  assert.equal(only45.status, 200, JSON.stringify(only45.body));
  assert.ok(only45.body.items.length > 0);
  assert.ok(only45.body.items.every((x: any) => x.serviceNo === 45));
  assert.ok(only45.body.items.some((x: any) => x.id === for45));
  assert.equal(only45.body.items.some((x: any) => x.id === for1), false);

  const only1 = await req("GET", "/applications?serviceNo=1&pageSize=100", undefined, s.staff);
  assert.ok(only1.body.items.every((x: any) => x.serviceNo === 1));
  assert.ok(only1.body.items.some((x: any) => x.id === for1));
  assert.equal(only1.body.items.some((x: any) => x.id === for45), false);

  // Composition with the state filter: submit the service-45 application, then
  // it appears under serviceNo+SUBMITTED and disappears from serviceNo+DRAFT.
  await transition(for45, "submit", s.staff);
  const submitted45 = await req(
    "GET",
    "/applications?serviceNo=45&state=SUBMITTED&pageSize=100",
    undefined,
    s.staff,
  );
  assert.ok(submitted45.body.items.some((x: any) => x.id === for45));
  assert.ok(submitted45.body.items.every((x: any) => x.serviceNo === 45 && x.state === "SUBMITTED"));
  const draft45 = await req(
    "GET",
    "/applications?serviceNo=45&state=DRAFT&pageSize=100",
    undefined,
    s.staff,
  );
  assert.equal(draft45.body.items.some((x: any) => x.id === for45), false);
  const submitted1 = await req(
    "GET",
    "/applications?serviceNo=1&state=SUBMITTED&pageSize=100",
    undefined,
    s.staff,
  );
  assert.equal(submitted1.body.items.some((x: any) => x.id === for1), false);

  // Composition with the text search (citizen name) within the chosen service.
  const searched = await req(
    "GET",
    `/applications?serviceNo=45&q=${encodeURIComponent("Karim")}&pageSize=100`,
    undefined,
    s.staff,
  );
  assert.ok(searched.body.items.some((x: any) => x.id === for45));
  assert.ok(searched.body.items.every((x: any) => x.serviceNo === 45));

  // Invalid service numbers are a client error in the house style (422
  // INPUT_INVALID, as for every Zod-validated query input) — never a 500.
  for (const bad of ["48", "0", "-3", "abc", "4.5"]) {
    const r = await req("GET", `/applications?serviceNo=${bad}`, undefined, s.staff);
    assert.equal(r.status, 422, `serviceNo=${bad} -> ${r.status}`);
    assert.equal(r.body.error.code, "INPUT_INVALID");
  }
});

test("CHAIRMAN-DASH-01: counts are per-state, grouped for the queue, and tenant-scoped", async () => {
  const betaBefore = await counts(s.betaStaff);
  const before = await counts(s.staff);
  // The response always carries every state, zero-filled, plus the W-015
  // overdue total (a cross-state count, not a state — hence lowercase).
  assert.deepEqual(Object.keys(before.counts).sort(), [
    "APPROVED",
    "CANCELLED",
    "CORRECTION_REQUIRED",
    "DRAFT",
    "ISSUED",
    "REJECTED",
    "RESUBMITTED",
    "REVOKED",
    "SUBMITTED",
    "UNDER_REVIEW",
    "overdue",
  ]);

  // Build one application per reachable state in the alpha office.
  await createApplication(45); // stays DRAFT
  const submitted = await createApplication(45);
  await transition(submitted, "submit", s.staff); // SUBMITTED
  const corrected = await createApplication(45);
  await transition(corrected, "submit", s.staff);
  await transition(corrected, "request_correction", s.approver, "NID copy is unreadable"); // CORRECTION_REQUIRED
  const resubmitted = await createApplication(45);
  await transition(resubmitted, "submit", s.staff);
  await transition(resubmitted, "request_correction", s.approver, "Fix the address line");
  await transition(resubmitted, "resubmit", s.staff); // RESUBMITTED
  const rejected = await createApplication(45);
  await transition(rejected, "submit", s.staff);
  await transition(rejected, "reject", s.approver, "Documents do not match"); // REJECTED
  const issued = await createApplication(45);
  await transition(issued, "submit", s.staff);
  await transition(issued, "approve", s.approver); // ISSUED (approve issues at once)

  // APPROVED at rest: with the profile-completeness gate enforced, the
  // Chairman's approval of an incomplete-profile citizen's application is
  // recorded but issuance waits (the Phase W gate behaviour).
  const geography = (await req("GET", "/citizens", undefined, s.citizen)).body.items[0]?.geography;
  const registered = await req(
    "POST",
    "/citizens",
    {
      nameBn: "অসম্পূর্ণ প্রোফাইল",
      nameEn: `Queue Incomplete ${Date.now()}`,
      dateOfBirth: "1990-03-04",
      addressBn: "নমুনা গ্রাম ঠিকানা",
      addressEn: "Synthetic village address",
      ...(geography ? { geography } : {}),
    },
    s.staff,
  );
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  const gated = await createApplication(45, registered.body.id);
  await transition(gated, "submit", s.staff);
  const on = await req(
    "PUT",
    "/admin/office/profile-completeness",
    { requireCompleteProfile: true },
    s.admin,
  );
  assert.equal(on.status, 200, JSON.stringify(on.body));
  try {
    const refused = await req(
      "POST",
      `/applications/${gated}/transition`,
      { action: "approve" },
      s.approver,
    );
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.equal(refused.body.error.code, "PROFILE_INCOMPLETE");
    const detail = await req("GET", `/applications/${gated}`, undefined, s.staff);
    assert.equal(detail.body.application.state, "APPROVED");
  } finally {
    const off = await req(
      "PUT",
      "/admin/office/profile-completeness",
      { requireCompleteProfile: false },
      s.admin,
    );
    assert.equal(off.status, 200, JSON.stringify(off.body));
  }

  const afterCounts = await counts(s.staff);
  const delta = (state: string) => afterCounts.counts[state] - before.counts[state];
  assert.equal(delta("DRAFT"), 1);
  assert.equal(delta("SUBMITTED"), 1);
  assert.equal(delta("CORRECTION_REQUIRED"), 1);
  assert.equal(delta("RESUBMITTED"), 1);
  assert.equal(delta("REJECTED"), 1);
  assert.equal(delta("ISSUED"), 1);
  assert.equal(delta("APPROVED"), 1);
  assert.equal(delta("UNDER_REVIEW"), 0);
  // Awaiting review = SUBMITTED + RESUBMITTED + UNDER_REVIEW. The mix added one
  // of each of the first two; CORRECTION_REQUIRED is the citizen's move and must
  // NOT be counted as office-pending.
  assert.equal(afterCounts.awaitingReview - before.awaitingReview, 2);
  // Awaiting issuance = APPROVED (ISSUANCE_PENDING is not a state in the
  // current state machine).
  assert.equal(afterCounts.awaitingIssuance - before.awaitingIssuance, 1);

  // Tenant scoping: the beta office's figures did not move while alpha's did.
  const betaAfter = await counts(s.betaStaff);
  assert.deepEqual(betaAfter, betaBefore);

  // A citizen never sees office-wide counts: since the citizen dashboard
  // (2026-11-26) the same endpoint answers a citizen with the same shape
  // scoped to their OWN applications only, so the citizen total is strictly
  // below the office total (the gated application above belongs to another
  // citizen). Precise own-only deltas are pinned in citizen-counts.test.ts.
  const asCitizen = await req("GET", "/applications/counts", undefined, s.citizen);
  assert.equal(asCitizen.status, 200, JSON.stringify(asCitizen.body));
  assert.deepEqual(Object.keys(asCitizen.body.counts).sort(), Object.keys(afterCounts.counts).sort());
  const sum = (c: Record<string, number>) => Object.values(c).reduce((n, v) => n + v, 0);
  assert.ok(sum(asCitizen.body.counts) < sum(afterCounts.counts), "citizen counts exclude other citizens");
  assert.ok(asCitizen.body.counts.ISSUED >= 1, "the citizen sees their own issued application");
});

test("WS-D1: the applications list sorts newest-first by default and re-queries in the requested order", async () => {
  // Three submitted applications on three services with distinct
  // submission dates — and deliberately REVERSED updated_at stamps, so
  // the old updated_at ordering would rank them the other way round.
  const newest = await createApplication(1);
  await transition(newest, "submit", s.staff);
  const middle = await createApplication(12);
  await transition(middle, "submit", s.staff);
  const oldest = await createApplication(45);
  await transition(oldest, "submit", s.staff);
  await admin.query(
    "UPDATE applications SET created_at='2026-11-22 10:00:00+06', updated_at='2026-11-20 10:00:00+06' WHERE id=$1",
    [newest],
  );
  await admin.query(
    "UPDATE applications SET created_at='2026-11-21 10:00:00+06', updated_at='2026-11-21 10:00:00+06' WHERE id=$1",
    [middle],
  );
  await admin.query(
    "UPDATE applications SET created_at='2026-11-20 10:00:00+06', updated_at='2026-11-22 10:00:00+06' WHERE id=$1",
    [oldest],
  );
  const list = async (query: string) => {
    const r = await req("GET", `/applications?${query}`, undefined, s.staff);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.items as any[];
  };
  const position = (items: any[], id: string) => items.findIndex((x) => x.id === id);
  const byId = (items: any[]) => ({
    newest: position(items, newest),
    middle: position(items, middle),
    oldest: position(items, oldest),
  });

  // Default: submission date descending — the most recently UPDATED row
  // (oldest, updated 22 Nov) is last, not first.
  const def = byId(await list("pageSize=100"));
  assert.ok(def.newest > -1 && def.middle > -1 && def.oldest > -1);
  assert.ok(def.newest < def.middle && def.middle < def.oldest, JSON.stringify(def));

  // A second visit returns the same order.
  const def2 = byId(await list("pageSize=100"));
  assert.deepEqual(def2, def);

  // Oldest first reverses it; status/service keep the created_at DESC
  // tiebreak inside each group.
  const asc = byId(await list("sort=oldest&pageSize=100"));
  assert.ok(asc.oldest < asc.middle && asc.middle < asc.newest, JSON.stringify(asc));
  const byStatus = await list("sort=status&state=SUBMITTED&pageSize=100");
  const st = byId(byStatus);
  assert.ok(st.newest < st.middle && st.middle < st.oldest, JSON.stringify(st));
  assert.ok(byStatus.every((x) => x.state === "SUBMITTED"));
  const byService = byId(await list("sort=service&pageSize=100"));
  // Services 1, 12, 45 in ascending service order.
  assert.ok(byService.newest < byService.middle && byService.middle < byService.oldest, JSON.stringify(byService));
  const byRef = await list("sort=reference&pageSize=100");
  const refs = byRef.map((x) => x.reference).filter((r) => typeof r === "string");
  assert.deepEqual(refs, [...refs].sort());
  assert.ok(refs.every((r) => /^[0-9][0-9-]*$/.test(r)), "every listed reference is numeric (plain or hyphen-grouped)");

  // An unknown sort is a client error in the house style, never a 500.
  const bad = await req("GET", "/applications?sort=bogus", undefined, s.staff);
  assert.equal(bad.status, 422);
  assert.equal(bad.body.error.code, "INPUT_INVALID");

  // Issued rows carry their issue date for the list chip.
  const issued = await createApplication(45);
  await transition(issued, "submit", s.staff);
  await transition(issued, "approve", s.approver);
  const rows = await list("state=ISSUED&pageSize=100");
  const row = rows.find((x) => x.id === issued);
  assert.ok(row, "issued application is listed");
  assert.equal(typeof row.certificateIssuedAt, "string");
  assert.ok(!Number.isNaN(Date.parse(row.certificateIssuedAt)));
});
