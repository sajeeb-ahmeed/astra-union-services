import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { demoPayloads } from "@astra/shared-schemas";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { digest } from "../src/security.js";
import { logMailProvider, sendEmail, setMailProvider, type MailMessage } from "../src/mailer.js";
import { logSmsProvider, sendStatusSms, setSmsProvider, type SmsMessage } from "../src/sms.js";
import { closePdfBrowser } from "../src/pdf.js";

process.env.NODE_ENV = "test";
const db = new pg.Pool({ connectionString: adminConnectionString });
// Test-only credentials are generated per run so no password-like literal sits in the repository.
const password = randomBytes(18).toString("base64url");
const run = randomUUID().slice(0, 8);
const citizenMobile = `017${String(Date.now()).slice(-8)}`;
let server: ReturnType<typeof app.listen>, base: string, tenantId: string, citizenId: string;
let originalContactMobile: string | null = null;
const mailSent: MailMessage[] = [];
const smsSent: SmsMessage[] = [];
type Session = { cookie: string; csrf: string };
const sessions = new Map<string, Session>();

async function request(method: string, path: string, data?: unknown, session?: Session) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      ...(session ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {}, headers: response.headers };
}
async function login(email: string, pass: string): Promise<Session> {
  const r = await request("POST", "/auth/login", { email, password: pass });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const session = { cookie: r.headers.get("set-cookie")!.split(";")[0], csrf: r.body.csrfToken };
  sessions.set(email, session);
  return session;
}
function citizenPayload(n: number) {
  return {
    email: `phasex-${run}-${n}@phasex.synthetic.test`,
    password,
    displayName: "Synthetic Phase X Citizen",
    tenantId,
    nameBn: "পরীক্ষা নাগরিক",
    nameEn: "Synthetic Phase X Citizen",
    dateOfBirth: "2000-01-01",
    addressBn: "পরীক্ষা ঠিকানা",
    addressEn: "Synthetic address",
  };
}
const tokenFromMail = (mail: MailMessage) => {
  const match = mail.text.match(/verify-email\?token=([a-f0-9]{64})/);
  assert.ok(match, `verification link present in: ${mail.text}`);
  return match![1];
};
const mailTo = (email: string) => [...mailSent].reverse().find((m) => m.to === email);

before(async () => {
  setMailProvider({ async send(m) { mailSent.push(m); } });
  setSmsProvider({ async send(m) { smsSent.push(m); } });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  tenantId = (
    await db.query(
      "WITH created AS (INSERT INTO tenants(slug,name_bn,name_en) VALUES($1,'পরীক্ষা অফিস','Synthetic Phase X office') RETURNING id) INSERT INTO tenant_wallets(tenant_id) SELECT id FROM created RETURNING tenant_id AS id",
      [`phasex-${run}`],
    )
  ).rows[0].id;
  // Seeded alpha office actors for the workflow tests (same fixtures as approval-chain).
  await login("staff@alpha.demo.test", "Demo-Phase1!");
  await login("approver@alpha.demo.test", "Demo-Phase1!");
  const citizen = await login("citizen@alpha.demo.test", "Demo-Phase1!");
  citizenId = (await request("GET", "/citizens", undefined, citizen)).body.items[0].id;
  const row = (
    await db.query(
      "SELECT c.contact_mobile FROM citizens c JOIN platform_users u ON u.id=c.user_id WHERE u.email='citizen@alpha.demo.test'",
    )
  ).rows[0];
  originalContactMobile = row.contact_mobile;
  await db.query("UPDATE citizens SET contact_mobile=$1 WHERE id=$2", [citizenMobile, citizenId]);
});
after(async () => {
  await db.query("UPDATE citizens SET contact_mobile=$1 WHERE id=$2", [originalContactMobile, citizenId]);
  setMailProvider(logMailProvider);
  setSmsProvider(logSmsProvider);
  await closePdfBrowser();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await db.end();
});

