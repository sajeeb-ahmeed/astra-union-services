import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { getDemoPayload } from "@astra/shared-schemas";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";

/**
 * W-012 (global statistics) + W-020 (platform health), owner only.
 *
 * W-012: GET /owner/statistics reports global citizens / applications /
 * certificates totals, the applications by current state, and a
 * per-office breakdown — counts only, no personal data — optionally
 * within a UTC date range and/or scoped to one office. The office rows
 * add up to the totals (same range, same rules). GET
 * /owner/statistics/export returns the same aggregates as CSV (one row
 * per office plus a TOTAL row) or JSON.
 *
 * W-020: GET /owner/platform-health reports read-only indicators —
 * database latency + migration status, scanner heartbeat + queue,
 * SMS/email/OTP/payment provider status, backup and maintenance state
 * (reported as absent where no mechanism exists), and system alerts.
 * No configuration is changed, and no secrets are exposed.
 */
const SERVICE = 45;
const run = randomUUID().slice(0, 8);
const password = "W012-Stats-123!";
const admin = new pg.Pool({ connectionString: adminConnectionString });
type Session = { cookie: string; csrf: string; user: any };
let server: ReturnType<typeof app.listen>, base: string;
let owner: Session, office: any, citizenId: string;
const sessions: Record<string, Session> = {};
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
async function adjust(tenantId: string, delta: number) {
  const r = await req(
    "POST",
    `/owner/tenants/${tenantId}/adjust`,
    { delta, reason: "W-012 test funding" },
    owner,
  );
  assert.equal(r.status, 201, JSON.stringify(r.body));
}
async function priceOf(serviceNo: number) {
  const r = await req("GET", "/owner/credit-prices", undefined, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.items.find((i: any) => i.serviceNo === serviceNo)
    .priceCredits as number;
}
async function statistics(params = "") {
  const r = await req("GET", `/owner/statistics${params}`, undefined, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}

before(async () => {
  process.env.NODE_ENV = "test";
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  owner = await login("owner@astra.demo.test", "Demo-Phase1!");
  const slug = `w012-${run}`;
  const created = await req(
    "POST",
    "/owner/tenants",
    {
      slug,
      nameBn: "পরিসংখ্যান পরীক্ষা অফিস",
      nameEn: "Statistics test office",
      division: "Test Division",
      district: "Test District",
      upazila: "Test Upazila",
      officeType: "UNION",
      adminEmail: `admin@${slug}.test`,
      adminName: "W012 Admin",
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
        displayName: `W012 ${roleName}`,
        password,
        role: roleName,
      },
      adminSession,
    );
    assert.equal(u.status, 201, JSON.stringify(u.body));
    sessions[roleName] = await login(`${roleName}@${slug}.test`);
  }
  // Issuance needs an active service-specific approval authorization
  // for the approver and a chairman signature asset on file.
  const auth = await req(
    "PUT",
    `/admin/authorizations/${sessions.approver.user.id}/${SERVICE}`,
    { active: true, authorityNote: "Synthetic W-012 approval authority" },
    adminSession,
  );
  assert.equal(auth.status, 200, JSON.stringify(auth.body));
  const signature = await req(
    "PUT",
    "/office/certificate-assets/signature",
    {
      mimeType: "image/png",
      base64:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      reason: "Synthetic signature fixture for statistics test issuance",
    },
    sessions.approver,
  );
  assert.ok([200, 201].includes(signature.status), JSON.stringify(signature.body));
  const signup = await req("POST", "/auth/signup", {
    email: `citizen-${slug}@synthetic.test`,
    password,
    displayName: "W012 Citizen",
    tenantId: office.id,
    nameBn: "পরীক্ষা নাগরিক",
    nameEn: "W012 Citizen",
    dateOfBirth: "1998-02-03",
    addressBn: "পরীক্ষা ঠিকানা",
    addressEn: "Test address only",
    syntheticReference: `REF-W012-${run}`,
  });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  sessions.citizen = await login(`citizen-${slug}@synthetic.test`);
  citizenId = (
    await req("GET", "/citizens", undefined, sessions.citizen)
  ).body.items[0].id;
});
after(async () => {
  await closePdfBrowser();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await admin.end();
});

test("W-012: global totals move by exactly the office's own activity, and the office rows add up to the totals", async () => {
  const before = await statistics();
  // One citizen (created in setup), one application, one certificate.
  await adjust(office.id, await priceOf(SERVICE));
  const draft = await req(
    "POST",
    "/applications",
    {
      citizenId,
      serviceNo: SERVICE,
      payload: { ...getDemoPayload(SERVICE), delivery_language: "bn" },
    },
    sessions.staff,
  );
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  const submitted = await req(
    "POST",
    `/applications/${draft.body.id}/transition`,
    { action: "submit" },
    sessions.staff,
  );
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  const approved = await req(
    "POST",
    `/applications/${draft.body.id}/transition`,
    { action: "approve" },
    sessions.approver,
  );
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.ok(approved.body.certificate?.number, "certificate issued");
  const after = await statistics();
  // The citizen was created in setup, before the baseline read — so
  // citizens is unchanged here; the application and the certificate
  // are the new rows.
  assert.equal(after.totals.citizens, before.totals.citizens);
  assert.equal(after.totals.applications, before.totals.applications + 1);
  assert.equal(after.totals.certificates, before.totals.certificates + 1);
  assert.equal(
    after.applicationsByState.ISSUED,
    before.applicationsByState.ISSUED + 1,
  );
  assert.equal(after.certificatesByState.ISSUED, before.certificatesByState.ISSUED + 1);
  // The state partition sums to the applications total.
  const stateSum = Object.values(after.applicationsByState).reduce(
    (a: number, b: any) => a + Number(b),
    0,
  );
  assert.equal(stateSum, after.totals.applications);
  // The office rows add up to the totals.
  const officeSum = {
    citizens: after.offices.reduce((a: number, o: any) => a + o.citizens, 0),
    applications: after.offices.reduce((a: number, o: any) => a + o.applications, 0),
    certificates: after.offices.reduce((a: number, o: any) => a + o.certificates, 0),
  };
  assert.deepEqual(officeSum, after.totals);
  const mine = after.offices.find((o: any) => o.tenantId === office.id);
  assert.ok(mine, "this office is in the breakdown");
  assert.deepEqual(
    { citizens: mine.citizens, applications: mine.applications, certificates: mine.certificates },
    { citizens: 1, applications: 1, certificates: 1 },
  );
  // No personal data in the response.
  assert.ok(!JSON.stringify(after).includes("W012 Citizen"));
  assert.ok(!JSON.stringify(after).includes("citizen-"));
});

test("W-012: the UTC date range includes today and excludes tomorrow; office scope narrows to one office", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const inRange = await statistics(`?tenantId=${office.id}&from=${today}`);
  assert.deepEqual(inRange.totals, { citizens: 1, applications: 1, certificates: 1 });
  assert.equal(inRange.offices.length, 1);
  const outOfRange = await statistics(`?tenantId=${office.id}&from=${tomorrow}`);
  assert.deepEqual(outOfRange.totals, { citizens: 0, applications: 0, certificates: 0 });
  assert.equal(outOfRange.offices.length, 1);
  assert.deepEqual(
    {
      citizens: outOfRange.offices[0].citizens,
      applications: outOfRange.offices[0].applications,
      certificates: outOfRange.offices[0].certificates,
    },
    { citizens: 0, applications: 0, certificates: 0 },
  );
});

