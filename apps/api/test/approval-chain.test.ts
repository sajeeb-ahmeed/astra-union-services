import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { demoPayloads, getServiceSchema } from "@astra/shared-schemas";
import { app } from "../src/app.js";
import { pool } from "../src/db.js";
import { renderCertificateHtml, DEMO_TEMPLATE_VERSION } from "../src/certificate-template.js";
import { closePdfBrowser } from "../src/pdf.js";

process.env.NODE_ENV = "test";
let server: ReturnType<typeof app.listen>, base: string, citizenId: string;
type Session = { cookie: string; csrf: string };
const s: Record<string, Session> = {};
async function req(method: string, path: string, data?: unknown, who?: string) {
  const session = who ? s[who] : undefined;
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      ...(session ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return { status: response.status, body: await response.json() };
}
async function login(name: string) {
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `${name}@alpha.local.test`, password: "Demo-Phase1!" }),
  });
  const json = await r.json();
  assert.equal(r.status, 200, JSON.stringify(json));
  s[name] = { cookie: r.headers.get("set-cookie")!.split(";")[0], csrf: json.csrfToken };
}
async function submittedApplication() {
  const created = await req("POST", "/applications", { citizenId, serviceNo: 45, payload: demoPayloads[45] }, "staff");
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id as string;
  const submitted = await req("POST", `/applications/${id}/transition`, { action: "submit" }, "staff");
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  assert.equal(submitted.body.state, "SUBMITTED");
  return id;
}

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  for (const name of ["staff", "reviewer", "approver", "citizen"]) await login(name);
  citizenId = (await req("GET", "/citizens", undefined, "citizen")).body.items[0].id;
});
after(async () => {
  await closePdfBrowser();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

test("Phase W: the Chairman may ask the applicant to come; the application stays submitted and he then decides it himself", async () => {
  const id = await submittedApplication();
  const move = (action: string, who: string, reason?: string) =>
    req("POST", `/applications/${id}/transition`, { action, ...(reason ? { reason } : {}) }, who);
  // No secretary step exists any more: the removed review action is refused outright.
  assert.equal((await move("review", "reviewer")).status, 422);
  // Only the Chairman (approver with authority) summons, and only with a note.
  assert.equal((await move("summon", "reviewer", "Come on Sunday at 10 am")).status, 403);
  assert.equal((await move("summon", "approver")).status, 422);
  const summoned = await move("summon", "approver", "Please come to the Union office on Sunday at 10 am with your NID.");
  assert.equal(summoned.status, 200, JSON.stringify(summoned.body));
  assert.equal(summoned.body.state, "SUBMITTED");
  // The applicant sees the request in the application history.
  const seen = await req("GET", `/applications/${id}`, undefined, "citizen");
  const event = seen.body.events.find((e: any) => e.action === "summon");
  assert.equal(event.reason, "Please come to the Union office on Sunday at 10 am with your NID.");
  assert.equal(event.toState, "SUBMITTED");
  // After the visit the Chairman approves — and approval issues the certificate at once.
  const approved = await move("approve", "approver");
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.state, "ISSUED");
  assert.ok(approved.body.certificate?.number);
});

test("Phase W: the Chairman's approval of a submitted application issues atomically — one certificate, one credit, notifications both ways", async () => {
  const id = await submittedApplication();
  // The office hears about the new submission; the citizen does not get the office-facing notice.
  const officeFeed = await req("GET", "/notifications", undefined, "approver");
  const submittedNotice = officeFeed.body.items.find((n: any) => n.kind === "APPLICATION_SUBMITTED" && n.applicationId === id);
  assert.ok(submittedNotice, "approver feed contains the submission notification");
  assert.equal(submittedNotice.serviceNo, 45);
  const citizenFeedBefore = await req("GET", "/notifications", undefined, "citizen");
  assert.equal(
    citizenFeedBefore.body.items.some((n: any) => n.kind === "APPLICATION_SUBMITTED" && n.applicationId === id),
    false,
  );
  // The Secretary (reviewer) can no longer decide anything.
  assert.equal((await req("POST", `/applications/${id}/transition`, { action: "approve" }, "reviewer")).status, 403);
  assert.equal(
    (await req("POST", `/applications/${id}/transition`, { action: "reject", reason: "Secretary must not decide" }, "reviewer")).status,
    403,
  );
  assert.equal(
    (await req("POST", `/applications/${id}/transition`, { action: "request_correction", reason: "Secretary must not decide" }, "reviewer")).status,
    403,
  );
  const balanceBefore = (await req("GET", "/wallet", undefined, "approver")).body.balance;
  const approved = await req("POST", `/applications/${id}/transition`, { action: "approve" }, "approver");
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.state, "ISSUED");
  assert.ok(approved.body.approvedBy, "the Chairman is recorded as the approver");
  const certificate = approved.body.certificate;
  assert.ok(certificate.number && certificate.pdfUrl && certificate.verificationUrl);
  assert.equal(certificate.templateVersion, DEMO_TEMPLATE_VERSION);
  // Exactly one credit was deducted by the single action.
  assert.equal((await req("GET", "/wallet", undefined, "approver")).body.balance, balanceBefore - 1);
  // The stored record agrees: one certificate, an approve event and an issue event by the Chairman.
  const detail = await req("GET", `/applications/${id}`, undefined, "citizen");
  assert.equal(detail.body.application.state, "ISSUED");
  assert.equal(detail.body.certificate.id, certificate.id);
  const actions = detail.body.events.map((e: any) => e.action);
  assert.ok(actions.includes("approve") && actions.includes("issue"));
  // One action, two audit events: the approval, then the issuance it performed.
  assert.equal(
    detail.body.events.find((e: any) => e.action === "approve").toState,
    "APPROVED",
  );
  assert.equal(
    detail.body.events.find((e: any) => e.action === "issue").toState,
    "ISSUED",
  );
  // Public verification works from the one-time URL, and the citizen was notified of issuance.
  const token = certificate.verificationUrl.split("/").at(-1);
  const verified = await req("GET", `/verify/${token}`);
  assert.equal(verified.body.status, "ISSUED");
  const citizenFeed = await req("GET", "/notifications", undefined, "citizen");
  const issuedNotice = citizenFeed.body.items.find((n: any) => n.kind === "DEMO_CERTIFICATE_ISSUED" && n.applicationId === id);
  assert.ok(issuedNotice, "citizen feed contains the issuance notification");
  assert.equal(issuedNotice.certificateNumber, certificate.number);
});

