/**
 * S-007 — the password-recovery token is never returned in JSON.
 *
 * The admin grant delivers the token out-of-band to the account
 * holder's own email (fragment link), or — where no mail provider is
 * configured — returns only a masked hint. Tests use synthetic staff
 * users in the seeded alpha office so no seeded account's password is
 * ever changed.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { hashPassword } from "../src/security.js";
import {
  logMailProvider,
  setMailProvider,
  type MailMessage,
} from "../src/mailer.js";

const db = new pg.Pool({ connectionString: adminConnectionString });
const password = randomBytes(12).toString("base64url");
const run = randomUUID().slice(0, 8);
let server: ReturnType<typeof app.listen>, base: string;
let officeAdmin: Session;
type Session = { cookie: string; csrf: string; user: any };
async function req(method: string, path: string, data?: unknown, session?: Session) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      ...(session ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json(),
  };
}
async function login(email: string, secret = password): Promise<Session> {
  const response = await req("POST", "/auth/login", { email, password: secret });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return {
    cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
    csrf: response.body.csrfToken,
    user: response.body.user,
  };
}
async function staffUser(name: string) {
  const email = `${name}-${run}@recovery-delivery.synthetic.test`;
  const alpha = (
    await db.query("SELECT id FROM tenants WHERE slug='alpha'")
  ).rows[0].id as string;
  const id = (
    await db.query(
      "INSERT INTO platform_users(email,display_name,password_hash) VALUES($1,'Synthetic recovery delivery test',$2) RETURNING id",
      [email, hashPassword(password)],
    )
  ).rows[0].id as string;
  await db.query(
    "INSERT INTO staff_memberships(user_id,tenant_id,role) VALUES($1,$2,'staff')",
    [id, alpha],
  );
  return { id, email };
}
function tokenFrom(mail: MailMessage[]): string {
  assert.equal(mail.length, 1, "exactly one delivery email is sent");
  const token = mail[0].text.match(/#token=([a-f0-9]{64})/)?.[1];
  assert.ok(token, "the email carries a fragment recovery link");
  assert.equal(
    mail[0].text.includes("/recover?token="),
    false,
    "the token is never in a URL query param",
  );
  return token!;
}

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  officeAdmin = await login("admin@alpha.local.test", "Demo-Phase1!");
});
after(async () => {
  setMailProvider(logMailProvider);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await db.end();
});

test("S-007: the grant returns no token — it is emailed, and recovery works end-to-end", async () => {
  const target = await staffUser("emailed");
  const mailSent: MailMessage[] = [];
  setMailProvider({ async send(m) { mailSent.push(m); } });
  const grant = await req(
    "POST",
    `/admin/users/${target.id}/recovery`,
    {},
    officeAdmin,
  );
  setMailProvider(logMailProvider);
  assert.equal(grant.status, 201, JSON.stringify(grant.body));
  assert.equal(grant.body.token, undefined);
  assert.equal(grant.body.recoveryUrl, undefined);
  assert.equal(
    /[a-f0-9]{64}/.test(JSON.stringify(grant.body)),
    false,
    "no 64-hex token anywhere in the response body",
  );
  assert.equal(grant.body.delivery, "EMAIL");
  assert.match(grant.body.recipientHint, /^e\*\*\*@recovery-delivery\.synthetic\.test$/);
  assert.equal(grant.headers.get("cache-control"), "no-store");
  const events = (
    await db.query(
      "SELECT metadata FROM audit_events WHERE actor_id=$1 AND action='PASSWORD_RECOVERY_CREATED' AND resource_id=$2",
      [officeAdmin.user.id, target.id],
    )
  ).rows;
  assert.equal(events.length, 1);
  assert.equal(events[0].metadata.delivery, "EMAIL");

  const token = tokenFrom(mailSent);
  const recovered = await req("POST", "/auth/recover", {
    token,
    newPassword: "Rec-Delivery-P1!",
  });
  assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
  assert.equal(
    (await req("POST", "/auth/recover", { token, newPassword: "Rec-Delivery-P1!" })).status,
    422,
    "the out-of-band token is one-use",
  );
  await login(target.email, "Rec-Delivery-P1!");
});

test("S-007: with no mail provider the grant returns only a masked hint", async () => {
  const target = await staffUser("unavailable");
  setMailProvider(null);
  const grant = await req(
    "POST",
    `/admin/users/${target.id}/recovery`,
    {},
    officeAdmin,
  );
  setMailProvider(logMailProvider);
  assert.equal(grant.status, 201, JSON.stringify(grant.body));
  assert.equal(grant.body.token, undefined);
  assert.equal(grant.body.recoveryUrl, undefined);
  assert.equal(
    /[a-f0-9]{64}/.test(JSON.stringify(grant.body)),
    false,
    "no 64-hex token anywhere in the response body",
  );
  assert.equal(grant.body.delivery, "UNAVAILABLE");
  assert.match(grant.body.tokenHint, /^…[a-f0-9]{4}$/);
  assert.equal(grant.headers.get("cache-control"), "no-store");
  const events = (
    await db.query(
      "SELECT metadata FROM audit_events WHERE actor_id=$1 AND action='PASSWORD_RECOVERY_CREATED' AND resource_id=$2",
      [officeAdmin.user.id, target.id],
    )
  ).rows;
  assert.equal(events.length, 1);
  assert.equal(events[0].metadata.delivery, "UNAVAILABLE");
});

test("S-007: a failed email delivery is reported, not hidden", async () => {
  const target = await staffUser("failed");
  setMailProvider({
    async send() {
      throw new Error("SMTP down (simulated)");
    },
  });
  const grant = await req(
    "POST",
    `/admin/users/${target.id}/recovery`,
    {},
    officeAdmin,
  );
  setMailProvider(logMailProvider);
  assert.equal(grant.status, 201, JSON.stringify(grant.body));
  assert.equal(grant.body.delivery, "EMAIL_FAILED");
  assert.equal(grant.body.token, undefined);
  assert.equal(grant.body.recoveryUrl, undefined);
});
