import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { app } from "../src/app.js";
import { pool } from "../src/db.js";

// Test-only credentials are generated per run so no password-like literal sits in the repository.
const password = randomBytes(12).toString("base64url");
const run = randomUUID().slice(0, 8);
const slug = `price-${run}`;
let server: ReturnType<typeof app.listen>, base: string;
type Session = { cookie: string; csrf: string };
const s: Record<string, Session> = {};
async function req(method: string, path: string, data?: unknown, session?: Session) {
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
async function login(name: string, email: string, secret: string) {
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: secret }),
  });
  const json = await r.json();
  assert.equal(r.status, 200, JSON.stringify(json));
  s[name] = { cookie: r.headers.get("set-cookie")!.split(";")[0], csrf: json.csrfToken };
}
const policy = {
  expectedVersion: 0,
  reason: "Synthetic tariff for the price list test; not a government tariff",
  statutoryFeeMinor: 1500,
  processingFeeMinor: 75,
  emergencySurchargeMinor: 2000,
  deliveryFeesMinor: { office_collection: 0, digital_copy: 1000 },
  deliveryModes: ["office_collection", "digital_copy"],
  urgencies: ["normal", "urgent"],
};

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  await login("owner", "owner@astra.demo.test", "Demo-Phase1!");
  const office = await req(
    "POST",
    "/owner/tenants",
    {
      slug,
      nameBn: "মূল্য তালিকা অফিস",
      nameEn: "Synthetic price list office",
      division: "Test Division",
      district: "Test District",
      upazila: "Test Upazila",
      officeType: "UNION",
      adminEmail: `admin@${slug}.test`,
      adminName: "Synthetic price list admin",
      adminPassword: password,
    },
    s.owner,
  );
  assert.equal(office.status, 201, JSON.stringify(office.body));
  await login("admin", `admin@${slug}.test`, password);
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

test("Phase 4a: the office publishes a fee policy with a citizen-charter time and it appears on its public price list", async () => {
  for (const charterDays of [0, 366, 2.5, "7"])
    assert.equal(
      (await req("POST", "/admin/services/45/order-policies", { ...policy, charterDays }, s.admin)).status,
      422,
      `charterDays ${JSON.stringify(charterDays)}`,
    );
  const published = await req("POST", "/admin/services/45/order-policies", { ...policy, charterDays: 7 }, s.admin);
  assert.equal(published.status, 201, JSON.stringify(published.body));
  assert.equal(published.body.policy.charterDays, 7);

  const page = await req("GET", `/offices/${slug}`);
  assert.equal(page.status, 200, JSON.stringify(page.body));
  const priced = page.body.services.find((x: any) => x.serviceNo === 45);
  assert.ok(priced, "service 45 is listed");
  assert.equal(priced.policyVersion, 1);
  assert.equal(priced.statutoryFeeMinor + priced.processingFeeMinor, 1575, "fractional taka are kept exactly (৳15.75)");
  assert.equal(priced.emergencySurchargeMinor, 2000);
  assert.deepEqual(priced.deliveryModes, ["office_collection", "digital_copy"]);
  assert.equal(priced.digitalCopyFeeMinor, 1000);
  assert.equal(priced.charterDays, 7);
  // Enabled services without a published policy are listed without inventing a price.
  const unpriced = page.body.services.find((x: any) => x.serviceNo !== 45);
  if (unpriced) assert.equal(unpriced.policyVersion, null);

  // A new version without a charter time clears it; the list follows the latest version.
  const next = await req(
    "POST",
    "/admin/services/45/order-policies",
    { ...policy, expectedVersion: 1, statutoryFeeMinor: 2000 },
    s.admin,
  );
  assert.equal(next.status, 201, JSON.stringify(next.body));
  assert.equal(next.body.policy.charterDays, null);
  const updated = (await req("GET", `/offices/${slug}`)).body.services.find((x: any) => x.serviceNo === 45);
  assert.equal(updated.policyVersion, 2);
  assert.equal(updated.statutoryFeeMinor, 2000);
  assert.equal(updated.charterDays, null);
});
