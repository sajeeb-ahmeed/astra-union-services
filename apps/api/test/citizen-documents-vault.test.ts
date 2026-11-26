import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { app } from "../src/app.js";
import { demoPayloads } from "@astra/shared-schemas";
import { pool, adminConnectionString } from "../src/db.js";
import { hashPassword } from "../src/security.js";

// Citizen documents vault (migration 064): kind-keyed document slots with scan
// status, dual-read of the Phase 3c identity document, and the same ownership
// rules as the identity-document endpoint. The photo is not a vault kind.
const db = new pg.Pool({ connectionString: adminConnectionString });
// Test-only credentials are generated per run so no password-like literal sits in the repository.
const password = randomBytes(12).toString("base64url");
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
  nameBn: "ভল্ট পরীক্ষার নাগরিক",
  nameEn,
  dateOfBirth: "1991-04-12",
  addressBn: "পরীক্ষা গ্রাম ঠিকানা",
  addressEn: "Test village address",
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
async function documents(citizenId: string, session: Session) {
  const r = await req("GET", `/citizens/${citizenId}/documents`, undefined, session);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.items as any[];
}
let citizenId: string, otherCitizenId: string;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  tenantId = (
    await db.query(
      "WITH created AS (INSERT INTO tenants(slug,name_bn,name_en) VALUES($1,'ভল্ট পরীক্ষা অফিস','Vault test office') RETURNING id) INSERT INTO tenant_wallets(tenant_id) SELECT id FROM created RETURNING tenant_id AS id",
      [`vault-${run}`],
    )
  ).rows[0].id;
  for (const name of ["staff", "reviewer"]) {
    const email = `${name}-${run}@vault.synthetic.test`;
    const id = (
      await db.query(
        "INSERT INTO platform_users(email,display_name,password_hash) VALUES($1,'Synthetic vault test',$2) RETURNING id",
        [email, hashPassword(password)],
      )
    ).rows[0].id;
    await db.query("INSERT INTO staff_memberships(user_id,tenant_id,role) VALUES($1,$2,$3)", [id, tenantId, name]);
    s[name] = await signIn(email);
  }
  const signup = await req("POST", "/auth/signup", {
    ...person("Vault Self Citizen"),
    email: `self-${run}@vault.synthetic.test`,
    password,
    displayName: "Vault self-service citizen",
    tenantId,
  });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  s.self = await signIn(`self-${run}@vault.synthetic.test`);
  citizenId = (await req("GET", "/citizens", undefined, s.self)).body.items[0].id;
  otherCitizenId = (await req("POST", "/citizens", person("Vault Other Citizen"), s.staff)).body.id;
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await db.end();
});

test("vault: link, list with scan status, replace and remove", async () => {
  assert.deepEqual(await documents(citizenId, s.self), []);

  const nidScan = await upload(citizenId, s.self);
  const linked = await req("PUT", `/citizens/${citizenId}/documents/nid`, { attachmentId: nidScan }, s.self);
  assert.equal(linked.status, 200, JSON.stringify(linked.body));
  assert.equal(linked.body.items.length, 1);
  assert.equal(linked.body.items[0].kind, "nid");
  assert.equal(linked.body.items[0].attachmentId, nidScan);
  // Quarantined until the scanner passes: listed, but not downloadable.
  assert.notEqual(linked.body.items[0].scanState, "CLEAN");
  assert.equal(linked.body.items[0].downloadAllowed, false);
  assert.ok(linked.body.items[0].updatedAt, "vault rows carry updatedAt");

  const birthScan = await upload(citizenId, s.self);
  await req("PUT", `/citizens/${citizenId}/documents/birth_reg`, { attachmentId: birthScan }, s.self);
  const both = await documents(citizenId, s.staff);
  assert.deepEqual(both.map((d) => d.kind), ["birth_reg", "nid"]);

  await markClean(nidScan);
  const afterScan = await documents(citizenId, s.self);
  const nid = afterScan.find((d) => d.kind === "nid");
  assert.equal(nid.scanState, "CLEAN");
  assert.equal(nid.downloadAllowed, true);

  // Replacing a kind swaps the attachment; the old upload is kept.
  const nidScan2 = await upload(citizenId, s.self);
  await req("PUT", `/citizens/${citizenId}/documents/nid`, { attachmentId: nidScan2 }, s.self);
  assert.equal((await documents(citizenId, s.self)).find((d) => d.kind === "nid").attachmentId, nidScan2);
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM attachments WHERE id=$1", [nidScan])).rows[0].n,
    1,
    "replaced upload is kept",
  );

  // Removing a kind clears the slot and is audited; the upload is kept.
  const removed = await req("PUT", `/citizens/${citizenId}/documents/nid`, { attachmentId: null }, s.staff);
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.deepEqual(removed.body.items.map((d: any) => d.kind), ["birth_reg"]);
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM attachments WHERE id=$1", [nidScan2])).rows[0].n,
    1,
    "unlinked upload is kept",
  );
  const audits = await db.query(
    "SELECT action FROM audit_events WHERE tenant_id=$1 AND resource_id=$2 AND action LIKE 'CITIZEN_DOCUMENT_%' ORDER BY created_at",
    [tenantId, citizenId],
  );
  assert.deepEqual(
    audits.rows.map((r) => r.action),
    ["CITIZEN_DOCUMENT_LINKED", "CITIZEN_DOCUMENT_LINKED", "CITIZEN_DOCUMENT_LINKED", "CITIZEN_DOCUMENT_REMOVED"],
  );
});

