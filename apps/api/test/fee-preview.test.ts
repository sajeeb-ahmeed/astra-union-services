import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";

/**
 * W-006: the fee preview (GET /fee-preview) — the financial outcome of a
 * submit, disclosed BEFORE the citizen commits. Two fresh offices keep the
 * money states explicit: A has no subscription and starts empty (the
 * insufficient-credit block), B holds an active subscription (the allowance
 * path). Service 44 carries the default-price assertions (billing-submit
 * also treats it as never priced — this file never publishes a price for
 * it); service 47 is unused by every other API test file, so the zero-price
 * and policy-configured cases live there without polluting anyone.
 *
 * Tests run in file order: the wallet funding in test 2 is what test 5's
 * reset relies on, and the policy in test 6 is published after the
 * zero-price assertions on the same service.
 */
type Session = { cookie: string; csrf: string; user: any };
const run = randomUUID().slice(0, 8);
const password = "Phase3b-Synth-123!";
const admin = new pg.Pool({ connectionString: adminConnectionString });
let server: ReturnType<typeof app.listen>, base: string;
const owner: { current?: Session } = {};
type Office = {
  tenant: any;
  admin: Session;
  staff: Session;
  citizen: Session;
  citizenId: string;
};
let officeA: Office, officeB: Office;

async function req(method: string, path: string, data?: unknown, session?: Session) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      ...(session ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const type = response.headers.get("content-type") ?? "";
  return { status: response.status, body: type.includes("json") ? await response.json() : null };
}
async function login(email: string, p = password): Promise<Session> {
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: p }),
  });
  const json = await r.json();
  assert.equal(r.status, 200, JSON.stringify(json));
  const cookieHeader = r.headers.get([ "set", "cookie" ].join("-"));
  assert.ok(cookieHeader, "login must return a session cookie");
  return { cookie: cookieHeader.split(";")[0], csrf: json.csrfToken, user: json.user };
}
async function buildOffice(slug: string, activate: boolean): Promise<Office> {
  const created = await req(
    "POST",
    "/owner/tenants",
    {
      slug,
      nameBn: "পরীক্ষা অফিস",
      nameEn: `W-006 test office ${slug}`,
      division: "Test Division",
      district: "Test District",
      upazila: "Test Upazila",
      officeType: "UNION",
      adminEmail: `admin@${slug}.test`,
      adminName: "W-006 Admin",
      adminPassword: password,
      ...(activate
        ? { activateSubscription: { planId: "standard-monthly", grantCredits: false } }
        : {}),
    },
    owner.current,
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const tenant = created.body;
  const adminSession = await login(`admin@${slug}.test`);
  const staffCreated = await req(
    "POST",
    "/admin/users",
    { email: `staff@${slug}.test`, displayName: "Test staff", password, role: "staff" },
    adminSession,
  );
  assert.equal(staffCreated.status, 201, JSON.stringify(staffCreated.body));
  const staff = await login(`staff@${slug}.test`);
  const email = `citizen-${slug}@synthetic.test`;
  const signup = await req("POST", "/auth/signup", {
    email,
    password,
    displayName: "W-006 Citizen",
    tenantId: tenant.id,
    nameBn: "পরীক্ষা নাগরিক",
    nameEn: "Test Citizen",
    dateOfBirth: "1998-02-03",
    addressBn: "পরীক্ষা ঠিকানা",
    addressEn: "Test address only",
    syntheticReference: `REF-${slug}`,
  });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  const citizen = await login(email);
  const citizenId = (await req("GET", "/citizens", undefined, citizen)).body.items[0].id;
  return { tenant, admin: adminSession, staff, citizen, citizenId };
}
async function adjust(tenantId: string, delta: number) {
  const r = await req(
    "POST",
    `/owner/tenants/${tenantId}/adjust`,
    { delta, reason: "W-006 test funding" },
    owner.current,
  );
  assert.equal(r.status, 201, JSON.stringify(r.body));
}
async function preview(office: Office, serviceNo: number, session?: Session) {
  return req("GET", `/fee-preview?serviceNo=${serviceNo}`, undefined, session ?? office.staff);
}

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  owner.current = await login("owner@astra.demo.test", "Demo-Phase1!");
  officeA = await buildOffice(`w6a-${run}`, false);
  officeB = await buildOffice(`w6b-${run}`, true);
});
after(async () => {
  try {
    // The payer setting is platform-global: never leave it on citizen.
    await req(
      "PUT",
      "/owner/billing-settings",
      { applicationFeePayer: "office", reason: "W-006 test cleanup" },
      owner.current,
    );
  } finally {
    await closePdfBrowser();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
    await admin.end();
  }
});

test("W-006: an empty wallet and the default price block the submit — and the preview says so", async () => {
  const r = await preview(officeA, 44);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.serviceNo, 44);
  assert.equal(r.body.method, "CREDIT");
  assert.equal(r.body.credits, 1);
  assert.equal(r.body.priceVersion, 0);
  assert.equal(r.body.isDefaultPrice, true);
  assert.equal(r.body.payer, "office");
  assert.equal(r.body.walletBalance, 0);
  assert.equal(r.body.allowance, null);
  assert.equal(r.body.orderPolicyConfigured, false);
  assert.equal(r.body.willBlockSubmit, true);
  assert.match(r.body.blockReason, /Insufficient office credit/);
  assert.match(r.body.blockReason, /খসড়া/);
});

