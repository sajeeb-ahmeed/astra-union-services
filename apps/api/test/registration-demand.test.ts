import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";

/**
 * Demand list (billing plan §3.6, owner-approved 18 Nov 08:01): a signup the
 * Phase 3E gate refuses with 422 UNION_NOT_LISTED is captured for the owner —
 * the name, mobile and claimed geography the flow collected — while the
 * rejection response, and the absence of any account, stay exactly as 3E
 * built them. Repeat attempts from the same phone for the same union fold
 * into one row (attempts counter); attempts without a phone have no stable
 * key and stay separate rows. No other signup outcome captures anything.
 */
type Session = { cookie: string; csrf: string; user: any };
const run = randomUUID().slice(0, 8);
const password = "Demand-Synthetic-123!";
const admin = new pg.Pool({ connectionString: adminConnectionString });
let server: ReturnType<typeof app.listen>, base: string;
const owner: { current?: Session } = {};
type Office = { tenant: any; admin: Session };
let officeA: Office, mappedOffice: Office;
let unlistedCode: string;
const stamp = String(Date.now()).slice(-8);
const phone1 = `017${stamp}`;
const phone2 = `018${stamp}`;
const phone3 = `019${stamp}`;
const phone4 = `016${stamp}`;
const OTP_TOKEN = "a".repeat(64);

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
      nameEn: `Demand test office ${slug}`,
      ...(geography
        ? { geography }
        : { division: "Test Division", district: "Test District", upazila: "Test Upazila" }),
      officeType: "UNION",
      adminEmail: `admin@${slug}.test`,
      adminName: "Demand Test Admin",
      adminPassword: password,
    },
    owner.current,
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return { tenant: created.body, admin: await login(`admin@${slug}.test`) };
}
async function signup(email: string, tenantId: string, geography?: Record<string, string>, mobile?: string) {
  return req("POST", "/auth/signup", {
    email,
    password,
    displayName: "Demand Citizen",
    tenantId,
    nameBn: "চাহিদা নাগরিক",
    nameEn: "Demand Citizen",
    dateOfBirth: "1996-03-04",
    addressBn: "চাহিদা ঠিকানা",
    addressEn: "Demand address",
    ...(geography ? { geography } : {}),
    ...(mobile ? { mobile, otpToken: OTP_TOKEN } : {}),
  });
}
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
const demandByPhone = async (phone: string) =>
  (await admin.query("SELECT * FROM platform_registration_demand WHERE phone=$1 ORDER BY first_attempt_at", [phone]))
    .rows;
const demandCount = async (where: string, params: unknown[]) =>
  (await admin.query(`SELECT count(*)::int AS n FROM platform_registration_demand WHERE ${where}`, params))
    .rows[0].n as number;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  owner.current = await login("owner@astra.demo.test", "Demo-Phase1!");
  officeA = await buildOffice(`demand-a-${run}`);
  mappedOffice = await buildOffice(`demand-mapped-${run}`, {
    divisionCode: "div-02",
    districtCode: "dis-19",
    upazilaCode: "upa-089",
    unionCode: "uni-0001",
  });
  const unlisted = (
    await admin.query(
      `SELECT u.code FROM geo_unions u WHERE u.parent_code='upa-089' AND u.code <> 'uni-0001'
       AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t.status='ACTIVE' AND t.division_code='div-02'
         AND t.district_code='dis-19' AND t.upazila_code='upa-089' AND (t.union_code=u.code OR t.union_code IS NULL))
       ORDER BY u.code LIMIT 1`,
    )
  ).rows[0];
  assert.ok(unlisted, "the dataset must hold an unlisted union in upa-089");
  unlistedCode = unlisted.code;
});
after(async () => {
  await closePdfBrowser();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await admin.end();
  await pool.end();
});

test("demand: a blocked signup is captured exactly once — no account, the 422 unchanged", async () => {
  const email = `demand-blocked-${run}@synthetic.test`;
  const geo = await geoFor(unlistedCode);
  const blocked = await signup(email, officeA.tenant.id, geo, phone1);
  assert.equal(blocked.status, 422, JSON.stringify(blocked.body));
  assert.equal(blocked.body.error.code, "UNION_NOT_LISTED");
  assert.match(blocked.body.error.message, /এই ইউনিয়ন এখনো DigitalUnion-এ যুক্ত হয়নি/);
  assert.match(blocked.body.error.message, /This union has not joined DigitalUnion yet/);

  const users = await admin.query("SELECT count(*)::int AS n FROM platform_users WHERE email=$1", [email]);
  assert.equal(users.rows[0].n, 0, "a blocked signup creates no account");

  const rows = await demandByPhone(phone1);
  assert.equal(rows.length, 1, "exactly one demand row is captured");
  assert.equal(rows[0].union_code, unlistedCode);
  assert.equal(rows[0].division_code, "div-02");
  assert.equal(rows[0].upazila_code, "upa-089");
  assert.equal(rows[0].ward_code, geo.wardCode);
  assert.equal(rows[0].name_en, "Demand Citizen");
  assert.equal(rows[0].name_bn, "চাহিদা নাগরিক");
  assert.equal(rows[0].attempts, 1);
});

