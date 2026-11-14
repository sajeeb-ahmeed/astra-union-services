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

test("Phase 3b: completeness lists what is missing and reaches 100% only with an ID number and a mobile decision", () => {
  const bare = citizenProfileCompleteness(base);
  assert.deepEqual(bare.missing, ["identityNumber", "mobile"]);
  assert.equal(bare.percent, 60);
  assert.equal(bare.complete, false);

  assert.deepEqual(citizenProfileCompleteness({ ...base, nidHint: "••••123", noMobile: true }), {
    percent: 100,
    complete: true,
    missing: [],
  });
  assert.equal(
    citizenProfileCompleteness({ ...base, birthRegHint: "••••456", contactMobile: "01712345678" }).complete,
    true,
  );
  // "no mobile" must be an explicit declaration, not just an absent number.
  assert.deepEqual(citizenProfileCompleteness({ ...base, nidHint: "••••123", noMobile: false }).missing, ["mobile"]);
});

test("Phase 3b: optional fields never count, and blank strings are missing", () => {
  const complete = { ...base, nidHint: "••••123", noMobile: true };
  assert.equal(citizenProfileCompleteness({ ...complete, gender: null, bloodGroup: null }).percent, 100);
  assert.deepEqual(citizenProfileCompleteness({ ...complete, nameEn: "  " }).missing, ["name"]);
  assert.deepEqual(citizenProfileCompleteness({}).missing, [
    "name",
    "dateOfBirth",
    "address",
    "identityNumber",
    "mobile",
  ]);
  assert.equal(citizenProfileCompleteness(null).percent, 0);
});

test("Phase 3b: the address area counts only where the office uses structured geography", () => {
  const complete = { ...base, nidHint: "••••123", noMobile: true };
  assert.equal(citizenProfileCompleteness(complete, { geographyRequired: false }).complete, true);
  const partial = { ...complete, geography: { divisionCode: "div-01", districtCode: "dis-01", upazilaCode: "upa-001" } };
  const strict = citizenProfileCompleteness(partial, { geographyRequired: true });
  assert.deepEqual(strict.missing, ["geography"]);
  assert.equal(strict.percent, 83);
  assert.equal(
    citizenProfileCompleteness(
      { ...partial, geography: { ...partial.geography, unionCode: "uni-1", wardCode: "uni-1-w01" } },
      { geographyRequired: true },
    ).complete,
    true,
  );
  for (const item of Object.values(completenessLabels)) assert.ok(item.bn && item.en);
});
