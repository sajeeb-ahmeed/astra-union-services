/**
 * S-012 — tenant isolation depends on migration 055 being applied.
 *
 * Migration 055 scope-gates the definer policies that previously let any
 * office-scoped request read other offices' applications, certificates,
 * attachments (and write across offices into point_wallets). The source
 * fix is present; this file is the negative test the register asks for,
 * run against the local seeded DB:
 *
 *   1. API level: an office B session must 404 on office A's application
 *      record (and never see it in a list).
 *   2. DB level: a transaction scoped to office B sees zero rows of
 *      office A's applications, citizens and point wallet.
 *   3. Schema level: RLS + FORCE RLS are on for every 055-affected
 *      table, and no definer policy still carries a bare `USING (true)`.
 *
 * The LIVE half of S-012 (schema_migrations max version and RLS status
 * on the production DB) remains BLOCKED on authorised read-only live DB
 * access; the readiness script's --db mode runs checks 1–3 above
 * against any database it is pointed at
 * (scripts/verify-deployment-readiness.ts --db, `tenant-isolation-rls`).
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { demoPayloads } from "@astra/shared-schemas";
import { app } from "../src/app.js";
import { pool, adminConnectionString, transaction } from "../src/db.js";
import { hashPassword } from "../src/security.js";

const db = new pg.Pool({ connectionString: adminConnectionString });
const password = randomBytes(12).toString("base64url");
const run = randomUUID().slice(0, 8);
let server: ReturnType<typeof app.listen>, base: string;
let officeA: string, officeB: string;
let citizenA: string, applicationA: string;
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
  const response = await req("POST", "/auth/login", { email, password });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return {
    cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
    csrf: response.body.csrfToken,
  };
}
async function makeOffice(label: string) {
  return (
    await db.query(
      "WITH created AS (INSERT INTO tenants(slug,name_bn,name_en) VALUES($1,'পরীক্ষা অফিস','Synthetic isolation office') RETURNING id) INSERT INTO tenant_wallets(tenant_id) SELECT id FROM created RETURNING tenant_id AS id",
      [`isolation-055-${label}-${run}`],
    )
  ).rows[0].id as string;
}

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  officeA = await makeOffice("a");
  officeB = await makeOffice("b");
  // Service 45 (Family Certificate) must be enabled for office A, or
  // application creation answers 422 SERVICE_DISABLED.
  await db.query(
    "INSERT INTO tenant_service_configuration(tenant_id,service_no) VALUES($1,45) ON CONFLICT DO NOTHING",
    [officeA],
  );
  for (const [name, tenant] of [
    ["staff-a", officeA],
    ["staff-b", officeB],
  ] as const) {
    const email = `${name}-${run}@isolation.synthetic.test`;
    const id = (
      await db.query(
        "INSERT INTO platform_users(email,display_name,password_hash) VALUES($1,'Synthetic isolation test',$2) RETURNING id",
        [email, hashPassword(password)],
      )
    ).rows[0].id as string;
    await db.query(
      "INSERT INTO staff_memberships(user_id,tenant_id,role) VALUES($1,$2,'staff')",
      [id, tenant],
    );
    s[name] = await signIn(email);
  }
  const created = await req(
    "POST",
    "/citizens",
    {
      nameBn: "বিচ্ছিন্ন নাগরিক",
      nameEn: "Isolation Citizen",
      dateOfBirth: "1990-05-06",
      addressBn: "স্থায়ী ঠিকানা গ্রাম",
      addressEn: "Permanent village address",
    },
    s["staff-a"],
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  citizenA = created.body.id;
  const application = await req(
    "POST",
    "/applications",
    { citizenId: citizenA, serviceNo: 45, payload: demoPayloads[45] },
    s["staff-a"],
  );
  assert.equal(application.status, 201, JSON.stringify(application.body));
  applicationA = application.body.id;
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await db.end();
});

test("S-012: office B cannot read office A's application through the API", async () => {
  // Same-office staff can read it — the 404 below is isolation, not a missing record.
  const own = await req("GET", `/applications/${applicationA}`, undefined, s["staff-a"]);
  assert.equal(own.status, 200, JSON.stringify(own.body));
  assert.equal((await req("GET", `/applications/${applicationA}`, undefined, s["staff-b"])).status, 404);
  const list = await req("GET", "/applications", undefined, s["staff-b"]);
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(
    (list.body.items ?? []).some((item: any) => item.id === applicationA),
    false,
    "office B's application list must not contain office A's application",
  );
  assert.equal(
    (await req("GET", `/citizens/${citizenA}/identity`, undefined, s["staff-b"])).status,
    404,
  );
});

test("S-012: a transaction scoped to office B sees none of office A's rows", async () => {
  // Existence first (admin connection, no scope): the scoped-zero below must
  // mean isolation, not missing rows.
  assert.equal(
    (await db.query("SELECT 1 FROM applications WHERE id=$1", [applicationA])).rowCount,
    1,
  );
  assert.equal(
    (await db.query("SELECT 1 FROM point_wallets WHERE tenant_id=$1", [officeA])).rowCount,
    1,
  );
  await transaction(officeB, async (scoped) => {
    for (const [table, where, value] of [
      ["applications", "id=$1", applicationA],
      ["citizens", "id=$1", citizenA],
      ["point_wallets", "tenant_id=$1", officeA],
      ["certificates", "tenant_id=$1", officeA],
      ["attachments", "tenant_id=$1", officeA],
      ["tenant_service_configuration", "tenant_id=$1", officeA],
    ] as const) {
      assert.equal(
        (await scoped.query(`SELECT * FROM ${table} WHERE ${where}`, [value])).rowCount,
        0,
        `${table}: office B scope must not see office A rows`,
      );
    }
  });
});

test("S-012: migration 055 is applied and every affected table forces RLS", async () => {
  const tables = [
    "applications",
    "certificates",
    "citizens",
    "attachments",
    "point_wallets",
    "tenant_service_configuration",
    "notices",
    "password_recovery_tokens",
    "application_refunds",
    "point_ledger",
    "service_order_policies",
    "application_order_snapshots",
    "audit_events",
  ];
  const applied = (
    await db.query("SELECT 1 FROM schema_migrations WHERE name=$1", [
      "055_definer_read_scope_and_verify_holder.sql",
    ])
  ).rowCount;
  assert.equal(applied, 1, "migration 055 must be recorded in schema_migrations");
  const flags = (
    await db.query(
      "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1)",
      [tables],
    )
  ).rows;
  assert.equal(flags.length, tables.length, "all 055-affected tables must exist");
  assert.ok(
    flags.every((row) => row.relrowsecurity && row.relforcerowsecurity),
    "every 055-affected table must have RLS and FORCE RLS",
  );
  // No definer policy may still carry a bare USING (true): each must be
  // gated on "no tenant scope set" (the astra.tenant_id condition 055 adds).
  const definer = (
    await db.query(
      `SELECT policyname, qual FROM pg_policies WHERE policyname IN
       ('public_definer_owner_read','definer_operations_read','callback_owner_read',
        'definer_ledger_read','definer_wallet_maintenance','definer_queue_read',
        'definer_office_info_read')`,
    )
  ).rows;
  assert.ok(definer.length > 0, "definer policies must exist to be checked");
  assert.ok(
    definer.every(
      (row) => row.qual !== "true" && String(row.qual).includes("astra.tenant_id"),
    ),
    "every definer policy must be scope-gated, none may be USING (true)",
  );
});
