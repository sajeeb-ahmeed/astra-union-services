/**
 * W-002 (Phase 4 Stage 1, P1) — issuance quality gates run in ALL issuance
 * modes, not official mode only.
 *
 * Two layers: unit tests on assertCertificateGates (each gate's logic, and
 * that the mode env no longer changes the outcome) and API tests through
 * the approve/issue paths in demo mode and official mode (valid fixtures
 * pass; missing signature / missing amounts / one-sided language pair /
 * unauthorized approver are prevented).
 *
 * The synthetic offices use explicitly identified synthetic fixtures: a
 * 1x1 PNG signature uploaded through the office certificate-assets API
 * and zero-fee order policies published with a "synthetic" reason. Nothing
 * is bypassed — the gates run and pass or fail on the data in front of
 * them.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { getDemoPayload } from "@astra/shared-schemas";
import { app } from "../src/app.js";
import { pool } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";
import { assertCertificateGates } from "../src/cert-gates.js";

// These tests exercise the sandbox settlement route, off unless enabled.
process.env.DEMO_SETTLE_ENABLED = "true";
const run = randomUUID().slice(0, 8);
const password = randomBytes(12).toString("base64url");
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const SIGNATURE_REASON =
  "Synthetic signature fixture for demo-mode issuance regression (W-002); not a real chairman signature";

type Session = { cookie: string; csrf: string; user: any };
const sessions: Record<string, Session> = {};
let server: ReturnType<typeof app.listen>, base: string;

async function api(method: string, path: string, data?: unknown, session?: Session) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      ...(session ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : {} };
}
async function login(key: string, email: string, secret = password) {
  const response = await api("POST", "/auth/login", { email, password: secret });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  sessions[key] = {
    cookie: response.headers.get("set-cookie")!.split(";")[0]!,
    csrf: response.body.csrfToken,
    user: response.body.user,
  };
}

type OfficeSetup = {
  office: any;
  admin: Session;
  approver: Session;
  finance: Session;
  citizen: Session;
  citizenId: string;
};
async function setupOffice(suffix: string, services: number[]): Promise<OfficeSetup> {
  const slug = `certgates-${run}-${suffix}`;
  await login("owner", "owner@astra.demo.test", "Demo-Phase1!");
  const created = await api(
    "POST",
    "/owner/tenants",
    {
      slug,
      nameBn: "পরীক্ষা অফিস",
      nameEn: "Synthetic cert-gates office",
      division: "Test Division",
      district: "Test District",
      upazila: "Test Upazila",
      officeType: "UNION",
      adminEmail: `admin@${slug}.test`,
      adminName: "Synthetic cert-gates admin",
      adminPassword: password,
    },
    sessions.owner,
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const office = created.body;
  await login(`${suffix}-admin`, `admin@${slug}.test`);
  const admin = sessions[`${suffix}-admin`]!;
  for (const role of ["approver", "finance"]) {
    const response = await api(
      "POST",
      "/admin/users",
      {
        email: `${role}@${slug}.test`,
        displayName: `Synthetic cert-gates ${role}`,
        password,
        role,
      },
      admin,
    );
    assert.equal(response.status, 201, JSON.stringify(response.body));
    await login(`${suffix}-${role}`, response.body.email);
  }
  const approver = sessions[`${suffix}-approver`]!;
  const finance = sessions[`${suffix}-finance`]!;
  for (const serviceNo of services) {
    const authorization = await api(
      "PUT",
      `/admin/authorizations/${approver.user.id}/${serviceNo}`,
      { active: true, authorityNote: "Synthetic cert-gates regression only" },
      admin,
    );
    assert.equal(authorization.status, 200, JSON.stringify(authorization.body));
  }
  const email = `citizen-${run}-${suffix}@certgates.synthetic.test`;
  const signup = await api("POST", "/auth/signup", {
    email,
    password,
    displayName: "Synthetic cert-gates citizen",
    tenantId: office.id,
    nameBn: "পরীক্ষা নাগরিক",
    nameEn: "Synthetic cert-gates citizen",
    dateOfBirth: "1998-02-03",
    addressBn: "পরীক্ষা ঠিকানা",
    addressEn: "Synthetic cert-gates address",
    syntheticReference: `REF-CERTGATES-${run}-${suffix}`,
  });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  await login(`${suffix}-citizen`, email);
  const citizen = sessions[`${suffix}-citizen`]!;
  const citizenId = (await api("GET", "/citizens", undefined, citizen)).body.items[0].id;
  const order = await api(
    "POST",
    "/billing/orders",
    { kind: "subscription", planId: "standard-monthly" },
    finance,
  );
  assert.equal(order.status, 201, JSON.stringify(order.body));
  assert.equal(
    (await api("POST", `/billing/orders/${order.body.id}/demo-settle`, {}, finance)).status,
    200,
  );
  return { office, admin, approver, finance, citizen, citizenId };
}

async function uploadSyntheticSignature(setup: OfficeSetup) {
  const signature = await api(
    "PUT",
    "/office/certificate-assets/signature",
    { mimeType: "image/png", base64: TINY_PNG, reason: SIGNATURE_REASON },
    setup.approver,
  );
  assert.ok([200, 201].includes(signature.status), JSON.stringify(signature.body));
}
async function submittedApplication(setup: OfficeSetup, serviceNo: number, payload: any) {
  const created = await api(
    "POST",
    "/applications",
    { citizenId: setup.citizenId, serviceNo, payload },
    setup.citizen,
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id as string;
  const submitted = await api(
    "POST",
    `/applications/${id}/transition`,
    { action: "submit" },
    setup.citizen,
  );
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  return id;
}

let demoOffice: OfficeSetup;
let officialOffice: OfficeSetup;
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  demoOffice = await setupOffice("demo", [45, 10, 42]);
  officialOffice = await setupOffice("official", [45]);
});
after(async () => {
  await closePdfBrowser();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

/* --- Unit: the gate function itself --- */

