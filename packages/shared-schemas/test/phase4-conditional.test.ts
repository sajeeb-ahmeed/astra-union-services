import assert from "node:assert/strict";
import test from "node:test";
import {
  flattenFields,
  getDemoPayload,
  getServiceSchema,
  validateForm,
  validateServicePayload,
  type FormSchema,
} from "../src/index.js";

/**
 * Phase 4 regression suite for the live E2E defects of 17 Nov 2026:
 * citizens were blocked by "এই ঘরটি পূরণ করুন।" on conditional groups they
 * never opted into (services 4, 20, 23, 29, 31, 35, 39, 42). Two mechanisms
 * caused it and both are covered here:
 *  1. the shared engine treated an absent plain checkbox as a missing
 *     required field, although unticked simply means "no";
 *  2. the fields governed by the `optradio` opt-in carried no `visibleWhen`,
 *     so they stayed required while the group was off (fixed by publishing
 *     schema v3 for services 4, 7, 23, 29, 31 — v2 stays pinned).
 */

const strip = (
  payload: Record<string, unknown>,
  ...keys: string[]
): Record<string, unknown> => {
  const copy = { ...payload };
  for (const key of keys) delete copy[key];
  return copy;
};

test("Phase 4: an untouched opt-in toggle never blocks its own service", () => {
  const cases: ReadonlyArray<readonly [number, readonly string[]]> = [
    [4, ["optradio"]],
    [7, ["optradio"]],
    [20, ["other_freedom_fighter"]],
    [23, ["optradio", "other_person"]],
    [29, ["optradio", "other_person"]],
    [31, ["optradio"]],
    [35, ["marital_status_radio"]],
    [39, ["spi_is_dead", "relation_person"]],
    [42, ["has_previous_license"]],
  ];
  for (const [no, controllers] of cases) {
    const payload = strip(getDemoPayload(no), ...controllers);
    const result = validateServicePayload(no, payload);
    assert.equal(
      result.valid,
      true,
      `service ${no} without ${controllers.join(", ")}: ${JSON.stringify(result.issues)}`,
    );
  }
});

test("Phase 4: selecting a group makes its fields required (checkbox and radio patterns)", () => {
  const cases: ReadonlyArray<
    readonly [number, Record<string, unknown>, string]
  > = [
    // optradio-governed groups (schema v3)
    [4, { optradio: true }, "warish_info_dod"],
    [7, { optradio: true }, "dead_info_dod"],
    [23, { optradio: true }, "profession_en"],
    [29, { optradio: true }, "profession_bn"],
    [31, { optradio: true }, "dead_info_dod"],
    // checkbox-governed groups (engine rule + existing visibleWhen)
    [20, { other_freedom_fighter: true }, "other_freedom_fighter_name"],
    [23, { other_person: true }, "other_person_name"],
    [29, { other_person: true }, "other_person_name"],
    [35, { marital_status_radio: true }, "marital_status"],
    [39, { spi_is_dead: true }, "spi_death_date"],
    [39, { relation_person: true }, "spi_relation_person_name"],
    [42, { has_previous_license: true }, "previous_license_number"],
  ];
  for (const [no, extra, dependent] of cases) {
    const result = validateServicePayload(no, {
      ...getDemoPayload(no),
      ...extra,
    });
    assert.ok(
      result.issues.some(
        (issue) => issue.path === dependent && issue.code === "required",
      ),
      `service ${no}: ${dependent} must be required once its group is selected`,
    );
  }
});

test("Phase 4: optradio groups are conditioned only in v3; v2 stays pinned", () => {
  const groups: ReadonlyArray<readonly [number, string]> = [
    [4, "warish_info_dod"],
    [7, "dead_info_dod"],
    [23, "profession_en"],
    [29, "profession_bn"],
    [31, "dead_info_dod"],
  ];
  for (const [no, dependent] of groups) {
    // CERT-REFINE-01 published v4 of service 4 (heirs' father-name field);
    // the conditioning structure it asserts here is carried over unchanged.
    assert.equal(getServiceSchema(no).version, no === 4 ? 4 : 3, `service ${no} latest`);
    const current = flattenFields(getServiceSchema(no)).find(
      (field) => field.id === dependent,
    );
    assert.deepEqual(current?.visibleWhen, {
      field: "optradio",
      equals: true,
    });
    const pinned = flattenFields(getServiceSchema(no, 2)).find(
      (field) => field.id === dependent,
    );
    assert.equal(
      pinned?.visibleWhen,
      undefined,
      `service ${no} v2 must keep its exact published shape`,
    );
  }
});

test("Phase 4: income amount is optional on services 23/29 from v3 (Finding B)", () => {
  for (const no of [23, 29] as const) {
    const withoutAmount = strip(getDemoPayload(no), "income_info_amount");
    assert.equal(validateServicePayload(no, withoutAmount).valid, true);
    const current = flattenFields(getServiceSchema(no)).find(
      (field) => field.id === "income_info_amount",
    );
    assert.equal(current?.constraints?.required, false);
    // The pinned v2 keeps the amount required, byte-for-byte in behaviour.
    const pinned = validateServicePayload(no, withoutAmount, 2);
    assert.ok(
      pinned.issues.some(
        (issue) =>
          issue.path === "income_info_amount" && issue.code === "required",
      ),
    );
    // A supplied amount is still range-validated.
    const supplied = validateServicePayload(no, {
      ...getDemoPayload(no),
      income_info_amount: -5,
    });
    assert.ok(
      supplied.issues.some(
        (issue) => issue.path === "income_info_amount" && issue.code === "range",
      ),
    );
  }
});

test("Phase 4: engine treats an absent plain checkbox as 'no', but a declaration is still enforced", () => {
  const schema: FormSchema = {
    serviceNo: 45,
    version: 99,
    title: { bn: "পরীক্ষা", en: "Probe" },
    stage: "operational_demo",
    evidence: {
      status: "proposed",
      source: "phase4-conditional.test",
      limitation: "Engine probe only.",
    },
    sections: [
      {
        id: "probe",
        title: { bn: "পরীক্ষা", en: "Probe" },
        fields: [
          {
            id: "opt_in",
            type: "checkbox",
            label: { bn: "ঐচ্ছিক তথ্য", en: "Optional details" },
            constraints: { required: true },
          },
          {
            id: "declaration",
            type: "checkbox",
            label: { bn: "ঘোষণা", en: "Declaration" },
            constraints: { required: true, mustBeTrue: true },
          },
        ],
      },
    ],
  };
  assert.equal(validateForm(schema, { declaration: true }).valid, true);
  assert.equal(
    validateForm(schema, { opt_in: false, declaration: true }).valid,
    true,
  );
  const missing = validateForm(schema, {});
  assert.equal(missing.valid, false);
  assert.ok(
    missing.issues.some((issue) => issue.path === "declaration"),
    "an unaccepted declaration must still fail",
  );
  assert.ok(
    !missing.issues.some((issue) => issue.path === "opt_in"),
    "an untouched opt-in checkbox must not fail",
  );
  // The real declaration on service 45 behaves the same way.
  const withoutConfirmation = strip(getDemoPayload(45), "confirmation");
  assert.equal(validateServicePayload(45, withoutConfirmation).valid, false);
});
