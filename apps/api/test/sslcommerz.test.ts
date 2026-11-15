import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { getDemoPayload } from "@astra/shared-schemas";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";
import { setSslcommerzTransportForTests } from "../src/sslcommerz.js";

process.env.NODE_ENV = "test";
process.env.DEMO_SETTLE_ENABLED = "true";
const admin = new pg.Pool({ connectionString: adminConnectionString });
// Test-only credentials are generated per run so no password-like literal sits in the repository.
const password = randomBytes(18).toString("base64url");
const storePassword = randomBytes(12).toString("hex");
const run = randomUUID().slice(0, 8);
let server: ReturnType<typeof app.listen>, base: string, officeId: string, slug: string, citizenId: string;
type Session = { cookie: string; csrf: string };
const s: Record<string, Session> = {};
async function req(method: string, path: string, data?: unknown, who?: string, headers: Record<string, string> = {}) {
  const session = who ? s[who] : undefined;
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    redirect: "manual",
    headers: {
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      ...(session ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf } : {}),
      ...headers,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const type = response.headers.get("content-type") ?? "";
  return { status: response.status, headers: response.headers, body: type.includes("json") ? await response.json() : null };
}
async function login(name: string, email: string, secret = password) {
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: secret }),
  });
  const json = await r.json();
  assert.equal(r.status, 200, JSON.stringify(json));
  s[name] = { cookie: r.headers.get("set-cookie")!.split(";")[0], csrf: json.csrfToken };
}

