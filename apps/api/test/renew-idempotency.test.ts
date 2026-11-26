import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { getDemoPayload } from "@astra/shared-schemas";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";

/**
 * W-004 (follow-up): POST /applications/:id/renew is a second creation
 * path into applications, and it accepted no requestKey — a retried renew
 * created a second renewal draft (a concurrent race hit the
 * one_active_renewal unique index as a 500 instead of a clean replay).
 * It now takes the same optional requestKey as POST /applications, backed
 * by the same application_creation_keys claim: a replay returns the
 * original renewal with X-Idempotency-Replayed: true; a keyless or
 * different-key repeat still gets 409 RENEWAL_EXISTS; a failed renew
 * never consumes its key.
 */
const SERVICE = 45;
const run = randomUUID().slice(0, 8);
const password = randomBytes(12).toString("base64url");
const admin = new pg.Pool({ connectionString: adminConnectionString });
type Session = { cookie: string; csrf: string; user: any };
let server: ReturnType<typeof app.listen>, base: string;
let owner: Session, office: any, citizenId: string;
const sessions: Record<string, Session> = {};
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
    cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "",
    csrf: r.body.csrfToken,
    user: r.body.user,
  } as Session;
}
async function adjust(tenantId: string, delta: number) {
  const r = await req(
    "POST",
    `/owner/tenants/${tenantId}/adjust`,
    { delta, reason: "W-004 renew test funding" },
    owner,
  );
  assert.equal(r.status, 201, JSON.stringify(r.body));
}
async function priceOf(serviceNo: number) {
  const r = await req("GET", "/owner/credit-prices", undefined, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.items.find((i: any) => i.serviceNo === serviceNo)
    .priceCredits as number;
}
async function walletOf(tenantId: string) {
  const r = await req("GET", "/owner/tenants", undefined, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.items.find((t: any) => t.id === tenantId)?.balance as number;
}
async function transition(id: string, action: string, session: Session, reason?: string) {
  return req(
    "POST",
    `/applications/${id}/transition`,
    { action, ...(reason ? { reason } : {}) },
    session,
  );
}
async function issueApplication(): Promise<{ id: string; certificateId: string }> {
  const price = await priceOf(SERVICE);
  assert.ok(price >= 1, "service 45 must have a positive credit price");
  await adjust(office.id, price);
  const before = await walletOf(office.id);
  const drafted = await req(
    "POST",
    "/applications",
    {
      citizenId,
      serviceNo: SERVICE,
      payload: { ...getDemoPayload(SERVICE), delivery_language: "bn" },
    },
    sessions.staff,
  );
  assert.equal(drafted.status, 201, JSON.stringify(drafted.body));
  const id = drafted.body.id as string;
  const submitted = await transition(id, "submit", sessions.staff);
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  assert.equal(await walletOf(office.id), before - price, "submit takes the credit fee once");
  const approved = await transition(id, "approve", sessions.approver);
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.ok(approved.body.certificate?.number, "certificate issued");
  return { id, certificateId: approved.body.certificate.id as string };
}
async function renewLinks(certificateId: string): Promise<number> {
  const r = await admin.query(
    "SELECT COUNT(*)::int AS n FROM renewal_links WHERE source_certificate_id=$1",
    [certificateId],
  );
  return r.rows[0].n as number;
}
async function renew(id: string, data: unknown) {
  return req("POST", `/applications/${id}/renew`, data, sessions.staff);
}

before(async () => {
  process.env.NODE_ENV = "test";
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  owner = await login("owner@astra.demo.test", "Demo-Phase1!");
  const slug = `w004r-${run}`;
  const created = await req(
    "POST",
    "/owner/tenants",
    {
      slug,
      nameBn: "ডব্লিউ-০০৪ পুনর্নবীকরণ পরীক্ষা অফিস",
      nameEn: "W-004 renew test office",
      division: "Test Division",
      district: "Test District",
      upazila: "Test Upazila",
      officeType: "UNION",
      adminEmail: `admin@${slug}.test`,
      adminName: "W-004 Renew Admin",
      adminPassword: password,
    },
    owner,
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  office = created.body;
  const adminSession = await login(`admin@${slug}.test`);
  sessions.admin = adminSession;
  for (const roleName of ["approver", "staff"]) {
    const u = await req(
      "POST",
      "/admin/users",
      {
        email: `${roleName}@${slug}.test`,
        displayName: `W-004 Renew ${roleName}`,
        password,
        role: roleName,
      },
      adminSession,
    );
    assert.equal(u.status, 201, JSON.stringify(u.body));
    sessions[roleName] = await login(`${roleName}@${slug}.test`);
  }
  const auth = await req(
    "PUT",
    `/admin/authorizations/${sessions.approver.user.id}/${SERVICE}`,
    { active: true, authorityNote: "Synthetic W-004 renew approval authority" },
    adminSession,
  );
  assert.equal(auth.status, 200, JSON.stringify(auth.body));
  const signature = await req(
    "PUT",
    "/office/certificate-assets/signature",
    {
      mimeType: "image/png",
      base64:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      reason: "Synthetic signature fixture for renew idempotency test",
    },
    sessions.approver,
  );
  assert.ok([200, 201].includes(signature.status), JSON.stringify(signature.body));
  const signup = await req("POST", "/auth/signup", {
    email: `citizen-${slug}@synthetic.test`,
    password,
    displayName: "W-004 Renew Citizen",
    tenantId: office.id,
    nameBn: "পরীক্ষা নাগরিক",
    nameEn: "W-004 Renew Citizen",
    dateOfBirth: "1998-02-03",
    addressBn: "পরীক্ষা ঠিকানা",
    addressEn: "Test address only",
    syntheticReference: `REF-${slug}`,
  });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  const citizenSession = await login(`citizen-${slug}@synthetic.test`);
  sessions.citizen = citizenSession;
  citizenId = (
    await req("GET", "/citizens", undefined, citizenSession)
  ).body.items[0].id;
});
after(async () => {
  await closePdfBrowser();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await admin.end();
});

test("W-004: a failed renew never consumes its key; the retry then creates exactly one renewal", async () => {
  const { id, certificateId } = await issueApplication();
  const key = randomUUID();
  // An empty payload fails validation (the demo payload has required
  // fields) — the key must not be consumed by this failure.
  const failed = await renew(id, { requestKey: key, payload: {} });
  assert.equal(failed.status, 422, JSON.stringify(failed.body));
  assert.equal(await renewLinks(certificateId), 0, "no renewal link from a failed renew");
  const created = await renew(id, { requestKey: key });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.headers.get("x-idempotency-replayed"), null, "a first success is not a replay");
  assert.ok(created.body.id, "renewal draft created");
  assert.equal(await renewLinks(certificateId), 1, "exactly one renewal link");
});

test("W-004: replaying the same renew key returns the original renewal, no second draft", async () => {
  const { id, certificateId } = await issueApplication();
  const key = randomUUID();
  const first = await renew(id, { requestKey: key });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const second = await renew(id, { requestKey: key });
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.equal(second.headers.get("x-idempotency-replayed"), "true", "replay must be flagged");
  assert.equal(second.body.id, first.body.id, "replay returns the original renewal");
  assert.equal(await renewLinks(certificateId), 1, "still exactly one renewal link");
});

test("W-004: a different key — or no key — on an already-renewed certificate gets 409 RENEWAL_EXISTS", async () => {
  const { id, certificateId } = await issueApplication();
  const first = await renew(id, { requestKey: randomUUID() });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const otherKey = await renew(id, { requestKey: randomUUID() });
  assert.equal(otherKey.status, 409, JSON.stringify(otherKey.body));
  assert.equal(otherKey.body.error?.code ?? otherKey.body.code, "RENEWAL_EXISTS", JSON.stringify(otherKey.body));
  const noKey = await renew(id, {});
  assert.equal(noKey.status, 409, JSON.stringify(noKey.body));
  assert.equal(await renewLinks(certificateId), 1, "no second renewal link");
});
