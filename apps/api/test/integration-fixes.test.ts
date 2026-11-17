import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { getDemoPayload } from "@astra/shared-schemas";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";

// Integration phase: regression coverage for two queued fixes that the phase
// suites could not prove on their own branches.
//  - Fix 3 (Phase Y limitation 3): an order's certificateLanguage never reached
//    the document for services whose form schema has no delivery_language field
//    (e.g. #42 trade licence), so an EN order silently rendered a BN licence.
//    prepareIssuance now falls back to the order snapshot's certificate_language.
//  - Fix 2: migration 001's CHECK(demo) forced every tenant to demo=true, so the
//    public verify payload could never truthfully report a production office.
//    Migration 041 drops the CHECK; demo provisioning stays explicit.
// The PDF text assertions use the system pdftotext (poppler) — the same tool
// the repo's live-verification drivers use to prove certificate content.
// These tests exercise the sandbox settlement route, off unless enabled.
process.env.DEMO_SETTLE_ENABLED = "true";

const execFileAsync = promisify(execFile);
const admin = new pg.Pool({ connectionString: adminConnectionString });
const run = randomUUID().slice(0, 8);
// Test-only credentials are generated per run so no password-like literal sits in the repository.
const password = randomBytes(18).toString("base64url");
type Session = { cookie: string; csrf: string; user: any };
const sessions: Record<string, Session> = {};
let server: ReturnType<typeof app.listen>, base: string;
let office: any, citizen: any, certificateNumber: string;