// --- A fake SSLCommerz following the v4 API documentation ---
type FakeSession = { tran_id: string; amount: string; status: string; val_id?: string; validatedAmount?: string; risk?: string };
const sessions = new Map<string, FakeSession>();
const calls: { url: URL; body?: URLSearchParams }[] = [];
let lastSuccessUrl = "";
setSslcommerzTransportForTests(async (url, init) => {
  const u = new URL(url);
  calls.push({ url: u, body: init.body });
  const creds = init.body ?? u.searchParams;
  assert.equal(creds.get("store_passwd"), storePassword, "the decrypted store password reaches the provider");
  if (u.pathname === "/gwprocess/v4/api.php") {
    const key = randomBytes(16).toString("hex").toUpperCase();
    sessions.set(key, { tran_id: init.body!.get("tran_id")!, amount: init.body!.get("total_amount")!, status: "PENDING" });
    lastSuccessUrl = init.body!.get("success_url")!;
    return { status: "SUCCESS", sessionkey: key, GatewayPageURL: `https://sandbox.sslcommerz.com/EasyCheckOut/test${key.toLowerCase()}` };
  }
  if (u.pathname === "/validator/api/merchantTransIDvalidationAPI.php") {
    const key = u.searchParams.get("sessionkey")!;
    const x = sessions.get(key)!;
    return { APIConnect: "DONE", status: x.status, sessionkey: key, tran_id: x.tran_id, val_id: x.val_id, amount: x.amount, currency: "BDT" };
  }
  if (u.pathname === "/validator/api/validationserverAPI.php") {
    const x = [...sessions.values()].find((v) => v.val_id === u.searchParams.get("val_id"));
    if (!x) return { status: "INVALID_TRANSACTION" };
    return { status: "VALID", val_id: x.val_id, tran_id: x.tran_id, amount: x.validatedAmount ?? x.amount, store_amount: "123.00", currency: "BDT", risk_level: x.risk ?? "0" };
  }
  throw new Error(`unexpected ${u.pathname}`);
});
const pay = (sessionKey: string, extra: Partial<FakeSession> = {}) => {
  const x = sessions.get(sessionKey)!;
  Object.assign(x, { status: "VALID", val_id: `VAL${randomBytes(6).toString("hex")}`, ...extra });
};
async function postBack(fields: Record<string, string>, origin = "https://sandbox.sslcommerz.com", url = lastSuccessUrl) {
  return fetch(url.replace(/^https?:\/\/[^/]+/, base), {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin },
    body: new URLSearchParams(fields),
  });
}
async function approvedApplication() {
  const created = await req(
    "POST",
    "/applications",
    {
      citizenId,
      serviceNo: 45,
      payload: { ...getDemoPayload(45), delivery_language: "bn" },
      order: {
        policyVersion: 1,
        preferences: { addressBasis: "registered_profile", certificateLanguage: "bn", deliveryMode: "office_collection", urgency: "normal" },
      },
    },
    "citizen",
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  for (const [action, who] of [
    ["submit", "citizen"],
    ["review", "reviewer"],
    ["approve", "approver"],
  ]) {
    const r = await req("POST", `/applications/${created.body.id}/transition`, { action }, who);
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  return created.body.id as string;
}
const checkout = (applicationId: string) =>
  req("POST", `/applications/${applicationId}/payments`, { provider: "SSLCOMMERZ", requestKey: randomUUID() }, "citizen");

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  await login("owner", "owner@astra.demo.test", "Demo-Phase1!");
  slug = `ssl-${run}`;
  const office = await req(
    "POST",
    "/owner/tenants",
    {
      slug,
      nameBn: "এসএসএল পরীক্ষা অফিস",
      nameEn: "Synthetic SSLCommerz office",
      division: "Test Division",
      district: "Test District",
      upazila: "Test Upazila",
      officeType: "UNION",
      adminEmail: `admin@${slug}.test`,
      adminName: "Synthetic SSLCommerz admin",
      adminPassword: password,
    },
    "owner",
  );
  assert.equal(office.status, 201, JSON.stringify(office.body));
  officeId = office.body.id;
  await login("admin", `admin@${slug}.test`);
  for (const role of ["finance", "reviewer", "approver"]) {
    const r = await req("POST", "/admin/users", { email: `${role}@${slug}.test`, displayName: `SSL QA ${role}`, password, role }, "admin");
    assert.equal(r.status, 201, JSON.stringify(r.body));
    await login(role, `${role}@${slug}.test`);
  }
  const approver = (await admin.query("SELECT id FROM platform_users WHERE email=$1", [`approver@${slug}.test`])).rows[0].id;
  assert.equal(
    (await req("PUT", `/admin/authorizations/${approver}/45`, { active: true, authorityNote: "Synthetic SSLCommerz approval authority" }, "admin")).status,
    200,
  );
  const email = `citizen-${run}@ssl.synthetic.test`;
  const signup = await req("POST", "/auth/signup", {
    email,
    password,
    displayName: "Synthetic SSLCommerz citizen",
    tenantId: officeId,
    nameBn: "পরীক্ষা নাগরিক",
    nameEn: "Synthetic SSLCommerz citizen",
    dateOfBirth: "1997-03-04",
    addressBn: "গোপন পরীক্ষার ঠিকানা",
    addressEn: "PRIVATE ADDRESS NOT FOR THE GATEWAY",
  });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  await login("citizen", email);
  citizenId = (await req("GET", "/citizens", undefined, "citizen")).body.items[0].id;
  const policy = await req(
    "POST",
    "/admin/services/45/order-policies",
    {
      expectedVersion: 0,
      reason: "Synthetic SSLCommerz tariff; not official fees",
      statutoryFeeMinor: 10001,
      processingFeeMinor: 2502,
      emergencySurchargeMinor: 0,
      deliveryFeesMinor: { office_collection: 204, digital_copy: 0 },
      deliveryModes: ["office_collection", "digital_copy"],
      urgencies: ["normal"],
    },
    "admin",
  );
  assert.equal(policy.status, 201, JSON.stringify(policy.body));
});
after(async () => {
  setSslcommerzTransportForTests(null);
  await closePdfBrowser();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await admin.end();
});

test("Phase 5c: without the office's merchant setup SSLCommerz checkout fails closed", async () => {
  const configuration = await req("GET", "/payments/configuration", undefined, "citizen");
  assert.equal(configuration.body.sslcommerz.available, false);
  assert.equal(configuration.body.sslcommerz.reason, "MERCHANT_SETUP_REQUIRED");
  const id = await approvedApplication();
  const r = await checkout(id);
  assert.equal(r.status, 503, JSON.stringify(r.body));
  assert.equal(r.body.error.code, "GATEWAY_NOT_CONFIGURED");
});

