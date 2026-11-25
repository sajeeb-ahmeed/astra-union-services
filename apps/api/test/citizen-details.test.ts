import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { hashPassword } from "../src/security.js";
import { decryptNumber, encryptNumber } from "../src/citizen-data.js";

const db = new pg.Pool({ connectionString: adminConnectionString });
// Test-only credentials are generated per run so no password-like literal sits in the repository.
const password = randomBytes(12).toString("base64url");
const run = randomUUID().slice(0, 8);
let server: ReturnType<typeof app.listen>, base: string, tenantId: string, otherTenantId: string;
type Session = { cookie: string; csrf: string };
const s: Record<string, Session> = {};
async function req(method: string, path: string, data?: unknown, session?: Session) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      ...(session ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}
async function signIn(email: string): Promise<Session> {
  const response = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = await response.json();
  assert.equal(response.status, 200, JSON.stringify(json));
  return { cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "", csrf: json.csrfToken };
}
async function office(label: string) {
  return (
    await db.query(
      "WITH created AS (INSERT INTO tenants(slug,name_bn,name_en) VALUES($1,'পরীক্ষা অফিস','Synthetic citizen details office') RETURNING id) INSERT INTO tenant_wallets(tenant_id) SELECT id FROM created RETURNING tenant_id AS id",
      [`details-${label}-${run}`],
    )
  ).rows[0].id as string;
}
async function user(name: string) {
  const email = `${name}-${run}@details.synthetic.test`;
  const id = (
    await db.query(
      "INSERT INTO platform_users(email,display_name,password_hash) VALUES($1,'Synthetic details test',$2) RETURNING id",
      [email, hashPassword(password)],
    )
  ).rows[0].id as string;
  return { email, id };
}
// Unique synthetic numbers per run so repeated runs never collide.
const tail = String(Date.now()).slice(-8);
const nid = `19${tail}${tail.slice(0, 7)}`.slice(0, 17);
const birthReg = `20${tail}${tail.slice(0, 7)}`.slice(0, 17);
const person = {
  nameBn: "বিস্তারিত নাগরিক",
  nameEn: "Details Citizen",
  dateOfBirth: "1988-03-04",
  addressBn: "স্থায়ী ঠিকানা গ্রাম",
  addressEn: "Permanent village address",
};
let citizenOwnId: string;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  tenantId = await office("main");
  otherTenantId = await office("other");
  for (const [name, role, tenant] of [
    ["staff", "staff", tenantId],
    ["reviewer", "reviewer", tenantId],
    ["outsider", "staff", otherTenantId],
    // S-010 interaction: plain staff is 403 ROLE_DENIED on the identity
    // endpoint before any isolation check runs, so the cross-tenant
    // identity assertion needs a caller who passes the role gate.
    ["outsiderAdmin", "admin", otherTenantId],
  ] as const) {
    const u = await user(name);
    await db.query("INSERT INTO staff_memberships(user_id,tenant_id,role) VALUES($1,$2,$3)", [u.id, tenant, role]);
    s[name] = await signIn(u.email);
  }
  const signup = await req("POST", "/auth/signup", {
    ...person,
    email: `self-${run}@details.synthetic.test`,
    password,
    displayName: "Self-service details citizen",
    tenantId,
  });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  s.self = await signIn(`self-${run}@details.synthetic.test`);
  citizenOwnId = (await db.query("SELECT id FROM citizens WHERE tenant_id=$1 AND full_name_en=$2", [tenantId, person.nameEn]))
    .rows[0].id;
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await db.end();
});

test("Phase 3a: numbers are AES-GCM encrypted and bound to their office and kind", () => {
  const sealed = encryptNumber(nid, tenantId, "nid");
  assert.doesNotMatch(sealed, new RegExp(nid));
  assert.notEqual(sealed, encryptNumber(nid, tenantId, "nid"), "a fresh nonce per encryption");
  assert.equal(decryptNumber(sealed, tenantId, "nid"), nid);
  assert.throws(() => decryptNumber(sealed, otherTenantId, "nid"));
  assert.throws(() => decryptNumber(sealed, tenantId, "birth_reg"));
});

