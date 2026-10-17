import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { getDemoPayload } from "@astra/shared-schemas";
import { app } from "../src/app.js";
import { pool, adminConnectionString, transaction } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";

const admin = new pg.Pool({ connectionString: adminConnectionString });
const run = randomUUID().slice(0, 8),
  password = "Synthetic-Orders-Pass!";
type Session = { cookie: string; csrf: string; user: any };
const sessions: Record<string, Session> = {};
let server: ReturnType<typeof app.listen>, base: string;
let office: any,
  foreignOffice: any,
  citizen: any,
  legacy: any,
  ordered: any,
  zeroApplication: any;
let originalSnapshot: any,
  currentVersion = 0;
const preferences = {
  addressBasis: "registered_profile",
  certificateLanguage: "bn",
  deliveryMode: "office_collection",
  urgency: "normal",
};
const policy = {
  expectedVersion: 0,
  reason: "Synthetic tariff regression; not a government tariff",
  statutoryFeeMinor: 10001,
  processingFeeMinor: 2502,
  emergencySurchargeMinor: 1503,
  deliveryFeesMinor: { office_collection: 204, digital_copy: 105 },
  deliveryModes: ["office_collection", "digital_copy"],
  urgencies: ["normal", "urgent"],
};

async function request(
  method: string,
  path: string,
  data?: unknown,
  role = "citizen",
) {
  const session = sessions[role];
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      ...(session
        ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf }
        : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json(),
  };
}
async function login(role: string, email: string, secret = password) {
  const response = await request(
    "POST",
    "/auth/login",
    { email, password: secret },
    "anonymous",
  );
  assert.equal(response.status, 200, JSON.stringify(response.body));
  sessions[role] = {
    cookie: response.headers.get("set-cookie")!.split(";")[0]!,
    csrf: response.body.csrfToken,
    user: response.body.user,
  };
}
async function createOffice(suffix: string, role: string) {
  const slug = `orders-${run}-${suffix}`;
  const response = await request(
    "POST",
    "/owner/tenants",
    {
      slug,
      nameBn: "পরীক্ষা অফিস",
      nameEn: "Synthetic order office",
      division: "Test Division",
      district: "Test District",
      upazila: "Test Upazila",
      officeType: "UNION",
      adminEmail: `admin@${slug}.test`,
      adminName: "Synthetic order admin",
      adminPassword: password,
    },
    "owner",
  );
  assert.equal(response.status, 201, JSON.stringify(response.body));
  await login(role, `admin@${slug}.test`);
  return response.body;
}
async function createApplication(
  order?: any,
  payload: Record<string, unknown> = {
    ...getDemoPayload(45),
    delivery_language: "bn",
  },
) {
  return request("POST", "/applications", {
    citizenId: citizen.id,
    serviceNo: 45,
    payload,
    ...(order ? { order } : {}),
  });
}
async function publish(values: Record<string, unknown> = {}, role = "admin") {
  return request(
    "POST",
    "/admin/services/45/order-policies",
    { ...policy, ...values },
    role,
  );
}
async function transition(
  id: string,
  action: string,
  role: string,
  reason?: string,
) {
  const response = await request(
    "POST",
    `/applications/${id}/transition`,
    { action, ...(reason ? { reason } : {}) },
    role,
  );
  assert.equal(response.status, 200, JSON.stringify(response.body));
}
async function approve(id: string) {
  await transition(id, "submit", "citizen");
  await transition(id, "review", "reviewer");
  await transition(id, "approve", "approver");
}
async function counts() {
  return (
    await admin.query(
      `SELECT
    (SELECT count(*)::int FROM applications WHERE tenant_id=$1) applications,
    (SELECT count(*)::int FROM application_order_snapshots WHERE tenant_id=$1) snapshots,
    (SELECT count(*)::int FROM credit_ledger WHERE tenant_id=$1) ledger,
    (SELECT count(*)::int FROM payment_orders WHERE tenant_id=$1) payments,
    (SELECT count(*)::int FROM invoices WHERE tenant_id=$1) invoices,
    (SELECT count(*)::int FROM certificates WHERE tenant_id=$1) certificates`,
      [office.id],
    )
  ).rows[0];
}

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  await login("owner", "owner@astra.demo.test", "Demo-Phase1!");
  office = await createOffice("a", "admin");
  foreignOffice = await createOffice("b", "foreignAdmin");
  for (const role of ["staff", "reviewer", "approver", "finance"]) {
    const response = await request(
      "POST",
      "/admin/users",
      {
        email: `${role}@${office.slug}.test`,
        displayName: `Synthetic order ${role}`,
        password,
        role,
      },
      "admin",
    );
    assert.equal(response.status, 201, JSON.stringify(response.body));
    await login(role, response.body.email);
  }
  const authorization = await request(
    "PUT",
    `/admin/authorizations/${sessions.approver!.user.id}/45`,
    {
      active: true,
      authorityNote: "Synthetic order policy regression only",
    },
    "admin",
  );
  assert.equal(authorization.status, 200, JSON.stringify(authorization.body));
  const email = `citizen-${run}@orders.synthetic.test`;
  const signup = await request(
    "POST",
    "/auth/signup",
    {
      email,
      password,
      displayName: "Synthetic order citizen",
      tenantId: office.id,
      nameBn: "পরীক্ষা নাগরিক",
      nameEn: "Synthetic order citizen",
      dateOfBirth: "1998-02-03",
      addressBn: "পরীক্ষা ঠিকানা",
      addressEn: "Synthetic order address",
      syntheticReference: `DEMO-ORDERS-${run}`,
    },
    "anonymous",
  );
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  await login("citizen", email);
  citizen = (await request("GET", "/citizens")).body.items[0];
  const order = await request(
    "POST",
    "/billing/orders",
    { kind: "subscription", planId: "demo-monthly" },
    "finance",
  );
  assert.equal(order.status, 201, JSON.stringify(order.body));
  assert.equal(
    (
      await request(
        "POST",
        `/billing/orders/${order.body.id}/demo-settle`,
        {},
        "finance",
      )
    ).status,
    200,
  );
  const created = await createApplication(undefined, getDemoPayload(45));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  legacy = created.body;
});
after(async () => {
  await closePdfBrowser();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await admin.end();
});

