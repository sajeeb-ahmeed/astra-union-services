import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { demoPayloads } from "@astra/shared-schemas";
import { app } from "../src/app.js";
import { pool, adminConnectionString, transaction } from "../src/db.js";
import { signature } from "../src/security.js";
import {
  closePdfBrowser,
  renderCertificateHtml,
  DEMO_TEMPLATE_VERSION,
} from "../src/pdf.js";
process.env.NODE_ENV = "test";
const admin = new pg.Pool({ connectionString: adminConnectionString });
let server: ReturnType<typeof app.listen>;
let base: string;
type Session = { cookie: string; csrf: string; user: any };
const sessions: Record<string, Session> = {};
let citizen: any;
let mainApp: any;
let cert: any;
async function request(
  method: string,
  url: string,
  data?: any,
  session?: Session,
  headers: Record<string, string> = {},
) {
  const r = await fetch(`${base}/api/v1${url}`, {
    method,
    headers: {
      ...(data !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(session
        ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf }
        : {}),
      ...headers,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const type = r.headers.get("content-type") ?? "";
  return {
    status: r.status,
    body: type.includes("application/json")
      ? await r.json()
      : Buffer.from(await r.arrayBuffer()),
    headers: r.headers,
  };
}
async function login(name: string) {
  const email =
    name === "owner"
      ? "owner@astra.demo.test"
      : `${name.split(":")[1]}@${name.split(":")[0]}.demo.test`;
  const r = await request("POST", "/auth/login", {
    email,
    password: "Demo-Phase1!",
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  sessions[name] = {
    cookie: r.headers.get("set-cookie")!.split(";")[0],
    csrf: r.body.csrfToken,
    user: r.body.user,
  };
}
async function createApproved(
  no = 45,
  payload = demoPayloads[no as keyof typeof demoPayloads],
) {
  const created = await request(
    "POST",
    "/applications",
    {
      citizenId: citizen.id,
      serviceNo: no,
      payload,
    },
    sessions["alpha:staff"],
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  for (const [action, session] of [
    ["submit", "alpha:staff"],
    ["review", "alpha:reviewer"],
    ["approve", "alpha:approver"],
  ]) {
    const r = await request(
      "POST",
      `/applications/${created.body.id}/transition`,
      { action },
      sessions[session!],
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  return created.body;
}
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as any;
  base = `http://127.0.0.1:${address.port}`;
  for (const name of [
    "owner",
    "alpha:citizen",
    "alpha:staff",
    "alpha:reviewer",
    "alpha:approver",
    "alpha:admin",
    "alpha:finance",
    "beta:staff",
    "beta:approver",
  ])
    await login(name);
  const c = await request(
    "GET",
    "/citizens",
    undefined,
    sessions["alpha:citizen"],
  );
  assert.equal(c.status, 200);
  citizen = c.body.items[0];
  assert.ok(citizen);
});
after(async () => {
  await closePdfBrowser();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await admin.end();
});
test("OPS-01: real PostgreSQL, all 47 catalog entries and schema versions", async () => {
  const db = await admin.query("SELECT version() version");
  assert.match(db.rows[0].version, /PostgreSQL/);
  const count = await admin.query(
    "SELECT count(*)::int n FROM service_catalog",
  );
  assert.equal(count.rows[0].n, 47);
  const appRole = await pool.query(
    "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
  );
  assert.equal(appRole.rows[0].rolsuper, false);
  assert.equal(appRole.rows[0].rolbypassrls, false);
  const c = await request("GET", "/services");
  assert.equal(c.body.items.length, 47);
  for (const no of [2, 42, 45])
    assert.equal(
      (await request("GET", `/services/${no}/schema`)).body.stage,
      "operational_demo",
    );
  assert.equal(
    (await request("GET", "/services/1/schema")).body.stage,
    "operational_demo",
  );
});
test("CIT-01 / TEN-01 / TEN-02 / AUTH-01: synthetic registration, duplicate handling and tenant scopes", async () => {
  const reference = `DEMO-TEST-${randomUUID().slice(0, 8)}`;
  const data = {
    nameBn: "পরীক্ষা ডেমো নাগরিক",
    nameEn: "Synthetic Test Citizen",
    dateOfBirth: "1996-02-03",
    addressBn: "ডেমো পরীক্ষা গ্রাম",
    addressEn: "Synthetic test village",
    syntheticReference: reference,
  };
  const created = await request(
    "POST",
    "/citizens",
    data,
    sessions["alpha:staff"],
  );
  assert.equal(created.status, 201);
  assert.equal(
    created.body.dateOfBirth,
    data.dateOfBirth,
    "A calendar date must round-trip without a timezone shift",
  );
  assert.equal(created.body.verificationState, "SYNTHETIC_DEMO");
  assert.equal(
    (await request("POST", "/citizens", data, sessions["alpha:staff"])).status,
    409,
  );
  assert.equal(
    (
      await request(
        "POST",
        "/citizens",
        { ...data, dateOfBirth: "2025-02-30" },
        sessions["alpha:staff"],
      )
    ).status,
    422,
  );
  const betaList = await request(
    "GET",
    `/citizens?q=${reference}&tenant_id=${sessions["alpha:staff"].user.tenantId}`,
    undefined,
    sessions["beta:staff"],
  );
  assert.equal(betaList.status, 200);
  assert.equal(betaList.body.items.length, 0);
  assert.equal(
    (await request("POST", "/citizens", data, sessions["alpha:reviewer"]))
      .status,
    403,
  );
  assert.equal(
    (
      await request(
        "POST",
        "/citizens",
        { ...data, tenantId: sessions["beta:staff"].user.tenantId },
        sessions["alpha:staff"],
      )
    ).status,
    422,
  );
  const raw = await pool.query("SELECT count(*)::int n FROM citizens");
  assert.equal(raw.rows[0].n, 0, "RLS denies unscoped DB access");
  const unscopedWallet = await pool.query("SELECT * FROM lock_tenant_wallet()");
  assert.equal(
    unscopedWallet.rowCount,
    0,
    "Wallet lock helper requires transaction-local tenant context",
  );
  const betaBalance = (
    await admin.query("SELECT balance FROM tenant_wallets WHERE tenant_id=$1", [
      sessions["beta:staff"].user.tenantId,
    ])
  ).rows[0].balance;
  const betaLock = await transaction(
    sessions["beta:staff"].user.tenantId,
    (db) => db.query("SELECT * FROM lock_tenant_wallet()"),
  );
  assert.equal(betaLock.rowCount, 1);
  assert.equal(
    betaLock.rows[0].balance,
    betaBalance,
    "Wallet helper locks only the selected context tenant",
  );
  const cross = await transaction(sessions["beta:staff"].user.tenantId, (db) =>
    db.query("SELECT * FROM citizens WHERE id=$1", [citizen.id]),
  );
  assert.equal(cross.rowCount, 0);
});
test("FOR-02 / APP-01 / APP-04: valid versioned draft, correction, resubmission and authorized approval", async () => {
  const invalid = await request(
    "POST",
    "/applications",
    {
      citizenId: citizen.id,
      serviceNo: 45,
      payload: { ...demoPayloads[45], confirmation: false },
    },
    sessions["alpha:citizen"],
  );
  assert.equal(invalid.status, 422);
  assert.equal(invalid.body.error.code, "FORM_INVALID");
  const preview = await request(
    "POST",
    "/applications",
    { citizenId: citizen.id, serviceNo: 1, payload: {} },
    sessions["alpha:staff"],
  );
  assert.equal(preview.status, 422);
  assert.equal(preview.body.error.code, "FORM_INVALID");
  const created = await request(
    "POST",
    "/applications",
    { citizenId: citizen.id, serviceNo: 45, payload: demoPayloads[45] },
    sessions["alpha:citizen"],
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  mainApp = created.body;
  assert.equal(
    (
      await request(
        "POST",
        `/applications/${mainApp.id}/transition`,
        { action: "approve" },
        sessions["alpha:staff"],
      )
    ).status,
    403,
  );
  for (const [action, session, reason] of [
    ["submit", "alpha:citizen", undefined],
    ["review", "alpha:reviewer", undefined],
    [
      "request_correction",
      "alpha:reviewer",
      "Please clarify the demonstration address",
    ],
  ]) {
    const r = await request(
      "POST",
      `/applications/${mainApp.id}/transition`,
      { action, ...(reason ? { reason } : {}) },
      sessions[session!],
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  const revised = {
    ...demoPayloads[45],
    purpose_en: "Revised synthetic demonstration purpose",
  };
  const edited = await request(
    "PATCH",
    `/applications/${mainApp.id}`,
    { payload: revised },
    sessions["alpha:citizen"],
  );
  assert.equal(edited.status, 200);
  assert.equal(edited.body.latestVersion, 2);
  for (const [action, session] of [
    ["resubmit", "alpha:citizen"],
    ["review", "alpha:reviewer"],
    ["approve", "alpha:approver"],
  ])
    assert.equal(
      (
        await request(
          "POST",
          `/applications/${mainApp.id}/transition`,
          { action },
          sessions[session!],
        )
      ).status,
      200,
    );
  const detail = await request(
    "GET",
    `/applications/${mainApp.id}`,
    undefined,
    sessions["alpha:citizen"],
  );
  assert.equal(detail.body.application.state, "APPROVED");
  assert.equal(detail.body.versions.length, 2);
  assert.equal(
    detail.body.versions[0].payload.purpose_en,
    demoPayloads[45].purpose_en,
  );
  assert.equal(detail.body.payload.purpose_en, revised.purpose_en);
  assert.equal(detail.body.events.length, 8);
});
test("APP-02 / APP-03 / SEC-02 / CER-04: read has no effects and cross-tenant/unauthorized issue denied", async () => {
  const before = await admin.query(
    "SELECT (SELECT count(*) FROM applications)::int applications,(SELECT count(*) FROM application_events)::int events,(SELECT count(*) FROM credit_ledger)::int ledger",
  );
  for (let i = 0; i < 3; i++)
    assert.equal(
      (
        await request(
          "GET",
          `/applications/${mainApp.id}`,
          undefined,
          sessions["alpha:citizen"],
        )
      ).status,
      200,
    );
  const after = await admin.query(
    "SELECT (SELECT count(*) FROM applications)::int applications,(SELECT count(*) FROM application_events)::int events,(SELECT count(*) FROM credit_ledger)::int ledger",
  );
  assert.deepEqual(after.rows, before.rows);
  assert.equal(
    (
      await request(
        "GET",
        `/applications/${mainApp.id}`,
        undefined,
        sessions["beta:staff"],
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        "POST",
        `/applications/${mainApp.id}/transition`,
        { action: "approve" },
        sessions["beta:approver"],
      )
    ).status,
    404,
  );
  for (const name of [
    "alpha:staff",
    "alpha:reviewer",
    "alpha:citizen",
    "owner",
  ])
    assert.equal(
      (
        await request(
          "POST",
          `/applications/${mainApp.id}/issue`,
          {},
          sessions[name],
        )
      ).status,
      403,
    );
  const denied = await admin.query(
    "SELECT count(*)::int n FROM audit_events WHERE action='ACCESS_DENIED' AND resource_id=$1",
    [mainApp.id],
  );
  assert.ok(denied.rows[0].n >= 3);
});
test("WAL-03: insufficient credit retains approval without document/debit", async () => {
  const owner = sessions.owner;
  const alpha = sessions["alpha:staff"].user.tenantId;
  const balance = (
    await request("GET", "/wallet", undefined, sessions["alpha:approver"])
  ).body.balance;
  assert.equal(
    (
      await request(
        "POST",
        `/owner/tenants/${alpha}/adjust`,
        { delta: -balance, reason: "Synthetic test wallet depletion" },
        owner,
      )
    ).status,
    201,
  );
  const result = await request(
    "POST",
    `/applications/${mainApp.id}/issue`,
    {},
    sessions["alpha:approver"],
  );
  assert.equal(result.status, 402, JSON.stringify(result.body));
  assert.equal(result.body.error.code, "INSUFFICIENT_CREDITS");
  const detail = (
    await request(
      "GET",
      `/applications/${mainApp.id}`,
      undefined,
      sessions["alpha:staff"],
    )
  ).body;
  assert.equal(detail.application.state, "APPROVED");
  assert.equal(detail.certificate, null);
  assert.equal(
    (
      await request(
        "POST",
        `/owner/tenants/${alpha}/adjust`,
        { delta: balance, reason: "Restore synthetic test wallet credits" },
        owner,
      )
    ).status,
    201,
  );
});
test("WAL-04: injected database failure rolls certificate, ledger, state and outbox back", async () => {
  const approved = await createApproved();
  const prior = (
    await request("GET", "/wallet", undefined, sessions["alpha:approver"])
  ).body;
  const result = await request(
    "POST",
    `/applications/${approved.id}/issue`,
    {},
    sessions["alpha:approver"],
    { "X-Test-Failure": "after-debit" },
  );
  assert.equal(result.status, 500);
  const after = (
    await request("GET", "/wallet", undefined, sessions["alpha:approver"])
  ).body;
  assert.equal(after.balance, prior.balance);
  assert.equal(after.ledger.length, prior.ledger.length);
  const detail = (
    await request(
      "GET",
      `/applications/${approved.id}`,
      undefined,
      sessions["alpha:staff"],
    )
  ).body;
  assert.equal(detail.application.state, "APPROVED");
  assert.equal(detail.certificate, null);
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM certificates WHERE application_id=$1",
        [approved.id],
      )
    ).rows[0].n,
    0,
  );
});
test("BILL-01: expired subscription blocks issuance and retains approved application", async () => {
  const id = sessions["alpha:staff"].user.tenantId;
  const prior = (
    await admin.query(
      "SELECT valid_until,status FROM tenant_subscriptions WHERE tenant_id=$1",
      [id],
    )
  ).rows[0];
  await admin.query(
    "UPDATE tenant_subscriptions SET valid_until=now()-interval '1 day' WHERE tenant_id=$1",
    [id],
  );
  try {
    const r = await request(
      "POST",
      `/applications/${mainApp.id}/issue`,
      {},
      sessions["alpha:approver"],
    );
    assert.equal(r.status, 402);
    assert.equal(r.body.error.code, "SUBSCRIPTION_INACTIVE");
    const detail = (
      await request(
        "GET",
        `/applications/${mainApp.id}`,
        undefined,
        sessions["alpha:staff"],
      )
    ).body;
    assert.equal(detail.application.state, "APPROVED");
    assert.equal(detail.certificate, null);
  } finally {
    await admin.query(
      "UPDATE tenant_subscriptions SET valid_until=$2,status=$3 WHERE tenant_id=$1",
      [id, prior.valid_until, prior.status],
    );
  }
});
test("CER-01 / CER-02 / WAL-01 / WAL-02: concurrent issuance produces one real PDF and one debit", async () => {
  const prior = (
    await request("GET", "/wallet", undefined, sessions["alpha:approver"])
  ).body.balance;
  const issued = await Promise.all(
    Array.from({ length: 8 }, () =>
      request(
        "POST",
        `/applications/${mainApp.id}/issue`,
        {},
        sessions["alpha:approver"],
      ),
    ),
  );
  for (const result of issued)
    assert.ok([200, 201].includes(result.status), JSON.stringify(result.body));
  assert.equal(new Set(issued.map((r) => r.body.id)).size, 1);
  cert = issued[0]!.body;
  assert.equal(cert.templateVersion, DEMO_TEMPLATE_VERSION);
  const retries = await request(
    "POST",
    `/applications/${mainApp.id}/issue`,
    {},
    sessions["alpha:approver"],
  );
  assert.equal(retries.body.id, cert.id);
  assert.equal(retries.body.templateVersion, DEMO_TEMPLATE_VERSION);
  const wallet = await request(
    "GET",
    "/wallet",
    undefined,
    sessions["alpha:approver"],
  );
  assert.equal(wallet.body.balance, prior - 1);
  const entries = await admin.query(
    "SELECT count(*)::int n FROM credit_ledger WHERE certificate_id=$1 AND kind='ISSUANCE'",
    [cert.id],
  );
  assert.equal(entries.rows[0].n, 1);
  const pdf = await request(
    "GET",
    `/certificates/${cert.id}/pdf`,
    undefined,
    sessions["alpha:citizen"],
  );
  assert.equal(pdf.status, 200);
  assert.ok(Buffer.isBuffer(pdf.body));
  assert.equal(pdf.body.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.body.length > 10000);
  assert.ok(
    pdf.body.toString("latin1").includes("/ToUnicode"),
    "PDF includes embedded Unicode text mappings",
  );
  fs.mkdirSync("execution", { recursive: true });
  fs.writeFileSync("execution/demo-permanent-resident.pdf", pdf.body);
  const token = cert.verificationUrl.split("/").at(-1);
  assert.match(token, /^[a-f0-9]{64}$/);
  const verified = await request("GET", `/verify/${token}`);
  assert.equal(verified.status, 200);
  assert.equal(verified.body.status, "ISSUED");
  assert.equal(verified.body.demo, true);
  assert.deepEqual(Object.keys(verified.body).sort(), [
    "demo",
    "issuedAt",
    "officeBn",
    "officeEn",
    "serviceBn",
    "serviceEn",
    "serviceNo",
    "status",
  ]);
  assert.ok(!JSON.stringify(verified.body).includes(citizen.nameEn));
  const c = await admin.query(
    "SELECT count(*)::int n FROM certificates WHERE application_id=$1",
    [mainApp.id],
  );
  assert.equal(c.rows[0].n, 1);
  assert.equal(
    (
      await request(
        "GET",
        `/certificates/${cert.id}/pdf`,
        undefined,
        sessions["beta:staff"],
      )
    ).status,
    404,
  );
});
test("CER-03 / PUB-02: revoke reflected in minimal lookup; random/invalid token safe", async () => {
  const r = await request(
    "POST",
    `/certificates/${cert.id}/revoke`,
    { reason: "Synthetic revocation acceptance test" },
    sessions["alpha:approver"],
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "REVOKED");
  assert.equal(
    (await request("GET", `/verify/${cert.verificationUrl.split("/").at(-1)}`))
      .body.status,
    "REVOKED",
  );
  assert.equal((await request("GET", "/verify/invalid")).status, 404);
  assert.equal((await request("GET", `/verify/${"0".repeat(64)}`)).status, 404);
});
test("WAL-05 / BILL-01 / BILL-02: verified sandbox settlements are replay-safe and separate from official fees", async () => {
  const finance = sessions["alpha:finance"];
  const prior = (await request("GET", "/wallet", undefined, finance)).body
    .balance;
  const order = await request(
    "POST",
    "/billing/orders",
    { kind: "topup", credits: 7 },
    finance,
  );
  assert.equal(order.status, 201);
  assert.equal(order.body.amountMinor, 0);
  const data = {
    eventId: `acceptance:${randomUUID()}`,
    orderId: order.body.id,
    tenantId: finance.user.tenantId,
    amountMinor: 0,
    currency: "BDT",
    status: "SETTLED",
  };
  const secret =
    process.env.DEMO_WEBHOOK_SECRET ??
    fs.readFileSync(".runtime/webhook-secret", "utf8").trim();
  assert.equal(
    (
      await request("POST", "/billing/webhook", data, undefined, {
        "X-Demo-Signature": "0".repeat(64),
      })
    ).status,
    401,
  );
  const mismatch = { ...data, amountMinor: 1 };
  assert.equal(
    (
      await request("POST", "/billing/webhook", mismatch, undefined, {
        "X-Demo-Signature": signature(JSON.stringify(mismatch), secret),
      })
    ).status,
    422,
  );
  assert.equal(
    (await request("GET", "/wallet", undefined, finance)).body.balance,
    prior,
  );
  const headers = {
    "X-Demo-Signature": signature(JSON.stringify(data), secret),
  };
  const settled = await request(
    "POST",
    "/billing/webhook",
    data,
    undefined,
    headers,
  );
  assert.equal(settled.status, 200);
  assert.equal(settled.body.replayed, false);
  const repeated = await request(
    "POST",
    "/billing/webhook",
    data,
    undefined,
    headers,
  );
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.replayed, true);
  const different = { ...data, eventId: `different:${randomUUID()}` };
  assert.equal(
    (
      await request("POST", "/billing/webhook", different, undefined, {
        "X-Demo-Signature": signature(JSON.stringify(different), secret),
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("GET", "/wallet", undefined, finance)).body.balance,
    prior + 7,
  );
  const planOrder = await request(
    "POST",
    "/billing/orders",
    { kind: "subscription", planId: "demo-monthly" },
    finance,
  );
  assert.equal(planOrder.status, 201);
  assert.equal(
    (
      await request(
        "POST",
        `/billing/orders/${planOrder.body.id}/demo-settle`,
        {},
        finance,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request("GET", "/wallet", undefined, finance)).body.balance,
    prior + 27,
  );
  const bill = await request("GET", "/billing", undefined, finance);
  assert.ok(
    bill.body.invoices.some(
      (i: any) =>
        i.orderId === order.body.id &&
        i.amountMinor === 0 &&
        i.type === "SAAS_DEMO",
    ),
  );
  assert.equal(bill.body.governmentFees, "NOT_CONFIGURED_SEPARATE_ACCOUNTING");
});
test("FOR-02: repeatable family and conditional trade forms persist through the same engine", async () => {
  for (const no of [2, 42]) {
    const approved = await createApproved(no);
    const detail = (
      await request(
        "GET",
        `/applications/${approved.id}`,
        undefined,
        sessions["alpha:staff"],
      )
    ).body;
    assert.deepEqual(
      detail.payload,
      demoPayloads[no as keyof typeof demoPayloads],
    );
    assert.equal(detail.application.state, "APPROVED");
  }
});
test("FOR-03: malformed/oversize uploads rejected, valid files remain tenant private", async () => {
  const staff = sessions["alpha:staff"];
  assert.equal(
    (
      await request(
        "POST",
        "/attachments",
        {
          citizenId: citizen.id,
          mimeType: "application/pdf",
          base64: Buffer.from("Not a PDF at all").toString("base64"),
        },
        staff,
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await request(
        "POST",
        "/attachments",
        {
          citizenId: citizen.id,
          mimeType: "application/pdf",
          base64: Buffer.alloc(2097153).toString("base64"),
        },
        staff,
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await request(
        "POST",
        "/attachments",
        {
          citizenId: citizen.id,
          mimeType: "application/pdf",
          base64: Buffer.from("%PDF-1.7\nTruncated malformed PDF").toString(
            "base64",
          ),
        },
        staff,
      )
    ).status,
    422,
  );
  const data = fs.readFileSync("execution/demo-permanent-resident.pdf");
  const r = await request(
    "POST",
    "/attachments",
    {
      citizenId: citizen.id,
      mimeType: "application/pdf",
      base64: data.toString("base64"),
    },
    staff,
  );
  assert.equal(r.status, 201);
  assert.equal(r.body.scanState, "UNSCANNED");
  assert.equal(
    (await request("GET", `/attachments/${r.body.attachmentId}`)).status,
    401,
  );
  assert.equal(
    (
      await request(
        "GET",
        `/attachments/${r.body.attachmentId}`,
        undefined,
        sessions["beta:staff"],
      )
    ).status,
    404,
  );
});
test("AUTH-02: suspended membership and tenant invalidate existing sessions", async () => {
  const id = sessions["alpha:staff"].user.id;
  await admin.query(
    "UPDATE staff_memberships SET active=false WHERE user_id=$1",
    [id],
  );
  try {
    assert.equal(
      (await request("GET", "/citizens", undefined, sessions["alpha:staff"]))
        .status,
      401,
    );
  } finally {
    await admin.query(
      "UPDATE staff_memberships SET active=true WHERE user_id=$1",
      [id],
    );
  }
  const tenantId = sessions["beta:staff"].user.tenantId;
  await admin.query("UPDATE tenants SET status='SUSPENDED' WHERE id=$1", [
    tenantId,
  ]);
  try {
    assert.equal(
      (await request("GET", "/citizens", undefined, sessions["beta:staff"]))
        .status,
      401,
    );
  } finally {
    await admin.query("UPDATE tenants SET status='ACTIVE' WHERE id=$1", [
      tenantId,
    ]);
  }
});
test("WAL-06 / SEC-02: ledger/payload/audit immutability, balanced sum and tenant foreign keys", async () => {
  for (const table of [
    "credit_ledger",
    "application_payload_versions",
    "audit_events",
  ])
    await assert.rejects(
      admin.query(`UPDATE ${table} SET created_at=now() WHERE tenant_id=$1`, [
        sessions["alpha:staff"].user.tenantId,
      ]),
      /Append-only/,
    );
  const sum = await admin.query(
    "SELECT w.balance,coalesce(sum(l.delta),0)::int calculated FROM tenant_wallets w LEFT JOIN credit_ledger l ON l.tenant_id=w.tenant_id GROUP BY w.tenant_id,w.balance",
  );
  for (const row of sum.rows) assert.equal(row.balance, row.calculated);
  await assert.rejects(
    transaction(sessions["alpha:staff"].user.tenantId, (db) =>
      db.query(
        "UPDATE tenant_wallets SET balance=balance+100 WHERE tenant_id=$1",
        [sessions["alpha:staff"].user.tenantId],
      ),
    ),
    /permission denied/,
  );
  await assert.rejects(
    admin.query(
      "INSERT INTO applications(tenant_id,citizen_id,service_no,schema_version,schema_hash,created_by) VALUES($1,$2,45,1,$3,$4)",
      [
        sessions["beta:staff"].user.tenantId,
        citizen.id,
        "bad",
        sessions["beta:staff"].user.id,
      ],
    ),
    /foreign key/,
  );
  const noAuthority = sessions["alpha:approver"].user;
  await admin.query(
    "UPDATE approval_authorizations SET active=false WHERE tenant_id=$1 AND user_id=$2 AND service_no=45",
    [noAuthority.tenantId, noAuthority.id],
  );
  try {
    assert.equal(
      (
        await request(
          "POST",
          `/applications/${mainApp.id}/issue`,
          {},
          sessions["alpha:approver"],
        )
      ).status,
      403,
    );
  } finally {
    await admin.query(
      "UPDATE approval_authorizations SET active=true WHERE tenant_id=$1 AND user_id=$2 AND service_no=45",
      [noAuthority.tenantId, noAuthority.id],
    );
  }
  const before = (
    await admin.query("SELECT balance FROM tenant_wallets WHERE tenant_id=$1", [
      noAuthority.tenantId,
    ])
  ).rows[0].balance;
  await admin.query(
    "INSERT INTO credit_ledger(tenant_id,delta,kind,idempotency_key,actor_id,reason,balance_after) VALUES($1,20,'PLAN_GRANT','seed-demo-v1',$2,'Retry seed idempotency test',0) ON CONFLICT DO NOTHING",
    [noAuthority.tenantId, sessions.owner.user.id],
  );
  assert.equal(
    (
      await admin.query(
        "SELECT balance FROM tenant_wallets WHERE tenant_id=$1",
        [noAuthority.tenantId],
      )
    ).rows[0].balance,
    before,
  );
});

test("CER-01: current resident PDFs contain approved purpose/residency and genuine bn/en/bilingual content", async () => {
  const tenantId = sessions["alpha:staff"].user.tenantId;
  const tenantOffice = (
    await admin.query("SELECT name_bn,name_en FROM tenants WHERE id=$1", [
      tenantId,
    ])
  ).rows[0];
  const service = (
    await admin.query(
      "SELECT service_no,name_bn,name_en FROM service_catalog WHERE service_no=45",
    )
  ).rows[0];
  const expected = {
    residenceSince: "2012-04-05",
    residenceSinceBn: "২০১২-০৪-০৫",
    purposeBn: "ডেমো শিক্ষাবৃত্তির আবেদন",
    purposeEn: "Synthetic scholarship & study application",
    templates: [] as any[],
  };
  const priorBalance = (
    await request("GET", "/wallet", undefined, sessions["alpha:approver"])
  ).body.balance;
  for (const language of ["bn", "en", "bilingual"] as const) {
    const payload: Record<string, unknown> = {
      ...demoPayloads[45],
      residence_since: expected.residenceSince,
      purpose_bn: expected.purposeBn,
      purpose_en: expected.purposeEn,
      delivery_language: language,
    };
    const approved = await createApproved(45, payload);
    const issued = await request(
      "POST",
      `/applications/${approved.id}/issue`,
      {},
      sessions["alpha:approver"],
    );
    assert.equal(issued.status, 201, JSON.stringify(issued.body));
    assert.equal(issued.body.templateVersion, DEMO_TEMPLATE_VERSION);
    const document = await request(
      "GET",
      `/certificates/${issued.body.id}/pdf`,
      undefined,
      sessions["alpha:citizen"],
    );
    assert.equal(document.status, 200);
    assert.equal(document.body.subarray(0, 5).toString(), "%PDF-");
    assert.ok(document.body.length > 10000);
    assert.ok(document.body.toString("latin1").includes("/ToUnicode"));
    const stored = (
      await admin.query(
        "SELECT template_version,pdf FROM certificates WHERE id=$1",
        [issued.body.id],
      )
    ).rows[0];
    assert.equal(stored.template_version, DEMO_TEMPLATE_VERSION);
    assert.deepEqual(document.body, stored.pdf);
    const html = renderCertificateHtml(
      {
        number: issued.body.number,
        verificationUrl: issued.body.verificationUrl,
        tenant: tenantOffice,
        service,
        citizen: {
          full_name_bn: citizen.nameBn,
          full_name_en: citizen.nameEn,
          address_bn: citizen.addressBn,
          address_en: citizen.addressEn,
        },
        payload,
      },
      "data:image/png;base64,DEMO",
    );
    assert.ok(html.includes("DEMO / NOT OFFICIAL"));
    const body = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/)![1]!;
    assert.ok(html.includes(`data-delivery-language="${language}"`));
    if (language !== "en") {
      assert.ok(body.includes(citizen.nameBn));
      assert.ok(body.includes(payload.permanent_address_bn as string));
      assert.ok(body.includes(expected.residenceSinceBn));
      assert.ok(body.includes(expected.purposeBn));
      assert.ok(body.includes('data-language="bn"'));
    } else {
      assert.ok(!body.includes(citizen.nameBn));
      assert.ok(!body.includes(expected.purposeBn));
      assert.ok(!body.includes('data-language="bn"'));
    }
    if (language !== "bn") {
      assert.ok(body.includes(citizen.nameEn));
      assert.ok(body.includes(payload.permanent_address_en as string));
      assert.ok(body.includes(expected.residenceSince));
      assert.ok(
        body.includes("Synthetic scholarship &amp; study application"),
        "Approved text is escaped for HTML but retains its value in the PDF",
      );
      assert.ok(body.includes('data-language="en"'));
    } else {
      assert.ok(!body.includes(citizen.nameEn));
      assert.ok(!body.includes("Synthetic scholarship"));
      assert.ok(!body.includes('data-language="en"'));
    }
    const artifact = `execution/resident-${language}-demo.pdf`;
    fs.writeFileSync(artifact, document.body);
    expected.templates.push({
      language,
      artifact,
      certificateId: issued.body.id,
      applicationId: approved.id,
      templateVersion: issued.body.templateVersion,
    });
  }
  assert.equal(
    (await request("GET", "/wallet", undefined, sessions["alpha:approver"]))
      .body.balance,
    priorBalance - 3,
  );
  fs.writeFileSync(
    "execution/resident-language-case.json",
    JSON.stringify(expected, null, 2),
  );
});
