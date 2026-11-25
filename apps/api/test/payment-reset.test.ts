import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { getDemoPayload } from "@astra/shared-schemas";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";
import {
  setGatewayForTests,
  type Gateway,
  type PaymentResult,
  type TransactionResult,
} from "../src/bkash.js";
// B2: these tests exercise the sandbox settlement route, which is off unless explicitly enabled.
process.env.DEMO_SETTLE_ENABLED = "true";

/**
 * W-007: safe payment retry/recovery. A stuck gateway attempt used to block
 * checkout forever (one attempt per application, no operator reset). The
 * operator reset supersedes the attempt after provider evidence says it
 * did not collect, and a fresh checkout with a fresh invoice can start.
 * Exactly-once settlement is preserved: only the live attempt can confirm
 * (finalize refuses SUPERSEDED), and the application keeps one receipt.
 *
 * Harness mirrors payments.test.ts (same FakeGateway + office setup) so
 * these tests exercise the real checkout/callback/reconcile paths.
 * PAY-09's pre-reset block is re-pinned here as the boundary: without a
 * reset, a CREATE_UNKNOWN attempt still returns the same attempt.
 */
type Session = { cookie: string; csrf: string; user: any };
const sessions: Record<string, Session> = {};
const run = randomUUID().slice(0, 8);
const password = "W007-Reset-123!";
const admin = new pg.Pool({ connectionString: adminConnectionString });
let server: ReturnType<typeof app.listen>,
  base: string,
  office: any,
  citizen: any;