test("ORDER-01: policies are opt-in, unknown tariffs are not zero quotes, and legacy creation stays explicit", async () => {
  assert.deepEqual((await request("GET", "/services/45/order-options")).body, {
    configured: false,
    policy: null,
  });
  const quote = await request("POST", "/services/45/order-quote", {
    preferences,
  });
  assert.equal(quote.status, 409);
  assert.equal(quote.body.error.code, "ORDER_POLICY_NOT_CONFIGURED");
  assert.equal(legacy.orderMode, "LEGACY");
  assert.equal(
    (await request("GET", `/applications/${legacy.id}`)).body.order,
    null,
  );
  const fabricated = await createApplication({ policyVersion: 1, preferences });
  assert.equal(fabricated.status, 409);
  assert.equal(fabricated.body.error.code, "ORDER_POLICY_NOT_CONFIGURED");
});

test("ORDER-02: only office admins publish explicit integer fees and policies are scoped and audited", async () => {
  for (const role of [
    "citizen",
    "staff",
    "reviewer",
    "approver",
    "finance",
    "owner",
  ])
    assert.equal((await publish({}, role)).status, 403);
  for (const values of [
    { statutoryFeeMinor: -1 },
    { processingFeeMinor: 0.1 },
    { emergencySurchargeMinor: "100" },
    { statutoryFeeMinor: 100000001 },
    { deliveryFeesMinor: { office_collection: 0 } },
    { deliveryModes: [] },
    { deliveryModes: ["office_collection", "office_collection"] },
    { urgencies: ["express"] },
    { reason: "  " },
    { tenantId: foreignOffice.id },
    { totalMinor: 0 },
  ])
    assert.equal((await publish(values)).status, 422, JSON.stringify(values));
  const response = await publish();
  assert.equal(response.status, 201, JSON.stringify(response.body));
  currentVersion = response.body.policy.version;
  assert.equal(currentVersion, 1);
  assert.deepEqual(
    Object.keys(response.body.policy).sort(),
    [
      "version",
      "statutoryFeeMinor",
      "processingFeeMinor",
      "emergencySurchargeMinor",
      "deliveryFeesMinor",
      "deliveryModes",
      "urgencies",
      "currency",
    ].sort(),
  );
  assert.deepEqual(
    (
      await request(
        "GET",
        "/services/45/order-options",
        undefined,
        "foreignAdmin",
      )
    ).body,
    { configured: false, policy: null },
  );
  assert.equal(
    (await request("GET", "/services/45/order-options", undefined, "anonymous"))
      .status,
    401,
  );
  assert.equal(
    (await request("GET", "/services/45/order-options", undefined, "owner"))
      .status,
    403,
  );
  const evidence = (
    await admin.query(
      "SELECT metadata,actor_id FROM audit_events WHERE tenant_id=$1 AND action='ORDER_POLICY_PUBLISHED'",
      [office.id],
    )
  ).rows;
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].actor_id, sessions.admin!.user.id);
  assert.deepEqual(evidence[0].metadata, {
    serviceNo: 45,
    version: 1,
    previousVersion: 0,
  });
});

