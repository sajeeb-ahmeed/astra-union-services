import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { demoPayloads, getServiceSchema } from "@astra/shared-schemas";
import { app } from "../src/app.js";
import { pool } from "../src/db.js";
import { renderCertificateHtml, DEMO_TEMPLATE_VERSION } from "../src/certificate-template.js";

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
    body: JSON.stringify({ email: `${name}@alpha.demo.test`, password: "Demo-Phase1!" }),
  });
  const json = await r.json();
  assert.equal(r.status, 200, JSON.stringify(json));
  s[name] = { cookie: r.headers.get("set-cookie")!.split(";")[0], csrf: json.csrfToken };
}

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  for (const name of ["staff", "reviewer", "approver", "citizen"]) await login(name);
  citizenId = (await req("GET", "/citizens", undefined, "citizen")).body.items[0].id;
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

test("Phase 6a: the Chairman may ask the applicant to come; the application stays under review and can then be approved", async () => {
  const created = await req("POST", "/applications", { citizenId, serviceNo: 45, payload: demoPayloads[45] }, "staff");
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id;
  const move = (action: string, who: string, reason?: string) =>
    req("POST", `/applications/${id}/transition`, { action, ...(reason ? { reason } : {}) }, who);
  assert.equal((await move("submit", "staff")).status, 200);
  // Not before review.
  assert.equal((await move("summon", "approver", "Come on Sunday at 10 am")).status, 409);
  assert.equal((await move("review", "reviewer")).status, 200);
  // Only the Chairman (approver with authority) summons, and only with a note.
  assert.equal((await move("summon", "reviewer", "Come on Sunday at 10 am")).status, 403);
  assert.equal((await move("summon", "approver")).status, 422);
  const summoned = await move("summon", "approver", "Please come to the Union office on Sunday at 10 am with your NID.");
  assert.equal(summoned.status, 200, JSON.stringify(summoned.body));
  assert.equal(summoned.body.state, "UNDER_REVIEW");
  // The applicant sees the request in the application history.
  const seen = await req("GET", `/applications/${id}`, undefined, "citizen");
  const event = seen.body.events.find((e: any) => e.action === "summon");
  assert.equal(event.reason, "Please come to the Union office on Sunday at 10 am with your NID.");
  assert.equal(event.toState, "UNDER_REVIEW");
  // After the visit the Chairman can approve as usual.
  assert.equal((await move("approve", "approver")).status, 200);
});

test("Phase 6a: certificates (template 5) carry Secretary and Chairman signature blocks in the delivery language", () => {
  assert.equal(DEMO_TEMPLATE_VERSION, 5);
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
    );
  const en = render("en");
  assert.match(en, /class="signatures"/);
  assert.match(en, /<strong>Verified by<\/strong><span>Secretary<\/span>/);
  assert.match(en, /<strong>Approved by<\/strong><span>Chairman<\/span>/);
  assert.match(render("bn"), /<strong>অনুমোদনকারী<\/strong><span>চেয়ারম্যান<\/span>/);
  // Still clearly a demonstration document.
  assert.match(en, /DEMO \/ NOT OFFICIAL/);
});
