import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { getDemoPayload } from "@astra/shared-schemas";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";

// The cancelled-order webhook refusal is exercised through the sandbox
// demo-settle route, which is off unless explicitly enabled (see payments.test.ts).
process.env.DEMO_SETTLE_ENABLED = "true";

type Session = { cookie: string; csrf: string; user: any };
const sessions: Record<string, Session> = {};
const run = randomUUID().slice(0, 8);
const adminPassword = "Phase3a-Test!Pass";
const admin = new pg.Pool({ connectionString: adminConnectionString });
let server: ReturnType<typeof app.listen>, base: string;
let officeA: any, officeB: any, alphaId: string;

async function req(
  method: string,
  path: string,
  data?: unknown,
  session?: Session,
) {
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
  const type = response.headers.get("content-type") ?? "";
  return {
    status: response.status,
    body: type.includes("json") ? await response.json() : null,
  };
}
async function login(name: string, email: string, password = "Demo-Phase1!") {
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = await r.json();
  assert.equal(r.status, 200, JSON.stringify(json));
  const cookieHeader = r.headers.get(["set", "cookie"].join("-"));
  assert.ok(cookieHeader, "login must return a session cookie");
  sessions[name] = {
    cookie: cookieHeader.split(";")[0],
    csrf: json.csrfToken,
    user: json.user,
  };
}
async function createOffice(slug: string, extra: object = {}) {
  const r = await req(
    "POST",
    "/owner/tenants",
    {
      slug,
      nameBn: "পরীক্ষা অফিস",
      nameEn: `Phase 3A test office ${slug}`,
      division: "Test Division",
      district: "Test District",
      upazila: "Test Upazila",
      officeType: "UNION",
      adminEmail: `admin@${slug}.test`,
      adminName: "Phase 3A Admin",
      adminPassword,
      ...extra,
    },
    sessions.owner,
  );
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
async function ownerTenants() {
  const r = await req("GET", "/owner/tenants", undefined, sessions.owner);
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
async function auditActions(tenantId: string, action: string) {
  return (
    await admin.query(
      "SELECT actor_id, metadata FROM audit_events WHERE tenant_id=$1 AND action=$2 ORDER BY created_at",
      [tenantId, action],
    )
  ).rows;
}
const dayMs = 86_400_000;
const daysBetween = (a: any, b: any) =>
  (new Date(b).getTime() - new Date(a).getTime()) / dayMs;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  await login("owner", "owner@astra.demo.test");
  for (const role of ["admin", "staff", "approver", "citizen"])
    await login(role, `${role}@alpha.local.test`);
  alphaId = (await admin.query("SELECT id FROM tenants WHERE slug='alpha'"))
    .rows[0].id;
  officeA = await createOffice(`sub3a-a-${run}`);
  officeB = await createOffice(`sub3a-b-${run}`, {
    activateSubscription: { planId: "standard-monthly", grantCredits: true },
  });
  await login("officeAAdmin", `admin@sub3a-a-${run}.test`, adminPassword);
});
after(async () => {
  // Leave the shared alpha office exactly as the seed made it: ACTIVE.
  try {
    const sub = await subscriptionOf(alphaId);
    if (sub && sub.status !== "ACTIVE")
      await req(
        "POST",
        `/owner/tenants/${alphaId}/subscription`,
        {
          action: "activate",
          grantCredits: false,
          reason: "Restore alpha after Phase 3A tests",
        },
        sessions.owner,
      );
  } finally {
    await closePdfBrowser();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
    await admin.end();
  }
});

test("Phase 3A: office created without activation starts EXPIRED with an empty wallet; with activation it starts ACTIVE with plan credits", async () => {
  const subA = await subscriptionOf(officeA.id);
  assert.equal(subA.status, "EXPIRED");
  assert.equal(await walletOf(officeA.id), 0);
  const subB = await subscriptionOf(officeB.id);
  assert.equal(subB.status, "ACTIVE");
  assert.equal(subB.planId, "standard-monthly");
  assert.ok(daysBetween(new Date(), subB.validUntil) > 29);
  assert.equal(await walletOf(officeB.id), 20);
  const audits = await auditActions(officeB.id, "SUBSCRIPTION_ACTIVATED");
  assert.equal(audits.length, 1);
  assert.equal(
    audits[0].metadata.reason,
    "Subscription activated on office approval",
  );
  assert.equal(audits[0].metadata.after.status, "ACTIVE");
});

