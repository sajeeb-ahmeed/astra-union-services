import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";
import { BRANDING_DEFAULTS } from "../src/billing.js";

/**
 * Phase 3D: owner-editable platform branding (billing plan §3.9) + the settings
 * change history behind the dashboard's Audit section.
 *
 * Branding lives in platform_settings with the built-in defaults as the fallback,
 * so the suite first clears any branding keys (deterministic default state) and
 * clears them again afterwards — the append-only history rows stay, as an audit
 * trail should. The payer setting is never touched here.
 */
type Session = { cookie: string; csrf: string; user: any };
const run = randomUUID().slice(0, 8);
const password = "Phase3d-Synthetic-123!";
const admin = new pg.Pool({ connectionString: adminConnectionString });
let server: ReturnType<typeof app.listen>, base: string;
let owner: Session;
let officeAdmin: Session;

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
  const cookieHeader = r.headers.get(["set", "cookie"].join("-"));
  assert.ok(cookieHeader, "login must return a session cookie");
  return { cookie: cookieHeader.split(";")[0], csrf: json.csrfToken, user: json.user };
}
async function clearBrandingKeys() {
  await admin.query(
    "DELETE FROM platform_settings WHERE key IN ('platform_name','platform_tagline_bn','platform_tagline_en')",
  );
}

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  await clearBrandingKeys();
  owner = await login("owner@astra.demo.test", "Demo-Phase1!");
  const slug = `brand-${run}`;
  const created = await req(
    "POST",
    "/owner/tenants",
    {
      slug,
      nameBn: "পরীক্ষা অফিস",
      nameEn: `Phase 3D test office ${slug}`,
      division: "Test Division",
      district: "Test District",
      upazila: "Test Upazila",
      officeType: "UNION",
      adminEmail: `admin@${slug}.test`,
      adminName: "Phase 3D Admin",
      adminPassword: password,
    },
    owner,
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  officeAdmin = await login(`admin@${slug}.test`);
});
after(async () => {
  await clearBrandingKeys();
  await closePdfBrowser();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await admin.end();
});

test("Phase 3D: public branding falls back to the built-in defaults and needs no sign-in", async () => {
  const r = await req("GET", "/branding");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { ...BRANDING_DEFAULTS });
  const ownerView = await req("GET", "/owner/branding", undefined, owner);
  assert.equal(ownerView.status, 200, JSON.stringify(ownerView.body));
  assert.deepEqual(ownerView.body, { ...BRANDING_DEFAULTS });
});

test("Phase 3D: branding writes and the settings history are owner-only", async () => {
  assert.equal((await req("GET", "/owner/branding", undefined, officeAdmin)).status, 403);
  assert.equal((await req("GET", "/owner/setting-changes", undefined, officeAdmin)).status, 403);
  assert.equal(
    (
      await req(
        "PUT",
        "/owner/branding",
        { ...BRANDING_DEFAULTS, name: "Nope", reason: "non-owner attempt" },
        officeAdmin,
      )
    ).status,
    403,
  );
  assert.equal((await req("GET", "/owner/branding")).status, 401);
});

test("Phase 3D: branding validation — short reason, blank fields and extra fields are 422", async () => {
  const base3 = { name: "Valid Name", taglineBn: "স্লোগান", taglineEn: "Tagline" };
  assert.equal(
    (await req("PUT", "/owner/branding", { ...base3, reason: "short" }, owner)).status,
    422,
  );
  assert.equal(
    (await req("PUT", "/owner/branding", { ...base3, name: "  ", reason: "blank name attempt" }, owner)).status,
    422,
  );
  assert.equal(
    (
      await req(
        "PUT",
        "/owner/branding",
        { ...base3, reason: "extra field attempt", logo: "x" },
        owner,
      )
    ).status,
    422,
  );
  // Nothing was written by the rejected attempts.
  const after = await req("GET", "/branding");
  assert.deepEqual(after.body, { ...BRANDING_DEFAULTS });
});

test("Phase 3D: the owner replaces the branding; shells read it back and the history records each changed key", async () => {
  const next = {
    name: `TestUnion ${run}`,
    taglineBn: "পরীক্ষা স্লোগান বাংলা",
    taglineEn: "Test tagline English",
  };
  const saved = await req(
    "PUT",
    "/owner/branding",
    { ...next, reason: "Phase 3D branding test" },
    owner,
  );
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(saved.body, next);

  const pub = await req("GET", "/branding");
  assert.deepEqual(pub.body, next);

  const history = await req("GET", "/owner/setting-changes", undefined, owner);
  assert.equal(history.status, 200, JSON.stringify(history.body));
  const brandingRows = history.body.items.filter(
    (row: any) =>
      ["platform_name", "platform_tagline_bn", "platform_tagline_en"].includes(row.key) &&
      row.reason === "Phase 3D branding test",
  );
  assert.equal(brandingRows.length, 3, JSON.stringify(brandingRows));
  const byKey = new Map(brandingRows.map((row: any) => [row.key, row.value]));
  assert.equal(byKey.get("platform_name"), next.name);
  assert.equal(byKey.get("platform_tagline_bn"), next.taglineBn);
  assert.equal(byKey.get("platform_tagline_en"), next.taglineEn);
  assert.ok(brandingRows.every((row: any) => row.changedBy === owner.user.id));

  // A second save that changes only the name writes exactly one more history row.
  const renamed = { ...next, name: `Renamed ${run}` };
  const saved2 = await req(
    "PUT",
    "/owner/branding",
    { ...renamed, reason: "Phase 3D rename only" },
    owner,
  );
  assert.equal(saved2.status, 200, JSON.stringify(saved2.body));
  assert.deepEqual(saved2.body, renamed);
  const history2 = await req("GET", "/owner/setting-changes", undefined, owner);
  const renameRows = history2.body.items.filter(
    (row: any) => row.reason === "Phase 3D rename only",
  );
  assert.equal(renameRows.length, 1, JSON.stringify(renameRows));
  assert.equal(renameRows[0].key, "platform_name");
  assert.equal(renameRows[0].value, renamed.name);
});
