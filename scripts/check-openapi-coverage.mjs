// Batch C (A-001): CI gate for OpenAPI coverage + structural validity.
//
// Fails (exit 1) when:
//   - any route registered on the live Express app lacks an OpenAPI entry, or
//   - any documented operation is stale (not present in the running app), or
//   - the spec is structurally invalid (missing responses, undeclared path
//     parameters, unresolvable $refs, unknown security schemes, operations
//     without an explicit security declaration).
//
// Route enumeration walks the Express 5 router stack. Express 5 does not
// expose a router layer's mount prefix, so the mount is taken from app.ts:
// every router in apps/api/src/app.ts is mounted at /api/v1 — this script
// asserts that from the source on every run, and fails loudly if a future
// mount uses a different prefix instead of silently mis-counting.
//
// Usage (from the repo root, with the test environment loaded):
//   node --import tsx scripts/check-openapi-coverage.mjs
// (tsx resolves the app's .js import specifiers to the .ts sources.)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SPEC = path.join(repoRoot, "apps/api/openapi.json");

// --- 1. Verify the mount-prefix assumption from source ----------------------
const appSrc = fs.readFileSync(path.join(repoRoot, "apps/api/src/app.ts"), "utf8");
const mounts = new Set();
for (const m of appSrc.matchAll(/app\.use\(\s*"([^"]+)",\s*(\w+Router)\s*\)/g)) mounts.add(m[1]);
for (const m of appSrc.matchAll(/app\.use\(\s*"([^"]+)",\s*\n\s*\(req/g)) mounts.add(m[1]);
if (mounts.size !== 1 || !mounts.has("/api/v1")) {
  console.error(`FATAL: expected every router mount in app.ts to be "/api/v1", found: ${[...mounts].join(", ") || "(none)"}.`);
  console.error("Update this script's route walker before it can trust its enumeration.");
  process.exit(1);
}

// --- 2. Enumerate the live route table ---------------------------------------
const { app } = await import("../apps/api/src/app.js");
const norm = (p) => p.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
function routesOf(stack, prefix, out, depth) {
  for (const layer of stack) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).filter((m) => layer.route.methods[m]);
      const p = typeof layer.route.path === "string" ? layer.route.path : String(layer.route.path);
      for (const m of methods) out.push(`${m.toUpperCase()} ${norm(prefix + p)}`);
    } else if (layer.handle && layer.handle.stack) {
      routesOf(layer.handle.stack, prefix + (depth === 0 ? "/api/v1" : ""), out, depth + 1);
    }
  }
  return out;
}
const router = app.router ?? app._router;
const implemented = [...new Set(routesOf(router.stack, "", [], 0))].sort();
const implementedPaths = new Set(implemented.map((r) => r.split(" ").slice(1).join(" ")));

// --- 3. Load the spec ---------------------------------------------------------
const spec = JSON.parse(fs.readFileSync(SPEC, "utf8"));
const documented = new Set();
for (const [p, ops] of Object.entries(spec.paths || {})) {
  for (const m of Object.keys(ops)) {
    if (m.startsWith("x-")) continue;
    documented.add(`${m.toUpperCase()} ${p}`);
  }
}
const documentedPaths = new Set([...documented].map((r) => r.split(" ").slice(1).join(" ")));

// --- 4. Compare ----------------------------------------------------------------
const missing = implemented.filter((r) => !documented.has(r));
const stale = [...documented].filter((d) => !implemented.includes(d));
const failures = [];
for (const r of missing) failures.push(`MISSING from OpenAPI: ${r}`);
for (const r of stale) failures.push(`STALE in OpenAPI (not in the running app): ${r}`);

// --- 5. Structural validation --------------------------------------------------
if (spec.openapi !== "3.1.0") failures.push(`spec.openapi must be "3.1.0", found ${JSON.stringify(spec.openapi)}`);
if (!spec.info?.title || !spec.info?.version) failures.push("spec.info.title and spec.info.version are required");
const schemes = new Set(Object.keys(spec.components?.securitySchemes || {}));
function resolveRef(ref, seen = new Set()) {
  if (!ref.startsWith("#/")) return `external $ref not allowed: ${ref}`;
  if (seen.has(ref)) return `circular $ref: ${ref}`;
  seen.add(ref);
  const parts = ref.slice(2).split("/").map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  let node = spec;
  for (const part of parts) {
    if (node === undefined || node === null || typeof node !== "object" || !(part in node)) return `unresolvable $ref: ${ref}`;
    node = node[part];
  }
  return null;
}
function walkRefs(node, at) {
  if (Array.isArray(node)) node.forEach((v, i) => walkRefs(v, `${at}[${i}]`));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "$ref" && typeof v === "string") {
        const err = resolveRef(v);
        if (err) failures.push(`${at}: ${err}`);
      } else walkRefs(v, `${at}.${k}`);
    }
  }
}
walkRefs(spec, "spec");
for (const [p, ops] of Object.entries(spec.paths || {})) {
  for (const [method, op] of Object.entries(ops)) {
    if (method.startsWith("x-")) continue;
    const at = `${method.toUpperCase()} ${p}`;
    if (!op.responses || Object.keys(op.responses).length === 0) failures.push(`${at}: no responses`);
    else if (!Object.keys(op.responses).some((s) => s.startsWith("2") || s.startsWith("3"))) failures.push(`${at}: no 2xx/3xx response`);
    if (!("security" in op)) failures.push(`${at}: no explicit security declaration (use [] for public operations)`);
    else for (const entry of op.security || []) for (const name of Object.keys(entry)) if (!schemes.has(name)) failures.push(`${at}: unknown security scheme "${name}"`);
    const declared = new Set((op.parameters || []).filter((x) => x.in === "path").map((x) => x.name));
    for (const m of p.matchAll(/\{([A-Za-z0-9_]+)\}/g)) if (!declared.has(m[1])) failures.push(`${at}: path parameter {${m[1]}} has no parameter entry`);
    if (!op.summary) failures.push(`${at}: no summary`);
    if (op["x-visibility"] === undefined) failures.push(`${at}: no x-visibility classification (public|authenticated|gateway-callback|internal-only)`);
  }
}

// --- 6. Report ------------------------------------------------------------------
const covered = implemented.filter((r) => documented.has(r)).length;
const opCoverage = implemented.length ? (covered / implemented.length) * 100 : 100;
console.log(`Implemented routes: ${implemented.length} ops / ${implementedPaths.size} paths`);
console.log(`Documented routes:  ${documented.size} ops / ${documentedPaths.size} paths`);
console.log(`Coverage: ${opCoverage.toFixed(1)}% of implemented operations documented`);
console.log(`Missing from spec: ${missing.length}; stale in spec: ${stale.length}; structural failures: ${failures.length - missing.length - stale.length}`);
if (failures.length) {
  console.error("\nOpenAPI coverage/validation FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("OpenAPI coverage + structural validation: PASS");
