import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { demoPayloads } from "@astra/shared-schemas";
import { digest, hashPassword } from "../src/security.js";

// Claims intentionally span active tenants. A dedicated database makes this
// suite repeatable without consuming another test's or developer's uploads.
const runtime = fs.existsSync(".runtime/postgres.json")
  ? JSON.parse(fs.readFileSync(".runtime/postgres.json", "utf8"))
  : {};
const sourceAdmin = process.env.DATABASE_ADMIN_URL ?? runtime.adminUrl;
const sourceApp = process.env.DATABASE_URL ?? runtime.appUrl;
const sourceUrl = new URL(sourceAdmin);
assert.ok(
  ["127.0.0.1", "localhost", "[::1]"].includes(sourceUrl.hostname),
  "Attachment tests require a loopback test database",
);
const databaseName = `astra_attachment_test_${randomBytes(8).toString("hex")}`;
const originalDatabase = process.env.DATABASE_URL,
  originalAdminDatabase = process.env.DATABASE_ADMIN_URL;
const manager = new pg.Pool({ connectionString: sourceAdmin });
await manager.query(`CREATE DATABASE ${databaseName}`);
sourceUrl.pathname = `/${databaseName}`;
const appUrl = new URL(sourceApp);
appUrl.pathname = `/${databaseName}`;
process.env.DATABASE_ADMIN_URL = sourceUrl.toString();
process.env.DATABASE_URL = appUrl.toString();
try {
  for (const script of ["scripts/migrate.ts", "scripts/seed.ts"]) {
    const result = spawnSync(process.execPath, ["--import", "tsx", script], {
      env: process.env,
      encoding: "utf8",
    });
    assert.equal(
      result.status,
      0,
      `Isolated attachment fixture setup failed: ${result.stderr}`,
    );
  }
} catch (error) {
  await manager.query(`DROP DATABASE ${databaseName}`);
  await manager.end();
  throw error;
}
const { app } = await import("../src/app.js");
const { closePdfBrowser } = await import("../src/pdf.js");
const { pool, adminConnectionString, transaction } = await import(
  "../src/db.js"
);
const db = new pg.Pool({ connectionString: adminConnectionString });
const run = randomBytes(6).toString("hex");
// Use a freshly seeded test database: queue claims intentionally span active
// tenants and must never be run against a database with real pending uploads.
const tenantId = `00000000-0000-4000-8000-${run}`;
const otherTenant = `00000000-0000-4001-8000-${run}`;
const priorSecret = process.env.ATTACHMENT_SCANNER_SECRET;
const secret = randomBytes(32).toString("hex");
process.env.ATTACHMENT_SCANNER_SECRET = secret;
const password = "Synthetic-Attachment-Test!";
const identity = {
  workerId: "synthetic-worker",
  engineVersion: "ClamAV test",
  signatureVersion: "synthetic-1",
  signatureUpdatedAt: new Date().toISOString(),
};
const bytes = Buffer.from(
  "%PDF-1.7\nSynthetic parser fixture; not a scanner-clean assertion\n%%EOF\n",
);
type Session = { cookie: string; csrf: string; id: string };
const sessions: Record<string, Session> = {};
let server: ReturnType<typeof app.listen>,
  base: string,
  citizenId: string,
  otherCitizen: string;
