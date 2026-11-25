import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { app } from "../src/app.js";
import { pool } from "../src/db.js";

/**
 * Batch C / A-002: release traceability.
 * - GET /api/v1/health reports the non-sensitive release subset publicly.
 * - GET /api/v1/admin/release reports the detailed view (full migration list
 *   + packaged asset manifest) to office admins only.
 * - Neither endpoint leaks secrets or environment values.
 */
type Session = { cookie: string; csrf: string; user: any };
const run = randomUUID().slice(0, 8);
const password = "Release-Test-123!";
let server: ReturnType<typeof app.listen>, base: string;
let adminSession: Session, citizenSession: Session;

async function req(method: string, path: string, data?: unknown, session?: Session) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      ...(session ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const type = response.headers.get("content-type") ?? "";
  return { status: response.status, body: type.includes("json") ? await response.json() : null };
}
async function login(email: string, p = password): Promise<Session> {
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: p }),
  });
  const json = await r.json();
  assert.equal(r.status, 200, JSON.stringify(json));
  const cookieHeader = r.headers.get("set-cookie");
  assert.ok(cookieHeader, "login must return a session cookie");
  return { cookie: cookieHeader.split(";")[0], csrf: json.csrfToken, user: json.user };
}

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  const owner = await login(process.env.OWNER_EMAIL!, process.env.OWNER_PASSWORD!);
  const slug = `release-${run}`;
  const created = await req(
    "POST",
    "/owner/tenants",
    {
      slug,
      nameBn: "পরীক্ষা অফিস",
      nameEn: `Release test office ${slug}`,
      division: "Test Division",
      district: "Test District",
      upazila: "Test Upazila",
      officeType: "UNION",
      adminEmail: `admin@${slug}.test`,
      adminName: "Release Test Admin",
      adminPassword: password,
    },
    owner,
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  adminSession = await login(`admin@${slug}.test`);
  const email = `citizen-${slug}@synthetic.test`;
  const signup = await req("POST", "/auth/signup", {
    email,
    password,
    displayName: "Release Test Citizen",
    tenantId: created.body.id,
    nameBn: "পরীক্ষা নাগরিক",
    nameEn: "Release Test Citizen",
    dateOfBirth: "1998-02-03",
    addressBn: "পরীক্ষা ঠিকানা",
    addressEn: "Test address only",
    syntheticReference: `REF-${slug}`,
  });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  citizenSession = await login(email);
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

function latestMigrationFile(): string {
  return fs
    .readdirSync(path.join("db", "migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort()
    .at(-1)!;
}

test("health reports the non-sensitive release subset publicly", async () => {
  const r = await req("GET", "/health");
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "ok");
  const release = r.body.release;
  assert.ok(release && typeof release === "object", "health must carry a release object");
  for (const key of ["version", "commit", "builtAt", "packageId", "startedAt", "migrationVersion"])
    assert.ok(key in release, `release.${key} must be present`);
  assert.equal(release.version, "1.0.0");
  // A plain source checkout has no release.json: commit/package are null,
  // never invented. A packaged bundle reports the real 40-hex commit.
  assert.ok(release.commit === null || /^[a-f0-9]{40}$/.test(release.commit), `unexpected commit value: ${release.commit}`);
  assert.ok(release.packageId === null || release.packageId.startsWith("digitalunion-"), `unexpected packageId: ${release.packageId}`);
  assert.equal(release.migrationVersion, latestMigrationFile());
  assert.ok(!Number.isNaN(Date.parse(release.startedAt)), "startedAt must be an ISO timestamp");
  const text = JSON.stringify(r.body);
  for (const secret of [process.env.MFA_ENCRYPTION_KEY, process.env.CITIZEN_DATA_KEY, process.env.MERCHANT_SECRET_KEY, process.env.IDENTIFIER_SECRET, process.env.OWNER_PASSWORD, process.env.DATABASE_URL])
    if (secret) assert.equal(text.includes(secret), false, "health must not leak a secret value");
});

test("admin release endpoint requires a session", async () => {
  const r = await req("GET", "/admin/release");
  assert.equal(r.status, 401);
});

test("admin release endpoint refuses non-admin roles", async () => {
  const r = await req("GET", "/admin/release", undefined, citizenSession);
  assert.equal(r.status, 403);
});

test("admin release endpoint reports migrations and the asset manifest", async () => {
  const r = await req("GET", "/admin/release", undefined, adminSession);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.release.version, "1.0.0");
  assert.equal(r.body.release.migrationVersion, latestMigrationFile());
  assert.ok(Array.isArray(r.body.migrations) && r.body.migrations.length > 0, "migrations must be a non-empty list");
  assert.equal(r.body.migrations.at(-1).name, latestMigrationFile());
  for (const m of r.body.migrations) {
    assert.ok(typeof m.name === "string" && m.name.endsWith(".sql"));
    assert.ok(typeof m.appliedAt === "string");
  }
  assert.ok(Array.isArray(r.body.assets), "assets must be an array (empty in a plain checkout, populated in a bundle)");
  for (const a of r.body.assets) {
    assert.ok(typeof a.path === "string" && typeof a.sha256 === "string" && /^[a-f0-9]{64}$/.test(a.sha256));
  }
  assert.ok(typeof r.body.mode === "string");
  assert.ok(typeof r.body.nodeVersion === "string");
  assert.ok(typeof r.body.uptimeSeconds === "number");
  const text = JSON.stringify(r.body);
  for (const secret of [process.env.MFA_ENCRYPTION_KEY, process.env.CITIZEN_DATA_KEY, process.env.MERCHANT_SECRET_KEY, process.env.IDENTIFIER_SECRET, process.env.OWNER_PASSWORD, process.env.DATABASE_URL])
    if (secret) assert.equal(text.includes(secret), false, "admin release must not leak a secret value");
});

test("health and admin release agree on the migration version", async () => {
  const health = await req("GET", "/health");
  const detail = await req("GET", "/admin/release", undefined, adminSession);
  assert.equal(health.body.release.migrationVersion, detail.body.release.migrationVersion);
  assert.equal(health.body.release.commit, detail.body.release.commit);
  assert.equal(health.body.release.packageId, detail.body.release.packageId);
});
