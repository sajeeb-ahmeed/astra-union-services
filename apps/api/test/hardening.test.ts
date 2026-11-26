import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { demoPayloads } from "@astra/shared-schemas";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";
import { logOtpProvider } from "../src/otp.js";
import { logMailProvider, emailHint, setMailProvider, type MailMessage } from "../src/mailer.js";
import { logSmsProvider } from "../src/sms.js";
import { identifierHint } from "../src/identifiers.js";
import { isCommonPassword } from "../src/security.js";

/**
 * Security Hardening Build 01 — regression tests for Security Audit 01 findings:
 * F1 (log providers record hints only), F2 (malformed JSON is 400, not 500),
 * F5 (common-password blocklist at every set/change point), F7 (application
 * date-range bounds are bound parameters), F8 (LIKE metacharacters in search
 * input match literally). F3/F4/F6 are deploy-time or register items and have
 * no API behaviour to pin here.
 */

type Session = { cookie: string; csrf: string; user: any };
// Stage 6: the citizens search also matches a digits-only form of the query
// against synthetic_reference, so a random hex suffix containing digits can
// false-positive the digits branch in the F8 test (a digits substring of the
// run suffix matching the X citizen's reference). Keep the suffix digits-free
// (hex letters a-f only); uniqueness is unaffected and no other test in this
// file depends on digits in the suffix.
const run = randomUUID().replace(/[^a-f]/g, "").padEnd(8, "a").slice(0, 8);
const admin = new pg.Pool({ connectionString: adminConnectionString });
let server: ReturnType<typeof app.listen>, base: string;
let owner: Session;
let officeId = "";
const ADMIN_PASSWORD = "Hard-Admin-Pass1!";
const GOOD = "Hard-Test-Pass!42";
const BLOCKED = "password123456";
const BLOCKED_MIXED = "Password123456";

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
async function login(email: string, password: string): Promise<Session> {
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = await r.json();
  assert.equal(r.status, 200, JSON.stringify(json));
  const cookieHeader = r.headers.get("set-cookie");
  assert.ok(cookieHeader, "login must return a session cookie");
  return { cookie: cookieHeader.split(";")[0], csrf: json.csrfToken, user: json.user };
}
const officeBody = (extra: Record<string, unknown> = {}) => ({
  slug: `hardening-${run}`,
  nameBn: "পরীক্ষা অফিস",
  nameEn: `Hardening test office ${run}`,
  division: "Test Division",
  district: "Test District",
  upazila: "Test Upazila",
  officeType: "UNION",
  adminEmail: `admin@hardening-${run}.test`,
  adminName: "Hardening Test Admin",
  adminPassword: ADMIN_PASSWORD,
  ...extra,
});

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  owner = await login("owner@astra.demo.test", "Demo-Phase1!");
  const created = await req("POST", "/owner/tenants", officeBody(), owner);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  officeId = created.body.id;
  assert.ok(officeId, "office creation returns the tenant id");
});
after(async () => {
  await closePdfBrowser();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await admin.end();
  await pool.end();
});

