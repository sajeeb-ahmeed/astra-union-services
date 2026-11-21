import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { app } from "../src/app.js";
import { pool, adminConnectionString } from "../src/db.js";
import { resolveGateway } from "../src/gateways.js";
import { BkashGateway } from "../src/bkash.js";
import { openMerchantSecret, sealMerchantSecret } from "../src/sslcommerz.js";

process.env.NODE_ENV = "test";
const db = new pg.Pool({ connectionString: adminConnectionString });
// Test-only credentials are generated per run so no password-like literal sits in the repository.
const password = randomBytes(12).toString("base64url");
const run = randomUUID().slice(0, 8);
let server: ReturnType<typeof app.listen>, base: string, officeId: string;
type Session = { cookie: string; csrf: string };
const s: Record<string, Session> = {};
async function req(method: string, path: string, data?: unknown, who?: string) {
  const session = who ? s[who] : undefined;
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      ...(session ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return { status: response.status, body: await response.json() };
}
async function login(name: string, email: string, secret = password) {
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: secret }),
  });
  const json = await r.json();
  assert.equal(r.status, 200, JSON.stringify(json));
  s[name] = { cookie: r.headers.get("set-cookie")!.split(";")[0], csrf: json.csrfToken };
}
// Synthetic API credentials, generated per run (no credential-like literal in the repository).
const credentials = Object.fromEntries(
  ["appKey", "appSecret", "username", "password"].map((field) => [field, randomBytes(12).toString("hex")]),
) as Record<"appKey" | "appSecret" | "username" | "password", string>;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  await login("owner", "owner@astra.demo.test", "Demo-Phase1!");
  const slug = `bkash-office-${run}`;
  const office = await req(
    "POST",
    "/owner/tenants",
    {
      slug,
      nameBn: "বিকাশ পরীক্ষা অফিস",
      nameEn: "Synthetic bKash office",
      division: "Test Division",
      district: "Test District",
      upazila: "Test Upazila",
      officeType: "UNION",
      adminEmail: `admin@${slug}.test`,
      adminName: "Synthetic bKash admin",
      adminPassword: password,
    },
    "owner",
  );
  assert.equal(office.status, 201, JSON.stringify(office.body));
  officeId = office.body.id;
  await login("admin", `admin@${slug}.test`);
  const r = await req("POST", "/admin/users", { email: `finance@${slug}.test`, displayName: "bKash QA finance", password, role: "finance" }, "admin");
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await login("finance", `finance@${slug}.test`);
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await db.end();
});

test("office bKash: without the office's own merchant, checkout availability falls back to the legacy setting", async () => {
  const configuration = await req("GET", "/payments/configuration", undefined, "finance");
  assert.equal(configuration.body.available, false);
  assert.equal((await req("GET", "/admin/payment-merchants/bkash", undefined, "finance")).body.reason, "MERCHANT_SETUP_REQUIRED");
});

test("office bKash: the admin stores its own merchant; credentials are encrypted, write-only and bound to bKash", async () => {
  const save = (body: Record<string, unknown>, who = "admin") => req("PUT", "/admin/payment-merchants/bkash", body, who);
  assert.equal((await save({ environment: "SANDBOX", merchantAccount: "01712345678", enabled: true })).status, 422, "credentials needed first");
  assert.equal((await save({ environment: "SANDBOX", merchantAccount: "01712345678", appKey: "only-one", enabled: true })).status, 422, "all four together");
  assert.equal((await save({ environment: "SANDBOX", merchantAccount: "12345", ...credentials, enabled: true })).status, 422);
  assert.equal((await save({ environment: "SANDBOX", merchantAccount: "01712345678", ...credentials, enabled: true }, "finance")).status, 403);
  const saved = await save({ environment: "SANDBOX", merchantAccount: "01712345678", ...credentials, enabled: true });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.available, true, JSON.stringify(saved.body));
  assert.equal(saved.body.merchantAccount, "01712345678");
  for (const value of Object.values(credentials)) assert.equal(JSON.stringify(saved.body).includes(value), false);
  const row = (await db.query("SELECT * FROM office_payment_merchants WHERE tenant_id=$1 AND provider='BKASH'", [officeId])).rows[0];
  for (const value of Object.values(credentials)) assert.equal(JSON.stringify(row).includes(value), false);
  assert.throws(() => openMerchantSecret(row.secret_cipher, officeId, "SANDBOX", "SSLCOMMERZ"), "a bKash secret cannot be read as another provider's");

  // Keeping the stored credentials while switching the account off and on again.
  assert.equal((await save({ environment: "SANDBOX", merchantAccount: "01712345678", enabled: false })).body.reason, "OFFICE_GATEWAY_DISABLED");
  assert.equal((await save({ environment: "SANDBOX", merchantAccount: "01712345678", enabled: true })).body.available, true);
  // LIVE needs the deployment's explicit activation.
  assert.equal((await save({ environment: "LIVE", merchantAccount: "01712345678", ...credentials, enabled: true })).body.reason, "LIVE_ACTIVATION_REQUIRED");
  assert.equal((await save({ environment: "SANDBOX", merchantAccount: "01712345678", ...credentials, enabled: true })).body.available, true);
});

test("office bKash: checkout uses this office's own merchant, not a deployment-wide binding", async () => {
  const gateway = await resolveGateway(officeId, "BKASH");
  assert.ok(gateway instanceof BkashGateway);
  assert.equal(gateway.merchantAccount, "01712345678");
  assert.equal(gateway.environment, "SANDBOX");
  const configuration = await req("GET", "/payments/configuration", undefined, "finance");
  assert.equal(configuration.body.available, true);
  assert.equal(configuration.body.merchantAccount, "01712345678");
  assert.equal(configuration.body.anyAvailable, true);
});

test("merchant secrets are bound to office, environment and provider", () => {
  const sealed = sealMerchantSecret("secret", officeId, "SANDBOX", "BKASH");
  assert.equal(openMerchantSecret(sealed, officeId, "SANDBOX", "BKASH"), "secret");
  assert.throws(() => openMerchantSecret(sealed, randomUUID(), "SANDBOX", "BKASH"));
  assert.throws(() => openMerchantSecret(sealed, officeId, "LIVE", "BKASH"));
});