test("vault: a document of another citizen cannot be linked, by the API or the database", async () => {
  const foreign = await upload(otherCitizenId, s.staff);
  const refused = await req("PUT", `/citizens/${citizenId}/documents/nid`, { attachmentId: foreign }, s.staff);
  assert.equal(refused.status, 404, JSON.stringify(refused.body));
  assert.equal(refused.body.error.code, "ATTACHMENT_NOT_FOUND");
  await assert.rejects(
    db.query("INSERT INTO citizen_documents(tenant_id,citizen_id,kind,attachment_id) VALUES($1,$2,'nid',$3)", [
      tenantId,
      citizenId,
      foreign,
    ]),
    /citizen_documents.*_fkey|foreign key/i,
  );
  // The kind CHECK refuses anything but the two attachment-backed kinds.
  const own = await upload(citizenId, s.self);
  await assert.rejects(
    db.query("INSERT INTO citizen_documents(tenant_id,citizen_id,kind,attachment_id) VALUES($1,$2,'photo',$3)", [
      tenantId,
      citizenId,
      own,
    ]),
    /citizen_documents_kind_check|check constraint/i,
  );
  // A citizen cannot reach another citizen's vault; a reviewer can read but not change links.
  assert.equal((await req("GET", `/citizens/${otherCitizenId}/documents`, undefined, s.self)).status, 404);
  assert.equal(
    (await req("PUT", `/citizens/${otherCitizenId}/documents/nid`, { attachmentId: null }, s.self)).status,
    404,
  );
  assert.equal((await req("GET", `/citizens/${citizenId}/documents`, undefined, s.reviewer)).status, 200);
  assert.equal(
    (await req("PUT", `/citizens/${citizenId}/documents/nid`, { attachmentId: null }, s.reviewer)).status,
    403,
  );
  // Unknown kinds and malformed bodies are client errors, never 500s.
  assert.equal(
    (await req("PUT", `/citizens/${citizenId}/documents/photo`, { attachmentId: own }, s.staff)).status,
    422,
  );
  for (const body of [{}, { attachmentId: "not-a-uuid" }, { document: null }])
    assert.equal((await req("PUT", `/citizens/${citizenId}/documents/nid`, body, s.staff)).status, 422);
});

test("vault: dual-read surfaces a Phase 3c identity document, and removal never resurrects it", async () => {
  // Clear the vault first so only the legacy link remains.
  await req("PUT", `/citizens/${citizenId}/documents/birth_reg`, { attachmentId: null }, s.staff);
  const legacy = await upload(citizenId, s.self);
  // A legacy-only link as it exists in data written before migration 064: only the
  // Phase 3c columns are set (the legacy endpoint now also writes the vault — see
  // the "legacy endpoint keeps the vault in sync" test below).
  await db.query(
    "UPDATE citizens SET identity_document_id=$2,identity_document_kind='birth_reg' WHERE id=$1",
    [citizenId, legacy],
  );

  const listed = await documents(citizenId, s.self);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].kind, "birth_reg");
  assert.equal(listed[0].attachmentId, legacy);
  assert.equal(listed[0].updatedAt, null, "dual-read legacy rows have no vault updatedAt");

  // Replacing through the vault keeps the Phase 3c reader in sync for that kind.
  const replacement = await upload(citizenId, s.self);
  await req("PUT", `/citizens/${citizenId}/documents/birth_reg`, { attachmentId: replacement }, s.self);
  const citizen = (await req("GET", "/citizens", undefined, s.staff)).body.items.find((c: any) => c.id === citizenId);
  assert.deepEqual(citizen.identityDocument, { attachmentId: replacement, kind: "birth_reg" });

  // Removing through the vault clears the legacy link too — no resurrection.
  await req("PUT", `/citizens/${citizenId}/documents/birth_reg`, { attachmentId: null }, s.self);
  assert.deepEqual(await documents(citizenId, s.self), []);
  const row = (
    await db.query("SELECT identity_document_id,identity_document_kind FROM citizens WHERE id=$1", [citizenId])
  ).rows[0];
  assert.deepEqual(row, { identity_document_id: null, identity_document_kind: null });
});

