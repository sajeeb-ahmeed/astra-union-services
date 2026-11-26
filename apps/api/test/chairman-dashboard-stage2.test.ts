import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { getDemoPayload } from "@astra/shared-schemas";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";

/**
 * Chairman dashboard backend, Stage 2 (CH-002, CH-006, CH-007, CH-009):
 * - CH-002: the applications free-text search matches service names
 *   (the search box promises "Reference, citizen name or service"),
 *   not just references, citizen names and mobiles.
 * - CH-006: uploading the same bytes as logo and seal is flagged
 *   (duplicateOf) in the upload response and the overview.
 * - CH-007: a plain password sign-in is recorded in the security
 *   activity feed (it was never recorded, so the feed stayed empty for
 *   accounts that never changed a password or touched MFA).
 * - CH-009: GET /citizens paginates and reports the real total.
 */
const run = randomUUID().slice(0, 8);
const password = "CH-Dash-123!";
const admin = new pg.Pool({ connectionString: adminConnectionString });
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
type Session = { cookie: string; csrf: string; user: any };
let server: ReturnType<typeof app.listen>, base: string;
let owner: Session, office: any;
const sessions: Record<string, Session> = {};
let citizenId: string;
async function req(
  method: string,
  path: string,
  data?: unknown,
  session?: Session,
) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    redirect: "manual",
    headers: {
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      ...(session
        ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf }
        : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const type = response.headers.get("content-type") ?? "";
  const body = type.includes("application/json")
    ? await response.json()
    : await response.text();
  return { status: response.status, body, headers: response.headers };
}
async function login(email: string, secret = password) {
  const r = await req("POST", "/auth/login", { email, password: secret });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return {
    cookie: r.headers.get("set-cookie")!.split(";")[0],
    csrf: r.body.csrfToken,
    user: r.body.user,
  } as Session;
}
async function draft(serviceNo: number) {
  const r = await req(
    "POST",
    "/applications",
    {
      citizenId,
      serviceNo,
      payload: { ...getDemoPayload(serviceNo), delivery_language: "bn" },
    },
    sessions.staff,
  );
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id as string;
}

