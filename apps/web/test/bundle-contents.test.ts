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

/**
 * B-003 / F-015: bundle budget. The GeographyFields chunk was 623 KB
 * because it carried every historical schema version
 * (expanded-v1-schemas.json, 512 KB on disk) through the shared-schemas
 * root entry. The web now imports the /web entry (current schemas only)
 * and loads pinned legacy versions on demand from the /legacy entry, so
 * no JS chunk may exceed 500 KB and the entry chunk stays at or under
 * 400 KB. The budget is measured on the uncompressed .js files Vite
 * emits (the .br/.gz twins are delivery compression, not bundle size).
 */
test("B-003: no JS chunk exceeds 500 kB; the entry chunk stays at or under 400 kB", () => {
  const files = walkFiles(dist).filter((f) => f.endsWith(".js"));
  assert.ok(files.length > 0, "no .js chunks in apps/web/dist");
  const oversize = files
    .map((f) => ({ name: path.basename(f), size: fs.statSync(f).size }))
    .filter(({ size }) => size > 500 * 1024);
  assert.deepEqual(
    oversize,
    [],
    `JS chunks over the 500 kB budget: ${oversize.map((o) => `${o.name} (${o.size} B)`).join(", ")}`,
  );
  const entry = files
    .map((f) => ({ name: path.basename(f), size: fs.statSync(f).size }))
    .find(({ name }) => name.startsWith("index-"));
  assert.ok(entry, "entry chunk index-*.js missing from dist");
  assert.ok(
    entry.size <= 400 * 1024,
    `entry chunk ${entry.name} is ${entry.size} B, over the 400 kB budget`,
  );
});

test("B-003: the legacy schemas ship only as a lazy chunk, never in the initial bundle", () => {
  // The dynamic import in PinnedSchema (WorkspaceApp) must emit a
  // separate chunk: that is what keeps the 512 KB historical-schema JSON
  // out of first paint. The budget test above enforces the outcome; this
  // one names the mechanism — a legacy chunk exists, and the chunk that
  // used to carry the v1 blob (GeographyFields, 623 KB before the split)
  // is under the budget.
  const js = walkFiles(dist).filter((f) => f.endsWith(".js"));
  const legacy = js.filter((f) => /legacy/i.test(path.basename(f)));
  assert.ok(legacy.length > 0, "no lazy legacy chunk in dist — the split did not happen");
  const geo = js.find((f) => path.basename(f).startsWith("GeographyFields-"));
  assert.ok(geo, "GeographyFields chunk missing from dist");
  assert.ok(
    fs.statSync(geo).size <= 500 * 1024,
    `GeographyFields chunk is ${fs.statSync(geo).size} B, still over the 500 kB budget`,
  );
});

/**
 * B-004: the service catalog JSON has exactly one module importer.
 *
 * Six modules used to import public-service-catalog.json directly with
 * `with { type: "json" }`. Vite's vite:build-import-analysis strips
 * import attributes from the static imports of any file that contains a
 * dynamic import(), so PublicHome.tsx and PublicPortal.tsx reached
 * Rollup with no attributes while the other four kept theirs, and every
 * production build warned INCONSISTENT_IMPORT_ATTRIBUTES. The catalog
 * now flows through apps/web/src/service-catalog.ts — the only module
 * that imports the JSON (it contains no dynamic import, so its
 * attributes survive) — and every other consumer imports the wrapper.
 * This pins that invariant: a second direct JSON importer re-opens the
 * warning. The prerender script reads the same file via fs (not a
 * module import) and is out of scope here.
 */
test("B-004: public-service-catalog.json has exactly one module importer (service-catalog.ts)", () => {
  const src = walkFiles(path.join(repoRoot, "apps/web/src")).filter((f) => /\.(ts|tsx)$/.test(f));
  const testFiles = walkFiles(path.join(repoRoot, "apps/web/test")).filter((f) => /\.test\.ts$/.test(f));
  const direct = [...src, ...testFiles].filter((f) =>
    /import\s+\w+\s+from\s+["'][^"']*public-service-catalog\.json["']/.test(fs.readFileSync(f, "utf-8")),
  );
  assert.deepEqual(
    direct.map((f) => path.relative(repoRoot, f).split(path.sep).join("/")),
    ["apps/web/src/service-catalog.ts"],
    `direct importers of public-service-catalog.json (must be only service-catalog.ts): ${direct.join(", ")}`,
  );
  const wrapper = fs.readFileSync(path.join(repoRoot, "apps/web/src/service-catalog.ts"), "utf-8");
  assert.match(
    wrapper,
    /from\s+"\.\/public-service-catalog\.json"\s+with\s+\{\s*type:\s*"json"\s*\}/,
    "service-catalog.ts must import the JSON with { type: \"json\" } (tsc NodeNext requires it)",
  );
});
