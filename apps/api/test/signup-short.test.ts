/**
 * REG-UX Phase 1 — one-screen signup (design note §2–§4, §6.1).
 * Three required fields (name, mobile, password) + optional email + optional photo;
 * deferred profile items stay NULL until the first application asks for them.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { demoPayloads } from "@astra/shared-schemas";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";
import { isPlaceholderEmail, sendEmail } from "../src/mailer.js";
import { logOtpProvider, setOtpProvider } from "../src/otp.js";

process.env.NODE_ENV = "test";
const admin = new pg.Pool({ connectionString: adminConnectionString });
let server: ReturnType<typeof app.listen>, base: string, officeId: string, mappedId: string;
type Session = { cookie: string; csrf: string };
const run = randomUUID().slice(0, 8);
const PASSWORD = "Short-Signup-2026!";
// A minimal valid 1×1 PNG (passes the upload decoder's magic-byte checks).
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
let mobileSeq = Math.floor(Math.random() * 9_000_000);
const nextMobile = () => `017${String(10_000_000 + (mobileSeq++ % 89_999_999)).padStart(8, "0")}`;

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
async function loginWith(body: Record<string, string>) {
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await r.json();
  assert.equal(r.status, 200, JSON.stringify(json));
  return { cookie: r.headers.get("set-cookie")!.split(";")[0], csrf: json.csrfToken } as Session;
}
const loginMobile = async (mobile: string) => {
  // S-001: a short signup leaves the mobile pending; prove the number with
  // a code first, then mobile sign-in works.
  await verifyMobile(mobile);
  return loginWith({ identifierType: "mobile", identifier: mobile, password: PASSWORD });
};
const sent: { mobile: string; code: string }[] = [];
async function verifyMobile(mobile: string) {
  const sentCode = await req("POST", "/auth/otp/signup", { mobile });
  assert.equal(sentCode.status, 202, JSON.stringify(sentCode.body));
  const code = [...sent].reverse().find((s) => s.mobile === mobile)!.code;
  const ok = await req("POST", "/auth/otp/verify-mobile", { challengeToken: sentCode.body.challengeToken, code, mobile });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
}
async function ownCitizen(session: Session) {
  const list = await req("GET", "/citizens", undefined, session);
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.items.length, 1);
  return list.body.items[0];
}
async function citizenRowFor(mobile: string) {
  return (
    await admin.query(
      `SELECT c.*, u.email AS user_email, i.self_declared, i.verified_at
         FROM citizens c JOIN platform_users u ON u.id=c.user_id
         LEFT JOIN account_identifiers i ON i.user_id=u.id AND i.kind='mobile'
        WHERE c.contact_mobile=$1`,
      [mobile],
    )
  ).rows[0];
}

before(async () => {
  setOtpProvider({ async send({ mobile, code }) { sent.push({ mobile, code }); } });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  // A dedicated office: short-signup citizens have deferred profile items, and
  // leaving them in the shared demo office would change what other suites see
  // first in its citizen lists (browser.test picks the first citizen).
  const owner = await loginWith({ email: "owner@astra.demo.test", password: "Demo-Phase1!" });
  const office = await req(
    "POST",
    "/owner/tenants",
    {
      slug: `short-plain-${run}`,
      nameBn: "সংক্ষিপ্ত নিবন্ধন অফিস",
      nameEn: `Short signup office ${run}`,
      division: "Test Division",
      district: "Test District",
      upazila: "Test Upazila",
      officeType: "UNION",
      adminEmail: `admin@short-plain-${run}.test`,
      adminName: "Short Signup Admin",
      adminPassword: "Short-Office-Ad1!",
    },
    owner,
  );
  assert.equal(office.status, 201, JSON.stringify(office.body));
  officeId = office.body.id ?? office.body.tenant?.id;
  assert.ok(officeId, "the dedicated test office exists");
  // A geography-mapped union office (Debidwar union uni-0001, the listed test union).
  mappedId = (
    await admin.query(
      `WITH created AS (
         INSERT INTO tenants(slug,name_bn,name_en,division_code,district_code,upazila_code,union_code)
         VALUES($1,'পরীক্ষা ইউনিয়ন','Short signup mapped office','div-02','dis-19','upa-089','uni-0001') RETURNING id)
       INSERT INTO tenant_wallets(tenant_id) SELECT id FROM created RETURNING tenant_id AS id`,
      [`short-${run}`],
    )
  ).rows[0].id;
});
after(async () => {
  setOtpProvider(logOtpProvider);
  await closePdfBrowser();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await admin.end();
});

test("REG-UX 1: a Bangla name, mobile and password create an account; deferred items stay NULL; the mobile signs in", async () => {
  const mobile = nextMobile();
  const r = await req("POST", "/auth/signup", { tenantId: officeId, name: "রহিমা খাতুন", mobile, password: PASSWORD });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.registered, true);
  // S-001: without a code the mobile is pending — the account exists, but
  // mobile sign-in stays blocked until the number is verified.
  assert.equal(r.body.mobileVerification, "pending");
  assert.equal(r.body.mobileVerified, false);
  const row = await citizenRowFor(mobile);
  assert.ok(row, "the citizen row exists with the contact mobile");
  assert.equal(row.full_name_bn, "রহিমা খাতুন");
  assert.equal(row.full_name_en, null, "the other script is collected later, never guessed");
  assert.equal(row.date_of_birth, null);
  assert.equal(row.address_bn, null);
  assert.equal(row.address_en, null);
  assert.equal(row.division_code, null, "an office without geography derives none");
  assert.equal(row.self_declared, true, "the mobile is the sign-in identifier, marked self-declared");
  assert.equal(row.verified_at, null, "S-001: unverified until a code proves the number");
  assert.ok(isPlaceholderEmail(row.user_email), "an email-less account holds an internal .invalid address");
  assert.equal(await sendEmail({ to: row.user_email, subject: "x", text: "x" } as any), false, "never mailed");
  const session = await loginMobile(mobile);
  const me = await ownCitizen(session);
  assert.equal(me.nameBn, "রহিমা খাতুন");
  assert.equal(me.dateOfBirth, undefined);
});

test("REG-UX 2: a Latin name lands in the English column; an optional email signs in too", async () => {
  const mobile = nextMobile();
  const email = `short-${run}-latin@example.test`;
  const r = await req("POST", "/auth/signup", {
    tenantId: officeId,
    name: "Karim Uddin",
    mobile,
    password: PASSWORD,
    email: email.toUpperCase(),
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const row = await citizenRowFor(mobile);
  assert.equal(row.full_name_en, "Karim Uddin");
  assert.equal(row.full_name_bn, null);
  assert.equal(row.user_email, email, "email is stored lower-cased");
  await loginWith({ email, password: PASSWORD });
  await loginMobile(mobile);
});

test("REG-UX 3: an empty email string means 'not given'", async () => {
  const mobile = nextMobile();
  const r = await req("POST", "/auth/signup", { tenantId: officeId, name: "Empty Email", mobile, password: PASSWORD, email: "" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(isPlaceholderEmail((await citizenRowFor(mobile)).user_email));
});

test("REG-UX 4: a taken email is named at the email field with a sign-in remedy; nothing is created", async () => {
  const email = `short-${run}-dup@example.test`;
  const first = await req("POST", "/auth/signup", { tenantId: officeId, name: "First Owner", mobile: nextMobile(), password: PASSWORD, email });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const users = (await admin.query("SELECT count(*)::int n FROM platform_users")).rows[0].n;
  const secondMobile = nextMobile();
  const dup = await req("POST", "/auth/signup", { tenantId: officeId, name: "Second Person", mobile: secondMobile, password: PASSWORD, email });
  assert.equal(dup.status, 409, JSON.stringify(dup.body));
  assert.equal(dup.body.error.code, "EMAIL_TAKEN");
  assert.equal(dup.body.error.field, "email");
  assert.match(dup.body.error.message, /সাইন ইন/);
  assert.match(dup.body.error.message, /sign in/i);
  assert.equal((await admin.query("SELECT count(*)::int n FROM platform_users")).rows[0].n, users, "rolled back");
  assert.equal(await citizenRowFor(secondMobile), undefined);
  // The full (legacy) payload gets the same field-specific error.
  const full = await req("POST", "/auth/signup", {
    email,
    password: PASSWORD,
    displayName: "Full Shape",
    tenantId: officeId,
    nameBn: "পূর্ণ রূপ",
    nameEn: "Full Shape",
    dateOfBirth: "1990-01-01",
    addressBn: "নমুনা ঠিকানা",
    addressEn: "Sample address",
  });
  assert.equal(full.status, 409, JSON.stringify(full.body));
  assert.equal(full.body.error.code, "EMAIL_TAKEN");
  assert.equal(full.body.error.field, "email");
});

test("REG-UX 5: a mobile that already has an account is refused at the mobile field", async () => {
  const mobile = nextMobile();
  assert.equal((await req("POST", "/auth/signup", { tenantId: officeId, name: "Mobile Owner", mobile, password: PASSWORD })).status, 201);
  const dup = await req("POST", "/auth/signup", { tenantId: officeId, name: "Someone Else", mobile, password: PASSWORD });
  assert.equal(dup.status, 409, JSON.stringify(dup.body));
  assert.equal(dup.body.error.code, "IDENTIFIER_TAKEN");
  assert.equal(dup.body.error.field, "mobile");
  assert.match(dup.body.error.message, /সাইন ইন/);
});

test("REG-UX 6: field errors point at their field (invalid mobile, short name, weak password)", async () => {
  const badMobile = await req("POST", "/auth/signup", { tenantId: officeId, name: "Bad Mobile", mobile: "12345", password: PASSWORD });
  assert.equal(badMobile.status, 422, JSON.stringify(badMobile.body));
  assert.equal(badMobile.body.error.code, "IDENTIFIER_INVALID");
  assert.equal(badMobile.body.error.field, "mobile");
  const shortName = await req("POST", "/auth/signup", { tenantId: officeId, name: "A", mobile: nextMobile(), password: PASSWORD });
  assert.equal(shortName.status, 422, JSON.stringify(shortName.body));
  assert.ok(shortName.body.error.issues.some((i: any) => i.path === "name" && /নাম/.test(i.message)));
  const weak = await req("POST", "/auth/signup", { tenantId: officeId, name: "Weak Password", mobile: nextMobile(), password: "123" });
  assert.equal(weak.status, 422);
  assert.ok(weak.body.error.issues.some((i: any) => i.path === "password"));
  // Unknown keys are refused (strict shape), so a typo never silently drops data.
  const extra = await req("POST", "/auth/signup", { tenantId: officeId, name: "Extra Key", mobile: nextMobile(), password: PASSWORD, nid: "1" });
  assert.equal(extra.status, 422);
});

test("REG-UX 7: the first application asks for the deferred items only; fill-only completion then lets it through", async () => {
  const mobile = nextMobile();
  assert.equal((await req("POST", "/auth/signup", { tenantId: officeId, name: "আবেদনকারী নাগরিক", mobile, password: PASSWORD })).status, 201);
  const session = await loginMobile(mobile);
  const me = await ownCitizen(session);
  const blocked = await req("POST", "/applications", { citizenId: me.id, serviceNo: 45, payload: demoPayloads[45] }, session);
  assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
  assert.equal(blocked.body.error.code, "PROFILE_INCOMPLETE");
  assert.deepEqual(blocked.body.error.issues.missing, ["name", "dateOfBirth", "address"], "no NID/mobile demand at apply time");
  const completed = await req(
    "PATCH",
    `/citizens/${me.id}/profile`,
    { nameEn: "Applicant Citizen", dateOfBirth: "1991-03-04", addressBn: "গ্রাম নমুনা, ডাকঘর নমুনা", addressEn: "Village Sample, PO Sample" },
    session,
  );
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  assert.equal(completed.body.nameEn, "Applicant Citizen");
  assert.equal(completed.body.nameBn, "আবেদনকারী নাগরিক", "the signup name is kept");
  // Fill-only: a value already on record is never rewritten through this path.
  const rewrite = await req("PATCH", `/citizens/${me.id}/profile`, { nameBn: "অন্য নাম" }, session);
  assert.equal(rewrite.status, 409, JSON.stringify(rewrite.body));
  assert.equal(rewrite.body.error.code, "PROFILE_VALUE_PRESENT");
  const futureDob = await req("PATCH", `/citizens/${me.id}/profile`, { dateOfBirth: "2999-01-01" }, session);
  assert.equal(futureDob.status, 422);
  const created = await req("POST", "/applications", { citizenId: me.id, serviceNo: 45, payload: demoPayloads[45] }, session);
  assert.equal(created.status, 201, JSON.stringify(created.body));
});

test("REG-UX 8: at a mapped office the area derives from the office; the ward is the one deferred area item", async () => {
  const mobile = nextMobile();
  const r = await req("POST", "/auth/signup", { tenantId: mappedId, name: "Mapped Citizen", mobile, password: PASSWORD });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const row = await citizenRowFor(mobile);
  assert.deepEqual(
    [row.division_code, row.district_code, row.upazila_code, row.union_code, row.ward_code],
    ["div-02", "dis-19", "upa-089", "uni-0001", null],
  );
  const session = await loginMobile(mobile);
  const me = await ownCitizen(session);
  const blocked = await req("POST", "/applications", { citizenId: me.id, serviceNo: 45, payload: demoPayloads[45] }, session);
  assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
  assert.ok(blocked.body.error.issues.missing.includes("geography"));
  const ward = (await admin.query("SELECT code FROM geo_wards WHERE parent_code='uni-0001' ORDER BY code LIMIT 1")).rows[0].code;
  const wrongArea = await req(
    "PATCH",
    `/citizens/${me.id}/profile`,
    { geography: { divisionCode: "div-02", districtCode: "dis-19", upazilaCode: "upa-089", unionCode: "uni-0002", wardCode: ward } },
    session,
  );
  assert.ok([400, 422].includes(wrongArea.status), JSON.stringify(wrongArea.body));
  const set = await req(
    "PATCH",
    `/citizens/${me.id}/profile`,
    { geography: { divisionCode: "div-02", districtCode: "dis-19", upazilaCode: "upa-089", unionCode: "uni-0001", wardCode: ward } },
    session,
  );
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.geography.wardCode, ward);
});

test("REG-UX 9: an optional photo at signup becomes the profile photo; a bad image is refused", async () => {
  const mobile = nextMobile();
  const r = await req("POST", "/auth/signup", {
    tenantId: officeId,
    name: "Photo Citizen",
    mobile,
    password: PASSWORD,
    photo: { mimeType: "image/png", base64: PNG },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const session = await loginMobile(mobile);
  const me = await ownCitizen(session);
  const image = await fetch(`${base}/api/v1/citizens/${me.id}/photo/image`, { headers: { Cookie: session.cookie } });
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  const bad = await req("POST", "/auth/signup", {
    tenantId: officeId,
    name: "Bad Photo",
    mobile: nextMobile(),
    password: PASSWORD,
    photo: { mimeType: "image/jpeg", base64: PNG },
  });
  assert.equal(bad.status, 422, JSON.stringify(bad.body));
});
