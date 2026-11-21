import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";

/**
 * Phase 3E: the citizen registration gate (§3.6), the owner coupon system (§3.7)
 * and global notices (§3.8).
 *
 * Gate: a signup that claims a union succeeds only when an ACTIVE office serves
 * that union; an unlisted union is refused 422 UNION_NOT_LISTED with the plan's
 * bilingual message and creates nothing. Signups without geography are the
 * legacy path and stay untouched.
 *
 * Coupons: per the plan doc the application point is the subscription purchase /
 * credit top-up ORDER — the discount is taken at order creation, amount_minor
 * becomes the net payable amount, and the redemption is recorded on the order.
 * (The brief's "charge at final submit" reading is the application-fee charge of
 * §3.2, which takes no citizen-supplied code anywhere in the product; §3.7 names
 * orders and order recording explicitly, so the doc governs.)
 *
 * Notices: owner-published portal-wide notices appear on the public read only
 * while published and inside their window; unpublishing removes them at once.
 */
type Session = { cookie: string; csrf: string; user: any };
const run = randomUUID().slice(0, 8);
const RUN = run.toUpperCase();
const password = "Phase3e-Synth-123!";
const admin = new pg.Pool({ connectionString: adminConnectionString });
let server: ReturnType<typeof app.listen>, base: string;
const owner: { current?: Session } = {};
type Office = { tenant: any; admin: Session };
let officeA: Office, officeB: Office, mappedOffice: Office;
const PLAN = `p3e-plan-${run}`;
const PLAN2 = `p3e-plan2-${run}`;
const REASON = "Phase 3E synthetic test change";
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

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
async function buildOffice(slug: string, geography?: Record<string, string>): Promise<Office> {
  const created = await req(
    "POST",
    "/owner/tenants",
    {
      slug,
      nameBn: "পরীক্ষা অফিস",
      nameEn: `Phase 3E test office ${slug}`,
      ...(geography
        ? { geography }
        : { division: "Test Division", district: "Test District", upazila: "Test Upazila" }),
      officeType: "UNION",
      adminEmail: `admin@${slug}.test`,
      adminName: "Phase 3E Admin",
      adminPassword: password,
    },
    owner.current,
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return { tenant: created.body, admin: await login(`admin@${slug}.test`) };
}
async function createCoupon(body: Record<string, unknown>, session?: Session) {
  return req("POST", "/owner/coupons", body, session ?? owner.current);
}
function couponBody(overrides: Record<string, unknown> = {}) {
  return {
    discountKind: "percent",
    discountValue: 10,
    appliesTo: "both",
    planId: null,
    validFrom: iso(-3600_000),
    validUntil: null,
    maxUses: null,
    perOfficeLimit: null,
    visibility: "hidden",
    active: true,
    reason: REASON,
    ...overrides,
  };
}
async function order(office: Office, body: Record<string, unknown>) {
  return req("POST", "/billing/orders", body, office.admin);
}
async function signup(email: string, tenantId: string, geography?: Record<string, string>) {
  return req("POST", "/auth/signup", {
    email,
    password,
    displayName: "Phase 3E Citizen",
    tenantId,
    nameBn: "পরীক্ষা নাগরিক",
    nameEn: "Phase 3E Citizen",
    dateOfBirth: "1997-05-06",
    addressBn: "পরীক্ষা ঠিকানা",
    addressEn: "Test address only",
    ...(geography ? { geography } : {}),
  });
}

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  owner.current = await login("owner@astra.demo.test", "Demo-Phase1!");
  officeA = await buildOffice(`p3e-a-${run}`);
  officeB = await buildOffice(`p3e-b-${run}`);
  // A mapped office serving union uni-0001 (Debidwar, Cumilla) — the listed union.
  mappedOffice = await buildOffice(`p3e-mapped-${run}`, {
    divisionCode: "div-02",
    districtCode: "dis-19",
    upazilaCode: "upa-089",
    unionCode: "uni-0001",
  });
  for (const [id, priceMinor] of [
    [PLAN, 100_000],
    [PLAN2, 33_333],
  ] as const) {
    const plan = await req(
      "POST",
      "/owner/plans",
      {
        id,
        name: `Phase 3E plan ${id}`,
        durationDays: 30,
        priceMinor,
        grantCredits: 10,
        monthlyAllowanceLimit: null,
        onSale: true,
        sortOrder: 90,
        rollover: true,
        reason: REASON,
      },
      owner.current,
    );
    assert.equal(plan.status, 201, JSON.stringify(plan.body));
  }
});
after(async () => {
  await closePdfBrowser();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await admin.end();
  await pool.end();
});

