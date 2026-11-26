/** W-019 / D-6 — the schema version table in docs/DYNAMIC_FORM_SPEC.md is
 * generated from the live schema catalogue. This test fails when the table
 * is stale (a schema was published without regenerating), so the doc can
 * never again claim "#45 v1, others v2" while the catalogue is at v3–v6.
 * No database access. */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

test("W-019: generated schema version table matches the catalogue", () => {
  execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/generate-schema-version-table.ts",
      "--check",
    ],
    { stdio: "pipe" },
  );
  assert.ok(true);
});
