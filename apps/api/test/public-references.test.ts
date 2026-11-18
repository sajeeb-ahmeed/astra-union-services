import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDemoPayload } from "@astra/shared-schemas";
import { app } from "../src/app.js";
import { pool, transaction } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";
import {
  formatReference,
  parseReferenceInput,
  referenceDigits,
  referenceSegments,
} from "../src/references.js";

/**
 * Phase 5 (5C): public reference numbers (owner decision, 18 Nov 2026).
 * New citizens and applications get an 18-digit reference in three groups of six: segment 1
 * from a keyed hash of the date of birth, segment 2 from a keyed hash of the NID (or of the
 * citizen id when no NID is on file), segment 3 random and uniqueness-checked. The printed
 * number must never contain the raw DOB or NID digits. Legacy references (REF-<uuid> citizen
 * references, UUID application ids) keep resolving everywhere.
 */

type Session = { cookie: string; csrf: string; user: any };
let server: ReturnType<typeof app.listen>, base: string;
const password = "Demo-Phase1!";
const FORMAT = /^\d{6}-\d{6}-\d{6}$/;
const segments = (ref: string) => ref.split("-");

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

test("reference helpers: parsing, grouping and segment derivation", () => {
  assert.equal(formatReference("123456789012345678"), "123456-789012-345678");
  assert.equal(parseReferenceInput("123456-789012-345678"), "123456-789012-345678");
  assert.equal(parseReferenceInput("123456789012345678"), "123456-789012-345678");
  // Bengali digits parse to the same canonical reference.
  assert.equal(parseReferenceInput("১২৩৪৫৬-৭৮৯০১২-৩৪৫৬৭৮"), "123456-789012-345678");
  assert.equal(parseReferenceInput("123456-789012"), null);
  assert.equal(parseReferenceInput("REF-12345678-1234-1234-1234-123456789012"), null);
  assert.equal(referenceDigits("676785-939293-581090"), "676785939293581090");
  const citizenId = randomUUID();
  const a = referenceSegments({ dateOfBirth: "1995-06-15", nid: "12345678901234567", citizenId });
  const b = referenceSegments({ dateOfBirth: "1995-06-15", nid: "12345678901234567", citizenId });
  assert.deepEqual(a, b, "derivation is deterministic");
  const otherDob = referenceSegments({ dateOfBirth: "1988-01-20", nid: "12345678901234567", citizenId });
  assert.notEqual(a[0], otherDob[0], "a different DOB derives a different first segment");
  const noNid = referenceSegments({ dateOfBirth: "1995-06-15", nid: null, citizenId });
  assert.equal(noNid[0], a[0], "segment 1 does not depend on the NID");
  assert.notEqual(noNid[1], a[1], "the fallback segment differs from the NID segment");
  // The derivation never echoes raw input digits.
  assert.notEqual(a[0], "199506");
  assert.notEqual(a[1], "123456");
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
  const withoutNid = await createCitizen(staff, {
    nameBn: "কিউএ টেস্ট নাগরিক",
    nameEn: "Plain Reference Citizen",
    dateOfBirth: "1995-06-15",
    addressBn: "ঠিকানা",
    addressEn: "Address",
  });
  assert.match(withoutNid.syntheticReference, FORMAT);
  // Same DOB -> same first segment; the NID and fallback derivations differ in segment 2.
  assert.equal(
    segments(withNid.syntheticReference)[0],
    segments(withoutNid.syntheticReference)[0],
  );
  assert.notEqual(
    segments(withNid.syntheticReference)[1],
    segments(withoutNid.syntheticReference)[1],
  );
  // Privacy: neither reference contains the raw DOB (either order) or the NID.
  for (const ref of [withNid.syntheticReference, withoutNid.syntheticReference]) {
    const digits = referenceDigits(ref);
    assert.equal(digits.includes("19950615"), false);
    assert.equal(digits.includes("15061995"), false);
    assert.equal(digits.includes(nid), false);
  }
  // Applications inherit the citizen's first two segments — via the stored NID for one
  // citizen and via the fallback for the other — and differ only in the random segment.
  const appNid = await createApplication(staff, withNid.id);
  assert.match(appNid.reference, FORMAT);
  assert.deepEqual(segments(appNid.reference).slice(0, 2), segments(withNid.syntheticReference).slice(0, 2));
  const appPlain = await createApplication(staff, withoutNid.id);
  assert.deepEqual(segments(appPlain.reference).slice(0, 2), segments(withoutNid.syntheticReference).slice(0, 2));
  // Repeated generation for one citizen stays unique.
  const seen = new Set<string>([appNid.reference]);
  for (let i = 0; i < 24; i++) {
    const again = await createApplication(staff, withNid.id);
    assert.match(again.reference, FORMAT);
    assert.equal(seen.has(again.reference), false);
    seen.add(again.reference);
    assert.deepEqual(segments(again.reference).slice(0, 2), segments(withNid.syntheticReference).slice(0, 2));
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
  // Public tracking: grouped reference, plain digits and the UUID all resolve.
  for (const key of [application.reference, referenceDigits(application.reference), application.id]) {
    const tracked = await request("GET", `/track/${encodeURIComponent(key)}`);
    assert.equal(tracked.status, 200, `track ${key}`);
    assert.equal(tracked.body.status, "SUBMITTED");
    assert.equal(tracked.body.serviceNo, 45);
  }
  // Staff lookup: the same three forms resolve to the same application. The lookup
  // response keeps its established minimal shape ({id, serviceNo, state} + certificate) —
  // the reference is an accepted input, not an added output field.
  for (const key of [application.reference, referenceDigits(application.reference), application.id]) {
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
