/** P-012 — regression tests for the single post-deployment gate.
 * No database access: the usage + release.json parsing paths are pure.
 * The full gate (both halves) is exercised against the local seeded
 * database by running `npm run verify:gate -- --live <origin> --skip-live`
 * (see the Stage 3 report); the live half is public-endpoint only and is
 * verified by the operator on the real origin at deploy time. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readReleaseExpectations } from "../verify-deployment-gate.js";

test("P-012: gate exits 2 with usage when no --live origin is given", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/verify-deployment-gate.ts"],
    { encoding: "utf-8" },
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage:.*verify-deployment-gate\.ts --live <origin>/);
});

test("P-012: gate exits 2 when both halves are skipped", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/verify-deployment-gate.ts", "--live", "https://example.invalid", "--skip-db", "--skip-live"],
    { encoding: "utf-8" },
  );
  assert.equal(result.status, 2);
});

test("P-012: release expectations are read from a bundle release.json", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "du-gate-"));
  const file = path.join(dir, "release.json");
  fs.writeFileSync(
    file,
    JSON.stringify({ packageId: "digitalunion-abc-20261126-000000", commit: "1416dd7adee60a2953f5e88278735857e7a71619", branch: "fix/phase4-stage3-workflows" }),
  );
  assert.deepEqual(readReleaseExpectations(file), {
    commit: "1416dd7adee60a2953f5e88278735857e7a71619",
    packageId: "digitalunion-abc-20261126-000000",
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("P-012: unreadable or malformed release.json fails loudly, never silently", () => {
  assert.throws(
    () => readReleaseExpectations("/nonexistent/release.json"),
    /cannot read .*release\.json/,
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "du-gate-"));
  const file = path.join(dir, "release.json");
  fs.writeFileSync(file, JSON.stringify({ packageId: "x" }));
  assert.throws(() => readReleaseExpectations(file), /no commit\/packageId/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("P-012: the gate script ships in the cPanel bundle", () => {
  const packager = fs.readFileSync("scripts/package-cpanel.mjs", "utf-8");
  assert.match(packager, /verify-deployment-gate\.ts/);
});
