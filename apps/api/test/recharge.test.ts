import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";

const db = new pg.Pool({ connectionString: adminConnectionString });
// Test-only credentials are generated per run so no password-like literal sits in the repository.
const password = randomBytes(18).toString("base64url");
const run = randomUUID().slice(0, 8);
const bank = `test-bank-${run}`;
let server: ReturnType<typeof app.listen>, base: string;
const offices: Record<string, string> = {};
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
  const type = response.headers.get("content-type") ?? "";
  return { status: response.status, body: type.includes("json") ? await response.json() : Buffer.from(await response.arrayBuffer()) };
}
async function login(name: string, email: string, secret: string) {
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: secret }),
  });
  const json = await r.json();
  assert.equal(r.status, 200, JSON.stringify(json));
  s[name] = { cookie: r.headers.get("set-cookie")!.split(";")[0], csrf: json.csrfToken };
}
const jpeg = Buffer.concat([Buffer.from([255, 216, 255, 224]), randomBytes(64), Buffer.from([255, 217])]);
const today = new Date().toISOString().slice(0, 10);
const request = (reference: string, extra: Record<string, unknown> = {}) => ({
  amountMinor: 50000,
  bankCode: bank,
  depositReference: reference,
  depositDate: today,
  proof: { mimeType: "image/jpeg", base64: jpeg.toString("base64") },
  ...extra,
});
/** Stands in for the scanner service: QUARANTINED → SCANNING → CLEAN. */
async function markClean(attachmentId: string) {
  const lease = createHash("sha256").update(randomUUID()).digest("hex");
  await db.query(
    "UPDATE attachments SET scan_state='SCANNING',scan_reason='PENDING_SCAN',scan_attempts=scan_attempts+1,lease_token_hash=$2,lease_expires_at=now()+interval '5 minutes',scan_worker_id='test-scanner',scan_engine_version='test',scan_signature_version='test',scan_signature_updated_at=now() WHERE id=$1",
    [attachmentId, lease],
  );
  await db.query(
    "UPDATE attachments SET scan_state='CLEAN',scan_reason='OK',lease_token_hash=NULL,lease_expires_at=NULL,scanned_at=now(),scanned_sha256=content_sha256 WHERE id=$1",
    [attachmentId],
  );
}
const proofOf = async (id: string) =>
  (await db.query("SELECT proof_attachment_id FROM recharge_requests WHERE id=$1", [id])).rows[0].proof_attachment_id as string;
const balance = async (tenantId: string) =>
  Number((await db.query("SELECT balance_minor FROM point_wallets WHERE tenant_id=$1", [tenantId])).rows[0].balance_minor);

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  await login("owner", "owner@astra.demo.test", "Demo-Phase1!");
  for (const name of ["one", "two"]) {
    const slug = `recharge-${name}-${run}`;
    const r = await req(
      "POST",
      "/owner/tenants",
      {
        slug,
        nameBn: "রিচার্জ পরীক্ষা অফিস",
        nameEn: `Synthetic recharge office ${name}`,
        division: "Test Division",
        district: "Test District",
        upazila: "Test Upazila",
        officeType: "UNION",
        adminEmail: `admin@${slug}.test`,
        adminName: "Synthetic recharge admin",
        adminPassword: password,
      },
      s.owner,
    );
    assert.equal(r.status, 201, JSON.stringify(r.body));
    offices[name] = (await db.query("SELECT id FROM tenants WHERE slug=$1", [slug])).rows[0].id;
    await login(name, `admin@${slug}.test`, password);
  }
  const added = await req(
    "PUT",
    `/owner/recharge-banks/${bank}`,
    { nameBn: "পরীক্ষা ব্যাংক", nameEn: "Synthetic Test Bank", accountName: "Astra Demo", accountNumber: "0000 1111 2222", active: true },
    s.owner,
  );
  assert.equal(added.status, 200, JSON.stringify(added.body));
});
after(async () => {
  await db.query("UPDATE recharge_banks SET active=false WHERE code=$1", [bank]);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await db.end();
});