test("Phase 3E gate: an unlisted union cannot register; a listed one can, from any office", async () => {
  // A union in the same upazila that no active office serves.
  const unlisted = (
    await admin.query(
      `SELECT u.code FROM geo_unions u WHERE u.parent_code='upa-089' AND u.code <> 'uni-0001'
       AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t.status='ACTIVE' AND t.division_code='div-02'
         AND t.district_code='dis-19' AND t.upazila_code='upa-089' AND (t.union_code=u.code OR t.union_code IS NULL))
       ORDER BY u.code LIMIT 1`,
    )
  ).rows[0];
  assert.ok(unlisted, "the dataset must hold an unlisted union in upa-089");
  const wardOf = async (unionCode: string) =>
    (await admin.query("SELECT code FROM geo_wards WHERE parent_code=$1 ORDER BY code LIMIT 1", [unionCode]))
      .rows[0].code as string;
  const geoFor = async (unionCode: string) => ({
    divisionCode: "div-02",
    districtCode: "dis-19",
    upazilaCode: "upa-089",
    unionCode,
    wardCode: await wardOf(unionCode),
  });

  const blockedEmail = `gate-blocked-${run}@synthetic.test`;
  const blocked = await signup(blockedEmail, officeA.tenant.id, await geoFor(unlisted.code));
  assert.equal(blocked.status, 422, JSON.stringify(blocked.body));
  assert.equal(blocked.body.error.code, "UNION_NOT_LISTED");
  assert.match(blocked.body.error.message, /এই ইউনিয়ন এখনো DigitalUnion-এ যুক্ত হয়নি/);
  assert.match(blocked.body.error.message, /This union has not joined DigitalUnion yet/);
  const created = await admin.query("SELECT count(*)::int AS n FROM platform_users WHERE email=$1", [blockedEmail]);
  assert.equal(created.rows[0].n, 0, "a blocked signup creates no account");

  // The same claim under the mapped office itself is refused too — the gate is
  // about the union being listed, not about which office form is used.
  const blockedAtMapped = await signup(`gate-blocked2-${run}@synthetic.test`, mappedOffice.tenant.id, await geoFor(unlisted.code));
  assert.equal(blockedAtMapped.status, 400, JSON.stringify(blockedAtMapped.body));
  assert.equal(blockedAtMapped.body.error.code, "GEOGRAPHY_OFFICE_MISMATCH");

  // Listed union: registration succeeds under the mapped office…
  const listed = await geoFor("uni-0001");
  const atMapped = await signup(`gate-listed-${run}@synthetic.test`, mappedOffice.tenant.id, listed);
  assert.equal(atMapped.status, 201, JSON.stringify(atMapped.body));
  // …and under any other office, because the union is listed platform-wide.
  const atLegacy = await signup(`gate-listed2-${run}@synthetic.test`, officeA.tenant.id, listed);
  assert.equal(atLegacy.status, 201, JSON.stringify(atLegacy.body));
  // No geography at all: the legacy path is unchanged.
  const noGeo = await signup(`gate-nogeo-${run}@synthetic.test`, officeA.tenant.id);
  assert.equal(noGeo.status, 201, JSON.stringify(noGeo.body));
});

