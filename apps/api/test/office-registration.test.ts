import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { hashPassword } from "../src/security.js";
import { logOtpProvider, setOtpProvider } from "../src/otp.js";

const db = new pg.Pool({ connectionString: adminConnectionString });
// Test-only credentials are generated per run.
const password = randomBytes(12).toString("base64url");
const notThePassword = randomBytes(18).toString("base64url");
const run = randomUUID().slice(0, 8);
let server: ReturnType<typeof app.listen>, base: string, tenantId: string;
type Session = { cookie: string; csrf: string; body: any; status: number };
const codes: { mobile: string; code: string }[] = [];
async function request(method: string, path: string, data?: unknown, session?: Session) {
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
async function signIn(email: string, secret = password): Promise<Session> {
  const response = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: secret }),
  });
  const body = await response.json();
  return { status: response.status, body, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "", csrf: body.csrfToken };
}
let n = 0;
const applicant = (extra: Record<string, unknown> = {}) => ({
  tenantId,
  accountType: "up_secretary",
  email: `applicant-${run}-${++n}@office.synthetic.test`,
  password,
  displayName: "Synthetic Applicant",
  ...extra,
});
let ownerSession: Session, staffSession: Session;

before(async () => {
  setOtpProvider({ async send({ mobile, code }) { codes.push({ mobile, code }); } });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  tenantId = (
    await db.query(
      "WITH created AS (INSERT INTO tenants(slug,name_bn,name_en) VALUES($1,'পরীক্ষা অফিস','Synthetic registration office') RETURNING id) INSERT INTO tenant_wallets(tenant_id) SELECT id FROM created RETURNING tenant_id AS id",
      [`officereg-${run}`],
    )
  ).rows[0].id;
  const ownerEmail = `owner-${run}@office.synthetic.test`;
  await db.query("INSERT INTO platform_users(email,display_name,password_hash,platform_role) VALUES($1,'Synthetic owner',$2,'owner')", [ownerEmail, hashPassword(password)]);
  ownerSession = await signIn(ownerEmail);
  const staffEmail = `staff-${run}@office.synthetic.test`;
  const staffId = (await db.query("INSERT INTO platform_users(email,display_name,password_hash) VALUES($1,'Synthetic staff',$2) RETURNING id", [staffEmail, hashPassword(password)])).rows[0].id;
  await db.query("INSERT INTO staff_memberships(user_id,tenant_id,role) VALUES($1,$2,'staff')", [staffId, tenantId]);
  staffSession = await signIn(staffEmail);
});
after(async () => {
  setOtpProvider(logOtpProvider);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await db.end();
});

test("Phase 2d: the public list offers only posts of the office's type", async () => {
  const listed = await request("GET", `/public/offices/${tenantId}/account-types`);
  assert.equal(listed.status, 200);
  const codesListed = listed.body.items.map((t: any) => t.code);
  assert.ok(codesListed.includes("up_secretary") && codesListed.includes("digital_centre_entrepreneur"));
  assert.ok(!codesListed.includes("municipality_mayor"));
  assert.equal((await request("GET", `/public/offices/${randomUUID()}/account-types`)).status, 404);
});

test("Phase 2d: a registered applicant waits for review; only the right password reveals that", async () => {
  const body = applicant();
  const registered = await request("POST", "/auth/office-registration", body);
  assert.equal(registered.status, 202, JSON.stringify(registered.body));
  assert.equal(registered.body.status, "PENDING");
  const pending = await signIn(body.email);
  assert.equal(pending.status, 403);
  assert.equal(pending.body.error.code, "ACCOUNT_PENDING_REVIEW");
  const wrong = await signIn(body.email, notThePassword);
  const unknown = await signIn(`nobody-${run}@office.synthetic.test`);
  assert.equal(wrong.status, 401);
  assert.deepEqual(wrong.body, unknown.body);
  // No membership exists yet, so nothing in the office is reachable.
  assert.equal((await db.query("SELECT count(*)::int c FROM staff_memberships m JOIN platform_users u ON u.id=m.user_id WHERE u.email=$1", [body.email])).rows[0].c, 0);
  assert.equal((await request("POST", "/auth/office-registration", applicant({ accountType: "municipality_mayor" }))).body.error.code, "ACCOUNT_TYPE_OFFICE_MISMATCH");
  assert.equal((await request("POST", "/auth/office-registration", applicant({ email: body.email }))).body.error.code, "EMAIL_TAKEN");
  assert.equal((await request("POST", "/auth/office-registration", applicant({ tenantId: randomUUID() }))).status, 404);
});