const preferences = {
  addressBasis: "registered_profile",
  certificateLanguage: "bn",
  deliveryMode: "office_collection",
  urgency: "normal",
};
type MockEntry = {
  input: Parameters<Gateway["create"]>[0];
  signature: string;
  result: PaymentResult;
  search: TransactionResult;
  executeThrows?: boolean;
  completeOnExecute?: boolean;
  queryThrows?: boolean;
};
class FakeGateway implements Gateway {
  readonly provider = "BKASH" as const;
  readonly environment = "SANDBOX" as const;
  readonly merchantAccount = "01700000000";
  creates = 0;
  executes = 0;
  queries = 0;
  searches = 0;
  throwCreate = false;
  entries = new Map<string, MockEntry>();
  async create(input: Parameters<Gateway["create"]>[0]) {
    this.creates++;
    if (this.throwCreate)
      throw Object.assign(new Error("Synthetic unknown network result"), {
        code: "GATEWAY_UNAVAILABLE",
      });
    const paymentId = `fake-${randomUUID()}`,
      signature = randomUUID();
    const result: PaymentResult = {
      paymentId,
      status: "Initiated",
      transactionId: `T${randomUUID().replaceAll("-", "")}`,
      amountMinor: input.amountMinor,
      currency: "BDT",
      invoice: input.invoice,
      intent: "sale",
    };
    this.entries.set(paymentId, {
      input,
      signature,
      result,
      completeOnExecute: true,
      search: {
        transactionId: result.transactionId!,
        status: "Completed",
        amountMinor: input.amountMinor,
        currency: "BDT",
        merchantAccount: this.merchantAccount,
        serviceFeeMinor: 10,
        creditedAmountMinor: input.amountMinor - 10,
      },
    });
    return {
      paymentId,
      checkoutUrl: `https://sandbox.payment.bkash.com/?paymentId=${paymentId}`,
      signature,
      amountMinor: input.amountMinor,
      currency: "BDT" as const,
      invoice: input.invoice,
    };
  }
  async execute(paymentId: string) {
    this.executes++;
    const entry = this.entries.get(paymentId)!;
    if (entry.completeOnExecute) entry.result.status = "Completed";
    if (entry.executeThrows)
      throw Object.assign(new Error("Synthetic ambiguous execution timeout"), {
        code: "GATEWAY_UNAVAILABLE",
      });
    return { ...entry.result };
  }
  async query(paymentId: string) {
    this.queries++;
    if (this.entries.get(paymentId)!.queryThrows)
      throw Object.assign(new Error("Synthetic provider query outage"), {
        code: "GATEWAY_UNAVAILABLE",
      });
    return { ...this.entries.get(paymentId)!.result };
  }
  async search(transactionId: string) {
    this.searches++;
    return {
      ...[...this.entries.values()].find(
        (e) =>
          e.search.transactionId === transactionId ||
          e.result.transactionId === transactionId,
      )!.search,
    };
  }
  refunds = new Map<string, { refundTrxId: string; status: string }>();
  async refundPayment(input: { paymentId: string; trxId: string; amountMinor: number; reason: string; sku: string }) {
    const existing = this.refunds.get(input.paymentId);
    if (existing) return { accepted: true, settled: existing.status === "Completed", reference: existing.refundTrxId };
    const refund = { refundTrxId: `R${randomUUID().slice(0, 8)}`, status: "Completed" };
    this.refunds.set(input.paymentId, refund);
    return { accepted: true, settled: true, reference: refund.refundTrxId };
  }
  async refundStatusOf(paymentId: string, _trxId: string) {
    return this.refunds.get(paymentId) ?? null;
  }
  async entryFor(intentId: string) {
    const row = (
      await admin.query(
        "SELECT payment_id FROM gateway_payment_intents WHERE id=$1",
        [intentId],
      )
    ).rows[0];
    return this.entries.get(row.payment_id)!;
  }
}
const gateway = new FakeGateway();
async function request(
  method: string,
  path: string,
  data?: unknown,
  role = "citizen",
  extraHeaders: Record<string, string> = {},
) {
  const session = sessions[role];
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    redirect: "manual",
    headers: {
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      ...(session
        ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf }
        : {}),
      ...extraHeaders,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const type = response.headers.get("content-type") ?? "";
  const body = type.includes("application/json")
    ? await response.json()
    : await response.text();
  return { status: response.status, body, headers: response.headers };
}
async function login(role: string, email: string, secret = password) {
  const result = await request(
    "POST",
    "/auth/login",
    { email, password: secret },
    "anonymous",
  );
  assert.equal(result.status, 200, JSON.stringify(result.body));
  sessions[role] = {
    cookie: result.headers.get([ "set", "cookie" ].join("-"))!.split(";")[0],
    csrf: result.body.csrfToken,
    user: result.body.user,
  };
}
async function createOffice(suffix: string, role: string) {
  const slug = `reset-${run}-${suffix}`;
  const result = await request(
    "POST",
    "/owner/tenants",
    {
      slug,
      nameBn: "রিসেট পরীক্ষা অফিস",
      nameEn: "Synthetic reset office",
      division: "Test Division",
      district: "Test District",
      upazila: "Test Upazila",
      officeType: "UNION",
      adminEmail: `admin@${slug}.test`,
      adminName: "Reset QA administrator",
      adminPassword: password,
    },
    "owner",
  );
  assert.equal(result.status, 201, JSON.stringify(result.body));
  await login(role, `admin@${slug}.test`);
  return result.body;
}
async function signup(role: string) {
  const email = `${role}-${run}@reset.synthetic.test`;
  const result = await request(
    "POST",
    "/auth/signup",
    {
      email,
      password,
      displayName: "Synthetic reset citizen",
      tenantId: office.id,
      nameBn: "পরীক্ষা নাগরিক",
      nameEn: "Synthetic reset citizen",
      dateOfBirth: "1998-02-03",
      addressBn: "গোপন পরীক্ষার ঠিকানা",
      addressEn: "PRIVATE ADDRESS NOT FOR FINANCE",
      syntheticReference: `REF-RESET-${role}-${run}`,
    },
    "anonymous",
  );
  assert.equal(result.status, 201, JSON.stringify(result.body));
  await login(role, email);
}
async function createApplication() {
  const result = await request("POST", "/applications", {
    citizenId: citizen.id,
    serviceNo: 45,
    payload: { ...getDemoPayload(45), delivery_language: "bn" },
    order: { policyVersion: 1, preferences },
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  const submitted = await request(
    "POST",
    `/applications/${result.body.id}/transition`,
    { action: "submit" },
    "citizen",
  );
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  const approval = await request(
    "POST",
    `/applications/${result.body.id}/transition`,
    { action: "approve" },
    "approver",
  );
  assert.ok(
    approval.status === 200 || approval.status === 402,
    JSON.stringify(approval.body),
  );
  return result.body;
}
async function checkout(applicationId: string, key = randomUUID(), role = "citizen") {
  return request(
    "POST",
    `/applications/${applicationId}/payments`,
    { provider: "BKASH", requestKey: key },
    role,
  );
}
async function reconcile(id: string, key = randomUUID(), role = "finance") {
  return request("POST", `/payments/${id}/reconcile`, { requestKey: key }, role);
}
async function reset(id: string, reason: string, role = "finance") {
  return request("POST", `/payments/${id}/reset`, { reason }, role);
}
async function attempt(id: string, role = "finance") {
  const r = await request("GET", `/payments/${id}`, undefined, role);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}
async function paymentDetail(applicationId: string, role = "finance") {
  const r = await request(
    "GET",
    `/applications/${applicationId}/payment`,
    undefined,
    role,
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}
async function callback(intentId: string, status = "success") {
  const entry = await gateway.entryFor(intentId),
    target = new URL(entry.input.callbackURL);
  const query = new URLSearchParams({
    paymentID: entry.result.paymentId,
    status,
    signature: entry.signature,
  });
  return request(
    "GET",
    `${target.pathname.replace("/api/v1", "")}?${query}`,
    undefined,
    "anonymous",
  );
}
async function financialCounts(applicationId: string) {
  return (
    await admin.query(
      `SELECT
    (SELECT count(*)::int FROM gateway_payment_confirmations WHERE application_id=$1) confirmations,
    (SELECT count(*)::int FROM gateway_payment_receipts WHERE application_id=$1) receipts,
    (SELECT count(*)::int FROM gateway_payment_intents WHERE application_id=$1 AND status='SUPERSEDED') superseded`,
      [applicationId],
    )
  ).rows[0];
}

before(async () => {
  process.env.NODE_ENV = "test";
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  await login("owner", "owner@astra.demo.test", "Demo-Phase1!");
  office = await createOffice("a", "admin");
  for (const role of ["staff", "finance", "approver"]) {
    const result = await request(
      "POST",
      "/admin/users",
      {
        email: `${role}@${office.slug}.test`,
        displayName: `Reset QA ${role}`,
        password,
        role,
      },
      "admin",
    );
    assert.equal(result.status, 201, JSON.stringify(result.body));
    await login(role, result.body.email);
  }
  assert.equal(
    (
      await request(
        "PUT",
        `/admin/authorizations/${sessions.approver!.user.id}/45`,
        { active: true, authorityNote: "Synthetic reset QA approval authority" },
        "admin",
      )
    ).status,
    200,
  );
  const signature = await request(
    "PUT",
    "/office/certificate-assets/signature",
    {
      mimeType: "image/png",
      base64:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      reason:
        "Synthetic signature fixture for demo-mode issuance regression (W-002); not a real chairman signature",
    },
    "approver",
  );
  assert.ok([200, 201].includes(signature.status), JSON.stringify(signature.body));
  await signup("citizen");
  citizen = (await request("GET", "/citizens")).body.items[0];
  const policy = await request(
    "POST",
    "/admin/services/45/order-policies",
    {
      expectedVersion: 0,
      reason: "Synthetic reset tariff; not official fees",
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
  const billing = await request(
    "POST",
    "/billing/orders",
    { kind: "subscription", planId: "standard-monthly" },
    "finance",
  );
  assert.equal(
    (
      await request(
        "POST",
        `/billing/orders/${billing.body.id}/demo-settle`,
        {},
        "finance",
      )
    ).status,
    200,
  );
  setGatewayForTests(office.id, gateway);
});
after(async () => {
  setGatewayForTests(office.id, null);
  await closePdfBrowser();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await admin.end();
});

test("W-007: without a reset, an unknown attempt still blocks a new checkout (PAY-09 boundary)", async () => {
  const app = await createApplication();
  gateway.throwCreate = true;
  const count = gateway.creates;
  const created = await checkout(app.id);
  gateway.throwCreate = false;
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.attempt.status, "CREATE_UNKNOWN");
  assert.equal(created.body.attempt.checkoutUrl, null);
  assert.equal((await checkout(app.id)).body.attempt.id, created.body.attempt.id);
  assert.equal(gateway.creates, count + 1, "no remote checkout was created again");
});

test("W-007: a reset needs provider evidence first when a payment ID exists", async () => {
  const app = await createApplication();
  const created = await checkout(app.id);
  assert.equal(created.body.attempt.status, "READY");
  const refused = await reset(
    created.body.attempt.id,
    "Synthetic reset without reconcile",
  );
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  assert.equal(refused.body.error.code, "PAYMENT_RECONCILE_REQUIRED");
});

test("W-007: reconcile-not-completed, reset, then a replacement checkout with a fresh invoice", async () => {
  const app = await createApplication();
  const created = await checkout(app.id);
  assert.equal(created.body.attempt.status, "READY");
  // The provider says the payment was never completed.
  const checked = await reconcile(created.body.attempt.id);
  assert.equal(checked.body.reconciliation.result, "PENDING");
  assert.equal(checked.body.reconciliation.reason, "PROVIDER_PAYMENT_NOT_COMPLETED");
  const creates = gateway.creates;
  const resetResult = await reset(
    created.body.attempt.id,
    "Synthetic reset after provider said not completed",
  );
  assert.equal(resetResult.status, 200, JSON.stringify(resetResult.body));
  assert.equal(resetResult.body.status, "SUPERSEDED");
  assert.equal(resetResult.body.checkoutUrl, null);
  const detail = await paymentDetail(app.id);
  assert.equal(detail.paymentStatus, "NOT_COLLECTED", "no live attempt, nothing paid");
  assert.equal(detail.attempt.status, "SUPERSEDED");
  const replacement = await checkout(app.id);
  assert.equal(replacement.status, 201, JSON.stringify(replacement.body));
  assert.equal(replacement.body.attempt.status, "READY");
  assert.notEqual(replacement.body.attempt.id, created.body.attempt.id);
  assert.notEqual(replacement.body.attempt.invoice, created.body.attempt.invoice);
  assert.equal(gateway.creates, creates + 1, "exactly one new remote checkout");
  assert.equal((await attempt(created.body.attempt.id)).status, "SUPERSEDED");
});

test("W-007: an unknown attempt with no payment ID resets on the reason alone", async () => {
  const app = await createApplication();
  gateway.throwCreate = true;
  const created = await checkout(app.id);
  gateway.throwCreate = false;
  assert.equal(created.body.attempt.status, "CREATE_UNKNOWN");
  assert.equal(created.body.attempt.paymentStatus, "PENDING");
  const resetResult = await reset(
    created.body.attempt.id,
    "Synthetic reset of an unknown creation with no payment ID",
  );
  assert.equal(resetResult.status, 200, JSON.stringify(resetResult.body));
  assert.equal(resetResult.body.status, "SUPERSEDED");
  const replacement = await checkout(app.id);
  assert.equal(replacement.body.attempt.status, "READY");
  assert.notEqual(replacement.body.attempt.id, created.body.attempt.id);
});

test("W-007: a paid attempt and an already-superseded attempt cannot be reset", async () => {
  const app = await createApplication();
  const created = await checkout(app.id);
  await callback(created.body.attempt.id);
  const paid = await attempt(created.body.attempt.id);
  assert.equal(paid.status, "PAID");
  const refusedPaid = await reset(
    created.body.attempt.id,
    "Synthetic reset of a paid attempt",
  );
  assert.equal(refusedPaid.status, 409, JSON.stringify(refusedPaid.body));
  assert.equal(refusedPaid.body.error.code, "PAYMENT_ALREADY_COLLECTED");

  const app2 = await createApplication();
  const stuck = await checkout(app2.id);
  await reconcile(stuck.body.attempt.id);
  const first = await reset(stuck.body.attempt.id, "Synthetic first reset");
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const second = await reset(stuck.body.attempt.id, "Synthetic second reset");
  assert.equal(second.status, 409, JSON.stringify(second.body));
  assert.equal(second.body.error.code, "PAYMENT_ALREADY_SUPERSEDED");
});

test("W-007: an inconclusive reconcile refuses the reset; a mismatch allows it", async () => {
  const app = await createApplication();
  const created = await checkout(app.id);
  const entry = await gateway.entryFor(created.body.attempt.id);
  entry.queryThrows = true;
  const checked = await reconcile(created.body.attempt.id);
  assert.equal(checked.body.reconciliation.result, "ERROR");
  entry.queryThrows = false;
  const refused = await reset(
    created.body.attempt.id,
    "Synthetic reset after an inconclusive check",
  );
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  assert.equal(refused.body.error.code, "PAYMENT_RECONCILE_INCONCLUSIVE");

  // Tamper the provider search evidence: the query must report Completed
  // (so the check reaches the search) while the transaction no longer
  // matches the attempt, so the check is a decisive MISMATCH.
  entry.result.status = "Completed";
  entry.search.amountMinor = entry.search.amountMinor + 1;
  const mismatched = await reconcile(created.body.attempt.id);
  assert.equal(mismatched.body.reconciliation.result, "MISMATCH");
  const resetResult = await reset(
    created.body.attempt.id,
    "Synthetic reset after a decisive mismatch",
  );
  assert.equal(resetResult.status, 200, JSON.stringify(resetResult.body));
  assert.equal(resetResult.body.status, "SUPERSEDED");
});

test("W-007: a late payment on the abandoned checkout cannot confirm — exactly once", async () => {
  const app = await createApplication();
  const old = await checkout(app.id);
  await reconcile(old.body.attempt.id);
  const resetResult = await reset(
    old.body.attempt.id,
    "Synthetic reset before the replacement is paid",
  );
  assert.equal(resetResult.status, 200, JSON.stringify(resetResult.body));
  const replacement = await checkout(app.id);
  await callback(replacement.body.attempt.id);
  assert.equal((await attempt(replacement.body.attempt.id)).status, "PAID");
  const counts = await financialCounts(app.id);
  assert.equal(counts.confirmations, 1);
  assert.equal(counts.receipts, 1);
  assert.equal(counts.superseded, 1);

  // The citizen pays the OLD checkout late: the provider now reports it
  // completed, but the superseded attempt must never confirm.
  const oldEntry = await gateway.entryFor(old.body.attempt.id);
  oldEntry.result.status = "Completed";
  const late = await callback(old.body.attempt.id);
  assert.ok([302, 303, 200].includes(late.status), JSON.stringify(late.body));
  assert.equal((await attempt(old.body.attempt.id)).status, "SUPERSEDED");
  const after = await financialCounts(app.id);
  assert.equal(after.confirmations, 1, "no second confirmation");
  assert.equal(after.receipts, 1, "no second receipt");
  const rechecked = await reconcile(old.body.attempt.id);
  assert.equal(rechecked.body.reconciliation.result, "ERROR");
  assert.equal(rechecked.body.reconciliation.reason, "PAYMENT_SUPERSEDED");
});

test("W-007: only admin/finance may reset, and the reason is mandatory", async () => {
  const app = await createApplication();
  const created = await checkout(app.id);
  assert.equal(
    (await reset(created.body.attempt.id, "Synthetic citizen reset", "citizen"))
      .status,
    403,
  );
  assert.equal(
    (await reset(created.body.attempt.id, "Synthetic staff reset", "staff"))
      .status,
    403,
  );
  assert.equal(
    (await reset(created.body.attempt.id, "short", "finance")).status,
    422,
  );
  assert.equal((await attempt(created.body.attempt.id)).status, "READY");
});