test("W-012: CSV export carries one row per office plus a TOTAL row; JSON export matches the statistics body", async () => {
  const csv = await req(
    "GET",
    `/owner/statistics/export?tenantId=${office.id}&format=csv`,
    undefined,
    owner,
  );
  assert.equal(csv.status, 200, JSON.stringify(csv.body));
  const lines = String(csv.body).replace(/^\uFEFF/, "").split("\r\n");
  assert.equal(lines[0], '"office_slug","office_name_en","citizens","applications","certificates"');
  assert.equal(lines.length, 3, "header + office + TOTAL");
  assert.ok(lines[1].includes(`"${office.slug}"`), lines[1]);
  assert.ok(lines[1].endsWith('"1","1","1"'), lines[1]);
  assert.ok(lines[2].startsWith('"TOTAL"'), lines[2]);
  assert.ok(lines[2].endsWith('"1","1","1"'), lines[2]);
  const json = await req(
    "GET",
    `/owner/statistics/export?tenantId=${office.id}&format=json`,
    undefined,
    owner,
  );
  assert.equal(json.status, 200, JSON.stringify(json.body));
  assert.deepEqual(json.body.totals, { citizens: 1, applications: 1, certificates: 1 });
});

test("W-012/W-020: owner-only access, and invalid ranges are rejected", async () => {
  const staffStats = await req("GET", "/owner/statistics", undefined, sessions.staff);
  assert.equal(staffStats.status, 403, JSON.stringify(staffStats.body));
  const staffHealth = await req("GET", "/owner/platform-health", undefined, sessions.staff);
  assert.equal(staffHealth.status, 403, JSON.stringify(staffHealth.body));
  const unknown = await req(
    "GET",
    `/owner/statistics?tenantId=${randomUUID()}`,
    undefined,
    owner,
  );
  assert.equal(unknown.status, 404, JSON.stringify(unknown.body));
  const reversed = await req(
    "GET",
    "/owner/statistics?from=2026-11-25&to=2026-11-01",
    undefined,
    owner,
  );
  assert.equal(reversed.status, 422, JSON.stringify(reversed.body));
  const badDate = await req(
    "GET",
    "/owner/statistics?from=2026-13-40",
    undefined,
    owner,
  );
  assert.equal(badDate.status, 422, JSON.stringify(badDate.body));
});

