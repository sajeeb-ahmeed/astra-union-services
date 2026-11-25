import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  allServiceSchemaVersions,
  getDemoPayload,
  getServiceSchema,
  serviceCatalog,
} from "@astra/shared-schemas";
import { createHash } from "node:crypto";
import { app } from "../src/app.js";
import { pool, adminConnectionString, transaction } from "../src/db.js";
import {
  closePdfBrowser,
  renderCertificateHtml,
  DEMO_TEMPLATE_VERSION,
} from "../src/pdf.js";
import {
  DEMO_BANNER_BN,
  DEMO_BANNER_EN,
  DEMO_NOTICE_EN,
} from "../src/demo-notice.js";
import { payloadGeographyNames } from "../src/geography.js";
import { digest } from "../src/security.js";
import {
  logMailProvider,
  setMailProvider,
  type MailMessage,
} from "../src/mailer.js";
// B2: these tests exercise the sandbox settlement route, which is off unless explicitly enabled.
process.env.DEMO_SETTLE_ENABLED = "true";
const db = new pg.Pool({ connectionString: adminConnectionString });
const run = randomUUID().slice(0, 8),
  password = "Synth-Test-Pass1!";
let server: ReturnType<typeof app.listen>,
  base: string,
  office: any,
  other: any,
  citizen: any,
  outsider: any;
