import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.js";
import { pool } from "../src/db.js";
import { operationsAlerts } from "../src/operations.js";

let server: ReturnType<typeof app.listen>, base: string;
type Session = { cookie: string; csrf: string };
const s: Record<string, Session> = {};
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
const get = (who: string) => fetch(`${base}/api/v1/owner/operations`, { headers: { Cookie: s[who].cookie } });

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  await login("owner", "owner@astra.demo.test");
  await login("admin", "admin@alpha.demo.test");
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

test("operations: only the owner sees the cross-office summary, which holds counts and times only", async () => {
  assert.equal((await get("admin")).status, 403);
  const r = await get("owner");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const body = await r.json();
  assert.deepEqual(Object.keys(body.scanner).sort(), ["errors", "lastHeartbeatAt", "oldestWaitingAt", "rejected", "scanning", "waiting"]);
  assert.deepEqual(Object.keys(body.queues).sort(), [
    "officeAccountRequestsPending",
    "officeInclusionRequestsOpen",
    "rechargesPending",
    "refundsAwaitingDecision",
    "refundsInProgress",
  ]);
  for (const value of [...Object.values(body.scanner), ...Object.values(body.queues)])
    assert.ok(value === null || typeof value === "number" || typeof value === "string");
  assert.ok(Array.isArray(body.alerts));
});

test("operations alerts: a stopped scanner with waiting files is critical; a slow queue and pending work are warnings", () => {
  const now = Date.parse("2026-11-15T12:00:00Z");
  const scanner = (extra: Record<string, unknown>) => ({
    waiting: 0,
    scanning: 0,
    errors: 0,
    rejected: 0,
    oldestWaitingAt: null,
    lastHeartbeatAt: "2026-11-15T11:59:00Z",
    ...extra,
  });
  const queues = { rechargesPending: 0, officeAccountRequestsPending: 0, officeInclusionRequestsOpen: 0, refundsAwaitingDecision: 0, refundsInProgress: 0 };
  assert.deepEqual(operationsAlerts({ scanner: scanner({}), queues }, now), []);
  const offline = operationsAlerts(
    { scanner: scanner({ waiting: 3, oldestWaitingAt: "2026-11-15T11:00:00Z", lastHeartbeatAt: "2026-11-15T11:30:00Z" }), queues },
    now,
  );
  assert.deepEqual(offline, [{ code: "SCANNER_OFFLINE", severity: "critical", minutes: 30, count: 3 }]);
  assert.equal(operationsAlerts({ scanner: scanner({ waiting: 1, lastHeartbeatAt: null }), queues }, now)[0].code, "SCANNER_OFFLINE");
  const slow = operationsAlerts({ scanner: scanner({ waiting: 2, oldestWaitingAt: "2026-11-15T11:00:00Z" }), queues }, now);
  assert.deepEqual(slow, [{ code: "SCAN_QUEUE_SLOW", severity: "warning", minutes: 60, count: 2 }]);
  const work = operationsAlerts({ scanner: scanner({ errors: 1 }), queues: { ...queues, rechargesPending: 2, officeAccountRequestsPending: 1 } }, now);
  assert.deepEqual(work.map((a) => a.code), ["SCAN_ERRORS", "RECHARGES_PENDING", "ACCOUNT_REQUESTS_PENDING"]);
});