test("Phase W: the Chairman rejects a submitted application with a reason and the citizen is notified with that reason", async () => {
  const id = await submittedApplication();
  const move = (action: string, who: string, reason?: string) =>
    req("POST", `/applications/${id}/transition`, { action, ...(reason ? { reason } : {}) }, who);
  assert.equal((await move("reject", "approver")).status, 422);
  const rejected = await move("reject", "approver", "Documents do not match the application");
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
  assert.equal(rejected.body.state, "REJECTED");
  const citizenFeed = await req("GET", "/notifications", undefined, "citizen");
  const notice = citizenFeed.body.items.find((n: any) => n.kind === "APPLICATION_REJECTED" && n.applicationId === id);
  assert.ok(notice, "citizen feed contains the rejection notification");
  assert.equal(notice.detail, "Documents do not match the application");
  const detail = await req("GET", `/applications/${id}`, undefined, "citizen");
  assert.equal(detail.body.application.state, "REJECTED");
  const event = detail.body.events.find((e: any) => e.action === "reject");
  assert.equal(event.reason, "Documents do not match the application");
  // A decided application cannot be approved afterwards.
  assert.equal((await move("approve", "approver")).status, 409);
});

test("Phase W: certificates (template 6, still selectable) carry one Chairman signature block in the delivery language", () => {
  assert.equal(DEMO_TEMPLATE_VERSION, 7);
  const render = (language: string) =>
    renderCertificateHtml(
      {
        number: "DEMO-SIGN",
        verificationUrl: "https://astra.example.test/verify/x",
        tenant: { name_bn: "অফিস", name_en: "Office" },
        service: { service_no: 3, name_bn: "সেবা", name_en: "Service" },
        citizen: { full_name_bn: "নাগরিক", full_name_en: "Citizen", address_bn: "ঠিকানা", address_en: "Address" },
        payload: { delivery_language: language },
        schema: getServiceSchema(3),
      } as any,
      "data:image/png;base64,",
      6,
    );
  const en = render("en");
  assert.match(en, /class="signatures"/);
  assert.match(en, /<strong>Approved and issued by<\/strong><span>Chairman<\/span>/);
  assert.doesNotMatch(en, /Secretary|সচিব/);
  assert.equal((en.match(/class="signature"/g) ?? []).length, 1);
  const bn = render("bn");
  assert.match(bn, /<strong>অনুমোদন ও ইস্যুকারী<\/strong><span>চেয়ারম্যান<\/span>/);
  assert.doesNotMatch(bn, /সচিব/);
  const bilingual = render("bilingual");
  assert.match(bilingual, /<strong>অনুমোদন ও ইস্যুকারী \/ Approved and issued by<\/strong><span>চেয়ারম্যান \/ Chairman<\/span>/);
  // No demo branding anywhere on the rendered certificate.
  assert.doesNotMatch(en, /DEMO \/ NOT OFFICIAL/);
});
