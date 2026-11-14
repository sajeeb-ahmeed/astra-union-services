import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { hashPassword } from "../src/security.js";
import { identifierHint, normalizeIdentifier } from "../src/identifiers.js";

const db = new pg.Pool({ connectionString: adminConnectionString });
// Test-only credentials are generated per run so no password-like literal sits in the repository.
const password = randomBytes(18).toString("base64url");
const notThePassword = randomBytes(18).toString("base64url");
const run = randomUUID().slice(0, 8);
let server: ReturnType<typeof app.listen>, base: string;
type Session = { cookie: string; csrf: string };
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
async function signIn(body: Record<string, string>): Promise<Session & { status: number; body: any }> {
  const response = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  return {
    status: response.status,
    body: json,
    cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
    csrf: json.csrfToken,
  };
}
// Unique synthetic numbers per run so parallel or repeated runs never collide.
const tail = String(Date.now()).slice(-8);
const mobile = `017${tail}`;
const nid = `19${tail}${tail.slice(0, 7)}`.slice(0, 17);
const birthReg = `20${tail}${tail.slice(0, 7)}`.slice(0, 17);
let email: string, otherEmail: string, session: Session;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  const tenant = (
    await db.query(
      "WITH created AS (INSERT INTO tenants(slug,name_bn,name_en) VALUES($1,'পরীক্ষা অফিস','Synthetic identifier office') RETURNING id) INSERT INTO tenant_wallets(tenant_id) SELECT id FROM created RETURNING tenant_id AS id",
      [`identifiers-${run}`],
    )
  ).rows[0].id;
  for (const name of ["holder", "other"]) {
    const address = `${name}-${run}@identifiers.synthetic.test`;
    const id = (
      await db.query(
        "INSERT INTO platform_users(email,display_name,password_hash) VALUES($1,'Synthetic identifier test',$2) RETURNING id",
        [address, hashPassword(password)],
      )
    ).rows[0].id;
    await db.query("INSERT INTO staff_memberships(user_id,tenant_id,role) VALUES($1,$2,'staff')", [id, tenant]);
    if (name === "holder") email = address;
    else otherEmail = address;
  }
  session = await signIn({ email, password });
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await db.end();
});

test("Phase 2b: identifiers normalise Bangla digits, +880 and separators, and reject bad lengths", () => {
  assert.equal(normalizeIdentifier("mobile", "+880 1712-345678"), "01712345678");
  assert.equal(normalizeIdentifier("mobile", "০১৭১২৩৪৫৬৭৮"), "01712345678");
  assert.equal(normalizeIdentifier("mobile", "01212345678"), null);
  assert.equal(normalizeIdentifier("nid", "1234567890"), "1234567890");
  assert.equal(normalizeIdentifier("nid", "12345678901"), null);
  assert.equal(normalizeIdentifier("birth_reg", "2000123456789012"), null);
  assert.equal(normalizeIdentifier("email", "Person@Example.TEST"), "person@example.test");
  assert.equal(identifierHint("mobile", "01712345678"), "017******78");
  assert.equal(identifierHint("nid", "1234567890"), "••••890");
});