test("Audit 01 F1: server log lines are hint-only; the dev outbox is a non-production mailbox; production writes neither secret nor outbox", async () => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  const size = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").length : 0);
  const delta = (file: string, from: number) => fs.readFileSync(file, "utf8").slice(from);
  const mobile = "01712345678";
  const secrets = ["654321", "TOPSECRETTOKEN", "CERT-NO-998877", mobile, "citizen@example.com"];
  const sends = async () => {
    await logOtpProvider.send({ mobile, code: "654321", purpose: "signup_mobile" });
    await logMailProvider.send({
      to: "citizen@example.com",
      subject: "Certificate issued — CERT-NO-998877",
      text: "Verify: https://du.test/verify-email?token=TOPSECRETTOKEN",
    });
    await logSmsProvider.send({
      mobile,
      message: "Certificate no: CERT-NO-998877",
      purpose: "certificate_issued",
    });
  };
  try {
    // Development mode: the server log is hint-only, while the git-ignored
    // outbox mailbox keeps the full content the browser suite depends on.
    const otpFrom = size(".runtime/otp-outbox.log");
    const mailFrom = size(".runtime/email-outbox.log");
    await sends();
    const logged = lines.join("\n");
    for (const secret of secrets)
      assert.ok(!logged.includes(secret), `server log must not contain ${secret}`);
    assert.ok(logged.includes(identifierHint("mobile", mobile)), "log line carries the mobile hint");
    assert.ok(logged.includes(emailHint("citizen@example.com")), "log line carries the email hint");
    assert.ok(delta(".runtime/otp-outbox.log", otpFrom).includes("654321"), "dev mailbox keeps the code outside production");
    assert.ok(delta(".runtime/email-outbox.log", mailFrom).includes("TOPSECRETTOKEN"), "dev mailbox keeps the message outside production");
    // Production mode: the outboxes are never written at all, and the log
    // lines stay hint-only — the F1 exposure is closed on the server.
    lines.length = 0;
    const before = {
      otp: size(".runtime/otp-outbox.log"),
      mail: size(".runtime/email-outbox.log"),
      sms: size(".runtime/sms-outbox.log"),
    };
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await sends();
    } finally {
      if (originalEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalEnv;
    }
    assert.equal(size(".runtime/otp-outbox.log"), before.otp, "production writes no OTP outbox");
    assert.equal(size(".runtime/email-outbox.log"), before.mail, "production writes no email outbox");
    assert.equal(size(".runtime/sms-outbox.log"), before.sms, "production writes no SMS outbox");
    const prodLogged = lines.join("\n");
    for (const secret of secrets)
      assert.ok(!prodLogged.includes(secret), `production server log must not contain ${secret}`);
    assert.ok(prodLogged.includes(identifierHint("mobile", mobile)), "production log line still carries the hint");
  } finally {
    console.log = original;
  }
});

test("Audit 01 F2: malformed JSON is a 400 INPUT_INVALID, not a 500", async () => {
  const response = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{\"email\":",
  });
  assert.equal(response.status, 400, "a body the parser rejected is a client error");
  const body = await response.json();
  assert.equal(body.error.code, "INPUT_INVALID");
  // Control: well-formed JSON with unknown credentials is still a 401.
  const ok = await req("POST", "/auth/login", { email: "nobody@nowhere.test", password: "whatever-12345" });
  assert.equal(ok.status, 401);
  assert.equal(ok.body.error.code, "INVALID_LOGIN");
});

test("Audit 01 F5: the blocklist itself — case-insensitive, and the seeded/test passwords are not on it", () => {
  assert.equal(isCommonPassword(BLOCKED), true);
  assert.equal(isCommonPassword(BLOCKED_MIXED), true, "matching is case-insensitive");
  assert.equal(isCommonPassword("Qwerty123456"), true);
  assert.equal(isCommonPassword(GOOD), false);
  assert.equal(isCommonPassword(ADMIN_PASSWORD), false);
  assert.equal(isCommonPassword("Demo-Phase1!"), false, "the seeded demo password must stay usable");
});

test("Audit 01 F5: tenant creation rejects a blocklisted admin password", async () => {
  const rejected = await req(
    "POST",
    "/owner/tenants",
    officeBody({ slug: `hardening-blocked-${run}`, adminPassword: BLOCKED }),
    owner,
  );
  assert.equal(rejected.status, 422, JSON.stringify(rejected.body));
  const count = (
    await admin.query("SELECT count(*)::int AS n FROM tenants WHERE slug=$1", [`hardening-blocked-${run}`])
  ).rows[0].n;
  assert.equal(count, 0, "no office was created with the blocklisted password");
});

