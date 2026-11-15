import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { demoPayloads } from "@astra/shared-schemas";
import { app } from "../src/app.js";
import { pool } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";

process.env.NODE_ENV = "test";
let server: ReturnType<typeof app.listen>, base: string, citizen: any;
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
const today = () => new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10); // Asia/Dhaka date

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  for (const name of ["staff", "citizen"]) await login(name);
  citizen = (await req("GET", "/citizens", undefined, "citizen")).body.items[0];
});
after(async () => {
  await closePdfBrowser();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

test("Phase 6c: application lists filter by date range and renewals, and reject a reversed range", async () => {
  const created = await req("POST", "/applications", { citizenId: citizen.id, serviceNo: 45, payload: demoPayloads[45] }, "staff");
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const inRange = await req("GET", `/applications?from=${today()}&to=${today()}&pageSize=100`, undefined, "staff");
  assert.equal(inRange.status, 200, JSON.stringify(inRange.body));
  assert.ok(inRange.body.items.some((x: any) => x.id === created.body.id));
  const past = await req("GET", "/applications?from=2000-01-01&to=2000-01-31", undefined, "staff");
  assert.equal(past.body.items.length, 0);
  assert.equal((await req("GET", "/applications?from=2026-02-01&to=2026-01-01", undefined, "staff")).status, 422);
  assert.equal((await req("GET", "/applications?from=2026-13-40", undefined, "staff")).status, 422);
  const renewals = await req("GET", "/applications?renewal=true&pageSize=100", undefined, "staff");
  assert.equal(renewals.status, 200);
  assert.ok(renewals.body.items.every((x: any) => x.isRenewal === true));
  assert.equal(renewals.body.items.some((x: any) => x.id === created.body.id), false);
});

test("Phase 6c: print lists find records by citizen name or reference within a date range", async () => {
  const made = await req(
    "POST",
    "/print-requests",
    { kind: "biodata", citizenId: citizen.id, language: "en" },
    "staff",
  );
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const byName = await req("GET", `/print-requests?kind=biodata&q=${encodeURIComponent(citizen.nameEn.slice(0, 6))}&from=${today()}&to=${today()}`, undefined, "staff");
  assert.equal(byName.status, 200, JSON.stringify(byName.body));
  assert.ok(byName.body.items.some((x: any) => x.id === made.body.id));
  assert.equal(byName.body.items[0].citizenNameEn !== undefined, true, "lists show whose record it is");
  const none = await req("GET", "/print-requests?q=zzzz-no-such-person", undefined, "staff");
  assert.equal(none.body.total, 0);
  const old = await req("GET", "/print-requests?from=2000-01-01&to=2000-01-02", undefined, "staff");
  assert.equal(old.body.total, 0);
  // A citizen still sees only their own prints.
  const own = await req("GET", "/print-requests", undefined, "citizen");
  assert.ok(own.body.items.every((x: any) => x.citizenId === citizen.id));
});
