import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDemoPayload } from "@astra/shared-schemas";
import { app } from "../src/app.js";
import { pool, transaction } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";
import {
  formatReference,
  mintReference,
  parseReferenceInput,
  referenceDigits,
} from "../src/references.js";

/**
 * Public reference numbers.
 *
 * CERTNO-01 (owner-approved 18 Nov 2026) supersedes the Phase 5 format: new
 * citizens and applications get a 16-digit reference — the Asia/Dhaka
 * registration/submission date (YYYYMMDD) + 8 random digits — stored plain
 * and uniqueness-checked at mint time. Phase 5 references (18 digits in
 * three hyphenated groups of six, derived from keyed hashes of the DOB and
 * NID) remain stored on older records and keep resolving; legacy references
 * (REF-<uuid> citizen references, UUID application ids) keep resolving too.
 */

type Session = { cookie: string; csrf: string; user: any };
let server: ReturnType<typeof app.listen>, base: string;
const password = "Demo-Phase1!";
const FORMAT = /^\d{16}$/;
const dhakaToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .replace(/-/g, "");

test.before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}/api/v1`;
});
test.after(async () => {
  server?.close();
  await closePdfBrowser().catch(() => {});
  await pool.end();
});

async function request(
  method: string,
  path: string,
  opts: { cookie?: string; csrf?: string; body?: unknown } = {},
) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(opts.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
      ...(opts.cookie ? { Cookie: opts.cookie } : {}),
      ...(opts.csrf ? { "X-CSRF-Token": opts.csrf } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => ({})),
    setCookie: response.headers.get("set-cookie") ?? "",
  };
}
async function login(email: string): Promise<Session> {
  const r = await request("POST", "/auth/login", { body: { email, password } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return {
    cookie: r.setCookie.split(";")[0],
    csrf: r.body.csrfToken,
    user: r.body.user,
  };
}
async function createCitizen(
  staff: Session,
  body: Record<string, unknown>,
) {
  const r = await request("POST", "/citizens", { ...staff, body });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
async function createApplication(staff: Session, citizenId: string) {
  const r = await request("POST", "/applications", {
    ...staff,
    body: { citizenId, serviceNo: 45, payload: getDemoPayload(45) },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}

test("reference helpers: parsing, grouping and minting", async () => {
  // CERTNO-01 references group by four for display; Phase 5 keeps groups of six.
  assert.equal(formatReference("2026111812345678"), "2026-1118-1234-5678");
  assert.equal(formatReference("123456789012345678"), "123456-789012-345678");
  // Plain, grouped and Bengali-digit inputs canonicalise to the stored form.
  assert.equal(parseReferenceInput("2026111812345678"), "2026111812345678");
  assert.equal(parseReferenceInput("2026-1118-1234-5678"), "2026111812345678");
  assert.equal(parseReferenceInput("২০২৬১১১৮১২৩৪৫৬৭৮"), "2026111812345678");
  assert.equal(parseReferenceInput("123456-789012-345678"), "123456-789012-345678");
  assert.equal(parseReferenceInput("123456789012345678"), "123456-789012-345678");
  assert.equal(parseReferenceInput("১২৩৪৫৬-৭৮৯০১২-৩৪৫৬৭৮"), "123456-789012-345678");
  assert.equal(parseReferenceInput("123456-789012"), null);
  assert.equal(parseReferenceInput("REF-12345678-1234-1234-1234-123456789012"), null);
  assert.equal(referenceDigits("676785-939293-581090"), "676785939293581090");
  assert.equal(referenceDigits("2026-1118-1234-5678"), "2026111812345678");
  // Minting: 16 digits, Dhaka-date prefixed, collision-checked.
  const minted = await mintReference(async () => false);
  assert.match(minted, FORMAT);
  assert.equal(minted.slice(0, 8), dhakaToday());
  let calls = 0;
  const retried = await mintReference(async () => ++calls < 3);
  assert.match(retried, FORMAT);
  assert.equal(calls, 3, "the mint retries past collisions");
  await assert.rejects(() => mintReference(async () => true), /REFERENCE_GENERATION_FAILED/);
});

test("citizen and application references: format, stability, privacy, uniqueness", async () => {
  const staff = await login("staff@alpha.local.test");
  // A run-unique, valid 17-digit NID (the office enforces one citizen per NID).
  const nid = `1995${String(Date.now()).slice(-13)}`;
  const withNid = await createCitizen(staff, {
    nameBn: "নিদ টেস্ট",
    nameEn: "NID Reference Citizen",
    dateOfBirth: "1995-06-15",
    addressBn: "ঠিকানা",
    addressEn: "Address",
    details: { nid, noMobile: true },
  });
  assert.match(withNid.syntheticReference, FORMAT);
  assert.equal(withNid.syntheticReference.slice(0, 8), dhakaToday(), "the date segment is the Dhaka registration date");
  const withoutNid = await createCitizen(staff, {
    nameBn: "কিউএ টেস্ট নাগরিক",
    nameEn: "Plain Reference Citizen",
    dateOfBirth: "1995-06-15",
    addressBn: "ঠিকানা",
    addressEn: "Address",
  });
  assert.match(withoutNid.syntheticReference, FORMAT);
  assert.notEqual(withNid.syntheticReference, withoutNid.syntheticReference);
  // Privacy: neither reference contains the raw DOB (either order) or the NID.
  for (const ref of [withNid.syntheticReference, withoutNid.syntheticReference]) {
    const digits = referenceDigits(ref);
    assert.equal(digits.includes("19950615"), false);
    assert.equal(digits.includes("15061995"), false);
    assert.equal(digits.includes(nid), false);
  }
  // Every application gets its own fresh reference (CERTNO-01 references are
  // per-record mints, not citizen-derived segments).
  const appNid = await createApplication(staff, withNid.id);
  assert.match(appNid.reference, FORMAT);
  const appPlain = await createApplication(staff, withoutNid.id);
  assert.match(appPlain.reference, FORMAT);
  assert.notEqual(appNid.reference, appPlain.reference);
  // Repeated generation for one citizen stays unique.
  const seen = new Set<string>([appNid.reference]);
  for (let i = 0; i < 24; i++) {
    const again = await createApplication(staff, withNid.id);
    assert.match(again.reference, FORMAT);
    assert.equal(seen.has(again.reference), false);
    seen.add(again.reference);
  }
});

test("tracking and lookup accept the new reference and the legacy UUID", async () => {
  const staff = await login("staff@alpha.local.test");
  const citizen = await createCitizen(staff, {
    nameBn: "ট্র্যাকিং টেস্ট",
    nameEn: "Tracking Reference Citizen",
    dateOfBirth: "1990-03-04",
    addressBn: "ঠিকানা",
    addressEn: "Address",
  });
  const application = await createApplication(staff, citizen.id);
  const submitted = await request(
    "POST",
    `/applications/${application.id}/transition`,
    { ...staff, body: { action: "submit" } },
  );
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  // Public tracking: plain digits, the grouped display form and the UUID all resolve.
  for (const key of [application.reference, formatReference(application.reference), application.id]) {
    const tracked = await request("GET", `/track/${encodeURIComponent(key)}`);
    assert.equal(tracked.status, 200, `track ${key}`);
    assert.equal(tracked.body.status, "SUBMITTED");
    assert.equal(tracked.body.serviceNo, 45);
  }
  // Staff lookup: the same three forms resolve to the same application. The lookup
  // response keeps its established minimal shape ({id, serviceNo, state} + certificate) —
  // the reference is an accepted input, not an added output field.
  for (const key of [application.reference, formatReference(application.reference), application.id]) {
    const found = await request(
      "GET",
      `/applications/lookup?reference=${encodeURIComponent(key)}`,
      staff,
    );
    assert.equal(found.status, 200, `lookup ${key}`);
    assert.equal(found.body.application.id, application.id);
    assert.deepEqual(Object.keys(found.body.application).sort(), ["id", "serviceNo", "state"]);
  }
  // A legacy application (created before Phase 5, reference NULL) still tracks by UUID.
  const schemaHash = (
    await pool.query(
      "SELECT schema_hash FROM service_versions WHERE service_no=45 AND version=1",
    )
  ).rows[0].schema_hash;
  const legacyId = randomUUID();
  await transaction(staff.user.tenantId, async (db) => {
    await db.query(
      "INSERT INTO applications(id,tenant_id,citizen_id,service_no,schema_version,schema_hash,state,created_by) VALUES($1,$2,$3,45,1,$4,'SUBMITTED',$5)",
      [legacyId, staff.user.tenantId, citizen.id, schemaHash, staff.user.id],
    );
  });
  const legacyTracked = await request("GET", `/track/${legacyId}`);
  assert.equal(legacyTracked.status, 200);
  assert.equal(legacyTracked.body.status, "SUBMITTED");
  const legacyLookup = await request(
    "GET",
    `/applications/lookup?reference=${legacyId}`,
    staff,
  );
  assert.equal(legacyLookup.status, 200);
  assert.equal(legacyLookup.body.application.id, legacyId);
  // Legacy citizen references (REF-…) still resolve through citizen search.
  const seedCitizen = await request(
    "GET",
    `/citizens?q=${encodeURIComponent("REF-ALPHA-001")}`,
    staff,
  );
  assert.ok(seedCitizen.body.total >= 1);
  // Garbage input is still simply not found.
  const garbage = await request("GET", "/track/not-a-reference");
  assert.equal(garbage.status, 404);
});
