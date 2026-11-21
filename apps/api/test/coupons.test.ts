import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { getDemoPayload } from "@astra/shared-schemas";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";

const db = new pg.Pool({ connectionString: adminConnectionString });
// Test-only credentials are generated per run so no password-like literal sits in the repository.
const password = randomBytes(12).toString("base64url");
const run = randomUUID().slice(0, 8);
const slug = `coupon-${run}`;
let server: ReturnType<typeof app.listen>, base: string, tenantId: string, citizenId: string;
type Session = { cookie: string; csrf: string };
const s: Record<string, Session> = {};
async function req(method: string, path: string, data?: unknown, session?: Session) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      ...(session ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return { status: response.status, body: await response.json() };
}
async function login(name: string, email: string, secret: string) {
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: secret }),
  });
  const json = await r.json();
  assert.equal(r.status, 200, JSON.stringify(json));
  s[name] = { cookie: r.headers.get("set-cookie")!.split(";")[0], csrf: json.csrfToken };
}
const preferences = {
  addressBasis: "registered_profile",
  certificateLanguage: "bn",
  deliveryMode: "office_collection",
  urgency: "normal",
};
// Gross for these preferences: 10001 + 2502 + 0 (normal) + 204 (office collection) = 12707 minor units.
const policy = {
  expectedVersion: 0,
  reason: "Synthetic tariff for the coupon test; not a government tariff",
  statutoryFeeMinor: 10001,
  processingFeeMinor: 2502,
  emergencySurchargeMinor: 1503,
  deliveryFeesMinor: { office_collection: 204, digital_copy: 105 },
  deliveryModes: ["office_collection", "digital_copy"],
  urgencies: ["normal", "urgent"],
};
async function apply(couponCode?: string) {
  return req(
    "POST",
    "/applications",
    {
      citizenId,
      serviceNo: 45,
      payload: { ...getDemoPayload(45), delivery_language: "bn" },
      order: { policyVersion: 1, preferences, ...(couponCode ? { couponCode } : {}) },
    },
    s.admin,
  );
}

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  await login("owner", "owner@astra.demo.test", "Demo-Phase1!");
  const office = await req(
    "POST",
    "/owner/tenants",
    {
      slug,
      nameBn: "কুপন পরীক্ষা অফিস",
      nameEn: "Synthetic coupon office",
      division: "Test Division",
      district: "Test District",
      upazila: "Test Upazila",
      officeType: "UNION",
      adminEmail: `admin@${slug}.test`,
      adminName: "Synthetic coupon admin",
      adminPassword: password,
    },
    s.owner,
  );
  assert.equal(office.status, 201, JSON.stringify(office.body));
  tenantId = (await db.query("SELECT id FROM tenants WHERE slug=$1", [slug])).rows[0].id;
  await login("admin", `admin@${slug}.test`, password);
  assert.equal((await req("POST", "/admin/services/45/order-policies", policy, s.admin)).status, 201);
  const citizen = await req(
    "POST",
    "/citizens",
    {
      nameBn: "কুপন নাগরিক",
      nameEn: "Coupon Citizen",
      dateOfBirth: "1991-01-01",
      addressBn: "নমুনা গ্রাম ঠিকানা",
      addressEn: "Synthetic village address",
    },
    s.admin,
  );
  assert.equal(citizen.status, 201, JSON.stringify(citizen.body));
  citizenId = citizen.body.id;
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await db.end();
});

test("Phase 4b: the office admin creates coupons; bad input, duplicates and other roles are refused", async () => {
  const created = await req(
    "POST",
    "/admin/coupons",
    { code: "Pct10", discountKind: "percent", discountValue: 10, serviceNos: [45], maxRedemptions: 1 },
    s.admin,
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.code, "PCT10", "codes are stored upper-case");
  for (const bad of [
    { code: "AB", discountKind: "percent", discountValue: 10 },
    { code: "BIG", discountKind: "percent", discountValue: 101 },
    { code: "ZERO", discountKind: "fixed", discountValue: 0 },
    { code: "BADSVC", discountKind: "fixed", discountValue: 100, serviceNos: [48] },
    { code: "WINDOW", discountKind: "fixed", discountValue: 100, validFrom: "2026-02-01T00:00:00Z", validUntil: "2026-01-01T00:00:00Z" },
  ])
    assert.equal((await req("POST", "/admin/coupons", bad, s.admin)).status, 422, JSON.stringify(bad));
  assert.equal(
    (await req("POST", "/admin/coupons", { code: "pct10", discountKind: "fixed", discountValue: 1 }, s.admin)).status,
    409,
  );
  for (const [code, kind, value, extra] of [
    ["FIX5", "fixed", 500, {}],
    ["ALLFREE", "fixed", 100000000, {}],
    ["OTHERSVC", "percent", 50, { serviceNos: [44] }],
    ["OFF", "percent", 20, {}],
    ["LATER", "percent", 20, { validFrom: "2099-01-01T00:00:00Z" }],
  ] as const)
    assert.equal(
      (await req("POST", "/admin/coupons", { code, discountKind: kind, discountValue: value, ...extra }, s.admin)).status,
      201,
    );
  assert.equal((await req("PATCH", "/admin/coupons/OFF", { active: false }, s.admin)).body.active, false);
  assert.equal((await req("POST", "/admin/coupons", { code: "OWNER", discountKind: "fixed", discountValue: 1 }, s.owner)).status, 403);
});

