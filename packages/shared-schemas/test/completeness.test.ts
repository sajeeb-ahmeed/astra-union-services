import assert from "node:assert/strict";
import test from "node:test";
import { citizenProfileCompleteness, completenessLabels } from "../src/index.js";

const base = {
  nameBn: "নাগরিক",
  nameEn: "Citizen",
  dateOfBirth: "1990-01-01",
  addressBn: "গ্রাম",
  addressEn: "Village",
};
const family = {
  fatherNameBn: "পিতা",
  fatherNameEn: "Father",
  motherNameBn: "মাতা",
  motherNameEn: "Mother",
  gender: "female",
  bloodGroup: "O+",
  presentAddress: { sameAsPermanent: true },
};

test("Phase 3b: completeness lists what is missing and reaches 100% only with an ID number and a mobile decision", () => {
  const bare = citizenProfileCompleteness(base);
  assert.deepEqual(bare.missing, [
    "fatherName",
    "motherName",
    "gender",
    "bloodGroup",
    "presentAddress",
    "identityNumber",
    "mobile",
  ]);
  assert.equal(bare.percent, 30);
  assert.equal(bare.complete, false);

  assert.deepEqual(citizenProfileCompleteness({ ...base, ...family, nidHint: "••••123", noMobile: true }), {
    percent: 100,
    complete: true,
    missing: [],
  });
  assert.equal(
    citizenProfileCompleteness({ ...base, ...family, birthRegHint: "••••456", contactMobile: "01712345678" }).complete,
    true,
  );
  // "no mobile" must be an explicit declaration, not just an absent number.
  assert.deepEqual(
    citizenProfileCompleteness({ ...base, ...family, nidHint: "••••123", noMobile: false }).missing,
    ["mobile"],
  );
  // A separate present address counts only with both texts; the same-as-permanent declaration counts on its own.
  assert.deepEqual(
    citizenProfileCompleteness({
      ...base,
      ...family,
      presentAddress: { sameAsPermanent: false, addressBn: "বর্তমান গ্রাম", addressEn: "  " },
      nidHint: "••••123",
      noMobile: true,
    }).missing,
    ["presentAddress"],
  );
  assert.equal(
    citizenProfileCompleteness({
      ...base,
      ...family,
      presentAddress: { sameAsPermanent: false, addressBn: "বর্তমান গ্রাম", addressEn: "Present village" },
      nidHint: "••••123",
      noMobile: true,
    }).complete,
    true,
  );
  // Parents need both scripts, like the citizen's own name.
  assert.deepEqual(
    citizenProfileCompleteness({ ...base, ...family, fatherNameEn: "", nidHint: "••••123", noMobile: true }).missing,
    ["fatherName"],
  );
});

test("Phase 3b: optional fields never count, and blank strings are missing", () => {
  const complete = { ...base, ...family, nidHint: "••••123", noMobile: true };
  // Spouse names and the photo stay optional (Md's decision, 2026-11-26): they never move the meter.
  assert.equal(
    citizenProfileCompleteness({ ...complete, spouseNameBn: null, spouseNameEn: null, hasPhoto: false }).percent,
    100,
  );
  // Gender and blood group now count (Md's decision, 2026-11-26).
  assert.deepEqual(citizenProfileCompleteness({ ...complete, gender: null, bloodGroup: null }).missing, [
    "gender",
    "bloodGroup",
  ]);
  assert.deepEqual(citizenProfileCompleteness({ ...complete, nameEn: "  " }).missing, ["name"]);
  assert.deepEqual(citizenProfileCompleteness({}).missing, [
    "name",
    "dateOfBirth",
    "address",
    "fatherName",
    "motherName",
    "gender",
    "bloodGroup",
    "presentAddress",
    "identityNumber",
    "mobile",
  ]);
  assert.equal(citizenProfileCompleteness(null).percent, 0);
});

test("Phase 3b: the address area counts only where the office uses structured geography", () => {
  const complete = { ...base, ...family, nidHint: "••••123", noMobile: true };
  assert.equal(citizenProfileCompleteness(complete, { geographyRequired: false }).complete, true);
  const partial = { ...complete, geography: { divisionCode: "div-01", districtCode: "dis-01", upazilaCode: "upa-001" } };
  const strict = citizenProfileCompleteness(partial, { geographyRequired: true });
  assert.deepEqual(strict.missing, ["geography"]);
  assert.equal(strict.percent, 90);
  assert.equal(
    citizenProfileCompleteness(
      { ...partial, geography: { ...partial.geography, unionCode: "uni-1", wardCode: "uni-1-w01" } },
      { geographyRequired: true },
    ).complete,
    true,
  );
  for (const item of Object.values(completenessLabels)) assert.ok(item.bn && item.en);
});