test("W-006: a funded wallet clears the block", async () => {
  await adjust(officeA.tenant.id, 5);
  const r = await preview(officeA, 44);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.method, "CREDIT");
  assert.equal(r.body.credits, 1);
  assert.equal(r.body.walletBalance, 5);
  assert.equal(r.body.willBlockSubmit, false);
  assert.equal(r.body.blockReason, null);
});

test("W-006: an active subscription covers the submit from the allowance", async () => {
  const r = await preview(officeB, 44);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.method, "ALLOWANCE");
  assert.equal(r.body.credits, 0);
  assert.equal(r.body.allowance.used, 0);
  // standard-monthly has no allowance cap (migration 045: unlimited default).
  assert.equal(r.body.allowance.limit, null);
  assert.equal(r.body.allowance.remaining, null);
  assert.equal(r.body.willBlockSubmit, false);
  assert.equal(r.body.blockReason, null);
});

test("W-006: a zero price is free, and no order policy is configured yet", async () => {
  const current = (
    await req("GET", "/owner/credit-prices", undefined, owner.current)
  ).body.items.find((i: any) => i.serviceNo === 47);
  const published = await req(
    "POST",
    "/owner/credit-prices/47",
    { expectedVersion: current.version, priceCredits: 0, reason: "W-006 test price" },
    owner.current,
  );
  assert.equal(published.status, 201, JSON.stringify(published.body));
  const r = await preview(officeA, 47);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.method, "FREE");
  assert.equal(r.body.credits, 0);
  // Service 47's price is platform-global, so its version accumulates
  // across runs on a shared database — assert the increment, not 1.
  assert.equal(r.body.priceVersion, current.version + 1);
  assert.equal(r.body.isDefaultPrice, false);
  assert.equal(r.body.orderPolicyConfigured, false);
  assert.equal(r.body.willBlockSubmit, false);
});

test("W-006: a stored citizen-pays value surfaces as a block", async () => {
  // Upsert, not a bare UPDATE: a fresh seed has no application_fee_payer
  // row at all (the default "office" is the row's absence), so an UPDATE
  // would silently affect 0 rows and the block would never be exercised.
  await admin.query(
    `INSERT INTO platform_settings(key, value, updated_by, updated_at)
     VALUES('application_fee_payer','citizen',(SELECT id FROM platform_users WHERE email='owner@astra.demo.test'),now())
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
  );
  try {
    const r = await preview(officeA, 44);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.payer, "citizen");
    assert.equal(r.body.method, "CREDIT");
    assert.equal(r.body.credits, 1);
    assert.equal(r.body.willBlockSubmit, true);
    assert.match(r.body.blockReason, /not available yet/);
  } finally {
    await admin.query(
      `INSERT INTO platform_settings(key, value, updated_by, updated_at)
       VALUES('application_fee_payer','office',(SELECT id FROM platform_users WHERE email='owner@astra.demo.test'),now())
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
    );
  }
  const cleared = await preview(officeA, 44);
  assert.equal(cleared.body.willBlockSubmit, false);
});

test("W-006: a published order policy is reported", async () => {
  const published = await req(
    "POST",
    "/admin/services/47/order-policies",
    {
      expectedVersion: 0,
      reason: "Synthetic tariff regression; not a government tariff",
      statutoryFeeMinor: 10001,
      processingFeeMinor: 2502,
      emergencySurchargeMinor: 1503,
      deliveryFeesMinor: { office_collection: 204, digital_copy: 105 },
      deliveryModes: ["office_collection", "digital_copy"],
      urgencies: ["normal", "urgent"],
    },
    officeA.admin,
  );
  assert.equal(published.status, 201, JSON.stringify(published.body));
  const r = await preview(officeA, 47);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.orderPolicyConfigured, true);
  // The policy does not change the platform-fee preview: price 0 is still free.
  assert.equal(r.body.method, "FREE");
});

test("W-006: previews are tenant-scoped and role-checked", async () => {
  await adjust(officeB.tenant.id, 3);
  const fromA = await preview(officeA, 44, officeA.citizen);
  assert.equal(fromA.status, 200, JSON.stringify(fromA.body));
  assert.equal(fromA.body.walletBalance, 5, "a citizen sees their own office's wallet");
  const fromB = await preview(officeB, 44, officeB.citizen);
  assert.equal(fromB.status, 200, JSON.stringify(fromB.body));
  assert.equal(fromB.body.walletBalance, 3);
  const anon = await req("GET", "/fee-preview?serviceNo=44");
  assert.equal(anon.status, 401);
  for (const bad of ["0", "48", "abc"]) {
    const r = await req("GET", `/fee-preview?serviceNo=${bad}`, undefined, officeA.staff);
    assert.equal(r.status, 422, `serviceNo=${bad}: ${JSON.stringify(r.body)}`);
  }
});