function prepared(
  serviceNo: number,
  payload: Record<string, unknown>,
  opts: { order?: any; signature?: boolean } = {},
) {
  return {
    tenant: { id: "00000000-0000-4000-8000-000000000000" },
    service: { service_no: serviceNo },
    payload,
    pdfExtras: {
      order: opts.order ?? null,
      assets: opts.signature ? { signature: "data:image/png;base64,AAAA" } : {},
      issuer: null,
    },
  };
}
function gateCode(fn: () => void): string | null {
  try {
    fn();
    return null;
  } catch (error: any) {
    return error?.code ?? `threw:${error?.message}`;
  }
}
function withMode(mode: string | undefined, fn: () => void) {
  const prev = process.env.ISSUANCE_MODE;
  try {
    if (mode === undefined) delete process.env.ISSUANCE_MODE;
    else process.env.ISSUANCE_MODE = mode;
    fn();
  } finally {
    if (prev === undefined) delete process.env.ISSUANCE_MODE;
    else process.env.ISSUANCE_MODE = prev;
  }
}

test("W-002 unit: no signature blocks in every mode — the env no longer disables the gates", () => {
  for (const mode of [undefined, "demo", "official"]) {
    withMode(mode, () => {
      assert.equal(
        gateCode(() => assertCertificateGates(prepared(45, {}))),
        "SIGNATURE_MISSING",
        `mode ${mode ?? "(unset)"}`,
      );
    });
  }
});

test("W-002 unit: a configured signature lets a non-money service issue in every mode", () => {
  for (const mode of [undefined, "demo", "official"]) {
    withMode(mode, () => {
      assert.equal(
        gateCode(() =>
          assertCertificateGates(prepared(45, getDemoPayload(45), { signature: true })),
        ),
        null,
        `mode ${mode ?? "(unset)"}`,
      );
    });
  }
});

