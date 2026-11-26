import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import pg from "pg";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";

/**
 * Phase 4 Stage 5 Batch A (Database): A-014, A-007, A-011, A-012.
 *
 * A-014: applications(citizen_id) + audit_events(tenant_id, created_at)
 *   indexes exist (migration 075); the A-010 guard asserts the duplicate
 *   `applications_tenant_state_time` index is still the 004 updated_at
 *   variant (no created_at variant was created).
 * A-007: approval_authorizations.service_no has a FK to service_catalog.
 * A-011: DELETE /citizens/:id/photo writes an append-only
 *   citizen_artifact_deletions row (immutable trigger) recording mime +
 *   byte count, never the bytes.
 * A-012: owner cross-tenant reads go through SECURITY DEFINER functions
 *   (migration 075) instead of one tenant transaction per tenant:
 *   GET /owner/payment-orders returns the same rows at >= 50 tenants,
 *   locate_* returns the right tenant (NULL when absent), and
 *   consume_password_recovery_tokens consumes across memberships in one
 *   statement.
 */
const run = randomUUID().slice(0, 8);
const admin = new pg.Pool({ connectionString: adminConnectionString });
type Session = { cookie: string; csrf: string; user: any };
let server: ReturnType<typeof app.listen>, base: string;
let owner: Session, staff: Session;
let alphaId: string, betaId: string, ownerUserId: string;
const loadSlugs: string[] = [];
const loadOrderIds: string[] = [];
let loadRefundId: string;

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
async function login(email: string, secret: string): Promise<Session> {
  const r = await req("POST", "/auth/login", { email, password: secret });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return {
    cookie: r.headers.get("set-cookie")!.split(";")[0],
    csrf: r.body.csrfToken,
    user: r.body.user,
  } as Session;
}

before(async () => {
  process.env.NODE_ENV = "test";
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  owner = await login("owner@astra.demo.test", "Demo-Phase1!");
  staff = await login("staff@alpha.local.test", "Demo-Phase1!");
  const tenants = (
    await admin.query("SELECT id, slug FROM tenants WHERE slug IN ('alpha','beta')")
  ).rows;
  alphaId = tenants.find((t: any) => t.slug === "alpha").id;
  betaId = tenants.find((t: any) => t.slug === "beta").id;
  ownerUserId = (
    await admin.query(
      "SELECT id FROM platform_users WHERE email='owner@astra.demo.test'",
    )
  ).rows[0].id;
  // 50 load tenants + 3 orders each (PENDING/SETTLED/CANCELLED), one PAID
  // gateway payment + one REQUESTED refund on the first tenant.
  for (let i = 0; i < 50; i++) loadSlugs.push(`s5a-load-${run}-${String(i).padStart(2, "0")}`);
  await admin.query(
    `INSERT INTO tenants(slug,name_bn,name_en) SELECT slug, 'Load ' || slug, 'Load ' || slug FROM unnest($1::text[]) AS slug`,
    [loadSlugs],
  );
  const tenantRows = (
    await admin.query(
      "SELECT id, slug FROM tenants WHERE slug = ANY($1::text[]) ORDER BY slug",
      [loadSlugs],
    )
  ).rows;
  for (const [index, t] of tenantRows.entries()) {
    for (const [j, status] of ["PENDING", "SETTLED", "CANCELLED"].entries()) {
      const id = (
        await admin.query(
          `INSERT INTO payment_orders(tenant_id,kind,credits,amount_minor,currency,status,created_by,created_at)
           VALUES($1,'topup',$2,1000,'BDT',$3,$4,now() - ($5 || ' minutes')::interval) RETURNING id`,
          [t.id, 10 + j, status, ownerUserId, index * 37 + j * 11],
        )
      ).rows[0].id;
      loadOrderIds.push(id);
    }
  }
  const firstTenant = tenantRows[0];
  const firstOrder = (
    await admin.query(
      "SELECT id FROM payment_orders WHERE tenant_id=$1 ORDER BY created_at LIMIT 1",
      [firstTenant.id],
    )
  ).rows[0].id;
  // Hashes must be unique per run: the columns carry UNIQUE constraints.
  const hex64 = (tag: string) =>
    createHash("sha256").update(`${tag}-${run}`).digest("hex");
  const paymentId = (
    await admin.query(
      `INSERT INTO order_gateway_payments(tenant_id,order_id,provider,environment,merchant_account,invoice,amount_minor,currency,created_by,request_key,request_hash,callback_hash,status,evidence,payment_id,checkout_url,callback_signature)
       VALUES($1,$2,'BKASH','SANDBOX','s5a-merchant',$3,1000,'BDT',$4,gen_random_uuid(),$5,$6,'PAID','{}'::jsonb,$7,'https://example.invalid/checkout','sig') RETURNING id`,
      [
        firstTenant.id,
        firstOrder,
        `S5A-${run}`,
        ownerUserId,
        hex64("req"),
        hex64("cb"),
        `PAY-S5A-${run}`,
      ],
    )
  ).rows[0].id;
  loadRefundId = (
    await admin.query(
      `INSERT INTO order_gateway_refunds(tenant_id,order_id,order_payment_id,amount_minor,reason,status,requested_by,requested_at)
       VALUES($1,$2,$3,500,'stage5 batch A fixture','REQUESTED',$4,now()) RETURNING id`,
      [firstTenant.id, firstOrder, paymentId, ownerUserId],
    )
  ).rows[0].id;
});