test("Phase 3A: only the owner may change subscriptions or decide payment orders", async () => {
  for (const who of ["admin", "staff", "approver", "citizen"]) {
    assert.equal(
      (
        await req(
          "POST",
          `/owner/tenants/${officeA.id}/subscription`,
          { action: "suspend", reason: "Not the platform owner" },
          sessions[who],
        )
      ).status,
      403,
      who,
    );
    assert.equal(
      (await req("GET", "/owner/payment-orders", undefined, sessions[who]))
        .status,
      403,
      who,
    );
    assert.equal(
      (
        await req(
          "POST",
          `/owner/payment-orders/${randomUUID()}/settle`,
          { reason: "Not the platform owner" },
          sessions[who],
        )
      ).status,
      403,
      who,
    );
  }
  assert.equal(
    (await req("GET", "/owner/payment-orders", undefined, undefined)).status,
    401,
  );
});

test("Phase 3A: reason and action validation — no silent subscription changes", async () => {
  const url = `/owner/tenants/${officeA.id}/subscription`;
  for (const bad of [
    { action: "activate" },
    { action: "activate", reason: "short" },
    { action: "explode", reason: "A long enough reason" },
    { action: "change_plan", reason: "A long enough reason" },
    { action: "set_expiry", reason: "A long enough reason" },
    { action: "activate", reason: "A long enough reason", days: 0 },
    { action: "activate", reason: "A long enough reason", extra: true },
  ])
    assert.equal(
      (await req("POST", url, bad, sessions.owner)).status,
      422,
      JSON.stringify(bad),
    );
  assert.equal(
    (
      await req(
        "POST",
        `/owner/tenants/${randomUUID()}/subscription`,
        { action: "activate", reason: "A long enough reason" },
        sessions.owner,
      )
    ).status,
    404,
  );
  // Nothing was written by the rejected calls.
  assert.equal((await subscriptionOf(officeA.id)).status, "EXPIRED");
  assert.equal(
    (await auditActions(officeA.id, "SUBSCRIPTION_ACTIVATED")).length,
    0,
  );
});

test("Phase 3A: activate extends from now by the plan duration, grants plan credits once, and audits before/after", async () => {
  const before = await subscriptionOf(officeA.id);
  const r = await req(
    "POST",
    `/owner/tenants/${officeA.id}/subscription`,
    { action: "activate", reason: "Office verified by the owner" },
    sessions.owner,
  );
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.subscription.status, "ACTIVE");
  assert.equal(r.body.previous.status, before.status);
  assert.equal(r.body.creditsGranted, 20);
  const days = daysBetween(new Date(), r.body.subscription.validUntil);
  assert.ok(days > 29 && days <= 30, `expected ~30 days, got ${days}`);
  assert.equal(await walletOf(officeA.id), 20);
  const audits = await auditActions(officeA.id, "SUBSCRIPTION_ACTIVATED");
  assert.equal(audits.length, 1);
  assert.equal(audits[0].metadata.before.status, "EXPIRED");
  assert.equal(audits[0].metadata.after.status, "ACTIVE");
  assert.equal(audits[0].metadata.reason, "Office verified by the owner");
  assert.equal(audits[0].metadata.creditsGranted, 20);
  assert.equal(audits[0].actor_id, sessions.owner.user.id);
});