test("W-002 unit: service 1 needs its order snapshot; a zero total is data, not a gap", () => {
  assert.equal(
    gateCode(() => assertCertificateGates(prepared(1, getDemoPayload(1), { signature: true }))),
    "AMOUNTS_REQUIRED",
  );
  assert.equal(
    gateCode(() =>
      assertCertificateGates(
        prepared(1, getDemoPayload(1), { signature: true, order: { totalMinor: 0 } }),
      ),
    ),
    null,
  );
});

test("W-002 unit: services 41/42 need fee components or an order; a zero fee is data", () => {
  assert.equal(
    gateCode(() => assertCertificateGates(prepared(41, getDemoPayload(41), { signature: true }))),
    "AMOUNTS_REQUIRED",
  );
  assert.equal(
    gateCode(() =>
      assertCertificateGates(
        prepared(41, { ...getDemoPayload(41), premises_fee_licence: 0 }, { signature: true }),
      ),
    ),
    null,
  );
  assert.equal(
    gateCode(() => assertCertificateGates(prepared(42, getDemoPayload(42), { signature: true }))),
    "AMOUNTS_REQUIRED",
  );
  assert.equal(
    gateCode(() =>
      assertCertificateGates(
        prepared(42, { ...getDemoPayload(42), trade_fee_new: 0 }, { signature: true }),
      ),
    ),
    null,
  );
  assert.equal(
    gateCode(() =>
      assertCertificateGates(
        prepared(42, getDemoPayload(42), { signature: true, order: { totalMinor: 0 } }),
      ),
    ),
    null,
  );
});

test("W-002 unit: a one-sided BN/EN pair blocks and names the missing field; a full pair passes", () => {
  const oneSided = prepared(10, getDemoPayload(10), { signature: true });
  let missing: string[] | undefined;
  try {
    assertCertificateGates(oneSided);
    assert.fail("one-sided pair must block");
  } catch (error: any) {
    assert.equal(error.code, "LANGUAGE_VALUE_MISSING");
    missing = error.issues?.missing;
  }
  assert.ok(missing?.includes("last_occupation_en"), `missing names the EN side: ${missing}`);
  assert.equal(
    gateCode(() =>
      assertCertificateGates(
        prepared(10, { ...getDemoPayload(10), last_occupation_en: "Sample" }, { signature: true }),
      ),
    ),
    null,
  );
  // Service 1: the legacy single description covers both languages.
  assert.equal(
    gateCode(() =>
      assertCertificateGates(
        prepared(
          1,
          { ...getDemoPayload(1), property_description: "Sample" },
          { signature: true, order: { totalMinor: 0 } },
        ),
      ),
    ),
    null,
  );
});

/* --- API: demo mode --- */

test("W-002 api/demo: approval without a signature is blocked, the approval is recorded, and /issue completes it once a synthetic signature is uploaded", async () => {
  delete process.env.ISSUANCE_MODE;
  const id = await submittedApplication(demoOffice, 45, getDemoPayload(45));
  const blocked = await api(
    "POST",
    `/applications/${id}/transition`,
    { action: "approve" },
    demoOffice.approver,
  );
  assert.equal(blocked.status, 422, JSON.stringify(blocked.body));
  assert.equal(blocked.body.error.code, "SIGNATURE_MISSING");
  const detail = await api("GET", `/applications/${id}`, undefined, demoOffice.approver);
  assert.equal(detail.body.application.state, "APPROVED", "the approval is recorded despite the gate");
  assert.equal(detail.body.certificate, null, "no certificate was issued");
  await uploadSyntheticSignature(demoOffice);
  const issued = await api("POST", `/applications/${id}/issue`, {}, demoOffice.approver);
  assert.equal(issued.status, 201, JSON.stringify(issued.body));
  assert.ok(issued.body.id, "the completion path issues the recorded approval");
  assert.ok(issued.body.number.startsWith("DEMO-"), "demo-mode number keeps the DEMO- marker");
});

