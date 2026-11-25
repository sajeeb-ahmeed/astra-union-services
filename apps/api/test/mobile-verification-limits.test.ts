/**
 * S-001 (Phase 4 Stage 1, P1) — OTP abuse limits for mobile verification.
 *
 * Split from mobile-verification.test.ts: the OTP router allows 20 requests
 * per minute per client, and one file cannot hold every verification test
 * plus the limit tests without tripping its own limiter. Each file runs its
 * own server process, so each has its own limiter budget.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { digest } from "../src/security.js";
import { identifierDigest } from "../src/identifiers.js";
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

async function request(method: string, path: string, data?: unknown) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return { status: response.status, body: await response.json() };
}
async function sendOtp(mobile: string) {
  const r = await request("POST", "/auth/otp/signup", { mobile });
  assert.equal(r.status, 202, JSON.stringify(r.body));
  return r.body.challengeToken as string;
}

before(async () => {
  setOtpProvider({ async send({ mobile, code }) { sent.push({ mobile, code }); } });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  tenantId = (
    await db.query(
      "WITH created AS (INSERT INTO tenants(slug,name_bn,name_en) VALUES($1,'পরীক্ষা অফিস','Mobile verification limits office') RETURNING id) INSERT INTO tenant_wallets(tenant_id) SELECT id FROM created RETURNING tenant_id AS id",
      [`mvl-${run}`],
    )
  ).rows[0].id;
});
after(async () => {
  setOtpProvider(logOtpProvider);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await db.end();
});

test("S-001: five wrong codes exhaust a challenge; the right code then fails too", async () => {
  const mobile = freshMobile();
  assert.equal(
    (await request("POST", "/auth/signup", { tenantId, name: "Exhaust Citizen", mobile, password })).status,
    201,
  );
  const token = await sendOtp(mobile);
  const right = lastCode(mobile);
  const wrong = right === "000000" ? "111111" : "000000";
  for (let i = 0; i < 4; i++)
    assert.equal((await request("POST", "/auth/otp/verify-mobile", { challengeToken: token, code: wrong, mobile })).status, 422);
  const fifth = await request("POST", "/auth/otp/verify-mobile", { challengeToken: token, code: wrong, mobile });
  assert.equal(fifth.status, 422);
  assert.match(fifth.body.error.message, /Ask for a new code/);
  assert.equal((await request("POST", "/auth/otp/verify-mobile", { challengeToken: token, code: right, mobile })).status, 410);
});

test("S-001: resend waits a minute; five codes in an hour hit the hourly limit", async () => {
  const mobile = freshMobile();
  await sendOtp(mobile);
  const tooSoon = await request("POST", "/auth/otp/signup", { mobile });
  assert.equal(tooSoon.status, 429);
  assert.equal(tooSoon.body.error.code, "OTP_RATE_LIMIT");
  // The hourly limit counts challenges for this number in the last hour.
  // Three prior challenges are seeded directly (same hashes the server
  // computes: token digest, identifier digest, code hash) instead of
  // waiting out three real resend windows: with the live first code that
  // makes four in the hour, so one more send is allowed and the next is not.
  for (let i = 0; i < 3; i++) {
    const token = randomBytes(32).toString("hex");
    await db.query(
      "INSERT INTO otp_challenges(token_hash,purpose,identifier_digest,code_hash,expires_at) VALUES($1,'signup_mobile',$2,$3,clock_timestamp() + interval '10 minutes')",
      [digest(token), identifierDigest("mobile", mobile), digest(`${token}:123456`)],
    );
  }
  // Fifth code in the hour is allowed (count was 4, resend window aged).
  await db.query("UPDATE otp_challenges SET created_at=created_at - interval '61 seconds' WHERE identifier_digest=$1", [
    identifierDigest("mobile", mobile),
  ]);
  const fifth = await request("POST", "/auth/otp/signup", { mobile });
  assert.equal(fifth.status, 202, JSON.stringify(fifth.body));
  // Sixth code in the hour is refused with the hourly message.
  await db.query("UPDATE otp_challenges SET created_at=created_at - interval '61 seconds' WHERE identifier_digest=$1", [
    identifierDigest("mobile", mobile),
  ]);
  const limited = await request("POST", "/auth/otp/signup", { mobile });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, "OTP_RATE_LIMIT");
  assert.match(limited.body.error.message, /hour/);
});
