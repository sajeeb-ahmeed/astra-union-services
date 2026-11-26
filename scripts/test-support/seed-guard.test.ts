/**
 * S-003 / A-004 — regression tests for the seed production guard.
 *
 * No database access: the guard is a pure function of the environment.
 * The seeded accounts themselves (`Demo-Phase1!`, 13 accounts) are NOT
 * changed — the local test suites sign in with them.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { seedAllowed, assertSeedAllowed } from "../seed-guard.js";

test("S-003: seeding is refused in production mode", () => {
  assert.equal(seedAllowed({ NODE_ENV: "production" }), false);
  assert.equal(seedAllowed({ APP_ENV: "production" }), false);
  assert.equal(
    seedAllowed({ NODE_ENV: "test", APP_ENV: "production" }),
    false,
    "a production value anywhere refuses, even with NODE_ENV=test",
  );
  assert.equal(seedAllowed({ NODE_ENV: "Production" }), false);
  assert.throws(
    () => assertSeedAllowed({ NODE_ENV: "production" }),
    /SEED_REFUSED.*not explicitly non-production/,
  );
});

test("S-003: seeding is refused when the environment is not named at all", () => {
  assert.equal(seedAllowed({}), false);
  assert.equal(seedAllowed({ NODE_ENV: "" }), false);
  assert.throws(() => assertSeedAllowed({}), /SEED_REFUSED/);
});

test("S-003: seeding is refused for unrecognised environments", () => {
  for (const env of ["staging", "prod", "live", "qa"]) {
    assert.equal(seedAllowed({ NODE_ENV: env }), false, env);
  }
});

test("S-003: seeding is allowed only in explicitly non-production environments", () => {
  for (const env of ["test", "development", "dev", "local"]) {
    assert.equal(seedAllowed({ NODE_ENV: env }), true, env);
    assert.doesNotThrow(() => assertSeedAllowed({ NODE_ENV: env }), env);
  }
  assert.equal(
    seedAllowed({ NODE_ENV: "test", APP_ENV: "development" }),
    true,
  );
});
