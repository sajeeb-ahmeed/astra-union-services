import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { logOtpProvider, setOtpProvider } from "../src/otp.js";

const db = new pg.Pool({ connectionString: adminConnectionString });
// Test-only credentials are generated per run so no password-like literal sits in the repository.
const password = randomBytes(12).toString("base64url");
const run = randomUUID().slice(0, 8);
let server: ReturnType<typeof app.listen>, base: string, tenantId: string;
const sent: { mobile: string; code: string }[] = [];
async function request(method: string, path: string, data?: unknown) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return { status: response.status, body: await response.json() };
}
const tail = String(Date.now()).slice(-8);
let counter = 0;
const freshMobile = () => `015${String(Number(tail) + ++counter).padStart(8, "0").slice(-8)}`;
const lastCode = (mobile: string) => [...sent].reverse().find((s) => s.mobile === mobile)!.code;
function citizen(extra: Record<string, unknown>) {
  const n = ++counter;
  return {
    email: `otp-${run}-${n}@otp.synthetic.test`,
    password,
    displayName: "Synthetic OTP Citizen",
    tenantId,
    nameBn: "পরীক্ষা নাগরিক",
    nameEn: "Synthetic OTP Citizen",
    dateOfBirth: "2000-01-01",
    addressBn: "পরীক্ষা ঠিকানা",
    addressEn: "Synthetic address",
    ...extra,
  };
}
async function verified(mobile: string) {
  const sentCode = await request("POST", "/auth/otp/signup", { mobile });
  assert.equal(sentCode.status, 202, JSON.stringify(sentCode.body));
  const ok = await request("POST", "/auth/otp/verify", { challengeToken: sentCode.body.challengeToken, code: lastCode(mobile) });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  return sentCode.body.challengeToken as string;
}

before(async () => {
  setOtpProvider({ async send({ mobile, code }) { sent.push({ mobile, code }); } });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  tenantId = (
    await db.query(
      "WITH created AS (INSERT INTO tenants(slug,name_bn,name_en) VALUES($1,'পরীক্ষা অফিস','Synthetic OTP office') RETURNING id) INSERT INTO tenant_wallets(tenant_id) SELECT id FROM created RETURNING tenant_id AS id",
      [`otp-${run}`],
    )
  ).rows[0].id;
});
after(async () => {
  setOtpProvider(logOtpProvider);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await db.end();
});

test("Phase 2c: a code is sent but never returned, stored hashed, and resend waits a minute", async () => {
  assert.equal((await request("GET", "/auth/otp/status")).body.available, true);
  assert.equal((await request("POST", "/auth/otp/signup", { mobile: "12345" })).body.error.code, "IDENTIFIER_INVALID");
  const mobile = freshMobile();
  const first = await request("POST", "/auth/otp/signup", { mobile: `+88 ${mobile}` });
  assert.equal(first.status, 202);
  assert.match(first.body.challengeToken, /^[a-f0-9]{64}$/);
  const code = lastCode(mobile);
  assert.match(code, /^\d{6}$/);
  assert.ok(!JSON.stringify(first.body).includes(code), "the code is never in the response");
  const stored = (await db.query("SELECT code_hash,identifier_digest FROM otp_challenges ORDER BY created_at DESC LIMIT 1")).rows[0];
  assert.ok(!JSON.stringify(stored).includes(code) && !JSON.stringify(stored).includes(mobile));
  const again = await request("POST", "/auth/otp/signup", { mobile });
  assert.equal(again.status, 429);
  assert.equal(again.body.error.code, "OTP_RATE_LIMIT");
});

test("Phase 2c: five wrong codes use up a challenge; the right code verifies once", async () => {
  const mobile = freshMobile();
  const challenge = (await request("POST", "/auth/otp/signup", { mobile })).body.challengeToken;
  const right = lastCode(mobile);
  const wrong = right === "000000" ? "111111" : "000000";
  const first = await request("POST", "/auth/otp/verify", { challengeToken: challenge, code: wrong });
  assert.equal(first.body.error.code, "OTP_INVALID");
  assert.match(first.body.error.message, /4 tries left/);
  for (let i = 0; i < 4; i++) await request("POST", "/auth/otp/verify", { challengeToken: challenge, code: wrong });
  const exhausted = await request("POST", "/auth/otp/verify", { challengeToken: challenge, code: right });
  assert.equal(exhausted.status, 410, "even the right code fails after five wrong tries");
  assert.equal((await request("POST", "/auth/otp/verify", { challengeToken: "f".repeat(64), code: right })).status, 410);
});

test("Phase 2c: registration with a verified mobile makes it a sign-in identifier; a code makes one account", async () => {
  const mobile = freshMobile();
  const token = await verified(mobile);
  const created = await request("POST", "/auth/signup", citizen({ mobile, otpToken: token }));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const signIn = await request("POST", "/auth/login", { identifierType: "mobile", identifier: mobile, password });
  assert.equal(signIn.status, 200, JSON.stringify(signIn.body));
  // The same verified code cannot open a second account.
  assert.equal((await request("POST", "/auth/signup", citizen({ mobile, otpToken: token }))).body.error.code, "IDENTIFIER_TAKEN");
  const otherMobile = freshMobile();
  const otherToken = await verified(otherMobile);
  assert.equal((await request("POST", "/auth/signup", citizen({ mobile: freshMobile(), otpToken: otherToken }))).body.error.code, "OTP_REQUIRED", "a code verifies only its own number");
  assert.equal((await request("POST", "/auth/signup", citizen({ mobile: otherMobile, otpToken: otherToken }))).status, 201);
  assert.equal((await request("POST", "/auth/signup", citizen({ mobile: freshMobile(), otpToken: otherToken }))).body.error.code, "OTP_REQUIRED", "a consumed code cannot be reused");
});

test("Phase 2c: an unverified code or a mobile without a code is refused; registration without a mobile still works", async () => {
  const mobile = freshMobile();
  const unverified = (await request("POST", "/auth/otp/signup", { mobile })).body.challengeToken;
  assert.equal((await request("POST", "/auth/signup", citizen({ mobile, otpToken: unverified }))).body.error.code, "OTP_REQUIRED");
  assert.ok([400, 422].includes((await request("POST", "/auth/signup", citizen({ mobile }))).status));
  assert.equal((await request("POST", "/auth/signup", citizen({}))).status, 201);
});

test("Phase 2c: without a provider the server reports OTP unavailable instead of pretending to send", async () => {
  setOtpProvider(null);
  try {
    assert.equal((await request("GET", "/auth/otp/status")).body.available, false);
    const r = await request("POST", "/auth/otp/signup", { mobile: freshMobile() });
    assert.equal(r.status, 503);
    assert.equal(r.body.error.code, "OTP_UNAVAILABLE");
  } finally {
    setOtpProvider({ async send({ mobile, code }) { sent.push({ mobile, code }); } });
  }
});
