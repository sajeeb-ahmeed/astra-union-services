import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { getDemoPayload } from "@astra/shared-schemas";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";
// B2: the allowance test activates a subscription through the sandbox settlement route.
process.env.DEMO_SETTLE_ENABLED = "true";

/**
 * W-008: identify the existing behaviour on rejection / cancellation /
 * revocation — and pin it, so it cannot change silently.
 *
 * Verified in code (app.ts transitions, revoke handler; billing.ts
 * settleApplicationFee; refunds.ts; docs/BILLING_AND_LEDGER.md:123):
 * the submit credit fee is settled ONCE at first submit (CREDIT via a
 * -price APPLICATION_FEE ledger entry, ALLOWANCE via a consumption row,
 * or FREE). Reject, cancel and revoke write NO ledger entry and restore
 * nothing: the fee stays taken, and the allowance consumption stays
 * consumed. The Phase 5d refund machine covers ONLY the verified
 * gateway BDT payment (application_refunds) and never touches credits.
 * No compensating-credit flow exists anywhere, and no owner-approved
 * refund policy defines which outcomes (if any) should be compensated —
 * so W-008 implements NO refund flow (OWNER DECISION REQUIRED; see
 * remediation-progress.md). These tests pin the documented current
 * behaviour so any future policy change is a deliberate, visible change.
 */