test("Phase 5c: the office admin stores its own store credentials; the password is encrypted and never returned", async () => {
  assert.equal(
    (await req("PUT", "/admin/payment-merchants/sslcommerz", { environment: "SANDBOX", storeId: "astra-test", enabled: true }, "admin")).status,
    422,
    "a password is required the first time",
  );
  assert.equal(
    (await req("PUT", "/admin/payment-merchants/sslcommerz", { environment: "SANDBOX", storeId: "astra-test", storePassword, enabled: true }, "finance"))
      .status,
    403,
  );
  const saved = await req(
    "PUT",
    "/admin/payment-merchants/sslcommerz",
    { environment: "SANDBOX", storeId: "astra-test", storePassword, enabled: true },
    "admin",
  );
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.available, true);
  assert.equal(JSON.stringify(saved.body).includes(storePassword), false);
  const read = await req("GET", "/admin/payment-merchants/sslcommerz", undefined, "finance");
  assert.equal(read.body.storeId, "astra-test");
  assert.equal(JSON.stringify(read.body).includes(storePassword), false);
  const row = (await admin.query("SELECT * FROM office_payment_merchants WHERE tenant_id=$1", [officeId])).rows[0];
  assert.match(row.secret_cipher, /^v1\./);
  assert.equal(JSON.stringify(row).includes(storePassword), false);
  // LIVE stays off until the deployment explicitly enables it.
  const live = await req(
    "PUT",
    "/admin/payment-merchants/sslcommerz",
    { environment: "LIVE", storeId: "astra-test", storePassword, enabled: true },
    "admin",
  );
  assert.equal(live.body.reason, "LIVE_ACTIVATION_REQUIRED");
  assert.equal(
    (await req("PUT", "/admin/payment-merchants/sslcommerz", { environment: "SANDBOX", storeId: "astra-test", storePassword, enabled: true }, "admin"))
      .body.available,
    true,
  );
});

test("Phase 5c: checkout sends only what the provider needs and pays only after session query and validation agree", async () => {
  const id = await approvedApplication();
  const started = await checkout(id);
  assert.equal(started.status, 201, JSON.stringify(started.body));
  const attempt = started.body.attempt;
  assert.match(attempt.checkoutUrl, /^https:\/\/sandbox\.sslcommerz\.com\//);
  const create = calls.find((c) => c.url.pathname === "/gwprocess/v4/api.php")!;
  assert.equal(create.body!.get("total_amount"), "127.07");
  assert.equal(create.body!.get("currency"), "BDT");
  assert.match(create.body!.get("success_url")!, /\/api\/v1\/payments\/sslcommerz\/callback\/[a-f0-9]{64}$/);
  assert.equal(create.body!.toString().includes("PRIVATE"), false, "no citizen address goes to the gateway");
  const sessionKey = [...sessions.keys()].at(-1)!;
  const tranId = sessions.get(sessionKey)!.tran_id;

  // Wrong origin, wrong invoice and an unpaid return are all refused or left unpaid.
  assert.equal((await postBack({ tran_id: tranId, status: "VALID" }, "https://evil.example")).status, 403);
  assert.equal((await postBack({ tran_id: "ASTRA-not-this-one", status: "VALID" })).status, 403);
  const unpaid = await postBack({ tran_id: tranId, status: "VALID" });
  assert.equal(unpaid.status, 303, "the browser always returns to Astra");
  assert.equal((await req("GET", `/applications/${id}/payment`, undefined, "citizen")).body.paymentStatus === "COLLECTED", false);

  pay(sessionKey);
  const paid = await postBack({ tran_id: tranId, status: "VALID", val_id: sessions.get(sessionKey)!.val_id! });
  assert.equal(paid.status, 303);
  assert.match(paid.headers.get("location")!, new RegExp(`/payments/return\\?applicationId=${id}`));
  const summary = await req("GET", `/applications/${id}/payment`, undefined, "citizen");
  assert.equal(summary.body.paymentStatus, "COLLECTED", JSON.stringify(summary.body));
  assert.equal(summary.body.receipt.provider ?? summary.body.attempt.provider, "SSLCOMMERZ");
  // The IPN arriving later (no Origin header) changes nothing.
  assert.equal((await postBack({ tran_id: tranId, status: "VALID" }, "")).status, 303);
  const receipts = await admin.query("SELECT count(*)::int n FROM gateway_payment_receipts r JOIN gateway_payment_intents i ON i.id=r.intent_id WHERE i.application_id=$1", [id]);
  assert.equal(receipts.rows[0].n, 1);
});

test("Phase 5c: a validation that disagrees on the amount, or a risky payment, is not accepted", async () => {
  for (const extra of [{ validatedAmount: "1.00" }, { risk: "1" }]) {
    const id = await approvedApplication();
    assert.equal((await checkout(id)).status, 201);
    const sessionKey = [...sessions.keys()].at(-1)!;
    pay(sessionKey, extra);
    await postBack({ tran_id: sessions.get(sessionKey)!.tran_id, status: "VALID" });
    const summary = await req("GET", `/applications/${id}/payment`, undefined, "citizen");
    assert.notEqual(summary.body.paymentStatus, "COLLECTED", JSON.stringify(extra));
  }
});
