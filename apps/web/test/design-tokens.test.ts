import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Stage 4 design-system audit: the brand greens must resolve through
 * tokens (--du-green-700 #1f7d5e, --du-green-800 #175f48), never as bare
 * hex in component CSS — a token change otherwise silently misses the
 * base buttons and status treatments. tokens.css itself defines the
 * values (and the file header documents them); service-icons.css and
 * ui/kit.css keep deliberate local palettes (icon tints, category
 * tints) and are outside this rule.
 *
 * The fallback in var(--du-green-700, #1f7d5e) keeps the rendered
 * value identical, so this is a hygiene guard, not a visual change.
 */
const SRC = path.resolve("apps/web/src");
const GUARDED = [
  "style.css",
  "owner-console.css",
  "public-usability.css",
  "workspace-usability.css",
  "du-shell.css",
  "public-shell.css",
  "public-portal.css",
  "du-workspace.css",
];

test("design tokens: no bare brand-green hex in guarded component CSS", () => {
  const tokens = fs.readFileSync(path.join(SRC, "ui/tokens.css"), "utf8");
  assert.match(tokens, /--du-green-700:\s*#1f7d5e/);
  assert.match(tokens, /--du-green-800:\s*#175f48/);
  for (const file of GUARDED) {
    const text = fs.readFileSync(path.join(SRC, file), "utf8");
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const hex of ["#1f7d5e", "#175f48"]) {
      // A bare hex is one not inside a var(...) fallback.
      const bare = code
        .split("\n")
        .filter((line) => line.includes(hex) && !line.includes("var(--"));
      assert.deepEqual(
        bare,
        [],
        `${file} has bare ${hex} (resolve through --du-green-700/--du-green-800): ${bare.join(" | ")}`,
      );
    }
  }
});
