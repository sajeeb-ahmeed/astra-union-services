import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { getDemoPayload } from "@astra/shared-schemas";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";

/**
 * Phase 3B: per-service credit pricing + charge at final submit.
 * Three fresh offices keep every money state explicit: P pays as it goes, S holds an
 * active subscription, Q starts empty for the insufficient-balance and citizen-pays
 * paths. Credit prices are platform-global, so the file tracks versions through the
 * API instead of assuming a virgin table; service 44 is never priced by anyone and
 * carries the default-price assertions.
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
  approver: Session;
  staff: Session;
  citizen: Session;
  citizenId: string;
};
let officeP: Office, officeS: Office, officeQ: Office;
const SERVICE = 45;
const DEFAULT_SERVICE = 44;

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
async function buildOffice(slug: string, activate: boolean): Promise<Office> {
  const created = await req(
    "POST",
    "/owner/tenants",
    {
      slug,
      nameBn: "পরীক্ষা অফিস",
      nameEn: `Phase 3B test office ${slug}`,
      division: "Test Division",
      district: "Test District",
      upazila: "Test Upazila",
      officeType: "UNION",
      adminEmail: `admin@${slug}.test`,
      adminName: "Phase 3B Admin",
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
  for (const serviceNo of [SERVICE, DEFAULT_SERVICE]) {
    const auth = await req(
      "PUT",
      `/admin/authorizations/${sessions.approver.user.id}/${serviceNo}`,
      { active: true, authorityNote: "Synthetic Phase 3B approval authority" },
      adminSession,
    );
    assert.equal(auth.status, 200, JSON.stringify(auth.body));
  }
  // W-002: issuance gates run in every mode, so the office needs an
  // explicitly identified synthetic signature fixture before anything can
  // issue. A 1x1 PNG — clearly not a real chairman signature.
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
  const email = `citizen-${slug}@synthetic.test`;
  const signup = await req("POST", "/auth/signup", {
    email,
    password,
    displayName: "Phase 3B Citizen",
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
  return {
    tenant,
    admin: adminSession,
    approver: sessions.approver,
    staff: sessions.staff,
    citizen,
    citizenId,
  };
}
async function walletOf(tenantId: string) {
  const r = await req("GET", "/owner/tenants", undefined, owner.current);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.items.find((t: any) => t.id === tenantId)?.balance as number;
}
async function adjust(tenantId: string, delta: number) {
  const r = await req(
    "POST",
    `/owner/tenants/${tenantId}/adjust`,
    { delta, reason: "Phase 3B test funding" },
    owner.current,
  );
  assert.equal(r.status, 201, JSON.stringify(r.body));
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
    { expectedVersion: current.version, priceCredits, reason: "Phase 3B test price" },
    owner.current,
  );
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
async function draftApplication(office: Office, serviceNo = SERVICE) {
  const created = await req(
    "POST",
    "/applications",
    {
      citizenId: office.citizenId,
      serviceNo,
      payload: { ...getDemoPayload(serviceNo), delivery_language: "bn" },
    },
    office.staff,
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body.id as string;
}
async function transition(office: Office, id: string, action: string, session: Session, reason?: string) {
  return req(
    "POST",
    `/applications/${id}/transition`,
    { action, ...(reason ? { reason } : {}) },
    session,
  );
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
  officeP = await buildOffice(`billp-${run}`, false);
  officeS = await buildOffice(`bills-${run}`, true);
  officeQ = await buildOffice(`billq-${run}`, false);
});
after(async () => {
  try {
    // The payer setting is platform-global: never leave it on citizen.
    await req(
      "PUT",
      "/owner/billing-settings",
      { applicationFeePayer: "office", reason: "Phase 3B test cleanup" },
      owner.current,
    );
  } finally {
    await closePdfBrowser();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
    await admin.end();
  }
});

test("Phase 3B: only the owner publishes versioned credit prices; the default is 1", async () => {
  assert.equal((await req("GET", "/owner/credit-prices", undefined, officeP.admin)).status, 403);
  assert.equal(
    (await req("POST", `/owner/credit-prices/${SERVICE}`, { expectedVersion: 0, priceCredits: 3, reason: "not the owner" }, officeP.admin)).status,
    403,
  );
  const untouched = await priceOf(DEFAULT_SERVICE);
  assert.equal(untouched.version, 0);
  assert.equal(untouched.priceCredits, 1);
  assert.equal(untouched.isDefault, true);

  const current = await priceOf(SERVICE);
  for (const bad of [
    { priceCredits: -1 },
    { priceCredits: 10001 },
    { priceCredits: 1.5 },
    { reason: "ab" },
  ])
    assert.equal(
      (
        await req(
          "POST",
          `/owner/credit-prices/${SERVICE}`,
          { expectedVersion: current.version, priceCredits: 3, reason: "Valid reason", ...bad },
          owner.current,
        )
      ).status,
      422,
      JSON.stringify(bad),
    );
  assert.equal(
    (
      await req(
        "POST",
        `/owner/credit-prices/${SERVICE}`,
        { expectedVersion: current.version + 5, priceCredits: 3, reason: "Stale version" },
        owner.current,
      )
    ).status,
    409,
  );
  const published = await publishPrice(SERVICE, 3);
  assert.equal(published.priceCredits, 3);
  const after = await priceOf(SERVICE);
  assert.equal(after.priceCredits, 3);
  assert.equal(after.version, published.version);
  assert.equal(after.isDefault, false);
  const versions = await req("GET", `/owner/credit-prices/${SERVICE}/versions`, undefined, owner.current);
  assert.equal(versions.status, 200, JSON.stringify(versions.body));
  const mine = versions.body.items.find((v: any) => v.version === published.version);
  assert.equal(mine.priceCredits, 3);
  assert.equal(mine.reason, "Phase 3B test price");
  assert.equal(
    (await req("GET", `/owner/credit-prices/${SERVICE}/versions`, undefined, officeP.admin)).status,
    403,
  );
});

test("Phase 3B: submit charges exactly the published price, once, at the price in force", async () => {
  await publishPrice(SERVICE, 3);
  const versionAtSubmit = (await priceOf(SERVICE)).version;
  await adjust(officeP.tenant.id, 10);
  const id = await draftApplication(officeP);
  const submitted = await transition(officeP, id, "submit", officeP.staff);
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  assert.equal(await walletOf(officeP.tenant.id), 7);
  const settled = await detail(officeP, id);
  assert.equal(settled.state, "SUBMITTED");
  assert.equal(settled.feeMethod, "CREDIT");
  assert.equal(settled.feeCredits, 3);
  assert.equal(settled.feePriceVersion, versionAtSubmit);
  assert.ok(settled.feeSettledAt);
  const entries = await feeEntries(officeP.tenant.id);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].delta, -3);
  assert.equal(entries[0].application_id, id);

  // A later price change never rewrites the recorded charge, and the next
  // submit pays the new price.
  await publishPrice(SERVICE, 5);
  assert.equal((await detail(officeP, id)).feeCredits, 3);
  const second = await draftApplication(officeP);
  const submittedSecond = await transition(officeP, second, "submit", officeP.staff);
  assert.equal(submittedSecond.status, 200, JSON.stringify(submittedSecond.body));
  assert.equal(await walletOf(officeP.tenant.id), 2);
  assert.equal((await detail(officeP, second)).feeCredits, 5);
  assert.equal((await feeEntries(officeP.tenant.id)).length, 2);
  // Kept for the resubmit test.
  (globalThis as any).__pSecond = second;
});

test("Phase 3B: a correction and resubmit of the same application never re-charges", async () => {
  const id = (globalThis as any).__pSecond as string;
  const correction = await transition(
    officeP,
    id,
    "request_correction",
    officeP.approver,
    "Please clarify the demonstration address",
  );
  assert.equal(correction.status, 200, JSON.stringify(correction.body));
  assert.equal(correction.body.state, "CORRECTION_REQUIRED");
  const edited = await req(
    "PATCH",
    `/applications/${id}`,
    { payload: { ...getDemoPayload(SERVICE), delivery_language: "bn", purpose: "Revised synthetic purpose" } },
    officeP.citizen,
  );
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  const resubmitted = await transition(officeP, id, "resubmit", officeP.citizen);
  assert.equal(resubmitted.status, 200, JSON.stringify(resubmitted.body));
  assert.equal(resubmitted.body.state, "RESUBMITTED");
  assert.equal(await walletOf(officeP.tenant.id), 2);
  assert.equal((await feeEntries(officeP.tenant.id)).length, 2);
  assert.equal((await detail(officeP, id)).feeCredits, 5);
  (globalThis as any).__pResubmitted = id;
});

test("Phase 3B: a subscribed office pays 0 and consumes one allowance per application", async () => {
  assert.equal(await walletOf(officeS.tenant.id), 0);
  const first = await draftApplication(officeS);
  const submitted = await transition(officeS, first, "submit", officeS.staff);
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  assert.equal(await walletOf(officeS.tenant.id), 0);
  assert.equal((await feeEntries(officeS.tenant.id)).length, 0);
  const settled = await detail(officeS, first);
  assert.equal(settled.feeMethod, "ALLOWANCE");
  assert.equal(settled.feeCredits, 0);
  assert.equal(await allowanceCount(officeS.tenant.id), 1);

  const correction = await transition(
    officeS,
    first,
    "request_correction",
    officeS.approver,
    "Please clarify the demonstration address",
  );
  assert.equal(correction.status, 200, JSON.stringify(correction.body));
  const edited = await req(
    "PATCH",
    `/applications/${first}`,
    { payload: { ...getDemoPayload(SERVICE), delivery_language: "bn", purpose: "Revised synthetic purpose" } },
    officeS.citizen,
  );
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  const resubmitted = await transition(officeS, first, "resubmit", officeS.citizen);
  assert.equal(resubmitted.status, 200, JSON.stringify(resubmitted.body));
  assert.equal(await allowanceCount(officeS.tenant.id), 1, "resubmit consumes nothing further");

  const second = await draftApplication(officeS);
  const submittedSecond = await transition(officeS, second, "submit", officeS.staff);
  assert.equal(submittedSecond.status, 200, JSON.stringify(submittedSecond.body));
  assert.equal(await allowanceCount(officeS.tenant.id), 2);
});

test("Phase 3B: insufficient balance keeps the application a draft and charges nothing", async () => {
  assert.equal(await walletOf(officeQ.tenant.id), 0);
  const id = await draftApplication(officeQ);
  const refused = await transition(officeQ, id, "submit", officeQ.staff);
  assert.equal(refused.status, 402, JSON.stringify(refused.body));
  assert.equal(refused.body.error.code, "APPLICATION_FEE_INSUFFICIENT");
  assert.match(refused.body.error.message, /খসড়া/);
  const draft = await detail(officeQ, id);
  assert.equal(draft.state, "DRAFT");
  assert.equal(draft.feeSettledAt, null);
  assert.equal((await feeEntries(officeQ.tenant.id)).length, 0);
  // The same draft submits once the office is funded — no work was lost.
  await adjust(officeQ.tenant.id, 5);
  const submitted = await transition(officeQ, id, "submit", officeQ.staff);
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  assert.equal(await walletOf(officeQ.tenant.id), 0);
  assert.equal((await detail(officeQ, id)).feeCredits, 5);
});

test("Phase 3B: issuance after a paid submit needs no subscription and deducts nothing more", async () => {
  const id = (globalThis as any).__pResubmitted as string;
  // Office P's subscription was never activated — under the old model this
  // issuance would have failed 402 SUBSCRIPTION_INACTIVE and debited the wallet.
  const before = await walletOf(officeP.tenant.id);
  const approved = await transition(officeP, id, "approve", officeP.approver);
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.ok(approved.body.certificate?.number, "certificate issued");
  assert.equal((await detail(officeP, id)).state, "ISSUED");
  assert.equal(await walletOf(officeP.tenant.id), before);
  const issuanceEntries = (
    await admin.query(
      "SELECT count(*)::int AS n FROM credit_ledger WHERE tenant_id=$1 AND kind='ISSUANCE'",
      [officeP.tenant.id],
    )
  ).rows[0].n;
  assert.equal(issuanceEntries, 0);
  assert.equal((await feeEntries(officeP.tenant.id)).length, 2);
});

test("Phase 3B: citizen-pays mode holds submits as drafts until the owner switches back", async () => {
  assert.equal(
    (
      await req(
        "PUT",
        "/owner/billing-settings",
        { applicationFeePayer: "citizen", reason: "Phase 3B test switch" },
        officeQ.admin,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await req(
        "PUT",
        "/owner/billing-settings",
        { applicationFeePayer: "citizen", reason: "short" },
        owner.current,
      )
    ).status,
    422,
  );
  const set = await req(
    "PUT",
    "/owner/billing-settings",
    { applicationFeePayer: "citizen", reason: "Phase 3B test switch" },
    owner.current,
  );
  assert.equal(set.status, 200, JSON.stringify(set.body));
  const read = await req("GET", "/owner/billing-settings", undefined, owner.current);
  assert.equal(read.body.applicationFeePayer, "citizen");

  const id = await draftApplication(officeQ);
  const refused = await transition(officeQ, id, "submit", officeQ.staff);
  assert.equal(refused.status, 402, JSON.stringify(refused.body));
  assert.equal(refused.body.error.code, "CITIZEN_PAYMENT_UNAVAILABLE");
  assert.match(refused.body.error.message, /খসড়া/);
  assert.equal((await detail(officeQ, id)).state, "DRAFT");
  assert.equal((await feeEntries(officeQ.tenant.id)).length, 1, "only the earlier paid submit is in the ledger");

  const back = await req(
    "PUT",
    "/owner/billing-settings",
    { applicationFeePayer: "office", reason: "Phase 3B test restore" },
    owner.current,
  );
  assert.equal(back.status, 200, JSON.stringify(back.body));
  await adjust(officeQ.tenant.id, 5);
  const submitted = await transition(officeQ, id, "submit", officeQ.staff);
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  assert.equal((await detail(officeQ, id)).feeMethod, "CREDIT");
});

test("Phase 3B: an unpublished service charges the default price of 1 credit", async () => {
  const item = await priceOf(DEFAULT_SERVICE);
  assert.equal(item.version, 0);
  assert.equal(item.isDefault, true);
  await adjust(officeQ.tenant.id, 2);
  const before = await walletOf(officeQ.tenant.id);
  const id = await draftApplication(officeQ, DEFAULT_SERVICE);
  const submitted = await transition(officeQ, id, "submit", officeQ.staff);
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  const settled = await detail(officeQ, id);
  assert.equal(settled.feeMethod, "CREDIT");
  assert.equal(settled.feeCredits, 1);
  assert.equal(settled.feePriceVersion, 0);
  assert.equal(await walletOf(officeQ.tenant.id), before - 1);
});