test("Phase 2d: only the owner sees the queue; approval grants the post's role, rejection keeps sign-in closed", async () => {
  const approvedBody = applicant({ accountType: "up_chairman" });
  const rejectedBody = applicant();
  await request("POST", "/auth/office-registration", approvedBody);
  await request("POST", "/auth/office-registration", rejectedBody);
  assert.equal((await request("GET", "/owner/account-requests", undefined, staffSession)).status, 403);
  const queue = await request("GET", "/owner/account-requests", undefined, ownerSession);
  assert.equal(queue.status, 200);
  const approvedRow = queue.body.items.find((r: any) => r.email === approvedBody.email);
  const rejectedRow = queue.body.items.find((r: any) => r.email === rejectedBody.email);
  assert.equal(approvedRow.accountTypeEn, "UP Chairman");
  assert.equal(approvedRow.role, "approver");
  assert.equal(approvedRow.officeEn, "Synthetic registration office");

  assert.equal((await request("POST", `/owner/account-requests/${approvedRow.id}/decision`, { decision: "approve" }, staffSession)).status, 403);
  const approved = await request("POST", `/owner/account-requests/${approvedRow.id}/decision`, { decision: "approve" }, ownerSession);
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.status, "APPROVED");
  const session = await signIn(approvedBody.email);
  assert.equal(session.status, 200, JSON.stringify(session.body));
  assert.equal(session.body.user.role, "approver");
  const membership = (await db.query("SELECT m.role,m.account_type FROM staff_memberships m JOIN platform_users u ON u.id=m.user_id WHERE u.email=$1", [approvedBody.email])).rows[0];
  assert.deepEqual(membership, { role: "approver", account_type: "up_chairman" });
  assert.equal((await request("POST", `/owner/account-requests/${approvedRow.id}/decision`, { decision: "reject", reason: "Second decision attempt" }, ownerSession)).body.error.code, "ALREADY_DECIDED");

  assert.ok([400, 422].includes((await request("POST", `/owner/account-requests/${rejectedRow.id}/decision`, { decision: "reject" }, ownerSession)).status), "a rejection needs a reason");
  const rejected = await request("POST", `/owner/account-requests/${rejectedRow.id}/decision`, { decision: "reject", reason: "Synthetic: not a member of this office" }, ownerSession);
  assert.equal(rejected.body.status, "REJECTED");
  assert.equal((await signIn(rejectedBody.email)).body.error.code, "ACCOUNT_REJECTED");
  const audits = (await db.query("SELECT action FROM audit_events WHERE tenant_id=$1 AND action LIKE 'OFFICE_ACCOUNT_%' ORDER BY created_at", [tenantId])).rows.map((r) => r.action);
  assert.ok(audits.includes("OFFICE_ACCOUNT_REQUESTED") && audits.includes("OFFICE_ACCOUNT_APPROVED") && audits.includes("OFFICE_ACCOUNT_REJECTED"));
});

test("Phase 2d: an applicant can add a verified mobile, which signs in after approval", async () => {
  const mobile = `014${String(Date.now()).slice(-8)}`;
  const sent = await request("POST", "/auth/otp/signup", { mobile });
  const code = codes.reverse().find((c) => c.mobile === mobile)!.code;
  await request("POST", "/auth/otp/verify", { challengeToken: sent.body.challengeToken, code });
  const body = applicant({ accountType: "digital_centre_entrepreneur", mobile, otpToken: sent.body.challengeToken });
  assert.equal((await request("POST", "/auth/office-registration", body)).status, 202);
  const row = (await request("GET", "/owner/account-requests", undefined, ownerSession)).body.items.find((r: any) => r.email === body.email);
  assert.match(row.mobileHint, /^014\*+\d\d$/);
  await request("POST", `/owner/account-requests/${row.id}/decision`, { decision: "approve" }, ownerSession);
  const response = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifierType: "mobile", identifier: mobile, password }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.role, "staff");
});