test("Audit 01 F5: staff creation rejects a blocklisted password, accepts a normal one", async () => {
  const officeAdmin = await login(`admin@hardening-${run}.test`, ADMIN_PASSWORD);
  const payload = (password: string) => ({
    email: `staff-${password === BLOCKED ? "blocked" : "ok"}-${run}@hardening.test`,
    displayName: "Hardening Staff",
    password,
    role: "staff",
  });
  const rejected = await req("POST", "/admin/users", payload(BLOCKED), officeAdmin);
  assert.equal(rejected.status, 422, JSON.stringify(rejected.body));
  const created = await req("POST", "/admin/users", payload(GOOD), officeAdmin);
  assert.equal(created.status, 201, JSON.stringify(created.body));
});

test("Audit 01 F5: citizen signup rejects a blocklisted password, accepts a normal one", async () => {
  const payload = (email: string, password: string) => ({
    email,
    password,
    displayName: "Hardening Citizen",
    tenantId: officeId,
    nameBn: "হার্ডেনিং নাগরিক",
    nameEn: "Hardening Citizen",
    dateOfBirth: "1996-03-04",
    addressBn: "হার্ডেনিং ঠিকানা",
    addressEn: "Hardening address",
  });
  const rejected = await req("POST", "/auth/signup", payload(`blocked-${run}@hardening.test`, BLOCKED_MIXED));
  assert.equal(rejected.status, 422, JSON.stringify(rejected.body));
  const created = await req("POST", "/auth/signup", payload(`ok-${run}@hardening.test`, GOOD));
  assert.equal(created.status, 201, JSON.stringify(created.body));
});

test("Audit 01 F5: office registration rejects a blocklisted password, accepts a normal one", async () => {
  const payload = (email: string, password: string) => ({
    tenantId: officeId,
    accountType: "up_secretary",
    email,
    password,
    displayName: "Hardening Applicant",
  });
  const rejected = await req("POST", "/auth/office-registration", payload(`blocked-${run}@applicant.test`, BLOCKED));
  assert.equal(rejected.status, 422, JSON.stringify(rejected.body));
  const created = await req("POST", "/auth/office-registration", payload(`ok-${run}@applicant.test`, GOOD));
  assert.equal(created.status, 202, JSON.stringify(created.body));
});

test("Audit 01 F5: password change rejects a blocklisted new password, accepts a normal one", async () => {
  const officeAdmin = await login(`admin@hardening-${run}.test`, ADMIN_PASSWORD);
  const rejected = await req(
    "POST",
    "/auth/password",
    { currentPassword: ADMIN_PASSWORD, newPassword: BLOCKED },
    officeAdmin,
  );
  assert.equal(rejected.status, 422, JSON.stringify(rejected.body));
  // The old password still works (nothing changed), then a normal change succeeds.
  const stillAdmin = await login(`admin@hardening-${run}.test`, ADMIN_PASSWORD);
  const changed = await req(
    "POST",
    "/auth/password",
    { currentPassword: ADMIN_PASSWORD, newPassword: GOOD },
    stillAdmin,
  );
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  await login(`admin@hardening-${run}.test`, GOOD);
});