test("Phase 3E coupons: owner-only management, validation and audit history", async () => {
  assert.equal((await req("GET", "/owner/coupons")).status, 401);
  assert.equal((await req("GET", "/owner/coupons", undefined, officeA.admin)).status, 403);
  assert.equal((await createCoupon(couponBody({ code: `P3E-AUTH-${RUN}` }), officeA.admin)).status, 403);

  const shortReason = await createCoupon(couponBody({ code: `P3E-BAD-${RUN}`, reason: "short" }));
  assert.equal(shortReason.status, 422, JSON.stringify(shortReason.body));
  const badPercent = await createCoupon(couponBody({ code: `P3E-BAD2-${run}`, discountValue: 101 }));
  assert.equal(badPercent.status, 422, JSON.stringify(badPercent.body));
  const badWindow = await createCoupon(
    couponBody({ code: `P3E-BAD3-${run}`, validFrom: iso(3600_000), validUntil: iso(-3600_000) }),
  );
  assert.equal(badWindow.status, 422, JSON.stringify(badWindow.body));
  const badPlan = await createCoupon(couponBody({ code: `P3E-BAD4-${run}`, planId: `no-such-plan-${run}` }));
  assert.equal(badPlan.status, 422, JSON.stringify(badPlan.body));
  assert.equal(badPlan.body.error.code, "PLAN_NOT_FOUND");

  const code = `P3E-MAIN-${RUN}`;
  const created = await createCoupon(couponBody({ code: code.toLowerCase(), discountValue: 25 }));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.coupon.code, code, "codes are stored upper-case");
  const duplicate = await createCoupon(couponBody({ code }));
  assert.equal(duplicate.status, 409, JSON.stringify(duplicate.body));
  assert.equal(duplicate.body.error.code, "COUPON_EXISTS");

  const changes = await req("GET", `/owner/coupons/${code}/changes`, undefined, owner.current);
  assert.equal(changes.status, 200);
  assert.equal(changes.body.items.length, 1);
  assert.equal(changes.body.items[0].action, "CREATE");
  assert.equal(changes.body.items[0].reason, REASON);
  assert.equal(changes.body.items[0].after.discountValue, 25);
});

test("Phase 3E coupons: a percentage coupon discounts a subscription order exactly, recorded on the order", async () => {
  const code = `P3E-PCT-${RUN}`;
  assert.equal((await createCoupon(couponBody({ code, discountValue: 25 }))).status, 201);

  const placed = await order(officeA, { kind: "subscription", planId: PLAN, couponCode: code.toLowerCase() });
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  assert.equal(placed.body.amountMinor, 75_000);
  assert.equal(placed.body.discountMinor, 25_000);
  assert.equal(placed.body.couponCode, code);

  const billing = await req("GET", "/billing", undefined, officeA.admin);
  const listed = billing.body.orders.find((o: any) => o.id === placed.body.id);
  assert.equal(listed.couponCode, code);
  assert.equal(listed.discountMinor, 25_000);

  const redemptions = await req("GET", "/owner/coupon-redemptions", undefined, owner.current);
  const mine = redemptions.body.items.find((r: any) => r.orderId === placed.body.id);
  assert.ok(mine, "the redemption is visible to the owner");
  assert.equal(mine.couponCode, code);
  assert.equal(mine.tenantId, officeA.tenant.id);
  assert.equal(mine.discountMinor, 25_000);
  assert.equal(mine.redeemedBy, officeA.admin.user.id);

  const coupons = await req("GET", "/owner/coupons", undefined, owner.current);
  const row = coupons.body.items.find((c: any) => c.code === code);
  assert.equal(row.redemptions, 1);
  assert.equal(row.discountTotalMinor, 25_000);

  // Floor maths: 10% of 33,333 poisha is 3,333 — never rounded up.
  const floorCode = `P3E-FLOOR-${RUN}`;
  assert.equal((await createCoupon(couponBody({ code: floorCode, discountValue: 10 }))).status, 201);
  const floored = await order(officeB, { kind: "subscription", planId: PLAN2, couponCode: floorCode });
  assert.equal(floored.status, 201, JSON.stringify(floored.body));
  assert.equal(floored.body.discountMinor, 3_333);
  assert.equal(floored.body.amountMinor, 30_000);
});

