import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { demoPayloads } from "@astra/shared-schemas";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";

// Citizen dashboard (2026-11-26): GET /applications/counts answers a citizen
// with the office response shape scoped to their OWN applications only.
// Delta-based like chairman-dashboard.test.ts: the seeded database is shared,
// so this file proves its own mix moves the citizen's numbers by exactly the
// citizen's share, and another citizen's application never leaks in.
process.env.NODE_ENV = "test";
const admin = new pg.Pool({ connectionString: adminConnectionString });
let server: ReturnType<typeof app.listen>, base: string, alphaId: string;
let ownCitizenId: string, otherCitizenId: string;
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
async function login(key: string, email: string) {
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Demo-Phase1!" }),
  });
  const json = await r.json();
  assert.equal(r.status, 200, JSON.stringify(json));
  s[key] = { cookie: r.headers.get("set-cookie")!.split(";")[0], csrf: json.csrfToken };
}
async function createApplication(citizenId: string) {
  const created = await req(
    "POST",
    "/applications",
    { citizenId, serviceNo: 45, payload: demoPayloads[45] },
    s.staff,
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body.id as string;
}
async function counts(session: Session) {
  const r = await req("GET", "/applications/counts", undefined, session);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body as {
    counts: Record<string, number>;
    awaitingReview: number;
    awaitingIssuance: number;
    oldestPendingAt: string | null;
  };
}

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  await login("staff", "staff@alpha.local.test");
  await login("citizen", "citizen@alpha.local.test");
  ownCitizenId = (await req("GET", "/citizens", undefined, s.citizen)).body.items[0].id;
  alphaId = (await admin.query("SELECT id FROM tenants WHERE slug='alpha'")).rows[0]?.id;
  assert.ok(alphaId, "the alpha demo office exists");
  const geography = (await req("GET", "/citizens", undefined, s.citizen)).body.items[0]?.geography;
  const registered = await req(
    "POST",
    "/citizens",
    {
      nameBn: "অন্য নাগরিক",
      nameEn: `Counts Other ${Date.now()}`,
      dateOfBirth: "1992-06-15",
      addressBn: "পরীক্ষা গ্রাম ঠিকানা",
      addressEn: "Test village address",
      ...(geography ? { geography } : {}),
    },
    s.staff,
  );
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  otherCitizenId = registered.body.id;
});
after(async () => {
  await admin.query("UPDATE tenants SET require_complete_profile=false WHERE id=$1", [alphaId]);
  await closePdfBrowser();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await admin.end();
});

test("citizen counts: same shape as the office counts, scoped to the caller's own applications", async () => {
  const officeBefore = await counts(s.staff);
  const ownBefore = await counts(s.citizen);
  // Same response shape: every state zero-filled, same group fields.
  assert.deepEqual(Object.keys(ownBefore.counts).sort(), Object.keys(officeBefore.counts).sort());
  assert.equal(typeof ownBefore.awaitingReview, "number");
  assert.equal(typeof ownBefore.awaitingIssuance, "number");

  // One application for the citizen, one for somebody else.
  const mine = await createApplication(ownCitizenId); // stays DRAFT
  await createApplication(otherCitizenId); // stays DRAFT, must not leak in

  const officeAfter = await counts(s.staff);
  const ownAfter = await counts(s.citizen);
  assert.equal(officeAfter.counts.DRAFT - officeBefore.counts.DRAFT, 2, "office sees both");
  assert.equal(ownAfter.counts.DRAFT - ownBefore.counts.DRAFT, 1, "citizen sees only their own");

  // Submitting the citizen's application moves only the citizen's pending group.
  const submitted = await req("POST", `/applications/${mine}/transition`, { action: "submit" }, s.staff);
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  const ownSubmitted = await counts(s.citizen);
  assert.equal(ownSubmitted.counts.SUBMITTED - ownAfter.counts.SUBMITTED, 1);
  assert.equal(ownSubmitted.awaitingReview - ownAfter.awaitingReview, 1);
  assert.ok(ownSubmitted.oldestPendingAt, "the citizen's oldest pending application is reported");

  // The citizen total never reaches the office total while another citizen
  // has applications in the same office.
  const sum = (c: Record<string, number>) => Object.values(c).reduce((n, v) => n + v, 0);
  assert.ok(sum(ownSubmitted.counts) < sum((await counts(s.staff)).counts));
});
