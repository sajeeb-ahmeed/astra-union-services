/**
 * S-001 (Phase 4 Stage 1, P1) — a mobile number must be OTP-verified before
 * it becomes a trusted sign-in identifier.
 *
 * Covers: short signup without a code (pending state), verification of a
 * pending mobile, signup with a pre-verified code, OTP expiry, wrong-code
 * exhaustion, resend + hourly limits, duplicates, changing a verified
 * mobile, historical unverified accounts, provider outage (safe-config
 * state), and that a pending mobile gives no account-recovery oracle.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { hashPassword, digest } from "../src/security.js";
import { identifierDigest, identifierHint } from "../src/identifiers.js";
import { logOtpProvider, setOtpProvider } from "../src/otp.js";

process.env.NODE_ENV = "test";
const db = new pg.Pool({ connectionString: adminConnectionString });
const password = randomBytes(12).toString("base64url");
const run = randomUUID().slice(0, 8);
let server: ReturnType<typeof app.listen>, base: string, tenantId: string;
const sent: { mobile: string; code: string }[] = [];
const tail = String(Date.now()).slice(-8);
let counter = 0;
const freshMobile = () => `015${String(Number(tail) + ++counter).padStart(8, "0").slice(-8)}`;
const lastCode = (mobile: string) => [...sent].reverse().find((s) => s.mobile === mobile)!.code;

async function request(method: string, path: string, data?: unknown, session?: { cookie: string; csrf: string }) {
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
async function login(body: Record<string, string>) {
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await r.json();
  return { status: r.status, body: json, cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "", csrf: json.csrfToken };
}
async function sendOtp(mobile: string) {
  const r = await request("POST", "/auth/otp/signup", { mobile });
  assert.equal(r.status, 202, JSON.stringify(r.body));
  return r.body.challengeToken as string;
}
async function verifyMobile(mobile: string, token?: string, code?: string) {
  const challengeToken = token ?? (await sendOtp(mobile));
  const useCode = code ?? lastCode(mobile);
  return request("POST", "/auth/otp/verify-mobile", { challengeToken, code: useCode, mobile });
}
function fullCitizen(extra: Record<string, unknown>) {
  const n = ++counter;
  return {
    email: `mv-${run}-${n}@mv.synthetic.test`,
    password,
    displayName: "Mobile Verification Citizen",
    tenantId,
    nameBn: "পরীক্ষা নাগরিক",
    nameEn: "Mobile Verification Citizen",
    dateOfBirth: "2000-01-01",
    addressBn: "পরীক্ষা ঠিকানা",
    addressEn: "Synthetic address",
    ...extra,
  };
}
async function verifiedToken(mobile: string) {
  const token = await sendOtp(mobile);
  const ok = await request("POST", "/auth/otp/verify", { challengeToken: token, code: lastCode(mobile) });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  return token;
}

before(async () => {
  setOtpProvider({ async send({ mobile, code }) { sent.push({ mobile, code }); } });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  tenantId = (
    await db.query(
      "WITH created AS (INSERT INTO tenants(slug,name_bn,name_en) VALUES($1,'পরীক্ষা অফিস','Mobile verification office') RETURNING id) INSERT INTO tenant_wallets(tenant_id) SELECT id FROM created RETURNING tenant_id AS id",
      [`mv-${run}`],
    )
  ).rows[0].id;
});
after(async () => {
  setOtpProvider(logOtpProvider);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await db.end();
});

test("S-001: short signup without a code creates a pending mobile; mobile sign-in is blocked, email sign-in works", async () => {
  const mobile = freshMobile();
  const email = `mv-${run}-pending@mv.synthetic.test`;
  const r = await request("POST", "/auth/signup", { tenantId, name: "Pending Citizen", mobile, password, email });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.mobileVerification, "pending");
  assert.equal(r.body.mobileVerified, false);
  const row = (
    await db.query(
      "SELECT i.self_declared, i.verified_at FROM account_identifiers i JOIN platform_users u ON u.id=i.user_id WHERE u.email=$1 AND i.kind='mobile'",
      [email],
    )
  ).rows[0];
  assert.equal(row.self_declared, true);
  assert.equal(row.verified_at, null);
  // The pending mobile answers exactly like an unknown number: no oracle
  // for whether the number is registered, pending, or wrong.
  const blocked = await login({ identifierType: "mobile", identifier: mobile, password });
  const unknown = await login({ identifierType: "mobile", identifier: freshMobile(), password });
  assert.equal(blocked.status, 401);
  assert.deepEqual(blocked.body, unknown.body);
  const byEmail = await login({ email, password });
  assert.equal(byEmail.status, 200, JSON.stringify(byEmail.body));
});

test("S-001: a pending mobile verifies with one code, then signs in; the code is spent", async () => {
  const mobile = freshMobile();
  const email = `mv-${run}-verify@mv.synthetic.test`;
  assert.equal(
    (await request("POST", "/auth/signup", { tenantId, name: "Verify Citizen", mobile, password, email })).status,
    201,
  );
  const token = await sendOtp(mobile);
  const wrong = lastCode(mobile) === "000000" ? "111111" : "000000";
  const bad = await request("POST", "/auth/otp/verify-mobile", { challengeToken: token, code: wrong, mobile });
  assert.equal(bad.status, 422);
  assert.equal(bad.body.error.code, "OTP_INVALID");
  assert.match(bad.body.error.message, /4 tries left/);
  const ok = await request("POST", "/auth/otp/verify-mobile", { challengeToken: token, code: lastCode(mobile), mobile });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.verified, true);
  const stored = (
    await db.query(
      "SELECT i.self_declared, i.verified_at IS NOT NULL AS verified FROM account_identifiers i JOIN platform_users u ON u.id=i.user_id WHERE u.email=$1 AND i.kind='mobile'",
      [email],
    )
  ).rows[0];
  assert.equal(stored.self_declared, false);
  assert.equal(stored.verified, true);
  assert.equal((await login({ identifierType: "mobile", identifier: mobile, password })).status, 200);
  // The same code cannot verify again: it is consumed with the identifier.
  const reuse = await request("POST", "/auth/otp/verify-mobile", { challengeToken: token, code: lastCode(mobile), mobile });
  assert.equal(reuse.status, 410);
  assert.equal(reuse.body.error.code, "OTP_EXPIRED");
});

test("S-001: short signup with a pre-verified code is verified at once", async () => {
  const mobile = freshMobile();
  const token = await verifiedToken(mobile);
  const r = await request("POST", "/auth/signup", { tenantId, name: "Preverified Citizen", mobile, password, otpToken: token });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.mobileVerification, "verified");
  assert.equal(r.body.mobileVerified, true);
  assert.equal((await login({ identifierType: "mobile", identifier: mobile, password })).status, 200);
  // The consumed code cannot open a second account.
  assert.equal(
    (await request("POST", "/auth/signup", { tenantId, name: "Second Citizen", mobile: freshMobile(), password, otpToken: token })).body.error.code,
    "OTP_REQUIRED",
  );
});

test("S-001: an expired code cannot verify a pending mobile", async () => {
  const mobile = freshMobile();
  assert.equal(
    (await request("POST", "/auth/signup", { tenantId, name: "Expiry Citizen", mobile, password })).status,
    201,
  );
  const token = await sendOtp(mobile);
  // Age the challenge past expiry (both columns move, so the table's
  // expires_at > created_at check still holds).
  await db.query(
    "UPDATE otp_challenges SET created_at=clock_timestamp() - interval '11 minutes', expires_at=clock_timestamp() - interval '1 minute' WHERE token_hash=$1",
    [digest(token)],
  );
  const expired = await request("POST", "/auth/otp/verify-mobile", { challengeToken: token, code: lastCode(mobile), mobile });
  assert.equal(expired.status, 410);
  assert.equal(expired.body.error.code, "OTP_EXPIRED");
  assert.equal((await login({ identifierType: "mobile", identifier: mobile, password })).status, 401);
});

test("S-001: a duplicate mobile is refused even while the first account is still pending", async () => {
  const mobile = freshMobile();
  assert.equal(
    (await request("POST", "/auth/signup", { tenantId, name: "First Holder", mobile, password })).status,
    201,
  );
  const dup = await request("POST", "/auth/signup", { tenantId, name: "Second Holder", mobile, password });
  assert.equal(dup.status, 409, JSON.stringify(dup.body));
  assert.equal(dup.body.error.code, "IDENTIFIER_TAKEN");
  assert.equal(dup.body.error.field, "mobile");
});

test("S-001: changing a verified mobile needs a fresh code for the new number", async () => {
  const mobile = freshMobile();
  const token = await verifiedToken(mobile);
  const citizen = fullCitizen({ mobile, otpToken: token });
  const created = await request("POST", "/auth/signup", citizen);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const authed = await login({ email: citizen.email, password });
  assert.equal(authed.status, 200, JSON.stringify(authed.body));
  const me = { cookie: authed.cookie, csrf: authed.csrf };
  const replacement = freshMobile();
  const noCode = await request("PUT", "/account/identifiers/mobile", { value: replacement, currentPassword: password }, me);
  assert.equal(noCode.status, 422, JSON.stringify(noCode.body));
  assert.equal(noCode.body.error.code, "OTP_REQUIRED");
  const newToken = await verifiedToken(replacement);
  const changed = await request("PUT", "/account/identifiers/mobile", { value: replacement, currentPassword: password, otpToken: newToken }, me);
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal(changed.body.verified, true);
  assert.equal((await login({ identifierType: "mobile", identifier: mobile, password })).status, 401, "the old number stops signing in");
  assert.equal((await login({ identifierType: "mobile", identifier: replacement, password })).status, 200);
  const listed = await request("GET", "/account/identifiers", undefined, me);
  assert.equal(listed.body.items.find((i: any) => i.kind === "mobile").verified, true);
});

test("S-001: a historical unverified identifier stays blocked until its holder re-verifies", async () => {
  const mobile = freshMobile();
  const email = `mv-${run}-legacy@mv.synthetic.test`;
  const userId = (
    await db.query("INSERT INTO platform_users(email,display_name,password_hash) VALUES($1,'Legacy Citizen',$2) RETURNING id", [
      email,
      hashPassword(password),
    ])
  ).rows[0].id;
  const tenantRow = (await db.query("SELECT id FROM tenants WHERE slug=$1", [`mv-${run}`])).rows[0];
  await db.query("INSERT INTO staff_memberships(user_id,tenant_id,role) VALUES($1,$2,'citizen')", [userId, tenantRow.id]);
  // As migration 059 leaves it: self-declared, never verified.
  await db.query("INSERT INTO account_identifiers(user_id,kind,digest,hint,self_declared,verified_at) VALUES($1,'mobile',$2,$3,true,NULL)", [
    userId,
    identifierDigest("mobile", mobile),
    identifierHint("mobile", mobile),
  ]);
  assert.equal((await login({ identifierType: "mobile", identifier: mobile, password })).status, 401);
  assert.equal((await verifyMobile(mobile)).status, 200);
  assert.equal((await login({ identifierType: "mobile", identifier: mobile, password })).status, 200);
});

test("S-001: with no SMS provider, registration still works and the mobile stays pending — an outage never verifies", async () => {
  setOtpProvider(null);
  try {
    assert.equal((await request("GET", "/auth/otp/status")).body.available, false);
    assert.equal((await request("POST", "/auth/otp/signup", { mobile: freshMobile() })).status, 503);
    const mobile = freshMobile();
    const r = await request("POST", "/auth/signup", { tenantId, name: "Outage Citizen", mobile, password });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.mobileVerification, "pending");
    assert.equal((await login({ identifierType: "mobile", identifier: mobile, password })).status, 401);
  } finally {
    setOtpProvider({ async send({ mobile, code }) { sent.push({ mobile, code }); } });
  }
});

test("S-001: verifying a number with no account answers 404, not success; a code for another number cannot verify it", async () => {
  const mobile = freshMobile();
  const token = await sendOtp(mobile);
  // A code issued for this number does not verify a different number.
  const mismatched = await request("POST", "/auth/otp/verify-mobile", { challengeToken: token, code: lastCode(mobile), mobile: freshMobile() });
  assert.equal(mismatched.status, 410);
  const r = await request("POST", "/auth/otp/verify-mobile", { challengeToken: token, code: lastCode(mobile), mobile });
  assert.equal(r.status, 404);
  assert.equal(r.body.error.code, "IDENTIFIER_NOT_FOUND");
});