test("Phase 3E coupons: fixed discounts, the zero floor, scope and plan restrictions", async () => {
  const fixed = `P3E-FIX-${RUN}`;
  assert.equal(
    (await createCoupon(couponBody({ code: fixed, discountKind: "fixed", discountValue: 50_000, appliesTo: "subscription" }))).status,
    201,
  );
  const placed = await order(officeA, { kind: "subscription", planId: PLAN, couponCode: fixed });
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  assert.equal(placed.body.amountMinor, 50_000);
  assert.equal(placed.body.discountMinor, 50_000);

  // A subscription-only coupon does not apply to a top-up order.
  const wrongKind = await order(officeA, { kind: "topup", credits: 10, couponCode: fixed });
  assert.equal(wrongKind.status, 422, JSON.stringify(wrongKind.body));
  assert.equal(wrongKind.body.error.code, "COUPON_NOT_APPLICABLE");

  // A fixed discount larger than the price stops at zero — and the zero-price
  // order still settles through the owner's manual settle.
  const big = `P3E-BIG-${RUN}`;
  assert.equal(
    (await createCoupon(couponBody({ code: big, discountKind: "fixed", discountValue: 200_000 }))).status,
    201,
  );
  const zeroed = await order(officeB, { kind: "subscription", planId: PLAN2, couponCode: big });
  assert.equal(zeroed.status, 201, JSON.stringify(zeroed.body));
  assert.equal(zeroed.body.amountMinor, 0);
  assert.equal(zeroed.body.discountMinor, 33_333);
  const settled = await req(
    "POST",
    `/owner/payment-orders/${zeroed.body.id}/settle`,
    { reason: REASON },
    owner.current,
  );
  assert.equal(settled.status, 200, JSON.stringify(settled.body));

  // A 100% coupon also lands exactly on zero.
  const full = `P3E-FULL-${RUN}`;
  assert.equal((await createCoupon(couponBody({ code: full, discountValue: 100 }))).status, 201);
  const free = await order(officeA, { kind: "subscription", planId: PLAN2, couponCode: full });
  assert.equal(free.status, 201, JSON.stringify(free.body));
  assert.equal(free.body.amountMinor, 0);

  // A plan-specific coupon refuses other plans and accepts its own.
  const planOnly = `P3E-PLAN-${RUN}`;
  assert.equal(
    (await createCoupon(couponBody({ code: planOnly, appliesTo: "subscription", planId: PLAN }))).status,
    201,
  );
  const wrongPlan = await order(officeA, { kind: "subscription", planId: PLAN2, couponCode: planOnly });
  assert.equal(wrongPlan.status, 422, JSON.stringify(wrongPlan.body));
  assert.equal(wrongPlan.body.error.code, "COUPON_NOT_APPLICABLE");
  const rightPlan = await order(officeA, { kind: "subscription", planId: PLAN, couponCode: planOnly });
  assert.equal(rightPlan.status, 201, JSON.stringify(rightPlan.body));

  // A top-up order carries no payable amount in this system, so a coupon gives
  // no discount on it and is refused rather than silently burning a use.
  const both = `P3E-BOTH-${RUN}`;
  assert.equal((await createCoupon(couponBody({ code: both }))).status, 201);
  const topup = await order(officeA, { kind: "topup", credits: 10, couponCode: both });
  assert.equal(topup.status, 422, JSON.stringify(topup.body));
  assert.equal(topup.body.error.code, "COUPON_NOT_APPLICABLE");

  // An unknown code is refused and creates no order at all.
  const before = (await req("GET", "/billing", undefined, officeA.admin)).body.orders.length;
  const unknown = await order(officeA, { kind: "subscription", planId: PLAN, couponCode: `NOPE-${run}` });
  assert.equal(unknown.status, 422, JSON.stringify(unknown.body));
  assert.equal(unknown.body.error.code, "COUPON_INVALID");
  const afterCount = (await req("GET", "/billing", undefined, officeA.admin)).body.orders.length;
  assert.equal(afterCount, before, "a refused coupon creates no order");
});

