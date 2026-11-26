import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";

/**
 * W-009: wallet adjustment integrity. The endpoint was owner-only,
 * validated, ledger-backed and audited — but a retry after a lost
 * response applied twice: the idempotency key was server-generated
 * (`adjustment:<random>`), unlike the points adjustment, which takes a
 * client `requestKey`. The wallet endpoint now accepts an optional
 * `requestKey` (same `adjustment:<key>` scheme): a replay returns the
 * original entry with `X-Idempotency-Replayed: true`, the same key with
 * a different payload is a 409 IDEMPOTENCY_CONFLICT, and a rejected
 * attempt consumes no key. Without a key the old behaviour is preserved.
 */
const run = randomUUID().slice(0, 8);
const password = randomBytes(12).toString("base64url");
const admin = new pg.Pool({ connectionString: adminConnectionString });
type Session = { cookie: string; csrf: string; user: any };
let server: ReturnType<typeof app.listen>, base: string;
let owner: Session, adminSession: Session, office: any;
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
async function walletOf(tenantId: string) {
  const r = await req("GET", "/owner/tenants", undefined, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.items.find((t: any) => t.id === tenantId)?.balance as number;
}
async function adjust(
  tenantId: string,
  body: Record<string, unknown>,
  session: Session = owner,
) {
  return req("POST", `/owner/tenants/${tenantId}/adjust`, body, session);
}
async function entries(tenantId: string) {
  return (
    await admin.query(
      "SELECT id, delta, reason, idempotency_key FROM credit_ledger WHERE tenant_id=$1 AND kind='ADJUSTMENT' ORDER BY created_at",
      [tenantId],
    )
  ).rows;
}
async function auditCount(tenantId: string) {
  return (
    await admin.query(
      "SELECT count(*)::int AS n FROM audit_events WHERE tenant_id=$1 AND action='WALLET_ADJUSTMENT'",
      [tenantId],
    )
  ).rows[0].n as number;
}

before(async () => {
  process.env.NODE_ENV = "test";
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  owner = await login("owner@astra.demo.test", "Demo-Phase1!");
  const slug = `w009-${run}`;
  const created = await req(
    "POST",
    "/owner/tenants",
    {
      slug,
      nameBn: "ডব্লিউ-০০৯ পরীক্ষা অফিস",
      nameEn: "W-009 test office",
      division: "Test Division",
      district: "Test District",
      upazila: "Test Upazila",
      officeType: "UNION",
      adminEmail: `admin@${slug}.test`,
      adminName: "W-009 Admin",
      adminPassword: password,
    },
    owner,
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  office = created.body;
  adminSession = await login(`admin@${slug}.test`);
});
after(async () => {
  await closePdfBrowser();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await admin.end();
});

test("W-009: the same key twice applies once and replays the original entry", async () => {
  const key = randomUUID();
  const before = await walletOf(office.id);
  const first = await adjust(office.id, {
    delta: 5,
    reason: "Synthetic W-009 first adjustment",
    requestKey: key,
  });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.headers.get("x-idempotency-replayed"), null);
  assert.equal(await walletOf(office.id), before + 5);
  const second = await adjust(office.id, {
    delta: 5,
    reason: "Synthetic W-009 first adjustment",
    requestKey: key,
  });
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.equal(second.headers.get("x-idempotency-replayed"), "true");
  assert.equal(second.body.id, first.body.id, "the replay returns the original entry");
  assert.equal(await walletOf(office.id), before + 5, "balance moved once");
  assert.equal((await entries(office.id)).length, 1);
  assert.equal(await auditCount(office.id), 1, "the replay writes no second audit row");
});

test("W-009: the same key with a different payload is a conflict, not a replay", async () => {
  const key = randomUUID();
  const first = await adjust(office.id, {
    delta: 7,
    reason: "Synthetic W-009 conflict setup",
    requestKey: key,
  });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const before = await walletOf(office.id);
  const conflict = await adjust(office.id, {
    delta: 9,
    reason: "Synthetic W-009 conflict setup",
    requestKey: key,
  });
  assert.equal(conflict.status, 409, JSON.stringify(conflict.body));
  assert.equal(conflict.body.error.code, "IDEMPOTENCY_CONFLICT");
  assert.equal(await walletOf(office.id), before);
  assert.equal((await entries(office.id)).length, 2, "no entry for the conflicted retry");
});

test("W-009: without a key every call still applies (old behaviour preserved)", async () => {
  const before = await walletOf(office.id);
  const first = await adjust(office.id, {
    delta: 3,
    reason: "Synthetic W-009 no-key first",
  });
  const second = await adjust(office.id, {
    delta: 3,
    reason: "Synthetic W-009 no-key first",
  });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.notEqual(second.body.id, first.body.id);
  assert.equal(await walletOf(office.id), before + 6);
});

test("W-009: a rejected attempt does not consume its key", async () => {
  const key = randomUUID();
  const refused = await adjust(office.id, {
    delta: -10000,
    reason: "Synthetic W-009 overdraft attempt",
    requestKey: key,
  });
  assert.equal(refused.status, 422, JSON.stringify(refused.body));
  assert.equal(refused.body.error.code, "NEGATIVE_BALANCE");
  const funded = await adjust(office.id, {
    delta: 10,
    reason: "Synthetic W-009 funding for the retry",
  });
  assert.equal(funded.status, 201, JSON.stringify(funded.body));
  const before = await walletOf(office.id);
  const retried = await adjust(office.id, {
    delta: -5,
    reason: "Synthetic W-009 corrected retry",
    requestKey: key,
  });
  assert.equal(retried.status, 201, JSON.stringify(retried.body));
  assert.equal(retried.headers.get("x-idempotency-replayed"), null);
  assert.equal(await walletOf(office.id), before - 5);
});

test("W-009: only the owner may adjust, and the input is validated", async () => {
  const key = randomUUID();
  assert.equal(
    (
      await adjust(
        office.id,
        { delta: 5, reason: "Synthetic W-009 admin attempt", requestKey: key },
        adminSession,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await adjust(office.id, {
        delta: 0,
        reason: "Synthetic W-009 zero delta",
        requestKey: randomUUID(),
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await adjust(office.id, {
        delta: 5,
        reason: "Synthetic W-009 bad key",
        requestKey: "not-a-uuid",
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await adjust(office.id, {
        delta: 5,
        reason: "short",
        requestKey: randomUUID(),
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await adjust(randomUUID(), {
        delta: 5,
        reason: "Synthetic W-009 unknown tenant",
        requestKey: randomUUID(),
      })
    ).status,
    404,
  );
});