after(async () => {
  // Clean up by slug pattern, not by the in-memory id lists, so a run
  // that failed halfway through `before` still leaves nothing behind.
  // Refunds are append-only (order_gateway_refund_no_delete): the one
  // fixture refund, its payment and its order stay by design, so the
  // deletes below spare every row the refund pins. The 50 load tenants
  // are inert (no test asserts a global tenant count) and stay, as with
  // other files' fixture tenants.
  const pattern = `s5a-load-${run}-%`;
  await admin
    .query(
      `DELETE FROM order_gateway_payments WHERE tenant_id IN (SELECT id FROM tenants WHERE slug LIKE $1)
       AND id NOT IN (SELECT order_payment_id FROM order_gateway_refunds WHERE tenant_id IN (SELECT id FROM tenants WHERE slug LIKE $1))`,
      [pattern],
    )
    .catch(() => {});
  await admin
    .query(
      `DELETE FROM payment_orders WHERE tenant_id IN (SELECT id FROM tenants WHERE slug LIKE $1)
       AND id NOT IN (SELECT order_id FROM order_gateway_payments WHERE tenant_id IN (SELECT id FROM tenants WHERE slug LIKE $1))`,
      [pattern],
    )
    .catch(() => {});
  await admin
    .query("DELETE FROM password_recovery_tokens WHERE token_hash LIKE $1", [
      `s5a-${run}-%`,
    ])
    .catch(() => {});
  await closePdfBrowser().catch(() => {});
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await admin.end();
});

test("A-014/A-010: both new indexes exist; the state/time index is still the 004 updated_at variant", async () => {
  const indexes = (
    await admin.query(
      "SELECT indexname FROM pg_indexes WHERE indexname IN ('applications_citizen_id','audit_events_tenant_created') ORDER BY 1",
    )
  ).rows.map((r: any) => r.indexname);
  assert.deepEqual(indexes, [
    "applications_citizen_id",
    "audit_events_tenant_created",
  ]);
  const def = (
    await admin.query(
      "SELECT pg_get_indexdef(indexrelid) AS def FROM pg_stat_user_indexes WHERE indexrelname='applications_tenant_state_time'",
    )
  ).rows[0].def as string;
  assert.ok(
    def.includes("updated_at"),
    `expected the 004 updated_at variant, got: ${def}`,
  );
  assert.ok(
    !def.includes("created_at"),
    `no created_at variant may exist: ${def}`,
  );
});

