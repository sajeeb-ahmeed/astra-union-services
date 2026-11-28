import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { getDemoPayload } from "@astra/shared-schemas";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";

/**
 * CERT-FEE: self-service offices (verified by the owner before they appear
 * publicly or issue) and per-certificate platform fees charged at approval —
 * Bangla / English / both, paid from the office wallet or online, issuing
 * only the paid language version(s).
 */
type Session = { cookie: string; csrf: string; user: any };
const run = randomUUID().slice(0, 8);
// Generated per run: never a fixed credential in the repository.
const password = `Cf-${randomUUID().slice(0, 10)}!`;
const admin = new pg.Pool({ connectionString: adminConnectionString });
let server: ReturnType<typeof app.listen>, base: string;
let owner: Session;
const SERVICE = 45;
const FEE_BN = 2000; // ৳20
const FEE_EN = 3000; // ৳30
let feesBefore: { feeBnMinor: number; feeEnMinor: number; configured: boolean } | null = null;

type Office = { tenant: any; admin: Session; approver: Session; staff: Session; citizenId: string };
let office: Office;

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
  return {
    status: response.status,
    type,
    body: type.includes("json") ? await response.json() : Buffer.from(await response.arrayBuffer()),
  } as { status: number; type: string; body: any };
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
      nameBn: "সনদ ফি পরীক্ষা অফিস",
      nameEn: `Certificate fee test office ${slug}`,
      division: "Test Division",
      district: "Test District",
      upazila: "Test Upazila",
      officeType: "UNION",
      adminEmail: `admin@${slug}.test`,
      adminName: "Fee Test Admin",
      adminPassword: password,
    },
    owner,
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
    { active: true, authorityNote: "Synthetic certificate-fee approval authority" },
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
      reason: "Synthetic signature fixture for certificate-fee tests; not a real chairman signature",
    },
    sessions.approver,
  );
  assert.ok([200, 201].includes(signature.status), JSON.stringify(signature.body));
  const email = `citizen-${slug}@synthetic.test`;
  const signup = await req("POST", "/auth/signup", {
    email,
    password,
    displayName: "Fee Test Citizen",
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
  return { tenant, admin: adminSession, approver: sessions.approver, staff: sessions.staff, citizenId };
}
/** A submitted application, ready for the Chairman's decision. */
async function submitted(language: "bn" | "en" | "bilingual" = "bn") {
  const created = await req(
    "POST",
    "/applications",
    {
      citizenId: office.citizenId,
      serviceNo: SERVICE,
      payload: { ...getDemoPayload(SERVICE), delivery_language: language },
    },
    office.staff,
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const s = await req("POST", `/applications/${created.body.id}/transition`, { action: "submit" }, office.staff);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  return created.body.id as string;
}
const approve = (id: string, extra: object = {}) =>
  req("POST", `/applications/${id}/transition`, { action: "approve", ...extra }, office.approver);
const issue = (id: string, extra: object = {}) =>
  req("POST", `/applications/${id}/issue`, extra, office.approver);
async function state(id: string) {
  return (await admin.query("SELECT state, fee_method FROM applications WHERE id=$1", [id])).rows[0];
}
async function walletBalance() {
  return Number(
    (await admin.query("SELECT balance_minor FROM point_wallets WHERE tenant_id=$1", [office.tenant.id])).rows[0]
      .balance_minor,
  );
}
async function fund(deltaMinor: number) {
  const r = await req(
    "POST",
    `/owner/tenants/${office.tenant.id}/points/adjust`,
    { deltaMinor, reason: "Synthetic certificate-fee test funding", requestKey: randomUUID() },
    owner,
  );
  assert.equal(r.status, 201, JSON.stringify(r.body));
}
async function setFees(feeBnMinor: number, feeEnMinor: number) {
  const r = await req(
    "PUT",
    "/owner/certificate-fees",
    { feeBnMinor, feeEnMinor, reason: "Synthetic certificate-fee test prices" },
    owner,
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  owner = await login("owner@astra.demo.test", "Demo-Phase1!");
  const fees = await req("GET", "/owner/certificate-fees", undefined, owner);
  assert.equal(fees.status, 200, JSON.stringify(fees.body));
  feesBefore = fees.body;
  office = await buildOffice(`certfee-${run}`);
});
after(async () => {
  try {
    // Prices are platform-global: restore what this file found.
    if (feesBefore?.configured) await setFees(feesBefore.feeBnMinor, feesBefore.feeEnMinor);
    else
      await admin.query(
        "DELETE FROM platform_settings WHERE key IN ('certificate_fee_bn_minor','certificate_fee_en_minor')",
      );
  } finally {
    server?.close();
    await closePdfBrowser();
    await admin.end();
    await pool.end();
  }
});

test("CERT-FEE: a self-registered office is pending, hidden from the public and closed to citizens until the owner verifies it", async () => {
  const email = `chair-${run}@selfreg.test`;
  const body = {
    nameBn: "স্বনিবন্ধিত ইউনিয়ন পরিষদ",
    nameEn: `Self Registered Union ${run}`,
    officeType: "UNION",
    geography: { divisionCode: "div-02", districtCode: "dis-19", upazilaCode: "upa-089", unionCode: "uni-0001" },
    adminEmail: email,
    adminName: "Self Registered Chairman",
    adminPassword: password,
    acceptTerms: true,
  };
  const refused = await req("POST", "/public/offices/self-register", { ...body, acceptTerms: false });
  assert.equal(refused.status, 422, "the terms must be accepted");
  const created = await req("POST", "/public/offices/self-register", body);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.verificationStatus, "PENDING");
  assert.equal(created.body.billingMode, "PER_CERTIFICATE");
  const id = created.body.id;

  const again = await req("POST", "/public/offices/self-register", { ...body, nameEn: `Another ${run}` });
  assert.equal(again.status, 409, "one email opens one office");
  assert.equal(again.body.error.code, "EMAIL_TAKEN");

  // The office can sign in and set itself up at once.
  const chair = await login(email);
  assert.equal(chair.user.role ?? "admin", "admin");
  const users = await req("GET", "/admin/users", undefined, chair);
  assert.equal(users.status, 200, JSON.stringify(users.body));

  // Hidden from the public directory and from citizen sign-up.
  const listed = async () =>
    (await req("GET", `/offices?q=${encodeURIComponent(`Self Registered Union ${run}`)}`)).body.items.some(
      (o: any) => o.id === id,
    );
  assert.equal(await listed(), false, "a pending office is not listed publicly");
  const bySlug = await req("GET", `/offices/${created.body.slug}`);
  assert.equal(bySlug.status, 404, "a pending office has no public page");
  const signup = await req("POST", "/auth/signup", {
    email: `cz-${run}@selfreg.test`,
    password,
    displayName: "Citizen",
    tenantId: id,
    nameBn: "নাগরিক",
    nameEn: "Citizen",
    dateOfBirth: "1990-01-01",
    addressBn: "ঠিকানা",
    addressEn: "Address",
    syntheticReference: `REF-SR-${run}`,
  });
  assert.equal(signup.status, 404, "citizens cannot sign up at a pending office");

  // The owner sees it in the verification queue and verifies it.
  const queue = await req("GET", "/owner/office-verifications", undefined, owner);
  assert.equal(queue.status, 200, JSON.stringify(queue.body));
  const queued = queue.body.items.find((o: any) => o.id === id);
  assert.ok(queued, "the pending office is in the owner's queue");
  assert.equal(queued.adminEmail, email);
  const noReason = await req("POST", `/owner/tenants/${id}/verification`, { decision: "REJECTED" }, owner);
  assert.equal(noReason.status, 422, "a refusal needs a reason");
  const notOwner = await req("POST", `/owner/tenants/${id}/verification`, { decision: "VERIFIED" }, chair);
  assert.equal(notOwner.status, 403, "an office cannot verify itself");
  const verified = await req("POST", `/owner/tenants/${id}/verification`, { decision: "VERIFIED" }, owner);
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  assert.equal(verified.body.verificationStatus, "VERIFIED");
  assert.equal(await listed(), true, "a verified office is listed publicly");
});

test("CERT-FEE: the owner sets one Bangla and one English price; both languages cost the sum", async () => {
  const bad = await req("PUT", "/owner/certificate-fees", { feeBnMinor: -1, feeEnMinor: 0, reason: "Negative price test" }, owner);
  assert.equal(bad.status, 422);
  const officeTry = await req(
    "PUT",
    "/owner/certificate-fees",
    { feeBnMinor: 1, feeEnMinor: 1, reason: "An office may not set prices" },
    office.admin,
  );
  assert.equal(officeTry.status, 403);
  const fees = await setFees(FEE_BN, FEE_EN);
  assert.deepEqual(
    { bn: fees.feeBnMinor, en: fees.feeEnMinor, configured: fees.configured },
    { bn: FEE_BN, en: FEE_EN, configured: true },
  );
  const mode = await req(
    "PUT",
    `/owner/tenants/${office.tenant.id}/billing-mode`,
    { billingMode: "PER_CERTIFICATE", reason: "Synthetic switch to per-certificate billing" },
    owner,
  );
  assert.equal(mode.status, 200, JSON.stringify(mode.body));
  assert.equal(mode.body.billingMode, "PER_CERTIFICATE");

  const id = await submitted("bilingual");
  assert.equal((await state(id)).fee_method, "PER_CERTIFICATE", "submit charges nothing per-certificate");
  const quote = await req("GET", `/applications/${id}/certificate-fee`, undefined, office.approver);
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  assert.deepEqual(quote.body.amounts, { bn: FEE_BN, en: FEE_EN, bilingual: FEE_BN + FEE_EN });
  assert.equal(quote.body.defaultLanguages, "bilingual", "the citizen's ordered language is the default");
  assert.equal(quote.body.billingMode, "PER_CERTIFICATE");
  assert.equal(quote.body.officeVerified, true);
  const citizenQuote = await req("GET", `/applications/${id}/certificate-fee`, undefined, office.staff);
  assert.equal(citizenQuote.status, 403, "staff do not see the platform fee quote");
});

test("CERT-FEE: wallet payment — short balance holds the issuance, then Bangla-only issues one Bangla render and debits ৳20", async () => {
  const id = await submitted("bn");
  const short = await approve(id, { certificateLanguages: "bn", paymentMethod: "wallet" });
  assert.equal(short.status, 402, JSON.stringify(short.body));
  assert.equal(short.body.error.code, "WALLET_INSUFFICIENT");
  assert.equal((await state(id)).state, "APPROVED", "the Chairman's approval is still recorded");

  await fund(10000);
  const before = await walletBalance();
  const done = await issue(id, { certificateLanguages: "bn", paymentMethod: "wallet" });
  assert.equal(done.status, 201, JSON.stringify(done.body));
  assert.equal(done.body.languages, "bn");
  assert.equal(done.body.pdfUrlEn, null, "no English version was paid for");
  assert.equal(await walletBalance(), before - FEE_BN);
  const fee = (
    await admin.query("SELECT * FROM certificate_fees WHERE application_id=$1", [id])
  ).rows;
  assert.equal(fee.length, 1);
  assert.equal(fee[0].status, "CONSUMED");
  assert.equal(fee[0].method, "WALLET");
  assert.equal(Number(fee[0].amount_minor), FEE_BN);
  const ledger = (
    await admin.query("SELECT delta_minor, certificate_id FROM point_ledger WHERE idempotency_key=$1", [`certfee:${id}`])
  ).rows;
  assert.equal(ledger.length, 1);
  assert.equal(Number(ledger[0].delta_minor), -FEE_BN);
  assert.equal(ledger[0].certificate_id, done.body.id);

  const pdf = await req("GET", `/certificates/${done.body.id}/pdf`, undefined, office.approver);
  assert.equal(pdf.status, 200);
  assert.ok(String(pdf.type).includes("pdf"));
  const en = await req("GET", `/certificates/${done.body.id}/pdf?lang=en`, undefined, office.approver);
  assert.equal(en.status, 404);
  assert.equal(en.body.error.code, "LANGUAGE_VERSION_UNAVAILABLE");

  const twice = await issue(id, { certificateLanguages: "bn", paymentMethod: "wallet" });
  assert.ok([200, 201, 409].includes(twice.status));
  assert.equal(await walletBalance(), before - FEE_BN, "a certificate is never charged twice");
});

test("CERT-FEE: wallet payment for both languages debits ৳50 and stores both renders; English-only serves English", async () => {
  await fund(10000);
  const both = await submitted("bilingual");
  const before = await walletBalance();
  const r = await approve(both, { certificateLanguages: "bilingual", paymentMethod: "wallet" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.certificate.languages, "bilingual");
  assert.ok(r.body.certificate.pdfUrlEn);
  assert.equal(await walletBalance(), before - (FEE_BN + FEE_EN));

  const english = await submitted("en");
  const mid = await walletBalance();
  const e = await approve(english, { certificateLanguages: "en", paymentMethod: "wallet" });
  assert.equal(e.status, 200, JSON.stringify(e.body));
  assert.equal(e.body.certificate.languages, "en");
  assert.equal(await walletBalance(), mid - FEE_EN);
  const stored = (
    await admin.query("SELECT pdf IS NULL AS no_bn, pdf_en IS NULL AS no_en FROM certificates WHERE id=$1", [
      e.body.certificate.id,
    ])
  ).rows[0];
  assert.deepEqual(stored, { no_bn: true, no_en: false });
  const bn = await req("GET", `/certificates/${e.body.certificate.id}/pdf?lang=bn`, undefined, office.approver);
  assert.equal(bn.status, 404);
  const dflt = await req("GET", `/certificates/${e.body.certificate.id}/pdf`, undefined, office.approver);
  assert.equal(dflt.status, 200, "the default download serves the English render");
});

test("CERT-FEE: online payment — approval is recorded, the order settles, and only the paid language issues", async () => {
  const id = await submitted("en");
  const walletBefore = await walletBalance();
  const held = await approve(id, { certificateLanguages: "en", paymentMethod: "online" });
  assert.equal(held.status, 402, JSON.stringify(held.body));
  assert.equal(held.body.error.code, "CERTIFICATE_FEE_REQUIRED");
  assert.equal((await state(id)).state, "APPROVED");

  const first = await req("POST", `/applications/${id}/certificate-fee/order`, { languages: "en" }, office.approver);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.amountMinor, FEE_EN);
  assert.equal(first.body.status, "PENDING");
  const resumed = await req("POST", `/applications/${id}/certificate-fee/order`, { languages: "en" }, office.approver);
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.orderId, first.body.orderId, "the same unpaid order is resumed");

  // Changing the language before paying replaces the unpaid order.
  const changed = await req("POST", `/applications/${id}/certificate-fee/order`, { languages: "bilingual" }, office.approver);
  assert.equal(changed.status, 201, JSON.stringify(changed.body));
  assert.notEqual(changed.body.orderId, first.body.orderId);
  assert.equal(changed.body.amountMinor, FEE_BN + FEE_EN);
  const old = (await admin.query("SELECT status FROM payment_orders WHERE id=$1", [first.body.orderId])).rows[0];
  assert.equal(old.status, "CANCELLED");

  // Unpaid: issuing is still held.
  const unpaid = await issue(id, { certificateLanguages: "bilingual" });
  assert.equal(unpaid.status, 402);

  // The order settles (the owner's manual settlement shares the gateway's settlement effects).
  const settled = await req(
    "POST",
    `/owner/payment-orders/${changed.body.orderId}/settle`,
    { reason: "Synthetic settlement of a certificate fee order" },
    owner,
  );
  assert.equal(settled.status, 200, JSON.stringify(settled.body));
  const credit = (
    await admin.query("SELECT count(*)::int n FROM credit_ledger WHERE idempotency_key=$1", [`payment:${changed.body.orderId}`])
  ).rows[0].n;
  assert.equal(credit, 0, "a certificate fee grants no credits");
  const quote = await req("GET", `/applications/${id}/certificate-fee`, undefined, office.approver);
  assert.equal(quote.body.fee.status, "PAID");

  const mismatch = await issue(id, { certificateLanguages: "en" });
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.body.error.code, "CERTIFICATE_FEE_LANGUAGE_MISMATCH");
  const done = await issue(id, { certificateLanguages: "bilingual" });
  assert.equal(done.status, 201, JSON.stringify(done.body));
  assert.equal(done.body.languages, "bilingual");
  assert.equal(await walletBalance(), walletBefore, "an online fee never touches the wallet");
  const fee = (await admin.query("SELECT status, certificate_id FROM certificate_fees WHERE order_id=$1", [changed.body.orderId])).rows[0];
  assert.equal(fee.status, "CONSUMED");
  assert.equal(fee.certificate_id, done.body.id);

  const refund = await req(
    "POST",
    `/billing/orders/${changed.body.orderId}/gateway-refund`,
    { reason: "Synthetic refund attempt" },
    office.admin,
  );
  assert.notEqual(refund.status, 201, "a certificate fee is not refunded through the credit flow");
});