test("Phase 3A: extend maths — past expiry extends from now, future expiry extends from valid_until; set_expiry and change_plan behave", async () => {
  const url = `/owner/tenants/${officeA.id}/subscription`;
  // Force a past expiry, then extend: the new expiry must be ~10 days from now.
  let r = await req(
    "POST",
    url,
    {
      action: "set_expiry",
      validUntil: new Date(Date.now() - 5 * dayMs).toISOString(),
      reason: "Backdating to test extend maths",
    },
    sessions.owner,
  );
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.subscription.status, "EXPIRED");
  r = await req(
    "POST",
    url,
    { action: "extend", days: 10, reason: "Extending after a lapse" },
    sessions.owner,
  );
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.subscription.status, "ACTIVE");
  const fromNow = daysBetween(new Date(), r.body.subscription.validUntil);
  assert.ok(fromNow > 9 && fromNow <= 10, `expected ~10 days, got ${fromNow}`);
  // Future expiry: extend must add to valid_until, not to now.
  const future = new Date(Date.now() + 40 * dayMs).toISOString();
  r = await req(
    "POST",
    url,
    { action: "set_expiry", validUntil: future, reason: "Setting a known future expiry" },
    sessions.owner,
  );
  assert.equal(r.status, 201, JSON.stringify(r.body));
  r = await req(
    "POST",
    url,
    { action: "extend", days: 10, reason: "Extending a live subscription" },
    sessions.owner,
  );
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const added = daysBetween(future, r.body.subscription.validUntil);
  assert.ok(added > 9.9 && added < 10.1, `expected +10 days, got ${added}`);
  // Change of plan without a credit grant leaves the wallet alone.
  const balance = await walletOf(officeA.id);
  r = await req(
    "POST",
    url,
    {
      action: "change_plan",
      planId: "standard-monthly",
      reason: "Correcting the plan assignment",
    },
    sessions.owner,
  );
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.subscription.planId, "standard-monthly");
  assert.equal(r.body.creditsGranted, 0);
  assert.equal(await walletOf(officeA.id), balance);
  assert.equal(
    (await auditActions(officeA.id, "SUBSCRIPTION_EXTENDED")).length,
    2,
  );
  assert.equal(
    (await auditActions(officeA.id, "SUBSCRIPTION_EXPIRY_SET")).length,
    2,
  );
  assert.equal(
    (await auditActions(officeA.id, "SUBSCRIPTION_PLAN_CHANGED")).length,
    1,
  );
});

