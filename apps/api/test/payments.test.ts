import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import pg from "pg";
import { getDemoPayload } from "@astra/shared-schemas";
import { app } from "../src/app.js";
import { pool, adminConnectionString, transaction } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";
import {
  PostgresTokenStore,
  setGatewayForTests,
  type Gateway,
  type PaymentResult,
  type TransactionResult,
} from "../src/bkash.js";
// B2: these tests exercise the sandbox settlement route, which is off unless explicitly enabled.
process.env.DEMO_SETTLE_ENABLED = "true";

type Session = { cookie: string; csrf: string; user: any };
const sessions: Record<string, Session> = {};
const run = randomUUID().slice(0, 8),
  password = "Synthetic-Gateway-Pass!";
const admin = new pg.Pool({ connectionString: adminConnectionString });
let server: ReturnType<typeof app.listen>,
  base: string,
  office: any,
  foreignOffice: any,
  citizen: any;
let approved: any, paidAttempt: any, paidReceipt: any;
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
    await new Promise((resolve) => setTimeout(resolve, 10));
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
  // Phase 5d: the bKash Refund and Refund Status APIs.
  refunds = new Map<string, { refundTrxId: string; status: string }>();
  refundCalls = 0;
  async refundPayment(input: { paymentId: string; trxId: string; amountMinor: number; reason: string; sku: string }) {
    const existing = await this.refundStatusOf(input.paymentId, input.trxId);
    if (existing) return { accepted: true, settled: existing.status === "Completed", reference: existing.refundTrxId };
    this.refundCalls++;
    const entry = this.entries.get(input.paymentId)!;
    assert.equal(input.trxId, entry.result.transactionId);
    assert.equal(input.amountMinor, entry.result.amountMinor);
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
    : type.includes("application/pdf")
      ? Buffer.from(await response.arrayBuffer())
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
    cookie: result.headers.get("set-cookie")!.split(";")[0]!,
    csrf: result.body.csrfToken,
    user: result.body.user,
  };
}
async function createOffice(suffix: string, role: string) {
  const slug = `gateway-${run}-${suffix}`;
  const result = await request(
    "POST",
    "/owner/tenants",
    {
      slug,
      nameBn: "গেটওয়ে পরীক্ষা অফিস",
      nameEn: "Synthetic gateway office",
      division: "Test Division",
      district: "Test District",
      upazila: "Test Upazila",
      officeType: "UNION",
      adminEmail: `admin@${slug}.test`,
      adminName: "Gateway QA administrator",
      adminPassword: password,
    },
    "owner",
  );
  assert.equal(result.status, 201, JSON.stringify(result.body));
  await login(role, `admin@${slug}.test`);
  return result.body;
}
async function signup(role: string) {
  const email = `${role}-${run}@gateway.synthetic.test`;
  const result = await request(
    "POST",
    "/auth/signup",
    {
      email,
      password,
      displayName: "Synthetic gateway citizen",
      tenantId: office.id,
      nameBn: "পরীক্ষা নাগরিক",
      nameEn: "Synthetic gateway citizen",
      dateOfBirth: "1998-02-03",
      addressBn: "গোপন পরীক্ষার ঠিকানা",
      addressEn: "PRIVATE ADDRESS NOT FOR FINANCE",
      syntheticReference: `DEMO-GATEWAY-${role}-${run}`,
    },
    "anonymous",
  );
  assert.equal(result.status, 201, JSON.stringify(result.body));
  await login(role, email);
}
async function createApplication(approve = true) {
  const result = await request("POST", "/applications", {
    citizenId: citizen.id,
    serviceNo: 45,
    payload: { ...getDemoPayload(45), delivery_language: "bn" },
    order: { policyVersion: 1, preferences },
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  if (approve) {
    const submitted = await request(
      "POST",
      `/applications/${result.body.id}/transition`,
      { action: "submit" },
      "citizen",
    );
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
    // Phase W: the Chairman's approve attempts issuance in the same action;
    // this application's unpaid order blocks it (402) while the approval
    // itself is recorded, leaving the application APPROVED for checkout.
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
    if (approval.status === 402)
      assert.equal(approval.body.error.code, "ORDER_PAYMENT_REQUIRED");
  }
  return result.body;
}
async function checkout(
  applicationId: string,
  key = randomUUID(),
  role = "citizen",
) {
  return request(
    "POST",
    `/applications/${applicationId}/payments`,
    { provider: "BKASH", requestKey: key },
    role,
  );
}
async function reconcile(
  id: string,
  key = randomUUID(),
  role = "finance",
  headers: Record<string, string> = {},
) {
  return request(
    "POST",
    `/payments/${id}/reconcile`,
    { requestKey: key },
    role,
    headers,
  );
}
async function callback(
  intentId: string,
  status = "success",
  overrides: Record<string, string> = {},
) {
  const entry = await gateway.entryFor(intentId),
    target = new URL(entry.input.callbackURL);
  const query = new URLSearchParams({
    paymentID: entry.result.paymentId,
    status,
    signature: entry.signature,
    ...overrides,
  });
  return request(
    "GET",
    `${target.pathname.replace("/api/v1", "")}?${query}`,
    undefined,
    "anonymous",
  );
}
async function financialCounts() {
  return (
    await admin.query(
      `SELECT
    (SELECT count(*)::int FROM gateway_payment_intents WHERE tenant_id=$1) intents,
    (SELECT count(*)::int FROM gateway_payment_events WHERE tenant_id=$1) events,
    (SELECT count(*)::int FROM gateway_payment_confirmations WHERE tenant_id=$1) confirmations,
    (SELECT count(*)::int FROM gateway_payment_receipts WHERE tenant_id=$1) receipts,
    (SELECT count(*)::int FROM credit_ledger WHERE tenant_id=$1) credits,
    (SELECT count(*)::int FROM invoices WHERE tenant_id=$1) invoices`,
      [office.id],
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
  foreignOffice = await createOffice("b", "foreign");
  for (const role of ["staff", "finance", "reviewer", "approver"]) {
    const result = await request(
      "POST",
      "/admin/users",
      {
        email: `${role}@${office.slug}.test`,
        displayName: `Gateway QA ${role}`,
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
        {
          active: true,
          authorityNote: "Synthetic gateway QA approval authority",
        },
        "admin",
      )
    ).status,
    200,
  );
  await signup("citizen");
  await signup("neighbor");
  citizen = (await request("GET", "/citizens")).body.items[0];
  const policy = await request(
    "POST",
    "/admin/services/45/order-policies",
    {
      expectedVersion: 0,
      reason: "Synthetic gateway tariff; not official fees",
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
    { kind: "subscription", planId: "demo-monthly" },
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
  approved = await createApplication();
});
after(async () => {
  setGatewayForTests(office.id, null);
  await closePdfBrowser();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await admin.end();
});

test("PAY-01: missing merchant configuration fails closed without a checkout, receipt, invoice or credit mutation", async () => {
  const before = await financialCounts();
  const configuration = await request("GET", "/payments/configuration");
  assert.equal(configuration.body.available, false);
  assert.equal(configuration.body.nagad.reason, "NOT_INTEGRATED");
  const result = await checkout(approved.id);
  assert.equal(result.status, 503, JSON.stringify(result.body));
  assert.equal(result.body.error.code, "GATEWAY_NOT_CONFIGURED");
  assert.deepEqual(await financialCounts(), before);
  const summary = await request("GET", `/applications/${approved.id}/payment`);
  assert.equal(summary.body.paymentStatus, "NOT_COLLECTED");
  assert.equal(summary.body.eligible, false);
  assert.equal(summary.body.attempt, null);
  setGatewayForTests(office.id, gateway);
});
test("PAY-02: approval, actor ownership, CSRF and immutable server price are required before checkout", async () => {
  const draft = await createApplication(false),
    before = await financialCounts();
  assert.equal((await checkout(draft.id)).status, 409);
  for (const role of ["finance", "reviewer", "approver", "owner"])
    assert.equal((await checkout(approved.id, randomUUID(), role)).status, 403);
  for (const role of ["neighbor", "foreign"])
    assert.equal((await checkout(approved.id, randomUUID(), role)).status, 404);
  assert.equal(
    (
      await request("POST", `/applications/${approved.id}/payments`, {
        provider: "BKASH",
        requestKey: randomUUID(),
        amountMinor: 1,
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await request(
        "POST",
        `/applications/${approved.id}/payments`,
        { provider: "BKASH", requestKey: randomUUID() },
        "citizen",
        { "X-CSRF-Token": "invalid" },
      )
    ).status,
    403,
  );
  assert.deepEqual(await financialCounts(), before);
  assert.equal(gateway.creates, 0);
});
test("PAY-03: concurrent retries create one gateway checkout and bind the request key to its original application", async () => {
  const key = randomUUID(),
    responses = await Promise.all([
      checkout(approved.id, key),
      checkout(approved.id, key),
      checkout(approved.id, key),
    ]);
  assert.ok(
    responses.every((r) => r.status === 200 || r.status === 201),
    JSON.stringify(responses),
  );
  assert.equal(new Set(responses.map((r) => r.body.attempt.id)).size, 1);
  assert.equal(gateway.creates, 1);
  paidAttempt = (await request("GET", `/applications/${approved.id}/payment`))
    .body.attempt;
  assert.equal(paidAttempt.status, "READY");
  assert.equal(paidAttempt.amountMinor, 12707);
  const other = await createApplication();
  assert.equal((await checkout(other.id, key)).status, 409);
  assert.equal((await checkout(approved.id)).body.attempt.id, paidAttempt.id);
  assert.equal(gateway.creates, 1);
  const raw = JSON.stringify(paidAttempt);
  assert.ok(!raw.includes("signature") && !raw.includes("callback"));
});
test("PAY-04: callback status and forged signatures cannot fabricate payment or execute a checkout", async () => {
  const before = await financialCounts();
  assert.equal(
    (await callback(paidAttempt.id, "success", { signature: "forged" })).status,
    403,
  );
  assert.equal(
    (
      await callback(paidAttempt.id, "success", {
        paymentID: "foreign-payment",
      })
    ).status,
    403,
  );
  assert.equal(gateway.executes, 0);
  assert.deepEqual(await financialCounts(), before);
  const cancelled = await callback(paidAttempt.id, "cancel");
  assert.equal(cancelled.status, 303);
  assert.equal(gateway.executes, 0);
  assert.equal(
    (await request("GET", `/applications/${approved.id}/payment`)).body
      .paymentStatus,
    "PENDING",
  );
  assert.equal(
    (
      await request(
        "POST",
        `/applications/${approved.id}/issue`,
        {},
        "approver",
      )
    ).body.error.code,
    "ORDER_PAYMENT_REQUIRED",
  );
});
test("PAY-05: one execution survives timeout and duplicate callbacks; query plus merchant transaction evidence commits one immutable PDF receipt", async () => {
  const entry = await gateway.entryFor(paidAttempt.id);
  entry.executeThrows = true;
  const before = await financialCounts();
  const callbacks = await Promise.all([
    callback(paidAttempt.id),
    callback(paidAttempt.id),
    callback(paidAttempt.id),
  ]);
  assert.ok(
    callbacks.every((r) => r.status === 303),
    JSON.stringify(callbacks),
  );
  assert.equal(gateway.executes, 1);
  const summary = await request("GET", `/applications/${approved.id}/payment`);
  assert.equal(summary.body.paymentStatus, "COLLECTED");
  assert.equal(summary.body.attempt.status, "PAID");
  paidReceipt = summary.body.receipt;
  assert.equal(paidReceipt.amountMinor, 12707);
  assert.equal(paidReceipt.environment, "SANDBOX");
  assert.equal(paidReceipt.snapshot.verification, "BKASH_QUERY_AND_SEARCH");
  assert.equal(
    paidReceipt.snapshot.components.reduce(
      (n: number, c: any) => n + c.amountMinor,
      0,
    ),
    12707,
  );
  const after = await financialCounts();
  assert.equal(after.receipts, before.receipts + 1);
  assert.equal(after.confirmations, before.confirmations + 1);
  assert.equal(after.credits, before.credits);
  assert.equal(after.invoices, before.invoices);
  const pdf = await request("GET", paidReceipt.pdfUrl.replace("/api/v1", ""));
  assert.equal(pdf.status, 200);
  assert.ok(pdf.body.subarray(0, 5).equals(Buffer.from("%PDF-")));
  assert.equal(
    createHash("sha256").update(pdf.body).digest("hex"),
    paidReceipt.pdfSha256,
  );
  const repeated = await reconcile(paidAttempt.id);
  assert.equal(repeated.body.receipt.id, paidReceipt.id);
  const queryCount = gateway.queries,
    executeCount = gateway.executes;
  const paidReplays = await Promise.all(
    Array.from({ length: 12 }, () => callback(paidAttempt.id)),
  );
  assert.ok(paidReplays.every((r) => r.status === 303));
  assert.equal(gateway.queries, queryCount);
  assert.equal(gateway.executes, executeCount);
  assert.equal(
    (
      await request("GET", paidReceipt.pdfUrl.replace("/api/v1", ""))
    ).body.equals(pdf.body),
    true,
  );
  const storedOrder = (
    await admin.query(
      "SELECT payment_status,total_minor FROM application_order_snapshots WHERE application_id=$1",
      [approved.id],
    )
  ).rows[0];
  assert.deepEqual(storedOrder, {
    payment_status: "NOT_COLLECTED",
    total_minor: 12707,
  });
});
test("PAY-06: verified citizen payment preserves independent approver authorization and exactly-once SaaS credit deduction", async () => {
  assert.equal(
    (await request("POST", `/applications/${approved.id}/issue`, {}, "staff"))
      .status,
    403,
  );
  const balance = (await request("GET", "/wallet", undefined, "finance")).body
    .balance;
  const result = await Promise.all([
    request("POST", `/applications/${approved.id}/issue`, {}, "approver"),
    request("POST", `/applications/${approved.id}/issue`, {}, "approver"),
  ]);
  assert.ok(
    result.every((r) => r.status === 200 || r.status === 201),
    JSON.stringify(result),
  );
  assert.equal(result[0].body.id, result[1].body.id);
  assert.equal(
    (await request("GET", "/wallet", undefined, "finance")).body.balance,
    balance - 1,
  );
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM credit_ledger WHERE certificate_id=$1",
        [result[0].body.id],
      )
    ).rows[0].n,
    1,
  );
});
test("PAY-07: wrong amount, currency, invoice, payment identity, merchant or transaction evidence never creates a receipt", async () => {
  const mutations: ((e: MockEntry) => void)[] = [
    (e) => {
      e.result.amountMinor++;
    },
    (e) => {
      e.result.currency = "USD";
    },
    (e) => {
      e.result.invoice = "foreign-invoice";
    },
    (e) => {
      e.result.paymentId = "another-payment";
    },
    (e) => {
      e.search.merchantAccount = "01800000000";
    },
    (e) => {
      e.search.amountMinor++;
    },
    (e) => {
      e.search.transactionId = "wrong-transaction";
    },
  ];
  for (const mutate of mutations) {
    const app = await createApplication(),
      created = await checkout(app.id),
      entry = await gateway.entryFor(created.body.attempt.id);
    entry.result.status = "Completed";
    mutate(entry);
    const before = await financialCounts(),
      checked = await reconcile(created.body.attempt.id);
    assert.equal(checked.status, 200, JSON.stringify(checked.body));
    assert.equal(checked.body.reconciliation.result, "MISMATCH");
    assert.equal(checked.body.receipt, null);
    assert.equal(checked.body.attempt.status, "REVIEW_REQUIRED");
    const after = await financialCounts();
    assert.equal(after.receipts, before.receipts);
    assert.equal(after.confirmations, before.confirmations);
    assert.equal(after.credits, before.credits);
  }
});
test("PAY-08: confirmation plus PDF is atomic on injected failure; authoritative reconciliation recovers without re-executing", async () => {
  const app = await createApplication(),
    created = await checkout(app.id),
    id = created.body.attempt.id;
  const entry = await gateway.entryFor(id);
  entry.result.status = "Completed";
  const before = await financialCounts(),
    executes = gateway.executes;
  const failed = await reconcile(id, randomUUID(), "finance", {
    "X-Test-Failure": "after-payment-confirmation",
  });
  assert.equal(failed.status, 500, JSON.stringify(failed.body));
  const after = await financialCounts();
  assert.equal(after.receipts, before.receipts);
  assert.equal(after.confirmations, before.confirmations);
  const key = randomUUID(),
    checks = await Promise.all([reconcile(id, key), reconcile(id, key)]);
  assert.ok(
    checks.every((r) => r.status === 200 || r.status === 202),
    JSON.stringify(checks),
  );
  const completed = checks.find((r) => r.status === 200)!;
  assert.ok(completed.body.receipt.id);
  assert.equal(gateway.executes, executes);
  const queries = gateway.queries,
    replay = await reconcile(id, key);
  assert.equal(gateway.queries, queries);
  assert.equal(replay.body.receipt.id, completed.body.receipt.id);
  assert.equal(replay.body.reconciliation.id, completed.body.reconciliation.id);
  assert.equal((await reconcile(paidAttempt.id, key)).status, 409);
});
test("PAY-09: ambiguous checkout creation remains recoverable without creating another remote checkout", async () => {
  const app = await createApplication();
  gateway.throwCreate = true;
  const count = gateway.creates,
    key = randomUUID(),
    created = await checkout(app.id, key);
  gateway.throwCreate = false;
  assert.equal(created.body.attempt.status, "CREATE_UNKNOWN");
  assert.equal(created.body.attempt.checkoutUrl, null);
  assert.equal(
    (await checkout(app.id, key)).body.attempt.id,
    created.body.attempt.id,
  );
  assert.equal(
    (await checkout(app.id)).body.attempt.id,
    created.body.attempt.id,
  );
  assert.equal(gateway.creates, count + 1);
  const checked = await reconcile(created.body.attempt.id);
  assert.equal(checked.body.reconciliation.result, "PENDING");
  assert.equal(checked.body.receipt, null);
});
test("PAY-10: an unknown execution is never repeated; later query recovery requires unchanged gateway binding", async () => {
  const app = await createApplication(),
    created = await checkout(app.id),
    id = created.body.attempt.id,
    entry = await gateway.entryFor(id);
  entry.executeThrows = true;
  entry.completeOnExecute = false;
  const count = gateway.executes;
  assert.equal((await callback(id)).status, 303);
  assert.equal((await callback(id)).status, 303);
  assert.equal(gateway.executes, count + 1);
  assert.equal(
    (await request("GET", `/applications/${app.id}/payment`)).body
      .paymentStatus,
    "PENDING",
  );
  const otherGateway = Object.create(gateway) as Gateway;
  Object.defineProperty(otherGateway, "merchantAccount", {
    value: "01800000000",
  });
  setGatewayForTests(office.id, otherGateway);
  const mismatch = await reconcile(id);
  assert.equal(mismatch.body.reconciliation.reason, "GATEWAY_BINDING_CHANGED");
  assert.equal(mismatch.body.receipt, null);
  setGatewayForTests(office.id, gateway);
  entry.result.status = "Completed";
  assert.equal((await reconcile(id)).body.reconciliation.result, "MATCHED");
  assert.equal(gateway.executes, count + 1);
});
test("PAY-11: payment and receipt access stay tenant- and citizen-scoped; finance responses exclude sensitive application payload", async () => {
  for (const role of ["neighbor", "foreign"]) {
    for (const route of [
      `/payments/${paidAttempt.id}`,
      `/applications/${approved.id}/payment`,
      `/receipts/${paidReceipt.id}`,
      `/receipts/${paidReceipt.id}/pdf`,
    ])
      assert.equal((await request("GET", route, undefined, role)).status, 404);
    assert.equal(
      (await reconcile(paidAttempt.id, randomUUID(), role)).status,
      404,
    );
  }
  assert.equal(
    (
      await request(
        "GET",
        `/receipts/${paidReceipt.id}`,
        undefined,
        "anonymous",
      )
    ).status,
    401,
  );
  for (const role of ["staff", "reviewer", "approver", "finance", "admin"])
    assert.equal(
      (await request("GET", `/receipts/${paidReceipt.id}`, undefined, role))
        .status,
      200,
    );
  const queue = await request(
    "GET",
    "/payments?page=1&pageSize=100",
    undefined,
    "finance",
  );
  assert.ok(queue.body.items.length > 0);
  assert.ok(!JSON.stringify(queue.body).includes("PRIVATE ADDRESS"));
  for (const item of queue.body.items)
    for (const property of [
      "payload",
      "dateOfBirth",
      "addressEn",
      "callbackSignature",
      "callbackHash",
      "merchantAccount",
    ])
      assert.equal(Object.hasOwn(item, property), false);
});
test("PAY-12: PostgreSQL enforces forced RLS, immutable evidence, exact financial binding and atomic paid-state constraints", async () => {
  const tables = [
    "gateway_token_cache",
    "gateway_payment_intents",
    "gateway_payment_events",
    "gateway_payment_confirmations",
    "gateway_payment_receipts",
    "gateway_payment_reconciliations",
  ];
  const flags = (
    await admin.query(
      "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1)",
      [tables],
    )
  ).rows;
  assert.equal(flags.length, tables.length);
  assert.ok(flags.every((r) => r.relrowsecurity && r.relforcerowsecurity));
  await transaction(foreignOffice.id, async (db) => {
    for (const table of tables)
      assert.equal(
        (
          await db.query(`SELECT 1 FROM ${table} WHERE tenant_id=$1`, [
            office.id,
          ])
        ).rowCount,
        0,
      );
  });
  for (const table of tables.filter(
    (t) => !["gateway_token_cache", "gateway_payment_intents"].includes(t),
  ))
    await assert.rejects(
      transaction(office.id, (db) =>
        db.query(`UPDATE ${table} SET tenant_id=tenant_id WHERE tenant_id=$1`, [
          office.id,
        ]),
      ),
      (e: any) => e.code === "42501",
    );
  await assert.rejects(
    admin.query(
      "UPDATE gateway_payment_intents SET amount_minor=1 WHERE tenant_id=$1 AND id=$2",
      [office.id, paidAttempt.id],
    ),
    /immutable/,
  );
  await assert.rejects(
    admin.query(
      "UPDATE gateway_payment_intents SET execute_started_at=NULL WHERE tenant_id=$1 AND id=$2",
      [office.id, paidAttempt.id],
    ),
    /claimed only once/,
  );
  const app = await createApplication(),
    created = await checkout(app.id);
  await assert.rejects(
    transaction(office.id, (db) =>
      db.query("UPDATE gateway_payment_intents SET status='PAID' WHERE id=$1", [
        created.body.attempt.id,
      ]),
    ),
    /Verified confirmation required/,
  );
  await assert.rejects(
    admin.query(
      "UPDATE gateway_payment_receipts SET snapshot=snapshot WHERE tenant_id=$1 AND id=$2",
      [office.id, paidReceipt.id],
    ),
    /Append-only record/,
  );
  assert.equal(
    (
      await pool.query("SELECT * FROM resolve_gateway_callback($1)", [
        "invalid",
      ])
    ).rowCount,
    0,
  );
});
test("PAY-13: finance reconciliation reports provider-query results separately from bank settlement and protects CSV exports", async () => {
  const day = new Date(Date.now() + 6 * 3600000).toISOString().slice(0, 10);
  const summary = await request(
    "GET",
    `/payments/reconciliation?businessDate=${day}`,
    undefined,
    "finance",
  );
  assert.equal(summary.status, 200);
  assert.equal(summary.body.bankSettlement, "NOT_CONNECTED");
  assert.ok(summary.body.paidCount >= 3);
  assert.equal(summary.body.paidMinor, summary.body.paidCount * 12707);
  assert.ok(
    summary.body.results.matched > 0 &&
      summary.body.results.mismatch > 0 &&
      summary.body.results.pending > 0,
  );
  assert.equal(
    (await request("GET", `/payments/reconciliation?businessDate=${day}`))
      .status,
    403,
  );
  assert.equal(
    (
      await request(
        "GET",
        "/payments/reconciliation?businessDate=2026-02-30",
        undefined,
        "finance",
      )
    ).status,
    422,
  );
  const exported = await request(
    "GET",
    `/payments/reconciliation/export.csv?businessDate=${day}`,
    undefined,
    "finance",
  );
  assert.equal(exported.status, 200);
  assert.ok(exported.body.includes('"NOT_CONNECTED"'));
  assert.ok(exported.body.includes(paidReceipt.receiptNumber));
  assert.equal(
    (
      await request(
        "GET",
        `/payments/reconciliation/export.csv?businessDate=${day}`,
      )
    ).status,
    403,
  );
});
test("PAY-14: PostgreSQL token authorization reservation survives failure before provider completion", async () => {
  const marker = Date.now(),
    store = new PostgresTokenStore(office.id);
  await assert.rejects(
    store.withLock(async (state, save) => {
      await save({
        ...state,
        fingerprint: "synthetic-reservation",
        authAttempts: [marker],
      });
      throw new Error("Synthetic process failure after committed reservation");
    }),
    /Synthetic process failure/,
  );
  await new PostgresTokenStore(office.id).withLock(async (state) => {
    assert.equal(state.fingerprint, "synthetic-reservation");
    assert.deepEqual(state.authAttempts, [marker]);
    assert.equal(state.encryptedTokens, null);
  });
});
test("PAY-15: concurrent reconciliation requests share one durable provider-call budget and preserve bounded mismatch evidence", async () => {
  const app = await createApplication(),
    created = await checkout(app.id),
    id = created.body.attempt.id;
  const queries = gateway.queries,
    results = await Promise.all(
      Array.from({ length: 26 }, () => reconcile(id)),
    );
  assert.equal(results.filter((r) => r.status === 200).length, 20);
  assert.equal(results.filter((r) => r.status === 429).length, 6);
  assert.equal(gateway.queries - queries, 20);
  const mismatches = (
    await admin.query(
      "SELECT metadata FROM gateway_payment_reconciliations WHERE tenant_id=$1 AND result='MISMATCH'",
      [office.id],
    )
  ).rows;
  assert.ok(mismatches.length > 0);
  for (const record of mismatches) {
    assert.ok(record.metadata.expected);
    assert.ok(record.metadata.query);
    assert.ok(!JSON.stringify(record.metadata).includes("PRIVATE ADDRESS"));
  }
});
test("PAY-16: later contradictory provider evidence holds issuance without rewriting receipts; a fresh MATCHED check restores eligibility", async () => {
  const application = await createApplication(),
    created = await checkout(application.id),
    id = created.body.attempt.id;
  const entry = await gateway.entryFor(id);
  entry.result.status = "Completed";
  const initial = await reconcile(id),
    receipt = initial.body.receipt;
  assert.equal(initial.body.reconciliation.result, "MATCHED");
  const originalPdf = (
    await request("GET", receipt.pdfUrl.replace("/api/v1", ""))
  ).body;
  const balance = (await request("GET", "/wallet", undefined, "finance")).body
    .balance;
  const day = new Date(Date.now() + 6 * 3600000).toISOString().slice(0, 10);
  const priorReviewCount = (
    await request(
      "GET",
      `/payments/reconciliation?businessDate=${day}`,
      undefined,
      "finance",
    )
  ).body.reviewCount;
  entry.result.status = "Initiated";
  const contradicted = await reconcile(id);
  assert.equal(contradicted.body.reconciliation.result, "MISMATCH");
  assert.equal(
    contradicted.body.reconciliation.reason,
    "GATEWAY_STATUS_CHANGED",
  );
  assert.equal(contradicted.body.attempt.status, "PAID");
  assert.equal(contradicted.body.attempt.paymentStatus, "REVIEW_REQUIRED");
  assert.equal(contradicted.body.attempt.lastReconciliation.result, "MISMATCH");
  assert.equal(
    contradicted.body.attempt.lastReconciliation.details.query.status,
    "Initiated",
  );
  assert.equal(
    contradicted.body.attempt.lastReconciliation.details.expected.invoice,
    created.body.attempt.invoice,
  );
  assert.equal(contradicted.body.receipt.id, receipt.id);
  const held = await request(
    "GET",
    "/payments?status=REVIEW_REQUIRED&pageSize=100",
    undefined,
    "finance",
  );
  assert.ok(
    held.body.items.some(
      (item: any) => item.id === id && item.paymentStatus === "REVIEW_REQUIRED",
    ),
  );
  assert.equal(
    (
      await request(
        "GET",
        `/payments/reconciliation?businessDate=${day}`,
        undefined,
        "finance",
      )
    ).body.reviewCount,
    priorReviewCount + 1,
  );
  const csv = await request(
    "GET",
    `/payments/reconciliation/export.csv?businessDate=${day}`,
    undefined,
    "finance",
  );
  assert.ok(
    csv.body
      .split("\r\n")
      .find((line: string) => line.includes(id))
      .includes('"REVIEW_REQUIRED"'),
  );
  assert.equal(
    (await request("GET", `/applications/${application.id}/payment`)).body
      .paymentStatus,
    "REVIEW_REQUIRED",
  );
  assert.equal(
    (
      await request(
        "POST",
        `/applications/${application.id}/issue`,
        {},
        "approver",
      )
    ).body.error.code,
    "ORDER_PAYMENT_REQUIRED",
  );
  entry.queryThrows = true;
  assert.equal((await reconcile(id)).body.reconciliation.result, "ERROR");
  entry.queryThrows = false;
  await transaction(office.id, (db) =>
    db.query(
      "INSERT INTO gateway_payment_reconciliations(tenant_id,intent_id,request_key,actor_id,result,reason) VALUES($1,$2,$3,$4,'PENDING','SYNTHETIC_DELAYED_OLDER_QUERY')",
      [office.id, id, randomUUID(), sessions.finance!.user.id],
    ),
  );
  assert.equal(
    (await request("GET", `/applications/${application.id}/payment`)).body
      .paymentStatus,
    "REVIEW_REQUIRED",
    "ERROR and PENDING observations must not release a mismatch hold",
  );
  entry.result.status = "Completed";
  const transactionId = entry.result.transactionId!;
  entry.result.transactionId = `OTHER${transactionId}`;
  entry.search.transactionId = entry.result.transactionId;
  const changed = await reconcile(id);
  assert.equal(changed.body.reconciliation.result, "MISMATCH");
  assert.equal(
    changed.body.reconciliation.reason,
    "GATEWAY_TRANSACTION_CHANGED",
  );
  entry.result.transactionId = transactionId;
  entry.search.transactionId = transactionId;
  const restored = await reconcile(id);
  assert.equal(restored.body.reconciliation.result, "MATCHED");
  assert.equal(restored.body.receipt.id, receipt.id);
  assert.equal(restored.body.attempt.paymentStatus, "COLLECTED");
  assert.equal(
    (
      await request(
        "GET",
        `/payments?status=REVIEW_REQUIRED&pageSize=100`,
        undefined,
        "finance",
      )
    ).body.items.some((item: any) => item.id === id),
    false,
  );
  assert.equal(
    (await request("GET", `/applications/${application.id}/payment`)).body
      .paymentStatus,
    "COLLECTED",
  );
  assert.ok(
    (await request("GET", receipt.pdfUrl.replace("/api/v1", ""))).body.equals(
      originalPdf,
    ),
  );
  assert.equal(
    (await request("GET", "/wallet", undefined, "finance")).body.balance,
    balance,
  );
  assert.equal(
    (
      await request(
        "POST",
        `/applications/${application.id}/issue`,
        {},
        "approver",
      )
    ).status,
    201,
  );
  assert.equal(
    (await request("GET", "/wallet", undefined, "finance")).body.balance,
    balance - 1,
  );
});

test("PAY-REFUND: a bKash refund is sent once, completes at once and makes the fee no longer count as paid", async () => {
  setGatewayForTests(office.id, gateway);
  const app = await createApplication();
  const started = await checkout(app.id);
  assert.equal(started.status, 201, JSON.stringify(started.body));
  assert.equal((await callback(started.body.attempt.id)).status, 303);
  assert.equal((await request("GET", `/applications/${app.id}/payment`)).body.paymentStatus, "COLLECTED");
  const requested = await request("POST", `/applications/${app.id}/refunds`, { reason: "Paid for the wrong service" });
  assert.equal(requested.status, 201, JSON.stringify(requested.body));
  const before = gateway.refundCalls;
  const approved = await request("POST", `/refunds/${requested.body.id}/decision`, { decision: "APPROVED" }, "finance");
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.status, "SETTLED");
  assert.equal(gateway.refundCalls, before + 1);
  // A later status check never refunds again.
  assert.equal((await request("POST", `/refunds/${requested.body.id}/refresh`, {}, "finance")).body.status, "SETTLED");
  assert.equal(gateway.refundCalls, before + 1);
  assert.equal((await request("GET", `/applications/${app.id}/payment`)).body.paymentStatus, "REFUNDED");
});
