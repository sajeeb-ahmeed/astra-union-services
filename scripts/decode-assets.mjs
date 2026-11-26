/**
 * Materialise binary assets that travel through GitHub as base64 text.
 *
 * The GitHub snapshot-push transport is UTF-8 text only, so the repo's 20
 * binary files (brand artwork, favicons, self-hosted fonts, certificate
 * emblem/seal PNGs) exist on GitHub solely as `<path>.b64` siblings. A clean
 * GitHub checkout therefore has NO raw binaries and cannot build
 * (`Could not resolve "./assets/brand/emblem.webp"`). Local checkouts hold
 * the real binaries, which masked this — CI went red on every run from
 * PR #46 until this script was wired into the build.
 *
 * Behaviour: walk the repository (skipping node_modules and .git) for
 * `*.b64` files; decode each to its sibling path without the `.b64`
 * suffix. Idempotent: when the sibling already exists with an identical
 * sha256, it is left untouched (so local checkouts, where the real
 * binaries are committed, see zero changes). Exits non-zero on any
 * malformed .b64 file or write failure.
 *
 * Wired in via the root `prebuild` npm script (covers `npm run build` in
 * CI's verify job and in the Dockerfile, which both invoke the root build
 * after a full checkout/copy) and invoked by scripts/package-cpanel.mjs
 * when it detects missing binaries.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// B-001: dist-cpanel/ is a regenerated deploy snapshot (scripts/
// package-cpanel.mjs wipes and re-copies it from the source assets), so
// decoding into it only dirties the working tree on fresh checkouts.
// The build never reads dist-cpanel/.
const SKIP_DIRS = new Set(["node_modules", ".git", "dist-cpanel"]);

let decoded = 0;
let skipped = 0;
let failed = 0;

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function decodeOne(b64Path) {
  const target = b64Path.slice(0, -".b64".length);
  const raw = fs.readFileSync(b64Path, "utf8");
  const cleaned = raw.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned) || cleaned.length % 4 !== 0) {
    console.error(`decode-assets: invalid base64 in ${path.relative(root, b64Path)}`);
    failed += 1;
    return;
  }
  const content = Buffer.from(cleaned, "base64");
  if (fs.existsSync(target) && sha256(fs.readFileSync(target)) === sha256(content)) {
    skipped += 1;
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  decoded += 1;
}

(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
    } else if (entry.isFile() && entry.name.endsWith(".b64")) {
      try {
        decodeOne(path.join(dir, entry.name));
      } catch (err) {
        console.error(`decode-assets: failed on ${path.join(dir, entry.name)}: ${err.message}`);
        failed += 1;
      }
    }
  }
})(root);

console.log(`decode-assets: decoded ${decoded}, skipped ${skipped} (already identical).`);
if (failed > 0) {
  console.error(`decode-assets: ${failed} file(s) failed to decode.`);
  process.exit(1);
}