test("Phase X: the log transports write the server-log line and the dev outbox record", async () => {
  setMailProvider(logMailProvider);
  setSmsProvider(logSmsProvider);
  try {
    const marker = `phasex-marker-${run}`;
    assert.equal(await sendEmail({ to: `log-${run}@phasex.synthetic.test`, subject: marker, text: `body ${marker}` }), true);
    const mailOutbox = fs.readFileSync(".runtime/email-outbox.log", "utf8");
    assert.ok(mailOutbox.includes(marker), "email outbox carries the message");
    assert.equal(
      await sendStatusSms({ mobile: citizenMobile, message: `status ${marker}`, purpose: "certificate_issued" }),
      true,
    );
    const smsOutbox = fs.readFileSync(".runtime/sms-outbox.log", "utf8");
    assert.ok(smsOutbox.includes(`status ${marker}`), "sms outbox carries the message");
  } finally {
    setMailProvider({ async send(m) { mailSent.push(m); } });
    setSmsProvider({ async send(m) { smsSent.push(m); } });
  }
});

test("Phase X: status surface reports email availability; health carries the emailDelivery flag", async () => {
  const status = await request("GET", "/auth/email/status");
  assert.equal(status.status, 200);
  assert.equal(status.body.available, true);
  assert.equal(status.body.ttlHours, 24);
  const health = await request("GET", "/health");
  assert.equal(health.body.features.emailDelivery, true);
});

test("Phase X: signup emails a verification link; only its digest is stored; the link verifies once and never gates sign-in", async () => {
  const payload = citizenPayload(1);
  const created = await request("POST", "/auth/signup", payload);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.emailVerification, "sent");
  const mail = mailTo(payload.email);
  assert.ok(mail, "a verification email was sent to the new account");
  assert.match(mail.subject, /Verify your email/);
  const token = tokenFromMail(mail);
  const stored = (
    await db.query("SELECT * FROM email_verification_tokens WHERE email=$1", [payload.email])
  ).rows[0];
  assert.equal(stored.token_hash, digest(token), "only the digest is stored");
  assert.ok(!JSON.stringify(stored).includes(token), "the plaintext token is nowhere in the row");
  const beforeVerify = (
    await db.query("SELECT email_verified_at FROM platform_users WHERE email=$1", [payload.email])
  ).rows[0];
  assert.equal(beforeVerify.email_verified_at, null);
  // Sign-in is not blocked by the unverified address, and the profile says so.
  const session = await login(payload.email, password);
  const meBefore = await request("GET", "/auth/me", undefined, session);
  assert.equal(meBefore.body.user.emailVerified, false);
  const verified = await request("POST", "/auth/email/verify", { token });
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  assert.equal(verified.body.verified, true);
  const meAfter = await request("GET", "/auth/me", undefined, session);
  assert.equal(meAfter.body.user.emailVerified, true);
  // One use only; an unknown token gets the same answer (no oracle).
  const reused = await request("POST", "/auth/email/verify", { token });
  assert.equal(reused.status, 422);
  assert.equal(reused.body.error.code, "EMAIL_VERIFICATION_INVALID");
  const bogus = await request("POST", "/auth/email/verify", { token: "f".repeat(64) });
  assert.equal(bogus.status, 422);
  assert.equal(bogus.body.error.code, "EMAIL_VERIFICATION_INVALID");
});

test("Phase X: an expired verification link is rejected", async () => {
  const payload = citizenPayload(2);
  assert.equal((await request("POST", "/auth/signup", payload)).status, 201);
  const token = tokenFromMail(mailTo(payload.email)!);
  // Age the token past its TTL (created_at moves too: the row requires expires_at > created_at).
  await db.query(
    "UPDATE email_verification_tokens SET created_at=now() - interval '2 days', expires_at=now() - interval '1 minute' WHERE token_hash=$1",
    [digest(token)],
  );
  const r = await request("POST", "/auth/email/verify", { token });
  assert.equal(r.status, 422);
  assert.equal(r.body.error.code, "EMAIL_VERIFICATION_INVALID");
});

