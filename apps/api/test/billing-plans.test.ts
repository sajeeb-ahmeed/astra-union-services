import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { getDemoPayload } from "@astra/shared-schemas";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";

/**
 * Phase 3C: the owner-managed plan catalogue + monthly allowance limits.
 * Three plans are created through the owner API (limited / unlimited / to-be-hidden)
 * and three fresh offices exercise them. Plans and credit prices are platform-global:
 * plan ids carry the run suffix, and the service-45 price is always published through
 * the current version, so this file composes with billing-submit.test.ts either way.
 */
type Session = { cookie: string; csrf: string; user: any };
const run = randomUUID().slice(0, 8);
const password = "Phase3c-Synthetic-123!";
const admin = new pg.Pool({ connectionString: adminConnectionString });
let server: ReturnType<typeof app.listen>, base: string;
const owner: { current?: Session } = {};
type Office = {
  tenant: any;
  admin: Session;
  approver: Session;
  staff: Session;
  citizen: Session;
  citizenId: string;
};
let officeL: Office, officeU: Office, officeH: Office;
const SERVICE = 45;
const LIMITED = `limited-${run}`;
const UNLIMITED = `unlimited-${run}`;
const HIDDEN = `hidden-${run}`;

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
  const cookieHeader = r.headers.get(["set", "cookie"].join("-"));
  assert.ok(cookieHeader, "login must return a session cookie");
  return { cookie: cookieHeader.split(";")[0], csrf: json.csrfToken, user: json.user };
}
async function buildOffice(slug: string): Promise<Office> {
  const created = await req(
    "POST",
    "/owner/tenants",
    {
      slug,
      nameBn: "পরীক্ষা অফিস",
      nameEn: `Phase 3C test office ${slug}`,
      division: "Test Division",
      district: "Test District",
      upazila: "Test Upazila",
      officeType: "UNION",
      adminEmail: `admin@${slug}.test`,
      adminName: "Phase 3C Admin",
      adminPassword: password,
    },
    owner.current,
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const tenant = created.body;
  const adminSession = await login(`admin@${slug}.test`);
  const sessions: Record<string, Session> = { admin: adminSession };
  for (const roleName of ["approver", "staff"]) {
    const u = await req(
      "POST",
      "/admin/users",
      { email: `${roleName}@${slug}.test`, displayName: `Test ${roleName}`, password, role: roleName },
      adminSession,
    );
    assert.equal(u.status, 201, JSON.stringify(u.body));
    sessions[roleName] = await login(`${roleName}@${slug}.test`);
  }
  const auth = await req(
    "PUT",
    `/admin/authorizations/${sessions.approver.user.id}/${SERVICE}`,
    { active: true, authorityNote: "Synthetic Phase 3C approval authority" },
    adminSession,
  );
  assert.equal(auth.status, 200, JSON.stringify(auth.body));
  const email = `citizen-${slug}@synthetic.test`;
  const signup = await req("POST", "/auth/signup", {
    email,
    password,
    displayName: "Phase 3C Citizen",
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
  return { tenant, admin: adminSession, approver: sessions.approver, staff: sessions.staff, citizen, citizenId };
}
async function ownerTenants() {
  const r = await req("GET", "/owner/tenants", undefined, owner.current);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}
async function subscriptionOf(tenantId: string) {
  const { items } = await ownerTenants();
  return items.find((t: any) => t.id === tenantId)?.subscription;
}
async function walletOf(tenantId: string) {
  const { items } = await ownerTenants();
  return items.find((t: any) => t.id === tenantId)?.balance as number;
}
async function adjust(tenantId: string, delta: number) {
  const r = await req(
    "POST",
    `/owner/tenants/${tenantId}/adjust`,
    { delta, reason: "Phase 3C test funding" },
    owner.current,
  );
  assert.equal(r.status, 201, JSON.stringify(r.body));
}
async function activate(tenantId: string, planId: string) {
  const r = await req(
    "POST",
    `/owner/tenants/${tenantId}/subscription`,
    { action: "activate", planId, grantCredits: false, reason: "Phase 3C test activation" },
    owner.current,
  );
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
async function plans() {
  const r = await req("GET", "/owner/plans", undefined, owner.current);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.items as any[];
}
async function createPlan(body: Record<string, unknown>) {
  return req("POST", "/owner/plans", body, owner.current);
}
async function priceOf(serviceNo: number) {
  const r = await req("GET", "/owner/credit-prices", undefined, owner.current);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.items.find((i: any) => i.serviceNo === serviceNo);
}
async function publishPrice(serviceNo: number, priceCredits: number) {
  const current = await priceOf(serviceNo);
  const r = await req(
    "POST",
    `/owner/credit-prices/${serviceNo}`,
    { expectedVersion: current.version, priceCredits, reason: "Phase 3C test price" },
    owner.current,
  );
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
async function draftApplication(office: Office) {
  const created = await req(
    "POST",
    "/applications",
    {
      citizenId: office.citizenId,
      serviceNo: SERVICE,
      payload: { ...getDemoPayload(SERVICE), delivery_language: "bn" },
    },
    office.staff,
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body.id as string;
}
async function transition(office: Office, id: string, action: string, session: Session, reason?: string) {
  return req("POST", `/applications/${id}/transition`, { action, ...(reason ? { reason } : {}) }, session);
}
async function submit(office: Office) {
  const id = await draftApplication(office);
  const r = await transition(office, id, "submit", office.staff);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return id;
}
async function detail(office: Office, id: string) {
  const r = await req("GET", `/applications/${id}`, undefined, office.staff);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.application;
}
async function feeEntries(tenantId: string) {
  return (
    await admin.query(
      "SELECT delta, application_id FROM credit_ledger WHERE tenant_id=$1 AND kind='APPLICATION_FEE' ORDER BY created_at",
      [tenantId],
    )
  ).rows;
}
async function allowanceCount(tenantId: string) {
  return (
    await admin.query(
      "SELECT count(*)::int AS n FROM subscription_allowance_consumptions WHERE tenant_id=$1 AND period_month=(date_trunc('month', now()))::date",
      [tenantId],
    )
  ).rows[0].n as number;
}

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  owner.current = await login("owner@astra.demo.test", "Demo-Phase1!");
  officeL = await buildOffice(`planl-${run}`);
  officeU = await buildOffice(`planu-${run}`);
  officeH = await buildOffice(`planh-${run}`);
});
after(async () => {
  await closePdfBrowser();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await admin.end();
});

test("Phase 3C: plan CRUD is owner-only, validated, and audited with before/after", async () => {
  assert.equal((await req("GET", "/owner/plans", undefined, officeL.admin)).status, 403);
  assert.equal(
    (
      await createPlanAs(officeL.admin, {
        id: LIMITED, name: "Nope", durationDays: 30, priceMinor: 0, grantCredits: 1,
        monthlyAllowanceLimit: null, reason: "not the owner here",
      })
    ).status,
    403,
  );

  // The seeded standard plan survives the catalogue migration unchanged in behaviour:
  // unlimited allowance, on sale.
  const seeded = (await plans()).find((p) => p.id === "standard-monthly");
  assert.ok(seeded, "standard-monthly still listed");
  assert.equal(seeded.monthlyAllowanceLimit, null);
  assert.equal(seeded.onSale, true);

  const created = await createPlan({
    id: LIMITED, name: "Limited Test Plan", durationDays: 30, priceMinor: 50000,
    grantCredits: 5, monthlyAllowanceLimit: 2, sortOrder: 10,
    reason: "Phase 3C limited plan creation",
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.plan.id, LIMITED);
  assert.equal(created.body.plan.monthlyAllowanceLimit, 2);
  assert.equal(created.body.plan.onSale, true);
  assert.equal(created.body.plan.priceMinor, 50000);

  for (const bad of [
    { durationDays: 0 },
    { durationDays: 3651 },
    { priceMinor: -1 },
    { grantCredits: -1 },
    { grantCredits: 0 },
    { monthlyAllowanceLimit: 0 },
    { name: "   " },
    { reason: "short" },
  ]) {
    const r = await createPlan({
      id: `bad-${run}`, name: "Bad Plan", durationDays: 30, priceMinor: 0, grantCredits: 1,
      monthlyAllowanceLimit: null, reason: "Phase 3C validation probe", ...bad,
    });
    assert.equal(r.status, 422, JSON.stringify(bad));
  }
  const duplicate = await createPlan({
    id: LIMITED, name: "Duplicate", durationDays: 30, priceMinor: 0, grantCredits: 1,
    monthlyAllowanceLimit: null, reason: "Phase 3C duplicate probe",
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error.code, "PLAN_ID_TAKEN");

  assert.equal(
    (await createPlan({ id: UNLIMITED, name: "Unlimited Test Plan", durationDays: 90, priceMinor: 120000, grantCredits: 1, monthlyAllowanceLimit: null, reason: "Phase 3C unlimited plan creation" })).status,
    201,
  );
  assert.equal(
    (await createPlan({ id: HIDDEN, name: "Hidden Test Plan", durationDays: 30, priceMinor: 10000, grantCredits: 1, monthlyAllowanceLimit: 5, reason: "Phase 3C hidden plan creation" })).status,
    201,
  );

  // Update + audit: the history shows CREATE then UPDATE with before/after state.
  const updated = await req(
    "PUT",
    `/owner/plans/${LIMITED}`,
    {
      name: "Limited Test Plan", durationDays: 30, priceMinor: 60000, grantCredits: 5,
      monthlyAllowanceLimit: 2, onSale: true, sortOrder: 10, rollover: true,
      reason: "Phase 3C price correction",
    },
    owner.current,
  );
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.plan.priceMinor, 60000);
  const changes = await req("GET", `/owner/plans/${LIMITED}/changes`, undefined, owner.current);
  assert.equal(changes.status, 200, JSON.stringify(changes.body));
  assert.equal(changes.body.items.length, 2);
  assert.equal(changes.body.items[0].action, "UPDATE");
  assert.equal(changes.body.items[0].before.priceMinor, 50000);
  assert.equal(changes.body.items[0].after.priceMinor, 60000);
  assert.equal(changes.body.items[0].reason, "Phase 3C price correction");
  assert.equal(changes.body.items[1].action, "CREATE");
  assert.equal(changes.body.items[1].before, null);
  assert.equal((await req("GET", `/owner/plans/${LIMITED}/changes`, undefined, officeL.admin)).status, 403);
  assert.equal((await req("GET", "/owner/plans/nope/changes", undefined, owner.current)).status, 404);
  assert.equal(
    (
      await req(
        "PUT",
        "/owner/plans/nope",
        { name: "X", durationDays: 30, priceMinor: 0, grantCredits: 1, monthlyAllowanceLimit: null, onSale: true, sortOrder: 0, rollover: true, reason: "Phase 3C missing plan" },
        owner.current,
      )
    ).status,
    404,
  );
});
async function createPlanAs(session: Session, body: Record<string, unknown>) {
  return req("POST", "/owner/plans", body, session);
}

test("Phase 3C: a limited plan covers N submits, then the per-service credit price applies", async () => {
  await publishPrice(SERVICE, 4);
  await activate(officeL.tenant.id, LIMITED);
  const subscription = await subscriptionOf(officeL.tenant.id);
  assert.equal(subscription.status, "ACTIVE");
  assert.equal(subscription.planId, LIMITED);
  // The terms were snapshotted at activation.
  assert.equal(subscription.planAllowanceLimit, 2);
  assert.equal(subscription.planDurationDays, 30);
  assert.equal(subscription.planGrantCredits, 5);

  await adjust(officeL.tenant.id, 10);
  const first = await submit(officeL);
  assert.equal((await detail(officeL, first)).feeMethod, "ALLOWANCE");
  assert.equal(await allowanceCount(officeL.tenant.id), 1);
  const second = await submit(officeL);
  assert.equal((await detail(officeL, second)).feeMethod, "ALLOWANCE");
  assert.equal(await allowanceCount(officeL.tenant.id), 2);
  assert.equal(await walletOf(officeL.tenant.id), 10);
  assert.equal((await feeEntries(officeL.tenant.id)).length, 0);

  // Allowance exhausted: the third submit pays the per-service credit price.
  const third = await submit(officeL);
  const settled = await detail(officeL, third);
  assert.equal(settled.feeMethod, "CREDIT");
  assert.equal(settled.feeCredits, 4);
  assert.equal(await walletOf(officeL.tenant.id), 6);
  assert.equal(await allowanceCount(officeL.tenant.id), 2);
  const entries = await feeEntries(officeL.tenant.id);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].delta, -4);
  assert.equal(entries[0].application_id, third);

  // A correction + resubmit of an allowance-covered application consumes nothing more.
  const correction = await transition(officeL, first, "request_correction", officeL.approver, "Please clarify the demonstration address");
  assert.equal(correction.status, 200, JSON.stringify(correction.body));
  const edited = await req(
    "PATCH",
    `/applications/${first}`,
    { payload: { ...getDemoPayload(SERVICE), delivery_language: "bn", purpose_en: "Revised synthetic purpose" } },
    officeL.citizen,
  );
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  const resubmitted = await transition(officeL, first, "resubmit", officeL.citizen);
  assert.equal(resubmitted.status, 200, JSON.stringify(resubmitted.body));
  assert.equal(await allowanceCount(officeL.tenant.id), 2);
  assert.equal(await walletOf(officeL.tenant.id), 6);
  assert.equal((await feeEntries(officeL.tenant.id)).length, 1);
  (globalThis as any).__lFirst = first;
});

test("Phase 3C: editing a plan never rewrites a running subscription's snapshotted terms", async () => {
  const before = await subscriptionOf(officeL.tenant.id);
  const edited = await req(
    "PUT",
    `/owner/plans/${LIMITED}`,
    {
      name: "Limited Test Plan", durationDays: 365, priceMinor: 99900, grantCredits: 50,
      monthlyAllowanceLimit: 9, onSale: true, sortOrder: 10, rollover: true,
      reason: "Phase 3C terms change probe",
    },
    owner.current,
  );
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  const after = await subscriptionOf(officeL.tenant.id);
  assert.equal(after.planAllowanceLimit, 2, "snapshot limit survives the plan edit");
  assert.equal(after.planDurationDays, 30);
  assert.equal(after.planGrantCredits, 5);
  assert.equal(after.validUntil, before.validUntil);

  // With a live-read limit of 9 the next submit would be covered; the snapshot (2,
  // already exhausted) means it is charged instead.
  const fourth = await submit(officeL);
  const settled = await detail(officeL, fourth);
  assert.equal(settled.feeMethod, "CREDIT");
  assert.equal(settled.feeCredits, 4);
  assert.equal(await allowanceCount(officeL.tenant.id), 2);
  assert.equal(await walletOf(officeL.tenant.id), 2);
});

test("Phase 3C: an unlimited plan never falls back to credit charges", async () => {
  await activate(officeU.tenant.id, UNLIMITED);
  const subscription = await subscriptionOf(officeU.tenant.id);
  assert.equal(subscription.planAllowanceLimit, null);
  for (let i = 0; i < 3; i++) {
    const id = await submit(officeU);
    assert.equal((await detail(officeU, id)).feeMethod, "ALLOWANCE");
  }
  assert.equal(await allowanceCount(officeU.tenant.id), 3);
  assert.equal(await walletOf(officeU.tenant.id), 0);
  assert.equal((await feeEntries(officeU.tenant.id)).length, 0);
});

test("Phase 3C: a hidden plan takes no new orders, but existing subscriptions and orders carry on", async () => {
  // While on sale, the office sees the plan and can order it.
  const billingBefore = await req("GET", "/billing", undefined, officeH.admin);
  assert.equal(billingBefore.status, 200, JSON.stringify(billingBefore.body));
  assert.ok(billingBefore.body.plans.some((p: any) => p.id === HIDDEN));
  const order = await req(
    "POST",
    "/billing/orders",
    { kind: "subscription", planId: HIDDEN },
    officeH.admin,
  );
  assert.equal(order.status, 201, JSON.stringify(order.body));
  assert.equal(order.body.status, "PENDING");

  // The office's own subscription moves onto the plan, then the owner hides it.
  await activate(officeH.tenant.id, HIDDEN);
  const hidden = await req(
    "POST",
    `/owner/plans/${HIDDEN}/on-sale`,
    { onSale: false, reason: "Phase 3C hiding the plan" },
    owner.current,
  );
  assert.equal(hidden.status, 200, JSON.stringify(hidden.body));
  assert.equal(hidden.body.plan.onSale, false);
  const changes = await req("GET", `/owner/plans/${HIDDEN}/changes`, undefined, owner.current);
  assert.equal(changes.body.items[0].action, "ON_SALE");
  assert.equal(changes.body.items[0].after.onSale, false);

  // No new orders, and the plan is no longer offered — but the office's current
  // plan still resolves for display.
  const refused = await req(
    "POST",
    "/billing/orders",
    { kind: "subscription", planId: HIDDEN },
    officeH.admin,
  );
  assert.equal(refused.status, 422, JSON.stringify(refused.body));
  assert.equal(refused.body.error.code, "PLAN_NOT_ON_SALE");
  const billingAfter = await req("GET", "/billing", undefined, officeH.admin);
  assert.ok(!billingAfter.body.plans.some((p: any) => p.id === HIDDEN));
  assert.equal(billingAfter.body.currentPlan?.id, HIDDEN);
  assert.equal(billingAfter.body.subscription.planId, HIDDEN);

  // The existing subscription still covers submits from its snapshot.
  const covered = await submit(officeH);
  assert.equal((await detail(officeH, covered)).feeMethod, "ALLOWANCE");
  assert.equal(await allowanceCount(officeH.tenant.id), 1);

  // And the order created while the plan was on sale still settles, snapshotting
  // the plan's terms onto the subscription.
  const settled = await req(
    "POST",
    `/owner/payment-orders/${order.body.id}/settle`,
    { reason: "Phase 3C settling the pre-hide order" },
    owner.current,
  );
  assert.equal(settled.status, 200, JSON.stringify(settled.body));
  const subscription = await subscriptionOf(officeH.tenant.id);
  assert.equal(subscription.status, "ACTIVE");
  assert.equal(subscription.planId, HIDDEN);
  assert.equal(subscription.planAllowanceLimit, 5);
});