test("Phase 3E coupons: total and per-office limits are enforced at redemption", async () => {
  const maxed = `P3E-MAX-${RUN}`;
  assert.equal((await createCoupon(couponBody({ code: maxed, maxUses: 2 }))).status, 201);
  assert.equal((await order(officeA, { kind: "subscription", planId: PLAN, couponCode: maxed })).status, 201);
  assert.equal((await order(officeB, { kind: "subscription", planId: PLAN, couponCode: maxed })).status, 201);
  const third = await order(officeA, { kind: "subscription", planId: PLAN, couponCode: maxed });
  assert.equal(third.status, 422, JSON.stringify(third.body));
  assert.equal(third.body.error.code, "COUPON_LIMIT_REACHED");

  const perOffice = `P3E-PER-${RUN}`;
  assert.equal((await createCoupon(couponBody({ code: perOffice, perOfficeLimit: 1 }))).status, 201);
  assert.equal((await order(officeA, { kind: "subscription", planId: PLAN, couponCode: perOffice })).status, 201);
  const again = await order(officeA, { kind: "subscription", planId: PLAN, couponCode: perOffice });
  assert.equal(again.status, 422, JSON.stringify(again.body));
  assert.equal(again.body.error.code, "COUPON_OFFICE_LIMIT_REACHED");
  assert.equal((await order(officeB, { kind: "subscription", planId: PLAN, couponCode: perOffice })).status, 201);
});

test("Phase 3E coupons: validity window, active switch and public visibility", async () => {
  const expired = `P3E-EXP-${RUN}`;
  assert.equal(
    (await createCoupon(couponBody({ code: expired, validFrom: iso(-3 * 86400_000), validUntil: iso(-86400_000) }))).status,
    201,
  );
  const expiredUse = await order(officeA, { kind: "subscription", planId: PLAN, couponCode: expired });
  assert.equal(expiredUse.status, 422, JSON.stringify(expiredUse.body));
  assert.equal(expiredUse.body.error.code, "COUPON_EXPIRED");

  const future = `P3E-FUT-${RUN}`;
  assert.equal(
    (await createCoupon(couponBody({ code: future, validFrom: iso(86400_000), validUntil: iso(2 * 86400_000) }))).status,
    201,
  );
  const futureUse = await order(officeA, { kind: "subscription", planId: PLAN, couponCode: future });
  assert.equal(futureUse.status, 422, JSON.stringify(futureUse.body));
  assert.equal(futureUse.body.error.code, "COUPON_NOT_YET_VALID");

  const toggled = `P3E-TOG-${RUN}`;
  assert.equal((await createCoupon(couponBody({ code: toggled, active: false }))).status, 201);
  const offUse = await order(officeA, { kind: "subscription", planId: PLAN, couponCode: toggled });
  assert.equal(offUse.status, 422, JSON.stringify(offUse.body));
  assert.equal(offUse.body.error.code, "COUPON_INACTIVE");
  const switched = await req(
    "POST",
    `/owner/coupons/${toggled}/active`,
    { active: true, reason: REASON },
    owner.current,
  );
  assert.equal(switched.status, 200, JSON.stringify(switched.body));
  assert.equal((await order(officeA, { kind: "subscription", planId: PLAN, couponCode: toggled })).status, 201);
  const changes = await req("GET", `/owner/coupons/${toggled}/changes`, undefined, owner.current);
  assert.deepEqual(changes.body.items.map((i: any) => i.action), ["ACTIVE", "CREATE"]);

  // Visibility: public coupons are listed on the portal; hidden ones never are,
  // but a hidden coupon still redeems for an office that knows the code.
  const pub = `P3E-PUB-${RUN}`;
  const hid = `P3E-HID-${RUN}`;
  assert.equal((await createCoupon(couponBody({ code: pub, visibility: "public" }))).status, 201);
  assert.equal((await createCoupon(couponBody({ code: hid, visibility: "hidden" }))).status, 201);
  const listed = await req("GET", "/public/coupons");
  assert.equal(listed.status, 200);
  assert.ok(listed.body.items.some((c: any) => c.code === pub), "public coupon listed");
  assert.ok(!listed.body.items.some((c: any) => c.code === hid), "hidden coupon never listed");
  assert.equal((await order(officeB, { kind: "subscription", planId: PLAN, couponCode: hid })).status, 201);
  // Switching a public coupon to hidden removes it from the portal listing.
  const current = (await req("GET", "/owner/coupons", undefined, owner.current)).body.items.find(
    (c: any) => c.code === pub,
  );
  const hiddenNow = await req(
    "PUT",
    `/owner/coupons/${pub}`,
    couponBody({
      discountValue: current.discountValue,
      visibility: "hidden",
      validFrom: current.validFrom,
    }),
    owner.current,
  );
  assert.equal(hiddenNow.status, 200, JSON.stringify(hiddenNow.body));
  const relisted = await req("GET", "/public/coupons");
  assert.ok(!relisted.body.items.some((c: any) => c.code === pub), "hidden coupon leaves the portal listing");
});

