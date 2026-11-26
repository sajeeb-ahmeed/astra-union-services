// A-019: the repo has two app.js entry points and neither is a stray stub.
// The repo-root app.js is the live lsnode entry point (tsx + dynamic import
// of apps/api/src/server.ts); dist-cpanel/app.js is the packaged variant
// (pre-compiled apps/api/dist/server.js). This test pins that chain so a
// future cleanup cannot delete the live entry point by mistake.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

test("A-019: repo-root app.js is the lsnode entry point for the real server", () => {
  const entry = fs.readFileSync(path.join(root, "app.js"), "utf8");
  assert.match(entry, /apps\/api\/src\/server\.ts/);
  assert.match(entry, /tsx\/esm\/api/);
});

test("A-019: dist-cpanel bundle entry loads the pre-compiled server", () => {
  const packaged = fs.readFileSync(
    path.join(root, "dist-cpanel", "app.js"),
    "utf8",
  );
  assert.match(packaged, /apps\/api\/dist\/server\.js/);
  assert.ok(
    fs.existsSync(path.join(root, "scripts", "package-cpanel.mjs")),
    "package-cpanel.mjs assembles dist-cpanel/",
  );
});