const SERVICE = 45;
const run = randomUUID().slice(0, 8);
const password = "W008-Retain-123!";
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
async function walletOf(tenantId: string) {
  const r = await req("GET", "/owner/tenants", undefined, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.items.find((t: any) => t.id === tenantId)?.balance as number;
}
async function adjust(tenantId: string, delta: number) {
  const r = await req(
    "POST",
    `/owner/tenants/${tenantId}/adjust`,
    { delta, reason: "W-008 test funding" },
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
async function feeEntries(tenantId: string) {
  return (
    await admin.query(
      "SELECT delta, kind, application_id FROM credit_ledger WHERE tenant_id=$1 AND kind='APPLICATION_FEE' ORDER BY created_at",
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
async function draft(serviceNo = SERVICE) {
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
async function transition(id: string, action: string, session: Session, reason?: string) {
  return req(
    "POST",
    `/applications/${id}/transition`,
    { action, ...(reason ? { reason } : {}) },
    session,
  );
}
async function detail(id: string) {
  const r = await req("GET", `/applications/${id}`, undefined, sessions.staff);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.application;
}
async function submitFunded() {
  const price = await priceOf(SERVICE);
  assert.ok(price >= 1, "service 45 must have a positive credit price for the CREDIT path");
  await adjust(office.id, price);
  const before = await walletOf(office.id);
  const id = await draft();
  const submitted = await transition(id, "submit", sessions.staff);
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  assert.equal(await walletOf(office.id), before - price, "submit takes the credit fee once");
  const settled = await detail(id);
  assert.equal(settled.feeMethod, "CREDIT");
  assert.equal(settled.feeCredits, price);
  assert.ok(settled.feeSettledAt, "fee settlement is recorded");
  return { id, price };
}

before(async () => {
  process.env.NODE_ENV = "test";
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  owner = await login("owner@astra.demo.test", "Demo-Phase1!");
  const slug = `w008-${run}`;
  const created = await req(
    "POST",
    "/owner/tenants",
    {
      slug,
      nameBn: "ডব্লিউ-০০৮ পরীক্ষা অফিস",
      nameEn: "W-008 test office",
      division: "Test Division",
      district: "Test District",
      upazila: "Test Upazila",
      officeType: "UNION",
      adminEmail: `admin@${slug}.test`,
      adminName: "W-008 Admin",
      adminPassword: password,
    },
    owner,
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  office = created.body;
  const adminSession = await login(`admin@${slug}.test`);
  sessions.admin = adminSession;
  for (const roleName of ["approver", "staff", "finance"]) {
    const u = await req(
      "POST",
      "/admin/users",
      {
        email: `${roleName}@${slug}.test`,
        displayName: `W-008 ${roleName}`,
        password,
        role: roleName,
      },
      adminSession,
    );
    assert.equal(u.status, 201, JSON.stringify(u.body));
    sessions[roleName] = await login(`${roleName}@${slug}.test`);
  }
  const auth = await req(
    "PUT",
    `/admin/authorizations/${sessions.approver.user.id}/${SERVICE}`,
    { active: true, authorityNote: "Synthetic W-008 approval authority" },
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
      reason:
        "Synthetic signature fixture for demo-mode issuance regression (W-002); not a real chairman signature",
    },
    sessions.approver,
  );
  assert.ok([200, 201].includes(signature.status), JSON.stringify(signature.body));
  const signup = await req("POST", "/auth/signup", {
    email: `citizen-${slug}@synthetic.test`,
    password,
    displayName: "W-008 Citizen",
    tenantId: office.id,
    nameBn: "পরীক্ষা নাগরিক",
    nameEn: "W-008 Citizen",
    dateOfBirth: "1998-02-03",
    addressBn: "পরীক্ষা ঠিকানা",
    addressEn: "Test address only",
    syntheticReference: `REF-${slug}`,
  });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  const citizenSession = await login(`citizen-${slug}@synthetic.test`);
  sessions.citizen = citizenSession;
  citizenId = (
    await req("GET", "/citizens", undefined, citizenSession)
  ).body.items[0].id;
});
after(async () => {
  await closePdfBrowser();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await admin.end();
});

test("W-008: rejecting a submitted application does not return the credit fee", async () => {
  const { id } = await submitFunded();
  const walletBefore = await walletOf(office.id);
  const entriesBefore = await feeEntries(office.id);
  const rejected = await transition(
    id,
    "reject",
    sessions.approver,
    "Synthetic W-008 rejection",
  );
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
  assert.equal(rejected.body.state, "REJECTED");
  assert.equal(await walletOf(office.id), walletBefore, "no credit is returned on rejection");
  assert.deepEqual(await feeEntries(office.id), entriesBefore, "no compensating ledger entry");
  const settled = await detail(id);
  assert.equal(settled.feeMethod, "CREDIT", "the settlement record is untouched");
  assert.ok(settled.feeSettledAt);
});

test("W-008: cancelling a submitted application does not return the credit fee", async () => {
  const { id } = await submitFunded();
  const walletBefore = await walletOf(office.id);
  const entriesBefore = await feeEntries(office.id);
  const cancelled = await transition(
    id,
    "cancel",
    sessions.citizen,
    "Synthetic W-008 cancellation",
  );
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.state, "CANCELLED");
  assert.equal(await walletOf(office.id), walletBefore, "no credit is returned on cancellation");
  assert.deepEqual(await feeEntries(office.id), entriesBefore, "no compensating ledger entry");
});

test("W-008: revoking an issued certificate does not return the credit fee", async () => {
  const { id } = await submitFunded();
  const approved = await transition(id, "approve", sessions.approver);
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.ok(approved.body.certificate?.number, "certificate issued");
  const certificateId = approved.body.certificate.id;
  const walletBefore = await walletOf(office.id);
  const entriesBefore = await feeEntries(office.id);
  const revoked = await req(
    "POST",
    `/certificates/${certificateId}/revoke`,
    { reason: "Synthetic W-008 revocation" },
    sessions.approver,
  );
  assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
  assert.equal(revoked.body.status, "REVOKED");
  assert.equal((await detail(id)).state, "REVOKED");
  assert.equal(await walletOf(office.id), walletBefore, "no credit is returned on revocation");
  assert.deepEqual(await feeEntries(office.id), entriesBefore, "no compensating ledger entry");
});

test("W-008: rejecting an allowance-covered application does not restore the allowance", async () => {
  const billing = await req(
    "POST",
    "/billing/orders",
    { kind: "subscription", planId: "standard-monthly" },
    sessions.finance,
  );
  assert.equal(billing.status, 201, JSON.stringify(billing.body));
  assert.equal(
    (
      await req(
        "POST",
        `/billing/orders/${billing.body.id}/demo-settle`,
        {},
        sessions.finance,
      )
    ).status,
    200,
  );
  const consumedBefore = await allowanceCount(office.id);
  const walletBefore = await walletOf(office.id);
  const id = await draft();
  const submitted = await transition(id, "submit", sessions.staff);
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  assert.equal((await detail(id)).feeMethod, "ALLOWANCE");
  assert.equal(await walletOf(office.id), walletBefore, "allowance covers the submit; wallet untouched");
  assert.equal(await allowanceCount(office.id), consumedBefore + 1);
  const rejected = await transition(
    id,
    "reject",
    sessions.approver,
    "Synthetic W-008 rejection of an allowance submit",
  );
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
  assert.equal(
    await allowanceCount(office.id),
    consumedBefore + 1,
    "the allowance consumption is not restored on rejection",
  );
  const entries = await feeEntries(office.id);
  assert.ok(
    !entries.some((e: any) => e.application_id === id),
    "no ledger fee entry for an allowance submit",
  );
});
