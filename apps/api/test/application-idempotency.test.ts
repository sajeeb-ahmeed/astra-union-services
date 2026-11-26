import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { getDemoPayload } from "@astra/shared-schemas";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";

// W-004: POST /applications accepts a client-supplied idempotency key
// (requestKey). A replay of the same key for the same citizen + service
// returns the original application instead of creating a duplicate
// draft; a new key (or no key) still creates a legitimate repeat
// application; a rejected request never consumes its key.
const admin = new pg.Pool({ connectionString: adminConnectionString });
const run = randomUUID().slice(0, 8);
const password = "Idem-Test-1!";
type Session = { cookie: string; csrf: string; user: any };
const sessions: Record<string, Session> = {};
let server: ReturnType<typeof app.listen>, base: string;
let office: any, citizen: any;

async function request(
  method: string,
  path: string,
  data?: unknown,
  role = "citizen",
) {
  const session = sessions[role];
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      ...(session
        ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf }
        : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json().catch(() => null),
  };
}
async function login(role: string, email: string, secret = password) {
  const response = await request(
    "POST",
    "/auth/login",
    { email, password: secret },
    "anonymous",
  );
  assert.equal(response.status, 200, JSON.stringify(response.body));
  sessions[role] = {
    cookie: response.headers.get("set-cookie") ?? "",
    csrf: response.body.csrfToken,
    user: response.body.user,
  };
}
async function applicationCount() {
  return (
    await admin.query(
      "SELECT count(*)::int AS n FROM applications WHERE tenant_id=$1",
      [office.id],
    )
  ).rows[0].n as number;
}
async function create(
  serviceNo: number,
  requestKey?: string,
  payload: Record<string, unknown> = getDemoPayload(serviceNo),
) {
  return request("POST", "/applications", {
    citizenId: citizen.id,
    serviceNo,
    payload,
    ...(requestKey ? { requestKey } : {}),
  });
}

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  await login("owner", "owner@astra.demo.test", "Demo-Phase1!");
  const slug = `idem-${run}`;
  const created = await request(
    "POST",
    "/owner/tenants",
    {
      slug,
      nameBn: "পরীক্ষা অফিস",
      nameEn: "Synthetic idempotency office",
      division: "Test Division",
      district: "Test District",
      upazila: "Test Upazila",
      officeType: "UNION",
      adminEmail: `admin@${slug}.test`,
      adminName: "Synthetic idempotency admin",
      adminPassword: password,
    },
    "owner",
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  office = created.body;
  const email = `citizen-${run}@idem.synthetic.test`;
  const signup = await request(
    "POST",
    "/auth/signup",
    {
      email,
      password,
      displayName: "Synthetic idempotency citizen",
      tenantId: office.id,
      nameBn: "পরীক্ষা নাগরিক",
      nameEn: "Synthetic idempotency citizen",
      dateOfBirth: "1998-02-03",
      addressBn: "পরীক্ষা ঠিকানা",
      addressEn: "Synthetic idempotency address",
      syntheticReference: `REF-IDEM-${run}`,
    },
    "anonymous",
  );
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  await login("citizen", email);
  citizen = (await request("GET", "/citizens")).body.items[0];
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await admin.end();
});

test("W-004: replaying the same requestKey returns the original application, once", async () => {
  const before = await applicationCount();
  const key = randomUUID();
  const first = await create(45, key);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.headers.get("x-idempotency-replayed"), null);
  const second = await create(45, key);
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.equal(second.headers.get("x-idempotency-replayed"), "true");
  assert.equal(second.body.id, first.body.id);
  assert.equal(second.body.reference, first.body.reference);
  assert.equal(await applicationCount(), before + 1);
});

test("W-004: a new key creates a legitimate repeat application; no key keeps the old behaviour", async () => {
  const before = await applicationCount();
  const a = await create(45, randomUUID());
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const b = await create(45, randomUUID());
  assert.equal(b.status, 201, JSON.stringify(b.body));
  assert.notEqual(b.body.id, a.body.id);
  const c = await create(45);
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const d = await create(45);
  assert.equal(d.status, 201, JSON.stringify(d.body));
  assert.notEqual(d.body.id, c.body.id);
  assert.equal(await applicationCount(), before + 4);
});

test("W-004: the same key for a different service is a different intent", async () => {
  const before = await applicationCount();
  const key = randomUUID();
  const a = await create(45, key);
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const b = await create(2, key);
  assert.equal(b.status, 201, JSON.stringify(b.body));
  assert.notEqual(b.body.id, a.body.id);
  assert.equal(await applicationCount(), before + 2);
});

test("W-004: concurrent replays of one key create exactly one application", async () => {
  const before = await applicationCount();
  const key = randomUUID();
  const [a, b] = await Promise.all([create(45, key), create(45, key)]);
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(b.status, 201, JSON.stringify(b.body));
  assert.equal(a.body.id, b.body.id);
  assert.equal(await applicationCount(), before + 1);
});

test("W-004: a rejected request never consumes its key; a malformed key is rejected", async () => {
  const before = await applicationCount();
  const key = randomUUID();
  const bad = await create(
    45,
    key,
    // A payload that fails schema validation (missing required fields).
    { purpose: "synthetic" },
  );
  assert.equal(bad.status, 422, JSON.stringify(bad.body));
  assert.equal(await applicationCount(), before);
  const good = await create(45, key);
  assert.equal(good.status, 201, JSON.stringify(good.body));
  assert.equal(good.headers.get("x-idempotency-replayed"), null);
  assert.equal(await applicationCount(), before + 1);
  const malformed = await create(45, "not-a-uuid");
  assert.equal(malformed.status, 422, JSON.stringify(malformed.body));
  assert.equal(await applicationCount(), before + 1);
});
