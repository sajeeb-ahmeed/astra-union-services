import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";

/**
 * F-001: the platform support contact is owner-configurable.
 *
 * GET /support-contact is public and returns the stored phone/email/hours
 * with empty defaults (an empty field is "not published", never a
 * placeholder). PUT /owner/support-contact is owner-only, needs a reason
 * of at least 8 characters, validates the email when non-empty, writes
 * only keys whose value actually changes, and lands one append-only
 * platform_setting_changes row per changed key.
 */
const admin = new pg.Pool({ connectionString: adminConnectionString });
type Session = { cookie: string; csrf: string; user: any };
let server: ReturnType<typeof app.listen>, base: string;
let owner: Session, approver: Session;
let original: { phone: string; email: string; hoursBn: string; hoursEn: string };
async function req(
  method: string,
  path: string,
  data?: unknown,
  session?: Session,
) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    redirect: "manual",
    headers: {
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      ...(session
        ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf }
        : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const type = response.headers.get("content-type") ?? "";
  const body = type.includes("application/json")
    ? await response.json()
    : await response.text();
  return { status: response.status, body, headers: response.headers };
}
async function login(email: string, secret = "Demo-Phase1!") {
  const r = await req("POST", "/auth/login", { email, password: secret });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return {
    cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "",
    csrf: r.body.csrfToken,
    user: r.body.user,
  } as Session;
}
async function auditCount(): Promise<number> {
  const r = await admin.query(
    "SELECT COUNT(*)::int AS n FROM platform_setting_changes WHERE key LIKE 'support_%'",
  );
  return r.rows[0].n as number;
}

before(async () => {
  process.env.NODE_ENV = "test";
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  owner = await login("owner@astra.demo.test");
  approver = await login("approver@alpha.local.test");
  const current = await req("GET", "/owner/support-contact", undefined, owner);
  assert.equal(current.status, 200, JSON.stringify(current.body));
  original = current.body;
});

after(async () => {
  // Restore the contact this file found, so later suites see the same
  // platform state they would have seen without it.
  await req(
    "PUT",
    "/owner/support-contact",
    { ...original, reason: "F-001 test cleanup — restore original contact" },
    owner,
  );
  await closePdfBrowser();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await admin.end();
});

test("F-001: public read returns the stored contact with empty defaults", async () => {
  const r = await req("GET", "/support-contact");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, original);
  for (const key of ["phone", "email", "hoursBn", "hoursEn"] as const)
    assert.equal(typeof r.body[key], "string", key);
});

test("F-001: owner save publishes the contact and audits each changed key", async () => {
  const beforeCount = await auditCount();
  const saved = await req(
    "PUT",
    "/owner/support-contact",
    {
      phone: "+8801712345678",
      email: "support@example.test",
      hoursBn: "শনি–বৃহস্পতি, সকাল ৯টা–বিকাল ৫টা",
      hoursEn: "Sat–Thu, 9am–5pm",
      reason: "F-001 test — publish a test support contact",
    },
    owner,
  );
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.phone, "+8801712345678");
  assert.equal(saved.body.email, "support@example.test");
  assert.equal(saved.body.hoursBn, "শনি–বৃহস্পতি, সকাল ৯টা–বিকাল ৫টা");
  assert.equal(saved.body.hoursEn, "Sat–Thu, 9am–5pm");
  const afterCount = await auditCount();
  // One audit row per key whose value actually changed (against the
  // contact this file found in `before` — normally all four on a fresh
  // seed, fewer if a previous run left values behind).
  const changed = [
    original.phone !== "+8801712345678",
    original.email !== "support@example.test",
    original.hoursBn !== "শনি–বৃহস্পতি, সকাল ৯টা–বিকাল ৫টা",
    original.hoursEn !== "Sat–Thu, 9am–5pm",
  ].filter(Boolean).length;
  assert.equal(afterCount - beforeCount, changed, "one audit row per changed key");
  const publicRead = await req("GET", "/support-contact");
  assert.equal(publicRead.status, 200, JSON.stringify(publicRead.body));
  assert.deepEqual(publicRead.body, saved.body);
});

test("F-001: a no-change save writes no audit rows; clearing a field hides it", async () => {
  const beforeCount = await auditCount();
  const same = await req(
    "PUT",
    "/owner/support-contact",
    {
      phone: "+8801712345678",
      email: "support@example.test",
      hoursBn: "শনি–বৃহস্পতি, সকাল ৯টা–বিকাল ৫টা",
      hoursEn: "Sat–Thu, 9am–5pm",
      reason: "F-001 test — repeat the same contact",
    },
    owner,
  );
  assert.equal(same.status, 200, JSON.stringify(same.body));
  assert.equal(await auditCount(), beforeCount, "no-change save must not audit");
  const cleared = await req(
    "PUT",
    "/owner/support-contact",
    {
      phone: "",
      email: "support@example.test",
      hoursBn: "শনি–বৃহস্পতি, সকাল ৯টা–বিকাল ৫টা",
      hoursEn: "Sat–Thu, 9am–5pm",
      reason: "F-001 test — clear the phone field",
    },
    owner,
  );
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
  assert.equal(cleared.body.phone, "");
  assert.equal((await auditCount()) - beforeCount, 1, "only the cleared key audits");
});

test("F-001: validation rejects a bad email and a short or missing reason", async () => {
  const badEmail = await req(
    "PUT",
    "/owner/support-contact",
    {
      phone: "",
      email: "not-an-email",
      hoursBn: "",
      hoursEn: "",
      reason: "F-001 test — bad email must fail",
    },
    owner,
  );
  assert.equal(badEmail.status, 422, JSON.stringify(badEmail.body));
  const shortReason = await req(
    "PUT",
    "/owner/support-contact",
    {
      phone: "",
      email: "",
      hoursBn: "",
      hoursEn: "",
      reason: "short",
    },
    owner,
  );
  assert.equal(shortReason.status, 422, JSON.stringify(shortReason.body));
  const noReason = await req(
    "PUT",
    "/owner/support-contact",
    { phone: "", email: "", hoursBn: "", hoursEn: "" },
    owner,
  );
  assert.equal(noReason.status, 422, JSON.stringify(noReason.body));
});

test("F-001: only the platform owner may read or write the owner endpoints", async () => {
  const getAsApprover = await req("GET", "/owner/support-contact", undefined, approver);
  assert.equal(getAsApprover.status, 403, JSON.stringify(getAsApprover.body));
  const putAsApprover = await req(
    "PUT",
    "/owner/support-contact",
    { phone: "", email: "", hoursBn: "", hoursEn: "", reason: "F-001 test — approver must fail" },
    approver,
  );
  assert.equal(putAsApprover.status, 403, JSON.stringify(putAsApprover.body));
  const getAnonymous = await req("GET", "/owner/support-contact");
  assert.equal(getAnonymous.status, 401, JSON.stringify(getAnonymous.body));
});