test("Phase 3B: suspend no longer blocks issuance — the fee moved to submit", async () => {
  // Alpha is subscribed at seed, so this submit is covered by the plan
  // (Phase 3B allowance) and charges the wallet nothing.
  const citizenId = (await req("GET", "/citizens", undefined, sessions.citizen))
    .body.items[0].id;
  const created = await req(
    "POST",
    "/applications",
    {
      citizenId,
      serviceNo: 45,
      payload: { ...getDemoPayload(45), delivery_language: "bn" },
    },
    sessions.staff,
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const submitted = await req(
    "POST",
    `/applications/${created.body.id}/transition`,
    { action: "submit" },
    sessions.staff,
  );
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  // Suspend alpha's subscription. Until Phase 3B this made the chairman's
  // approve fail 402 SUBSCRIPTION_INACTIVE; issuance takes no money and
  // requires no subscription now, so the suspension changes nothing here.
  const suspended = await req(
    "POST",
    `/owner/tenants/${alphaId}/subscription`,
    { action: "suspend", reason: "Gate test: pausing issuance" },
    sessions.owner,
  );
  assert.equal(suspended.status, 201, JSON.stringify(suspended.body));
  const balanceBefore = await walletOf(alphaId);
  const approval = await req(
    "POST",
    `/applications/${created.body.id}/transition`,
    { action: "approve" },
    sessions.approver,
  );
  assert.equal(approval.status, 200, JSON.stringify(approval.body));
  assert.ok(approval.body.certificate?.number, "certificate issued while suspended");
  // The completion path returns the same certificate and still deducts nothing.
  const issue = await req(
    "POST",
    `/applications/${created.body.id}/issue`,
    {},
    sessions.approver,
  );
  assert.ok([200, 201].includes(issue.status), JSON.stringify(issue.body));
  assert.equal(issue.body.number, approval.body.certificate.number);
  assert.equal(await walletOf(alphaId), balanceBefore);
  // Reactivate without a credit grant, restoring alpha for the other suites.
  const reactivated = await req(
    "POST",
    `/owner/tenants/${alphaId}/subscription`,
    {
      action: "activate",
      grantCredits: false,
      reason: "Gate test: resuming issuance",
    },
    sessions.owner,
  );
  assert.equal(reactivated.status, 201, JSON.stringify(reactivated.body));
  assert.equal(reactivated.body.creditsGranted, 0);
});

test("Phase 3A: manual settle of a pending subscription order activates and grants exactly once", async () => {
  // Office A creates a subscription order (its admin is finance-capable for billing).
  const order = await req(
    "POST",
    "/billing/orders",
    { kind: "subscription", planId: "standard-monthly" },
    sessions.officeAAdmin,
  );
  assert.equal(order.status, 201, JSON.stringify(order.body));
  const pending = await req(
    "GET",
    "/owner/payment-orders?status=PENDING",
    undefined,
    sessions.owner,
  );
  const listed = pending.body.items.find((o: any) => o.id === order.body.id);
  assert.ok(listed, "order appears in the owner pending list");
  assert.equal(listed.tenantId, officeA.id);
  const balanceBefore = await walletOf(officeA.id);
  const subBefore = await subscriptionOf(officeA.id);
  const settled = await req(
    "POST",
    `/owner/payment-orders/${order.body.id}/settle`,
    { reason: "Cash received at the office counter" },
    sessions.owner,
  );
  assert.equal(settled.status, 200, JSON.stringify(settled.body));
  assert.deepEqual(
    { settled: settled.body.settled, replayed: settled.body.replayed },
    { settled: true, replayed: false },
  );
  // Same effects as the webhook: +20 plan credits, ACTIVE, extended by the plan duration.
  assert.equal(await walletOf(officeA.id), balanceBefore + 20);
  const subAfter = await subscriptionOf(officeA.id);
  assert.equal(subAfter.status, "ACTIVE");
  assert.ok(
    daysBetween(subBefore.validUntil, subAfter.validUntil) > 29.9,
    "valid_until extended by the plan duration",
  );
  const events = await admin.query(
    "SELECT * FROM payment_events WHERE event_id=$1",
    [`manual:${order.body.id}`],
  );
  assert.equal(events.rows.length, 1);
  const audits = await auditActions(officeA.id, "PAYMENT_ORDER_MANUALLY_SETTLED");
  assert.equal(audits.length, 1);
  assert.equal(audits[0].actor_id, sessions.owner.user.id);
  assert.equal(audits[0].metadata.reason, "Cash received at the office counter");
  // A second settle replays: no extra credits, no second ledger entry.
  const again = await req(
    "POST",
    `/owner/payment-orders/${order.body.id}/settle`,
    { reason: "Duplicate settle attempt" },
    sessions.owner,
  );
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.replayed, true);
  assert.equal(await walletOf(officeA.id), balanceBefore + 20);
  const ledger = await admin.query(
    "SELECT count(*)::int AS n FROM credit_ledger WHERE tenant_id=$1 AND idempotency_key=$2",
    [officeA.id, `payment:${order.body.id}`],
  );
  assert.equal(ledger.rows[0].n, 1);
  // And the order now reads SETTLED to the office.
  const billing = await req("GET", "/billing", undefined, sessions.officeAAdmin);
  assert.equal(
    billing.body.orders.find((o: any) => o.id === order.body.id).status,
    "SETTLED",
  );
});

test("Phase 3A: manual settle of a topup order grants credits without touching the subscription", async () => {
  const order = await req(
    "POST",
    "/billing/orders",
    { kind: "topup", credits: 7 },
    sessions.officeAAdmin,
  );
  assert.equal(order.status, 201, JSON.stringify(order.body));
  const balanceBefore = await walletOf(officeA.id);
  const subBefore = await subscriptionOf(officeA.id);
  const settled = await req(
    "POST",
    `/owner/payment-orders/${order.body.id}/settle`,
    { reason: "Top-up confirmed by bank transfer" },
    sessions.owner,
  );
  assert.equal(settled.status, 200, JSON.stringify(settled.body));
  assert.equal(await walletOf(officeA.id), balanceBefore + 7);
  const subAfter = await subscriptionOf(officeA.id);
  assert.equal(subAfter.status, subBefore.status);
  assert.equal(subAfter.validUntil, subBefore.validUntil);
});