test("ORDER-03: server quotes exact paisa components without writing applications, charges or payment records", async () => {
  const before = await counts();
  for (const [deliveryMode, urgency, expectedTotal] of [
    ["office_collection", "normal", 12707],
    ["office_collection", "urgent", 14210],
    ["digital_copy", "normal", 12608],
    ["digital_copy", "urgent", 14111],
  ] as const) {
    const selected = { ...preferences, deliveryMode, urgency };
    const response = await request("POST", "/services/45/order-quote", {
      preferences: selected,
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(response.body, {
      policyVersion: 1,
      preferences: selected,
      currency: "BDT",
      paymentStatus: "NOT_COLLECTED",
      totalMinor: expectedTotal,
      components: [
        { code: "statutory_fee", amountMinor: 10001 },
        { code: "processing_fee", amountMinor: 2502 },
        {
          code: "emergency_surcharge",
          amountMinor: urgency === "urgent" ? 1503 : 0,
        },
        {
          code: "delivery_fee",
          amountMinor: deliveryMode === "office_collection" ? 204 : 105,
        },
      ],
    });
  }
  for (const role of ["finance", "reviewer", "approver", "owner"])
    assert.equal(
      (await request("POST", "/services/45/order-quote", { preferences }, role))
        .status,
      403,
    );
  for (const body of [
    { preferences, totalMinor: 0 },
    { preferences: { ...preferences, coupon: "FREE" } },
    { preferences: { ...preferences, certificateLanguage: "bilingual" } },
    { preferences: { ...preferences, addressBasis: "permanent" } },
  ])
    assert.equal(
      (await request("POST", "/services/45/order-quote", body)).status,
      422,
    );
  assert.deepEqual(await counts(), before);
  const foreign = await publish({ statutoryFeeMinor: 999 }, "foreignAdmin");
  assert.equal(foreign.status, 201);
  const foreignQuote = await request(
    "POST",
    "/services/45/order-quote",
    { preferences },
    "foreignAdmin",
  );
  assert.equal(foreignQuote.body.components[0].amountMinor, 999);
  assert.equal(
    (await request("POST", "/services/45/order-quote", { preferences })).body
      .components[0].amountMinor,
    10001,
  );
});

test("ORDER-04: application accepts a recomputed immutable snapshot and rejects missing, stale, client-priced or language-mismatched orders atomically", async () => {
  const before = await counts();
  const absent = await createApplication();
  assert.equal(absent.status, 409);
  assert.equal(absent.body.error.code, "ORDER_REQUIRED");
  const stale = await createApplication({ policyVersion: 99, preferences });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, "ORDER_POLICY_STALE");
  for (const extra of [
    { totalMinor: 0 },
    { paymentStatus: "PAID" },
    { tenantId: foreignOffice.id },
  ])
    assert.equal(
      (await createApplication({ policyVersion: 1, preferences, ...extra }))
        .status,
      422,
    );
  const mismatch = await createApplication(
    { policyVersion: 1, preferences },
    { ...getDemoPayload(45), delivery_language: "en" },
  );
  assert.equal(mismatch.status, 422);
  assert.equal(mismatch.body.error.code, "ORDER_LANGUAGE_MISMATCH");
  assert.deepEqual(await counts(), before);
  const response = await createApplication({ policyVersion: 1, preferences });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  ordered = response.body;
  assert.equal(ordered.orderMode, "POLICY");
  originalSnapshot = (await request("GET", `/applications/${ordered.id}`)).body
    .order;
  assert.equal(originalSnapshot.policyVersion, 1);
  assert.equal(originalSnapshot.totalMinor, 12707);
  assert.equal(originalSnapshot.paymentStatus, "NOT_COLLECTED");
  assert.deepEqual(originalSnapshot.preferences, preferences);
  assert.equal(
    (
      await request(
        "GET",
        `/applications/${ordered.id}`,
        undefined,
        "foreignAdmin",
      )
    ).status,
    404,
  );
});

test("ORDER-05: concurrent publication accepts one expected version; existing snapshots stay fixed and stale new applications fail", async () => {
  const publications = await Promise.all([
    publish({ expectedVersion: 1, statutoryFeeMinor: 20001 }),
    publish({ expectedVersion: 1, statutoryFeeMinor: 20002 }),
  ]);
  assert.deepEqual(
    publications.map((result) => result.status).sort(),
    [201, 409],
  );
  currentVersion = publications.find((result) => result.status === 201)!.body
    .policy.version;
  assert.equal(currentVersion, 2);
  assert.equal(
    publications.find((result) => result.status === 409)!.body.error.code,
    "ORDER_POLICY_STALE",
  );
  assert.deepEqual(
    (await request("GET", `/applications/${ordered.id}`)).body.order,
    originalSnapshot,
  );
  const stale = await createApplication({ policyVersion: 1, preferences });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, "ORDER_POLICY_STALE");
  const history = (
    await admin.query(
      "SELECT version,statutory_fee_minor FROM service_order_policies WHERE tenant_id=$1 AND service_no=45 ORDER BY version",
      [office.id],
    )
  ).rows;
  assert.deepEqual(
    history.map((row) => row.version),
    [1, 2],
  );
  assert.equal(history[0].statutory_fee_minor, 10001);
});

