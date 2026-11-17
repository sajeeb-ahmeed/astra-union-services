/**
 * Assemble the slim cPanel deployment bundle in dist-cpanel/.
 *
 * The bundle contains only what the production server needs at runtime:
 *   - app.js (Passenger entry) + package.json / package-lock.json
 *   - apps/api/src (TypeScript, executed via tsx — there is no build step
 *     for the API), apps/web/dist (pre-built frontend) + workspace manifests
 *   - packages/ sources imported by the API at runtime
 *   - db/migrations + data/geo (needed by the deploy-time migration runner)
 *   - the cPanel deploy scripts (bootstrap/migrate/initialize + geography),
 *     the backup tooling, and the attachment-scanner worker sources
 *   - .env.cpanel.example + docs/DEPLOY-CPANEL.md (the operator runbook)
 *   - node_modules: the FULL install is copied. It measures ~96 MB, far
 *     under the 500 MB budget, and the server executes TypeScript at
 *     runtime, so tsx + typescript + esbuild are runtime-critical;
 *     pruning dev-only trees (vite, prettier, …) would save ~15 MB at the
 *     cost of a fragile hand-maintained list. Full copy wins.
 *
 * Excluded (per the cPanel track spec): execution/, docs/ (except the
 * runbook), handoff/, every test directory and *.test.* file,
 * scripts/verify-hosted-*, *.ps1, apps/api/openapi.json, .pgdata,
 * .runtime, .git, logs, and the web sources (only the built dist ships).
 *
 * Usage: node scripts/package-cpanel.mjs   (run from the repository root)
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist-cpanel");
if (!out.startsWith(root + path.sep)) throw Error("Bundle path escapes the repository root.");

// 0. Binary assets travel through GitHub as .b64 text (see
// scripts/decode-assets.mjs). In a clean GitHub checkout the raw binaries
// are absent, and the bundle copies apps/api/assets verbatim — so decode
// first whenever a .b64 sibling has no materialised binary. Local
// checkouts hold the real binaries, so this is a no-op there.
(function decodeMissingBinaries() {
  const assetDirs = [
    path.join(root, "apps", "api", "assets"),
    path.join(root, "apps", "web", "src", "assets"),
    path.join(root, "apps", "web", "public"),
  ];
  let missing = false;
  function scan(dir) {
    if (missing || !fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(p);
      else if (entry.isFile() && entry.name.endsWith(".b64") && !fs.existsSync(p.slice(0, -".b64".length))) missing = true;
    }
  }
  for (const dir of assetDirs) scan(dir);
  if (missing) {
    console.log("Binary assets missing (clean GitHub checkout) — decoding .b64 assets first…");
    execFileSync("node", [path.join(root, "scripts", "decode-assets.mjs")], { cwd: root, stdio: "inherit" });
  }
})();

// 1. The web bundle must exist (the API serves it same-origin in production).
const manifest = path.join(root, "apps/web/dist/.vite/manifest.json");
if (!fs.existsSync(manifest)) {
  console.log("apps/web/dist missing — running npm run build first…");
  execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const EXCLUDED_SEGMENTS = new Set(["test", "tests", "__tests__", "execution", ".git", ".pgdata", ".runtime", "handoff"]);
function keep(rel) {
  const parts = rel.split(path.sep);
  if (parts.some((p) => EXCLUDED_SEGMENTS.has(p))) return false;
  const base = parts[parts.length - 1];
  if (/\.test\.[a-z]+$/.test(base)) return false;
  if (/^test-support\./.test(base)) return false;
  if (base.startsWith("verify-hosted-")) return false;
  if (base.endsWith(".ps1") || base.endsWith(".log")) return false;
  if (rel === path.join("apps", "api", "openapi.json")) return false;
  // Manual end-to-end flow script with demo credentials baked in; the
  // scanner worker (run.ts) never imports it. Not production content.
  if (rel === path.join("scripts", "scanner", "real-flow.ts")) return false;
  return true;
}
function copy(rel, filter = keep) {
  const src = path.join(root, rel);
  if (!fs.existsSync(src)) return;
  fs.cpSync(src, path.join(out, rel), {
    recursive: true,
    filter: (s) => filter(path.relative(root, s)),
  });
}

// 2. Runtime sources and manifests.
for (const file of ["package.json", "package-lock.json", "app.js", "tsconfig.json", ".env.cpanel.example"])
  copy(file);
// API sources (tests excluded by filter), web manifest + built dist only.
// Phase Y: certificate template assets (government emblem + per-office seal
// artwork) are runtime files — official-mode documents inline them.
copy(path.join("apps", "api", "src"));
copy(path.join("apps", "api", "assets"));
copy(path.join("apps", "api", "package.json"));
copy(path.join("apps", "web", "package.json"));
copy(path.join("apps", "web", "dist"));
copy("packages");
copy("db");
copy("data");
// Deploy + operations scripts only (not the dev/test tooling).
for (const file of [
  path.join("scripts", "bootstrap-cpanel.ts"),
  path.join("scripts", "migrate-cpanel.ts"),
  path.join("scripts", "initialize.ts"),
  path.join("scripts", "geography-data.ts"),
])
  copy(file);
copy(path.join("scripts", "backup"));
copy(path.join("scripts", "scanner"));
// The operator runbook travels with the bundle.
fs.mkdirSync(path.join(out, "docs"), { recursive: true });
fs.copyFileSync(path.join(root, "docs", "DEPLOY-CPANEL.md"), path.join(out, "docs", "DEPLOY-CPANEL.md"));

// 3. Full production-capable node_modules (see header for the rationale).
// dereference:false keeps the relative symlinks (.bin/*, @astra/*) intact —
// dereferencing them produces absolute paths into the build machine's tree,
// which break the bundle's .bin shims after the zip round-trip (BUNDLE-02).
fs.cpSync(path.join(root, "node_modules"), path.join(out, "node_modules"), {
  recursive: true,
  dereference: false,
  filter: (s) => !s.includes(`${path.sep}.cache${path.sep}`) && !s.endsWith(`${path.sep}.cache`),
});

// 4. Report.
let files = 0;
let bytes = 0;
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.isFile()) {
      files += 1;
      bytes += fs.statSync(p).size;
    }
  }
})(out);
console.log(`dist-cpanel assembled: ${files} files, ${(bytes / 1048576).toFixed(1)} MiB (${bytes} bytes).`);
console.log("Excluded: execution/, docs/ (except DEPLOY-CPANEL.md), handoff/, tests, verify-hosted-*, *.ps1, openapi.json, .pgdata, web sources.");
