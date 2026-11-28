/**
 * cPanel single-role runtime smoke (A-013 / CERT-FEE deploy check).
 *
 * On cPanel one PostgreSQL user owns every table AND runs the app, so FORCE
 * ROW LEVEL SECURITY applies to it and the SECURITY DEFINER functions of
 * migrations 082–084 run as that same user. Migrating cleanly is not enough:
 * this script drives the real API against a single-role database and checks
 * that sign-in, the identity lookups, office creation, self-service offices,
 * certificate fees and a wallet-paid issuance all work under that model.
 *
 * It creates offices, users and certificates, so it refuses any origin other
 * than a local one. Use it with a disposable database prepared like cPanel:
 *
 *   ASTRA_DB_SINGLE_ROLE=1, DATABASE_URL = DATABASE_ADMIN_URL = the one
 *   non-superuser (NOBYPASSRLS) user, `npm run db:initialize-cpanel`, start
 *   the API, then:
 *   OWNER_EMAIL=… OWNER_PASSWORD=… node --import tsx scripts/single-role-smoke.ts http://127.0.0.1:3001
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { getDemoPayload } from "@astra/shared-schemas";

const origin = process.argv[2] ?? "http://127.0.0.1:3001";
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
  console.error("Refusing: this smoke test writes data and only runs against a local origin.");
  process.exit(2);
}
const ownerEmail = process.env.OWNER_EMAIL;
const ownerPassword = process.env.OWNER_PASSWORD;
if (!ownerEmail || !ownerPassword) {
  console.error("Set OWNER_EMAIL and OWNER_PASSWORD (the initialised owner account).");
  process.exit(2);
}
const base = `${origin}/api/v1`;
const run = randomUUID().slice(0, 8);
const password = randomBytes(12).toString("base64url");
type Session = { cookie: string; csrf: string; user: any };
const steps: string[] = [];
const step = (name: string) => {
  steps.push(name);
  console.log(`✔ ${name}`);
};

async function req(method: string, path: string, data?: unknown, s?: Session) {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      ...(s ? { Cookie: s.cookie, "X-CSRF-Token": s.csrf } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const type = r.headers.get("content-type") ?? "";
  return { status: r.status, body: type.includes("json") ? await r.json() : null } as { status: number; body: any };
}
async function login(email: string, p: string): Promise<Session> {
  const r = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: p }),
  });
  const json: any = await r.json();
  assert.equal(r.status, 200, `login ${email}: ${JSON.stringify(json)}`);
  return { cookie: r.headers.get(["set", "cookie"].join("-"))!.split(";")[0], csrf: json.csrfToken, user: json.user };
}
const expect = (r: { status: number; body: any }, status: number, what: string) =>
  assert.equal(r.status, status, `${what}: ${JSON.stringify(r.body)}`);

// 082 sessions + 083 identity lookups: sign-in, session resolution, wrong password.
const owner = await login(ownerEmail, ownerPassword);
expect(await req("GET", "/auth/me", undefined, owner), 200, "owner /auth/me");
const wrong = await req("POST", "/auth/login", { email: ownerEmail, password: "not-the-password" });
assert.equal(wrong.status, 401, "a wrong password is refused");
step("owner signs in, the session resolves, a wrong password is refused (082/083)");

// CERT-FEE prices (platform_settings).
expect(
  await req("PUT", "/owner/certificate-fees", { feeBnMinor: 2000, feeEnMinor: 3000, reason: "Single-role smoke prices" }, owner),
  200,
  "set certificate fees",
);
step("owner sets the certificate prices (084)");

// 083: owner creates an office (new user insert under FORCE RLS).
const slug = `srs-${run}`;
const created = await req(
  "POST",
  "/owner/tenants",
  {
    slug,
    nameBn: "একক রোল পরীক্ষা অফিস",
    nameEn: `Single role smoke ${run}`,
    division: "Test Division",
    district: "Test District",
    upazila: "Test Upazila",
    officeType: "UNION",
    adminEmail: `admin@${slug}.test`,
    adminName: "Smoke Admin",
    adminPassword: password,
  },
  owner,
);
expect(created, 201, "owner creates an office");
const tenantId = created.body.id;
const admin = await login(`admin@${slug}.test`, password);
const sessions: Record<string, Session> = {};
for (const role of ["approver", "staff"]) {
  expect(
    await req("POST", "/admin/users", { email: `${role}@${slug}.test`, displayName: `Smoke ${role}`, password, role }, admin),
    201,
    `create ${role}`,
  );
  sessions[role] = await login(`${role}@${slug}.test`, password);
}
expect(
  await req(
    "PUT",
    `/admin/authorizations/${sessions.approver.user.id}/45`,
    { active: true, authorityNote: "Single-role smoke authority" },
    admin,
  ),
  200,
  "approval authority",
);
const signature = await req(
  "PUT",
  "/office/certificate-assets/signature",
  {
    mimeType: "image/png",
    base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    reason: "Synthetic signature fixture for the single-role smoke; not a real chairman signature",
  },
  sessions.approver,
);
assert.ok([200, 201].includes(signature.status), JSON.stringify(signature.body));
step("owner creates an office; its admin adds staff, authority and signature (083)");

// Citizen sign-up (identity lookups + new user insert).
const citizenEmail = `citizen-${slug}@synthetic.test`;
expect(
  await req("POST", "/auth/signup", {
    email: citizenEmail,
    password,
    displayName: "Smoke Citizen",
    tenantId,
    nameBn: "পরীক্ষা নাগরিক",
    nameEn: "Smoke Citizen",
    dateOfBirth: "1998-02-03",
    addressBn: "পরীক্ষা ঠিকানা",
    addressEn: "Test address only",
    syntheticReference: `REF-${slug}`,
  }),
  201,
  "citizen sign-up",
);
const citizen = await login(citizenEmail, password);
const citizenId = (await req("GET", "/citizens", undefined, citizen)).body.items[0].id;
step("a citizen signs up and signs in (083)");

// 084: self-service office, verification queue, verification.
const selfEmail = `chair-${run}@selfreg.test`;
const selfReg = await req("POST", "/public/offices/self-register", {
  nameBn: "স্বনিবন্ধিত পরীক্ষা পরিষদ",
  nameEn: `Self registered smoke ${run}`,
  officeType: "UNION",
  geography: { divisionCode: "div-02", districtCode: "dis-19", upazilaCode: "upa-089", unionCode: "uni-0001" },
  adminEmail: selfEmail,
  adminName: "Smoke Chairman",
  adminPassword: password,
  acceptTerms: true,
});
expect(selfReg, 201, "self-register");
await login(selfEmail, password);
const queue = await req("GET", "/owner/office-verifications", undefined, owner);
expect(queue, 200, "verification queue");
assert.ok(
  queue.body.items.some((o: any) => o.id === selfReg.body.id && o.adminEmail === selfEmail),
  "the pending office and its admin are listed",
);
expect(await req("POST", `/owner/tenants/${selfReg.body.id}/verification`, { decision: "VERIFIED" }, owner), 200, "verify");
step("an office opens itself, appears in the owner's queue with its admin, and is verified (084)");

// 084: per-certificate billing, wallet funding, wallet-paid Bangla issuance.
expect(
  await req(
    "PUT",
    `/owner/tenants/${tenantId}/billing-mode`,
    { billingMode: "PER_CERTIFICATE", reason: "Single-role smoke billing mode" },
    owner,
  ),
  200,
  "billing mode",
);
expect(
  await req(
    "POST",
    `/owner/tenants/${tenantId}/points/adjust`,
    { deltaMinor: 5000, reason: "Single-role smoke wallet funding", requestKey: randomUUID() },
    owner,
  ),
  201,
  "wallet funding",
);
const app = await req(
  "POST",
  "/applications",
  { citizenId, serviceNo: 45, payload: { ...getDemoPayload(45), delivery_language: "bn" } },
  sessions.staff,
);
expect(app, 201, "create application");
expect(await req("POST", `/applications/${app.body.id}/transition`, { action: "submit" }, sessions.staff), 200, "submit");
const quote = await req("GET", `/applications/${app.body.id}/certificate-fee`, undefined, sessions.approver);
expect(quote, 200, "fee quote");
assert.deepEqual(quote.body.amounts, { bn: 2000, en: 3000, bilingual: 5000 });
const approved = await req(
  "POST",
  `/applications/${app.body.id}/transition`,
  { action: "approve", certificateLanguages: "bn", paymentMethod: "wallet" },
  sessions.approver,
);
expect(approved, 200, "approve and pay from the wallet");
assert.equal(approved.body.certificate.languages, "bn");
const wallet = await req("GET", "/wallet/points", undefined, sessions.approver);
expect(wallet, 200, "wallet");
assert.equal(wallet.body.balanceMinor, 3000, "৳20 was debited from ৳50");
step("per-certificate approval pays ৳20 from the wallet and issues the Bangla version (084)");

// 082: sign-out ends the session.
expect(await req("POST", "/auth/logout", {}, owner), 200, "logout");
assert.equal((await req("GET", "/auth/me", undefined, owner)).status, 401, "the signed-out session no longer resolves");
step("sign-out ends the session (082)");

console.log(`\nSingle-role smoke PASS: ${steps.length}/${steps.length} steps.`);