test("A-007: service_no FK exists and rejects an orphan authorization", async () => {
  const fk = (
    await admin.query(
      "SELECT conname FROM pg_constraint WHERE conname='approval_authorizations_service_no_fkey'",
    )
  ).rows;
  assert.equal(fk.length, 1);
  await assert.rejects(
    admin.query(
      "INSERT INTO approval_authorizations(tenant_id,user_id,service_no,active,authority_note) VALUES($1,$2,999,true,'stage5 batch A orphan probe')",
      [alphaId, ownerUserId],
    ),
    (e: any) => e.code === "23503",
  );
  // A valid service_no inserts and cleans up.
  await admin.query(
    "INSERT INTO approval_authorizations(tenant_id,user_id,service_no,active,authority_note) VALUES($1,$2,1,true,'stage5 batch A valid probe')",
    [alphaId, ownerUserId],
  );
  await admin.query(
    "DELETE FROM approval_authorizations WHERE tenant_id=$1 AND user_id=$2 AND service_no=1",
    [alphaId, ownerUserId],
  );
});

test("A-012: GET /owner/payment-orders returns all 150 load rows at 50 tenants, same shape and order", async () => {
  const started = Date.now();
  const r = await req("GET", "/owner/payment-orders?status=ALL", undefined, owner);
  const elapsedMs = Date.now() - started;
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const mine = (r.body.items as any[]).filter((o: any) =>
    loadSlugs.includes(o.tenantSlug),
  );
  assert.equal(mine.length, 150, `expected 150 load rows, got ${mine.length}`);
  const byStatus: Record<string, number> = {};
  for (const o of mine) {
    byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
    assert.equal(o.tenantNameBn, `Load ${o.tenantSlug}`);
    assert.equal(o.tenantNameEn, `Load ${o.tenantSlug}`);
    assert.equal(o.kind, "topup");
  }
  assert.deepEqual(byStatus, { PENDING: 50, SETTLED: 50, CANCELLED: 50 });
  const created = mine.map((o: any) => o.createdAt);
  for (let i = 1; i < created.length; i++)
    assert.ok(
      created[i - 1] >= created[i],
      `createdAt not descending at ${i}: ${created[i - 1]} < ${created[i]}`,
    );
  console.info(`A-012 load: GET /owner/payment-orders?status=ALL at 50 load tenants took ${elapsedMs}ms (150 rows)`);
  const pending = await req(
    "GET",
    "/owner/payment-orders?status=PENDING",
    undefined,
    owner,
  );
  assert.equal(pending.status, 200, JSON.stringify(pending.body));
  const minePending = (pending.body.items as any[]).filter((o: any) =>
    loadSlugs.includes(o.tenantSlug),
  );
  assert.equal(minePending.length, 50);
  assert.ok(minePending.every((o: any) => o.status === "PENDING"));
});

test("A-012: locate functions return the right tenant, NULL when absent", async () => {
  const orderTenant = (
    await pool.query("SELECT locate_payment_order_tenant($1) AS t", [
      loadOrderIds[0],
    ])
  ).rows[0].t;
  const firstTenant = (
    await admin.query(
      "SELECT tenant_id FROM payment_orders WHERE id=$1",
      [loadOrderIds[0]],
    )
  ).rows[0].tenant_id;
  assert.equal(orderTenant, firstTenant);
  assert.equal(
    (
      await pool.query("SELECT locate_payment_order_tenant($1) AS t", [
        randomUUID(),
      ])
    ).rows[0].t,
    null,
  );
  const refundTenant = (
    await pool.query("SELECT locate_order_refund_tenant($1) AS t", [loadRefundId])
  ).rows[0].t;
  assert.equal(refundTenant, firstTenant);
  assert.equal(
    (
      await pool.query("SELECT locate_order_refund_tenant($1) AS t", [
        randomUUID(),
      ])
    ).rows[0].t,
    null,
  );
  // The API surfaces the NULL locate as 404, not a 500.
  const missing = await req(
    "POST",
    `/owner/payment-orders/${randomUUID()}/settle`,
    { reason: "Stage 5 Batch A locate negative test" },
    owner,
  );
  assert.equal(missing.status, 404, JSON.stringify(missing.body));
  assert.equal(missing.body.error.code, "ORDER_NOT_FOUND");
});