test("W-020: platform health reports database, scanner, providers and absent backup/maintenance — and no secrets", async () => {
  const r = await req("GET", "/owner/platform-health", undefined, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const h = r.body;
  assert.equal(h.database.ok, true);
  assert.ok(typeof h.database.latencyMs === "number" && h.database.latencyMs >= 0);
  // Compare against the database itself (same count(*) + max(name) the
  // endpoint runs) instead of hard-coding the latest migration number —
  // the previous ^068_ assertion broke the moment F-001 added 069.
  const migrations = (
    await admin.query(
      "SELECT count(*)::int AS applied, max(name) AS latest FROM schema_migrations",
    )
  ).rows[0];
  assert.equal(h.database.migrationsApplied, migrations.applied);
  assert.equal(h.database.latestMigration, migrations.latest);
  assert.ok(typeof h.app.version === "string" && h.app.version.length > 0);
  assert.ok(typeof h.app.node === "string" && h.app.node.startsWith("v"));
  assert.ok(["ok", "stale", "offline"].includes(h.scanner.status), h.scanner.status);
  assert.ok(typeof h.scanner.waiting === "number");
  assert.ok(typeof h.scanner.heartbeatMinutesAgo === "number" || h.scanner.heartbeatMinutesAgo === null);
  for (const channel of ["email", "sms", "otp"]) {
    assert.ok(typeof h.providers[channel].provider === "string", channel);
    assert.equal(typeof h.providers[channel].available, "boolean", channel);
    assert.equal(typeof h.providers[channel].logOnly, "boolean", channel);
  }
  assert.ok(typeof h.providers.payment.merchantsTotal === "number");
  assert.ok(typeof h.providers.payment.officesConfigured === "number");
  assert.equal(h.backup.configured, false);
  assert.equal(h.maintenance.enabled, false);
  assert.ok(Array.isArray(h.alerts));
  // No secret material in the response (names and booleans only).
  const text = JSON.stringify(h);
  for (const leak of ["BKASH_APP_KEY", "BKASH_APP_SECRET", "BKASH_PASSWORD", "TOKEN_ENCRYPTION", "Demo-Phase1"]) {
    assert.ok(!text.includes(leak), `health response leaks ${leak}`);
  }
});