test("W-002 api/demo: a valid synthetic-signature fixture lets issuance pass", async () => {
  delete process.env.ISSUANCE_MODE;
  await uploadSyntheticSignature(demoOffice);
  const id = await submittedApplication(demoOffice, 45, getDemoPayload(45));
  const approved = await api(
    "POST",
    `/applications/${id}/transition`,
    { action: "approve" },
    demoOffice.approver,
  );
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.state, "ISSUED");
  assert.ok(approved.body.certificate?.number.startsWith("DEMO-"));
});

test("W-002 api/demo: a one-sided language pair blocks issuance in demo mode too", async () => {
  delete process.env.ISSUANCE_MODE;
  await uploadSyntheticSignature(demoOffice);
  const id = await submittedApplication(demoOffice, 10, getDemoPayload(10));
  const blocked = await api(
    "POST",
    `/applications/${id}/transition`,
    { action: "approve" },
    demoOffice.approver,
  );
  assert.equal(blocked.status, 422, JSON.stringify(blocked.body));
  assert.equal(blocked.body.error.code, "LANGUAGE_VALUE_MISSING");
  assert.ok(
    JSON.stringify(blocked.body.error.issues?.missing ?? []).includes("last_occupation_en"),
    "the error names the missing EN value",
  );
});

test("W-002 api/demo: a money service without fees or an order blocks in demo mode too", async () => {
  delete process.env.ISSUANCE_MODE;
  await uploadSyntheticSignature(demoOffice);
  const id = await submittedApplication(demoOffice, 42, getDemoPayload(42));
  const blocked = await api(
    "POST",
    `/applications/${id}/transition`,
    { action: "approve" },
    demoOffice.approver,
  );
  assert.equal(blocked.status, 422, JSON.stringify(blocked.body));
  assert.equal(blocked.body.error.code, "AMOUNTS_REQUIRED");
});

test("W-002 api/demo: an approver without a service-specific authorization cannot issue, even with a signature present", async () => {
  delete process.env.ISSUANCE_MODE;
  const slug = `certgates-${run}-demo`;
  const created = await api(
    "POST",
    "/admin/users",
    {
      email: `noauth@${slug}.test`,
      displayName: "Synthetic cert-gates unauthorized approver",
      password,
      role: "approver",
    },
    demoOffice.admin,
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  await login("demo-noauth", created.body.email);
  const id = await submittedApplication(demoOffice, 45, getDemoPayload(45));
  const denied = await api(
    "POST",
    `/applications/${id}/transition`,
    { action: "approve" },
    sessions["demo-noauth"],
  );
  assert.equal(denied.status, 403, JSON.stringify(denied.body));
  assert.equal(denied.body.error.code, "APPROVAL_AUTHORITY_REQUIRED");
});

/* --- API: official mode (validation unchanged) --- */

test("W-002 api/official: no signature blocks, and with the fixture issuance mints a production number", async () => {
  process.env.ISSUANCE_MODE = "official";
  try {
    const id = await submittedApplication(officialOffice, 45, getDemoPayload(45));
    const blocked = await api(
      "POST",
      `/applications/${id}/transition`,
      { action: "approve" },
      officialOffice.approver,
    );
    assert.equal(blocked.status, 422, JSON.stringify(blocked.body));
    assert.equal(blocked.body.error.code, "SIGNATURE_MISSING");
    await uploadSyntheticSignature(officialOffice);
    const issued = await api("POST", `/applications/${id}/issue`, {}, officialOffice.approver);
    assert.equal(issued.status, 201, JSON.stringify(issued.body));
    assert.ok(issued.body.number, "a certificate was issued");
    assert.ok(!issued.body.number.startsWith("DEMO-"), "official number has no DEMO- marker");
    const second = await submittedApplication(officialOffice, 45, getDemoPayload(45));
    const approved = await api(
      "POST",
      `/applications/${second}/transition`,
      { action: "approve" },
      officialOffice.approver,
    );
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.state, "ISSUED");
    assert.ok(!approved.body.certificate.number.startsWith("DEMO-"));
  } finally {
    delete process.env.ISSUANCE_MODE;
  }
});
