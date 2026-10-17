import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDemoPayload } from "@astra/shared-schemas";
import { app } from "../src/app.js";
import { pool } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";

type Session = { cookie: string; csrf: string; user: any };
const sessions: Record<string, Session> = {};
const run = randomUUID().slice(0, 8);
const password = "Synthetic-Lookup-Pass!";
let server: ReturnType<typeof app.listen>, base: string;
let issued: any, certificate: any, draft: any, neighborDraft: any;

async function request(
  method: string,
  path: string,
  data?: unknown,
  role?: string,
) {
  const session = role ? sessions[role] : undefined;
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
    body: await response.json(),
  };
}

async function login(role: string, email: string, secret = password) {
  const response = await request("POST", "/auth/login", {
    email,
    password: secret,
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  sessions[role] = {
    cookie: response.headers.get("set-cookie")!.split(";")[0]!,
    csrf: response.body.csrfToken,
    user: response.body.user,
  };
}

async function createOffice(suffix: string, role: string) {
  const slug = `lookup-${run}-${suffix}`;
  const response = await request(
    "POST",
    "/owner/tenants",
    {
      slug,
      nameBn: "পরীক্ষা অফিস",
      nameEn: "Synthetic lookup office",
      division: "Test Division",
      district: "Test District",
      upazila: "Test Upazila",
      officeType: "UNION",
      adminEmail: `admin@${slug}.test`,
      adminName: "Synthetic lookup admin",
      adminPassword: password,
    },
    "owner",
  );
  assert.equal(response.status, 201, JSON.stringify(response.body));
  await login(role, `admin@${slug}.test`);
  return response.body;
}

async function signup(role: string, tenantId: string) {
  const email = `${role}-${run}@lookup.synthetic.test`;
  const response = await request("POST", "/auth/signup", {
    email,
    password,
    displayName: "Synthetic lookup citizen",
    tenantId,
    nameBn: "পরীক্ষা নাগরিক",
    nameEn: "Synthetic lookup citizen",
    dateOfBirth: "1998-02-03",
    addressBn: "পরীক্ষা ঠিকানা",
    addressEn: "Synthetic lookup address",
    syntheticReference: `DEMO-LOOKUP-${role}-${run}`,
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  await login(role, email);
  return (await request("GET", "/citizens", undefined, role)).body.items[0];
}

async function createApplication(citizenId: string, role: string) {
  const response = await request(
    "POST",
    "/applications",
    {
      citizenId,
      serviceNo: 45,
      payload: getDemoPayload(45),
    },
    role,
  );
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body;
}

const lookup = (reference: string, role = "citizen") =>
  request(
    "GET",
    `/applications/lookup?reference=${encodeURIComponent(reference)}`,
    undefined,
    role,
  );

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  await login("owner", "owner@astra.demo.test", "Demo-Phase1!");
  const office = await createOffice("a", "admin");
  const foreignOffice = await createOffice("b", "foreignAdmin");
  for (const role of ["staff", "reviewer", "approver", "finance"]) {
    const response = await request(
      "POST",
      "/admin/users",
      {
        email: `${role}@${office.slug}.test`,
        displayName: `Synthetic lookup ${role}`,
        password,
        role,
      },
      "admin",
    );
    assert.equal(response.status, 201, JSON.stringify(response.body));
    await login(role, response.body.email);
  }
  const authorization = await request(
    "PUT",
    `/admin/authorizations/${sessions.approver!.user.id}/45`,
    {
      active: true,
      authorityNote: "Synthetic application reference lookup regression only",
    },
    "admin",
  );
  assert.equal(authorization.status, 200, JSON.stringify(authorization.body));
  const citizen = await signup("citizen", office.id);
  const neighbor = await signup("neighbor", office.id);
  await signup("foreignCitizen", foreignOffice.id);
  const order = await request(
    "POST",
    "/billing/orders",
    {
      kind: "subscription",
      planId: "demo-monthly",
    },
    "finance",
  );
  assert.equal(order.status, 201, JSON.stringify(order.body));
  const settlement = await request(
    "POST",
    `/billing/orders/${order.body.id}/demo-settle`,
    {},
    "finance",
  );
  assert.equal(settlement.status, 200, JSON.stringify(settlement.body));
  issued = await createApplication(citizen.id, "citizen");
  draft = await createApplication(citizen.id, "citizen");
  neighborDraft = await createApplication(neighbor.id, "neighbor");
  for (const [action, role] of [
    ["submit", "citizen"],
    ["review", "reviewer"],
    ["approve", "approver"],
  ]) {
    const response = await request(
      "POST",
      `/applications/${issued.id}/transition`,
      { action },
      role,
    );
    assert.equal(response.status, 200, JSON.stringify(response.body));
  }
  const issuance = await request(
    "POST",
    `/applications/${issued.id}/issue`,
    {},
    "approver",
  );
  assert.equal(issuance.status, 201, JSON.stringify(issuance.body));
  certificate = issuance.body;
});

after(async () => {
  await closePdfBrowser();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

test("LOOKUP-01: exact application UUID and issued certificate number resolve with a minimal private response", async () => {
  const expected = {
    application: { id: issued.id, serviceNo: 45, state: "ISSUED" },
    certificate: {
      id: certificate.id,
      number: certificate.number,
      status: "ISSUED",
    },
  };
  for (const reference of [
    issued.id,
    issued.id.toUpperCase(),
    certificate.number,
    `  ${certificate.number.toLowerCase()}  `,
  ]) {
    const response = await lookup(reference);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(
      response.body,
      expected,
      "Lookup must not disclose citizen, payload, verification token, PDF or eligibility fields",
    );
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  const response = await lookup(draft.id);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    application: { id: draft.id, serviceNo: 45, state: "DRAFT" },
    certificate: null,
  });
});

test("LOOKUP-02: authorized office roles can resolve references but citizens only see their own applications", async () => {
  for (const role of ["staff", "admin", "reviewer", "approver"]) {
    assert.equal((await lookup(certificate.number, role)).status, 200);
    assert.equal((await lookup(neighborDraft.id, role)).status, 200);
  }
  assert.equal((await lookup(neighborDraft.id, "neighbor")).status, 200);
  for (const reference of [issued.id, certificate.number, draft.id])
    assert.equal((await lookup(reference, "neighbor")).status, 404);
  assert.equal((await lookup(neighborDraft.id)).status, 404);
});

test("LOOKUP-03: unknown, partial and cross-tenant references have indistinguishable not-found responses", async () => {
  const missing = await lookup(randomUUID());
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.body, {
    error: { code: "NOT_FOUND", message: "Application not found." },
  });
  for (const role of ["foreignAdmin", "foreignCitizen"]) {
    for (const reference of [issued.id, certificate.number, draft.id]) {
      const response = await lookup(reference, role);
      assert.equal(response.status, 404);
      assert.deepEqual(response.body, missing.body);
    }
    const forgedTenant = await request(
      "GET",
      `/applications/lookup?reference=${issued.id}&tenantId=${sessions.citizen!.user.tenantId}`,
      undefined,
      role,
    );
    assert.equal(forgedTenant.status, 404);
    assert.deepEqual(forgedTenant.body, missing.body);
  }
  for (const reference of [
    certificate.id,
    issued.id.slice(0, 8),
    certificate.number.slice(0, -1),
    `${certificate.number}%`,
    "104373",
    "' OR 1=1 --",
  ]) {
    const response = await lookup(reference);
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, missing.body);
  }
});

test("LOOKUP-04: malformed references return 400 and login/role restrictions apply before resolution", async () => {
  for (const path of [
    "/applications/lookup",
    "/applications/lookup?reference=",
    "/applications/lookup?reference=%20%20",
    "/applications/lookup?reference=a&reference=b",
    `/applications/lookup?reference=${"A".repeat(129)}`,
    "/applications/lookup?reference=a%00b",
    "/applications/lookup?reference=a%0Ab",
  ]) {
    const response = await request("GET", path, undefined, "citizen");
    assert.equal(response.status, 400, path);
    assert.equal(response.body.error.code, "INPUT_INVALID");
  }
  assert.equal(
    (await request("GET", `/applications/lookup?reference=${issued.id}`))
      .status,
    401,
  );
  for (const role of ["finance", "owner"])
    assert.equal((await lookup(issued.id, role)).status, 403);
});

test("LOOKUP-05: repeated resolution leaves application history, renewal lineage and credits unchanged", async () => {
  const detailBefore = (
    await request("GET", `/applications/${issued.id}`, undefined, "citizen")
  ).body;
  const walletBefore = (await request("GET", "/wallet", undefined, "finance"))
    .body;
  for (let count = 0; count < 3; count++) {
    assert.equal((await lookup(certificate.number)).status, 200);
    assert.equal((await lookup(draft.id)).status, 200);
  }
  assert.deepEqual(
    (await request("GET", `/applications/${issued.id}`, undefined, "citizen"))
      .body,
    detailBefore,
  );
  assert.deepEqual(
    (await request("GET", "/wallet", undefined, "finance")).body,
    walletBefore,
  );
});

test("LOOKUP-06: current submission and revocation states remain visible without bypassing renewal checks", async () => {
  const submit = await request(
    "POST",
    `/applications/${draft.id}/transition`,
    { action: "submit" },
    "citizen",
  );
  assert.equal(submit.status, 200, JSON.stringify(submit.body));
  const submitted = await lookup(draft.id);
  assert.equal(submitted.body.application.state, "SUBMITTED");
  assert.equal(submitted.body.certificate, null);
  assert.equal(
    (await request("POST", `/applications/${draft.id}/renew`, {}, "citizen"))
      .status,
    409,
  );
  const revoked = await request(
    "POST",
    `/certificates/${certificate.id}/revoke`,
    {
      reason: "Synthetic reference lookup revocation regression",
    },
    "approver",
  );
  assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
  const walletBefore = (await request("GET", "/wallet", undefined, "finance"))
    .body;
  for (const reference of [issued.id, certificate.number]) {
    const response = await lookup(reference);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      application: { id: issued.id, serviceNo: 45, state: "REVOKED" },
      certificate: {
        id: certificate.id,
        number: certificate.number,
        status: "REVOKED",
      },
    });
  }
  const renewal = await request(
    "POST",
    `/applications/${issued.id}/renew`,
    {},
    "citizen",
  );
  assert.equal(renewal.status, 409);
  assert.equal(renewal.body.error.code, "RENEWAL_SOURCE_INVALID");
  assert.deepEqual(
    (await request("GET", "/wallet", undefined, "finance")).body,
    walletBefore,
  );
});
