import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * FULL-UIUX-01 (B16/D33 guard): rendered UI must never carry raw system
 * language — "(Phase N)" labels, the "স্যান্ডবক্স"/"Sandbox" environment
 * word as user copy, or the untranslated "Certificate assets" tab label.
 * This scans the web source with comments stripped: the tokens may live in
 * code comments, never in a string that can reach the screen.
 */
const SRC = path.join(process.cwd(), "apps/web/src");
const FORBIDDEN: Array<[RegExp, string]> = [
  [/\(Phase\s+\d+\)/, "(Phase N) label"],
  [/স্যান্ডবক্স/, "স্যান্ডবক্স as user copy"],
  [/"Sandbox"|'Sandbox'/, '"Sandbox" as user copy'],
  [/Certificate assets/, '"Certificate assets" label'],
];

function stripComments(source: string): string {
  let out = "";
  let i = 0;
  let state: "code" | "block" | "line" | "single" | "double" | "template" =
    "code";
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1] ?? "";
    if (state === "code") {
      if (ch === "/" && next === "*") {
        state = "block";
        i += 2;
        continue;
      }
      if (ch === "/" && next === "/") {
        state = "line";
        i += 2;
        continue;
      }
      if (ch === "'") state = "single";
      else if (ch === '"') state = "double";
      else if (ch === "`") state = "template";
      out += ch;
      i += 1;
      continue;
    }
    if (state === "block") {
      if (ch === "*" && next === "/") {
        state = "code";
        i += 2;
        continue;
      }
      if (ch === "\n") out += "\n";
      i += 1;
      continue;
    }
    if (state === "line") {
      if (ch === "\n") {
        state = "code";
        out += "\n";
      }
      i += 1;
      continue;
    }
    // string states: copy through, honouring escapes
    out += ch;
    if (ch === "\\") {
      out += next;
      i += 2;
      continue;
    }
    if (
      (state === "single" && ch === "'") ||
      (state === "double" && ch === '"') ||
      (state === "template" && ch === "`")
    )
      state = "code";
    i += 1;
  }
  return out;
}

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(entry.name)) yield full;
  }
}

test("ui language guard: no raw system language in rendered strings", () => {
  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    const stripped = stripComments(fs.readFileSync(file, "utf8"));
    for (const [pattern, label] of FORBIDDEN) {
      if (pattern.test(stripped))
        offenders.push(`${path.relative(SRC, file)}: ${label}`);
    }
  }
  assert.deepEqual(offenders, []);
});