test("Phase 5b: an office submits a recharge with its deposit slip; bad input and reused deposits are refused", async () => {
  assert.equal((await req("PUT", `/owner/recharge-banks/${bank}`, { nameBn: "x", nameEn: "x", accountName: "x", accountNumber: "1", active: true }, s.one)).status, 403);
  const banks = (await req("GET", "/recharge-banks", undefined, s.one)).body.items;
  assert.ok(banks.some((b: any) => b.code === bank && b.accountNumber === "0000 1111 2222"));

  const created = await req("POST", "/recharges", request(`DEP-${run}-1`), s.one);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.status, "PENDING");
  assert.equal(created.body.proofScanState, "QUARANTINED");
  const tomorrow = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  for (const [body, code] of [
    [request(`DEP-${run}-1`), 409],
    [request(`dep-${run}-1`), 409],
    [request(`DEP-${run}-x`, { depositDate: tomorrow }), 422],
    [request(`DEP-${run}-y`, { amountMinor: 50 }), 422],
    [request(`DEP-${run}-z`, { bankCode: "no-such-bank" }), 422],
    [request(`DEP-${run}-w`, { proof: { mimeType: "image/jpeg", base64: Buffer.from("not an image").toString("base64") } }), 422],
  ] as const)
    assert.equal((await req("POST", "/recharges", body, s.one)).status, code, JSON.stringify(body).slice(0, 80));
  // The slip is an office document: it is not reachable through the citizen attachment routes.
  const proof = await proofOf(created.body.id);
  assert.equal((await req("GET", `/attachments/${proof}/status`, undefined, s.one)).status, 404);
  // Each office sees only its own requests.
  assert.equal((await req("GET", "/recharges", undefined, s.two)).body.items.length, 0);
  assert.equal((await req("GET", "/recharges", undefined, s.one)).body.items.length, 1);
});

test("Phase 5b: the owner confirms only after a clean scan, crediting points exactly once", async () => {
  const queue = (await req("GET", "/owner/recharges", undefined, s.owner)).body.items;
  const item = queue.find((x: any) => x.tenantId === offices.one);
  assert.ok(item, "the request is in the owner queue");
  assert.equal(item.amountMinor, 50000);
  assert.equal((await req("GET", "/owner/recharges", undefined, s.one)).status, 403);

  const decide = (body: Record<string, unknown>, who = s.owner) =>
    req("POST", `/owner/recharges/${item.id}/decision`, { tenantId: offices.one, ...body }, who);
  const early = await decide({ decision: "CONFIRMED" });
  assert.equal(early.status, 409);
  assert.equal(early.body.error.code, "ATTACHMENT_NOT_READY");
  assert.equal((await req("GET", `/owner/recharges/${item.id}/proof?tenantId=${offices.one}`, undefined, s.owner)).status, 409);

  await markClean(await proofOf(item.id));
  const slip = await req("GET", `/owner/recharges/${item.id}/proof?tenantId=${offices.one}`, undefined, s.owner);
  assert.equal(slip.status, 200);
  assert.equal((slip.body as Buffer).equals(jpeg), true);
  // The office id in the request must match: another office's context cannot see it.
  assert.equal((await req("POST", `/owner/recharges/${item.id}/decision`, { tenantId: offices.two, decision: "CONFIRMED" }, s.owner)).status, 404);
  assert.equal((await decide({ decision: "CONFIRMED" }, s.one)).status, 403);

  const before = await balance(offices.one);
  const confirmed = await decide({ decision: "CONFIRMED" });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.equal(confirmed.body.status, "CONFIRMED");
  assert.equal(await balance(offices.one), before + 50000);
  const again = await decide({ decision: "CONFIRMED" });
  assert.equal(again.status, 409);
  assert.equal(await balance(offices.one), before + 50000, "credited once");
  const entry = await db.query("SELECT kind,delta_minor FROM point_ledger WHERE tenant_id=$1 AND idempotency_key=$2", [
    offices.one,
    `recharge:${item.id}`,
  ]);
  assert.deepEqual(entry.rows, [{ kind: "RECHARGE", delta_minor: "50000" }]);
  // The office sees the points and the decision.
  assert.equal((await req("GET", "/wallet/points", undefined, s.one)).body.balanceMinor, before + 50000);
  assert.equal((await req("GET", "/recharges", undefined, s.one)).body.items[0].status, "CONFIRMED");
});

test("Phase 5b: rejection needs a reason, frees the deposit reference, and decisions are final", async () => {
  const created = await req("POST", "/recharges", request(`DEP-${run}-2`), s.two);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const decide = (body: Record<string, unknown>) =>
    req("POST", `/owner/recharges/${created.body.id}/decision`, { tenantId: offices.two, ...body }, s.owner);
  assert.equal((await decide({ decision: "REJECTED" })).status, 422);
  const rejected = await decide({ decision: "REJECTED", note: "Deposit not found on the statement" });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
  assert.equal(rejected.body.decisionNote, "Deposit not found on the statement");
  assert.equal(await balance(offices.two), 0, "nothing credited");
  // A rejected reference may be submitted again (for example with a corrected slip).
  assert.equal((await req("POST", "/recharges", request(`DEP-${run}-2`), s.two)).status, 201);
  await assert.rejects(
    db.query("UPDATE recharge_requests SET status='CONFIRMED',decided_at=now() WHERE id=$1", [created.body.id]),
    /final/,
  );
  await assert.rejects(db.query("DELETE FROM recharge_requests WHERE id=$1", [created.body.id]), /Append-only/);
});