test("Phase 3E notices: publish → portal banner → unpublish, with windows and audit", async () => {
  assert.equal((await req("GET", "/owner/notices")).status, 401);
  assert.equal((await req("GET", "/owner/notices", undefined, officeA.admin)).status, 403);

  const noticeBody = (overrides: Record<string, unknown> = {}) => ({
    titleBn: "রক্ষণাবেক্ষণের ঘোষণা",
    titleEn: `Maintenance notice ${run}`,
    bodyBn: "আগামীকাল রাত ১০টায় সিস্টেম রক্ষণাবেক্ষণ হবে।",
    bodyEn: "The system will be maintained tomorrow at 10pm.",
    linkUrl: null,
    startsAt: iso(-3600_000),
    endsAt: null,
    published: true,
    reason: REASON,
    ...overrides,
  });
  const shortReason = await req("POST", "/owner/notices", noticeBody({ reason: "short" }), owner.current);
  assert.equal(shortReason.status, 422, JSON.stringify(shortReason.body));

  const created = await req("POST", "/owner/notices", noticeBody(), owner.current);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const notice = created.body.notice;
  assert.equal(notice.status, "live");

  const pub = await req("GET", "/global-notices");
  assert.equal(pub.status, 200);
  assert.ok(pub.body.items.some((n: any) => n.id === notice.id), "live notice is on the portal");

  // Scheduled and expired notices never reach the public read.
  const scheduled = await req(
    "POST",
    "/owner/notices",
    noticeBody({ titleEn: `Scheduled notice ${run}`, startsAt: iso(86400_000), endsAt: iso(2 * 86400_000) }),
    owner.current,
  );
  assert.equal(scheduled.status, 201, JSON.stringify(scheduled.body));
  assert.equal(scheduled.body.notice.status, "scheduled");
  const expired = await req(
    "POST",
    "/owner/notices",
    noticeBody({ titleEn: `Expired notice ${run}`, startsAt: iso(-2 * 86400_000), endsAt: iso(-86400_000) }),
    owner.current,
  );
  assert.equal(expired.body.notice.status, "expired");
  const pub2 = await req("GET", "/global-notices");
  assert.ok(!pub2.body.items.some((n: any) => n.id === scheduled.body.notice.id));
  assert.ok(!pub2.body.items.some((n: any) => n.id === expired.body.notice.id));

  // Unpublishing removes the banner at once; the owner still sees it, unpublished.
  const unpublished = await req(
    "POST",
    `/owner/notices/${notice.id}/publish`,
    { published: false, reason: REASON },
    owner.current,
  );
  assert.equal(unpublished.status, 200, JSON.stringify(unpublished.body));
  assert.equal(unpublished.body.notice.status, "unpublished");
  const pub3 = await req("GET", "/global-notices");
  assert.ok(!pub3.body.items.some((n: any) => n.id === notice.id), "unpublished notice leaves the portal");
  const mine = (await req("GET", "/owner/notices", undefined, owner.current)).body.items.find(
    (n: any) => n.id === notice.id,
  );
  assert.equal(mine.status, "unpublished");

  // Edits and the whole history are recorded with reasons.
  const edited = await req(
    "PUT",
    `/owner/notices/${notice.id}`,
    noticeBody({ titleEn: `Maintenance notice ${run} (updated)`, published: false }),
    owner.current,
  );
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.notice.titleEn, `Maintenance notice ${run} (updated)`);
  const changes = await req("GET", `/owner/notices/${notice.id}/changes`, undefined, owner.current);
  assert.deepEqual(changes.body.items.map((i: any) => i.action), ["UPDATE", "PUBLISH", "CREATE"]);
  assert.ok(changes.body.items.every((i: any) => i.reason === REASON));
});