const policyVersions: Record<number, number> = {};
// W-002: the AMOUNTS gate needs an order snapshot for the money services
// (1, 41, 42) in every mode; the current forms carry no fee fields, so the
// only route is an explicitly synthetic zero-fee order policy + order.
function moneyOrder(no: number) {
  return {
    policyVersion: policyVersions[no],
    preferences: {
      addressBasis: "registered_profile",
      certificateLanguage: "en",
      deliveryMode: "office_collection",
      urgency: "normal",
    },
  };
}
type Session = { cookie: string; csrf: string; user: any };
const s: Record<string, Session> = {};
const issued = new Map<number, any>();
async function req(method: string, url: string, data?: any, session?: Session) {
  const r = await fetch(`${base}/api/v1${url}`, {
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
    status: r.status,
    headers: r.headers,
    body: r.headers.get("content-type")?.includes("application/json")
      ? await r.json()
      : Buffer.from(await r.arrayBuffer()),
  };
}
async function login(key: string, email: string, p = password) {
  const r = await req("POST", "/auth/login", { email, password: p });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  s[key] = {
    cookie: r.headers.get("set-cookie")!.split(";")[0]!,
    csrf: r.body.csrfToken,
    user: r.body.user,
  };
}
async function createOffice(slug: string) {
  const r = await req(
    "POST",
    "/owner/tenants",
    {
      slug,
      nameBn: "পরীক্ষা অফিস",
      nameEn: `Test office ${slug}`,
      division: "Test Division",
      district: "Test District",
      upazila: "Test Upazila",
      officeType: "UNION",
      adminEmail: `admin@${slug}.test`,
      adminName: "Test Admin",
      adminPassword: password,
    },
    s.owner,
  );
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
async function signup(key: string, tenant: any) {
  const email = `${key}-${run}@synthetic.test`,
    r = await req("POST", "/auth/signup", {
      email,
      password,
      displayName: `Demo ${key}`,
      tenantId: tenant.id,
      nameBn: "পরীক্ষা নাগরিক",
      nameEn: "Test Citizen",
      dateOfBirth: "1998-02-03",
      addressBn: "পরীক্ষা ঠিকানা",
      addressEn: "Test address only",
      syntheticReference: `REF-${key}-${run}`,
    });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await login(key, email);
  return (await req("GET", "/citizens", undefined, s[key])).body.items[0];
}
async function transition(
  id: string,
  action: string,
  key: string,
  reason?: string,
) {
  const r = await req(
    "POST",
    `/applications/${id}/transition`,
    { action, ...(reason ? { reason } : {}) },
    s[key],
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}
async function approve(id: string) {
  await transition(id, "submit", "citizen");
  // Phase W: no secretary review — the Chairman's approve issues at once.
  return transition(id, "approve", "approver");
}
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  await login("owner", "owner@astra.demo.test", "Demo-Phase1!");
  office = await createOffice(`qa-${run}`);
  other = await createOffice(`qb-${run}`);
  await login("admin", `admin@${office.slug}.test`);
  await login("otheradmin", `admin@${other.slug}.test`);
  for (const role of ["reviewer", "approver", "staff", "finance"]) {
    const r = await req(
      "POST",
      "/admin/users",
      {
        email: `${role}@${office.slug}.test`,
        displayName: `Test ${role}`,
        password,
        role,
      },
      s.admin,
    );
    assert.equal(r.status, 201, JSON.stringify(r.body));
    await login(role, r.body.email);
  }
  for (const service of serviceCatalog) {
    const r = await req(
      "PUT",
      `/admin/authorizations/${s.approver!.user.id}/${service.service_no}`,
      {
        active: true,
        authorityNote: "Synthetic demonstration approval for automated QA only",
      },
      s.admin,
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  // W-002: issuance gates run in every mode — this synthetic office needs
  // an explicitly identified synthetic signature fixture before anything
  // can issue. A 1x1 PNG — clearly not a real chairman signature.
  const signature = await req(
    "PUT",
    "/office/certificate-assets/signature",
    {
      mimeType: "image/png",
      base64:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      reason:
        "Synthetic signature fixture for demo-mode issuance regression (W-002); not a real chairman signature",
    },
    s.approver,
  );
  assert.ok([200, 201].includes(signature.status), JSON.stringify(signature.body));
  citizen = await signup("citizen", office);
  outsider = await signup("outsider", other);
  const order = await req(
    "POST",
    "/billing/orders",
    { kind: "subscription", planId: "standard-monthly" },
    s.finance,
  );
  assert.equal(order.status, 201, JSON.stringify(order.body));
  const settle = await req(
    "POST",
    `/billing/orders/${order.body.id}/demo-settle`,
    {},
    s.finance,
  );
  assert.equal(settle.status, 200, JSON.stringify(settle.body));
  const adjust = await req(
    "POST",
    `/owner/tenants/${office.id}/adjust`,
    {
      delta: 100,
      reason: "Automated synthetic all-service regression allowance",
    },
    s.owner,
  );
  assert.equal(adjust.status, 201);
  // W-002: the AMOUNTS gate needs an order snapshot for the money services
  // (1, 41, 42). Publish explicitly synthetic zero-fee policies for them;
  // the current forms carry no fee fields, so an order is the only route.
  for (const serviceNo of [1, 41, 42]) {
    const published = await req(
      "POST",
      `/admin/services/${serviceNo}/order-policies`,
      {
        expectedVersion: 0,
        reason: "Synthetic zero-fee policy for demo-mode issuance regression (W-002); not a government tariff",
        statutoryFeeMinor: 0,
        processingFeeMinor: 0,
        emergencySurchargeMinor: 0,
        deliveryFeesMinor: { office_collection: 0, digital_copy: 0 },
        deliveryModes: ["office_collection", "digital_copy"],
        urgencies: ["normal"],
      },
      s.admin,
    );
    assert.equal(published.status, 201, JSON.stringify(published.body));
    policyVersions[serviceNo] = published.body.policy.version;
  }
});
after(async () => {
  await closePdfBrowser();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await db.end();
});
test("PORTAL-01: filtered paginated public offices, tenant notices and private draft visibility", async () => {
  const directory = await req(
    "GET",
    `/offices?q=${office.slug}&division=Test%20Division&page=1&pageSize=1`,
  );
  assert.equal(directory.status, 200);
  assert.equal(directory.body.total, 1);
  assert.equal(directory.body.items[0].id, office.id);
  assert.equal(
    (await req("GET", `/offices?q=${office.slug}&page=2&pageSize=1`)).body.items
      .length,
    0,
  );
  const draft = await req(
    "POST",
    "/admin/notices",
    {
      titleBn: "পরীক্ষা বিজ্ঞপ্তি",
      titleEn: "Private draft",
      bodyBn: "পরীক্ষার তথ্য",
      bodyEn: "Synthetic draft body",
      published: false,
    },
    s.admin,
  );
  assert.equal(draft.status, 201);
  assert.equal(
    (await req("GET", `/notices?office=${office.slug}`)).body.total,
    0,
  );
  const foreign = await req(
    "PATCH",
    `/admin/notices/${draft.body.id}`,
    { published: true },
    s.otheradmin,
  );
  assert.equal(foreign.status, 404);
  assert.equal(
    (
      await req(
        "PATCH",
        `/admin/notices/${draft.body.id}`,
        { published: true, titleEn: "Published test notice" },
        s.admin,
      )
    ).status,
    200,
  );
  const detail = await req("GET", `/offices/${office.slug}`);
  assert.equal(detail.body.services.length, 47);
  assert.equal(detail.body.notices.length, 1);
  assert.equal(detail.body.notices[0].titleEn, "Published test notice");
  assert.equal(
    (await req("GET", `/notices?office=${office.slug}&q=Published`)).body.total,
    1,
  );
  assert.equal(
    (await req("GET", `/notices?office=${office.slug}&q=no-matching-text`)).body
      .total,
    0,
  );
  assert.equal(
    (await req("GET", `/notices?office=${other.slug}`)).body.total,
    0,
  );
});
test("MGMT-01: memberships, approval grants, service settings and office isolation enforce roles", async () => {
  assert.equal(
    (await req("GET", "/admin/office", undefined, s.admin)).body.id,
    office.id,
  );
  assert.equal(
    (
      await req(
        "PATCH",
        "/admin/office",
        { nameEn: "Updated synthetic office" },
        s.admin,
      )
    ).status,
    200,
  );
  assert.equal(
    (await req("GET", `/offices/${office.slug}`)).body.office.nameEn,
    "Updated synthetic office",
  );
  assert.equal(
    (await req("GET", "/admin/users", undefined, s.staff)).status,
    403,
  );
  assert.equal(
    (await req("GET", "/admin/users", undefined, s.owner)).status,
    403,
  );
  assert.equal(
    (
      await req(
        "PATCH",
        `/admin/users/${s.staff!.user.id}`,
        { active: false },
        s.otheradmin,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await req(
        "PATCH",
        `/admin/users/${s.admin!.user.id}`,
        { active: false },
        s.admin,
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await req(
        "PUT",
        `/admin/authorizations/${s.staff!.user.id}/1`,
        { active: true, authorityNote: "Synthetic invalid grant test" },
        s.admin,
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await req(
        "PATCH",
        "/admin/services/1",
        { enabled: false, creditCost: 2 },
        s.admin,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await req(
        "POST",
        "/applications",
        { citizenId: citizen.id, serviceNo: 1, payload: getDemoPayload(1) },
        s.citizen,
      )
    ).body.error.code,
    "SERVICE_DISABLED",
  );
  assert.equal(
    (
      await req(
        "PATCH",
        "/admin/services/1",
        { enabled: true, creditCost: 1 },
        s.admin,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await req(
        "PATCH",
        `/admin/users/${s.staff!.user.id}`,
        { active: false },
        s.admin,
      )
    ).status,
    200,
  );
  assert.equal((await req("GET", "/auth/me", undefined, s.staff)).status, 401);
  assert.equal(
    (
      await req(
        "PATCH",
        `/admin/users/${s.staff!.user.id}`,
        { active: true },
        s.admin,
      )
    ).status,
    200,
  );
  const before = (await req("GET", "/wallet", undefined, s.finance)).body
    .balance;
  assert.equal(before, 120);
});
test("ALL47-01: every service validates, persists, submits and is issued by the Chairman's single approve action with the fee settled once at submit", async () => {
  const evidence: any[] = [];
  const allowancesBefore = await transaction(
    office.id,
    async (c) =>
      (
        await c.query(
          "SELECT count(*)::int n FROM subscription_allowance_consumptions",
        )
      ).rows[0].n,
  );
  for (const service of serviceCatalog) {
    const no = service.service_no;
    let payload: Record<string, unknown> = getDemoPayload(no);
    let order: Record<string, unknown> | undefined;
    // W-002: the AMOUNTS gate runs in demo mode too. The money services
    // (1, 41, 42) need an order snapshot — the current forms carry no fee
    // fields, so an order is the only route. The order's language must
    // match the payload's, so the payload is pinned to English here.
    if ([1, 41, 42].includes(no)) {
      payload = { ...payload, delivery_language: "en" };
      order = moneyOrder(no);
    } else if (no === 10) {
      // W-002: the LANGUAGE gate needs both sides of the pair; the demo
      // payload carries only the Bangla occupation, so mirror it in English.
      payload = { ...payload, last_occupation_en: "Sample information" };
    }
    const created = await req(
      "POST",
      "/applications",
      { citizenId: citizen.id, serviceNo: no, payload, ...(order ? { order } : {}) },
      s.citizen,
    );
    assert.equal(
      created.status,
      201,
      `Service ${no}: ${JSON.stringify(created.body)}`,
    );
    // Phase W: approval IS issuance — the certificate arrives with the
    // approve response, and a follow-up issue call is an idempotent no-op.
    const approvedBody = await approve(created.body.id);
    assert.equal(approvedBody.state, "ISSUED", `Approve ${no}`);
    const result = { body: approvedBody.certificate };
    assert.ok(result.body?.id, `Certificate ${no}`);
    const again = await req(
      "POST",
      `/applications/${created.body.id}/issue`,
      {},
      s.approver,
    );
    assert.equal(again.status, 200, `Reissue ${no}: ${JSON.stringify(again.body)}`);
    assert.equal(again.body.id, result.body.id);
    const pdf = await req(
      "GET",
      result.body.pdfUrl.replace("/api/v1", ""),
      undefined,
      s.citizen,
    );
    assert.equal(pdf.status, 200);
    assert.equal(pdf.body.subarray(0, 5).toString(), "%PDF-");
    assert.ok(pdf.body.length > 10000);
    assert.equal(result.body.templateVersion, DEMO_TEMPLATE_VERSION);
    issued.set(no, { ...result.body, applicationId: created.body.id });
    const verify = await req(
      "GET",
      `/verify/${result.body.verificationUrl.split("/").at(-1)}`,
    );
    assert.equal(verify.body.status, "ISSUED");
    assert.equal(verify.body.serviceNo, no);
    assert.equal(verify.body.nameEn, undefined);
    evidence.push({
      serviceNo: no,
      applicationId: created.body.id,
      certificateId: result.body.id,
      pdfBytes: pdf.body.length,
      status: "PASS",
    });
    if ([1, 2, 42].includes(no))
      fs.writeFileSync(`execution/service-${no}-expanded-demo.pdf`, pdf.body);
  }
  // Phase 3B: this office's subscription is active, so each of the 47
  // submits consumed one monthly allowance and the wallet never moved;
  // issuance itself charges nothing and writes no ledger entries.
  assert.equal(
    (await req("GET", "/wallet", undefined, s.finance)).body.balance,
    120,
  );
  const count = await transaction(
    office.id,
    async (c) =>
      (
        await c.query(
          "SELECT count(*)::int n FROM credit_ledger WHERE kind='ISSUANCE'",
        )
      ).rows[0].n,
  );
  assert.equal(count, 0);
  const feeCount = await transaction(
    office.id,
    async (c) =>
      (
        await c.query(
          "SELECT count(*)::int n FROM credit_ledger WHERE kind='APPLICATION_FEE'",
        )
      ).rows[0].n,
  );
  assert.equal(feeCount, 0);
  const allowances = await transaction(
    office.id,
    async (c) =>
      (
        await c.query(
          "SELECT count(*)::int n FROM subscription_allowance_consumptions",
        )
      ).rows[0].n,
  );
  assert.equal(allowances, allowancesBefore + 47);
  const page = await req(
    "GET",
    `/applications?q=${issued.get(2).applicationId}&page=1&pageSize=1`,
    undefined,
    s.citizen,
  );
  assert.equal(page.body.total, 1);
  assert.equal(page.body.items[0].id, issued.get(2).applicationId);
  assert.equal(
    (
      await req(
        "GET",
        `/applications?q=${issued.get(2).applicationId}&page=2&pageSize=1`,
        undefined,
        s.citizen,
      )
    ).body.items.length,
    0,
  );
  fs.writeFileSync(
    "execution/all-services-qa.json",
    JSON.stringify(
      {
        mode: "SYNTHETIC_DEMO",
        services: evidence,
        servicesPassed: evidence.length,
      },
      null,
      2,
    ),
  );
});
test("GEO-FORM: v3 location selectors reject cross-parent codes server-side and documents print dataset names", async () => {
  for (const no of [36, 41, 42]) {
    // CERT-REFINE-01 published v4 of these services on top of the
    // geography v3, and QAFIX-01 published v5; QAFIX-07 published v6
    // for service 36 (the NOC subject gating) and QAFIX-08 v6 for
    // services 41 and 42. The selector behaviour asserted below is
    // unchanged.
    assert.equal(getServiceSchema(no).version, 6);
    // Trade v3 leaves the address type optional; a union applies only to a union address.
    const payload =
      no === 42
        ? { ...getDemoPayload(no), trade_license_org_add_type: "union" }
        : getDemoPayload(no);
    // Shape-valid codes from two different districts: only the database can catch this.
    const crossParent = {
      ...payload,
      org_location: {
        divisionCode: "div-02",
        districtCode: "dis-19",
        upazilaCode: "upa-001",
        unionCode: "uni-0001",
      },
    };
    const rejected = await req(
      "POST",
      "/applications",
      { citizenId: citizen.id, serviceNo: no, payload: crossParent },
      s.citizen,
    );
    assert.equal(rejected.status, 422, JSON.stringify(rejected.body));
    assert.ok(
      rejected.body.error.issues.some(
        (issue: any) =>
          issue.path === "org_location" && issue.code === "geography_mismatch",
      ),
      JSON.stringify(rejected.body),
    );
    const unknownUnion = {
      ...payload,
      org_location: {
        divisionCode: "div-02",
        districtCode: "dis-19",
        upazilaCode: "upa-089",
        unionCode: "uni-9999",
      },
    };
    const unknown = await req(
      "POST",
      "/applications",
      { citizenId: citizen.id, serviceNo: no, payload: unknownUnion },
      s.citizen,
    );
    assert.equal(unknown.status, 422);
    assert.equal(unknown.body.error.issues[0].code, "geography_mismatch");
    // The genuine hierarchy is accepted for the same service.
    // W-002: a policy is published for 41/42, so the valid create needs
    // the order (the invalid creates above fail payload validation first,
    // before the order check, and are unaffected).
    const validPayload: Record<string, unknown> = {
      ...payload,
      org_location: { ...unknownUnion.org_location, unionCode: "uni-0001" },
    };
    if ([41, 42].includes(no)) validPayload.delivery_language = "en";
    const valid = await req(
      "POST",
      "/applications",
      {
        citizenId: citizen.id,
        serviceNo: no,
        payload: validPayload,
        ...([41, 42].includes(no) ? { order: moneyOrder(no) } : {}),
      },
      s.citizen,
    );
    assert.equal(valid.status, 201, JSON.stringify(valid.body));
  }
  const schema = getServiceSchema(36),
    payload = getDemoPayload(36);
  const names = await transaction(office.id, (c) =>
    payloadGeographyNames(c, schema, payload),
  );
  assert.deepEqual(Object.keys(names), ["org_location"]);
  assert.match(names.org_location!.en, /Subil Union, Debidwar, Cumilla/);
  assert.match(names.org_location!.bn, /সুবিল ইউনিয়ন/);
  const html = renderCertificateHtml(
    {
      number: "DEMO-GEO",
      verificationUrl: "https://astra.example.test/verify/x",
      tenant: { name_bn: "অফিস", name_en: "Office" },
      service: { service_no: 36, name_bn: "অনাপত্তি", name_en: "NOC" },
      citizen: {
        full_name_bn: "নাগরিক",
        full_name_en: "Citizen",
        address_bn: "ঠিকানা",
        address_en: "Address",
      },
      payload: { ...payload, delivery_language: "en" },
      schema,
      geographyNames: names,
    } as any,
    "data:image/png;base64,",
      6,
  );
  assert.match(html, /Subil Union, Debidwar, Cumilla/);
  assert.doesNotMatch(html, /uni-0001|\[object Object\]/);
});
test("ADDR-06: present address is stored separately, may lie outside the office area and drives the certificate label", async () => {
  // Outside the office: Dhamrai, Dhaka — only the hierarchy is checked, not jurisdiction.
  const elsewhere = {
    divisionCode: "div-01",
    districtCode: "dis-01",
    upazilaCode: "upa-001",
  };
  const present = {
    sameAsPermanent: false,
    addressBn: "ভাড়া বাসা, ধামরাই",
    addressEn: "Rented house, Dhamrai",
    geography: elsewhere,
  };
  const email = `present-${run}@synthetic.test`;
  const body = {
    email,
    password,
    displayName: "Present Address Citizen",
    tenantId: office.id,
    nameBn: "বর্তমান নাগরিক",
    nameEn: "Present Citizen",
    dateOfBirth: "1990-05-06",
    addressBn: "স্থায়ী ঠিকানা গ্রাম",
    addressEn: "Permanent village address",
  };
  // Invalid inputs are rejected before any account is created.
  for (const bad of [
    { ...present, geography: { ...elsewhere, districtCode: "dis-19" } },
    { sameAsPermanent: false, addressBn: "ঠিকানা" },
    { sameAsPermanent: true, addressBn: "stale text" },
  ]) {
    const r = await req("POST", "/auth/signup", { ...body, presentAddress: bad });
    // Shape errors are 422 INPUT_INVALID; a broken hierarchy is 400 GEOGRAPHY_MISMATCH.
    assert.ok([400, 422].includes(r.status), JSON.stringify(r.body));
  }
  const signup = await req("POST", "/auth/signup", {
    ...body,
    presentAddress: present,
  });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  await login("present", email);
  const profile = await req("GET", "/profile", undefined, s.present);
  assert.deepEqual(profile.body.presentAddress, present);
  // Profile switches back to a single address, then to a new present address without geography.
  const same = await req(
    "PATCH",
    "/profile",
    {
      displayName: "Present Address Citizen",
      presentAddress: { sameAsPermanent: true },
    },
    s.present,
  );
  assert.equal(same.status, 200, JSON.stringify(same.body));
  assert.deepEqual(same.body.presentAddress, { sameAsPermanent: true });
  const moved = {
    sameAsPermanent: false,
    addressBn: "নতুন ভাড়া বাসা",
    addressEn: "New rented flat",
  };
  const updated = await req(
    "PATCH",
    "/profile",
    { displayName: "Present Address Citizen", presentAddress: moved },
    s.present,
  );
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.deepEqual(updated.body.presentAddress, { ...moved, geography: null });
  // Staff can only use the citizen address fields through the citizen record, not the profile.
  assert.equal(
    (
      await req(
        "PATCH",
        "/profile",
        { displayName: "Test staff", presentAddress: { sameAsPermanent: true } },
        s.staff,
      )
    ).status,
    403,
  );
  const staffEntry = await req(
    "POST",
    "/citizens",
    {
      nameBn: "সহায়তাপ্রাপ্ত নাগরিক",
      nameEn: "Assisted Citizen",
      dateOfBirth: "1985-01-02",
      addressBn: "স্থায়ী ঠিকানা",
      addressEn: "Permanent address",
      presentAddress: present,
    },
    s.staff,
  );
  assert.equal(staffEntry.status, 201, JSON.stringify(staffEntry.body));
  assert.deepEqual(staffEntry.body.presentAddress, present);
  // The database itself refuses half-filled present addresses.
  await assert.rejects(
    transaction(office.id, (c) =>
      c.query(
        "UPDATE citizens SET present_same_as_permanent=true,present_address_bn='stale' WHERE id=$1",
        [staffEntry.body.id],
      ),
    ),
    /citizens_present_address_complete/,
  );
  // Certificate states the address chosen in the form.
  const row = await transaction(office.id, async (c) =>
    (await c.query("SELECT * FROM citizens WHERE id=$1", [staffEntry.body.id]))
      .rows[0],
  );
  const html = (source: string) =>
    renderCertificateHtml(
      {
        number: "DEMO-ADDR",
        verificationUrl: "https://astra.example.test/verify/x",
        tenant: { name_bn: "অফিস", name_en: "Office" },
        service: { service_no: 3, name_bn: "সেবা", name_en: "Service" },
        citizen: row,
        payload: { address_source: source, delivery_language: "en" },
        schema: getServiceSchema(3),
      } as any,
      "data:image/png;base64,",
        6,
    );
  assert.match(html("present"), /Present address<\/dt><dd>Rented house, Dhamrai/);
  assert.match(html("permanent"), /Permanent address<\/dt><dd>Permanent address/);
  assert.doesNotMatch(html("permanent"), /Rented house/);
});
test("CER-RENEW: trade renewal preserves lineage, applicant and authority; concurrent creation/issue deduplicate", async () => {
  const source = issued.get(42);
  assert.equal(
    (
      await req(
        "POST",
        `/applications/${source.applicationId}/renew`,
        {},
        s.outsider,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await req(
        "POST",
        `/applications/${source.applicationId}/renew`,
        {},
        s.owner,
      )
    ).status,
    403,
  );
  // W-002: a policy is published for 42, so the renewal needs its order.
  const concurrent = await Promise.all([
    req("POST", `/applications/${source.applicationId}/renew`, { order: moneyOrder(42) }, s.citizen),
    req("POST", `/applications/${source.applicationId}/renew`, { order: moneyOrder(42) }, s.citizen),
  ]);
  assert.deepEqual(concurrent.map((r) => r.status).sort(), [201, 409]);
  const child = concurrent.find((r) => r.status === 201)!.body;
  const detail = await req(
    "GET",
    `/applications/${child.id}`,
    undefined,
    s.citizen,
  );
  assert.equal(detail.body.renewal.sourceCertificateId, source.id);
  assert.equal(detail.body.payload.previous_license_number, source.number);
  assert.equal(detail.body.payload.has_previous_license, true);
  assert.equal(
    (await req("POST", `/applications/${child.id}/issue`, {}, s.approver))
      .status,
    409,
  );
  // Phase W: the Chairman's approve issues the renewal; concurrent issue
  // calls afterwards all return that same certificate. Phase 3B: the
  // renewal's fee settled at its submit (subscription allowance), so the
  // wallet does not move across approve/issue at all.
  const before = (await req("GET", "/wallet", undefined, s.finance)).body
    .balance;
  const approvedChild = await approve(child.id);
  assert.equal(approvedChild.state, "ISSUED");
  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      req("POST", `/applications/${child.id}/issue`, {}, s.approver),
    ),
  );
  assert.ok(
    results.every((r) => r.status < 300),
    JSON.stringify(results),
  );
  assert.equal(new Set(results.map((r) => r.body.id)).size, 1);
  assert.equal(results[0]!.body.id, approvedChild.certificate.id);
  assert.equal(
    (await req("GET", "/wallet", undefined, s.finance)).body.balance,
    before,
  );
  const childDetail = await req(
    "GET",
    `/applications/${child.id}`,
    undefined,
    s.citizen,
  );
  assert.equal(childDetail.body.application.feeMethod, "ALLOWANCE");
  assert.equal(childDetail.body.application.feeCredits, 0);
  const pdf = await req(
    "GET",
    results[0]!.body.pdfUrl.replace("/api/v1", ""),
    undefined,
    s.citizen,
  );
  fs.writeFileSync("execution/trade-renewal-demo.pdf", pdf.body);
  // W-002: a policy is published for 42, so the renewal needs its order.
  const next = await req(
    "POST",
    `/applications/${child.id}/renew`,
    { order: moneyOrder(42) },
    s.citizen,
  );
  assert.equal(next.status, 201);
  await transition(
    next.body.id,
    "cancel",
    "citizen",
    "Synthetic abandoned renewal",
  );
  // W-002: a policy is published for 42, so the renewal needs its order.
  assert.equal(
    (await req("POST", `/applications/${child.id}/renew`, { order: moneyOrder(42) }, s.citizen))
      .status,
    201,
  );
});
test("CER-REVOKE: source revocation blocks an already approved renewal and preserves wallet", async () => {
  const source = issued.get(1),
    // W-002: a policy is published for 1, so the renewal needs its order.
    r = await req(
      "POST",
      `/applications/${source.applicationId}/renew`,
      { order: moneyOrder(1) },
      s.citizen,
    );
  assert.equal(r.status, 201);
  // Phase W: submit the renewal, revoke the source, then the Chairman's
  // approve records his approval but cannot issue against a revoked source.
  await transition(r.body.id, "submit", "citizen");
  assert.equal(
    (
      await req(
        "POST",
        `/certificates/${source.id}/revoke`,
        { reason: "Synthetic source revocation" },
        s.approver,
      )
    ).status,
    200,
  );
  const before = (await req("GET", "/wallet", undefined, s.finance)).body
    .balance;
  const attempt = await req(
    "POST",
    `/applications/${r.body.id}/transition`,
    { action: "approve" },
    s.approver,
  );
  assert.equal(attempt.status, 409);
  assert.equal(attempt.body.error.code, "RENEWAL_SOURCE_INVALID");
  const detail = await req(
    "GET",
    `/applications/${r.body.id}`,
    undefined,
    s.citizen,
  );
  assert.equal(detail.body.application.state, "APPROVED");
  assert.equal(detail.body.certificate, null);
  const issueAttempt = await req(
    "POST",
    `/applications/${r.body.id}/issue`,
    {},
    s.approver,
  );
  assert.equal(issueAttempt.status, 409);
  assert.equal(issueAttempt.body.error.code, "RENEWAL_SOURCE_INVALID");
  assert.equal(
    (await req("GET", "/wallet", undefined, s.finance)).body.balance,
    before,
  );
});
test("PDF-ALL: service templates retain approved family rows, trade data and HTML escaping", async () => {
  const common = {
    number: "DEMO-TEST",
    verificationUrl: "https://example.test/verify/demo",
    tenant: { name_bn: "ডেমো অফিস", name_en: "Demo office" },
    citizen: {
      full_name_bn: "ডেমো",
      full_name_en: "Demo Person",
      address_bn: "ডেমো ঠিকানা",
      address_en: "Demo address",
    },
  };
  for (const no of [1, 2, 42]) {
    const service = serviceCatalog.find((s) => s.service_no === no)!;
    const payload = getDemoPayload(no);
    const html = renderCertificateHtml(
      {
        ...common,
        service: {
          service_no: no,
          name_bn: service.name_bn,
          name_en: service.name_en,
        },
        payload,
        schema: getServiceSchema(no),
        renewalNumber: no === 42 ? "DEMO-PREVIOUS" : undefined,
      },
      "data:image/png;base64,DEMO",
      6,
    );
    // W-001: a demo document marks itself demo, in both languages.
    assert.ok(html.includes(DEMO_BANNER_BN), "Bengali demo banner");
    assert.ok(html.includes(DEMO_BANNER_EN), "English demo banner");
    assert.ok(html.includes(DEMO_NOTICE_EN), "English not-official line");
    assert.ok(html.includes("Approved details"));
    if (no === 2) assert.ok(html.includes('class="member"'));
    if (no === 42) {
      assert.ok(html.includes("DEMO-PREVIOUS"));
      assert.ok(html.includes(String(payload.business_name_en)));
    }
  }
});
test("AUTH-NEW: signup validation, password verification and old-session invalidation", async () => {
  const email = `citizen-${run}@synthetic.test`;
  assert.equal(
    (await req("POST", "/auth/signup", { email, password: "short" })).status,
    422,
  );
  await login("second", email);
  assert.equal(
    (
      await req(
        "POST",
        "/auth/password",
        {
          currentPassword: "incorrect",
          newPassword: "Chg-Synthetic-Pa1!",
        },
        s.citizen,
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await req(
        "POST",
        "/auth/password",
        { currentPassword: password, newPassword: "Chg-Synthetic-Pa1!" },
        s.citizen,
      )
    ).status,
    200,
  );
  assert.equal((await req("GET", "/auth/me", undefined, s.second)).status, 401);
  assert.equal(
    (await req("GET", "/auth/me", undefined, s.citizen)).status,
    200,
  );
  assert.equal(
    (await req("POST", "/auth/login", { email, password })).status,
    401,
  );
  await login("citizen", email, "Chg-Synthetic-Pa1!");
});
test("AUTH-RECOVERY: tenant-admin manual recovery is one-use, expires, blocks privilege escalation and invalidates sessions", async () => {
  assert.equal(
    (
      await req(
        "POST",
        `/admin/users/${s.staff!.user.id}/recovery`,
        {},
        s.otheradmin,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await req(
        "POST",
        `/admin/users/${s.admin!.user.id}/recovery`,
        {},
        s.admin,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await req(
        "POST",
        `/admin/users/${s.owner!.user.id}/recovery`,
        {},
        s.admin,
      )
    ).status,
    404,
  );
  // S-007: the grant no longer returns the token — it is delivered
  // out-of-band to the account holder's email. Capture the mail to
  // exercise the tokens, then restore the log provider.
  const mailSent: MailMessage[] = [];
  setMailProvider({ async send(m) { mailSent.push(m); } });
  const grant = await req(
    "POST",
    `/admin/users/${s.staff!.user.id}/recovery`,
    {},
    s.admin,
  );
  assert.equal(grant.status, 201, JSON.stringify(grant.body));
  assert.equal(grant.body.token, undefined, "S-007: no plaintext token in the response");
  assert.equal(grant.body.recoveryUrl, undefined);
  assert.equal(grant.body.delivery, "EMAIL");
  const grantToken = mailSent[0].text.match(/#token=([a-f0-9]{64})/)?.[1] as string;
  assert.ok(grantToken, "the out-of-band email carries the fragment link");
  const results = await Promise.all([
    req("POST", "/auth/recover", {
      token: grantToken,
      newPassword: "Rec-Synthetic-Pa1!",
    }),
    req("POST", "/auth/recover", {
      token: grantToken,
      newPassword: "Rec-Synthetic-Pa1!",
    }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 422]);
  assert.equal((await req("GET", "/auth/me", undefined, s.staff)).status, 401);
  await login(
    "staff",
    `staff@${office.slug}.test`,
    "Rec-Synthetic-Pa1!",
  );
  const expired = await req(
    "POST",
    `/admin/users/${s.staff!.user.id}/recovery`,
    {},
    s.admin,
  );
  const expiredToken = mailSent[1].text.match(/#token=([a-f0-9]{64})/)?.[1] as string;
  assert.ok(expiredToken, "the second grant also arrives out-of-band");
  setMailProvider(logMailProvider);
  await db.query(
    "UPDATE password_recovery_tokens SET expires_at=now()-interval '1 minute' WHERE user_id=$1 AND consumed_at IS NULL",
    [s.staff!.user.id],
  );
  assert.equal(
    (
      await req("POST", "/auth/recover", {
        token: expiredToken,
        newPassword: password,
      })
    ).status,
    422,
  );
  const snapshots = await db.query(
    "SELECT token_hash FROM password_recovery_tokens WHERE user_id=$1",
    [s.staff!.user.id],
  );
  // S-007: tokens are stored hashed, never plaintext — the stored hash
  // is the digest of the emailed token, and never the token itself.
  assert.ok(snapshots.rows.some((r) => r.token_hash === digest(grantToken)));
  assert.ok(snapshots.rows.every((r) => r.token_hash !== grantToken));
  await db.query(
    "INSERT INTO staff_memberships(user_id,tenant_id,role) VALUES($1,$2,'staff')",
    [s.staff!.user.id, other.id],
  );
  assert.equal(
    (
      await req(
        "POST",
        `/admin/users/${s.staff!.user.id}/recovery`,
        {},
        s.admin,
      )
    ).status,
    404,
    "Office admins cannot reset a shared multi-office global credential",
  );
});
test("TEN-NEW: suspension removes public office and invalidates existing sessions without deleting data", async () => {
  assert.equal(
    (
      await req(
        "PATCH",
        `/owner/tenants/${other.id}`,
        { status: "SUSPENDED" },
        s.admin,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await req(
        "PATCH",
        `/owner/tenants/${other.id}`,
        { status: "SUSPENDED" },
        s.owner,
      )
    ).status,
    200,
  );
  assert.equal((await req("GET", `/offices/${other.slug}`)).status, 404);
  assert.equal(
    (await req("GET", "/citizens", undefined, s.outsider)).status,
    401,
  );
  assert.equal(
    (
      await req(
        "PATCH",
        `/owner/tenants/${other.id}`,
        { status: "ACTIVE" },
        s.owner,
      )
    ).status,
    200,
  );
  assert.equal(
    (await req("GET", "/citizens", undefined, s.outsider)).body.items[0].id,
    outsider.id,
  );
});
test("B4: the database rejects a separate present address without both texts", async () => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const id = (await client.query("SELECT id FROM citizens LIMIT 1")).rows[0]?.id;
    assert.ok(id, "an existing citizen is needed for this check");
    const attempt = async (bn: string | null, en: string | null) => {
      await client.query("SAVEPOINT b4");
      try {
        await client.query(
          "UPDATE citizens SET present_same_as_permanent=false,present_address_bn=$2,present_address_en=$3,present_division_code=NULL,present_district_code=NULL,present_upazila_code=NULL,present_union_code=NULL,present_ward_code=NULL WHERE id=$1",
          [id, bn, en],
        );
        await client.query("RELEASE SAVEPOINT b4");
        return "accepted";
      } catch (error: any) {
        await client.query("ROLLBACK TO SAVEPOINT b4");
        assert.equal(error.constraint, "citizens_present_address_complete");
        return "rejected";
      }
    };
    assert.equal(await attempt(null, "Rented flat"), "rejected");
    assert.equal(await attempt("ভাড়া বাসা", null), "rejected");
    assert.equal(await attempt(null, null), "rejected");
    assert.equal(await attempt("ভাড়া বাসা", "Rented flat"), "accepted");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

// B5: applications pinned to a schema version older than the latest must still renew.
const v2LocationText: Record<number, Record<string, string>> = {
  36: { noc_org_add_type: "union", noc_org_division: "Chattogram", district_id: "Cumilla", thana_id: "Debidwar", union_id: "Subil Union" },
  41: { primises_license_org_add_type: "union", division_id: "Chattogram", district_id: "Cumilla", thana_id: "Debidwar", union_id: "Subil Union" },
  42: { trade_license_org_add_type: "union", trade_license_org_division: "Chattogram", district_id: "Cumilla", thana_id: "Debidwar", union_id: "Subil Union" },
};
function stableJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
/** An issued application pinned to schema v2, as created before PAR-05 published v3. */
async function issuedV2ApplicationWith(no: number, overrides: Record<string, string>) {
  const source = (
    await db.query("SELECT tenant_id,citizen_id,created_by FROM applications WHERE id=$1", [issued.get(no).applicationId])
  ).rows[0];
  const v2 = allServiceSchemaVersions.find((x) => x.serviceNo === no && x.version === 2)!;
  assert.ok(v2 && getServiceSchema(no).version > 2);
  const { org_location: _dropped, purpose: _purpose, purpose_language: _purposeLanguage, ...rest } = getDemoPayload(no) as Record<string, unknown>;
  // QAFIX-08: service 42's v2 predates the whole purpose-and-language
  // section, so its v2-era payload also drops address_source and
  // delivery_language (the other two services carried the purpose
  // pair at v2 — see below).
  if (no === 42) {
    delete (rest as Record<string, unknown>).address_source;
    delete (rest as Record<string, unknown>).delivery_language;
  }
  // QAFIX-01: a v2-era payload carries the purpose pair, not the single
  // purpose field the current demo payload uses.
  const purposePair: Record<string, unknown> =
    no === 42
      ? {}
      : { purpose_bn: "নবায়নের উদ্দেশ্য", purpose_en: "Renewal purpose" };
  // W-002: the money services (41/42) need an order snapshot for the
  // AMOUNTS gate, so the v2 application is inserted in POLICY mode with
  // an explicitly synthetic zero-fee snapshot (the snapshot-required
  // trigger is deferred, so the app row and the snapshot land in one
  // transaction). The v2 forms carry no fee fields — a fee component in
  // the payload would be rejected as unknown at renewal validation — so
  // the order is the only route. Service 41's v2 payload pins its
  // language to English to match the snapshot; 42's v2 payload carries
  // no language field at all.
  const langPair: Record<string, unknown> = no === 41 ? { delivery_language: "en" } : {};
  const payload = { ...rest, ...purposePair, ...langPair, ...v2LocationText[no], ...overrides };
  // W-013: the submit gate now fully validates the stored payload against
  // its PINNED version. This fixture builds the "v2 application" from the
  // CURRENT demo payload, which carries fields v2 never had (service 36's
  // noc_subject arrived in v6) — submit rightly rejects those as
  // unknown_field. A real v2 application created through the API could never
  // contain them (create-time validation), so keep only v2's own fields;
  // the renewal path migrates the rest (location text, purpose pair) onto
  // the latest schema itself.
  const v2FieldIds = new Set(
    v2.sections.flatMap((section: any) => section.fields.map((field: any) => field.id)),
  );
  for (const key of Object.keys(payload))
    if (!v2FieldIds.has(key)) delete (payload as Record<string, unknown>)[key];
  const hash = (
    await db.query("SELECT schema_hash FROM service_versions WHERE service_no=$1 AND version=2", [no])
  ).rows[0].schema_hash;
  const id = await transaction(source.tenant_id, async (tx) => {
    const app = (
      await tx.query(
        "INSERT INTO applications(tenant_id,citizen_id,service_no,schema_version,schema_hash,created_by,order_mode) VALUES($1,$2,$3,2,$4,$5,$6) RETURNING id",
        [
          source.tenant_id,
          source.citizen_id,
          no,
          hash,
          source.created_by,
          [41, 42].includes(no) ? "POLICY" : "LEGACY",
        ],
      )
    ).rows[0];
    if ([41, 42].includes(no)) {
      await tx.query(
        "INSERT INTO application_order_snapshots(tenant_id,application_id,service_no,policy_version,address_basis,certificate_language,delivery_mode,urgency,statutory_fee_minor,processing_fee_minor,emergency_surcharge_minor,delivery_fee_minor,total_minor,currency,coupon_code,discount_minor) VALUES($1,$2,$3,$4,'registered_profile','en','office_collection','normal',0,0,0,0,0,'BDT',NULL,0)",
        [source.tenant_id, app.id, no, policyVersions[no]],
      );
    }
    await tx.query(
      "INSERT INTO application_payload_versions(tenant_id,application_id,version,payload,payload_hash,actor_id) VALUES($1,$2,1,$3,$4,$5)",
      [source.tenant_id, app.id, JSON.stringify(payload), createHash("sha256").update(stableJson(payload)).digest("hex"), source.created_by],
    );
    return app.id as string;
  });
  // Phase W: approve() already issued this application; the issue call is
  // the idempotent completion path and returns the same certificate (200).
  const approvedV2 = await approve(id);
  assert.equal(approvedV2.state, "ISSUED");
  const result = await req("POST", `/applications/${id}/issue`, {}, s.approver);
  assert.equal(result.status, 200, `Issue v2 ${no}: ${JSON.stringify(result.body)}`);
  assert.equal(result.body.id, approvedV2.certificate.id);
  return { id, payload };
}
async function issuedV2Application(no: number, overrides: Record<string, string> = {}) {
  return issuedV2ApplicationWith(no, overrides);
}
for (const no of [36, 41])
  test(`B5: a v2-pinned service ${no} application renews unchanged onto v3 when its location text matches`, async () => {
    const { id } = await issuedV2Application(no);
    // W-002: a policy is published for 41, so its renewal needs the order;
    // 36 has no policy, so an order would be rejected — keep it order-free.
    const renewal = await req(
      "POST",
      `/applications/${id}/renew`,
      { ...([41, 42].includes(no) ? { order: moneyOrder(no) } : {}) },
      s.citizen,
    );
    assert.equal(renewal.status, 201, `Renew v2 ${no}: ${JSON.stringify(renewal.body)}`);
    assert.equal(renewal.body.locationUpgrade, "RESOLVED");
    assert.equal(renewal.body.schemaVersion, getServiceSchema(no).version);
    const child = (await req("GET", `/applications/${renewal.body.id}`, undefined, s.citizen)).body;
    // Chattogram > Cumilla > Debidwar > Subil Union is the dataset's div-02 > dis-19 > upa-089 > uni-0001.
    assert.deepEqual(child.payload.org_location, {
      divisionCode: "div-02",
      districtCode: "dis-19",
      upazilaCode: "upa-089",
      unionCode: "uni-0001",
    });
    for (const legacy of ["district_id", "thana_id", "union_id"])
      assert.equal(child.payload[legacy], undefined);
    const approvedRenewal = await approve(renewal.body.id);
    const reissued = await req("POST", `/applications/${renewal.body.id}/issue`, {}, s.approver);
    assert.equal(reissued.status, 200, JSON.stringify(reissued.body));
    assert.equal(reissued.body.id, approvedRenewal.certificate.id);
  });
test("B5: a v2-pinned service 42 application renews on its pinned version — the current form's purpose cannot be invented", async () => {
  // QAFIX-08 gave service 42 the standard purpose-and-language
  // section (purpose + purpose_language are required). A v2-era
  // trade licence carries no purpose text anywhere — the
  // QAFIX-01 pair migration has nothing to carry — so the renewal
  // cannot validate against the current version and takes the
  // designed pinned fallback (as with unmatched location text):
  // it renews on v2 with the payload unchanged, and still issues.
  const { id, payload } = await issuedV2Application(42);
  // W-002: a policy is published for 42, so the renewal needs its order.
  const renewal = await req("POST", `/applications/${id}/renew`, { order: moneyOrder(42) }, s.citizen);
  assert.equal(renewal.status, 201, `Renew v2 42: ${JSON.stringify(renewal.body)}`);
  assert.equal(renewal.body.schemaVersion, 2);
  const child = (await req("GET", `/applications/${renewal.body.id}`, undefined, s.citizen)).body;
  assert.equal(child.payload.org_location, undefined);
  assert.equal(child.payload.union_id, payload.union_id);
  assert.equal(child.payload.district_id, payload.district_id);
  const approvedRenewal = await approve(renewal.body.id);
  const reissued = await req("POST", `/applications/${renewal.body.id}/issue`, {}, s.approver);
  assert.equal(reissued.status, 200, JSON.stringify(reissued.body));
  assert.equal(reissued.body.id, approvedRenewal.certificate.id);
});
test("B5: unmatched location text keeps the renewal on its pinned version with the payload unchanged", async () => {
  const { id, payload } = await issuedV2Application(41, { union_id: "Nonexistent Union" });
  // W-002: a policy is published for 41, so the renewal needs its order.
  const renewal = await req("POST", `/applications/${id}/renew`, { order: moneyOrder(41) }, s.citizen);
  assert.equal(renewal.status, 201, JSON.stringify(renewal.body));
  assert.equal(renewal.body.locationUpgrade, "UNRESOLVED");
  assert.equal(renewal.body.schemaVersion, 2);
  const child = (await req("GET", `/applications/${renewal.body.id}`, undefined, s.citizen)).body;
  assert.equal(child.payload.org_location, undefined);
  assert.equal(child.payload.union_id, "Nonexistent Union");
  assert.equal(child.payload.thana_id, payload.thana_id);
  const approvedUnresolved = await approve(renewal.body.id);
  const unresolvedIssue = await req("POST", `/applications/${renewal.body.id}/issue`, {}, s.approver);
  assert.equal(unresolvedIssue.status, 200);
  assert.equal(unresolvedIssue.body.id, approvedUnresolved.certificate.id);
});
test("Phase 1: the citizen list reports the office's real total, not the 100-row page length", async () => {
  const listed = await req("GET", "/citizens", undefined, s.staff);
  assert.equal(listed.status, 200);
  const expected = (
    await db.query("SELECT count(*)::int n FROM citizens WHERE tenant_id=$1", [office.id])
  ).rows[0].n;
  assert.equal(listed.body.total, expected);
  assert.ok(listed.body.items.length <= 100 && listed.body.items.length <= expected);
  const searched = await req("GET", "/citizens?q=zz-no-such-citizen-zz", undefined, s.staff);
  assert.equal(searched.body.total, 0);
});
test("Phase 2a: account types fix the membership role, suit the office type and stay consistent", async () => {
  const listed = await req("GET", "/admin/account-types", undefined, s.admin);
  assert.equal(listed.status, 200);
  assert.equal(listed.body.items.length, 16);
  const byCode = Object.fromEntries(listed.body.items.map((t: any) => [t.code, t]));
  assert.equal(byCode.up_secretary.available, true);
  assert.equal(byCode.up_secretary.role, "reviewer");
  assert.equal(byCode.municipality_mayor.available, false);
  assert.equal(byCode.digital_centre_entrepreneur.status, "confirmed");
  assert.equal((await req("GET", "/admin/account-types", undefined, s.staff)).status, 403);

  const stamp = Date.now();
  const make = (body: Record<string, unknown>) =>
    req("POST", "/admin/users", { email: `post-${stamp}-${Math.random().toString(36).slice(2, 8)}@${office.slug}.test`, displayName: "Post Holder", password, ...body }, s.admin);
  const secretary = await make({ accountType: "up_secretary" });
  assert.equal(secretary.status, 201, JSON.stringify(secretary.body));
  assert.equal(secretary.body.role, "reviewer");
  assert.equal(secretary.body.accountType, "up_secretary");
  assert.equal((await make({ accountType: "municipality_mayor" })).body.error.code, "ACCOUNT_TYPE_OFFICE_MISMATCH");
  assert.equal((await make({ accountType: "no_such_post" })).body.error.code, "ACCOUNT_TYPE_UNKNOWN");
  assert.ok([400, 422].includes((await make({ accountType: "up_secretary", role: "staff" })).status));
  assert.ok([400, 422].includes((await make({})).status));
  const legacy = await make({ role: "staff" });
  assert.equal(legacy.status, 201);
  assert.equal(legacy.body.accountType, null);

  const users = (await req("GET", "/admin/users", undefined, s.admin)).body.items;
  const listedSecretary = users.find((u: any) => u.id === secretary.body.id);
  assert.equal(listedSecretary.accountType, "up_secretary");
  assert.equal(listedSecretary.accountTypeEn, "UP Secretary");

  // Choosing a post sets its role; changing the role directly drops the post.
  const promoted = await req("PATCH", `/admin/users/${secretary.body.id}`, { accountType: "up_chairman" }, s.admin);
  assert.equal(promoted.status, 200, JSON.stringify(promoted.body));
  assert.equal(promoted.body.role, "approver");
  assert.equal(promoted.body.accountType, "up_chairman");
  const demoted = await req("PATCH", `/admin/users/${secretary.body.id}`, { role: "staff" }, s.admin);
  assert.equal(demoted.body.role, "staff");
  assert.equal(demoted.body.accountType, null);
  await req("PATCH", `/admin/users/${secretary.body.id}`, { accountType: "up_chairman" }, s.admin);

  // The database refuses an inconsistent post, whoever writes it.
  await assert.rejects(
    db.query("UPDATE staff_memberships SET role='staff' WHERE user_id=$1 AND tenant_id=$2", [secretary.body.id, office.id]),
    /requires role approver/,
  );
  await assert.rejects(
    db.query("UPDATE staff_memberships SET account_type='municipality_mayor', role='approver' WHERE user_id=$1 AND tenant_id=$2", [secretary.body.id, office.id]),
    /not available for a UNION office/,
  );

  // A union office with union-only posts cannot silently become a municipality.
  const retype = await req("PATCH", "/admin/office", { officeType: "MUNICIPALITY" }, s.admin);
  assert.equal(retype.status, 409, JSON.stringify(retype.body));
  assert.equal(retype.body.error.code, "ACCOUNT_TYPES_CONFLICT");
});
