import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * F-010: EN-mode translation gaps. `t()` falls back to the source text
 * when a Bengali-source string has no English dictionary entry and no
 * "BN / EN" split — so a Bengali-only `t()` literal renders Bengali in
 * English mode. The audit snapshot (53 vs 230 keys) is stale: the live
 * dictionaries now cover everything except language-name labels, but
 * nothing stopped a new gap from landing. This guard replays `t()`'s own
 * EN-mode resolution over every `t("...")` / `tx("...")` literal in
 * apps/web/src and fails on any literal that would render Bengali in
 * English mode.
 *
 * Allowlist: language names are shown in their own script on purpose
 * (e.g. the "বাংলা" delivery-language option reads "বাংলা" in both
 * modes — the EN dictionary now maps it to "Bangla" instead, so even
 * that case is covered; the allowlist exists only for future labels
 * that must stay in-script).
 */
const repoRoot = path.resolve("apps/web", "..", "..");
const srcDir = path.join(repoRoot, "apps/web/src");

const en = {
  ...JSON.parse(fs.readFileSync(path.join(srcDir, "locales/workspace.en.json"), "utf8")),
  ...JSON.parse(fs.readFileSync(path.join(srcDir, "locales/public.en.json"), "utf8")),
} as Record<string, string>;

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const BENGALI = /[\u0980-\u09ff]/;

function rendersEnglish(key: string): boolean {
  const k = normalize(key);
  if (Object.hasOwn(en, k)) return true;
  const parts = k.split(" / ");
  if (parts.length === 2) {
    const bangla = parts.filter((part) => BENGALI.test(part));
    const english = parts.filter((part) => !BENGALI.test(part) && /[a-z]/i.test(part));
    if (bangla.length === 1 && english.length === 1) return true;
  }
  return false;
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(p));
    else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) out.push(p);
  }
  return out;
}

test("F-010: every Bengali-source t()/tx() literal renders English in EN mode", () => {
  const gaps: string[] = [];
  for (const file of walkFiles(srcDir)) {
    const source = fs.readFileSync(file, "utf8");
    // String literals only — dynamic t() arguments are covered by the
    // dictionary entries they resolve to at runtime.
    for (const m of source.matchAll(/\b[tx]t?\("((?:[^"\\]|\\.)*)"\)/g)) {
      const literal = m[1];
      if (!BENGALI.test(literal)) continue;
      if (!rendersEnglish(literal)) {
        gaps.push(`${path.relative(repoRoot, file)}: t("${literal.slice(0, 80)}")`);
      }
    }
  }
  assert.deepEqual(gaps, [], `Bengali-only t() literals with no EN rendering:\n${gaps.join("\n")}`);
});

test("F-010: the delivery-language option renders in English mode", () => {
  assert.equal(en["বাংলা"], "Bangla");
});
