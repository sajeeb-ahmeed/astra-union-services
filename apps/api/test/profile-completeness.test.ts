import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { demoPayloads } from "@astra/shared-schemas";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";

process.env.NODE_ENV = "test";
const admin = new pg.Pool({ connectionString: adminConnectionString });
let server: ReturnType<typeof app.listen>, base: string, alphaId: string;
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
  return { status: response.status, body: type.includes("json") ? await response.json() : null };
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
async function approvedFor(citizenId: string) {
  const created = await req("POST", "/applications", { citizenId, serviceNo: 45, payload: demoPayloads[45] }, s.staff);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  for (const [action, who] of [
    ["submit", "staff"],
    ["review", "reviewer"],
    ["approve", "approver"],
  ]) {
    const r = await req("POST", `/applications/${created.body.id}/transition`, { action }, s[who]);
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  return created.body.id as string;
}

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  for (const name of ["staff", "reviewer", "approver", "admin", "citizen"]) await login(name);
  alphaId = (await admin.query("SELECT id FROM tenants WHERE slug='alpha'")).rows[0]?.id;
  assert.ok(alphaId, "the alpha demo office exists");
});
after(async () => {
  // The demo office is shared with other suites: always leave the gate off as seeded.
  await admin.query("UPDATE tenants SET require_complete_profile=false WHERE id=$1", [alphaId]);
  await closePdfBrowser();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await admin.end();
});

test("Phase 3b: approvers see completeness; an enforcing office refuses issuance until the profile is complete", async () => {
  const geography = (await req("GET", "/citizens", undefined, s.citizen)).body.items[0]?.geography;
  const registered = await req(
    "POST",
    "/citizens",
    {
      nameBn: "অসম্পূর্ণ প্রোফাইল",
      nameEn: `Incomplete Profile ${Date.now()}`,
      dateOfBirth: "1987-07-08",
      addressBn: "নমুনা গ্রাম ঠিকানা",
      addressEn: "Synthetic village address",
      ...(geography ? { geography } : {}),
    },
    s.staff,
  );
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  const citizenId = registered.body.id;
  const first = await approvedFor(citizenId);

  // Warn first: with the gate off the detail shows what is missing and issuance still works.
  const detail = await req("GET", `/applications/${first}`, undefined, s.approver);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.profileCompleteness.enforced, false);
  assert.equal(detail.body.profileCompleteness.complete, false);
  assert.deepEqual(detail.body.profileCompleteness.missing, ["identityNumber", "mobile"]);
  const unenforced = await req("POST", `/applications/${first}/issue`, {}, s.approver);
  assert.ok([200, 201].includes(unenforced.status), JSON.stringify(unenforced.body));

  // Only the office admin switches enforcement, and the change is audited.
  for (const who of ["staff", "approver", "citizen"])
    assert.equal(
      (await req("PUT", "/admin/office/profile-completeness", { requireCompleteProfile: true }, s[who])).status,
      403,
    );
  const on = await req("PUT", "/admin/office/profile-completeness", { requireCompleteProfile: true }, s.admin);
  assert.equal(on.status, 200, JSON.stringify(on.body));
  assert.equal(on.body.requireCompleteProfile, true);
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM audit_events WHERE tenant_id=$1 AND action='PROFILE_COMPLETENESS_ENFORCEMENT_CHANGED'",
        [alphaId],
      )
    ).rows[0].n > 0,
    true,
  );

  const second = await approvedFor(citizenId);
  const refused = await req("POST", `/applications/${second}/issue`, {}, s.approver);
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  assert.equal(refused.body.error.code, "PROFILE_INCOMPLETE");
  assert.deepEqual(refused.body.error.issues.missing, ["identityNumber", "mobile"]);
  assert.match(refused.body.error.message, /NID or birth registration number/);
  assert.equal(
    (await admin.query("SELECT count(*)::int n FROM certificates WHERE application_id=$1", [second])).rows[0].n,
    0,
    "nothing is issued or charged",
  );

  // Completing the profile lets the same application through.
  const tail = String(Date.now()).slice(-8);
  const patched = await req(
    "PATCH",
    `/citizens/${citizenId}/details`,
    { birthReg: `20${tail}${tail.slice(0, 7)}`.slice(0, 17), noMobile: true },
    s.staff,
  );
  assert.equal(patched.status, 200, JSON.stringify(patched.body));
  const afterDetail = await req("GET", `/applications/${second}`, undefined, s.approver);
  assert.equal(afterDetail.body.profileCompleteness.complete, true);
  assert.equal(afterDetail.body.profileCompleteness.percent, 100);
  const issued = await req("POST", `/applications/${second}/issue`, {}, s.approver);
  assert.ok([200, 201].includes(issued.status), JSON.stringify(issued.body));

  const off = await req("PUT", "/admin/office/profile-completeness", { requireCompleteProfile: false }, s.admin);
  assert.equal(off.body.requireCompleteProfile, false);
  assert.equal(
    (await req("PUT", "/admin/office/profile-completeness", { requireCompleteProfile: "yes" }, s.admin)).status,
    422,
  );
});