test("Phase 3A: cancel leaves state untouched, blocks later settlement everywhere, and replays safely", async () => {
  const order = await req(
    "POST",
    "/billing/orders",
    { kind: "subscription", planId: "standard-monthly" },
    sessions.officeAAdmin,
  );
  assert.equal(order.status, 201, JSON.stringify(order.body));
  const balanceBefore = await walletOf(officeA.id);
  const subBefore = await subscriptionOf(officeA.id);
  const cancelled = await req(
    "POST",
    `/owner/payment-orders/${order.body.id}/cancel`,
    { reason: "Office withdrew the renewal request" },
    sessions.owner,
  );
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.deepEqual(
    { cancelled: cancelled.body.cancelled, replayed: cancelled.body.replayed },
    { cancelled: true, replayed: false },
  );
  assert.equal(await walletOf(officeA.id), balanceBefore);
  const subAfter = await subscriptionOf(officeA.id);
  assert.equal(subAfter.status, subBefore.status);
  assert.equal(subAfter.validUntil, subBefore.validUntil);
  const audits = await auditActions(officeA.id, "PAYMENT_ORDER_CANCELLED");
  assert.equal(audits.length, 1);
  assert.equal(audits[0].metadata.reason, "Office withdrew the renewal request");
  // Owner settle of a cancelled order is refused.
  const settleAfter = await req(
    "POST",
    `/owner/payment-orders/${order.body.id}/settle`,
    { reason: "Trying to settle a cancelled order" },
    sessions.owner,
  );
  assert.equal(settleAfter.status, 409, JSON.stringify(settleAfter.body));
  assert.equal(settleAfter.body.error.code, "ORDER_CANCELLED");
  // The gateway path refuses it too (via the sandbox settle route).
  const demoSettle = await req(
    "POST",
    `/billing/orders/${order.body.id}/demo-settle`,
    {},
    sessions.officeAAdmin,
  );
  assert.equal(demoSettle.status, 409, JSON.stringify(demoSettle.body));
  assert.equal(demoSettle.body.error.code, "ORDER_CANCELLED");
  // Cancel replays; cancelling a settled order conflicts.
  const again = await req(
    "POST",
    `/owner/payment-orders/${order.body.id}/cancel`,
    { reason: "Cancelling the same order twice" },
    sessions.owner,
  );
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.replayed, true);
  const settledOrder = await req(
    "POST",
    "/billing/orders",
    { kind: "topup", credits: 1 },
    sessions.officeAAdmin,
  );
  await req(
    "POST",
    `/owner/payment-orders/${settledOrder.body.id}/settle`,
    { reason: "Settling before the cancel attempt" },
    sessions.owner,
  );
  const cancelSettled = await req(
    "POST",
    `/owner/payment-orders/${settledOrder.body.id}/cancel`,
    { reason: "Trying to cancel a settled order" },
    sessions.owner,
  );
  assert.equal(cancelSettled.status, 409, JSON.stringify(cancelSettled.body));
  assert.equal(cancelSettled.body.error.code, "ORDER_ALREADY_SETTLED");
  // Unknown orders 404 for both decisions, and short reasons 422.
  for (const decision of ["settle", "cancel"]) {
    assert.equal(
      (
        await req(
          "POST",
          `/owner/payment-orders/${randomUUID()}/${decision}`,
          { reason: "No such order exists anywhere" },
          sessions.owner,
        )
      ).status,
      404,
      decision,
    );
    assert.equal(
      (
        await req(
          "POST",
          `/owner/payment-orders/${order.body.id}/${decision}`,
          { reason: "short" },
          sessions.owner,
        )
      ).status,
      422,
      decision,
    );
  }
});
