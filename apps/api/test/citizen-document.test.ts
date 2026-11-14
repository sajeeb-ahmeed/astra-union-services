import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { hashPassword } from "../src/security.js";

const db = new pg.Pool({ connectionString: adminConnectionString });
// Test-only credentials are generated per run so no password-like literal sits in the repository.
const password = randomBytes(18).toString("base64url");
const run = randomUUID().slice(0, 8);
let server: ReturnType<typeof app.listen>, base: string, tenantId: string;
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
  return { status: response.status, body: type.includes("json") ? await response.json() : await response.arrayBuffer() };
}
async function signIn(email: string): Promise<Session> {
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = await r.json();
  assert.equal(r.status, 200, JSON.stringify(json));
  return { cookie: r.headers.get("set-cookie")!.split(";")[0], csrf: json.csrfToken };
}
const person = (nameEn: string) => ({
  nameBn: "নথি পরীক্ষার নাগরিক",
  nameEn,
  dateOfBirth: "1989-09-10",
  addressBn: "নমুনা গ্রাম ঠিকানা",
  addressEn: "Synthetic village address",
});
// A minimal well-formed JPEG: start and end markers around a little filler.
const jpeg = Buffer.concat([Buffer.from([255, 216, 255, 224]), randomBytes(64), Buffer.from([255, 217])]);
async function upload(citizenId: string, session: Session) {
  const r = await req("POST", "/attachments", { citizenId, mimeType: "image/jpeg", base64: jpeg.toString("base64") }, session);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.attachmentId as string;
}
/** Stands in for the scanner service: QUARANTINED → SCANNING → CLEAN, the transitions the database allows. */
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
let citizenId: string, otherCitizenId: string;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  tenantId = (
    await db.query(
      "WITH created AS (INSERT INTO tenants(slug,name_bn,name_en) VALUES($1,'পরীক্ষা অফিস','Synthetic document office') RETURNING id) INSERT INTO tenant_wallets(tenant_id) SELECT id FROM created RETURNING tenant_id AS id",
      [`document-${run}`],
    )
  ).rows[0].id;
  for (const name of ["staff", "reviewer"]) {
    const email = `${name}-${run}@document.synthetic.test`;
    const id = (
      await db.query(
        "INSERT INTO platform_users(email,display_name,password_hash) VALUES($1,'Synthetic document test',$2) RETURNING id",
        [email, hashPassword(password)],
      )
    ).rows[0].id;
    await db.query("INSERT INTO staff_memberships(user_id,tenant_id,role) VALUES($1,$2,$3)", [id, tenantId, name]);
    s[name] = await signIn(email);
  }
  const signup = await req("POST", "/auth/signup", {
    ...person("Document Self Citizen"),
    email: `self-${run}@document.synthetic.test`,
    password,
    displayName: "Document self-service citizen",
    tenantId,
  });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  s.self = await signIn(`self-${run}@document.synthetic.test`);
  citizenId = (await req("GET", "/citizens", undefined, s.self)).body.items[0].id;
  otherCitizenId = (await req("POST", "/citizens", person("Document Other Citizen"), s.staff)).body.id;
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await db.end();
});

test("Phase 3c: a citizen links their ID image; it stays quarantined until a clean scan", async () => {
  const attachmentId = await upload(citizenId, s.self);
  const linked = await req(
    "PUT",
    `/citizens/${citizenId}/identity-document`,
    { document: { attachmentId, kind: "nid" } },
    s.self,
  );
  assert.equal(linked.status, 200, JSON.stringify(linked.body));
  assert.deepEqual(linked.body.identityDocument, { attachmentId, kind: "nid" });

  // Staff see the link, but the image cannot be opened before the scan passes.
  const list = (await req("GET", "/citizens", undefined, s.staff)).body.items;
  assert.deepEqual(list.find((c: any) => c.id === citizenId).identityDocument, { attachmentId, kind: "nid" });
  const early = await req("GET", `/attachments/${attachmentId}`, undefined, s.staff);
  assert.equal(early.status, 409);
  assert.equal(early.body.error.code, "ATTACHMENT_NOT_READY");

  await markClean(attachmentId);
  const opened = await req("GET", `/attachments/${attachmentId}`, undefined, s.staff);
  assert.equal(opened.status, 200);
  assert.equal(Buffer.from(opened.body as ArrayBuffer).equals(jpeg), true);

  const audits = await db.query(
    "SELECT action FROM audit_events WHERE tenant_id=$1 AND resource_id=$2 AND action LIKE 'CITIZEN_IDENTITY_DOCUMENT_%'",
    [tenantId, citizenId],
  );
  assert.deepEqual(audits.rows.map((r) => r.action), ["CITIZEN_IDENTITY_DOCUMENT_LINKED"]);
});

test("Phase 3c: a document of another citizen cannot be linked, by the API or the database", async () => {
  const foreign = await upload(otherCitizenId, s.staff);
  const refused = await req(
    "PUT",
    `/citizens/${citizenId}/identity-document`,
    { document: { attachmentId: foreign, kind: "birth_reg" } },
    s.staff,
  );
  assert.equal(refused.status, 404, JSON.stringify(refused.body));
  assert.equal(refused.body.error.code, "ATTACHMENT_NOT_FOUND");
  await assert.rejects(
    db.query("UPDATE citizens SET identity_document_id=$2,identity_document_kind='nid' WHERE id=$1", [citizenId, foreign]),
    /citizens_identity_document_own/,
  );
  await assert.rejects(
    db.query("UPDATE citizens SET identity_document_kind=NULL WHERE id=$1", [citizenId]),
    /citizens_identity_document_parts/,
  );
  // A citizen cannot reach another citizen's record; a reviewer cannot change links.
  assert.equal(
    (await req("PUT", `/citizens/${otherCitizenId}/identity-document`, { document: null }, s.self)).status,
    404,
  );
  assert.equal(
    (await req("PUT", `/citizens/${citizenId}/identity-document`, { document: null }, s.reviewer)).status,
    403,
  );
  for (const body of [{ document: { attachmentId: foreign, kind: "passport" } }, { attachmentId: foreign }, {}])
    assert.equal((await req("PUT", `/citizens/${citizenId}/identity-document`, body, s.staff)).status, 422);
});

test("Phase 3c: unlinking keeps the upload but clears the record", async () => {
  const removed = await req("PUT", `/citizens/${citizenId}/identity-document`, { document: null }, s.staff);
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.equal(removed.body.identityDocument, null);
  const row = (await db.query("SELECT identity_document_id,identity_document_kind FROM citizens WHERE id=$1", [citizenId])).rows[0];
  assert.deepEqual(row, { identity_document_id: null, identity_document_kind: null });
});