test("ORDER-06: PostgreSQL enforces forced tenant isolation, immutable policy/snapshot records and creation origin", async () => {
  const flags = (
    await admin.query(
      "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1)",
      [["service_order_policies", "application_order_snapshots"]],
    )
  ).rows;
  assert.equal(flags.length, 2);
  assert.ok(
    flags.every((row) => row.relrowsecurity && row.relforcerowsecurity),
  );
  await transaction(foreignOffice.id, async (db) => {
    assert.equal(
      (
        await db.query(
          "SELECT * FROM service_order_policies WHERE tenant_id=$1",
          [office.id],
        )
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await db.query(
          "SELECT * FROM application_order_snapshots WHERE application_id=$1",
          [ordered.id],
        )
      ).rowCount,
      0,
    );
  });
  for (const table of ["service_order_policies", "application_order_snapshots"])
    await assert.rejects(
      admin.query(`UPDATE ${table} SET currency='BDT' WHERE tenant_id=$1`, [
        office.id,
      ]),
      /Append-only record/,
    );
  await assert.rejects(
    transaction(office.id, (db) =>
      db.query("UPDATE applications SET order_mode='LEGACY' WHERE id=$1", [
        ordered.id,
      ]),
    ),
    (error: any) => error.code === "23514",
  );
  const insert = (mode: string) =>
    transaction(office.id, async (db) => {
      await db.query(
        "INSERT INTO applications(tenant_id,citizen_id,service_no,schema_version,schema_hash,created_by,order_mode) SELECT tenant_id,citizen_id,service_no,schema_version,schema_hash,created_by,$2 FROM applications WHERE id=$1",
        [ordered.id, mode],
      );
    });
  await assert.rejects(
    insert("LEGACY"),
    /Application order policy must match creation origin/,
  );
  await assert.rejects(
    insert("POLICY"),
    /Application order snapshot is required/,
  );
  assert.deepEqual(
    (await request("GET", `/applications/${ordered.id}`)).body.order,
    originalSnapshot,
  );
});