async function request(method: string, path: string, data?: unknown, role = "citizen") {
  const session = sessions[role];
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
async function login(role: string, email: string, secret = password) {
  const response = await request("POST", "/auth/login", { email, password: secret }, "anonymous");
  assert.equal(response.status, 200, JSON.stringify(response.body));
  sessions[role] = {
    cookie: response.headers.get("set-cookie")!.split(";")[0]!,
    csrf: response.body.csrfToken,
    user: response.body.user,
  };
}

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  await login("owner", "owner@astra.demo.test", "Demo-Phase1!");
  const slug = `integration-${run}`;
  const created = await request(
    "POST",
    "/owner/tenants",
    {
      slug,
      nameBn: "পরীক্ষা অফিস",
      nameEn: "Synthetic integration office",
      division: "Test Division",
      district: "Test District",
      upazila: "Test Upazila",
      officeType: "UNION",
      adminEmail: `admin@${slug}.test`,
      adminName: "Synthetic integration admin",
      adminPassword: password,
    },
    "owner",
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  office = created.body;
  await login("admin", `admin@${slug}.test`);
  for (const role of ["approver", "finance"]) {
    const response = await request(
      "POST",
      "/admin/users",
      {
        email: `${role}@${slug}.test`,
        displayName: `Synthetic integration ${role}`,
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
    `/admin/authorizations/${sessions.approver!.user.id}/42`,
    { active: true, authorityNote: "Synthetic integration regression only" },
    "admin",
  );
  assert.equal(authorization.status, 200, JSON.stringify(authorization.body));
  const email = `citizen-${run}@integration.synthetic.test`;
  const signup = await request(
    "POST",
    "/auth/signup",
    {
      email,
      password,
      displayName: "Synthetic integration citizen",
      tenantId: office.id,
      nameBn: "পরীক্ষা নাগরিক",
      nameEn: "Synthetic integration citizen",
      dateOfBirth: "1998-02-03",
      addressBn: "পরীক্ষা ঠিকানা",
      addressEn: "Synthetic integration address",
      syntheticReference: `DEMO-INTEGRATION-${run}`,
    },
    "anonymous",
  );
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  await login("citizen", email);
  citizen = (await request("GET", "/citizens")).body.items[0];
  // An active subscription (credits for the issuance debit) via the demo settle.
  const order = await request(
    "POST",
    "/billing/orders",
    { kind: "subscription", planId: "demo-monthly" },
    "finance",
  );
  assert.equal(order.status, 201, JSON.stringify(order.body));
  assert.equal(
    (await request("POST", `/billing/orders/${order.body.id}/demo-settle`, {}, "finance")).status,
    200,
  );
});
after(async () => {
  await closePdfBrowser();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await admin.end();
});

test("integration fix 3: an EN trade licence order issues an English licence when the form has no delivery_language", async () => {
  // A zero-fee policy for service 42, so issuance is not stopped at the payment gate.
  const published = await request(
    "POST",
    "/admin/services/42/order-policies",
    {
      expectedVersion: 0,
      reason: "Synthetic integration regression; not a government tariff",
      statutoryFeeMinor: 0,
      processingFeeMinor: 0,
      emergencySurchargeMinor: 0,
      deliveryFeesMinor: { office_collection: 0, digital_copy: 0 },
      deliveryModes: ["office_collection", "digital_copy"],
      urgencies: ["normal"],
    },
    "admin",
  );
  assert.equal(published.status, 201, JSON.stringify(published.body));
  const policyVersion = published.body.policy.version;

  const payload = getDemoPayload(42);
  assert.ok(
    !Object.hasOwn(payload, "delivery_language"),
    "premise: the trade licence form carries no delivery_language field",
  );
  const preferences = {
    addressBasis: "registered_profile",
    certificateLanguage: "en",
    deliveryMode: "office_collection",
    urgency: "normal",
  };
  const created = await request("POST", "/applications", {
    citizenId: citizen.id,
    serviceNo: 42,
    payload,
    order: { policyVersion, preferences },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id as string;
  const snapshot = (
    await admin.query(
      "SELECT certificate_language FROM application_order_snapshots WHERE application_id=$1",
      [id],
    )
  ).rows[0];
  assert.equal(snapshot.certificate_language, "en", "the order snapshot records the EN choice");

  const submitted = await request("POST", `/applications/${id}/transition`, { action: "submit" });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  const approved = await request(
    "POST",
    `/applications/${id}/transition`,
    { action: "approve" },
    "approver",
  );
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.state, "ISSUED");
  assert.equal(approved.body.certificate.templateVersion, 7);
  certificateNumber = approved.body.certificate.number as string;

  // The issued document itself must be the English rendering.
  const session = sessions.citizen!;
  const pdfResponse = await fetch(`${base}/api/v1/certificates/${approved.body.certificate.id}/pdf`, {
    headers: { Cookie: session.cookie },
  });
  assert.equal(pdfResponse.status, 200);
  const pdf = Buffer.from(await pdfResponse.arrayBuffer());
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "integration-tl-"));
  const file = path.join(dir, "trade-licence.pdf");
  fs.writeFileSync(file, pdf);
  const { stdout: text } = await execFileAsync("pdftotext", [file, "-"]);
  assert.ok(
    text.includes("According to Union Parishad Model Tax Schedule 2013"),
    "the English statute line renders",
  );
  assert.ok(text.includes("Business Organization Name"), "the English field labels render");
  assert.ok(
    !text.includes("ইউনিয়ন পরিষদ আদর্শ কর তফসিল ২০১৩ মোতাবেক"),
    "the Bangla statute line does not render on an EN order",
  );

  // The same certificate verifies publicly; this office is a demo tenant, so
  // the payload still reports demo:true here (fix 2's contrast comes next).
  const byNumber = await request(
    "GET",
    `/verify/by-number/${encodeURIComponent(certificateNumber)}`,
    undefined,
    "anonymous",
  );
  assert.equal(byNumber.status, 200, JSON.stringify(byNumber.body));
  assert.equal(byNumber.body.status, "ISSUED");
  assert.equal(byNumber.body.demo, true);
});

test("integration fix 2: a production tenant can be onboarded demo=false and verify reports it truthfully", async () => {
  // The onboarding step migration 041 enables: before it, this UPDATE was
  // rejected by tenants_demo_check (proven live in Phase Z, PHASEZ-LIVE J4).
  await admin.query("UPDATE tenants SET demo=false WHERE id=$1", [office.id]);
  const byNumber = await request(
    "GET",
    `/verify/by-number/${encodeURIComponent(certificateNumber)}`,
    undefined,
    "anonymous",
  );
  assert.equal(byNumber.status, 200, JSON.stringify(byNumber.body));
  assert.equal(byNumber.body.status, "ISSUED");
  assert.equal(byNumber.body.demo, false, "the verify payload now reports the production tenant truthfully");
});
