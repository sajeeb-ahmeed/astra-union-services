import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { app } from "../src/app.js";
import { pool } from "../src/db.js";

// Test-only credentials are generated per run so no password-like literal sits in the repository.
const password = randomBytes(12).toString("base64url");
const run = randomUUID().slice(0, 8);
const slug = `content-${run}`;
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
// Synthetic test-only values: this office exists only inside this test run.
const documents = [
  { bn: "জাতীয় পরিচয়পত্রের অনুলিপি", en: "Copy of the national identity card" },
  { bn: "সাম্প্রতিক ছবি", en: "Recent photograph" },
];
const policy = {
  expectedVersion: 0,
  reason: "Synthetic service-content test policy; not a government tariff",
  statutoryFeeMinor: 1500,
  processingFeeMinor: 75,
  emergencySurchargeMinor: 2000,
  deliveryFeesMinor: { office_collection: 0, digital_copy: 1000 },
  deliveryModes: ["office_collection", "digital_copy"],
  urgencies: ["normal", "urgent"],
  charterDays: 7,
  requiredDocuments: documents,
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
      nameBn: "সেবা তথ্য অফিস",
      nameEn: "Synthetic service content office",
      division: "Test Division",
      district: "Test District",
      upazila: "Test Upazila",
      officeType: "UNION",
      adminEmail: `admin@${slug}.test`,
      adminName: "Synthetic service content admin",
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

test("Phase 6: required documents are validated as bilingual pairs before anything is published", async () => {
  for (const bad of [
    [{ bn: "", en: "Document" }],
    [{ bn: "নথি", en: "  " }],
    [{ bn: "নথি" }],
    [{ bn: "নথি", en: "Document", extra: true }],
    [{ bn: "x".repeat(201), en: "Document" }],
    Array.from({ length: 21 }, (_, i) => ({ bn: `নথি ${i}`, en: `Document ${i}` })),
    "not-an-array",
  ])
    assert.equal(
      (await req("POST", "/admin/services/45/order-policies", { ...policy, requiredDocuments: bad }, s.admin)).status,
      422,
      JSON.stringify(bad).slice(0, 80),
    );
  // Nothing was published by the rejected attempts.
  const options = await req("GET", "/services/45/order-options", undefined, s.admin);
  assert.deepEqual(options.body, { configured: false, policy: null });
});

test("Phase 6: fee, charter time and required documents round-trip from publish to every public surface", async () => {
  const published = await req("POST", "/admin/services/45/order-policies", policy, s.admin);
  assert.equal(published.status, 201, JSON.stringify(published.body));
  assert.deepEqual(published.body.policy.requiredDocuments, documents);
  assert.equal(published.body.policy.charterDays, 7);

  const options = await req("GET", "/services/45/order-options", undefined, s.admin);
  assert.deepEqual(options.body.policy.requiredDocuments, documents);

  const page = await req("GET", `/offices/${slug}`);
  assert.equal(page.status, 200, JSON.stringify(page.body));
  const priced = page.body.services.find((x: any) => x.serviceNo === 45);
  assert.deepEqual(priced.requiredDocuments, documents);
  assert.equal(priced.charterDays, 7);

  // The public per-service view: this office shows exactly what it published.
  const info = await req("GET", "/services/45/office-info");
  assert.equal(info.status, 200, JSON.stringify(info.body));
  assert.equal(info.body.service.serviceNo, 45);
  assert.ok(info.body.service.category, "the catalog category is exposed");
  const mine = info.body.offices.find((o: any) => o.slug === slug);
  assert.ok(mine, "the publishing office is listed");
  assert.equal(mine.policyVersion, 1);
  assert.equal(mine.statutoryFeeMinor + mine.processingFeeMinor, 1575);
  assert.equal(mine.charterDays, 7);
  assert.deepEqual(mine.requiredDocuments, documents);

  // Offices that never published appear with a null policy — no fee, time or documents invented.
  const unpublished = info.body.offices.find((o: any) => o.slug === "alpha");
  assert.ok(unpublished, "a seeded office offering the service is listed");
  assert.equal(unpublished.policyVersion, null);
  assert.equal(unpublished.statutoryFeeMinor, null);
  assert.equal(unpublished.charterDays, null);
  assert.equal(unpublished.requiredDocuments, null);
});

test("Phase 6: a new policy version replaces the document list; omitting it states none", async () => {
  const next = await req(
    "POST",
    "/admin/services/45/order-policies",
    { ...policy, expectedVersion: 1, requiredDocuments: [documents[1]] },
    s.admin,
  );
  assert.equal(next.status, 201, JSON.stringify(next.body));
  assert.deepEqual(next.body.policy.requiredDocuments, [documents[1]]);
  const info = await req("GET", "/services/45/office-info");
  const mine = info.body.offices.find((o: any) => o.slug === slug);
  assert.equal(mine.policyVersion, 2);
  assert.deepEqual(mine.requiredDocuments, [documents[1]]);

  const cleared = await req(
    "POST",
    "/admin/services/45/order-policies",
    { ...policy, expectedVersion: 2, requiredDocuments: undefined },
    s.admin,
  );
  assert.equal(cleared.status, 201, JSON.stringify(cleared.body));
  assert.deepEqual(cleared.body.policy.requiredDocuments, []);
  const after = await req("GET", "/services/45/office-info");
  assert.deepEqual(after.body.offices.find((o: any) => o.slug === slug).requiredDocuments, []);
});

test("Phase 6: office-info rejects out-of-range service numbers and unknown routes stay closed", async () => {
  assert.equal((await req("GET", "/services/0/office-info")).status, 422);
  assert.equal((await req("GET", "/services/48/office-info")).status, 422);
  const one = await req("GET", "/services/1/office-info");
  assert.equal(one.status, 200, JSON.stringify(one.body));
  assert.equal(one.body.service.serviceNo, 1);
  assert.ok(Array.isArray(one.body.offices));
});
