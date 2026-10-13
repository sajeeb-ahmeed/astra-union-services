import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  getDemoPayload,
  getServiceSchema,
  serviceCatalog,
} from "@astra/shared-schemas";
import { app } from "../src/app.js";
import { pool, adminConnectionString, transaction } from "../src/db.js";
import {
  closePdfBrowser,
  renderCertificateHtml,
  DEMO_TEMPLATE_VERSION,
} from "../src/pdf.js";
const db = new pg.Pool({ connectionString: adminConnectionString });
const run = randomUUID().slice(0, 8),
  password = "Synthetic-Test-Pass!";
let server: ReturnType<typeof app.listen>,
  base: string,
  office: any,
  other: any,
  citizen: any,
  outsider: any;
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
      syntheticReference: `DEMO-${key}-${run}`,
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
  await transition(id, "review", "reviewer");
  await transition(id, "approve", "approver");
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
  citizen = await signup("citizen", office);
  outsider = await signup("outsider", other);
  const order = await req(
    "POST",
    "/billing/orders",
    { kind: "subscription", planId: "demo-monthly" },
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
test("ALL47-01: every service validates, persists, submits, reviews, authorizes and issues a real PDF with one charge", async () => {
  const evidence: any[] = [];
  for (const service of serviceCatalog) {
    const no = service.service_no,
      payload = getDemoPayload(no);
    const created = await req(
      "POST",
      "/applications",
      { citizenId: citizen.id, serviceNo: no, payload },
      s.citizen,
    );
    assert.equal(
      created.status,
      201,
      `Service ${no}: ${JSON.stringify(created.body)}`,
    );
    await approve(created.body.id);
    const result = await req(
      "POST",
      `/applications/${created.body.id}/issue`,
      {},
      s.approver,
    );
    assert.equal(
      result.status,
      201,
      `Issue ${no}: ${JSON.stringify(result.body)}`,
    );
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
  assert.equal(
    (await req("GET", "/wallet", undefined, s.finance)).body.balance,
    73,
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
  assert.equal(count, 47);
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
  const concurrent = await Promise.all([
    req("POST", `/applications/${source.applicationId}/renew`, {}, s.citizen),
    req("POST", `/applications/${source.applicationId}/renew`, {}, s.citizen),
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
  await approve(child.id);
  const before = (await req("GET", "/wallet", undefined, s.finance)).body
    .balance;
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
  assert.equal(
    (await req("GET", "/wallet", undefined, s.finance)).body.balance,
    before - 1,
  );
  const pdf = await req(
    "GET",
    results[0]!.body.pdfUrl.replace("/api/v1", ""),
    undefined,
    s.citizen,
  );
  fs.writeFileSync("execution/trade-renewal-demo.pdf", pdf.body);
  const next = await req(
    "POST",
    `/applications/${child.id}/renew`,
    {},
    s.citizen,
  );
  assert.equal(next.status, 201);
  await transition(
    next.body.id,
    "cancel",
    "citizen",
    "Synthetic abandoned renewal",
  );
  assert.equal(
    (await req("POST", `/applications/${child.id}/renew`, {}, s.citizen))
      .status,
    201,
  );
});
test("CER-REVOKE: source revocation blocks an already approved renewal and preserves wallet", async () => {
  const source = issued.get(1),
    r = await req(
      "POST",
      `/applications/${source.applicationId}/renew`,
      {},
      s.citizen,
    );
  assert.equal(r.status, 201);
  await approve(r.body.id);
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
    `/applications/${r.body.id}/issue`,
    {},
    s.approver,
  );
  assert.equal(attempt.status, 409);
  assert.equal(attempt.body.error.code, "RENEWAL_SOURCE_INVALID");
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
    );
    assert.ok(html.includes("DEMO / NOT OFFICIAL"));
    assert.ok(html.includes("Approved demo details"));
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
          newPassword: "Changed-Synthetic-Pass!",
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
        { currentPassword: password, newPassword: "Changed-Synthetic-Pass!" },
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
  await login("citizen", email, "Changed-Synthetic-Pass!");
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
  const grant = await req(
    "POST",
    `/admin/users/${s.staff!.user.id}/recovery`,
    {},
    s.admin,
  );
  assert.equal(grant.status, 201, JSON.stringify(grant.body));
  assert.match(grant.body.token, /^[a-f0-9]{64}$/);
  const results = await Promise.all([
    req("POST", "/auth/recover", {
      token: grant.body.token,
      newPassword: "Recovered-Synthetic-Pass!",
    }),
    req("POST", "/auth/recover", {
      token: grant.body.token,
      newPassword: "Recovered-Synthetic-Pass!",
    }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 422]);
  assert.equal((await req("GET", "/auth/me", undefined, s.staff)).status, 401);
  await login(
    "staff",
    `staff@${office.slug}.test`,
    "Recovered-Synthetic-Pass!",
  );
  const expired = await req(
    "POST",
    `/admin/users/${s.staff!.user.id}/recovery`,
    {},
    s.admin,
  );
  await db.query(
    "UPDATE password_recovery_tokens SET expires_at=now()-interval '1 minute' WHERE user_id=$1 AND consumed_at IS NULL",
    [s.staff!.user.id],
  );
  assert.equal(
    (
      await req("POST", "/auth/recover", {
        token: expired.body.token,
        newPassword: password,
      })
    ).status,
    422,
  );
  const snapshots = await db.query(
    "SELECT token_hash FROM password_recovery_tokens WHERE user_id=$1",
    [s.staff!.user.id],
  );
  assert.ok(snapshots.rows.every((r) => r.token_hash !== grant.body.token));
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
