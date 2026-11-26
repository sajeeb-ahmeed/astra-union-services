/**
 * P-012: the single mandatory post-deployment gate.
 *
 * Before this script the operator ran the two readiness modes by hand and
 * copied the commit/package values out of release.json into the --live
 * command — a step that was easy to skip or get wrong, and the 24 Nov 2026
 * SCHEMA_UNAVAILABLE outage was exactly a skipped post-deploy step
 * (db:initialize-cpanel). This gate runs both modes in order and exits
 * non-zero unless every check passes; a deployment is not signed off
 * until it exits 0. See docs/DEPLOY-CPANEL.md §6.
 *
 *   On the server, in the application directory, with the app environment
 *   loaded (DATABASE_ADMIN_URL etc. as for db:migrate-cpanel):
 *
 *     node --import tsx scripts/verify-deployment-gate.ts --live https://your-domain
 *
 *   --expect-commit / --expect-package are read from the bundle's own
 *   release.json (same directory as the deployed bundle), so the operator
 *   never hand-copies them. --skip-db runs the live checks only (when the
 *   database checks were already run, or from outside the server);
 *   --skip-live runs the database checks only.
 *
 * Exit codes: 0 every check passed; 1 a check failed (which one is
 * printed); 2 usage error (missing --live origin, unreadable
 * release.json). The gate performs no mutation; the --live half uses
 * public endpoints only and no credentials.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readiness = path.join(root, "scripts", "verify-deployment-readiness.ts");

export function readReleaseExpectations(releaseJsonPath: string): {
  commit: string;
  packageId: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(releaseJsonPath, "utf-8"));
  } catch (err) {
    throw new Error(
      `P-012 gate: cannot read ${releaseJsonPath}: ${(err as Error).message}. ` +
        `Run the gate from the deployed bundle directory (release.json lives at its root).`,
    );
  }
  const record = parsed as { commit?: unknown; packageId?: unknown };
  if (typeof record.commit !== "string" || typeof record.packageId !== "string") {
    throw new Error(
      `P-012 gate: ${releaseJsonPath} has no commit/packageId — it is not a bundle release.json.`,
    );
  }
  return { commit: record.commit, packageId: record.packageId };
}

function runStep(label: string, args: string[]): boolean {
  console.log(`\n=== P-012 gate: ${label} ===`);
  const result = spawnSync(process.execPath, ["--import", "tsx", readiness, ...args], {
    stdio: "inherit",
    cwd: root,
  });
  if (result.error) {
    console.error(`P-012 gate: ${label} could not start: ${result.error.message}`);
    return false;
  }
  return result.status === 0;
}

const args = process.argv.slice(2);
const liveIdx = args.indexOf("--live");
const liveOrigin = liveIdx === -1 ? null : args[liveIdx + 1];
const skipDb = args.includes("--skip-db");
const skipLive = args.includes("--skip-live");

function main(): void {
  if ((!liveOrigin && !skipLive) || (skipDb && skipLive)) {
    console.error(
      "Usage: node --import tsx scripts/verify-deployment-gate.ts --live <origin> [--skip-db | --skip-live]\n" +
        "  Runs the database readiness checks (--db) and then the live checks (--live),\n" +
        "  with --expect-commit/--expect-package read from the bundle's release.json.\n" +
        "  Exit 0 only when every check passes — a deployment is not signed off until then.",
    );
    process.exit(2);
  }

  const failures: string[] = [];
  if (!skipDb && !runStep("database readiness (--db)", ["--db"])) {
    failures.push("database readiness");
  }
  if (!skipLive && liveOrigin) {
    let expectations: { commit: string; packageId: string };
    try {
      expectations = readReleaseExpectations(path.join(root, "release.json"));
    } catch (err) {
      console.error((err as Error).message);
      process.exit(2);
    }
    if (
      !runStep("live readiness (--live)", [
        "--live",
        liveOrigin,
        "--expect-commit",
        expectations.commit,
        "--expect-package",
        expectations.packageId,
      ])
    ) {
      failures.push("live readiness");
    }
  }

  if (failures.length > 0) {
    console.error(
      `\nP-012 gate: FAIL — ${failures.join(" and ")} failed. The deployment is NOT signed off. ` +
        `Fix the failing checks (see docs/DEPLOY-CPANEL.md §6) and re-run the gate.`,
    );
    process.exit(1);
  }
  console.log("\nP-012 gate: PASS — database and live readiness both passed. Deployment may be signed off.");
}

// Only run when executed directly (node scripts/verify-deployment-gate.ts),
// not when imported for readReleaseExpectations() by the regression tests.
const entryPoint = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entryPoint === fileURLToPath(import.meta.url)) main();