test("Phase X: resend is rate-limited, retires the old link, and stops once verified", async () => {
  const payload = citizenPayload(3);
  assert.equal((await request("POST", "/auth/signup", payload)).status, 201);
  const firstToken = tokenFromMail(mailTo(payload.email)!);
  const session = await login(payload.email, password);
  // The signup message was sent a moment ago: an immediate resend waits, like OTP.
  const tooSoon = await request("POST", "/auth/email/resend", {}, session);
  assert.equal(tooSoon.status, 429);
  assert.equal(tooSoon.body.error.code, "EMAIL_RATE_LIMIT");
  await db.query(
    "UPDATE email_verification_tokens SET created_at=now() - interval '3 minutes' WHERE email=$1",
    [payload.email],
  );
  const resent = await request("POST", "/auth/email/resend", {}, session);
  assert.equal(resent.status, 202, JSON.stringify(resent.body));
  assert.equal(resent.body.sent, true);
  const secondToken = tokenFromMail(mailTo(payload.email)!);
  assert.notEqual(secondToken, firstToken);
  assert.equal((await request("POST", "/auth/email/verify", { token: firstToken })).status, 422, "the retired link is dead");
  assert.equal((await request("POST", "/auth/email/verify", { token: secondToken })).status, 200);
  const again = await request("POST", "/auth/email/resend", {}, session);
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, "EMAIL_ALREADY_VERIFIED");
});

async function submittedApplication() {
  const staff = sessions.get("staff@alpha.demo.test")!;
  const created = await request(
    "POST",
    "/applications",
    { citizenId, serviceNo: 45, payload: demoPayloads[45] },
    staff,
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id as string;
  const submitted = await request("POST", `/applications/${id}/transition`, { action: "submit" }, staff);
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  return id;
}

test("Phase X: issuance emails and texts the citizen with the certificate number", async () => {
  const id = await submittedApplication();
  mailSent.length = 0;
  smsSent.length = 0;
  const approver = sessions.get("approver@alpha.demo.test")!;
  const approved = await request("POST", `/applications/${id}/transition`, { action: "approve" }, approver);
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.state, "ISSUED");
  const number = approved.body.certificate.number as string;
  const mail = mailTo("citizen@alpha.demo.test");
  assert.ok(mail, "an issuance email reached the citizen");
  assert.ok(mail.text.includes(number), "the email carries the certificate number");
  const sms = smsSent.find((m) => m.purpose === "certificate_issued");
  assert.ok(sms, "an issuance status SMS was emitted");
  assert.equal(sms.mobile, citizenMobile);
  assert.ok(sms.message.includes(number), "the SMS carries the certificate number");
});

test("Phase X: rejection emails and texts the citizen with the chairman's reason", async () => {
  const id = await submittedApplication();
  mailSent.length = 0;
  smsSent.length = 0;
  const approver = sessions.get("approver@alpha.demo.test")!;
  const reason = "Phase X test — supporting documents do not match";
  const rejected = await request("POST", `/applications/${id}/transition`, { action: "reject", reason }, approver);
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
  assert.equal(rejected.body.state, "REJECTED");
  const mail = mailTo("citizen@alpha.demo.test");
  assert.ok(mail, "a rejection email reached the citizen");
  assert.ok(mail.text.includes(reason), "the email carries the reason verbatim");
  const sms = smsSent.find((m) => m.purpose === "application_rejected");
  assert.ok(sms, "a rejection status SMS was emitted");
  assert.equal(sms.mobile, citizenMobile);
  assert.ok(sms.message.includes(reason), "the SMS carries the reason verbatim");
});

test("Phase X: without providers the status is honestly unavailable and business flows still complete", async () => {
  setMailProvider(null);
  setSmsProvider(null);
  try {
    assert.equal((await request("GET", "/auth/email/status")).body.available, false);
    const payload = citizenPayload(4);
    const created = await request("POST", "/auth/signup", payload);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.emailVerification, "unavailable");
    const id = await submittedApplication();
    const approver = sessions.get("approver@alpha.demo.test")!;
    const approved = await request("POST", `/applications/${id}/transition`, { action: "approve" }, approver);
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.state, "ISSUED");
  } finally {
    setMailProvider({ async send(m) { mailSent.push(m); } });
    setSmsProvider({ async send(m) { smsSent.push(m); } });
  }
});