test("vault: the Phase 3c identity-document endpoint keeps the vault in sync (replace and remove)", async () => {
  await req("PUT", `/citizens/${citizenId}/documents/nid`, { attachmentId: null }, s.staff);
  const first = await upload(citizenId, s.self);
  await req("PUT", `/citizens/${citizenId}/documents/nid`, { attachmentId: first }, s.self);
  // Staff replace the NID through the older register control.
  const second = await upload(citizenId, s.staff);
  const replaced = await req(
    "PUT",
    `/citizens/${citizenId}/identity-document`,
    { document: { attachmentId: second, kind: "nid" } },
    s.staff,
  );
  assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
  const afterReplace = (await documents(citizenId, s.self)).filter((d: any) => d.kind === "nid");
  assert.equal(afterReplace.length, 1);
  assert.equal(afterReplace[0].attachmentId, second, "vault shows the replacement, not the stale document");
  // Removing through the older control empties the vault slot too.
  const removed = await req("PUT", `/citizens/${citizenId}/identity-document`, { document: null }, s.staff);
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.deepEqual((await documents(citizenId, s.self)).filter((d: any) => d.kind === "nid"), []);
});

test("S-010: plain staff read an application's nid_number masked; the reviewer reads it in full", async () => {
  const nid = "1990123456789";
  await db.query("INSERT INTO tenant_service_configuration(tenant_id,service_no) VALUES($1,15) ON CONFLICT DO NOTHING", [tenantId]);
  const created = await req(
    "POST",
    "/applications",
    { citizenId, serviceNo: 15, payload: { ...demoPayloads[15], nid_number: nid } },
    s.staff,
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const asStaff = await req("GET", `/applications/${created.body.id}`, undefined, s.staff);
  assert.equal(asStaff.status, 200, JSON.stringify(asStaff.body));
  assert.notEqual(asStaff.body.payload.nid_number, nid, "staff never receive the full NID");
  assert.ok(!JSON.stringify(asStaff.body).includes(nid), "no full NID anywhere in the staff response");
  const asReviewer = await req("GET", `/applications/${created.body.id}`, undefined, s.reviewer);
  assert.equal(asReviewer.status, 200, JSON.stringify(asReviewer.body));
  assert.equal(asReviewer.body.payload.nid_number, nid, "reviewer keeps the full number for issuance checks");
  assert.equal(asReviewer.body.versions.at(-1).payload.nid_number, nid);
});

test("vault: staff of another office can neither read nor change a citizen's vault (tenant isolation)", async () => {
  const otherTenant = (
    await db.query(
      "WITH created AS (INSERT INTO tenants(slug,name_bn,name_en) VALUES($1,'অন্য অফিস','Other vault office') RETURNING id) INSERT INTO tenant_wallets(tenant_id) SELECT id FROM created RETURNING tenant_id AS id",
      [`vault-other-${run}`],
    )
  ).rows[0].id;
  const email = `other-staff-${run}@vault.synthetic.test`;
  const userId = (
    await db.query(
      "INSERT INTO platform_users(email,display_name,password_hash) VALUES($1,'Synthetic other-office staff',$2) RETURNING id",
      [email, hashPassword(password)],
    )
  ).rows[0].id;
  await db.query("INSERT INTO staff_memberships(user_id,tenant_id,role) VALUES($1,$2,'staff')", [userId, otherTenant]);
  const outsider = await signIn(email);
  const own = await upload(citizenId, s.self);
  await req("PUT", `/citizens/${citizenId}/documents/nid`, { attachmentId: own }, s.self);
  const read = await req("GET", `/citizens/${citizenId}/documents`, undefined, outsider);
  assert.equal(read.status, 404, "another office's staff cannot see the citizen or the vault");
  const write = await req("PUT", `/citizens/${citizenId}/documents/nid`, { attachmentId: null }, outsider);
  assert.equal(write.status, 404, "another office's staff cannot clear the vault slot");
  const still = (await documents(citizenId, s.self)).filter((d: any) => d.kind === "nid");
  assert.equal(still[0]?.attachmentId, own, "the vault slot is unchanged");
  // RLS itself (not only the app predicate): as the restricted runtime role
  // scoped to the other office, citizen_documents rows of this office are invisible.
  const app = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await app.connect();
  try {
    await app.query("BEGIN");
    await app.query("SELECT set_config('astra.tenant_id',$1,true)", [otherTenant]);
    const leaked = (await app.query("SELECT count(*)::int n FROM citizen_documents WHERE citizen_id=$1", [citizenId])).rows[0].n;
    assert.equal(leaked, 0, "RLS hides another office's vault rows from astra_app");
    await app.query("ROLLBACK");
  } finally {
    await app.end();
  }
});