test("demand: repeats fold by phone + union; a new phone and phoneless attempts stay separate", async () => {
  const geo = await geoFor(unlistedCode);
  const again = await signup(`demand-repeat-${run}@synthetic.test`, officeA.tenant.id, geo, phone1);
  assert.equal(again.status, 422, JSON.stringify(again.body));
  const folded = await demandByPhone(phone1);
  assert.equal(folded.length, 1, "the repeat attempt folds into the same row");
  assert.equal(folded[0].attempts, 2);
  assert.ok(
    new Date(folded[0].last_attempt_at).getTime() >= new Date(folded[0].first_attempt_at).getTime(),
    "last_attempt_at is refreshed",
  );

  const other = await signup(`demand-other-${run}@synthetic.test`, officeA.tenant.id, geo, phone2);
  assert.equal(other.status, 422, JSON.stringify(other.body));
  const otherRows = await demandByPhone(phone2);
  assert.equal(otherRows.length, 1);
  assert.equal(otherRows[0].attempts, 1);

  const phonelessBefore = await demandCount("phone IS NULL AND union_code=$1", [unlistedCode]);
  for (const tag of ["one", "two"]) {
    const res = await signup(`demand-nophone-${tag}-${run}@synthetic.test`, officeA.tenant.id, geo);
    assert.equal(res.status, 422, JSON.stringify(res.body));
  }
  const phonelessAfter = await demandCount("phone IS NULL AND union_code=$1", [unlistedCode]);
  assert.equal(
    phonelessAfter,
    phonelessBefore + 2,
    "attempts without a phone have no dedupe key — each is its own row",
  );
});

test("demand: success and every other failure capture nothing", async () => {
  // A listed union registers — no demand row for it, ever.
  const listed = await signup(`demand-listed-${run}@synthetic.test`, mappedOffice.tenant.id, await geoFor("uni-0001"));
  assert.equal(listed.status, 201, JSON.stringify(listed.body));
  assert.equal(await demandCount("union_code='uni-0001'", []), 0);

  // A geography that fails validation (union belongs to another upazila) is a
  // 400 long before the gate — nothing is captured for its phone.
  const foreign = (
    await admin.query(
      "SELECT code FROM geo_unions WHERE parent_code <> 'upa-089' ORDER BY code LIMIT 1",
    )
  ).rows[0].code as string;
  const mismatch = await signup(`demand-mismatch-${run}@synthetic.test`, officeA.tenant.id, {
    divisionCode: "div-02",
    districtCode: "dis-19",
    upazilaCode: "upa-089",
    unionCode: foreign,
    wardCode: await wardOf(foreign),
  }, phone3);
  assert.equal(mismatch.status, 400, JSON.stringify(mismatch.body));
  assert.equal(mismatch.body.error.code, "GEOGRAPHY_MISMATCH");
  assert.equal((await demandByPhone(phone3)).length, 0);

  // The same unlisted claim under the mapped office is refused by the
  // jurisdiction check (400), not the gate — nothing is captured either.
  const atMapped = await signup(
    `demand-atmapped-${run}@synthetic.test`,
    mappedOffice.tenant.id,
    await geoFor(unlistedCode),
    phone4,
  );
  assert.equal(atMapped.status, 400, JSON.stringify(atMapped.body));
  assert.equal(atMapped.body.error.code, "GEOGRAPHY_OFFICE_MISMATCH");
  assert.equal((await demandByPhone(phone4)).length, 0);
});

test("demand: the owner lists attempts and per-union totals; other roles cannot", async () => {
  assert.equal((await req("GET", "/owner/registration-demand")).status, 401);
  assert.equal((await req("GET", "/owner/registration-demand", undefined, officeA.admin)).status, 403);

  const list = await req("GET", "/owner/registration-demand", undefined, owner.current);
  assert.equal(list.status, 200, JSON.stringify(list.body));
  const mine = list.body.items.find((i: any) => i.phone === phone1);
  assert.ok(mine, "the captured attempt is listed for the owner");
  assert.equal(mine.nameEn, "Demand Citizen");
  assert.equal(mine.unionCode, unlistedCode);
  assert.equal(mine.attempts, 2);
  assert.ok(mine.unionEn, "the union name is resolved from the geo dataset");
  assert.ok(mine.upazilaEn, "the upazila name is resolved from the geo dataset");

  const stamps = list.body.items.map((i: any) => new Date(i.lastAttemptAt).getTime());
  assert.deepEqual(stamps, [...stamps].sort((a, b) => b - a), "items are most recent first");

  const union = list.body.byUnion.find((u: any) => u.unionCode === unlistedCode);
  assert.ok(union, "the union appears in the per-union totals");
  assert.ok(union.people >= 4, `people counts every captured row (got ${union.people})`);
  assert.ok(union.attempts >= 5, `attempts sums the folded counters (got ${union.attempts})`);
  assert.ok(union.unionEn, "the per-union total carries the resolved union name");
});
