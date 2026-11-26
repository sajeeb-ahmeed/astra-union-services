import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { getDemoPayload } from "@astra/shared-schemas";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";
import {
  logMailProvider,
  setMailProvider,
} from "../src/mailer.js";
import { logSmsProvider, setSmsProvider } from "../src/sms.js";

/**
 * W-010: notification delivery is now recorded honestly. Before this
 * change the status notifiers discarded the send result, so nothing
 * distinguished "sent" from "no provider configured" or "reached no
 * handset". Each attempted channel leaves one row in
 * notification_deliveries: sent (real provider), logged (log provider —
 * recorded locally, reached nobody, never reported as sent), failed
 * (provider threw), unavailable (no provider), no_contact (no usable
 * address/mobile). The owner health endpoint reports the configured
 * providers and whether the deployment is ready for live notifications.
 */
const SERVICE = 45;
const run = randomUUID().slice(0, 8);
const password = "W010-Notify-123!";
const admin = new pg.Pool({ connectionString: adminConnectionString });
type Session = { cookie: string; csrf: string; user: any };
let server: ReturnType<typeof app.listen>, base: string;
let owner: Session, office: any;
const sessions: Record<string, Session> = {};
const citizens: Record<string, string> = {};
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
async function login(email: string, secret = password) {
  const r = await req("POST", "/auth/login", { email, password: secret });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return {
    cookie: r.headers.get("set-cookie")!.split(";")[0],
    csrf: r.body.csrfToken,
    user: r.body.user,
  } as Session;
}
async function signupCitizen(key: string, withMobile: boolean) {
  const email = `${key}-${run}@synthetic.test`;
  const r = await req("POST", "/auth/signup", {
    email,
    password,
    displayName: `W-010 Citizen ${key}`,
    tenantId: office.id,
    nameBn: "পরীক্ষা নাগরিক",
    nameEn: `W-010 Citizen ${key}`,
    dateOfBirth: "1998-02-03",
    addressBn: "পরীক্ষা ঠিকানা",
    addressEn: "Test address only",
    syntheticReference: `REF-W010-${key}-${run}`,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const session = await login(email);
  sessions[key] = session;
  citizens[key] = (
    await req("GET", "/citizens", undefined, session)
  ).body.items[0].id;
  if (withMobile)
    await admin.query(
      "UPDATE citizens SET contact_mobile=$2 WHERE id=$1",
      [citizens[key], "01712345678"],
    );
  return session;
}
async function submitAndReject(citizenKey: string) {
  const created = await req(
    "POST",
    "/applications",
    {
      citizenId: citizens[citizenKey],
      serviceNo: SERVICE,
      payload: { ...getDemoPayload(SERVICE), delivery_language: "bn" },
    },
    sessions.staff,
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const submitted = await req(
    "POST",
    `/applications/${created.body.id}/transition`,
    { action: "submit" },
    sessions.staff,
  );
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  const rejected = await req(
    "POST",
    `/applications/${created.body.id}/transition`,
    { action: "reject", reason: "Synthetic W-010 rejection" },
    sessions.approver,
  );
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
  return created.body.id as string;
}
async function deliveries(id: string, session: Session = sessions.staff) {
  const r = await req(
    "GET",
    `/applications/${id}/notification-deliveries`,
    undefined,
    session,
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.items as any[];
}
function statusOf(items: any[], channel: string) {
  return items.find((i) => i.channel === channel)?.status;
}

before(async () => {
  process.env.NODE_ENV = "test";
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  owner = await login("owner@astra.demo.test", "Demo-Phase1!");
  const slug = `w010-${run}`;
  const created = await req(
    "POST",
    "/owner/tenants",
    {
      slug,
      nameBn: "ডব্লিউ-০১০ পরীক্ষা অফিস",
      nameEn: "W-010 test office",
      division: "Test Division",
      district: "Test District",
      upazila: "Test Upazila",
      officeType: "UNION",
      adminEmail: `admin@${slug}.test`,
      adminName: "W-010 Admin",
      adminPassword: password,
    },
    owner,
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  office = created.body;
  const adminSession = await login(`admin@${slug}.test`);
  sessions.admin = adminSession;
  for (const roleName of ["approver", "staff"]) {
    const u = await req(
      "POST",
      "/admin/users",
      {
        email: `${roleName}@${slug}.test`,
        displayName: `W-010 ${roleName}`,
        password,
        role: roleName,
      },
      adminSession,
    );
    assert.equal(u.status, 201, JSON.stringify(u.body));
    sessions[roleName] = await login(`${roleName}@${slug}.test`);
  }
  const auth = await req(
    "PUT",
    `/admin/authorizations/${sessions.approver.user.id}/${SERVICE}`,
    { active: true, authorityNote: "Synthetic W-010 approval authority" },
    adminSession,
  );
  assert.equal(auth.status, 200, JSON.stringify(auth.body));
  // The submit settles a credit fee (service 45 costs 5); fund the wallet
  // so submits succeed. The fee itself is not under test here.
  const funded = await req(
    "POST",
    `/owner/tenants/${office.id}/adjust`,
    { delta: 100, reason: "Synthetic W-010 test funding" },
    owner,
  );
  assert.equal(funded.status, 201, JSON.stringify(funded.body));
  await signupCitizen("citizenA", true);
  await signupCitizen("citizenB", false);
});
after(async () => {
  setMailProvider(logMailProvider, "log");
  setSmsProvider(logSmsProvider);
  await closePdfBrowser();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await admin.end();
});

test("W-010: with the log providers a rejection is recorded as logged, never sent", async () => {
  const id = await submitAndReject("citizenA");
  const items = await deliveries(id);
  assert.equal(items.length, 2, JSON.stringify(items));
  assert.equal(statusOf(items, "email"), "logged");
  assert.equal(statusOf(items, "sms"), "logged");
  assert.ok(items.every((i) => i.kind === "APPLICATION_REJECTED"));
  assert.ok(!items.some((i) => i.status === "sent"), "a log-provider message is never reported as sent");
});

test("W-010: the owner health endpoint reports log providers and not-ready-for-live", async () => {
  const r = await req("GET", "/owner/notification-health", undefined, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.email.provider, "log");
  assert.equal(r.body.email.available, true);
  assert.equal(r.body.email.logOnly, true);
  assert.equal(r.body.sms.provider, "log");
  assert.equal(r.body.sms.logOnly, true);
  assert.equal(r.body.otp.provider, "log");
  assert.equal(r.body.readyForLive, false);
  assert.ok(r.body.warnings.length > 0, "the log providers are warned about");
  assert.equal(
    (await req("GET", "/owner/notification-health", undefined, sessions.admin)).status,
    403,
  );
});

test("W-010: with no provider configured the outcome is unavailable", async () => {
  setMailProvider(null);
  setSmsProvider(null);
  try {
    const id = await submitAndReject("citizenA");
    const items = await deliveries(id);
    assert.equal(statusOf(items, "email"), "unavailable");
    assert.equal(statusOf(items, "sms"), "unavailable");
  } finally {
    setMailProvider(logMailProvider, "log");
    setSmsProvider(logSmsProvider);
  }
});

test("W-010: a throwing provider is recorded as failed", async () => {
  setMailProvider({
    send: async () => {
      throw new Error("Synthetic mail failure");
    },
  });
  setSmsProvider({
    send: async () => {
      throw new Error("Synthetic sms failure");
    },
  });
  try {
    const id = await submitAndReject("citizenA");
    const items = await deliveries(id);
    assert.equal(statusOf(items, "email"), "failed");
    assert.equal(statusOf(items, "sms"), "failed");
  } finally {
    setMailProvider(logMailProvider, "log");
    setSmsProvider(logSmsProvider);
  }
});

test("W-010: a citizen with no usable contact is recorded as no_contact", async () => {
  // Citizen B has no mobile; give them the placeholder (no-email) address
  // the system uses for accounts without an email.
  await admin.query(
    "UPDATE platform_users SET email=$2 WHERE id=$1",
    [
      sessions.citizenB.user.id,
      `citizen-${sessions.citizenB.user.id}@no-email.digitalunion.invalid`,
    ],
  );
  const id = await submitAndReject("citizenB");
  const items = await deliveries(id);
  assert.equal(statusOf(items, "email"), "no_contact");
  assert.equal(statusOf(items, "sms"), "no_contact");
});

test("W-010: delivery rows are scoped — another citizen cannot read them", async () => {
  const id = await submitAndReject("citizenA");
  assert.equal((await deliveries(id, sessions.staff)).length, 2);
  assert.equal((await deliveries(id, sessions.citizenA)).length, 2);
  assert.equal(
    (
      await req(
        "GET",
        `/applications/${id}/notification-deliveries`,
        undefined,
        sessions.citizenB,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await req(
        "GET",
        `/applications/${id}/notification-deliveries`,
        undefined,
        undefined,
      )
    ).status,
    401,
  );
});