test("Audit 01 F5: recovery consume rejects a blocklisted new password and the token survives for a valid retry", async () => {
  const officeAdmin = await login(`admin@hardening-${run}.test`, GOOD);
  const target = await req(
    "POST",
    "/admin/users",
    { email: `recover-${run}@hardening.test`, displayName: "Hardening Recover", password: GOOD, role: "staff" },
    officeAdmin,
  );
  assert.equal(target.status, 201, JSON.stringify(target.body));
  // S-007: the grant no longer returns the token — it is delivered
  // out-of-band to the account holder's email. Capture the mail to
  // exercise the token, then restore the log provider.
  const mailSent: MailMessage[] = [];
  setMailProvider({ async send(m) { mailSent.push(m); } });
  const grant = await req("POST", `/admin/users/${target.body.id}/recovery`, {}, officeAdmin);
  setMailProvider(logMailProvider);
  assert.equal(grant.status, 201, JSON.stringify(grant.body));
  assert.equal(grant.body.token, undefined, "S-007: no plaintext token in the response");
  assert.equal(grant.body.recoveryUrl, undefined);
  assert.equal(grant.body.delivery, "EMAIL");
  const token = mailSent[0].text.match(/#token=([a-f0-9]{64})/)?.[1] as string;
  assert.ok(token, "the out-of-band email carries the fragment link");
  const rejected = await req("POST", "/auth/recover", { token, newPassword: BLOCKED });
  assert.equal(rejected.status, 422, JSON.stringify(rejected.body));
  const recovered = await req("POST", "/auth/recover", { token, newPassword: "Hard-Recovered-P1!" });
  assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
  await login(`recover-${run}@hardening.test`, "Hard-Recovered-P1!");
});

test("Audit 01 F7: application date-range bounds filter exactly as before, now as bound parameters", async () => {
  const staff = await login("staff@alpha.local.test", "Demo-Phase1!");
  const citizen = (await req("GET", "/citizens", undefined, staff)).body.items[0];
  const created = await req(
    "POST",
    "/applications",
    { citizenId: citizen.id, serviceNo: 45, payload: demoPayloads[45] },
    staff,
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id as string;
  const dhakaToday = () => new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10);
  const shift = (date: string, days: number) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const today = dhakaToday();
  const has = async (qs: string) => {
    const r = await req("GET", `/applications?${qs}&pageSize=100`, undefined, staff);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return (r.body.items as any[]).some((x) => x.id === id);
  };
  assert.equal(await has(`from=${today}&to=${today}`), true, "both bounds include today's application");
  assert.equal(await has(`from=${today}`), true, "from-only includes it (parameter position 7)");
  assert.equal(await has(`to=${today}`), true, "to-only includes it (parameter position 7)");
  assert.equal(await has(`from=${shift(today, 1)}`), false, "from tomorrow excludes it");
  assert.equal(await has(`to=${shift(today, -1)}`), false, "to yesterday excludes it");
  assert.equal(await has(`from=${shift(today, -1)}&to=${shift(today, -1)}`), false, "a past day excludes it");
});

test("Audit 01 F8: LIKE metacharacters in search input match literally, in citizens and applications", async () => {
  const staff = await login("staff@alpha.local.test", "Demo-Phase1!");
  const mk = async (nameEn: string) => {
    const r = await req(
      "POST",
      "/citizens",
      {
        nameBn: "হার্ডেনিং নাগরিক",
        nameEn,
        dateOfBirth: "1995-06-15",
        addressBn: "হার্ডেনিং ঠিকানা",
        addressEn: "Hardening address",
      },
      staff,
    );
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.id as string;
  };
  const underId = await mk(`Hardening Under_score ${run}`);
  const crossId = await mk(`Hardening UnderXscore ${run}`);
  const findCitizens = async (q: string) =>
    (await req("GET", `/citizens?q=${encodeURIComponent(q)}`, undefined, staff)).body;
  // "%" alone must match nothing: no name, reference or mobile contains a literal %.
  assert.equal((await findCitizens("%")).total, 0, "a bare % is not a wildcard any more");
  // "_" in the query matches only the literal underscore, not any character.
  const byUnderscore = await findCitizens(`Under_score ${run}`);
  const ids = (byUnderscore.items as any[]).map((c) => c.id);
  assert.ok(ids.includes(underId), "the underscore citizen is found");
  assert.ok(!ids.includes(crossId), "the X citizen is not matched by an underscore query");
  // Ordinary substring search is unchanged.
  const plain = await findCitizens(`UnderXscore ${run}`);
  assert.ok((plain.items as any[]).some((c) => c.id === crossId), "plain search still works");
  // The applications list shares the same normaliser.
  const apps = await req("GET", `/applications?q=${encodeURIComponent("%")}`, undefined, staff);
  assert.equal(apps.body.total, 0, "a bare % matches no application either");
});