async function request(
  method: string,
  path: string,
  body?: unknown,
  session?: Session,
  headers: Record<string, string> = {},
) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(session
        ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf }
        : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    headers: response.headers,
    body: response.headers.get("content-type")?.includes("application/json")
      ? await response.json()
      : Buffer.from(await response.arrayBuffer()),
  };
}
const worker = (
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  request("POST", `/internal/attachment-scans/${path}`, body, undefined, {
    Authorization: `Bearer ${secret}`,
    ...headers,
  });
async function upload(session = sessions.staff!, citizen = citizenId) {
  const r = await request(
    "POST",
    "/attachments",
    {
      citizenId: citizen,
      mimeType: "application/pdf",
      base64: bytes.toString("base64"),
    },
    session,
  );
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.scanState, "QUARANTINED");
  return r.body;
}
function handle(row: any) {
  return {
    attachmentId: row.attachmentId,
    mimeType: row.mimeType,
    byteLength: row.byteLength,
  };
}
async function claim(id: string) {
  const r = await worker("claim", identity);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.job?.attachmentId, id);
  assert.equal(r.body.job.sha256, digest(bytes));
  assert.equal(r.body.job.base64, bytes.toString("base64"));
  return r.body.job;
}
function completion(job: any, verdict = "CLEAN", reasonCode = "OK") {
  const { workerId: _, ...versions } = identity;
  return {
    ...versions,
    attachmentId: job.attachmentId,
    tenantId: job.tenantId,
    leaseToken: job.leaseToken,
    sha256: job.sha256,
    verdict,
    reasonCode,
  };
}
async function finish(job: any, verdict = "CLEAN", reasonCode = "OK") {
  const r = await worker("finish", completion(job, verdict, reasonCode));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r;
}
async function newApplication(file: any) {
  const r = await request(
    "POST",
    "/applications",
    {
      citizenId,
      serviceNo: 1,
      payload: {
        ...demoPayloads[1],
        supporting_documents: [
          { description: "Synthetic document", file: handle(file) },
        ],
      },
    },
    sessions.staff,
  );
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
async function transition(
  id: string,
  action: string,
  role = "staff",
  reason?: string,
) {
  return request(
    "POST",
    `/applications/${id}/transition`,
    { action, ...(reason ? { reason } : {}) },
    sessions[role],
  );
}
async function approve(id: string) {
  for (const [action, role] of [
    ["submit", "staff"],
    ["review", "reviewer"],
    ["approve", "approver"],
  ]) {
    const r = await transition(id, action!, role!);
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
}
async function assertBlocked(
  result: Awaited<ReturnType<typeof request>>,
  path?: string,
) {
  assert.equal(result.status, 409, JSON.stringify(result.body));
  assert.equal(result.body.error.code, "ATTACHMENT_NOT_READY");
  if (path) {
    assert.equal(result.body.error.issues[0].path, path);
    assert.ok(result.body.error.issues[0].message.bn);
    assert.ok(result.body.error.issues[0].message.en);
  }
}
// Privileged, local-only fixture time travel simulates an expired lease or a
// pre-migration historical record without adding a production bypass endpoint.
async function fixtureUpdate(id: string, sql: string) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role=replica");
    await client.query(`UPDATE attachments SET ${sql} WHERE id=$1`, [id]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  for (const [id, suffix] of [
    [tenantId, "a"],
    [otherTenant, "b"],
  ]) {
    await db.query(
      "INSERT INTO tenants(id,slug,name_bn,name_en) VALUES($1,$2,'পরীক্ষা অফিস','Synthetic attachment office')",
      [id, `attachment-${run}-${suffix}`],
    );
    await db.query("INSERT INTO tenant_wallets(tenant_id) VALUES($1)", [id]);
    await db.query(
      "INSERT INTO tenant_service_configuration(tenant_id,service_no) VALUES($1,1)",
      [id],
    );
  }
  for (const role of [
    "citizen",
    "staff",
    "admin",
    "reviewer",
    "approver",
    "finance",
    "owner",
    "foreign",
    "secondCitizen",
  ]) {
    const actualRole =
      role === "foreign"
        ? "staff"
        : role === "secondCitizen"
          ? "citizen"
          : role;
    const email = `${role.toLowerCase()}-${run}@attachment.synthetic.test`;
    const id = (
      await db.query(
        "INSERT INTO platform_users(email,display_name,password_hash,platform_role) VALUES($1,'Synthetic attachment user',$2,$3) RETURNING id",
        [
          email,
          hashPassword(password),
          actualRole === "owner" ? "owner" : null,
        ],
      )
    ).rows[0].id;
    if (role !== "owner")
      await db.query(
        "INSERT INTO staff_memberships(user_id,tenant_id,role) VALUES($1,$2,$3)",
        [id, role === "foreign" ? otherTenant : tenantId, actualRole],
      );
    const login = await request("POST", "/auth/login", { email, password });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    sessions[role] = {
      id,
      cookie: login.headers.get("set-cookie")!.split(";")[0]!,
      csrf: login.body.csrfToken,
    };
  }
  for (const [user, name] of [
    [sessions.citizen!, "own"],
    [sessions.secondCitizen!, "other"],
  ] as const) {
    const id = (
      await db.query(
        "INSERT INTO citizens(tenant_id,user_id,full_name_bn,full_name_en,date_of_birth,address_bn,address_en,synthetic_reference) VALUES($1,$2,'পরীক্ষা নাগরিক','Synthetic citizen','1995-01-01','পরীক্ষা গ্রাম','Synthetic village',$3) RETURNING id",
        [tenantId, user.id, `${run}-${name}`],
      )
    ).rows[0].id;
    if (name === "own") citizenId = id;
    else otherCitizen = id;
  }
  await db.query(
    "INSERT INTO approval_authorizations(tenant_id,user_id,service_no,authority_note) VALUES($1,$2,1,'Synthetic security test authorization')",
    [tenantId, sessions.approver!.id],
  );
  await db.query(
    "INSERT INTO tenant_subscriptions(tenant_id,plan_id,valid_until,status) VALUES($1,'demo-monthly',now()+interval '1 day','ACTIVE')",
    [tenantId],
  );
  await db.query(
    "INSERT INTO credit_ledger(tenant_id,delta,kind,idempotency_key,actor_id,reason,balance_after) VALUES($1,20,'PLAN_GRANT',$2,$3,'Synthetic attachment test grant',0)",
    [tenantId, `attachment-${run}`, sessions.owner!.id],
  );
});
after(async () => {
  if (priorSecret === undefined) delete process.env.ATTACHMENT_SCANNER_SECRET;
  else process.env.ATTACHMENT_SCANNER_SECRET = priorSecret;
  // Retain append-only synthetic evidence but remove these offices from polling.
  await db.query(
    "UPDATE tenants SET status='SUSPENDED' WHERE id=ANY($1::uuid[])",
    [[tenantId, otherTenant]],
  );
  await closePdfBrowser();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await db.end();
  await manager.query(`DROP DATABASE ${databaseName}`);
  await manager.end();
  if (originalDatabase === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabase;
  if (originalAdminDatabase === undefined)
    delete process.env.DATABASE_ADMIN_URL;
  else process.env.DATABASE_ADMIN_URL = originalAdminDatabase;
});

test("ATT-01: scanner requires configured bearer capability, refuses browser/session traffic and stale definitions", async () => {
  const original = process.env.ATTACHMENT_SCANNER_SECRET;
  delete process.env.ATTACHMENT_SCANNER_SECRET;
  assert.equal((await worker("claim", identity)).status, 401);
  process.env.ATTACHMENT_SCANNER_SECRET = original;
  for (const headers of [
    { Authorization: `Bearer ${"0".repeat(64)}` },
    { Cookie: sessions.staff!.cookie },
    { Origin: process.env.PUBLIC_ORIGIN ?? "http://127.0.0.1:5173" },
  ] as Record<string, string>[]) {
    assert.equal((await worker("claim", identity, headers)).status, 401);
  }
  assert.equal(
    (
      await request(
        "POST",
        "/internal/attachment-scans/claim",
        identity,
        sessions.owner,
      )
    ).status,
    401,
  );
  for (const date of [
    new Date(Date.now() - 49 * 3600_000),
    new Date(Date.now() + 6 * 60_000),
  ]) {
    const r = await worker("claim", {
      ...identity,
      signatureUpdatedAt: date.toISOString(),
    });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, "SCANNER_DEFINITIONS_INVALID");
  }
  assert.equal((await worker("claim", { ...identity, tenantId })).status, 422);
});

test("ATT-02: upload/status/download enforce tenant, applicant, role, CSRF and strict handles; files wait offline", async () => {
  const file = await upload(sessions.citizen);
  assert.equal(file.scannerAvailable, false);
  assert.equal(file.downloadAllowed, false);
  assert.equal(file.retryAllowed, false);
  assert.equal(file.reasonCode, "PENDING_SCAN");
  const data = {
    citizenId,
    mimeType: "application/pdf",
    base64: bytes.toString("base64"),
  };
  assert.equal(
    (
      await request("POST", "/attachments", data, sessions.staff, {
        "X-CSRF-Token": "wrong",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "POST",
        "/attachments",
        { ...data, scanState: "CLEAN" },
        sessions.staff,
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await request(
        "POST",
        "/attachments",
        { ...data, base64: "invalid!!!" },
        sessions.staff,
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await request(
        "POST",
        "/attachments",
        { ...data, citizenId: otherCitizen },
        sessions.citizen,
      )
    ).status,
    404,
  );
  for (const role of ["finance", "owner", "reviewer", "approver"])
    assert.equal(
      (await request("POST", "/attachments", data, sessions[role])).status,
      403,
    );
  for (const endpoint of ["", "/status"]) {
    assert.equal(
      (await request("GET", `/attachments/${file.attachmentId}${endpoint}`))
        .status,
      401,
    );
    for (const role of ["foreign", "secondCitizen"])
      assert.equal(
        (
          await request(
            "GET",
            `/attachments/${file.attachmentId}${endpoint}`,
            undefined,
            sessions[role],
          )
        ).status,
        404,
      );
    for (const role of ["finance", "owner"])
      assert.equal(
        (
          await request(
            "GET",
            `/attachments/${file.attachmentId}${endpoint}`,
            undefined,
            sessions[role],
          )
        ).status,
        403,
      );
  }
  for (const role of ["citizen", "staff", "admin", "reviewer", "approver"]) {
    const status = await request(
      "GET",
      `/attachments/${file.attachmentId}/status`,
      undefined,
      sessions[role],
    );
    assert.equal(status.status, 200);
    assert.equal(JSON.stringify(status.body).includes("base64"), false);
    assert.equal(JSON.stringify(status.body).includes("leaseToken"), false);
    await assertBlocked(
      await request(
        "GET",
        `/attachments/${file.attachmentId}`,
        undefined,
        sessions[role],
      ),
    );
  }
  const job = await claim(file.attachmentId);
  const status = await request(
    "GET",
    `/attachments/${file.attachmentId}/status`,
    undefined,
    sessions.staff,
  );
  assert.equal(status.body.scanState, "SCANNING");
  assert.equal(status.body.scannerAvailable, true);
  await assertBlocked(
    await request(
      "GET",
      `/attachments/${file.attachmentId}`,
      undefined,
      sessions.staff,
    ),
  );
  await finish(job, "REJECTED", "UNSAFE_FILE");
  await assertBlocked(
    await request(
      "GET",
      `/attachments/${file.attachmentId}`,
      undefined,
      sessions.staff,
    ),
  );
  assert.equal(
    (
      await request(
        "POST",
        `/attachments/${file.attachmentId}/retry`,
        {},
        sessions.admin,
      )
    ).status,
    409,
  );
});

test("ATT-03: atomic concurrent claims, exact hash/lease/engine binding, replay protection and clean-only bytes", async () => {
  const files = [await upload(), await upload()];
  const claimed = await Promise.all([
    worker("claim", identity),
    worker("claim", identity),
  ]);
  for (const r of claimed) assert.equal(r.status, 200, JSON.stringify(r.body));
  const jobs = claimed.map((r) => r.body.job);
  assert.deepEqual(
    new Set(jobs.map((j) => j.attachmentId)),
    new Set(files.map((f) => f.attachmentId)),
  );
  for (const job of jobs) {
    for (const patch of [
      { sha256: "0".repeat(64) },
      { leaseToken: "0".repeat(64) },
      { tenantId: otherTenant },
      { engineVersion: "wrong" },
      { signatureVersion: "wrong" },
    ]) {
      assert.equal(
        (await worker("finish", { ...completion(job), ...patch })).status,
        409,
      );
    }
    assert.equal(
      (await worker("finish", completion(job, "CLEAN", "SCAN_FAILED"))).status,
      422,
    );
    await finish(job);
    assert.equal((await worker("finish", completion(job))).status, 409);
    const download = await request(
      "GET",
      `/attachments/${job.attachmentId}`,
      undefined,
      sessions.citizen,
    );
    assert.equal(download.status, 200);
    assert.deepEqual(download.body, bytes);
    assert.equal(download.headers.get("cache-control"), "no-store");
    assert.equal(download.headers.get("x-content-type-options"), "nosniff");
    assert.match(download.headers.get("content-disposition")!, /^attachment;/);
    const events = (
      await db.query(
        "SELECT event FROM attachment_scan_events WHERE attachment_id=$1 ORDER BY created_at,id",
        [job.attachmentId],
      )
    ).rows.map((r) => r.event);
    assert.deepEqual(events, ["CLAIMED", "CLEAN"]);
  }
});

test("ATT-04: failed and expired scans stay blocked; bounded cooldown/retry cannot resurrect rejected or exhausted files", async () => {
  const file = await upload();
  const first = await claim(file.attachmentId);
  await finish(first, "ERROR", "SCANNER_UNAVAILABLE");
  await assertBlocked(
    await request(
      "GET",
      `/attachments/${file.attachmentId}`,
      undefined,
      sessions.staff,
    ),
  );
  assert.equal(
    (
      await request(
        "POST",
        `/attachments/${file.attachmentId}/retry`,
        {},
        sessions.staff,
      )
    ).status,
    429,
  );
  await assert.rejects(
    transaction(tenantId, (db) =>
      db.query(
        "UPDATE attachments SET scan_state='SCANNING',scan_attempts=scan_attempts+1,lease_token_hash=$2,lease_expires_at=now()+interval '1 minute' WHERE id=$1",
        [file.attachmentId, digest("attempt")],
      ),
    ),
  );
  await fixtureUpdate(
    file.attachmentId,
    "next_retry_at=clock_timestamp()-interval '1 second'",
  );
  assert.equal(
    (
      await request(
        "GET",
        `/attachments/${file.attachmentId}/status`,
        undefined,
        sessions.citizen,
      )
    ).body.retryAllowed,
    true,
  );
  assert.equal(
    (
      await request(
        "POST",
        `/attachments/${file.attachmentId}/retry`,
        {},
        sessions.reviewer,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "POST",
        `/attachments/${file.attachmentId}/retry`,
        {},
        sessions.citizen,
      )
    ).status,
    200,
  );
  const second = await claim(file.attachmentId);
  await fixtureUpdate(
    file.attachmentId,
    "lease_expires_at=clock_timestamp()-interval '1 second'",
  );
  assert.equal((await worker("finish", completion(second))).status, 409);
  // Queue polling reaps the expired lease. It may find another synthetic office,
  // so no assertion claims the entire shared development queue is empty.
  await worker("claim", identity);
  const errored = (
    await db.query(
      "SELECT scan_state,scan_attempts,next_retry_at FROM attachments WHERE id=$1",
      [file.attachmentId],
    )
  ).rows[0];
  assert.equal(errored.scan_state, "ERROR");
  assert.equal(errored.scan_attempts, 2);
  await fixtureUpdate(
    file.attachmentId,
    "next_retry_at=clock_timestamp()-interval '1 second'",
  );
  const third = await claim(file.attachmentId);
  await finish(third, "ERROR", "SCAN_FAILED");
  await fixtureUpdate(
    file.attachmentId,
    "next_retry_at=clock_timestamp()-interval '1 second'",
  );
  const final = await request(
    "GET",
    `/attachments/${file.attachmentId}/status`,
    undefined,
    sessions.staff,
  );
  assert.equal(final.body.retryAllowed, false);
  assert.equal(final.body.retryAfter, null);
  assert.equal(
    (
      await request(
        "POST",
        `/attachments/${file.attachmentId}/retry`,
        {},
        sessions.admin,
      )
    ).status,
    409,
  );
  const events = (
    await db.query(
      "SELECT event FROM attachment_scan_events WHERE attachment_id=$1 ORDER BY created_at,id",
      [file.attachmentId],
    )
  ).rows.map((r) => r.event);
  assert.deepEqual(events, [
    "CLAIMED",
    "ERROR",
    "RETRY_REQUESTED",
    "CLAIMED",
    "LEASE_EXPIRED",
    "CLAIMED",
    "ERROR",
  ]);
});

test("ATT-05: pending handles save as drafts but block submit/resubmit/approval/issuance without credit or state changes", async () => {
  const file = await upload();
  const draft = await newApplication(file);
  await assertBlocked(
    await transition(draft.id, "submit"),
    "supporting_documents[0].file",
  );
  const before = (
    await db.query(
      "SELECT state,(SELECT count(*)::int FROM application_events e WHERE e.application_id=a.id) events FROM applications a WHERE id=$1",
      [draft.id],
    )
  ).rows[0];
  assert.equal(before.state, "DRAFT");
  // These represent applications submitted/approved before quarantine rollout.
  for (const [state, action, role] of [
    ["CORRECTION_REQUIRED", "resubmit", "staff"],
    ["UNDER_REVIEW", "approve", "approver"],
  ]) {
    await db.query("UPDATE applications SET state=$2 WHERE id=$1", [
      draft.id,
      state,
    ]);
    await assertBlocked(
      await transition(draft.id, action!, role!),
      "supporting_documents[0].file",
    );
    assert.equal(
      (await db.query("SELECT state FROM applications WHERE id=$1", [draft.id]))
        .rows[0].state,
      state,
    );
  }
  await db.query(
    "UPDATE applications SET state='APPROVED',approved_by=$2,approved_version=latest_version WHERE id=$1",
    [draft.id, sessions.approver!.id],
  );
  await assertBlocked(
    await request(
      "POST",
      `/applications/${draft.id}/issue`,
      {},
      sessions.approver,
    ),
    "supporting_documents[0].file",
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM certificates WHERE application_id=$1",
        [draft.id],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM application_events WHERE application_id=$1",
        [draft.id],
      )
    ).rows[0].n,
    before.events,
  );
  const changed = {
    ...demoPayloads[1],
    supporting_documents: [
      {
        description: "Synthetic document",
        file: { ...handle(file), attachmentId: randomUUID() },
      },
    ],
  };
  assert.equal(
    (
      await request(
        "POST",
        "/applications",
        { citizenId, serviceNo: 1, payload: changed },
        sessions.staff,
      )
    ).body.error.code,
    "ATTACHMENT_INVALID",
  );
  await finish(await claim(file.attachmentId));
  // A real clean submission -> review -> authorized approval -> PDF issuance.
  const clean = await newApplication(file);
  await approve(clean.id);
  const issued = await Promise.all([
    request("POST", `/applications/${clean.id}/issue`, {}, sessions.approver),
    request("POST", `/applications/${clean.id}/issue`, {}, sessions.approver),
  ]);
  for (const r of issued) assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(issued[0]!.body.id, issued[1]!.body.id);
  const ledger = (
    await db.query(
      "SELECT count(*)::int n,sum(delta)::int delta FROM credit_ledger WHERE certificate_id=$1",
      [issued[0]!.body.id],
    )
  ).rows[0];
  assert.deepEqual(ledger, { n: 1, delta: -1 });
  const pdf = await request(
    "GET",
    `/certificates/${issued[0]!.body.id}/pdf`,
    undefined,
    sessions.staff,
  );
  assert.equal(pdf.status, 200);
  assert.equal(pdf.body.subarray(0, 5).toString(), "%PDF-");
  // Historical issued certificate replay/download survives migration quarantine.
  await fixtureUpdate(
    file.attachmentId,
    "scan_state='QUARANTINED',scan_reason='PENDING_SCAN',scanned_at=NULL,scanned_sha256=NULL",
  );
  const replay = await request(
    "POST",
    `/applications/${clean.id}/issue`,
    {},
    sessions.approver,
  );
  assert.equal(replay.status, 200);
  assert.equal(replay.body.id, issued[0]!.body.id);
  assert.equal(
    (
      await request(
        "GET",
        `/certificates/${replay.body.id}/pdf`,
        undefined,
        sessions.staff,
      )
    ).status,
    200,
  );
  await assertBlocked(
    await request(
      "GET",
      `/attachments/${file.attachmentId}`,
      undefined,
      sessions.staff,
    ),
  );
  await finish(await claim(file.attachmentId), "REJECTED", "UNSAFE_FILE");
});

test("ATT-06: final issuance transaction rechecks clean status after PDF generation and never debits on failure", async () => {
  const file = await upload();
  await finish(await claim(file.attachmentId));
  const application = await newApplication(file);
  await approve(application.id);
  const blocker = await db.connect();
  let pending: Promise<Awaited<ReturnType<typeof request>>> | undefined;
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM applications WHERE id=$1 FOR UPDATE", [
      application.id,
    ]);
    pending = request(
      "POST",
      `/applications/${application.id}/issue`,
      {},
      sessions.approver,
    );
    let waiting = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      const r = await db.query(
        "SELECT 1 FROM pg_stat_activity WHERE usename='astra_app' AND wait_event_type='Lock' AND query LIKE '%FOR UPDATE OF a%' LIMIT 1",
      );
      if (r.rowCount) {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(
      waiting,
      true,
      "Issuance must reach its final locked transaction",
    );
    await fixtureUpdate(
      file.attachmentId,
      "scan_state='QUARANTINED',scan_reason='PENDING_SCAN',scanned_at=NULL,scanned_sha256=NULL",
    );
    await blocker.query("COMMIT");
    await assertBlocked(await pending, "supporting_documents[0].file");
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM certificates WHERE application_id=$1",
          [application.id],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query("SELECT state FROM applications WHERE id=$1", [
          application.id,
        ])
      ).rows[0].state,
      "APPROVED",
    );
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
    if (pending) await pending;
  }
  await finish(await claim(file.attachmentId), "REJECTED", "UNSAFE_FILE");
});

