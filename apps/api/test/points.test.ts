import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { demoPayloads } from "@astra/shared-schemas";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";

process.env.NODE_ENV = "test";
const admin = new pg.Pool({ connectionString: adminConnectionString });
let server: ReturnType<typeof app.listen>, base: string, alphaId: string, citizenId: string;
type Session = { cookie: string; csrf: string };
const s: Record<string, Session> = {};
// Service 45 is used by the price tests; its price is reset to 0 afterwards because prices are global.
const SERVICE = 45;
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
async function priceVersion() {
  return (await req("GET", "/owner/point-prices", undefined, s.owner)).body.items.find((x: any) => x.serviceNo === SERVICE)
    .version as number;
}
async function setPrice(priceMinor: number) {
  const r = await req(
    "POST",
    `/owner/point-prices/${SERVICE}`,
    { expectedVersion: await priceVersion(), priceMinor, reason: "Synthetic point price for tests" },
    s.owner,
  );
  assert.equal(r.status, 201, JSON.stringify(r.body));
}
async function submitted() {
  const created = await req("POST", "/applications", { citizenId, serviceNo: SERVICE, payload: demoPayloads[SERVICE] }, s.staff);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const r = await req("POST", `/applications/${created.body.id}/transition`, { action: "submit" }, s.staff);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return created.body.id as string;
}

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  await login("owner", "owner@astra.demo.test");
  for (const name of ["staff", "reviewer", "approver", "admin", "citizen"]) await login(name, `${name}@alpha.local.test`);
  alphaId = (await admin.query("SELECT id FROM tenants WHERE slug='alpha'")).rows[0].id;
  citizenId = (await req("GET", "/citizens", undefined, s.citizen)).body.items[0].id;
});
after(async () => {
  try {
    if ((await req("GET", "/owner/point-prices", undefined, s.owner)).body.items.find((x: any) => x.serviceNo === SERVICE).priceMinor)
      await setPrice(0);
  } finally {
    await closePdfBrowser();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
    await admin.end();
  }
});

test("Phase 5a: only the owner publishes versioned point prices", async () => {
  const version = await priceVersion();
  for (const who of ["admin", "approver", "citizen"])
    assert.equal(
      (await req("POST", `/owner/point-prices/${SERVICE}`, { expectedVersion: version, priceMinor: 1, reason: "nope" }, s[who])).status,
      403,
    );
  for (const bad of [{ priceMinor: -1 }, { priceMinor: 1.5 }, { priceMinor: 10000001 }, { reason: "x" }])
    assert.equal(
      (
        await req(
          "POST",
          `/owner/point-prices/${SERVICE}`,
          { expectedVersion: version, priceMinor: 100, reason: "Synthetic price", ...bad },
          s.owner,
        )
      ).status,
      422,
      JSON.stringify(bad),
    );
  assert.equal(
    (await req("POST", `/owner/point-prices/${SERVICE}`, { expectedVersion: version + 5, priceMinor: 1, reason: "Stale version" }, s.owner)).status,
    409,
  );
});

test("Phase 5a/3B: issuance no longer deducts points — the spend path is retired, balances stay readable", async () => {
  await setPrice(1575);
  await assert.rejects(admin.query("UPDATE service_point_prices SET price_minor=0"), /Append-only/);
  const wallet = async () => (await req("GET", "/wallet/points", undefined, s.admin)).body;
  const start = (await wallet()).balanceMinor as number;
  // Bring the wallet just below the old price, through the ledger.
  if (start !== 1000) {
    const r = await req(
      "POST",
      `/owner/tenants/${alphaId}/points/adjust`,
      { deltaMinor: 1000 - start, reason: "Synthetic test balance", requestKey: randomUUID() },
      s.owner,
    );
    assert.equal(r.status, 201, JSON.stringify(r.body));
  }
  // Until Phase 3B this approval was refused 402 POINTS_INSUFFICIENT. Points
  // are never spent now, so the chairman's approve issues at once and the
  // points balance does not move.
  const id = await submitted();
  const approved = await req("POST", `/applications/${id}/transition`, { action: "approve" }, s.approver);
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.ok(approved.body.certificate?.number, "certificate issued");
  const detail = await req("GET", `/applications/${id}`, undefined, s.approver);
  assert.equal(detail.body.application.state, "ISSUED");
  const again = await req("POST", `/applications/${id}/issue`, {}, s.approver);
  assert.ok([200, 201].includes(again.status));
  const after = await wallet();
  assert.equal(after.balanceMinor, 1000, "issuance deducts no points since Phase 3B");
  assert.equal(after.ledger.filter((e: any) => e.kind === "ISSUANCE").length, 0, "no point issuance entries are written");
  assert.deepEqual(after.prices.find((p: any) => p.serviceNo === SERVICE), { serviceNo: SERVICE, priceMinor: 1575 });

  // A recharge-like adjustment, retried with the same key, applies once.
  const requestKey = randomUUID();
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await req(
          "POST",
          `/owner/tenants/${alphaId}/points/adjust`,
          { deltaMinor: 1000, reason: "Synthetic top-up for tests", requestKey },
          s.owner,
        )
      ).status,
      201,
    );
  assert.equal((await wallet()).balanceMinor, 2000);
});

test("Phase 5a: balances change only through the append-only ledger and always reconcile", async () => {
  assert.equal(
    (await req("POST", `/owner/tenants/${alphaId}/points/adjust`, { deltaMinor: -99999999, reason: "Too large debit", requestKey: randomUUID() }, s.owner))
      .status,
    422,
  );
  assert.equal(
    (await req("POST", `/owner/tenants/${alphaId}/points/adjust`, { deltaMinor: 100, reason: "Not allowed", requestKey: randomUUID() }, s.admin)).status,
    403,
  );
  const appRole = await pool.connect();
  try {
    await assert.rejects(appRole.query("UPDATE point_wallets SET balance_minor=999999"), /permission denied/);
  } finally {
    appRole.release();
  }
  await assert.rejects(admin.query("UPDATE point_ledger SET delta_minor=1"), /Append-only/);
  const mismatched = await admin.query(
    "SELECT w.tenant_id FROM point_wallets w LEFT JOIN (SELECT tenant_id,sum(delta_minor) total FROM point_ledger GROUP BY tenant_id) l USING(tenant_id) WHERE w.balance_minor<>coalesce(l.total,0)",
  );
  assert.deepEqual(mismatched.rows, [], "every wallet equals the sum of its ledger");
  // New offices get a wallet automatically.
  const missing = await admin.query("SELECT count(*)::int n FROM tenants t LEFT JOIN point_wallets w ON w.tenant_id=t.id WHERE w.tenant_id IS NULL");
  assert.equal(missing.rows[0].n, 0);
});