test("ORDER-07: correction preserves order language and snapshot; uncollected positive fees prevent issuance without a debit", async () => {
  const wrong = await request("PATCH", `/applications/${ordered.id}`, {
    payload: { ...getDemoPayload(45), delivery_language: "en" },
  });
  assert.equal(wrong.status, 422);
  assert.equal(wrong.body.error.code, "ORDER_LANGUAGE_MISMATCH");
  await transition(ordered.id, "submit", "citizen");
  await transition(ordered.id, "review", "reviewer");
  await transition(
    ordered.id,
    "request_correction",
    "reviewer",
    "Synthetic correction request",
  );
  const detail = (await request("GET", `/applications/${ordered.id}`)).body;
  const corrected = await request("PATCH", `/applications/${ordered.id}`, {
    payload: { ...detail.payload, purpose_en: "Synthetic corrected purpose" },
  });
  assert.equal(corrected.status, 200, JSON.stringify(corrected.body));
  await transition(ordered.id, "resubmit", "citizen");
  await transition(ordered.id, "review", "reviewer");
  await transition(ordered.id, "approve", "approver");
  const before = await counts();
  const balance = (await request("GET", "/wallet", undefined, "finance")).body
    .balance;
  const issue = await request(
    "POST",
    `/applications/${ordered.id}/issue`,
    {},
    "approver",
  );
  assert.equal(issue.status, 402);
  assert.equal(issue.body.error.code, "ORDER_PAYMENT_REQUIRED");
  assert.deepEqual(await counts(), before);
  assert.equal(
    (await request("GET", "/wallet", undefined, "finance")).body.balance,
    balance,
  );
  const after = (await request("GET", `/applications/${ordered.id}`)).body;
  assert.equal(after.application.state, "APPROVED");
  assert.deepEqual(after.order, originalSnapshot);
});

test("ORDER-08: a draft created before any policy retains its legacy path after publication", async () => {
  await approve(legacy.id);
  const result = await request(
    "POST",
    `/applications/${legacy.id}/issue`,
    {},
    "approver",
  );
  assert.equal(result.status, 201, JSON.stringify(result.body));
  const detail = (await request("GET", `/applications/${legacy.id}`)).body;
  assert.equal(detail.application.orderMode, "LEGACY");
  assert.equal(detail.application.state, "ISSUED");
  assert.equal(detail.order, null);
  const renewal = await request("POST", `/applications/${legacy.id}/renew`, {});
  assert.equal(renewal.status, 409);
  assert.equal(renewal.body.error.code, "ORDER_REQUIRED");
});