test("Phase 2b: an account holder sets identifiers with the current password; only a digest is stored", async () => {
  const wrong = await request("PUT", "/account/identifiers/mobile", { value: mobile, currentPassword: notThePassword }, session);
  assert.equal(wrong.body.error.code, "PASSWORD_MISMATCH");
  const invalid = await request("PUT", "/account/identifiers/nid", { value: "123", currentPassword: password }, session);
  assert.equal(invalid.body.error.code, "IDENTIFIER_INVALID");
  for (const [kind, value] of [["mobile", mobile], ["nid", nid], ["birth_reg", birthReg]]) {
    const set = await request("PUT", `/account/identifiers/${kind}`, { value, currentPassword: password }, session);
    assert.equal(set.status, 200, JSON.stringify(set.body));
  }
  const listed = await request("GET", "/account/identifiers", undefined, session);
  assert.equal(listed.body.available, true);
  assert.deepEqual(listed.body.items.map((i: any) => [i.kind, i.set]), [["mobile", true], ["nid", true], ["birth_reg", true]]);
  // The database holds digests and masked hints, never the numbers.
  const stored = (await db.query("SELECT kind,digest,hint FROM account_identifiers i JOIN platform_users u ON u.id=i.user_id WHERE u.email=$1", [email])).rows;
  assert.equal(stored.length, 3);
  for (const row of stored) {
    assert.match(row.digest, /^[a-f0-9]{64}$/);
    assert.ok(![mobile, nid, birthReg].some((n) => row.digest.includes(n) || row.hint.includes(n)));
  }
  const events = (await db.query("SELECT count(*)::int n FROM account_security_events e JOIN platform_users u ON u.id=e.user_id WHERE u.email=$1 AND e.action='SIGN_IN_IDENTIFIER_SET'", [email])).rows[0].n;
  assert.equal(events, 3);
  // Another account cannot claim the same number.
  const other = await signIn({ email: otherEmail, password });
  const taken = await request("PUT", "/account/identifiers/mobile", { value: mobile, currentPassword: password }, other);
  assert.equal(taken.status, 409);
});

test("Phase 2b: sign-in by mobile, NID or birth registration; unknown and wrong give the same answer", async () => {
  for (const [identifierType, identifier] of [
    ["mobile", `+88${mobile}`],
    ["nid", nid],
    ["birth_reg", birthReg],
    ["email", email.toUpperCase()],
  ]) {
    const result = await signIn({ identifierType, identifier, password });
    assert.equal(result.status, 200, `${identifierType}: ${JSON.stringify(result.body)}`);
    assert.equal(result.body.user.email, email);
  }
  assert.equal((await signIn({ email, password })).status, 200, "legacy email body still works");
  const unknown = await signIn({ identifierType: "nid", identifier: "9999999999", password });
  const wrong = await signIn({ identifierType: "nid", identifier: nid, password: notThePassword });
  const malformed = await signIn({ identifierType: "mobile", identifier: "abc", password });
  for (const r of [unknown, wrong, malformed]) {
    assert.equal(r.status, 401);
    assert.deepEqual(r.body, wrong.body);
  }
});

test("Phase 2b: failed attempts pause one identifier for every kind alike; success resets the count", async () => {
  const wrongPassword = notThePassword;
  // Ten failures pause an identifier, even an unregistered one, so probing gets the same answer.
  const target = `018${tail}`;
  for (let i = 0; i < 10; i++)
    assert.equal((await signIn({ identifierType: "mobile", identifier: target, password: wrongPassword })).status, 401);
  const limited = await signIn({ identifierType: "mobile", identifier: target, password });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, "RATE_LIMIT");
  // A success clears the count: nine failures, a success, then nine more failures stay 401.
  // (Birth registration has no failures from earlier tests; the NID already has one.)
  for (let i = 0; i < 9; i++) await signIn({ identifierType: "birth_reg", identifier: birthReg, password: wrongPassword });
  assert.equal((await signIn({ identifierType: "birth_reg", identifier: birthReg, password })).status, 200);
  for (let i = 0; i < 9; i++)
    assert.equal((await signIn({ identifierType: "birth_reg", identifier: birthReg, password: wrongPassword })).status, 401);
  assert.equal((await signIn({ identifierType: "birth_reg", identifier: birthReg, password })).status, 200);
});

test("Phase 2b: removing an identifier needs the password and stops it signing in", async () => {
  assert.equal((await request("DELETE", "/account/identifiers/birth_reg", { currentPassword: "nope" }, session)).body.error.code, "PASSWORD_MISMATCH");
  const removed = await request("DELETE", "/account/identifiers/birth_reg", { currentPassword: password }, session);
  assert.equal(removed.status, 200);
  assert.equal((await signIn({ identifierType: "birth_reg", identifier: birthReg, password })).status, 401);
});