test("CERT-FEE: an office the owner has not verified cannot issue, but the approval is recorded", async () => {
  const id = await submitted("bn");
  const refuse = await req(
    "POST",
    `/owner/tenants/${office.tenant.id}/verification`,
    { decision: "REJECTED", note: "Synthetic: documents not yet checked" },
    owner,
  );
  assert.equal(refuse.status, 200, JSON.stringify(refuse.body));
  try {
    const r = await approve(id, { certificateLanguages: "bn", paymentMethod: "wallet" });
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.error.code, "OFFICE_NOT_VERIFIED");
    assert.equal((await state(id)).state, "APPROVED");
    const order = await req("POST", `/applications/${id}/certificate-fee/order`, { languages: "bn" }, office.approver);
    assert.equal(order.status, 409, "no fee is taken from an unverified office");
  } finally {
    const back = await req("POST", `/owner/tenants/${office.tenant.id}/verification`, { decision: "VERIFIED" }, owner);
    assert.equal(back.status, 200);
  }
  const done = await issue(id, { certificateLanguages: "bn", paymentMethod: "wallet" });
  assert.equal(done.status, 201, JSON.stringify(done.body));
});

test("CERT-FEE: a SUBMIT_CREDIT office keeps the established behaviour — both versions, no certificate fee", async () => {
  const mode = await req(
    "PUT",
    `/owner/tenants/${office.tenant.id}/billing-mode`,
    { billingMode: "SUBMIT_CREDIT", reason: "Synthetic switch back to submit billing" },
    owner,
  );
  assert.equal(mode.status, 200);
  await req(
    "POST",
    `/owner/tenants/${office.tenant.id}/adjust`,
    { delta: 5, reason: "Synthetic credit funding for submit billing" },
    owner,
  );
  const id = await submitted("bn");
  const before = await walletBalance();
  const r = await approve(id);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.certificate.languages, "bilingual");
  assert.equal(await walletBalance(), before, "no certificate fee on submit billing");
  const fees = (await admin.query("SELECT count(*)::int n FROM certificate_fees WHERE application_id=$1", [id])).rows[0].n;
  assert.equal(fees, 0);
});