test("ORDER-09: explicit zero-fee policy still requires separate authorized approval and concurrent issuance deducts exactly once", async () => {
  const response = await publish({
    expectedVersion: currentVersion,
    statutoryFeeMinor: 0,
    processingFeeMinor: 0,
    emergencySurchargeMinor: 0,
    deliveryFeesMinor: { office_collection: 0, digital_copy: 0 },
    deliveryModes: ["digital_copy"],
    urgencies: ["normal"],
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  currentVersion = response.body.policy.version;
  const chosen = { ...preferences, deliveryMode: "digital_copy" };
  const disallowed = await createApplication({
    policyVersion: currentVersion,
    preferences,
  });
  assert.equal(disallowed.status, 422);
  assert.equal(disallowed.body.error.code, "ORDER_OPTION_UNAVAILABLE");
  const quote = await request("POST", "/services/45/order-quote", {
    preferences: chosen,
  });
  assert.equal(quote.body.totalMinor, 0);
  const created = await createApplication({
    policyVersion: currentVersion,
    preferences: chosen,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  zeroApplication = created.body;
  assert.equal(
    (
      await request(
        "POST",
        `/applications/${zeroApplication.id}/issue`,
        {},
        "approver",
      )
    ).status,
    409,
  );
  await approve(zeroApplication.id);
  assert.equal(
    (
      await request(
        "POST",
        `/applications/${zeroApplication.id}/issue`,
        {},
        "admin",
      )
    ).status,
    403,
  );
  const balance = (await request("GET", "/wallet", undefined, "finance")).body
    .balance;
  const issues = await Promise.all([
    request(
      "POST",
      `/applications/${zeroApplication.id}/issue`,
      {},
      "approver",
    ),
    request(
      "POST",
      `/applications/${zeroApplication.id}/issue`,
      {},
      "approver",
    ),
  ]);
  assert.ok(
    issues.every((result) => result.status === 200 || result.status === 201),
    JSON.stringify(issues),
  );
  assert.equal(new Set(issues.map((result) => result.body.id)).size, 1);
  assert.equal(
    (await request("GET", "/wallet", undefined, "finance")).body.balance,
    balance - 1,
  );
  const rows = (
    await admin.query(
      "SELECT count(*)::int count FROM credit_ledger WHERE tenant_id=$1 AND certificate_id=$2",
      [office.id, issues[0].body.id],
    )
  ).rows[0];
  assert.equal(rows.count, 1);
  const detail = (await request("GET", `/applications/${zeroApplication.id}`))
    .body;
  assert.equal(detail.order.totalMinor, 0);
  assert.equal(
    detail.order.paymentStatus,
    "NOT_COLLECTED",
    "A zero assessment does not claim money was collected",
  );
  assert.equal(
    (await request("POST", `/applications/${ordered.id}/issue`, {}, "approver"))
      .body.error.code,
    "ORDER_PAYMENT_REQUIRED",
    "A newer zero policy cannot erase an older accepted charge",
  );
});

test("ORDER-10: renewal explicitly accepts the current policy and cannot reuse superseded preferences or prices", async () => {
  const absent = await request(
    "POST",
    `/applications/${zeroApplication.id}/renew`,
    {},
  );
  assert.equal(absent.status, 409);
  assert.equal(absent.body.error.code, "ORDER_REQUIRED");
  const oldVersion = currentVersion;
  const publication = await publish({
    expectedVersion: oldVersion,
    statutoryFeeMinor: 0,
    processingFeeMinor: 0,
    emergencySurchargeMinor: 0,
    deliveryFeesMinor: { office_collection: 0, digital_copy: 0 },
    deliveryModes: ["office_collection"],
    urgencies: ["normal"],
  });
  assert.equal(publication.status, 201);
  currentVersion = publication.body.policy.version;
  const oldPreferences = { ...preferences, deliveryMode: "digital_copy" };
  const stale = await request(
    "POST",
    `/applications/${zeroApplication.id}/renew`,
    { order: { policyVersion: oldVersion, preferences: oldPreferences } },
  );
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, "ORDER_POLICY_STALE");
  const unavailable = await request(
    "POST",
    `/applications/${zeroApplication.id}/renew`,
    { order: { policyVersion: currentVersion, preferences: oldPreferences } },
  );
  assert.equal(unavailable.status, 422);
  assert.equal(unavailable.body.error.code, "ORDER_OPTION_UNAVAILABLE");
  const renewed = await request(
    "POST",
    `/applications/${zeroApplication.id}/renew`,
    { order: { policyVersion: currentVersion, preferences } },
  );
  assert.equal(renewed.status, 201, JSON.stringify(renewed.body));
  const detail = (await request("GET", `/applications/${renewed.body.id}`))
    .body;
  assert.equal(detail.order.policyVersion, currentVersion);
  assert.equal(detail.order.preferences.deliveryMode, "office_collection");
  assert.equal(detail.renewal.sourceApplicationId, zeroApplication.id);
  const parent = (await request("GET", `/applications/${zeroApplication.id}`))
    .body;
  assert.equal(parent.order.policyVersion, oldVersion);
  assert.equal(parent.order.preferences.deliveryMode, "digital_copy");
});
