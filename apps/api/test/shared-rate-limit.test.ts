/**
 * S-004 / A-003 — the shared (DB-backed) rate limiter.
 *
 * Runs against the local seeded DB (table rate_limit_buckets, migration
 * 061). All rows use a per-run key prefix and are deleted in after(),
 * so the suite's other files never see them.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { pool, adminConnectionString } from "../src/db.js";
import {
  createSharedRateLimiter,
  createFailureBudget,
  sharedRateLimitsEnabled,
} from "../src/shared-rate-limit.js";

const run = randomUUID().slice(0, 8);
const prefix = `test-${run}:`;
const admin = new pg.Pool({ connectionString: adminConnectionString });

async function cleanup() {
  await admin.query("DELETE FROM rate_limit_buckets WHERE key LIKE $1", [
    `${prefix}%`,
  ]);
}
after(async () => {
  await cleanup();
  await admin.end();
  await pool.end();
});

test("S-004: two limiter instances share one budget (simulated separate processes)", async () => {
  const a = createSharedRateLimiter({
    pool,
    limit: 3,
    windowMs: 60_000,
    keyPrefix: prefix,
  });
  // A second instance with no shared in-memory state at all — the only
  // thing connecting it to `a` is the database table.
  const b = createSharedRateLimiter({
    pool,
    limit: 3,
    windowMs: 60_000,
    keyPrefix: prefix,
  });
  assert.equal((await a.consume("burst")).allowed, true);
  assert.equal((await a.consume("burst")).allowed, true);
  assert.equal((await b.consume("burst")).allowed, true, "B sees A's two consumes");
  const denied = await b.consume("burst");
  assert.equal(denied.allowed, false);
  assert.equal(denied.count, 4);
  assert.ok(denied.retryAfterMs > 0);
  // A different key is unaffected — legitimate traffic keeps its own budget.
  assert.equal((await a.consume("other-key")).allowed, true);
  const stored = (
    await admin.query(
      "SELECT key, count FROM rate_limit_buckets WHERE key LIKE $1 ORDER BY key",
      [`${prefix}%`],
    )
  ).rows;
  assert.deepEqual(
    stored.map((r) => [r.key, r.count]),
    [
      [`${prefix}burst`, 4],
      [`${prefix}other-key`, 1],
    ],
  );
});

test("S-004: the window resets after it expires", async () => {
  const limiter = createSharedRateLimiter({
    pool,
    limit: 2,
    windowMs: 1000,
    keyPrefix: prefix,
  });
  assert.equal((await limiter.consume("window")).allowed, true);
  assert.equal((await limiter.consume("window")).allowed, true);
  assert.equal((await limiter.consume("window")).allowed, false);
  await new Promise((r) => setTimeout(r, 1100));
  const afterWindow = await limiter.consume("window");
  assert.equal(afterWindow.allowed, true);
  assert.equal(afterWindow.count, 1, "the expired window resets to 1");
});

test("S-004: a failure budget counts failures only and clears on success", async () => {
  const budget = createFailureBudget({
    pool,
    limit: 3,
    windowMs: 60_000,
    keyPrefix: prefix,
    shared: true,
  });
  assert.equal(await budget.blocked("id-1"), false);
  await budget.recordFailure("id-1");
  await budget.recordFailure("id-1");
  assert.equal(await budget.blocked("id-1"), false);
  await budget.recordFailure("id-1");
  assert.equal(await budget.blocked("id-1"), true);
  await budget.clear("id-1");
  assert.equal(await budget.blocked("id-1"), false, "success clears the budget");
});

test("S-004: when the database is unreachable the same budget is enforced in-memory", async () => {
  const brokenPool = {
    async query() {
      throw new Error("ECONNREFUSED (simulated)");
    },
  };
  let warned = false;
  const limiter = createSharedRateLimiter({
    pool: brokenPool,
    limit: 2,
    windowMs: 60_000,
    keyPrefix: prefix,
    onFallback: () => {
      warned = true;
    },
  });
  assert.equal((await limiter.consume("down")).allowed, true);
  assert.equal((await limiter.consume("down")).allowed, true);
  assert.equal((await limiter.consume("down")).allowed, false);
  assert.equal(warned, true, "the fallback is logged, not silent");
  assert.equal(limiter.fallbackUsed(), true);
});

test("S-004: two separate server instances share the public budget through middleware", async () => {
  const makeServer = () => {
    const app = express();
    const limiter = createSharedRateLimiter({
      pool,
      limit: 3,
      windowMs: 60_000,
      keyPrefix: prefix,
    });
    app.use(limiter.middleware());
    app.get("/api/v1/verify/demo", (_req, res) => res.json({ ok: true }));
    const server = app.listen(0, "127.0.0.1");
    return { app, server };
  };
  const first = makeServer();
  const second = makeServer();
  await Promise.all([
    new Promise<void>((r) => first.server.once("listening", r)),
    new Promise<void>((r) => second.server.once("listening", r)),
  ]);
  try {
    const urlA = `http://127.0.0.1:${(first.server.address() as any).port}/api/v1/verify/demo`;
    const urlB = `http://127.0.0.1:${(second.server.address() as any).port}/api/v1/verify/demo`;
    assert.equal((await fetch(urlA)).status, 200);
    assert.equal((await fetch(urlA)).status, 200);
    assert.equal((await fetch(urlB)).status, 200, "second instance shares the budget");
    const denied = await fetch(urlB);
    assert.equal(denied.status, 429);
    assert.ok(denied.headers.get("retry-after"), "a Retry-After is returned");
  } finally {
    await Promise.all([
      new Promise<void>((r) => first.server.close(() => r())),
      new Promise<void>((r) => second.server.close(() => r())),
    ]);
  }
});

test("S-004: shared limits are on in production and off by default elsewhere", () => {
  assert.equal(sharedRateLimitsEnabled({ NODE_ENV: "production" }), true);
  assert.equal(sharedRateLimitsEnabled({ NODE_ENV: "test" }), false);
  assert.equal(sharedRateLimitsEnabled({ NODE_ENV: "test", SHARED_RATE_LIMITS: "on" }), true);
  assert.equal(sharedRateLimitsEnabled({}), false);
});
