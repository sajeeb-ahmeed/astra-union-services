/**
 * S-006 — per-number attempt budget on public verify/track.
 *
 * Runs against the local seeded DB with shared limits explicitly ON for
 * this file only (SHARED_RATE_LIMITS=on set before the app module is
 * imported — static imports hoist, so the app is imported dynamically
 * in before()). Fake numbers use the 20990101 date prefix, which can
 * never be a real minted reference (minting uses the current Dhaka
 * date), so the lockout tests cannot collide with real records. Rows
 * are deleted in after().
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { demoPayloads } from "@astra/shared-schemas";
import { pool, adminConnectionString } from "../src/db.js";

const run = randomUUID().slice(0, 8);
const admin = new pg.Pool({ connectionString: adminConnectionString });
// 20990101 + 8 digits: well-formed 16-digit numbers no real record has.
const fakeVerify = `20990101${run.slice(0, 8).replace(/[^0-9]/g, "0").padEnd(8, "0")}`.slice(0, 16);
const fakeTrack = `20990101${run.slice(0, 4).replace(/[^0-9]/g, "0")}7777`.slice(0, 16);
let app: any;
let server: ReturnType<typeof app.listen>;
let base: string;
let realReference: string;

type Session = { cookie: string; csrf: string };
async function req(method: string, path: string, data?: unknown, session?: Session) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      ...(session ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const text = await response.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: response.status, headers: response.headers, body };
}

before(async () => {
  process.env.SHARED_RATE_LIMITS = "on";
  ({ app } = await import("../src/app.js"));
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  const login = await req("POST", "/auth/login", {
    email: "staff@alpha.local.test",
    password: "Demo-Phase1!",
  });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  const staff: Session = {
    cookie: login.headers.get("set-cookie")?.split(";")[0] ?? "",
    csrf: login.body.csrfToken,
  };
  const citizens = await req("GET", "/citizens", undefined, staff);
  assert.equal(citizens.status, 200, JSON.stringify(citizens.body));
  const citizenId = citizens.body.items[0].id as string;
  const created = await req(
    "POST",
    "/applications",
    { citizenId, serviceNo: 45, payload: demoPayloads[45] },
    staff,
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  // public_track_by_reference only resolves non-DRAFT applications, so
  // the fixture is submitted (staff may submit, as in approval-chain).
  const submitted = await req(
    "POST",
    `/applications/${created.body.id}/transition`,
    { action: "submit" },
    staff,
  );
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  realReference =
    created.body.reference ??
    (
      await admin.query("SELECT reference FROM applications WHERE id=$1", [
        created.body.id,
      ])
    ).rows[0].reference;
  assert.match(realReference, /^\d{16}$/, "a real 16-digit reference to track");
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await admin.query(
    "DELETE FROM rate_limit_buckets WHERE key LIKE $1 OR key = 'login:ip:127.0.0.1'",
    ["lookup:20990101%"],
  );
  await pool.end();
  await admin.end();
});

test("S-006: repeated failed lookups of one verify number exhaust its budget", async () => {
  for (let n = 0; n < 10; n++) {
    const miss = await req("GET", `/verify/by-number/${fakeVerify}`);
    assert.equal(miss.status, 404, `attempt ${n + 1} must miss, got ${miss.status}`);
  }
  const locked = await req("GET", `/verify/by-number/${fakeVerify}`);
  assert.equal(locked.status, 429);
  assert.equal(locked.body.error.code, "VERIFY_RATE_LIMIT");
  // A different number is unaffected — the budget is per-number, not global.
  const other = await req("GET", `/verify/by-number/2099010199999999`);
  assert.equal(other.status, 404);
});

test("S-006: repeated failed lookups of one track reference exhaust its budget", async () => {
  for (let n = 0; n < 10; n++) {
    const miss = await req("GET", `/track/${fakeTrack}`);
    assert.equal(miss.status, 404, `attempt ${n + 1} must miss, got ${miss.status}`);
  }
  const locked = await req("GET", `/track/${fakeTrack}`);
  assert.equal(locked.status, 429);
  assert.equal(locked.body.error.code, "TRACK_RATE_LIMIT");
});

test("S-006: legitimate lookups still succeed while other numbers are locked out", async () => {
  const found = await req("GET", `/track/${realReference}`);
  assert.equal(found.status, 200, JSON.stringify(found.body));
  assert.equal(found.body.reference ?? found.body.referenceNumber ?? realReference, realReference);
  // The real reference still resolves after the fake-number lockouts above.
  const again = await req("GET", `/track/${realReference}`);
  assert.equal(again.status, 200);
  // A malformed lookup is a plain 404 and does not consume any budget.
  const malformed = await req("GET", "/track/not-a-reference!!");
  assert.equal(malformed.status, 404);
});
