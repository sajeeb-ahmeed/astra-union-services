import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";

const db = new pg.Pool({ connectionString: adminConnectionString });
const run = randomUUID().slice(0, 8);
let server: ReturnType<typeof app.listen>, base: string;
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
  return { status: response.status, body: await response.json() };
}
async function login(name: string, email: string) {
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Demo-Phase1!" }),
  });
  const json = await r.json();
  assert.equal(r.status, 200, JSON.stringify(json));
  s[name] = { cookie: r.headers.get("set-cookie")!.split(";")[0], csrf: json.csrfToken };
}
const request = (extra: Record<string, unknown> = {}) => ({
  officeName: `Synthetic Inclusion Union ${run}`,
  officeType: "UNION",
  contactName: "Synthetic Secretary",
  contactRole: "UP Secretary",
  contactMobile: "+880 1712-000000",
  ...extra,
});

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  await login("owner", "owner@astra.demo.test");
  await login("admin", "admin@alpha.local.test");
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await db.end();
});

test("Phase 6b: anyone can ask for an office to be added; input is checked and the form is rate limited", async () => {
  const sent = await req("POST", "/public/office-inclusion-requests", request({ message: "Please include our union." }));
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  const row = (await db.query("SELECT * FROM office_inclusion_requests WHERE id=$1", [sent.body.id])).rows[0];
  assert.equal(row.contact_mobile, "01712000000", "the mobile is normalised");
  assert.equal(row.status, "NEW");
  assert.equal((await req("POST", "/public/office-inclusion-requests", request({ contactMobile: "12345" }))).status, 422);
  assert.equal((await req("POST", "/public/office-inclusion-requests", request({ officeType: "VILLAGE" }))).status, 422);
  for (let i = 0; i < 2; i++) assert.equal((await req("POST", "/public/office-inclusion-requests", request({ officeName: `Another office ${run} ${i}` }))).status, 201);
  // Five requests per hour from one address.
  assert.equal((await req("POST", "/public/office-inclusion-requests", request())).status, 429);
});

test("Phase 6b: only the owner works the inclusion queue; declining needs a reason and closes the request", async () => {
  assert.equal((await req("GET", "/owner/office-inclusion-requests", undefined, s.admin)).status, 403);
  const queue = await req("GET", "/owner/office-inclusion-requests", undefined, s.owner);
  const mine = queue.body.items.filter((r: any) => r.officeName.includes(run));
  assert.equal(mine.length, 3);
  const [first, second] = mine;
  assert.equal((await req("POST", `/owner/office-inclusion-requests/${first.id}/status`, { status: "CONTACTED" }, s.owner)).body.status, "CONTACTED");
  assert.equal((await req("POST", `/owner/office-inclusion-requests/${second.id}/status`, { status: "DECLINED" }, s.owner)).status, 422);
  const declined = await req("POST", `/owner/office-inclusion-requests/${second.id}/status`, { status: "DECLINED", note: "Already listed under another name" }, s.owner);
  assert.equal(declined.body.status, "DECLINED");
  assert.equal((await req("POST", `/owner/office-inclusion-requests/${second.id}/status`, { status: "ACCEPTED" }, s.owner)).status, 409);
  assert.equal((await req("POST", `/owner/office-inclusion-requests/${first.id}/status`, { status: "ACCEPTED" }, s.admin)).status, 403);
});

test("Phase 6b: an office's public page names its designated issuing officers without contact details", async () => {
  const page = await req("GET", "/offices/alpha");
  assert.equal(page.status, 200);
  assert.ok(Array.isArray(page.body.officers));
  assert.ok(page.body.officers.length >= 1, "the demo approver is listed");
  const officer = page.body.officers[0];
  assert.deepEqual(Object.keys(officer).sort(), ["name", "postBn", "postEn", "services"]);
  assert.ok(officer.services.length >= 1);
  assert.equal(JSON.stringify(page.body.officers).includes("@"), false, "no email addresses");
});

test("R13-GAPS: in OFFICIAL mode demo-flagged offices leave every public surface; demo mode is unchanged", async () => {
  // alpha is a seed office (demo=true). Demo mode (default here): listed.
  const demoList = await req("GET", "/offices?pageSize=100");
  assert.equal(demoList.status, 200);
  assert.ok(
    demoList.body.items.some((o: any) => o.slug === "alpha"),
    "demo mode lists the seed office",
  );
  const demoInfo = await req("GET", "/services/12/office-info");
  assert.equal(demoInfo.status, 200);
  const demoInfoHasAlpha = demoInfo.body.offices.some((o: any) => o.slug === "alpha");

  process.env.ISSUANCE_MODE = "official";
  try {
    const officialList = await req("GET", "/offices?pageSize=100");
    assert.equal(officialList.status, 200);
    assert.equal(
      officialList.body.items.some((o: any) => o.slug === "alpha"),
      false,
      "official mode hides the demo office from the public list",
    );
    assert.ok(
      officialList.body.items.every((o: any) => o.demo === false),
      "official mode lists only non-demo offices",
    );
    assert.equal(
      (await req("GET", "/offices/alpha")).status,
      404,
      "official mode has no public page for a demo office",
    );
    const officialInfo = await req("GET", "/services/12/office-info");
    assert.equal(officialInfo.status, 200);
    assert.equal(
      officialInfo.body.offices.some((o: any) => o.slug === "alpha"),
      false,
      "official mode hides the demo office from service pages",
    );
    if (demoInfoHasAlpha)
      assert.ok(officialInfo.body.offices.length < demoInfo.body.offices.length);
  } finally {
    delete process.env.ISSUANCE_MODE;
  }
  // Demo mode restored: the seed office is public again.
  assert.equal((await req("GET", "/offices/alpha")).status, 200);
});