test("ATT-07: restricted DB role cannot modify immutable bytes, bypass scan transitions, forge inserts or read another tenant's evidence", async () => {
  const file = await upload();
  for (const sql of [
    "UPDATE attachments SET bytes=bytes WHERE id=$1",
    "DELETE FROM attachments WHERE id=$1",
    "UPDATE attachments SET scan_state='CLEAN',scan_reason='OK' WHERE id=$1",
    "UPDATE attachments SET scan_attempts=1 WHERE id=$1",
  ]) {
    await assert.rejects(
      transaction(tenantId, (db) => db.query(sql, [file.attachmentId])),
    );
  }
  await assert.rejects(
    transaction(tenantId, (db) =>
      db.query(
        "INSERT INTO attachments(tenant_id,citizen_id,uploaded_by,mime_type,byte_length,bytes,scan_state) VALUES($1,$2,$3,'application/pdf',$4,$5,'CLEAN')",
        [tenantId, citizenId, sessions.staff!.id, bytes.length, bytes],
      ),
    ),
  );
  const job = await claim(file.attachmentId);
  await assert.rejects(
    transaction(tenantId, (db) =>
      db.query("UPDATE attachments SET lease_token_hash=NULL WHERE id=$1", [
        file.attachmentId,
      ]),
    ),
  );
  await finish(job);
  await assert.rejects(
    transaction(tenantId, (db) =>
      db.query("UPDATE attachments SET scan_state='QUARANTINED' WHERE id=$1", [
        file.attachmentId,
      ]),
    ),
  );
  await assert.rejects(
    transaction(tenantId, (db) =>
      db.query(
        "UPDATE attachment_scan_events SET event='ERROR' WHERE attachment_id=$1",
        [file.attachmentId],
      ),
    ),
  );
  await assert.rejects(
    db.query("DELETE FROM attachment_scan_events WHERE attachment_id=$1", [
      file.attachmentId,
    ]),
  );
  for (const table of [
    "attachments",
    "attachment_scan_events",
    "attachment_scanner_heartbeats",
  ]) {
    const foreign = await transaction(otherTenant, (db) =>
      db.query(`SELECT count(*)::int n FROM ${table} WHERE tenant_id=$1`, [
        tenantId,
      ]),
    );
    assert.equal(foreign.rows[0].n, 0);
    assert.equal(
      (await pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,
      0,
    );
  }
  const stored = (
    await db.query(
      "SELECT content_sha256,scanned_sha256,scan_state FROM attachments WHERE id=$1",
      [file.attachmentId],
    )
  ).rows[0];
  assert.deepEqual(stored, {
    content_sha256: digest(bytes),
    scanned_sha256: digest(bytes),
    scan_state: "CLEAN",
  });
});

test("ATT-08: persisted fair scheduling serves both offices even with an earlier office backlog and concurrent workers", async () => {
  const foreignCitizen = (
    await db.query(
      "INSERT INTO citizens(tenant_id,user_id,full_name_bn,full_name_en,date_of_birth,address_bn,address_en,synthetic_reference) VALUES($1,$2,'পরীক্ষা নাগরিক','Synthetic foreign citizen','1995-01-01','পরীক্ষা গ্রাম','Synthetic village',$3) RETURNING id",
      [otherTenant, sessions.foreign!.id, `${run}-foreign`],
    )
  ).rows[0].id;
  const first = await upload(),
    second = await upload(),
    foreign = await upload(sessions.foreign, foreignCitizen);
  const claims = await Promise.all([
    worker("claim", identity),
    worker("claim", { ...identity, workerId: "second-worker" }),
  ]);
  for (const response of claims)
    assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.deepEqual(
    new Set(claims.map((response) => response.body.job.tenantId)),
    new Set([tenantId, otherTenant]),
  );
  for (const response of claims) await finish(response.body.job);
  const remaining = claims.some(
    (response) => response.body.job.attachmentId === first.attachmentId,
  )
    ? second
    : first;
  await finish(await claim(remaining.attachmentId));
  for (const id of [tenantId, otherTenant]) {
    const heartbeat = (
      await db.query(
        "SELECT seen_at,last_claimed_at FROM attachment_scanner_heartbeats WHERE tenant_id=$1",
        [id],
      )
    ).rows[0];
    assert.ok(heartbeat.last_claimed_at);
    assert.ok(Date.now() - heartbeat.seen_at.getTime() < 10_000);
  }
  assert.equal(
    (
      await request(
        "GET",
        `/attachments/${foreign.attachmentId}/status`,
        undefined,
        sessions.foreign,
      )
    ).body.scannerAvailable,
    true,
  );
});

test("ATT-09: migration backfills every legacy tenant under a non-superuser owner with FORCE RLS and restores prior scope", async () => {
  const client = await db.connect();
  const name = `attachment_migration_${run}`;
  const first = randomUUID(),
    second = randomUUID(),
    user = randomUUID();
  try {
    await client.query("BEGIN");
    // All DDL, test role and fixture data are rolled back, including on failure.
    await client.query(`CREATE ROLE ${name} NOSUPERUSER NOBYPASSRLS`);
    await client.query(`CREATE SCHEMA ${name} AUTHORIZATION ${name}`);
    await client.query(`SET LOCAL ROLE ${name}`);
    await client.query(`SET LOCAL search_path=${name},public`);
    const role = (
      await client.query(
        "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
      )
    ).rows[0];
    assert.deepEqual(role, { rolsuper: false, rolbypassrls: false });
    await client.query(`CREATE TABLE tenants(id uuid PRIMARY KEY);
      CREATE TABLE platform_users(id uuid PRIMARY KEY);
      CREATE TABLE citizens(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),UNIQUE(tenant_id,id));
      CREATE TABLE attachments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),citizen_id uuid NOT NULL,uploaded_by uuid NOT NULL REFERENCES platform_users(id),mime_type text NOT NULL,byte_length integer NOT NULL CHECK(byte_length BETWEEN 1 AND 2097152),bytes bytea NOT NULL,scan_state text NOT NULL DEFAULT 'UNSCANNED',created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,citizen_id) REFERENCES citizens(tenant_id,id));`);
    await client.query("INSERT INTO tenants(id) VALUES($1),($2)", [
      first,
      second,
    ]);
    await client.query("INSERT INTO platform_users(id) VALUES($1)", [user]);
    for (const office of [first, second]) {
      const citizen = randomUUID();
      await client.query("INSERT INTO citizens(id,tenant_id) VALUES($1,$2)", [
        citizen,
        office,
      ]);
      await client.query(
        "INSERT INTO attachments(tenant_id,citizen_id,uploaded_by,mime_type,byte_length,bytes) VALUES($1,$2,$3,'application/pdf',$4,$5)",
        [office, citizen, user, bytes.length, bytes],
      );
    }
    await client.query(
      "ALTER TABLE attachments ENABLE ROW LEVEL SECURITY; ALTER TABLE attachments FORCE ROW LEVEL SECURITY; CREATE POLICY tenant_scope ON attachments USING(tenant_id=nullif(current_setting('astra.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('astra.tenant_id',true),'')::uuid)",
    );
    await client.query("SELECT set_config('astra.tenant_id',$1,true)", [
      tenantId,
    ]);
    assert.equal(
      (await client.query("SELECT count(*)::int n FROM attachments")).rows[0].n,
      0,
    );
    await client.query(
      fs.readFileSync("db/migrations/015_attachment_quarantine.sql", "utf8"),
    );
    assert.equal(
      (await client.query("SELECT current_setting('astra.tenant_id') scope"))
        .rows[0].scope,
      tenantId,
    );
    for (const office of [first, second]) {
      await client.query("SELECT set_config('astra.tenant_id',$1,true)", [
        office,
      ]);
      const rows = (
        await client.query(
          "SELECT scan_state,content_sha256,scan_attempts,bytes FROM attachments",
        )
      ).rows;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].scan_state, "QUARANTINED");
      assert.equal(rows[0].content_sha256, digest(bytes));
      assert.equal(rows[0].scan_attempts, 0);
      assert.deepEqual(rows[0].bytes, bytes);
    }
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