before(async () => {
  process.env.NODE_ENV = "test";
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  owner = await login("owner@astra.demo.test", "Demo-Phase1!");
  const slug = `chdash-${run}`;
  const created = await req(
    "POST",
    "/owner/tenants",
    {
      slug,
      nameBn: "চেয়ারম্যান পরীক্ষা অফিস",
      nameEn: "Chairman dashboard test office",
      division: "Test Division",
      district: "Test District",
      upazila: "Test Upazila",
      officeType: "UNION",
      adminEmail: `admin@${slug}.test`,
      adminName: "CH Admin",
      adminPassword: password,
    },
    owner,
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  office = created.body;
  const adminSession = await login(`admin@${slug}.test`);
  sessions.admin = adminSession;
  for (const roleName of ["approver", "staff"]) {
    const u = await req(
      "POST",
      "/admin/users",
      {
        email: `${roleName}@${slug}.test`,
        displayName: `CH ${roleName}`,
        password,
        role: roleName,
      },
      adminSession,
    );
    assert.equal(u.status, 201, JSON.stringify(u.body));
    sessions[roleName] = await login(`${roleName}@${slug}.test`);
  }
  const signup = await req("POST", "/auth/signup", {
    email: `citizen-${slug}@synthetic.test`,
    password,
    displayName: "CH Citizen",
    tenantId: office.id,
    nameBn: "পরীক্ষা নাগরিক",
    nameEn: "CH Citizen",
    dateOfBirth: "1998-02-03",
    addressBn: "পরীক্ষা ঠিকানা",
    addressEn: "Test address only",
    syntheticReference: `REF-CH-${run}`,
  });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  const citizenSession = await login(`citizen-${slug}@synthetic.test`);
  sessions.citizen = citizenSession;
  citizenId = (
    await req("GET", "/citizens", undefined, citizenSession)
  ).body.items[0].id;
  // Stage 3 (S-011): reject/correct now require the same per-service
  // authorization as approve — grant it so the CH-007 reject step below
  // exercises the notification feed, not the authorization gate (which
  // workflow-stage3.test.ts covers directly).
  const authorization = await req(
    "PUT",
    `/admin/authorizations/${sessions.approver.user.id}/45`,
    { active: true, authorityNote: "Chairman dashboard regression only" },
    adminSession,
  );
  assert.equal(authorization.status, 200, JSON.stringify(authorization.body));
});
after(async () => {
  await closePdfBrowser();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await admin.end();
});

test("CH-002: free-text search finds applications by service name", async () => {
  const resident = await draft(45);
  const family = await draft(2);
  const byResident = await req(
    "GET",
    "/applications?q=Permanent%20Resident&pageSize=100",
    undefined,
    sessions.approver,
  );
  assert.equal(byResident.status, 200, JSON.stringify(byResident.body));
  const residentIds = byResident.body.items.map((a: any) => a.id);
  assert.ok(residentIds.includes(resident), "the Permanent Resident application matches");
  assert.ok(!residentIds.includes(family), "the Family Certificate application does not");
  assert.equal(byResident.body.total, 1);
  const byFamily = await req(
    "GET",
    "/applications?q=Family%20Certificate&pageSize=100",
    undefined,
    sessions.approver,
  );
  assert.equal(byFamily.body.total, 1);
  assert.equal(byFamily.body.items[0].id, family);
  // A partial name matches too, and an unrelated query matches neither.
  const partial = await req(
    "GET",
    "/applications?q=Resident&pageSize=100",
    undefined,
    sessions.approver,
  );
  assert.ok(partial.body.items.map((a: any) => a.id).includes(resident));
  const none = await req(
    "GET",
    "/applications?q=Zanzibar%20Certificate&pageSize=100",
    undefined,
    sessions.approver,
  );
  assert.equal(none.body.total, 0);
});

test("CH-006: the same image as logo and seal is flagged, not silently accepted", async () => {
  const logo = await req(
    "PUT",
    "/office/certificate-assets/logo",
    { mimeType: "image/png", base64: PNG_1X1 },
    sessions.approver,
  );
  assert.equal(logo.status, 201, JSON.stringify(logo.body));
  assert.equal(logo.body.duplicateOf, null);
  const seal = await req(
    "PUT",
    "/office/certificate-assets/seal",
    { mimeType: "image/png", base64: PNG_1X1 },
    sessions.approver,
  );
  assert.equal(seal.status, 201, JSON.stringify(seal.body));
  assert.equal(seal.body.duplicateOf, "LOGO");
  const overview = await req(
    "GET",
    "/office/certificate-assets",
    undefined,
    sessions.approver,
  );
  assert.equal(overview.status, 200, JSON.stringify(overview.body));
  const byKind = Object.fromEntries(
    overview.body.items.map((i: any) => [i.kind, i.current]),
  );
  assert.equal(byKind.SEAL.duplicateOf, "LOGO");
  assert.equal(byKind.LOGO.duplicateOf, "SEAL");
  assert.equal(byKind.SIGNATURE, null);
});

test("CH-007: a plain password sign-in appears in the security activity feed", async () => {
  // The approver signed in during setup (plain password, no MFA).
  const events = await req(
    "GET",
    "/auth/security-events",
    undefined,
    sessions.approver,
  );
  assert.equal(events.status, 200, JSON.stringify(events.body));
  assert.ok(
    events.body.items.some((e: any) => e.action === "SIGNED_IN"),
    JSON.stringify(events.body.items.map((e: any) => e.action)),
  );
});

test("CH-007: the notifications feed carries submit and reject events to the office (and the rejection to the citizen)", async () => {
  // Submitting settles a 5-credit fee for service 45 — fund the wallet.
  const funded = await req(
    "POST",
    `/owner/tenants/${office.id}/adjust`,
    { delta: 100, reason: "CH-007 notification test funding" },
    owner,
  );
  assert.equal(funded.status, 201, JSON.stringify(funded.body));
  const id = await draft(45);
  const submitted = await req(
    "POST",
    `/applications/${id}/transition`,
    { action: "submit" },
    sessions.staff,
  );
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  const officeFeed = await req(
    "GET",
    "/notifications",
    undefined,
    sessions.approver,
  );
  assert.equal(officeFeed.status, 200, JSON.stringify(officeFeed.body));
  assert.ok(
    officeFeed.body.items.some(
      (n: any) => n.kind === "APPLICATION_SUBMITTED" && n.applicationId === id,
    ),
    "the approver sees the submission",
  );
  // Submission events are office-facing only — the citizen must not see them.
  const citizenFeed = await req(
    "GET",
    "/notifications",
    undefined,
    sessions.citizen,
  );
  assert.equal(citizenFeed.status, 200, JSON.stringify(citizenFeed.body));
  assert.ok(
    !citizenFeed.body.items.some(
      (n: any) => n.kind === "APPLICATION_SUBMITTED" && n.applicationId === id,
    ),
    "the citizen does not see the submission event",
  );
  const rejected = await req(
    "POST",
    `/applications/${id}/transition`,
    { action: "reject", reason: "CH-007 test rejection" },
    sessions.approver,
  );
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
  const officeAfter = await req(
    "GET",
    "/notifications",
    undefined,
    sessions.approver,
  );
  assert.ok(
    officeAfter.body.items.some(
      (n: any) => n.kind === "APPLICATION_REJECTED" && n.applicationId === id,
    ),
    "the approver sees the rejection",
  );
  const citizenAfter = await req(
    "GET",
    "/notifications",
    undefined,
    sessions.citizen,
  );
  assert.ok(
    citizenAfter.body.items.some(
      (n: any) => n.kind === "APPLICATION_REJECTED" && n.applicationId === id,
    ),
    "the citizen sees their own rejection",
  );
});

test("CH-009: the citizens directory paginates and reports the real total", async () => {
  // Two more citizens, so the office has three in total.
  for (const key of ["b", "c"]) {
    const email = `citizen-${key}-${run}@synthetic.test`;
    const r = await req("POST", "/auth/signup", {
      email,
      password,
      displayName: `CH Citizen ${key}`,
      tenantId: office.id,
      nameBn: "পরীক্ষা নাগরিক",
      nameEn: `CH Citizen ${key}`,
      dateOfBirth: "1998-02-03",
      addressBn: "পরীক্ষা ঠিকানা",
      addressEn: "Test address only",
      syntheticReference: `REF-CH-${key}-${run}`,
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  }
  const page1 = await req(
    "GET",
    "/citizens?page=1&pageSize=2",
    undefined,
    sessions.approver,
  );
  assert.equal(page1.status, 200, JSON.stringify(page1.body));
  assert.equal(page1.body.items.length, 2);
  assert.equal(page1.body.total, 3);
  assert.equal(page1.body.page, 1);
  assert.equal(page1.body.pageSize, 2);
  const page2 = await req(
    "GET",
    "/citizens?page=2&pageSize=2",
    undefined,
    sessions.approver,
  );
  assert.equal(page2.body.items.length, 1);
  assert.equal(page2.body.total, 3);
  assert.notEqual(page2.body.items[0].id, page1.body.items[0].id);
  // No pagination params keeps the previous behaviour (first 100).
  const all = await req("GET", "/citizens", undefined, sessions.approver);
  assert.equal(all.body.items.length, 3);
  assert.equal(all.body.total, 3);
});
