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
import { createSyntheticPayload } from "../src/expanded-schemas.js";

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
 *
 * QAFIX-02 exception (live QA §3.4 / §4 item 6): on service 4 the Phase-4
 * grouping also hid the DATE OF DEATH behind the opt-in — but that date is
 * the core fact of a succession certificate, and core evidence is never
 * checkbox-hidden. From v6 the date is always visible and required; the
 * toggle governs only the optional registration extras. The tests below
 * pin both halves of that ruling.
 *
 * QAFIX-03 exception (live QA §3.7 / §4 item 6): service 7's date of death
 * was hidden by the same grouping — the core fact of a death certificate.
 * From v5 it is always visible and required, under the same ruling; the
 * toggle governs only the registration reference and religion document.
 *
 * QAFIX-05 exception (live QA §3.23 / §4 item 6): service 23's core
 * evidence hid behind TWO opt-in checkboxes (the profession pair behind
 * optradio, the earner behind other_person), and its core figures were
 * optional. From v5 both checkboxes are gone: the profession pair and
 * the income figures are always visible and required, and the earner is
 * chosen from a required select that gates the earner's relation and
 * name. Service 23 therefore leaves this suite's opt-in cases and the
 * optional-amount test below; its new shape is pinned in
 * catalog-operational.test.ts instead. Service 29 kept both mechanisms
 * until QAFIX-06.
 *
 * QAFIX-06 exception (live QA §3.29 / §4 item 6): service 29 — the
 * monthly-income certificate — carried the same two-checkbox defect
 * as 23, and its income amount itself was optional. From v5 both
 * checkboxes are gone: the profession pair and the income figures are
 * always visible and required, and the earner is chosen from a
 * required select that gates the earner's relation, name and own
 * monthly amount. Service 29 therefore leaves this suite's opt-in
 * cases and the optional-amount test below; its new shape is pinned
 * in catalog-operational.test.ts instead.
 *
 * QAFIX-07 exception (live QA §3.31 / §4 item 6): service 31's date of
 * death was hidden by the same optradio grouping as services 4 and 7 —
 * the core fact of a death certificate. From v5 it is always visible
 * and required; the toggle governs only the registration reference
 * and religion document, as on service 7. Service 31 therefore leaves
 * the opt-in cases below and the optradio-conditioning list (which is
 * now empty: every optradio-governed core field has been unhidden);
 * its new shape and its pinned v3/v2 history are pinned in
 * catalog-operational.test.ts instead. Service 35 leaves the opt-in
 * cases in the same release: its marital_status_radio checkbox is
 * removed and the marital status is always visible (see the
 * catalog-operational QAFIX-07 test).
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
    // Service 23 left this list in QAFIX-05: both of its checkboxes were
    // removed, so there is no toggle left to leave untouched.
    // Service 29 left this list in QAFIX-06 for the same reason.
    [31, ["optradio"]],
    // Service 35 left this list in QAFIX-07: its marital-status
    // checkbox was removed, so there is no toggle left to leave
    // untouched.
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
    // optradio-governed groups (schema v3). Service 4's date of death is
    // deliberately absent here: QAFIX-02 unhid it (see the dedicated test
    // below) — it is core evidence, not an opt-in extra. Service 7's date
    // of death is likewise absent: QAFIX-03 unhid it (dedicated test).
    // Service 23's optradio case is absent too: QAFIX-05 removed the
    // toggle and unhid the profession pair outright. Service 29's
    // optradio case is absent for the same reason (QAFIX-06). Service
    // 31's optradio case is absent too: QAFIX-07 unhid its date of
    // death (dedicated test in catalog-operational.test.ts). Service
    // 35's marital-status case is absent: QAFIX-07 removed its toggle
    // and unhid the marital status outright.
    // checkbox-governed groups (engine rule + existing visibleWhen)
    [20, { other_freedom_fighter: true }, "other_freedom_fighter_name"],
    // QAFIX-05: service 23's earner is a select now — choosing another
    // person makes the earner's name required.
    [23, { income_earner: "other_person" }, "other_person_name"],
    // QAFIX-06: service 29's earner is a select now, the same way.
    [29, { income_earner: "other_person" }, "other_person_name"],
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
    // Service 23 left this list in QAFIX-05: its profession pair is
    // unconditionally visible now (see the dedicated test in
    // catalog-operational.test.ts). Service 29 left it in QAFIX-06
    // for the same reason. Service 31 left it in QAFIX-07: its date
    // of death is unconditionally visible now (dedicated test in
    // catalog-operational.test.ts, which also pins the v3/v2 history
    // this loop used to assert). The list is empty: no optradio-
    // governed core field remains at any service's latest version.
  ];
  for (const [no, dependent] of groups) {
    // CERT-REFINE-01 and QAFIX-01 each published one further version of
    // every service; the conditioning structure asserted here is carried
    // over unchanged.
    assert.equal(getServiceSchema(no).version, 4, `service ${no} latest`);
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

test("QAFIX-02: service 4's date of death is always visible and required; the toggle keeps only the optional extras", () => {
  assert.equal(getServiceSchema(4).version, 6);
  const current = flattenFields(getServiceSchema(4));
  const dod = current.find((field) => field.id === "warish_info_dod");
  assert.equal(dod?.visibleWhen, undefined, "death date must not be hidden");
  assert.equal(dod?.constraints?.required, true);
  // Without the toggle and without the date, validation must demand it.
  const missing = validateServicePayload(4, strip(getDemoPayload(4), "warish_info_dod", "optradio"));
  assert.ok(
    missing.issues.some(
      (issue) => issue.path === "warish_info_dod" && issue.code === "required",
    ),
    "death date is required even when the opt-in group is off",
  );
  // The optional extras stay behind the toggle.
  const registerNo = current.find((field) => field.id === "warish_info_register_no");
  assert.deepEqual(registerNo?.visibleWhen, { field: "optradio", equals: true });
  // History is preserved: v3 (the Phase 4 version) did condition the date,
  // and v2 never did.
  const v3 = flattenFields(getServiceSchema(4, 3)).find(
    (field) => field.id === "warish_info_dod",
  );
  assert.deepEqual(v3?.visibleWhen, { field: "optradio", equals: true });
  const v2 = flattenFields(getServiceSchema(4, 2)).find(
    (field) => field.id === "warish_info_dod",
  );
  assert.equal(v2?.visibleWhen, undefined);
});

test("QAFIX-03: service 7's date of death is always visible and required; the toggle keeps only the optional extras", () => {
  assert.equal(getServiceSchema(7).version, 5);
  const current = flattenFields(getServiceSchema(7));
  const dod = current.find((field) => field.id === "dead_info_dod");
  assert.equal(dod?.visibleWhen, undefined, "death date must not be hidden");
  assert.equal(dod?.constraints?.required, true);
  // Without the toggle and without the date, validation must demand it.
  const missing = validateServicePayload(7, strip(getDemoPayload(7), "dead_info_dod", "optradio"));
  assert.ok(
    missing.issues.some(
      (issue) => issue.path === "dead_info_dod" && issue.code === "required",
    ),
    "death date is required even when the opt-in group is off",
  );
  // The optional extras stay behind the toggle.
  const registerNo = current.find((field) => field.id === "dead_info_register_no");
  assert.deepEqual(registerNo?.visibleWhen, { field: "optradio", equals: true });
  const religion = current.find((field) => field.id === "dead_attachment_religion_id");
  assert.deepEqual(religion?.visibleWhen, { field: "optradio", equals: true });
  // The relationship label names the deceased.
  const relation = current.find((field) => field.id === "dead_info_relation");
  assert.equal(relation?.label.en, "Relationship with the deceased");
  // History is preserved: v3 (the Phase 4 version) did condition the date,
  // and v2 never did.
  const v3 = flattenFields(getServiceSchema(7, 3)).find(
    (field) => field.id === "dead_info_dod",
  );
  assert.deepEqual(v3?.visibleWhen, { field: "optradio", equals: true });
  const v2 = flattenFields(getServiceSchema(7, 2)).find(
    (field) => field.id === "dead_info_dod",
  );
  assert.equal(v2?.visibleWhen, undefined);
});

test("QAFIX-06: service 29's income amount is required from v5; Finding B's optionality stays pinned to v3/v4", () => {
  // Finding B made the amount optional from v3; QAFIX-06 (§3.29)
  // reverses that for the current version — the amount is the
  // certificate's central fact — while the pinned versions keep
  // their exact published behaviour.
  const no = 29;
  const withoutAmount = strip(getDemoPayload(no), "income_info_amount");
  const current = validateServicePayload(no, withoutAmount);
  assert.ok(
    current.issues.some(
      (issue) => issue.path === "income_info_amount" && issue.code === "required",
    ),
    "the current version demands the amount",
  );
  const field = flattenFields(getServiceSchema(no)).find(
    (item) => item.id === "income_info_amount",
  );
  assert.equal(field?.constraints?.required, true);
  // The pinned v3 keeps Finding B's optional amount. (Era payloads
  // are synthesised from the era schemas: a current-shaped payload
  // carries fields the pinned versions reject as unknown.)
  const v3WithoutAmount = strip(
    createSyntheticPayload(getServiceSchema(no, 3)),
    "income_info_amount",
  );
  assert.equal(validateServicePayload(no, v3WithoutAmount, 3).valid, true);
  // The pinned v2 keeps the amount required, byte-for-byte in behaviour.
  const v2WithoutAmount = strip(
    createSyntheticPayload(getServiceSchema(no, 2)),
    "income_info_amount",
  );
  const pinned = validateServicePayload(no, v2WithoutAmount, 2);
  assert.ok(
    pinned.issues.some(
      (issue) =>
        issue.path === "income_info_amount" && issue.code === "required",
    ),
  );
  // A supplied amount is still range-validated on the current version.
  const supplied = validateServicePayload(no, {
    ...getDemoPayload(no),
    income_info_amount: -5,
  });
  assert.ok(
    supplied.issues.some(
      (issue) => issue.path === "income_info_amount" && issue.code === "range",
    ),
  );
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
