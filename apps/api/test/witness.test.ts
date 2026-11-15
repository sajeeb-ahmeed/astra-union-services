import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";
import { witnessHtml } from "../src/witness.js";

const db = new pg.Pool({ connectionString: adminConnectionString });
const run = randomUUID().slice(0, 8);
let server: ReturnType<typeof app.listen>, base: string, typeId: string;
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
  return {
    status: response.status,
    headers: response.headers,
    body: type.includes("json") ? await response.json() : Buffer.from(await response.arrayBuffer()),
  };
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
const input = (extra: Record<string, unknown> = {}) => ({
  typeId,
  deceasedNameBn: "পরীক্ষা মৃত ব্যক্তি",
  attestorNameBn: "পরীক্ষা প্রত্যয়নকারী",
  mobile: "01712000002",
  nid: "1234567890",
  ...extra,
});

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  await login("owner", "owner@astra.demo.test");
  await login("admin", "admin@alpha.demo.test");
});
after(async () => {
  await db.query("UPDATE witness_certificate_types SET active=false WHERE religion_en=$1", [`Synthetic religion ${run}`]);
  await closePdfBrowser();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await db.end();
});

test("Phase 4c: only the owner maintains the religion and certificate-type options", async () => {
  const body = { religionBn: "পরীক্ষা ধর্ম", religionEn: `Synthetic religion ${run}`, nameBn: "পরীক্ষা সনদ", nameEn: "Synthetic type" };
  assert.equal((await req("POST", "/owner/witness-types", body, s.admin)).status, 403);
  const created = await req("POST", "/owner/witness-types", body, s.owner);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  typeId = created.body.id;
  assert.equal((await req("POST", "/owner/witness-types", body, s.owner)).status, 409);
  const options = await req("GET", "/public/witness/options");
  assert.ok(options.body.items.some((x: any) => x.id === typeId));
});

test("Phase 4c: the public generator validates input and returns a PDF without storing anything", async () => {
  const before = (await db.query("SELECT count(*)::int n FROM audit_events")).rows[0].n;
  const pdf = await req("POST", "/public/witness", input());
  assert.equal(pdf.status, 200, String(pdf.body));
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.equal(pdf.headers.get("cache-control"), "no-store");
  assert.equal((pdf.body as Buffer).subarray(0, 5).toString(), "%PDF-");
  for (const bad of [{ nid: "1234567890123" }, { nid: "12345" }, { mobile: "0123" }, { typeId: randomUUID() }, { deceasedNameBn: "x" }])
    assert.equal((await req("POST", "/public/witness", input(bad))).status, 422, JSON.stringify(bad));
  assert.equal((await req("POST", "/public/witness", input({ nid: "12345678901234567" }))).status, 200, "17 digits is accepted");
  // A switched-off type is no longer offered or usable.
  assert.equal((await req("PATCH", `/owner/witness-types/${typeId}`, { active: false }, s.owner)).body.active, false);
  assert.equal((await req("POST", "/public/witness", input())).status, 422);
  assert.equal((await req("GET", "/public/witness/options")).body.items.some((x: any) => x.id === typeId), false);
  assert.equal((await db.query("SELECT count(*)::int n FROM audit_events")).rows[0].n, before, "nothing is recorded about the visitor");
});

test("Phase 4c: the document is badged as a utility document and shows only the last NID digits", () => {
  const html = witnessHtml({
    type: { name_bn: "সনদ", religion_bn: "ধর্ম" },
    deceasedNameBn: "মৃত <b>ব্যক্তি</b>",
    attestorNameBn: "প্রত্যয়নকারী",
    mobile: "01712000002",
    nid: "1234567890",
    generatedOn: "2026-11-15",
  });
  assert.match(html, /Utility document — not an office certificate/);
  assert.doesNotMatch(html, /1234567890|১২৩৪৫৬৭৮৯০/);
  assert.match(html, /••••••৭৮৯০/);
  assert.doesNotMatch(html, /<b>ব্যক্তি<\/b>/, "visitor text is escaped");
});