test("Phase 4b: a coupon reduces the quote and the stored order, and respects service, dates, status and limit", async () => {
  const quote = await req("POST", "/services/45/order-quote", { preferences, couponCode: "pct10" }, s.admin);
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  assert.equal(quote.body.grossMinor, 12707);
  assert.equal(quote.body.discountMinor, 1270, "10% rounded down to whole poisha");
  assert.equal(quote.body.totalMinor, 11437);
  assert.deepEqual(quote.body.components.at(-1), { code: "coupon_discount", amountMinor: -1270 });

  for (const code of ["OTHERSVC", "OFF", "LATER", "NOSUCH"]) {
    const r = await req("POST", "/services/45/order-quote", { preferences, couponCode: code }, s.admin);
    assert.equal(r.status, 422, code);
    assert.equal(r.body.error.code, "COUPON_INVALID");
  }

  const first = await apply("PCT10");
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const detail = await req("GET", `/applications/${first.body.id}`, undefined, s.admin);
  assert.equal(detail.body.order.couponCode, "PCT10");
  assert.equal(detail.body.order.discountMinor, 1270);
  assert.equal(detail.body.order.totalMinor, 11437);
  const redemptions = await db.query("SELECT discount_minor FROM coupon_redemptions WHERE tenant_id=$1 AND code='PCT10'", [
    tenantId,
  ]);
  assert.deepEqual(redemptions.rows, [{ discount_minor: 1270 }]);

  // The limit of one redemption is used up; the application is not created.
  const second = await apply("PCT10");
  assert.equal(second.status, 422, JSON.stringify(second.body));
  assert.equal(second.body.error.code, "COUPON_INVALID");
  const listed = (await req("GET", "/admin/coupons", undefined, s.admin)).body.items.find((c: any) => c.code === "PCT10");
  assert.equal(listed.redemptions, 1);

  // A fixed coupon above the total brings it to zero: no payment is needed.
  const free = await apply("ALLFREE");
  assert.equal(free.status, 201, JSON.stringify(free.body));
  const freeOrder = (await req("GET", `/applications/${free.body.id}`, undefined, s.admin)).body.order;
  assert.equal(freeOrder.totalMinor, 0);
  assert.equal(freeOrder.discountMinor, 12707);
  // Without a coupon nothing changes.
  const plain = await apply();
  assert.equal(plain.status, 201);
  const plainOrder = (await req("GET", `/applications/${plain.body.id}`, undefined, s.admin)).body.order;
  assert.equal(plainOrder.totalMinor, 12707);
  assert.equal(plainOrder.couponCode, null);
});

test("Phase 4b: the database recomputes every discount and keeps redemptions append-only", async () => {
  const value = async (code: string, base: number) =>
    (await db.query("SELECT coupon_discount($1,$2,45,$3) d", [tenantId, code, base])).rows[0].d;
  assert.equal(await value("FIX5", 12707), 500);
  assert.equal(await value("FIX5", 300), 300, "a fixed discount never exceeds the amount");
  assert.equal(await value("OFF", 12707), null, "disabled");
  assert.equal(await value("PCT10", 12707), null, "limit reached");
  await assert.rejects(
    db.query("UPDATE coupon_redemptions SET discount_minor=0 WHERE tenant_id=$1", [tenantId]),
    /Append-only/,
  );
  await assert.rejects(
    db.query("UPDATE application_order_snapshots SET discount_minor=1 WHERE tenant_id=$1", [tenantId]),
    /Append-only/,
  );
});
