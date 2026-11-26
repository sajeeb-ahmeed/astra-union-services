import test from "node:test";
import assert from "node:assert/strict";
import { getServiceSchema } from "@astra/shared-schemas";
import {
  CITIZEN_COMPUTED_SOURCES,
  CITIZEN_FIELD_SOURCES,
  CITIZEN_FIELD_SOURCES_BY_SERVICE,
  citizenFormDefaults,
} from "../src/citizen-prefill.js";

/**
 * WS-C: every prefill id must exist as a real top-level field in the
 * operational schemas — dead map entries (father_name_* and friends,
 * deleted in WS-C) can never creep back. citizenFormDefaults only fills
 * top-level text/textarea/date/number fields, so existence is checked
 * at the top level, where the filler actually looks.
 */
const topLevelFields = (serviceNo: number) => {
  const schema = getServiceSchema(serviceNo);
  const byId = new Map<string, string>();
  for (const section of schema.sections)
    for (const field of section.fields) byId.set(field.id, field.type);
  return byId;
};

test("prefill map: every global id exists in at least one schema", () => {
  const all = new Map<string, string>();
  for (let serviceNo = 1; serviceNo <= 47; serviceNo++)
    for (const [id, type] of topLevelFields(serviceNo)) all.set(id, type);
  for (const [id] of Object.entries(CITIZEN_FIELD_SOURCES)) {
    assert.ok(all.has(id), `dead prefill entry: ${id} is in no schema`);
    assert.ok(
      ["text", "textarea", "date"].includes(all.get(id)!),
      `${id} is a ${all.get(id)} field — citizenFormDefaults cannot fill it`,
    );
  }
});

test("prefill map: per-service overrides exist in their own schema", () => {
  for (const [serviceNo, entries] of Object.entries(
    CITIZEN_FIELD_SOURCES_BY_SERVICE,
  )) {
    const fields = topLevelFields(Number(serviceNo));
    for (const id of Object.keys(entries))
      assert.ok(
        fields.has(id),
        `dead prefill entry: ${id} is not in service ${serviceNo}`,
      );
  }
});

test("prefill map: computed sources target real number fields", () => {
  for (const id of Object.keys(CITIZEN_COMPUTED_SOURCES)) {
    let found: string | undefined;
    for (let serviceNo = 1; serviceNo <= 47 && !found; serviceNo++)
      found = topLevelFields(serviceNo).get(id);
    assert.equal(found, "number", `computed source ${id} must be a number field`);
  }
});

test("citizenFormDefaults: fills applicant facts, derives voter_age, never other people", () => {
  const citizen = {
    nameBn: "মোঃ সাজিব",
    nameEn: "Mohamed Sajib",
    fatherNameBn: "জসিম উদ্দিন",
    fatherNameEn: "Jasim Uddin",
    motherNameBn: "ফজিলাত বেগম",
    motherNameEn: "Fazilat Begum",
    spouseNameBn: "আয়েশা সিদ্দিকা",
    spouseNameEn: "Ayesha Siddika",
    dateOfBirth: "1995-06-15",
    addressBn: "বেলাবো, নরসিংদী",
    addressEn: "Belabo, Narsingdi",
    contactMobile: "01748402018",
  };
  const svc15 = citizenFormDefaults(getServiceSchema(15), citizen);
  assert.equal(svc15.date_of_birth, "1995-06-15");
  const expectedAge = (() => {
    const now = new Date();
    let age = now.getUTCFullYear() - 1995;
    if (
      now.getUTCMonth() < 5 ||
      (now.getUTCMonth() === 5 && now.getUTCDate() < 15)
    )
      age -= 1;
    return age;
  })();
  assert.equal(svc15.voter_age, expectedAge);
  // NID is never a map default — it arrives only via the audited reveal.
  assert.ok(!("nid_number" in svc15));

  const svc13 = citizenFormDefaults(getServiceSchema(13), citizen);
  assert.equal(svc13.application_husband_name_bn, "আয়েশা সিদ্দিকা");
  assert.equal(svc13.application_husband_name, "Ayesha Siddika");

  // Service 3's warish_info block describes the deceased — no prefill.
  const svc3 = citizenFormDefaults(getServiceSchema(3), citizen);
  assert.ok(
    !Object.keys(svc3).some((id) => id.startsWith("warish_info_")),
    `service 3 must not prefill the deceased: ${JSON.stringify(svc3)}`,
  );

  assert.deepEqual(citizenFormDefaults(getServiceSchema(15), null), {});
});