test("Phase 3a: staff register a citizen with details; lists show only hints and identity reads are audited", async () => {
  const created = await req(
    "POST",
    "/citizens",
    {
      ...person,
      nameEn: "Registered Details Citizen",
      details: {
        gender: "female",
        fatherNameBn: "পিতার নাম",
        fatherNameEn: "Father Name",
        motherNameEn: "Mother Name",
        bloodGroup: "O+",
        nid: nid.split("").join(" "),
        mobile: "+880 1712-345678",
      },
    },
    s.staff,
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const c = created.body;
  assert.equal(c.gender, "female");
  assert.equal(c.bloodGroup, "O+");
  assert.equal(c.nidHint, `••••${nid.slice(-3)}`);
  assert.equal(c.contactMobile, "01712345678");
  assert.equal(c.noMobile, false);
  assert.equal(JSON.stringify(c).includes(nid), false, "the full NID is not in the response");

  // At rest: ciphertext and digest, never the plain number.
  const row = (await db.query("SELECT * FROM citizens WHERE id=$1", [c.id])).rows[0];
  assert.match(row.nid_cipher, /^v1\./);
  assert.equal(JSON.stringify(row).includes(nid), false);
  assert.match(row.nid_digest, /^[a-f0-9]{64}$/);

  const list = await req("GET", "/citizens", undefined, s.staff);
  assert.equal(list.status, 200);
  assert.equal(JSON.stringify(list.body).includes(nid), false, "lists never carry full numbers");

  const identity = await req("GET", `/citizens/${c.id}/identity`, undefined, s.reviewer);
  assert.equal(identity.status, 200, JSON.stringify(identity.body));
  assert.deepEqual(identity.body, { nid, birthReg: null, available: true });
  assert.equal(identity.headers.get("cache-control"), "no-store");
  const audits = await db.query(
    "SELECT count(*)::int n FROM audit_events WHERE tenant_id=$1 AND action='CITIZEN_IDENTITY_VIEWED' AND resource_id=$2",
    [tenantId, c.id],
  );
  assert.equal(audits.rows[0].n, 1);

  // A reviewer may read but not change details; another office cannot see the record at all.
  assert.equal((await req("PATCH", `/citizens/${c.id}/details`, { bloodGroup: "A+" }, s.reviewer)).status, 403);
  assert.equal(
    (await req("GET", `/citizens/${c.id}/identity`, undefined, s.outsider)).status,
    403,
    "plain staff is denied full identity numbers anywhere (S-010)",
  );
  assert.equal(
    (await req("GET", `/citizens/${c.id}/identity`, undefined, s.outsiderAdmin)).status,
    404,
    "another office's admin passes the role gate but must still not see the record (S-012)",
  );
  assert.equal((await req("PATCH", `/citizens/${c.id}/details`, { bloodGroup: "A+" }, s.outsider)).status, 404);

  // The same NID cannot belong to two citizens of one office.
  const duplicate = await req(
    "POST",
    "/citizens",
    { ...person, nameEn: "Duplicate Details Citizen", details: { nid } },
    s.staff,
  );
  assert.equal(duplicate.status, 409, JSON.stringify(duplicate.body));
  assert.equal(duplicate.body.code ?? duplicate.body.error?.code, "CITIZEN_NUMBER_TAKEN");
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM citizens WHERE tenant_id=$1 AND full_name_en='Duplicate Details Citizen'", [tenantId]))
      .rows[0].n,
    0,
    "the whole registration is rolled back",
  );

  // Clearing a number removes cipher, digest and hint together.
  const cleared = await req("PATCH", `/citizens/${c.id}/details`, { nid: null, bloodGroup: null }, s.staff);
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
  assert.equal(cleared.body.nidHint, null);
  assert.equal(cleared.body.bloodGroup, null);
  assert.equal(cleared.body.gender, "female", "fields not sent are unchanged");
  const after = (await db.query("SELECT nid_cipher,nid_digest,nid_hint FROM citizens WHERE id=$1", [c.id])).rows[0];
  assert.deepEqual(after, { nid_cipher: null, nid_digest: null, nid_hint: null });
});

test("Phase 3a: invalid details are rejected", async () => {
  for (const [details, status] of [
    [{ nid: "12345" }, 422],
    [{ birthReg: "1234567890" }, 422],
    [{ mobile: "0161234" }, 422],
    [{ mobile: "01712345678", noMobile: true }, 422],
    [{ gender: "unknown" }, 422],
    [{ bloodGroup: "C+" }, 422],
    [{ fatherNameEn: "x" }, 422],
    [{ religion: "none" }, 422],
  ] as const) {
    const r = await req("PATCH", `/citizens/${citizenOwnId}/details`, details, s.staff);
    assert.ok([400, 422].includes(r.status), `${JSON.stringify(details)} → ${r.status} ${JSON.stringify(r.body)}`);
    assert.equal(r.status, status, JSON.stringify(details));
  }
});

test("Phase 3a: a citizen edits only their own details and may declare no mobile", async () => {
  const own = await req(
    "PATCH",
    `/citizens/${citizenOwnId}/details`,
    { birthReg, noMobile: true, spouseNameEn: "Spouse Name" },
    s.self,
  );
  assert.equal(own.status, 200, JSON.stringify(own.body));
  assert.equal(own.body.noMobile, true);
  assert.equal(own.body.contactMobile, null);
  assert.equal(own.body.birthRegHint, `••••${birthReg.slice(-3)}`);
  const identity = await req("GET", `/citizens/${citizenOwnId}/identity`, undefined, s.self);
  assert.equal(identity.status, 200);
  assert.equal(identity.body.birthReg, birthReg);

  // Entering a mobile later withdraws the "no mobile" declaration.
  const withMobile = await req("PATCH", `/citizens/${citizenOwnId}/details`, { mobile: "01812345678" }, s.self);
  assert.equal(withMobile.body.noMobile, false);
  assert.equal(withMobile.body.contactMobile, "01812345678");
  // The database refuses both at once even if the API were bypassed.
  await assert.rejects(
    db.query("UPDATE citizens SET no_mobile=true WHERE id=$1", [citizenOwnId]),
    /citizens_mobile_or_none/,
  );

  // Another citizen's record is out of reach.
  const other = await req("POST", "/citizens", { ...person, nameEn: "Someone Else" }, s.staff);
  assert.equal(other.status, 201);
  assert.equal((await req("PATCH", `/citizens/${other.body.id}/details`, { gender: "male" }, s.self)).status, 404);
  assert.equal((await req("GET", `/citizens/${other.body.id}/identity`, undefined, s.self)).status, 404);
  const audit = await db.query(
    "SELECT metadata FROM audit_events WHERE tenant_id=$1 AND action='CITIZEN_DETAILS_UPDATED' AND resource_id=$2 ORDER BY created_at",
    [tenantId, citizenOwnId],
  );
  assert.deepEqual(audit.rows[0].metadata.fields.sort(), ["birthReg", "noMobile", "spouseNameEn"]);
  assert.equal(JSON.stringify(audit.rows).includes(birthReg), false, "the audit trail names fields, not values");
});