test("A-012: consume_password_recovery_tokens consumes across tenants in one call", async () => {
  await admin.query(
    `INSERT INTO password_recovery_tokens(token_hash,tenant_id,user_id,created_by,expires_at,consumed_at)
     VALUES($1,$2,$3,$3,now() + interval '1 hour',NULL),
           ($4,$5,$3,$3,now() + interval '1 hour',NULL),
           ($6,$2,$3,$3,now() + interval '1 hour',now() - interval '1 hour')`,
    [
      `s5a-${run}-alpha`,
      alphaId,
      ownerUserId,
      `s5a-${run}-beta`,
      betaId,
      `s5a-${run}-consumed`,
    ],
  );
  const consumed = (
    await pool.query("SELECT consume_password_recovery_tokens($1) AS n", [
      ownerUserId,
    ])
  ).rows[0].n;
  assert.equal(consumed, 2, "exactly the two live tokens are consumed");
  const remaining = (
    await admin.query(
      "SELECT count(*)::int AS n FROM password_recovery_tokens WHERE user_id=$1 AND consumed_at IS NULL",
      [ownerUserId],
    )
  ).rows[0].n;
  assert.equal(remaining, 0);
  const again = (
    await pool.query("SELECT consume_password_recovery_tokens($1) AS n", [
      ownerUserId,
    ])
  ).rows[0].n;
  assert.equal(again, 0, "second call consumes nothing");
});

test("A-011: deleting a citizen photo writes an append-only deletion ledger row", async () => {
  const created = await req(
    "POST",
    "/citizens",
    {
      nameBn: "ছবি মুছে ফেলা পরীক্ষা",
      nameEn: "Photo Deletion Test Citizen",
      dateOfBirth: "1992-04-10",
      addressBn: "ঠিকানা",
      addressEn: "Address",
    },
    staff,
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const citizenId = created.body.id as string;
  const pngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const uploaded = await req(
    "PUT",
    `/citizens/${citizenId}/photo`,
    { mimeType: "image/png", base64: pngBase64 },
    staff,
  );
  assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
  assert.equal(uploaded.body.hasPhoto, true);
  const removed = await req(
    "DELETE",
    `/citizens/${citizenId}/photo`,
    undefined,
    staff,
  );
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.equal(removed.body.hasPhoto, false);
  const rows = (
    await admin.query(
      `SELECT tenant_id, actor_id, citizen_id, artifact_type, detail, created_at
       FROM citizen_artifact_deletions WHERE citizen_id=$1`,
      [citizenId],
    )
  ).rows;
  assert.equal(rows.length, 1, "exactly one ledger row");
  assert.equal(rows[0].tenant_id, alphaId);
  assert.equal(rows[0].artifact_type, "citizen_photo");
  assert.equal(rows[0].detail.mimeType, "image/png");
  assert.ok(
    rows[0].detail.bytes > 0,
    `expected a positive byte count, got ${JSON.stringify(rows[0].detail)}`,
  );
  const auditRows = (
    await admin.query(
      `SELECT count(*)::int AS n FROM audit_events WHERE tenant_id=$1 AND action='CITIZEN_PHOTO_REMOVED' AND resource_id=$2`,
      [alphaId, citizenId],
    )
  ).rows[0].n;
  assert.equal(auditRows, 1, "the audit event is still written too");
  // Append-only: UPDATE and DELETE on the ledger row both fail.
  await assert.rejects(
    admin.query(
      "UPDATE citizen_artifact_deletions SET detail='{}' WHERE citizen_id=$1",
      [citizenId],
    ),
    (e: any) => /Append-only record/.test(e.message),
  );
  await assert.rejects(
    admin.query(
      "DELETE FROM citizen_artifact_deletions WHERE citizen_id=$1",
      [citizenId],
    ),
    (e: any) => /Append-only record/.test(e.message),
  );
});
