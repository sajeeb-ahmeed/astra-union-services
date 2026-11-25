import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * P-009: the cPanel/web bundle shipped decode sources and server-only data.
 * - `.b64` files are decode sources for clean GitHub checkouts
 *   (scripts/decode-assets.mjs); Vite copied public/ verbatim into dist,
 *   so the favicon/font .b64 duplicates shipped alongside the decoded
 *   binaries. A Vite closeBundle plugin (apps/web/vite.config.ts) prunes
 *   them from the emitted bundle; scripts/package-cpanel.mjs excludes
 *   *.b64 from the cPanel bundle too.
 * - `data/geo/wards.json` (5.9 MB) and `unions.json` (731 kB) are
 *   server-only: the deploy-time geography loader reads them, no web
 *   source imports them, and they must never land in the browser bundle.
 * - Migration 054 (1.18 MB SQL) must still ship in the cPanel bundle —
 *   the deploy-time migration runner needs it; it is not part of the web
 *   bundle and nothing here drops it.
 *
 * Runs in test:web, after scripts/test-web.ts builds the production
 * bundle, so dist/ here is the freshly built artifact.
 */
const repoRoot = path.resolve("apps/web", "..", "..");
const dist = path.join(repoRoot, "apps/web/dist");

function walkFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(p));
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

test("P-009: no .b64 decode sources in the built web bundle", () => {
  const files = walkFiles(dist);
  assert.ok(files.length > 0, "apps/web/dist must exist (test-web.ts builds it first)");
  const b64 = files.filter((f) => f.endsWith(".b64"));
  assert.deepEqual(b64, [], `decode sources shipped in the web bundle: ${b64.join(", ")}`);
});

test("P-009: decoded binaries still ship (prune removed only the .b64)", () => {
  assert.ok(fs.existsSync(path.join(dist, "favicon-512.png")), "favicon-512.png missing from dist");
  assert.ok(fs.existsSync(path.join(dist, "favicon-32.png")), "favicon-32.png missing from dist");
  assert.ok(
    fs.existsSync(path.join(dist, "fonts", "noto-sans-bengali-bengali-400-normal.woff2")),
    "400 woff2 missing from dist/fonts",
  );
});

test("P-009: geography data is server-only — never in the web bundle", () => {
  // The source files exist for the deploy-time loader…
  assert.ok(fs.existsSync(path.join(repoRoot, "data/geo/wards.json")), "data/geo/wards.json missing");
  assert.ok(fs.existsSync(path.join(repoRoot, "data/geo/unions.json")), "data/geo/unions.json missing");
  // …but no web source imports them and none of their bytes ship to browsers.
  const files = walkFiles(dist);
  const leaked = files.filter((f) => /wards|unions/.test(path.basename(f)));
  assert.deepEqual(leaked, [], `server-only geography data in the web bundle: ${leaked.join(", ")}`);
  const webSrc = walkFiles(path.join(repoRoot, "apps/web/src"));
  const importing = webSrc.filter((f) => /wards\.json|unions\.json|data\/geo/.test(fs.readFileSync(f, "utf-8")));
  assert.deepEqual(importing, [], `web source imports geography data: ${importing.join(", ")}`);
});

test("P-009: the cPanel packager excludes *.b64 decode sources", () => {
  // The full packager copies ~170 MB and is verified by running it (see
  // the Stage 3 report); this pins the exclusion so a future edit cannot
  // silently re-include the ~2.2 MB of .b64 dead weight.
  const packager = fs.readFileSync(path.join(repoRoot, "scripts/package-cpanel.mjs"), "utf-8");
  assert.match(packager, /base\.endsWith\("\.b64"\)\) return false/, "package-cpanel.mjs must exclude *.b64");
});
