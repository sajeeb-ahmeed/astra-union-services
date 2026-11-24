import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  demoPayloads,
  flattenFields,
  getCatalogPreviewSchema,
  getDemoPayload,
  getServiceSchema,
  allServiceSchemaVersions,
  geographySelectorServices,
  legacyLocationFieldIds,
  legacyOperationalSchemas,
  operationalServiceNumbers,
  serviceCatalog,
  stableSchemaJson,
  validateServicePayload,
  validateForm,
  type FieldDefinition,
} from "../src/index.js";
import { createSyntheticPayload } from "../src/expanded-schemas.js";

function descend(
  fields: readonly FieldDefinition[],
): readonly FieldDefinition[] {
  return fields.flatMap((field) => [field, ...descend(field.children ?? [])]);
}

// Each case exercises the actual distinct service contract rather than trusting the fixture generator.
for (const service of serviceCatalog) {
  test(`Service ${service.service_no}: ${service.name_en} accepts synthetic data and rejects missing, untrusted, or mistyped facts`, () => {
    const no = service.service_no;
    const schema = getServiceSchema(no);
    const valid = getDemoPayload(no);
    assert.equal(schema.stage, "operational_demo");
    assert.deepEqual(validateServicePayload(no, valid), {
      valid: true,
      issues: [],
    });
    assert.equal(validateServicePayload(no, {}).valid, false);
    const untrusted = validateServicePayload(no, {
      ...valid,
      tenant_id: "another-tenant",
      approval_status: "APPROVED",
      payable_credit: 0,
    });
    assert.deepEqual(
      untrusted.issues
        .filter((issue) => issue.code === "unknown_field")
        .map((issue) => issue.path)
        .sort(),
      ["approval_status", "payable_credit", "tenant_id"],
    );
    const selected = flattenFields(schema).find(
      (field) =>
        field.constraints?.required &&
        Object.hasOwn(valid, field.id) &&
        field.id !== "confirmation" &&
        // Phase 4: an absent plain checkbox is a complete "no" answer, so it
        // can no longer serve as the missing-required-field probe. The
        // mustBeTrue declaration is probed separately below.
        field.type !== "checkbox",
    )!;
    assert.ok(
      selected,
      "a meaningful required service or application field exists",
    );
    const missing = { ...valid };
    delete missing[selected.id];
    assert.ok(
      validateServicePayload(no, missing).issues.some(
        (issue) => issue.path === selected.id && issue.code === "required",
      ),
    );
    const wrongValue =
      selected.type === "repeatable"
        ? "not rows"
        : selected.type === "checkbox"
          ? "true"
          : selected.type === "number"
            ? "not a number"
            : 123;
    assert.ok(
      validateServicePayload(no, {
        ...valid,
        [selected.id]: wrongValue,
      }).issues.some((issue) => issue.path === selected.id),
    );
    assert.ok(
      validateServicePayload(no, { ...valid, confirmation: false }).issues.some(
        (issue) => issue.code === "confirmation",
      ),
    );
    for (const field of descend(flattenFields(schema))) {
      assert.ok(field.label.bn && field.label.en);
      assert.ok(Object.isFrozen(field));
    }
  });
}

test("all operational service numbers are unique and samples are isolated mutable copies", () => {
  assert.deepEqual(
    operationalServiceNumbers,
    Array.from({ length: 47 }, (_, index) => index + 1),
  );
  assert.equal(Object.keys(demoPayloads).length, 47);
  const first = getDemoPayload(3);
  (first.heirs as Record<string, unknown>[])[0].warish_heir_name = "Changed";
  assert.notDeepEqual(first, getDemoPayload(3));
  assert.throws(() => getDemoPayload(48), RangeError);
});

test("the original three version-one contracts retain their exact published canonical hashes", () => {
  const hashes: Record<number, string> = {
    2: "5470ebc2b3a72d05b5c0ce7e89d59d7c93befe14db6c6ed21135eac77617e679",
    42: "19a8b45cb9bc9d9ad82ddcafd0b0b288d87d29e280e0ad0784a05ae1f196094d",
    45: "7810665b1ca65b921a90a2b7ea6ed29f047434eae97dd324436d05ae26b116e7",
  };
  for (const [no, expected] of Object.entries(hashes))
    assert.equal(
      createHash("sha256")
        .update(stableSchemaJson(getServiceSchema(Number(no), 1)))
        .digest("hex"),
      expected,
    );
});

test("published historical versions remain pinned while new applications select current versions", () => {
  assert.equal(legacyOperationalSchemas.length, 44);
  // 44 legacy v1 + trade/family v1 + 3 superseded v2 (geography release)
  // + 5 superseded v2 (Phase 4 conditional-group release) + 47 current
  // + 29 CERT-REFINE-01 versions (new published version per refined
  // service; every pre-refine version stays pinned and unchanged)
  // + 47 superseded pre-QAFIX-01 versions + 47 QAFIX-01 versions
  // + QAFIX-02 template repairs (one new version per repaired service;
  // each repaired service's QAFIX-01 version stays pinned)
  // + QAFIX-03 repairs (one new version per repaired service; each
  // repaired service's previous version stays pinned)
  // + QAFIX-04 repairs (one new version per repaired service; services
  // 13 and 15 were verified without change and publish no version).
  // + QAFIX-05 repairs (one new version per repaired service; services
  // land one at a time, so the list grows with each form).
  // + QAFIX-06 repairs (one new version per repaired service; services
  // land one at a time, so the list grows with each form).
  // + QAFIX-07 repairs (one new version per repaired service; services
  // land one at a time, so the list grows with each form).
  // + QAFIX-08 repairs (one new version per repaired service; services
  // land one at a time, so the list grows with each form).
  // + QAFIX-09 repairs (one new version per repaired service; services
  // land one at a time, so the list grows with each form).
  assert.equal(allServiceSchemaVersions.length, 220);
  assert.equal(
    new Set(
      allServiceSchemaVersions.map(
        (schema) => `${schema.serviceNo}:${schema.version}`,
      ),
    ).size,
    220,
  );
  for (const historical of legacyOperationalSchemas) {
    assert.equal(historical.version, 1);
    assert.equal(
      stableSchemaJson(getServiceSchema(historical.serviceNo, 1)),
      stableSchemaJson(historical),
    );
    // CERT-REFINE-01 published one new version for each refined service;
    // the pre-refine latest below was 3 for the Phase-4/geography set and
    // 2 for the rest, and refined services sit one version above that.
    // QAFIX-01 then published one new version for EVERY service (+1),
    // QAFIX-02 one more for each template-repaired service (mirrors
    // qaFix2Services in expanded-schemas.ts; service 2 is hand-authored
    // and outside this loop), and QAFIX-03 one more for each service it
    // repairs (mirrors qaFix3Services), and QAFIX-04 one more for each
    // service it repairs (mirrors qaFix4Services), and QAFIX-05 one more
    // for each service it repairs (mirrors qaFix5Services), and QAFIX-06
    // one more for each service it repairs (mirrors qaFix6Services),
    // and QAFIX-07 one more for each service it repairs (mirrors
    // qaFix7Services), and QAFIX-08 one more for each service it
    // repairs (mirrors qaFix8Services), and QAFIX-09 one more for
    // each service it repairs (mirrors qaFix9Services).
    const wasV3 = [36, 41, 4, 7, 23, 29, 31];
    const refined = [
      1, 3, 4, 5, 6, 10, 11, 13, 16, 18, 19, 20, 21, 24, 25, 26, 30, 32, 36,
      37, 38, 39, 40, 41, 43, 44, 46,
    ];
    const qaFix2 = [2, 3, 4, 5];
    const qaFix3 = [7, 8, 9, 10, 11, 12];
    const qaFix4 = [14, 16, 17, 18];
    const qaFix5 = [19, 20, 21, 22, 23, 24];
    const qaFix6 = [25, 26, 27, 28, 29, 30];
    const qaFix7 = [31, 32, 33, 34, 35, 36];
    const qaFix8 = [37, 38, 39, 40, 41, 42];
    const qaFix9 = [43, 44, 45, 46, 47];
    assert.equal(
      getServiceSchema(historical.serviceNo).version,
      (wasV3.includes(historical.serviceNo) ? 3 : 2) +
        (refined.includes(historical.serviceNo) ? 1 : 0) +
        1 +
        (qaFix2.includes(historical.serviceNo) ? 1 : 0) +
        (qaFix3.includes(historical.serviceNo) ? 1 : 0) +
        (qaFix4.includes(historical.serviceNo) ? 1 : 0) +
        (qaFix5.includes(historical.serviceNo) ? 1 : 0) +
        (qaFix6.includes(historical.serviceNo) ? 1 : 0) +
        (qaFix7.includes(historical.serviceNo) ? 1 : 0) +
        (qaFix8.includes(historical.serviceNo) ? 1 : 0) +
        (qaFix9.includes(historical.serviceNo) ? 1 : 0),
    );
    assert.throws(() => getServiceSchema(historical.serviceNo, 99), RangeError);
  }
  assert.equal(getServiceSchema(42).version, 6);
  assert.equal(getServiceSchema(2).version, 5);
  // QAFIX-09 published v3 of the hand-authored service 45.
  assert.equal(getServiceSchema(45).version, 3);
});

test("trade v2 maps all 37 captured fields, keeps v1 payloads valid and validates optional expanded facts", () => {
  const schema = getServiceSchema(42, 2);
  const source = serviceCatalog.find((service) => service.service_no === 42)!;
  const mapped = new Set(
    descend(flattenFields(schema)).flatMap(
      (field) => field.evidence?.fieldNames ?? [],
    ),
  );
  assert.equal(source.service_specific_visible_field_names.length, 37);
  for (const field of source.service_specific_visible_field_names)
    assert.ok(mapped.has(field), field);
  // QAFIX-08: the current fixture also carries the purpose-and-
  // language fields v6 added; v1/v2 payloads predate them, so the
  // pinned-version checks use the fixture without those keys.
  const corePayload: Record<string, unknown> = { ...getDemoPayload(42) };
  for (const key of [
    "address_source",
    "purpose",
    "purpose_language",
    "delivery_language",
  ])
    delete corePayload[key];
  assert.equal(validateServicePayload(42, corePayload, 1).valid, true);
  assert.equal(validateServicePayload(42, corePayload, 2).valid, true);
  const expanded = {
    ...corePayload,
    proprietor_mother_name_bn: "নমুনা মাতা",
    proprietor_mother_name: "Sample Mother",
    proprietor_father_name_bn: "নমুনা পিতা",
    proprietor_father_name: "Sample Father",
    proprietor_spouse_name_bn: "নমুনা সঙ্গী",
    proprietor_spouse_name: "Sample Spouse",
    trade_license_email: "proprietor@example.test",
    trade_license_org_type_bn: "নমুনা প্রতিষ্ঠান",
    trade_license_org_type: "Demo enterprise",
    trade_license_type: "commercial",
    trade_license_tin_no: "DEMO-TIN",
    trade_license_bin_no: "DEMO-BIN",
    trade_license_org_zone_bn: "নমুনা অঞ্চল",
    trade_license_org_zone: "Demo zone",
    trade_license_org_zone_ward: 1,
    trade_license_capital: 10000,
    trade_license_org_add_type: "union",
    trade_license_org_division: "Demo division",
    district_id: "Demo district",
    thana_id: "Demo subdistrict",
    additional_thana_id: "Demo police station",
    post_office_id: "Demo post office",
    union_id: "Demo union",
    trade_license_org_ward_no: 2,
  };
  assert.deepEqual(validateServicePayload(42, expanded, 2), {
    valid: true,
    issues: [],
  });
  assert.ok(
    validateServicePayload(42, expanded, 1).issues.some(
      (issue) => issue.code === "unknown_field",
    ),
  );
  assert.ok(
    validateServicePayload(
      42,
      { ...expanded, trade_license_capital: -1 },
      2,
    ).issues.some((issue) => issue.code === "range"),
  );
  assert.ok(
    validateServicePayload(
      42,
      { ...expanded, trade_license_email: "invalid" },
      2,
    ).issues.some((issue) => issue.code === "format"),
  );
  assert.ok(
    validateServicePayload(
      42,
      { ...expanded, trade_license_org_zone_ward: 1.5 },
      2,
    ).issues.some((issue) => issue.code === "integer"),
  );
  assert.ok(
    validateServicePayload(
      42,
      { ...expanded, municipality_id: "stale municipality" },
      2,
    ).issues.some((issue) => issue.code === "inactive_field"),
  );
});

test("family v2 maps all 20 captured fields inside one member array while preserving v1 payloads", () => {
  const schema = getServiceSchema(2, 2);
  const source = serviceCatalog.find((service) => service.service_no === 2)!;
  const mapped = new Set(
    descend(flattenFields(schema)).flatMap(
      (field) => field.evidence?.fieldNames ?? [],
    ),
  );
  assert.equal(source.service_specific_visible_field_names.length, 20);
  for (const field of source.service_specific_visible_field_names)
    assert.ok(mapped.has(field), field);
  const memberFields = flattenFields(schema).filter(
    (field) => field.id === "members",
  );
  assert.equal(memberFields.length, 1);
  assert.equal(
    new Set(memberFields[0].children!.map((field) => field.id)).size,
    memberFields[0].children!.length,
  );
  const base = getDemoPayload(2);
  // QAFIX-02: the demo fixture now carries the v5 order fields
  // (address_source/purpose/purpose_language/delivery_language), which
  // v1/v2 rightly reject as unknown. The historical assertions below use
  // the same fixture minus those fields — a genuine v1-era payload.
  const {
    address_source: _addressSource,
    purpose: _purpose,
    purpose_language: _purposeLanguage,
    delivery_language: _deliveryLanguage,
    ...historicalBase
  } = base;
  assert.equal(validateServicePayload(2, historicalBase, 1).valid, true);
  assert.equal(validateServicePayload(2, historicalBase, 2).valid, true);
  // The full fixture validates against the current (QAFIX-02) version.
  assert.equal(validateServicePayload(2, base).valid, true);
  const member = (base.members as Record<string, unknown>[])[0];
  const expanded = {
    ...historicalBase,
    warish_info_father_name_bn: "নমুনা পিতা",
    warish_info_father_name: "Demo Father",
    warish_info_mother_name_bn: "নমুনা মাতা",
    warish_info_mother_name: "Demo Mother",
    warish_info_spouse_name_bn: "নমুনা সঙ্গী",
    warish_info_spouse_name: "Demo Spouse",
    warish_info_dod: "2020-01-01",
    warish_info_register_no: "DEMO-REGISTER-2",
    members: [
      {
        ...member,
        warish_heir_nid: "DEMO-IDENTITY",
        warish_heir_father_name: "Demo Parent",
        warish_heir_comment: "নমুনা মন্তব্য",
        warish_heir_comment_en: "Demonstration comment",
      },
    ],
  };
  assert.deepEqual(validateServicePayload(2, expanded, 2), {
    valid: true,
    issues: [],
  });
  assert.ok(
    validateServicePayload(2, expanded, 1).issues.some(
      (issue) => issue.code === "unknown_field",
    ),
  );
  assert.ok(
    validateServicePayload(
      2,
      { ...expanded, warish_info_dod: "2020-02-30" },
      2,
    ).issues.some((issue) => issue.code === "date"),
  );
  assert.ok(
    validateServicePayload(
      2,
      {
        ...expanded,
        members: [
          {
            ...expanded.members[0],
            is_minor: true,
            guardian_name_bn: "নমুনা অভিভাবক",
          },
        ],
      },
      2,
    ).issues.some(
      (issue) =>
        issue.path === "members[0].warish_heir_nid" &&
        issue.code === "inactive_field",
    ),
  );
  assert.ok(
    validateServicePayload(
      2,
      {
        ...expanded,
        members: [{ ...member, warish_heir_comment_en: "x".repeat(251) }],
      },
      2,
    ).issues.some(
      (issue) =>
        issue.path === "members[0].warish_heir_comment_en" &&
        issue.code === "max_length",
    ),
  );
});

test("all 47 operational schemas map every observed service-specific field while retaining exact read-only reference previews", () => {
  const specificNames = serviceCatalog.flatMap(
    (service) => service.service_specific_visible_field_names,
  );
  assert.equal(specificNames.length, 340);
  assert.equal(new Set(specificNames).size, 206);
  // QAFIX-02 removes observed fields the 2026-11-23 live QA proved wrong
  // (service 2: the member-row father-name duplicate; service 5: the whole
  // warish heir list, including its required deceased-person field, which
  // never belonged on a power of attorney). A removed name must NOT be
  // mapped by the latest schema; every other observed name must.
  const qaFix2RemovedObserved: Record<number, readonly string[]> = {
    2: ["warish_heir_father_name[]"],
    5: [
      "dead_person_name[]",
      "guardian_name[]",
      "warish_heir_age_flag[]",
      "warish_heir_comment[]",
      "warish_heir_comment_en[]",
      "warish_heir_dob[]",
      "warish_heir_mobile_no[]",
      "warish_heir_name[]",
      "warish_heir_name_bn[]",
      "warish_heir_nid[]",
      "warish_heir_relation[]",
    ],
  };
  // QAFIX-03 removes the fields the same QA proved wrong on services 8/9
  // (service 8: the whole wrong template — land description, land-owner
  // details and the related-people list; service 9: the deceased-person
  // field inside its related-people list).
  const qaFix3RemovedObserved: Record<number, readonly string[]> = {
    8: [
      "land_info_bn",
      "land_info_en",
      "land_owner_info_bn",
      "land_owner_info_en",
      "warish_heir_age_flag[]",
      "warish_heir_nid[]",
      "warish_heir_dob[]",
      "warish_heir_relation[]",
      "warish_heir_name[]",
      "warish_heir_name_bn[]",
      "dead_person_name[]",
      "warish_heir_mobile_no[]",
      "warish_heir_comment[]",
      "warish_heir_comment_en[]",
    ],
    9: ["dead_person_name[]"],
  };
  // QAFIX-05 removes the fields the same QA proved wrong on services
  // 19/22/23 (service 19: the applicant-name pair mislabelled as the
  // child's name — the certificate never prints it; service 22: the
  // dedicated consent-letter upload, folded into the guided documents
  // step; service 23: the optradio opt-in, whose profession fields are
  // now always visible). Later forms extend this record the same way.
  const qaFix5RemovedObserved: Record<number, readonly string[]> = {
    19: ["consent_applicant_name_bn", "consent_applicant_name_en"],
    22: ["application_parents_consent_letter"],
    23: ["optradio"],
  };
  // QAFIX-06 removes the fields the same QA proved wrong on services
  // 28/29 (service 28: the free-text witness box, replaced by a
  // structured witness name pair + NID; service 29: the optradio
  // opt-in, whose profession fields are now always visible).
  const qaFix6RemovedObserved: Record<number, readonly string[]> = {
    28: ["witness_details"],
    29: ["optradio"],
  };
  // QAFIX-07 removes the field the same QA proved wrong on service
  // 35: the marital_status_radio opt-in, whose marital status is
  // now always visible.
  const qaFix7RemovedObserved: Record<number, readonly string[]> = {
    35: ["marital_status_radio"],
  };
  // QAFIX-08 removes the family-name fields the same QA proved
  // irrelevant on service 42 (a trade licence attests a business,
  // not the proprietor's parents or spouse).
  const qaFix8RemovedObserved: Record<number, readonly string[]> = {
    42: [
      "proprietor_mother_name_bn",
      "proprietor_mother_name",
      "proprietor_father_name_bn",
      "proprietor_father_name",
      "proprietor_spouse_name_bn",
      "proprietor_spouse_name",
    ],
  };
  // QAFIX-09 removes the copied spouse-name pair from service 46
  // (a vehicle licence does not attest the proprietor's spouse).
  const qaFix9RemovedObserved: Record<number, readonly string[]> = {
    46: ["proprietor_spouse_name_bn", "proprietor_spouse_name"],
  };
  for (const service of serviceCatalog) {
    const fields = descend(flattenFields(getServiceSchema(service.service_no)));
    const mapped = new Set(
      fields.flatMap((field) => field.evidence?.fieldNames ?? []),
    );
    const removed = [
      ...(qaFix2RemovedObserved[service.service_no] ?? []),
      ...(qaFix3RemovedObserved[service.service_no] ?? []),
      ...(qaFix5RemovedObserved[service.service_no] ?? []),
      ...(qaFix6RemovedObserved[service.service_no] ?? []),
      ...(qaFix7RemovedObserved[service.service_no] ?? []),
      ...(qaFix8RemovedObserved[service.service_no] ?? []),
      ...(qaFix9RemovedObserved[service.service_no] ?? []),
    ];
    for (const name of service.service_specific_visible_field_names)
      if (removed.includes(name))
        assert.ok(!mapped.has(name), `${service.service_no}: ${name} removed`);
      else assert.ok(mapped.has(name), `${service.service_no}: ${name}`);
    assert.equal(
      getCatalogPreviewSchema(service.service_no).stage,
      "catalog_preview",
    );
    assert.equal(getCatalogPreviewSchema(service.service_no).version, 0);
    for (const field of fields)
      assert.notEqual(
        field.evidence?.status,
        "observed",
        "operational choices must never claim source-server validation",
      );
  }
});

test("heirs enforce row limits, required identity facts, guardian conditions and inactive adult references", () => {
  // Service 5 left this set in QAFIX-02: its heir list was removed (see
  // the dedicated test below). Service 8 left it in QAFIX-03: its whole
  // wrong template, heir list included, was removed (dedicated test
  // below). Services 3, 4, 9 keep the component.
  for (const no of [3, 4, 9]) {
    const payload = getDemoPayload(no);
    const row = (payload.heirs as Record<string, unknown>[])[0];
    assert.ok(
      validateServicePayload(no, { ...payload, heirs: [] }).issues.some(
        (issue) => issue.code === "min_rows",
      ),
    );
    assert.ok(
      validateServicePayload(no, {
        ...payload,
        heirs: Array(31).fill(row),
      }).issues.some((issue) => issue.code === "max_rows"),
    );
    assert.ok(
      validateServicePayload(no, {
        ...payload,
        heirs: [{ ...row, warish_heir_name_bn: "" }],
      }).issues.some((issue) => issue.path === "heirs[0].warish_heir_name_bn"),
    );
    const minor = { ...row, warish_heir_age_flag: "minor" };
    assert.ok(
      validateServicePayload(no, { ...payload, heirs: [minor] }).issues.some(
        (issue) => issue.path === "heirs[0].guardian_name",
      ),
    );
    const complete = { ...minor, guardian_name: "Demo Guardian" };
    assert.equal(
      validateServicePayload(no, { ...payload, heirs: [complete] }).valid,
      true,
    );
    assert.ok(
      validateServicePayload(no, {
        ...payload,
        heirs: [{ ...complete, warish_heir_nid: "DEMO-IDENTITY" }],
      }).issues.some((issue) => issue.code === "inactive_field"),
    );
  }
});

test("QAFIX-02: service 5 (power of attorney) carries no heir list and no deceased-person field", () => {
  assert.equal(getServiceSchema(5).version, 5);
  const fields = flattenFields(getServiceSchema(5));
  assert.ok(!fields.some((field) => field.id === "heirs"), "no heirs repeatable");
  assert.ok(
    !fields.some((field) => field.id === "dead_person_name"),
    "no deceased-person field",
  );
  // The demo payload validates as-is — no "প্রযোজ্য নয়" workaround exists
  // or is needed — and a payload that still carries heirs is rejected.
  const payload = getDemoPayload(5);
  assert.ok(!("heirs" in payload), "demo payload carries no heirs");
  assert.equal(validateServicePayload(5, payload).valid, true);
  assert.ok(
    validateServicePayload(5, { ...payload, heirs: [] }).issues.some(
      (issue) => issue.code === "unknown_field",
    ),
    "a stale heirs key is an unknown field on the current version",
  );
  // The pinned QAFIX-01 version keeps the heir list for its applications.
  assert.ok(
    flattenFields(getServiceSchema(5, 4)).some((field) => field.id === "heirs"),
  );
});

test("QAFIX-03: service 8 (not-Rohingya attestation) carries no land, land-owner or deceased-person fields", () => {
  assert.equal(getServiceSchema(8).version, 4);
  const fields = flattenFields(getServiceSchema(8));
  for (const gone of [
    "land_info_bn",
    "land_info_en",
    "land_owner_info_bn",
    "land_owner_info_en",
    "heirs",
    "dead_person_name",
  ])
    assert.ok(
      !fields.some((field) => field.id === gone),
      `service 8 must not carry ${gone}`,
    );
  // The demo payload validates as-is — no "প্রযোজ্য নয়" workaround exists
  // or is needed — and a payload that still carries the old template's
  // fields is rejected.
  const payload = getDemoPayload(8);
  assert.ok(!("heirs" in payload), "demo payload carries no heirs");
  assert.ok(!("land_info_bn" in payload), "demo payload carries no land fields");
  assert.equal(validateServicePayload(8, payload).valid, true);
  assert.ok(
    validateServicePayload(8, { ...payload, land_info_bn: "x" }).issues.some(
      (issue) => issue.code === "unknown_field",
    ),
    "a stale land field is an unknown field on the current version",
  );
  // The pinned QAFIX-01 version keeps the old template for its applications.
  const pinned = flattenFields(getServiceSchema(8, 3));
  assert.ok(pinned.some((field) => field.id === "land_info_bn"));
  assert.ok(pinned.some((field) => field.id === "heirs"));
});

test("QAFIX-03: service 9 (voter verification) related-people rows carry no deceased-person field", () => {
  assert.equal(getServiceSchema(9).version, 4);
  const heirs = flattenFields(getServiceSchema(9)).find(
    (field) => field.id === "heirs",
  );
  assert.ok(heirs, "the related-people list itself stays");
  assert.ok(
    !(heirs.children ?? []).some((child) => child.id === "dead_person_name"),
    "no deceased-person field in the rows",
  );
  // The demo payload validates as-is, and a row that still carries the
  // deceased field is rejected.
  const payload = getDemoPayload(9);
  assert.equal(validateServicePayload(9, payload).valid, true);
  const row = (payload.heirs as Record<string, unknown>[])[0];
  assert.ok(
    validateServicePayload(9, {
      ...payload,
      heirs: [{ ...row, dead_person_name: "Stale Name" }],
    }).issues.some(
      (issue) =>
        issue.path === "heirs[0].dead_person_name" &&
        issue.code === "unknown_field",
    ),
    "a stale deceased-person key is an unknown field on the current version",
  );
  // The pinned QAFIX-01 version keeps the field for its applications.
  const pinnedHeirs = flattenFields(getServiceSchema(9, 3)).find(
    (field) => field.id === "heirs",
  );
  assert.ok(
    (pinnedHeirs?.children ?? []).some(
      (child) => child.id === "dead_person_name",
    ),
  );
});

test("QAFIX-03: service 10 (unemployment) asks for a previous occupation only from citizens who have worked", () => {
  assert.equal(getServiceSchema(10).version, 5);
  const fields = flattenFields(getServiceSchema(10));
  const history = fields.find((field) => field.id === "employment_history");
  assert.equal(history?.type, "select");
  assert.deepEqual(
    (history?.options ?? []).map((option) => option.value),
    ["previously_employed", "never_employed"],
  );
  for (const gated of ["last_occupation", "last_occupation_en", "unemployed_since"])
    assert.deepEqual(
      fields.find((field) => field.id === gated)?.visibleWhen,
      { field: "employment_history", equals: "previously_employed" },
      `${gated} is shown only for previously-employed citizens`,
    );
  // Previously employed (the demo payload's path): everything validates.
  const payload = getDemoPayload(10);
  assert.equal(payload.employment_history, "previously_employed");
  assert.equal(validateServicePayload(10, payload).valid, true);
  // …and the previous occupation stays required on that path.
  const workedNoOccupation: Record<string, unknown> = { ...payload };
  delete workedNoOccupation.last_occupation;
  assert.ok(
    validateServicePayload(10, workedNoOccupation).issues.some(
      (issue) => issue.path === "last_occupation" && issue.code === "required",
    ),
  );
  // Never employed: no occupation facts are asked for or needed…
  const never: Record<string, unknown> = {
    ...payload,
    employment_history: "never_employed",
  };
  delete never.last_occupation;
  delete never.last_occupation_en;
  delete never.unemployed_since;
  assert.equal(validateServicePayload(10, never).valid, true);
  // …and a stale occupation value on that path is inactive.
  assert.ok(
    validateServicePayload(10, { ...never, last_occupation: "Tailor" }).issues.some(
      (issue) => issue.path === "last_occupation" && issue.code === "inactive_field",
    ),
  );
  // The pinned QAFIX-01 version has no employment-history choice and
  // keeps the occupation unconditionally required.
  assert.ok(
    !flattenFields(getServiceSchema(10, 4)).some(
      (field) => field.id === "employment_history",
    ),
  );
});

test("QAFIX-03: service 11 (nationality) takes the declared nationality and basis of claim from closed selects", () => {
  assert.equal(getServiceSchema(11).version, 5);
  const fields = flattenFields(getServiceSchema(11));
  const nationality = fields.find((field) => field.id === "claimed_nationality");
  assert.equal(nationality?.type, "select");
  assert.deepEqual(
    (nationality?.options ?? []).map((option) => option.value),
    [
      "bangladeshi",
      "indian",
      "pakistani",
      "nepali",
      "myanmar",
      "chinese",
      "british",
      "american",
      "other",
    ],
  );
  assert.ok(
    !fields.some((field) => field.id === "claimed_nationality_en"),
    "the English text twin is gone — the select carries both languages",
  );
  const basis = fields.find((field) => field.id === "nationality_basis");
  assert.equal(basis?.type, "select");
  assert.deepEqual(
    (basis?.options ?? []).map((option) => option.value),
    ["birth", "parents", "certificate", "marriage", "other"],
  );
  // The demo payload validates; anything outside the lists is refused.
  const payload = getDemoPayload(11);
  assert.equal(validateServicePayload(11, payload).valid, true);
  assert.ok(
    validateServicePayload(11, { ...payload, claimed_nationality: "martian" }).issues.some(
      (issue) => issue.path === "claimed_nationality" && issue.code === "option",
    ),
    "an undeclared nationality cannot be typed in",
  );
  assert.ok(
    validateServicePayload(11, { ...payload, nationality_basis: "whatever I type" }).issues.some(
      (issue) => issue.path === "nationality_basis" && issue.code === "option",
    ),
    "a free-text basis cannot be typed in",
  );
  assert.ok(
    validateServicePayload(11, { ...payload, claimed_nationality_en: "Indian" }).issues.some(
      (issue) => issue.code === "unknown_field",
    ),
    "the removed English text field is an unknown field on the current version",
  );
  // The pinned QAFIX-01 version keeps the free-text pair for its applications.
  const pinned = flattenFields(getServiceSchema(11, 4));
  assert.equal(
    pinned.find((field) => field.id === "claimed_nationality")?.type,
    "text",
  );
  assert.ok(pinned.some((field) => field.id === "claimed_nationality_en"));
});

test("QAFIX-03: service 12 (citizenship) takes the basis of claim from the shared closed select", () => {
  assert.equal(getServiceSchema(12).version, 4);
  const basis = flattenFields(getServiceSchema(12)).find(
    (field) => field.id === "citizenship_basis",
  );
  assert.equal(basis?.type, "select");
  // The very list service 11 built (§4 item 9) — one pattern, reused.
  const svc11Basis = flattenFields(getServiceSchema(11)).find(
    (field) => field.id === "nationality_basis",
  );
  assert.deepEqual(basis?.options, svc11Basis?.options);
  assert.deepEqual(
    (basis?.options ?? []).map((option) => option.value),
    ["birth", "parents", "certificate", "marriage", "other"],
  );
  // The demo payload (basis "birth" — the value the certificate's
  // by-birth wording keys off) validates, as does any other listed code;
  // free text is refused.
  const payload = getDemoPayload(12);
  assert.equal(payload.citizenship_basis, "birth");
  assert.equal(validateServicePayload(12, payload).valid, true);
  assert.equal(
    validateServicePayload(12, { ...payload, citizenship_basis: "marriage" }).valid,
    true,
  );
  assert.ok(
    validateServicePayload(12, { ...payload, citizenship_basis: "জন্মসূত্রে পেয়েছি" }).issues.some(
      (issue) => issue.path === "citizenship_basis" && issue.code === "option",
    ),
    "a free-text basis cannot be typed in",
  );
  // The pinned QAFIX-01 version keeps the free-text field.
  assert.equal(
    flattenFields(getServiceSchema(12, 3)).find(
      (field) => field.id === "citizenship_basis",
    )?.type,
    "text",
  );
});

test("QAFIX-04: service 14 (landless) carries structured landlessness evidence, not one free-text box", () => {
  assert.equal(getServiceSchema(14).version, 4);
  const fields = flattenFields(getServiceSchema(14));
  // The single free-text declaration box is gone from the latest version.
  assert.ok(
    !fields.some((field) => field.id === "landless_declaration"),
    "no free-text declaration box",
  );
  const mouza = fields.find((field) => field.id === "residence_mouza");
  assert.equal(mouza?.type, "text");
  assert.equal(mouza?.constraints?.required, true);
  const holding = fields.find((field) => field.id === "residence_holding_no");
  assert.equal(holding?.type, "text");
  assert.equal(holding?.constraints?.required, false);
  const years = fields.find((field) => field.id === "residence_duration_years");
  assert.equal(years?.type, "number");
  assert.equal(years?.constraints?.required, true);
  // The declaration itself is now an active statement that must be given.
  const declaration = fields.find(
    (field) => field.id === "land_ownership_declaration",
  );
  assert.equal(declaration?.type, "checkbox");
  assert.equal(declaration?.constraints?.mustBeTrue, true);
  // The demo payload validates against the new version, and the
  // declaration cannot be skipped or negated.
  const payload = getDemoPayload(14);
  assert.equal(payload.land_ownership_declaration, true);
  assert.equal(validateServicePayload(14, payload).valid, true);
  assert.ok(
    validateServicePayload(14, {
      ...payload,
      land_ownership_declaration: false,
    }).issues.some((issue) => issue.path === "land_ownership_declaration"),
    "an unticked land-ownership declaration blocks the application",
  );
  assert.ok(
    validateServicePayload(14, { ...payload, residence_mouza: "" }).issues.some(
      (issue) => issue.path === "residence_mouza" && issue.code === "required",
    ),
  );
  // The pinned QAFIX-01 version keeps the free-text box for its applications.
  assert.equal(
    flattenFields(getServiceSchema(14, 3)).find(
      (field) => field.id === "landless_declaration",
    )?.type,
    "textarea",
  );
});

test("QAFIX-04: service 16 (widow) aligns the spouse-name pair and requires the death-certificate upload", () => {
  assert.equal(getServiceSchema(16).version, 5);
  const fields = flattenFields(getServiceSchema(16));
  // (§4 item 11) Both halves of the spouse-name pair are required.
  const bn = fields.find((field) => field.id === "deceased_spouse_name");
  const en = fields.find((field) => field.id === "deceased_spouse_name_en");
  assert.equal(bn?.constraints?.required, true);
  assert.equal(en?.constraints?.required, true);
  // (§4 item 5) The documents step names the required document and
  // demands at least one row of it.
  const docs = fields.find((field) => field.id === "supporting_documents");
  assert.equal(docs?.constraints?.minRows, 1);
  assert.match(docs?.description?.en ?? "", /death certificate/i);
  // The demo payload (no documents — fixtures never fake upload
  // handles) still validates: an absent optional repeatable is the
  // engine's documented shape; an explicitly empty list is rejected.
  const payload = getDemoPayload(16);
  assert.equal(validateServicePayload(16, payload).valid, true);
  assert.ok(
    validateServicePayload(16, { ...payload, supporting_documents: [] }).issues.some(
      (issue) => issue.path === "supporting_documents" && issue.code === "min_rows",
    ),
    "an emptied documents list cannot be submitted",
  );
  assert.ok(
    validateServicePayload(16, { ...payload, deceased_spouse_name_en: "" }).issues.some(
      (issue) => issue.path === "deceased_spouse_name_en" && issue.code === "required",
    ),
  );
  // The pinned QAFIX-01 version keeps the optional English name and
  // the unguided, row-less documents step.
  const pinned = flattenFields(getServiceSchema(16, 4));
  assert.equal(
    pinned.find((field) => field.id === "deceased_spouse_name_en")?.constraints?.required,
    false,
  );
  assert.equal(
    pinned.find((field) => field.id === "supporting_documents")?.constraints?.minRows,
    undefined,
  );
});

test("QAFIX-04: service 17 (profession) takes the profession from a closed select, not free text", () => {
  assert.equal(getServiceSchema(17).version, 4);
  const fields = flattenFields(getServiceSchema(17));
  // The Bangla/English text pair collapses into one bilingual select.
  assert.ok(!fields.some((field) => field.id === "profession_bn"), "no Bangla text twin");
  assert.ok(!fields.some((field) => field.id === "profession_en"), "no English text twin");
  const profession = fields.find((field) => field.id === "profession");
  assert.equal(profession?.type, "select");
  assert.equal(profession?.constraints?.required, true);
  assert.deepEqual(
    (profession?.options ?? []).map((option) => option.value),
    [
      "farmer", "teacher", "doctor", "engineer", "business",
      "government_employee", "private_employee", "lawyer", "journalist",
      "shopkeeper", "driver", "rickshaw_puller", "day_labourer",
      "fisherman", "weaver", "artisan", "homemaker", "student",
      "retired", "other",
    ],
  );
  // The select keeps the observed names of the two text fields it
  // replaces — the profession fact is the same data, captured better.
  assert.deepEqual(profession?.evidence?.fieldNames, [
    "profession_bn",
    "profession_en",
  ]);
  // The demo payload (first option, "farmer") validates, as does any
  // other listed code; free text is refused.
  const payload = getDemoPayload(17);
  assert.equal(payload.profession, "farmer");
  assert.equal(validateServicePayload(17, payload).valid, true);
  assert.equal(
    validateServicePayload(17, { ...payload, profession: "teacher" }).valid,
    true,
  );
  assert.ok(
    validateServicePayload(17, { ...payload, profession: "দর্জি" }).issues.some(
      (issue) => issue.path === "profession" && issue.code === "option",
    ),
    "a free-text profession cannot be typed in",
  );
  // The pinned QAFIX-01 version keeps the free-text pair.
  const pinned = flattenFields(getServiceSchema(17, 3));
  assert.equal(
    pinned.find((field) => field.id === "profession_bn")?.type,
    "text",
  );
  assert.equal(
    pinned.find((field) => field.id === "profession_en")?.type,
    "text",
  );
});

test("QAFIX-04: service 18 (community) takes the community from a closed select, not free text", () => {
  assert.equal(getServiceSchema(18).version, 5);
  const fields = flattenFields(getServiceSchema(18));
  // The Bangla/English text pair collapses into one bilingual select.
  assert.ok(!fields.some((field) => field.id === "community_name_en"), "no English text twin");
  const community = fields.find((field) => field.id === "community_name");
  assert.equal(community?.type, "select");
  assert.equal(community?.constraints?.required, true);
  assert.deepEqual(
    (community?.options ?? []).map((option) => option.value),
    [
      "chakma", "marma", "tripura", "tanchangya", "barua", "mro",
      "bawm", "khumi", "chak", "pankho", "lushei", "khyang", "garo",
      "hajong", "koch", "rajbanshi", "santal", "oraon", "munda",
      "khasi", "manipuri", "muslim", "hindu", "buddhist", "christian",
      "other",
    ],
  );
  // The select keeps the observed names of the two text fields it
  // replaces — the community fact is the same data, captured better.
  assert.deepEqual(community?.evidence?.fieldNames, [
    "community_name",
    "community_name_en",
  ]);
  // The demo payload (first option, "chakma") validates, as does any
  // other listed code; free text is refused.
  const payload = getDemoPayload(18);
  assert.equal(payload.community_name, "chakma");
  assert.equal(validateServicePayload(18, payload).valid, true);
  assert.equal(
    validateServicePayload(18, { ...payload, community_name: "muslim" }).valid,
    true,
  );
  assert.ok(
    validateServicePayload(18, { ...payload, community_name: "অচেনা" }).issues.some(
      (issue) => issue.path === "community_name" && issue.code === "option",
    ),
    "a free-text community cannot be typed in",
  );
  // The pinned QAFIX-01 version keeps the free-text pair.
  const pinned = flattenFields(getServiceSchema(18, 4));
  assert.equal(
    pinned.find((field) => field.id === "community_name")?.type,
    "text",
  );
  assert.equal(
    pinned.find((field) => field.id === "community_name_en")?.type,
    "text",
  );
});

test("QAFIX-05: service 19 (guardian consent) asks the child's name once and takes the relationship from the guardian list", () => {
  assert.equal(getServiceSchema(19).version, 5);
  const fields = flattenFields(getServiceSchema(19));
  // (§3.19 BLOCKER, §4 item 7) The duplicate pair is gone: the
  // applicant-name fields mislabelled as the child's name are removed —
  // the certificate never printed them (consentBody reads the child's
  // pair plus the guardian from the citizen record).
  assert.ok(
    !fields.some((field) => field.id === "consent_applicant_name_bn"),
    "no duplicate child's-name Bangla field",
  );
  assert.ok(
    !fields.some((field) => field.id === "consent_applicant_name_en"),
    "no duplicate child's-name English field",
  );
  // Exactly one child's-name pair remains, both halves required.
  const childBn = fields.find((field) => field.id === "consent_child_name_bn");
  const childEn = fields.find((field) => field.id === "consent_child_name_en");
  assert.equal(childBn?.constraints?.required, true);
  assert.equal(childEn?.constraints?.required, true);
  assert.equal(childBn?.label.bn, "সন্তানের নাম (বাংলা)");
  // (§4 item 8) The relationship is the guardian-appropriate closed
  // list — no "নিজ" or "স্বামী/স্ত্রী", and uncles, aunts and
  // grandparents are selectable instead of forced "অন্যান্য".
  const relation = fields.find(
    (field) => field.id === "consent_child_relation",
  );
  assert.equal(relation?.type, "select");
  assert.equal(relation?.constraints?.required, true);
  assert.deepEqual(
    (relation?.options ?? []).map((option) => option.value),
    ["parent", "grandparent", "uncle", "aunt", "sibling", "guardian", "other"],
  );
  assert.equal(
    relation?.options?.find((option) => option.value === "uncle")?.label.bn,
    "চাচা/মামা",
  );
  // The demo payload validates and carries the child's name once.
  const payload = getDemoPayload(19);
  assert.equal(validateServicePayload(19, payload).valid, true);
  assert.ok(!("consent_applicant_name_bn" in payload));
  assert.ok(!("consent_applicant_name_en" in payload));
  assert.equal(payload.consent_child_relation, "parent");
  assert.ok(
    validateServicePayload(19, { ...payload, consent_child_name_en: "" }).issues.some(
      (issue) => issue.path === "consent_child_name_en" && issue.code === "required",
    ),
    "an empty English child name is rejected",
  );
  // The pinned QAFIX-01 version keeps the duplicate pair and the copied
  // generic relationship list.
  const pinned = flattenFields(getServiceSchema(19, 4));
  assert.equal(
    pinned.find((field) => field.id === "consent_applicant_name_bn")?.label.bn,
    "সন্তানের নাম (বাংলায়)",
  );
  assert.deepEqual(
    (pinned
      .find((field) => field.id === "consent_child_relation")
      ?.options ?? []
    ).map((option) => option.value),
    ["self", "spouse", "child", "parent", "sibling", "other"],
  );
});

test("QAFIX-05: service 20 (freedom fighter) requires the gazette number and keeps the on-behalf checkbox as a real gate", () => {
  assert.equal(getServiceSchema(20).version, 5);
  const fields = flattenFields(getServiceSchema(20));
  // (§3.20, §4 item 6) The gazette number completes the verifiable
  // gazette identity: the ID number and the gazette type were already
  // required, the number was the missing piece.
  const gazetteNo = fields.find(
    (field) => field.id === "freedom_fighter_gazette_number",
  );
  assert.equal(gazetteNo?.constraints?.required, true);
  assert.equal(
    fields.find((field) => field.id === "freedom_fighter_id_number")
      ?.constraints?.required,
    true,
  );
  assert.equal(
    fields.find((field) => field.id === "freedom_fighter_gazette_option")
      ?.constraints?.required,
    true,
  );
  // The alternative identifiers stay optional — each prints when present,
  // and no citizen should have to invent one they do not have.
  for (const id of [
    "freedom_fighter_batch_number",
    "freedom_fighter_certificate_number",
    "freedom_fighter_muktibarta_number",
    "freedom_fighter_indian_gazette",
  ])
    assert.equal(
      fields.find((field) => field.id === id)?.constraints?.required,
      false,
      id,
    );
  // (a) The on-behalf checkbox gates its fields: they are required when
  // visible, invisible otherwise — a real gate, not a no-op.
  const toggle = fields.find(
    (field) => field.id === "other_freedom_fighter",
  );
  assert.equal(toggle?.type, "checkbox");
  for (const id of [
    "other_freedom_fighter_name_bn",
    "other_freedom_fighter_name",
    "other_freedom_fighter_relation",
  ]) {
    const field = fields.find((item) => item.id === id);
    assert.deepEqual(field?.visibleWhen, {
      field: "other_freedom_fighter",
      equals: true,
    });
    assert.equal(field?.constraints?.required, true, id);
  }
  // (c) The name pair is Bangla first and the gazette number sits with
  // its type, ahead of the documents group.
  const order = fields.map((field) => field.id);
  assert.ok(
    order.indexOf("other_freedom_fighter_name_bn") <
      order.indexOf("other_freedom_fighter_name"),
  );
  assert.ok(
    order.indexOf("freedom_fighter_gazette_number") <
      order.indexOf("supporting_documents"),
  );
  assert.ok(
    order.indexOf("freedom_fighter_gazette_option") <
      order.indexOf("freedom_fighter_gazette_number"),
  );
  // The demo payload validates; an empty gazette number is rejected,
  // and a ticked checkbox without a named fighter is rejected.
  const payload = getDemoPayload(20);
  assert.equal(validateServicePayload(20, payload).valid, true);
  assert.ok(
    validateServicePayload(20, {
      ...payload,
      freedom_fighter_gazette_number: "",
    }).issues.some(
      (issue) =>
        issue.path === "freedom_fighter_gazette_number" &&
        issue.code === "required",
    ),
  );
  assert.ok(
    validateServicePayload(20, {
      ...payload,
      other_freedom_fighter: true,
      other_freedom_fighter_name_bn: "",
    }).issues.some(
      (issue) =>
        issue.path === "other_freedom_fighter_name_bn" &&
        issue.code === "required",
    ),
    "a ticked on-behalf box demands the fighter's name",
  );
  // The pinned QAFIX-01 version keeps the gazette number optional.
  const pinned = flattenFields(getServiceSchema(20, 4));
  assert.equal(
    pinned.find((field) => field.id === "freedom_fighter_gazette_number")
      ?.constraints?.required,
    false,
  );
});

test("QAFIX-05: service 21 (agriculture) requires both halves of the activity pair and asks the farming facts as structured fields", () => {
  assert.equal(getServiceSchema(21).version, 5);
  const fields = flattenFields(getServiceSchema(21));
  // (§3.21, §4 item 11) The English description is required, matching
  // its Bangla half — the issuance gate already blocks a pair with one
  // side missing in official mode.
  assert.equal(
    fields.find((field) => field.id === "farming_activity")?.constraints
      ?.required,
    true,
  );
  assert.equal(
    fields.find((field) => field.id === "farming_activity_en")?.constraints
      ?.required,
    true,
  );
  // (a) The pair sits adjacent, Bangla first, ahead of the documents
  // group — the QAFIX-01 seating, re-pinned here.
  const order = fields.map((field) => field.id);
  assert.ok(
    order.indexOf("farming_activity") <
      order.indexOf("farming_activity_en"),
  );
  assert.ok(
    order.indexOf("farming_activity_en") <
      order.indexOf("supporting_documents"),
  );
  // (b) The structured farming evidence, placed after the location and
  // before the documents group: crop and land area/unit required,
  // holding number and mouza optional.
  const crop = fields.find((field) => field.id === "farm_crop");
  assert.equal(crop?.type, "text");
  assert.equal(crop?.constraints?.required, true);
  const area = fields.find((field) => field.id === "farm_land_area");
  assert.equal(area?.type, "number");
  assert.equal(area?.constraints?.required, true);
  assert.equal(area?.constraints?.min, 0);
  const unit = fields.find((field) => field.id === "farm_land_unit");
  assert.equal(unit?.type, "select");
  assert.equal(unit?.constraints?.required, true);
  assert.deepEqual(
    unit?.options?.map((option) => option.value),
    ["decimal", "acre", "square_metre"],
  );
  assert.equal(
    fields.find((field) => field.id === "farm_holding_no")?.constraints
      ?.required,
    false,
  );
  assert.equal(
    fields.find((field) => field.id === "farm_mouza")?.constraints
      ?.required,
    false,
  );
  assert.ok(
    order.indexOf("farm_location") < order.indexOf("farm_crop") &&
      order.indexOf("farm_mouza") < order.indexOf("supporting_documents"),
  );
  // The demo payload validates and carries the structured facts; an
  // empty crop, an empty English description or a negative area is
  // rejected.
  const payload = getDemoPayload(21);
  assert.equal(validateServicePayload(21, payload).valid, true);
  assert.equal(payload.farm_land_unit, "decimal");
  assert.equal(payload.farm_land_area, 1);
  assert.ok(
    validateServicePayload(21, { ...payload, farm_crop: "" }).issues.some(
      (issue) => issue.path === "farm_crop" && issue.code === "required",
    ),
  );
  assert.ok(
    validateServicePayload(21, {
      ...payload,
      farming_activity_en: "",
    }).issues.some(
      (issue) =>
        issue.path === "farming_activity_en" && issue.code === "required",
    ),
  );
  assert.ok(
    validateServicePayload(21, {
      ...payload,
      farm_land_area: -1,
    }).issues.some(
      (issue) => issue.path === "farm_land_area" && issue.code === "range",
    ),
  );
  // The pinned QAFIX-01 version has no structured fields and keeps the
  // English description optional.
  const pinned = flattenFields(getServiceSchema(21, 4));
  assert.equal(
    pinned.find((field) => field.id === "farm_crop"),
    undefined,
  );
  assert.equal(
    pinned.find((field) => field.id === "farming_activity_en")
      ?.constraints?.required,
    false,
  );
});

test("QAFIX-05: service 22 (unmarried) folds the consent-letter upload into the guided documents step and requires it", () => {
  // Service 22's current version was v3 before this repair (it was
  // never refined), so the QAFIX-05 version is v4, not v5.
  assert.equal(getServiceSchema(22).version, 4);
  const fields = flattenFields(getServiceSchema(22));
  // (§3.22) The dedicated upload is gone — its field name is recorded
  // in qaFix5RemovedObserved above.
  assert.ok(
    !fields.some(
      (field) => field.id === "application_parents_consent_letter",
    ),
    "no dedicated consent-letter upload",
  );
  // (§4 item 5, the Form 16 mechanism) The documents step names the
  // consent letter with its formats and size limit, and demands at
  // least one row of it.
  const docs = fields.find((field) => field.id === "supporting_documents");
  assert.equal(docs?.constraints?.minRows, 1);
  assert.match(docs?.description?.bn ?? "", /সম্মতিপত্র/);
  assert.match(docs?.description?.en ?? "", /consent letter/i);
  assert.match(docs?.description?.en ?? "", /2 MiB/);
  // The demo payload (no documents — fixtures never fake upload
  // handles) still validates: an absent optional repeatable is the
  // engine's documented shape; an explicitly empty list is rejected.
  const payload = getDemoPayload(22);
  assert.equal(validateServicePayload(22, payload).valid, true);
  assert.ok(
    validateServicePayload(22, { ...payload, supporting_documents: [] }).issues.some(
      (issue) => issue.path === "supporting_documents" && issue.code === "min_rows",
    ),
    "an emptied documents list cannot be submitted",
  );
  // A documents row carrying the consent letter validates.
  assert.equal(
    validateServicePayload(22, {
      ...payload,
      supporting_documents: [
        {
          description: "Guardian consent letter",
          file: {
            attachmentId: "attachment_demo_123",
            mimeType: "application/pdf",
            byteLength: 500,
          },
        },
      ],
    }).valid,
    true,
  );
  // The pinned v3 keeps the dedicated upload and the unguided, row-less
  // documents step.
  const pinned = flattenFields(getServiceSchema(22, 3));
  assert.ok(
    pinned.some(
      (field) => field.id === "application_parents_consent_letter",
    ),
  );
  assert.equal(
    pinned.find((field) => field.id === "supporting_documents")?.constraints
      ?.minRows,
    undefined,
  );
});

test("QAFIX-05: service 23 (annual income) unhides its core evidence, requires its figures and takes the earner from a select", () => {
  assert.equal(getServiceSchema(23).version, 5);
  const fields = flattenFields(getServiceSchema(23));
  // (§3.23, §4 item 6) Both opt-in checkboxes are gone — their names
  // are recorded in qaFix5RemovedObserved (optradio) and in the new
  // select's evidence (other_person) above.
  assert.ok(!fields.some((field) => field.id === "optradio"), "no optradio");
  assert.ok(
    !fields.some((field) => field.id === "other_person"),
    "no other_person checkbox",
  );
  // (b) The income figures are required — overriding Phase-4 Finding B
  // for service 23 (service 29 followed in QAFIX-06).
  assert.equal(
    fields.find((field) => field.id === "income_info_amount")?.constraints
      ?.required,
    true,
  );
  assert.equal(
    fields.find((field) => field.id === "income_info_amount_word")
      ?.constraints?.required,
    true,
  );
  // (a) The profession pair is always visible and required.
  for (const id of ["profession_bn", "profession_en"]) {
    const field = fields.find((item) => item.id === id);
    assert.equal(field?.visibleWhen, undefined, id);
    assert.equal(field?.constraints?.required, true, id);
  }
  // The earner is a required select; its options are self / another
  // person, and it keeps the removed checkbox's observed name.
  const earner = fields.find((field) => field.id === "income_earner");
  assert.equal(earner?.type, "select");
  assert.equal(earner?.constraints?.required, true);
  assert.deepEqual(
    earner?.options?.map((option) => option.value),
    ["self", "other_person"],
  );
  assert.deepEqual(earner?.evidence?.fieldNames, ["other_person"]);
  // (c) The earner-relation list has no "self"; its label asks whose
  // income it is; the earner fields gate on the select.
  const relation = fields.find(
    (field) => field.id === "other_person_relation",
  );
  assert.deepEqual(
    relation?.options?.map((option) => option.value),
    ["spouse", "child", "parent", "sibling", "guardian", "other"],
  );
  assert.equal(relation?.label.bn, "সম্পর্ক (কার আয়?)");
  for (const id of [
    "other_person_relation",
    "other_person_name_bn",
    "other_person_name",
  ]) {
    const field = fields.find((item) => item.id === id);
    assert.deepEqual(field?.visibleWhen, {
      field: "income_earner",
      equals: "other_person",
    });
    assert.equal(field?.constraints?.required, true, id);
  }
  // The demo payload (earner "self") validates; an empty figure, an
  // empty profession, or another-person income without a named earner
  // is rejected.
  const payload = getDemoPayload(23);
  assert.equal(payload.income_earner, "self");
  assert.equal(validateServicePayload(23, payload).valid, true);
  assert.ok(
    validateServicePayload(23, { ...payload, income_info_amount: "" }).issues.some(
      (issue) =>
        issue.path === "income_info_amount" && issue.code === "required",
    ),
  );
  assert.ok(
    validateServicePayload(23, {
      ...payload,
      income_info_amount_word: "",
    }).issues.some(
      (issue) =>
        issue.path === "income_info_amount_word" &&
        issue.code === "required",
    ),
  );
  assert.ok(
    validateServicePayload(23, { ...payload, profession_bn: "" }).issues.some(
      (issue) => issue.path === "profession_bn" && issue.code === "required",
    ),
  );
  assert.ok(
    validateServicePayload(23, {
      ...payload,
      income_earner: "other_person",
    }).issues.some(
      (issue) =>
        issue.path === "other_person_name_bn" && issue.code === "required",
    ),
    "another person's income demands a named earner",
  );
  // The pinned v4 keeps both checkboxes, the hidden profession pair and
  // the optional figures.
  const pinned = flattenFields(getServiceSchema(23, 4));
  assert.ok(pinned.some((field) => field.id === "optradio"));
  assert.ok(pinned.some((field) => field.id === "other_person"));
  assert.deepEqual(
    pinned.find((field) => field.id === "profession_en")?.visibleWhen,
    { field: "optradio", equals: true },
  );
  assert.equal(
    pinned.find((field) => field.id === "income_info_amount")?.constraints
      ?.required,
    false,
  );
});

test("QAFIX-05: service 24 (orphan) requires the deceased parent named, takes the guardian relation from the guardian list and seats the identity block first", () => {
  assert.equal(getServiceSchema(24).version, 5);
  const fields = flattenFields(getServiceSchema(24));
  const order = fields.map((field) => field.id);
  // (a) The deceased-parent select is required and offers father /
  // mother / both — there is no "neither" by design.
  const deceased = fields.find(
    (field) => field.id === "orphan_deceased_parent",
  );
  assert.equal(deceased?.type, "select");
  assert.equal(deceased?.constraints?.required, true);
  assert.deepEqual(
    deceased?.options?.map((option) => option.value),
    ["father", "mother", "both"],
  );
  // Each parent's name pair + death date is required when visible, gated
  // on the select by the engine's `any` predicate (first use in a
  // schema): that parent, or both.
  const fatherWhen = {
    any: [
      { field: "orphan_deceased_parent", equals: "father" },
      { field: "orphan_deceased_parent", equals: "both" },
    ],
  };
  const motherWhen = {
    any: [
      { field: "orphan_deceased_parent", equals: "mother" },
      { field: "orphan_deceased_parent", equals: "both" },
    ],
  };
  for (const id of [
    "orphan_father_name_bn",
    "orphan_father_name_en",
    "orphan_father_death_date",
  ]) {
    const field = fields.find((item) => item.id === id);
    assert.deepEqual(field?.visibleWhen, fatherWhen, id);
    assert.equal(field?.constraints?.required, true, id);
  }
  for (const id of [
    "orphan_mother_name_bn",
    "orphan_mother_name_en",
    "orphan_mother_death_date",
  ]) {
    const field = fields.find((item) => item.id === id);
    assert.deepEqual(field?.visibleWhen, motherWhen, id);
    assert.equal(field?.constraints?.required, true, id);
  }
  // (b) The guardian relation is the shared guardian list — no self or
  // spouse, with the guardian-appropriate codes.
  const relation = fields.find(
    (field) => field.id === "orphan_guardian_relation",
  );
  assert.deepEqual(
    relation?.options?.map((option) => option.value),
    ["parent", "grandparent", "uncle", "aunt", "sibling", "guardian", "other"],
  );
  // (c) The identity block sits before the documents group, pairs
  // adjacent, Bangla first; the declaration spelling is the decomposed
  // হওয়ার (written with explicit escapes so the exact bytes are pinned).
  assert.ok(
    order.indexOf("orphan_guardian_relation") <
      order.indexOf("supporting_documents"),
  );
  assert.ok(
    order.indexOf("orphan_deceased_parent") <
      order.indexOf("orphan_father_name_bn") &&
      order.indexOf("orphan_father_death_date") <
        order.indexOf("orphan_mother_name_bn") &&
      order.indexOf("orphan_mother_death_date") <
        order.indexOf("orphan_guardian_name_bn"),
  );
  assert.ok(
    order.indexOf("orphan_father_name_bn") + 1 ===
      order.indexOf("orphan_father_name_en"),
  );
  assert.ok(
    order.indexOf("orphan_mother_name_bn") + 1 ===
      order.indexOf("orphan_mother_name_en"),
  );
  const declaration = fields.find(
    (field) => field.id === "orphanhood_declaration",
  );
  assert.equal(
    declaration?.label.bn,
    "এতিম হও" + "\u09af\u09bc" + "\u09be\u09b0 বিবরণ",
  );
  // The demo payload (deceased parent "father", the first option)
  // validates; the father's facts are required, the mother's are
  // inactive; "both" demands the mother's facts too; "mother" with a
  // father's name is stale data.
  const payload = getDemoPayload(24);
  assert.equal(payload.orphan_deceased_parent, "father");
  assert.equal(validateServicePayload(24, payload).valid, true);
  assert.ok(
    validateServicePayload(24, {
      ...payload,
      orphan_father_name_bn: "",
    }).issues.some(
      (issue) =>
        issue.path === "orphan_father_name_bn" && issue.code === "required",
    ),
  );
  assert.ok(
    validateServicePayload(24, {
      ...payload,
      orphan_deceased_parent: "both",
    }).issues.some(
      (issue) =>
        issue.path === "orphan_mother_name_bn" && issue.code === "required",
    ),
    "both parents demands the mother's name",
  );
  assert.ok(
    validateServicePayload(24, {
      ...payload,
      orphan_deceased_parent: "mother",
      orphan_father_name_bn: "Stale father",
    }).issues.some(
      (issue) =>
        issue.path === "orphan_father_name_bn" &&
        issue.code === "inactive_field",
    ),
    "a father's name is stale when only the mother died",
  );
  // The pinned v4 has no deceased-parent select, keeps all six parent
  // fields optional after the documents group, and keeps the generic
  // relation list with the precomposed declaration spelling.
  const pinned = flattenFields(getServiceSchema(24, 4));
  assert.equal(
    pinned.find((field) => field.id === "orphan_deceased_parent"),
    undefined,
  );
  assert.equal(
    pinned.find((field) => field.id === "orphan_father_name_bn")?.constraints
      ?.required,
    false,
  );
  const pinnedOrder = pinned.map((field) => field.id);
  assert.ok(
    pinnedOrder.indexOf("supporting_documents") <
      pinnedOrder.indexOf("orphan_father_name_bn"),
  );
  assert.deepEqual(
    pinned
      .find((field) => field.id === "orphan_guardian_relation")
      ?.options?.map((option) => option.value),
    ["self", "spouse", "child", "parent", "sibling", "other"],
  );
  const pinnedDeclaration = pinned.find(
    (field) => field.id === "orphanhood_declaration",
  );
  assert.ok(
    [...(pinnedDeclaration?.label.bn ?? "")].some(
      (char) => char.codePointAt(0) === 0x9df,
    ),
    "pinned v4 keeps the precomposed হওয়ার spelling",
  );
});

test("correction rows require a genuine change and reject duplicate categories and authority claims", () => {
  const payload = getDemoPayload(33);
  const row = (payload.corrections as Record<string, unknown>[])[0];
  assert.ok(
    validateServicePayload(33, {
      ...payload,
      corrections: [{ ...row, correct_info: row.incorrect_info }],
    }).issues.some((issue) => issue.code === "different_value"),
  );
  assert.ok(
    validateServicePayload(33, {
      ...payload,
      corrections: [row, row],
    }).issues.some(
      (issue) =>
        issue.path === "corrections[1].correction_category_id" &&
        issue.code === "duplicate_value",
    ),
  );
  assert.ok(
    validateServicePayload(33, {
      ...payload,
      corrections: [{ ...row, approved: true }],
    }).issues.some(
      (issue) =>
        issue.path === "corrections[0].approved" &&
        issue.code === "unknown_field",
    ),
  );
  assert.equal(
    validateServicePayload(33, {
      ...payload,
      corrections: [row, { ...row, correction_category_id: "address" }],
    }).valid,
    true,
  );
});

test("income, death, related-person and marital-status conditions require newly active facts", () => {
  const cases = [
    [20, "other_freedom_fighter", true, "other_freedom_fighter_name"],
    // QAFIX-05: service 23's earner is a select now — choosing another
    // person activates the earner fields. QAFIX-06: service 29's
    // earner is the same select.
    [23, "income_earner", "other_person", "other_person_name"],
    [29, "income_earner", "other_person", "other_person_name"],
    // QAFIX-07: service 35's marital-status checkbox is removed —
    // the status is always visible now, so there is no condition
    // left to activate it.
    [39, "spi_is_dead", true, "spi_death_date"],
    [39, "relation_person", true, "spi_relation_person_name"],
  ] as const;
  for (const [no, flag, flagValue, dependent] of cases) {
    const payload = getDemoPayload(no);
    assert.ok(
      validateServicePayload(no, { ...payload, [flag]: flagValue }).issues.some(
        (issue) => issue.path === dependent && issue.code === "required",
      ),
      `${no}/${dependent}`,
    );
    assert.ok(
      validateServicePayload(no, {
        ...payload,
        [dependent]: "Hidden stale data",
      }).issues.some(
        (issue) => issue.path === dependent && issue.code === "inactive_field",
      ),
    );
  }
});

test("license address branches reject stale union values and require the selected local authority", () => {
  for (const [no, selector] of [
    [36, "noc_org_add_type"],
    [41, "primises_license_org_add_type"],
  ] as const) {
    // Historical v2 keeps its free-text union branch byte-for-byte.
    const v2 = getServiceSchema(no, 2);
    const v2Changed: Record<string, unknown> = {
      ...createSyntheticPayload(v2),
      [selector]: "municipality",
    };
    const v2Failures = validateForm(v2, v2Changed).issues;
    assert.ok(
      v2Failures.some(
        (issue) => issue.path === "union_id" && issue.code === "inactive_field",
      ),
    );
    delete v2Changed.union_id;
    v2Changed.municipality_id = "Demo Municipality";
    assert.equal(validateForm(v2, v2Changed).valid, true);

    // Current v3: municipality still needs its text reference; union lives inside org_location.
    const payload = getDemoPayload(no);
    assert.equal(payload[selector], "union");
    const changed = { ...payload, [selector]: "municipality" };
    assert.ok(
      validateServicePayload(no, changed).issues.some(
        (issue) =>
          issue.path === "municipality_id" && issue.code === "required",
      ),
    );
    changed.municipality_id = "Demo Municipality";
    const { unionCode: _union, ...upazilaOnly } = payload.org_location as Record<
      string,
      string
    >;
    changed.org_location = upazilaOnly;
    assert.equal(validateServicePayload(no, changed).valid, true);
  }
});

test("PAR-05 geography selector versions replace free-text locations without changing v2", () => {
  for (const no of [36, 41, 42]) {
    const current = getServiceSchema(no);
    // CERT-REFINE-01 published v4 for these services on top of the
    // geography v3, and QAFIX-01 published v5; QAFIX-07 published v6
    // for service 36 (the NOC subject gating) and QAFIX-08 v6 for
    // services 41 and 42. The geography structure assertions below
    // are unchanged.
    assert.equal(current.version, 6);
    assert.equal(getServiceSchema(no, 2).version, 2);
    const ids = current.sections.flatMap((section) =>
      section.fields.map((field) => field.id),
    );
    for (const gone of ["division_id", "noc_org_division", "trade_license_org_division", "district_id", "thana_id", "union_id"])
      assert.ok(!ids.includes(gone), `${no} still has ${gone}`);
    for (const kept of ["post_office_id", "municipality_id", "city_corporation_id", "additional_thana_id"])
      assert.ok(ids.includes(kept), `${no} lost ${kept}`);
    const location = current.sections
      .flatMap((section) => section.fields)
      .find((field) => field.id === "org_location")!;
    assert.equal(location.type, "geography");
    assert.ok(location.evidence?.fieldNames?.includes("district_id"));
  }
  const payload = getDemoPayload(36);
  const location = payload.org_location as Record<string, string>;
  const issueFor = (value: unknown) =>
    validateServicePayload(36, { ...payload, org_location: value }).issues.find(
      (issue) => issue.path === "org_location",
    )?.code;
  assert.equal(issueFor(location), undefined);
  // Union address type requires the union level.
  const { unionCode: _u, ...noUnion } = location;
  assert.equal(issueFor(noUnion), "geography_incomplete");
  // Ward without union is a hierarchy gap.
  assert.equal(issueFor({ ...noUnion, wardCode: "uni-0001-w01" }), "geography_incomplete");
  // Free text, extra claims and malformed codes are rejected.
  assert.equal(issueFor("Cumilla"), "geography");
  assert.equal(issueFor({ ...location, nameEn: "Cumilla" }), "geography");
  assert.equal(issueFor({ ...location, districtCode: "DIS 19" }), "geography");
  assert.equal(issueFor(undefined), "required");
  // A union left over after switching to a municipality address is rejected like other stale data.
  const municipal = {
    ...payload,
    noc_org_add_type: "municipality",
    municipality_id: "Demo Municipality",
  };
  assert.equal(
    validateServicePayload(36, municipal).issues.find(
      (issue) => issue.path === "org_location",
    )?.code,
    "geography_union_inactive",
  );
  assert.equal(
    validateServicePayload(36, { ...municipal, org_location: noUnion }).valid,
    true,
  );
  // Trade licence keeps the optional policy of its v2 additions.
  const trade = getDemoPayload(42);
  assert.equal(validateServicePayload(42, trade).valid, true);
});

test("service-specific financial/vehicle numbers, holding year, dates and private attachment handles are validated", () => {
  for (const [no, field] of [
    [23, "income_info_amount"],
    [29, "income_info_amount"],
    [30, "declared_assets_bdt"],
    [32, "monthly_household_income_bdt"],
    [41, "primises_license_capital"],
    [46, "transport_license_weight"],
  ] as const) {
    assert.ok(
      validateServicePayload(no, {
        ...getDemoPayload(no),
        [field]: -1,
      }).issues.some((issue) => issue.path === field && issue.code === "range"),
    );
    assert.ok(
      validateServicePayload(no, {
        ...getDemoPayload(no),
        [field]: Infinity,
      }).issues.some(
        (issue) => issue.path === field && issue.code === "number",
      ),
    );
  }
  assert.ok(
    validateServicePayload(1, {
      ...getDemoPayload(1),
      tax_year: 2026.5,
    }).issues.some((issue) => issue.code === "integer"),
  );
  assert.ok(
    validateServicePayload(7, {
      ...getDemoPayload(7),
      // Phase 4: the death-details group is opt-in from schema v3, so the
      // date probe must select the group before its format is validated.
      optradio: true,
      dead_info_dod: "2026-02-30",
    }).issues.some((issue) => issue.code === "date"),
  );
  const file = {
    attachmentId: "attachment_demo_123",
    mimeType: "application/pdf",
    byteLength: 500,
  };
  // QAFIX-05 folded service 22's dedicated consent-letter upload into
  // its guided documents step, so the attachment handle is exercised
  // through a documents row (the surviving upload path).
  const payload = {
    ...getDemoPayload(22),
    supporting_documents: [{ description: "Guardian consent letter", file }],
  };
  assert.equal(validateServicePayload(22, payload).valid, true);
  assert.ok(
    validateServicePayload(22, {
      ...payload,
      supporting_documents: [
        {
          description: "Guardian consent letter",
          file: {
            ...file,
            url: "https://untrusted.example.test/document",
          },
        },
      ],
    }).issues.some((issue) => issue.code === "attachment_reference"),
  );
});

test("B6: org_location is at least as strict as the strictest v2 location field it replaced", () => {
  for (const no of geographySelectorServices) {
    const selector = allServiceSchemaVersions
      .filter((x) => x.serviceNo === no)
      .sort((a, b) => a.version - b.version)
      .find((x) => flattenFields(x).some((f) => f.id === "org_location"))!;
    const previous = allServiceSchemaVersions.find(
      (x) => x.serviceNo === no && x.version === selector.version - 1,
    )!;
    assert.ok(previous, `service ${no} keeps the version before its selector`);
    const location = flattenFields(selector).find((f) => f.id === "org_location")!;
    const replaced = flattenFields(previous).filter((f) =>
      legacyLocationFieldIds.includes(f.id),
    );
    assert.ok(replaced.length >= 4, `service ${no} replaced its location fields`);
    for (const field of replaced)
      assert.equal(field.requiredWhen, undefined, `${no}.${field.id}: requiredWhen is not mapped`);
    const unconditional = replaced.filter((f) => !f.visibleWhen);
    assert.equal(
      !!location.constraints?.required,
      unconditional.some((f) => !!f.constraints?.required),
      `service ${no}: org_location.required must equal the strictest always-visible replaced field`,
    );
    for (const field of replaced.filter((f) => f.visibleWhen && f.constraints?.required)) {
      assert.equal(field.id, "union_id", `${no}.${field.id}: only the union may be conditional`);
      assert.deepEqual(
        location.constraints?.geographyUnionWhen,
        field.visibleWhen,
        `service ${no}: the union stays required exactly when v2 showed and required it`,
      );
    }
  }
});

test("QAFIX-06: service 25 (married) requires the spouse facts the certificate prints, drops the minor age class and names the Kabin Nama", () => {
  assert.equal(getServiceSchema(25).version, 5);
  const schema = getServiceSchema(25);
  const fields = flattenFields(schema);
  const byId = new Map(fields.map((field) => [field.id, field]));
  // (§3.25, §4 item 6) The spouse's name, both parents' names and the
  // spouse's address — all printed on the certificate — are required.
  for (const id of [
    "marriage_info_spouse_name_bn",
    "marriage_info_spouse_name",
    "marriage_info_spouse_father_name_bn",
    "marriage_info_spouse_father_name_en",
    "marriage_info_spouse_mother_name_bn",
    "marriage_info_spouse_mother_name_en",
    "marriage_info_spouse_address_bn",
    "marriage_info_spouse_address_en",
  ])
    assert.equal(byId.get(id)?.constraints?.required, true, id);
  // The spouse NID stays optional (an alternative identifier, printed
  // when present).
  assert.equal(
    byId.get("marriage_info_spouse_nid")?.constraints?.required,
    false,
  );
  // (§3.25) The age class no longer offers "minor" for a spouse.
  assert.deepEqual(
    byId.get("marriage_info_spouse_age_flag")?.options?.map((o) => o.value),
    ["adult"],
  );
  // (§3.25) The whole spouse block sits ahead of the documents step,
  // in Bangla-first pairs.
  const details = schema.sections.find(
    (section) => section.id === "service_details",
  );
  assert.deepEqual(
    details?.fields.map((field) => field.id),
    [
      "marriage_info_spouse_name_bn",
      "marriage_info_spouse_name",
      "marriage_info_spouse_age_flag",
      "marriage_info_spouse_nid",
      "marriage_info_spouse_dob",
      "marriage_info_spouse_father_name_bn",
      "marriage_info_spouse_father_name_en",
      "marriage_info_spouse_mother_name_bn",
      "marriage_info_spouse_mother_name_en",
      "marriage_info_spouse_address_bn",
      "marriage_info_spouse_address_en",
      "marriage_info_spouse_place_bn",
      "marriage_info_spouse_place",
      "marriage_info_date",
      "supporting_documents",
    ],
  );
  // (§4 item 5, the Form 16/22 mechanism) The documents step names the
  // Kabin Nama with its formats and size limit, and demands ≥1 row.
  const docs = byId.get("supporting_documents");
  assert.equal(docs?.constraints?.minRows, 1);
  assert.match(docs?.description?.bn ?? "", /কাবিন নামা/);
  assert.match(docs?.description?.en ?? "", /Kabin Nama/);
  assert.match(docs?.description?.en ?? "", /2 MiB/);
  // The demo payload validates; a missing spouse name or an emptied
  // documents list is rejected.
  const payload = getDemoPayload(25);
  assert.equal(validateServicePayload(25, payload).valid, true);
  assert.ok(
    validateServicePayload(25, {
      ...payload,
      marriage_info_spouse_name_bn: "",
    }).issues.some(
      (issue) =>
        issue.path === "marriage_info_spouse_name_bn" &&
        issue.code === "required",
    ),
  );
  assert.ok(
    validateServicePayload(25, {
      ...payload,
      marriage_info_spouse_father_name_en: "",
    }).issues.some(
      (issue) =>
        issue.path === "marriage_info_spouse_father_name_en" &&
        issue.code === "required",
    ),
  );
  assert.ok(
    validateServicePayload(25, { ...payload, supporting_documents: [] }).issues.some(
      (issue) => issue.path === "supporting_documents" && issue.code === "min_rows",
    ),
    "an emptied documents list cannot be submitted",
  );
  // The pinned v4 keeps the optional spouse facts, the minor class and
  // the unguided, row-less documents step.
  const pinned = flattenFields(getServiceSchema(25, 4));
  const pinnedById = new Map(pinned.map((field) => [field.id, field]));
  assert.equal(
    pinnedById.get("marriage_info_spouse_name_bn")?.constraints?.required,
    false,
  );
  assert.deepEqual(
    pinnedById
      .get("marriage_info_spouse_age_flag")
      ?.options?.map((o) => o.value),
    ["adult", "minor"],
  );
  assert.equal(
    pinnedById.get("supporting_documents")?.constraints?.minRows,
    undefined,
  );
});

test("QAFIX-06: service 26 (dowry-free marriage) takes the marriage repair and adds the dowry declaration and witnesses", () => {
  assert.equal(getServiceSchema(26).version, 5);
  const schema = getServiceSchema(26);
  const fields = flattenFields(schema);
  const byId = new Map(fields.map((field) => [field.id, field]));
  // The shared marriage repair applies in full.
  assert.equal(
    byId.get("marriage_info_spouse_name_bn")?.constraints?.required,
    true,
  );
  assert.deepEqual(
    byId.get("marriage_info_spouse_age_flag")?.options?.map((o) => o.value),
    ["adult"],
  );
  assert.equal(byId.get("supporting_documents")?.constraints?.minRows, 1);
  assert.match(
    byId.get("supporting_documents")?.description?.en ?? "",
    /Kabin Nama/,
  );
  // (§3.26) The dowry declaration must be actively confirmed.
  const declaration = byId.get("dowry_free_declaration");
  assert.equal(declaration?.type, "checkbox");
  assert.equal(declaration?.constraints?.required, true);
  assert.equal(declaration?.constraints?.mustBeTrue, true);
  assert.match(declaration?.label.en ?? "", /no dowry was given or received/);
  // (§3.26) At least two witnesses, each with a BN/EN name and an NID.
  const witnesses = byId.get("dowry_witnesses");
  assert.equal(witnesses?.type, "repeatable");
  assert.equal(witnesses?.constraints?.minRows, 2);
  assert.deepEqual(
    witnesses?.children?.map((child) => child.id),
    ["witness_name_bn", "witness_name_en", "witness_nid"],
  );
  for (const child of witnesses?.children ?? [])
    assert.equal(child.constraints?.required, true, child.id);
  // The dowry capture sits after the documents step.
  const details = schema.sections.find(
    (section) => section.id === "service_details",
  );
  assert.deepEqual(details?.fields.slice(-3).map((field) => field.id), [
    "supporting_documents",
    "dowry_free_declaration",
    "dowry_witnesses",
  ]);
  // The demo payload validates (two witness rows are synthesised);
  // an unconfirmed declaration or a single witness is rejected.
  const payload = getDemoPayload(26);
  assert.equal(validateServicePayload(26, payload).valid, true);
  assert.equal(
    (payload.dowry_witnesses as unknown[]).length,
    2,
    "the demo payload carries the two required witnesses",
  );
  assert.ok(
    validateServicePayload(26, {
      ...payload,
      dowry_free_declaration: false,
    }).issues.some(
      (issue) =>
        issue.path === "dowry_free_declaration" && issue.code === "confirmation",
    ),
  );
  assert.ok(
    validateServicePayload(26, {
      ...payload,
      dowry_witnesses: (payload.dowry_witnesses as unknown[]).slice(0, 1),
    }).issues.some(
      (issue) => issue.path === "dowry_witnesses" && issue.code === "min_rows",
    ),
    "one witness is not enough",
  );
  // The pinned v4 is the verbatim copy: no dowry fields at all.
  const pinned = flattenFields(getServiceSchema(26, 4));
  assert.ok(!pinned.some((field) => field.id === "dowry_free_declaration"));
  assert.ok(!pinned.some((field) => field.id === "dowry_witnesses"));
});

test("QAFIX-06: service 27 (passport) takes its purpose from a fixed select the letter's label map carries", () => {
  assert.equal(getServiceSchema(27).version, 4);
  const fields = flattenFields(getServiceSchema(27));
  const purpose = fields.find((field) => field.id === "passport_purpose");
  assert.equal(purpose?.type, "select");
  assert.equal(purpose?.constraints?.required, true);
  assert.deepEqual(
    purpose?.options?.map((o) => o.value),
    ["travel", "employment", "hajj", "umrah", "study", "treatment", "business", "other"],
  );
  // Every option label exists in both languages.
  for (const opt of purpose?.options ?? []) {
    assert.ok(opt.label.bn.length > 0, opt.value);
    assert.ok(opt.label.en.length > 0, opt.value);
  }
  // The demo payload validates with the first select value; an
  // off-list purpose is rejected, and the field is no free text.
  const payload = getDemoPayload(27);
  assert.equal(payload.passport_purpose, "travel");
  assert.equal(validateServicePayload(27, payload).valid, true);
  assert.ok(
    validateServicePayload(27, {
      ...payload,
      passport_purpose: "to see the world",
    }).issues.some(
      (issue) => issue.path === "passport_purpose" && issue.code === "option",
    ),
  );
  // The pinned v3 keeps the free-text purpose.
  const pinnedPurpose = flattenFields(getServiceSchema(27, 3)).find(
    (field) => field.id === "passport_purpose",
  );
  assert.equal(pinnedPurpose?.type, "text");
});

test("QAFIX-06: service 28 (living person) structures the witness and bars a future appearance date", () => {
  assert.equal(getServiceSchema(28).version, 4);
  const schema = getServiceSchema(28);
  const fields = flattenFields(schema);
  const byId = new Map(fields.map((field) => [field.id, field]));
  // (§3.28) The free-text witness box is gone; the witness is a
  // structured name pair + NID, all required.
  assert.ok(!byId.has("witness_details"));
  for (const id of ["witness_name_bn", "witness_name_en", "witness_nid"])
    assert.equal(byId.get(id)?.constraints?.required, true, id);
  // The witness fields sit directly after the appearance date.
  const details = schema.sections.find(
    (section) => section.id === "service_details",
  );
  assert.deepEqual(
    details?.fields.map((field) => field.id),
    ["appearance_date", "witness_name_bn", "witness_name_en", "witness_nid", "supporting_documents"],
  );
  // (§3.28) Appearance guidance is shown and the date cannot be future.
  const appearance = byId.get("appearance_date");
  assert.equal(appearance?.constraints?.notFuture, true);
  assert.match(appearance?.description?.en ?? "", /in person/);
  assert.match(appearance?.description?.bn ?? "", /সশরীরে/);
  // The demo payload validates; a far-future appearance date is
  // rejected by the engine's notFuture rule, and Dhaka-today passes.
  const payload = getDemoPayload(28);
  assert.equal(validateServicePayload(28, payload).valid, true);
  assert.ok(
    validateServicePayload(28, { ...payload, appearance_date: "2999-01-01" }).issues.some(
      (issue) => issue.path === "appearance_date" && issue.code === "date",
    ),
    "an appearance cannot be recorded before it happens",
  );
  const todayDhaka = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  assert.equal(
    validateServicePayload(28, { ...payload, appearance_date: todayDhaka }).valid,
    true,
    "today's appearance date is accepted",
  );
  // The pinned v3 keeps the free-text witness box and the unbounded date.
  const pinned = flattenFields(getServiceSchema(28, 3));
  const pinnedById = new Map(pinned.map((field) => [field.id, field]));
  assert.ok(pinnedById.has("witness_details"));
  assert.ok(!pinnedById.has("witness_name_bn"));
  assert.equal(
    pinnedById.get("appearance_date")?.constraints?.notFuture,
    undefined,
  );
});

test("QAFIX-06: service 29 (monthly income) unhides its core evidence, requires its amount and captures the other person's amount", () => {
  assert.equal(getServiceSchema(29).version, 5);
  const fields = flattenFields(getServiceSchema(29));
  // (§3.29, §4 item 6) Both opt-in checkboxes are gone — optradio is
  // recorded in qaFix6RemovedObserved; other_person lives on in the
  // new select's evidence.
  assert.ok(!fields.some((field) => field.id === "optradio"), "no optradio");
  assert.ok(
    !fields.some((field) => field.id === "other_person"),
    "no other_person checkbox",
  );
  // (a) The income amount itself — the certificate's central fact —
  // and its words field are required (overriding Phase-4 Finding B
  // for service 29, as QAFIX-05 did for 23).
  assert.equal(
    fields.find((field) => field.id === "income_info_amount")?.constraints
      ?.required,
    true,
  );
  assert.equal(
    fields.find((field) => field.id === "income_info_amount_word")
      ?.constraints?.required,
    true,
  );
  // (b) The profession pair is always visible and required.
  for (const id of ["profession_bn", "profession_en"]) {
    const field = fields.find((item) => item.id === id);
    assert.equal(field?.visibleWhen, undefined, id);
    assert.equal(field?.constraints?.required, true, id);
  }
  // The earner is a required select carrying the observed name.
  const earner = fields.find((field) => field.id === "income_earner");
  assert.equal(earner?.type, "select");
  assert.equal(earner?.constraints?.required, true);
  assert.deepEqual(
    earner?.options?.map((option) => option.value),
    ["self", "other_person"],
  );
  assert.deepEqual(earner?.evidence?.fieldNames, ["other_person"]);
  // (c) The relation list has no "self" and asks whose income it is.
  const relation = fields.find(
    (field) => field.id === "other_person_relation",
  );
  assert.deepEqual(
    relation?.options?.map((option) => option.value),
    ["spouse", "child", "parent", "sibling", "guardian", "other"],
  );
  assert.equal(relation?.label.bn, "সম্পর্ক (কার আয়?)");
  assert.equal(relation?.label.en, "Relationship (whose income?)");
  // (d) The other person's own monthly amount is captured, gated on
  // the earner select like the relation and the name pair.
  const otherAmount = fields.find(
    (field) => field.id === "other_person_income_amount",
  );
  assert.equal(otherAmount?.type, "number");
  assert.equal(otherAmount?.constraints?.required, true);
  assert.equal(otherAmount?.constraints?.min, 0);
  for (const id of [
    "other_person_relation",
    "other_person_name_bn",
    "other_person_name",
    "other_person_income_amount",
  ]) {
    const field = fields.find((item) => item.id === id);
    assert.deepEqual(field?.visibleWhen, {
      field: "income_earner",
      equals: "other_person",
    });
    assert.equal(field?.constraints?.required, true, id);
  }
  // The demo payload (earner "self") validates; an empty amount, an
  // empty profession, or another-person income without the earner's
  // name or amount is rejected.
  const payload = getDemoPayload(29);
  assert.equal(payload.income_earner, "self");
  assert.equal(validateServicePayload(29, payload).valid, true);
  assert.ok(
    validateServicePayload(29, { ...payload, income_info_amount: "" }).issues.some(
      (issue) =>
        issue.path === "income_info_amount" && issue.code === "required",
    ),
  );
  assert.ok(
    validateServicePayload(29, { ...payload, profession_bn: "" }).issues.some(
      (issue) => issue.path === "profession_bn" && issue.code === "required",
    ),
  );
  assert.ok(
    validateServicePayload(29, {
      ...payload,
      income_earner: "other_person",
    }).issues.some(
      (issue) =>
        issue.path === "other_person_name_bn" && issue.code === "required",
    ),
    "another person's income demands a named earner",
  );
  assert.ok(
    validateServicePayload(29, {
      ...payload,
      income_earner: "other_person",
      other_person_relation: "spouse",
      other_person_name_bn: "সঙ্গী",
      other_person_name: "Spouse",
    }).issues.some(
      (issue) =>
        issue.path === "other_person_income_amount" &&
        issue.code === "required",
    ),
    "another person's income demands that person's amount",
  );
  // The pinned v4 keeps both checkboxes, the hidden profession pair,
  // the optional amount and the occupation-labelled relation with
  // "self" in its list.
  const pinned = flattenFields(getServiceSchema(29, 4));
  assert.ok(pinned.some((field) => field.id === "optradio"));
  assert.ok(pinned.some((field) => field.id === "other_person"));
  assert.deepEqual(
    pinned.find((field) => field.id === "profession_en")?.visibleWhen,
    { field: "optradio", equals: true },
  );
  assert.equal(
    pinned.find((field) => field.id === "income_info_amount")?.constraints
      ?.required,
    false,
  );
  assert.equal(
    pinned.find((field) => field.id === "other_person_relation")?.label.bn,
    "সম্পর্ক (কার পেশা?)",
  );
  assert.ok(
    pinned
      .find((field) => field.id === "other_person_relation")
      ?.options?.some((option) => option.value === "self"),
  );
});

test("QAFIX-06: service 30 (financial solvency) breaks the totals down, captures income, aligns the basis pair and names its evidence", () => {
  assert.equal(getServiceSchema(30).version, 5);
  const schema = getServiceSchema(30);
  const fields = flattenFields(schema);
  const byId = new Map(fields.map((field) => [field.id, field]));
  // (a) The breakdown and the income are required numbers, seated
  // between the liabilities total and the basis pair.
  const details = schema.sections.find(
    (section) => section.id === "service_details",
  );
  assert.deepEqual(
    details?.fields.map((field) => field.id),
    [
      "declared_assets_bdt",
      "declared_liabilities_bdt",
      "asset_land_building_bdt",
      "asset_bank_bdt",
      "asset_business_other_bdt",
      "liability_loans_bdt",
      "monthly_income_bdt",
      "financial_basis",
      "financial_basis_en",
      "supporting_documents",
    ],
  );
  for (const id of [
    "asset_land_building_bdt",
    "asset_bank_bdt",
    "asset_business_other_bdt",
    "liability_loans_bdt",
    "monthly_income_bdt",
  ]) {
    assert.equal(byId.get(id)?.type, "number", id);
    assert.equal(byId.get(id)?.constraints?.required, true, id);
    assert.equal(byId.get(id)?.constraints?.min, 0, id);
  }
  // (c) The basis pair is aligned: both halves required.
  assert.equal(byId.get("financial_basis")?.constraints?.required, true);
  assert.equal(byId.get("financial_basis_en")?.constraints?.required, true);
  // (b) The documents step names the bank statement and asset
  // documents, and demands ≥1 row.
  const docs = byId.get("supporting_documents");
  assert.equal(docs?.constraints?.minRows, 1);
  assert.match(docs?.description?.en ?? "", /bank statement/);
  assert.match(docs?.description?.bn ?? "", /ব্যাংক বিবরণী/);
  // The demo payload validates; zero figures are honest values and
  // validate; a missing breakdown figure or an empty English basis
  // is rejected.
  const payload = getDemoPayload(30);
  assert.equal(validateServicePayload(30, payload).valid, true);
  assert.equal(
    validateServicePayload(30, {
      ...payload,
      asset_land_building_bdt: 0,
      asset_bank_bdt: 0,
      asset_business_other_bdt: 0,
      liability_loans_bdt: 0,
      monthly_income_bdt: 0,
    }).valid,
    true,
    "zero is an honest figure, not a missing one",
  );
  assert.ok(
    validateServicePayload(30, { ...payload, asset_bank_bdt: "" }).issues.some(
      (issue) => issue.path === "asset_bank_bdt" && issue.code === "required",
    ),
  );
  assert.ok(
    validateServicePayload(30, { ...payload, financial_basis_en: "" }).issues.some(
      (issue) =>
        issue.path === "financial_basis_en" && issue.code === "required",
    ),
  );
  assert.ok(
    validateServicePayload(30, { ...payload, supporting_documents: [] }).issues.some(
      (issue) => issue.path === "supporting_documents" && issue.code === "min_rows",
    ),
  );
  // The pinned v4 keeps the two bare totals, the optional English
  // basis and the unguided documents step.
  const pinned = flattenFields(getServiceSchema(30, 4));
  const pinnedById = new Map(pinned.map((field) => [field.id, field]));
  assert.ok(!pinnedById.has("asset_bank_bdt"));
  assert.equal(
    pinnedById.get("financial_basis_en")?.constraints?.required,
    false,
  );
  assert.equal(
    pinnedById.get("supporting_documents")?.constraints?.minRows,
    undefined,
  );
});

test("QAFIX-07: service 31 (death while unmarried) unhides the death date, fixes the relationship list and names the deceased", () => {
  assert.equal(getServiceSchema(31).version, 5);
  const schema = getServiceSchema(31);
  const fields = flattenFields(schema);
  const byId = new Map(fields.map((field) => [field.id, field]));
  // (a) The date of death — the core datum — is always visible and
  // required; it is demanded even with the opt-in toggle absent.
  const dod = byId.get("dead_info_dod");
  assert.equal(dod?.visibleWhen, undefined, "death date must not be hidden");
  assert.equal(dod?.constraints?.required, true);
  const payload = getDemoPayload(31);
  assert.equal(validateServicePayload(31, payload).valid, true);
  const { dead_info_dod: _dod, optradio: _opt, ...withoutDate } = payload;
  const missing = validateServicePayload(31, withoutDate);
  assert.ok(
    missing.issues.some(
      (issue) => issue.path === "dead_info_dod" && issue.code === "required",
    ),
    "death date is required even when the opt-in group is off",
  );
  // The genuinely optional extras stay behind the toggle (service 7
  // precedent): the registration reference and the religion document.
  assert.deepEqual(byId.get("dead_info_register_no")?.visibleWhen, {
    field: "optradio",
    equals: true,
  });
  assert.equal(byId.get("dead_info_register_no")?.constraints?.required, false);
  assert.deepEqual(byId.get("dead_attachment_religion_id")?.visibleWhen, {
    field: "optradio",
    equals: true,
  });
  // (b) The relationship list no longer offers "self" or "spouse" for
  // a person who died unmarried, and its label names the deceased.
  const relation = byId.get("dead_info_relation");
  assert.equal(relation?.label.en, "Relationship with the deceased");
  assert.deepEqual(
    (relation?.options ?? []).map((opt) => opt.value),
    [
      "parent",
      "child",
      "sibling",
      "grandparent",
      "uncle",
      "aunt",
      "guardian",
      "other",
    ],
  );
  // (c) The identity, place and cause labels name the deceased.
  assert.equal(byId.get("dead_info_name_bn")?.label.bn, "মৃত ব্যক্তির নাম (বাংলা)");
  assert.equal(
    byId.get("dead_info_father_name")?.label.en,
    "Deceased's father's name (English)",
  );
  assert.equal(
    byId.get("dead_info_mother_name_bn")?.label.en,
    "Deceased's mother's name (Bangla)",
  );
  assert.equal(byId.get("dead_info_place")?.label.en, "Place of death (English)");
  assert.equal(byId.get("dead_info_reason_bn")?.label.en, "Cause of death (Bangla)");
  // The pinned v4 keeps the conditioned date, the copied relationship
  // list and the unlabelled identity fields.
  const pinned = flattenFields(getServiceSchema(31, 4));
  const pinnedById = new Map(pinned.map((field) => [field.id, field]));
  assert.deepEqual(pinnedById.get("dead_info_dod")?.visibleWhen, {
    field: "optradio",
    equals: true,
  });
  assert.deepEqual(
    (pinnedById.get("dead_info_relation")?.options ?? []).map(
      (opt) => opt.value,
    ),
    ["self", "spouse", "child", "parent", "sibling", "other"],
  );
  assert.equal(pinnedById.get("dead_info_name_bn")?.label.bn, "নাম (বাংলা)");
});

test("QAFIX-07: service 32 (financial hardship) seats the household size beside the income, names the earner and names its evidence", () => {
  assert.equal(getServiceSchema(32).version, 5);
  const schema = getServiceSchema(32);
  const fields = flattenFields(schema);
  const byId = new Map(fields.map((field) => [field.id, field]));
  // (a) The household figures sit directly after the income; the
  // earner's name pair closes the section ahead of the occupation.
  const details = schema.sections.find(
    (section) => section.id === "service_details",
  );
  assert.deepEqual(
    details?.fields.map((field) => field.id),
    [
      "monthly_household_income_bdt",
      "household_member_count",
      "dependant_count",
      "hardship_details",
      "supporting_documents",
      "earner_name_bn",
      "earner_name",
      "earner_occupation_bn",
      "earner_occupation_en",
    ],
  );
  assert.equal(byId.get("household_member_count")?.constraints?.required, true);
  assert.equal(byId.get("household_member_count")?.constraints?.min, 1);
  assert.equal(byId.get("dependant_count")?.constraints?.required, true);
  assert.equal(byId.get("dependant_count")?.constraints?.min, 0);
  // (b) The earner's name pair has both halves required; the
  // occupation pair stays optional in both halves.
  assert.equal(byId.get("earner_name_bn")?.constraints?.required, true);
  assert.equal(byId.get("earner_name")?.constraints?.required, true);
  assert.ok(!byId.get("earner_occupation_bn")?.constraints?.required);
  assert.ok(!byId.get("earner_occupation")?.constraints?.required);
  // (c) The documents step names the evidence and demands ≥1 row.
  const docs = byId.get("supporting_documents");
  assert.equal(docs?.constraints?.minRows, 1);
  assert.match(docs?.description?.en ?? "", /pay slip/);
  assert.match(docs?.description?.bn ?? "", /বেতন রশিদ/);
  // The demo payload validates; a missing household size, an empty
  // earner name or an emptied documents list is rejected.
  const payload = getDemoPayload(32);
  assert.equal(validateServicePayload(32, payload).valid, true);
  const { household_member_count: _hmc, ...noSize } = payload;
  assert.ok(
    validateServicePayload(32, noSize).issues.some(
      (issue) =>
        issue.path === "household_member_count" && issue.code === "required",
    ),
  );
  assert.ok(
    validateServicePayload(32, { ...payload, earner_name: "" }).issues.some(
      (issue) => issue.path === "earner_name" && issue.code === "required",
    ),
  );
  assert.ok(
    validateServicePayload(32, { ...payload, supporting_documents: [] }).issues.some(
      (issue) => issue.path === "supporting_documents" && issue.code === "min_rows",
    ),
  );
  // The pinned v4 keeps the bare income, the unnamed earner and the
  // unguided documents step.
  const pinned = flattenFields(getServiceSchema(32, 4));
  const pinnedById = new Map(pinned.map((field) => [field.id, field]));
  assert.ok(!pinnedById.has("household_member_count"));
  assert.ok(!pinnedById.has("earner_name_bn"));
  assert.equal(
    pinnedById.get("supporting_documents")?.constraints?.minRows,
    undefined,
  );
});

test("QAFIX-07: service 33 (NID correction) captures the NID number, widens the record types and names its evidence", () => {
  assert.equal(getServiceSchema(33).version, 4);
  const schema = getServiceSchema(33);
  const fields = flattenFields(schema);
  const byId = new Map(fields.map((field) => [field.id, field]));
  // (a) The NID number heads the details; the corrections list and
  // the documents step follow in their shipped order.
  const details = schema.sections.find(
    (section) => section.id === "service_details",
  );
  assert.deepEqual(
    details?.fields.map((field) => field.id),
    ["nid_number", "correction_type", "corrections", "supporting_documents"],
  );
  const nid = byId.get("nid_number");
  assert.equal(nid?.constraints?.required, true);
  assert.equal(nid?.constraints?.minLength, 10);
  assert.equal(nid?.constraints?.maxLength, 17);
  // (b) The record-type select covers the realistic set; the two
  // shipped values keep their meaning.
  assert.deepEqual(
    (byId.get("correction_type")?.options ?? []).map((opt) => opt.value),
    ["nid", "voter", "birth_certificate", "passport", "other"],
  );
  // The corrections repeatable is untouched: one seeded row, the
  // category select and the incorrect/correct pair, all required.
  const corrections = byId.get("corrections");
  assert.equal(corrections?.constraints?.minRows, 1);
  assert.deepEqual(
    (corrections?.children ?? []).map((child) => child.id),
    ["correction_category_id", "incorrect_info", "correct_info"],
  );
  // (c) The documents step names the proof and demands ≥1 row.
  const docs = byId.get("supporting_documents");
  assert.equal(docs?.constraints?.minRows, 1);
  assert.match(docs?.description?.en ?? "", /birth registration certificate/);
  assert.match(docs?.description?.bn ?? "", /জন্ম নিবন্ধন/);
  // The demo payload validates; a missing or short NID number and
  // an emptied documents list are rejected.
  const payload = getDemoPayload(33);
  assert.equal(validateServicePayload(33, payload).valid, true);
  const { nid_number: _nid, ...noNid } = payload;
  assert.ok(
    validateServicePayload(33, noNid).issues.some(
      (issue) => issue.path === "nid_number" && issue.code === "required",
    ),
  );
  assert.ok(
    validateServicePayload(33, { ...payload, nid_number: "12345" }).issues.some(
      (issue) => issue.path === "nid_number",
    ),
    "a five-character NID number is rejected",
  );
  assert.ok(
    validateServicePayload(33, { ...payload, supporting_documents: [] }).issues.some(
      (issue) => issue.path === "supporting_documents" && issue.code === "min_rows",
    ),
  );
  // The pinned v3 has no NID number, the two-value record select
  // and the unguided documents step.
  const pinned = flattenFields(getServiceSchema(33, 3));
  const pinnedById = new Map(pinned.map((field) => [field.id, field]));
  assert.ok(!pinnedById.has("nid_number"));
  assert.deepEqual(
    (pinnedById.get("correction_type")?.options ?? []).map((opt) => opt.value),
    ["nid", "voter"],
  );
  assert.equal(
    pinnedById.get("supporting_documents")?.constraints?.minRows,
    undefined,
  );
});

test("QAFIX-07: service 34 (childless) replaces the free-text paragraph with structured facts and a fixed declaration", () => {
  assert.equal(getServiceSchema(34).version, 4);
  const schema = getServiceSchema(34);
  const fields = flattenFields(schema);
  const byId = new Map(fields.map((field) => [field.id, field]));
  // The structured block replaces the paragraph, ahead of the
  // documents step.
  const details = schema.sections.find(
    (section) => section.id === "service_details",
  );
  assert.deepEqual(
    details?.fields.map((field) => field.id),
    [
      "childless_spouse_name_bn",
      "childless_spouse_name",
      "childless_marriage_date",
      "childless_declaration_confirmed",
      "supporting_documents",
    ],
  );
  assert.ok(!byId.has("childless_declaration"), "free-text paragraph removed");
  assert.equal(byId.get("childless_spouse_name_bn")?.constraints?.required, true);
  assert.equal(byId.get("childless_spouse_name")?.constraints?.required, true);
  // The marriage date is required and cannot be in the future.
  const marriageDate = byId.get("childless_marriage_date");
  assert.equal(marriageDate?.constraints?.required, true);
  assert.equal(marriageDate?.constraints?.notFuture, true);
  // The declaration is the office's fixed words, confirmed by tick.
  const declaration = byId.get("childless_declaration_confirmed");
  assert.equal(declaration?.type, "checkbox");
  assert.equal(declaration?.constraints?.mustBeTrue, true);
  assert.match(declaration?.label.en ?? "", /we have no children/);
  // The documents step names the marriage proof and demands ≥1 row.
  const docs = byId.get("supporting_documents");
  assert.equal(docs?.constraints?.minRows, 1);
  assert.match(docs?.description?.en ?? "", /Kabin Nama/);
  assert.match(docs?.description?.bn ?? "", /কাবিননামা/);
  // The demo payload validates; an unconfirmed declaration, a
  // future marriage date and an empty spouse name are rejected.
  const payload = getDemoPayload(34);
  assert.equal(validateServicePayload(34, payload).valid, true);
  assert.ok(
    validateServicePayload(34, {
      ...payload,
      childless_declaration_confirmed: false,
    }).issues.some(
      (issue) => issue.path === "childless_declaration_confirmed",
    ),
    "the fixed declaration must be confirmed",
  );
  assert.ok(
    validateServicePayload(34, {
      ...payload,
      childless_marriage_date: "2999-01-01",
    }).issues.some(
      (issue) =>
        issue.path === "childless_marriage_date" && issue.code === "date",
    ),
    "a marriage cannot be dated in the future",
  );
  assert.ok(
    validateServicePayload(34, { ...payload, childless_spouse_name: "" }).issues.some(
      (issue) => issue.path === "childless_spouse_name" && issue.code === "required",
    ),
  );
  // The pinned v3 keeps the single free-text paragraph and the
  // unguided documents step.
  const pinned = flattenFields(getServiceSchema(34, 3));
  const pinnedById = new Map(pinned.map((field) => [field.id, field]));
  assert.equal(pinnedById.get("childless_declaration")?.type, "textarea");
  assert.ok(!pinnedById.has("childless_spouse_name_bn"));
  assert.equal(
    pinnedById.get("supporting_documents")?.constraints?.minRows,
    undefined,
  );
});

test("QAFIX-07: service 35 (character) unhides the marital status and asks what a character judgement needs", () => {
  assert.equal(getServiceSchema(35).version, 4);
  const schema = getServiceSchema(35);
  const fields = flattenFields(schema);
  const byId = new Map(fields.map((field) => [field.id, field]));
  // The checkbox is gone; the status leads, always visible, with
  // the character facts behind it.
  const details = schema.sections.find(
    (section) => section.id === "service_details",
  );
  assert.deepEqual(
    details?.fields.map((field) => field.id),
    [
      "marital_status",
      "character_occupation_bn",
      "character_occupation",
      "residence_duration_years",
      "supporting_documents",
    ],
  );
  assert.ok(!byId.has("marital_status_radio"), "opt-in checkbox removed");
  const status = byId.get("marital_status");
  assert.equal(status?.visibleWhen, undefined, "marital status must not be hidden");
  assert.equal(status?.constraints?.required, true);
  assert.deepEqual(
    (status?.options ?? []).map((opt) => opt.value),
    ["unmarried", "married", "widowed", "divorced"],
  );
  assert.equal(byId.get("character_occupation_bn")?.constraints?.required, true);
  assert.equal(byId.get("character_occupation")?.constraints?.required, true);
  assert.equal(byId.get("residence_duration_years")?.constraints?.required, true);
  assert.equal(byId.get("residence_duration_years")?.constraints?.min, 0);
  // The demo payload validates with no toggle anywhere; a missing
  // status or occupation is rejected.
  const payload = getDemoPayload(35);
  assert.equal(validateServicePayload(35, payload).valid, true);
  const { marital_status: _ms, ...noStatus } = payload;
  assert.ok(
    validateServicePayload(35, noStatus).issues.some(
      (issue) => issue.path === "marital_status" && issue.code === "required",
    ),
  );
  assert.ok(
    validateServicePayload(35, { ...payload, character_occupation: "" }).issues.some(
      (issue) => issue.path === "character_occupation" && issue.code === "required",
    ),
  );
  // The pinned v3 keeps the checkbox and the conditioned status.
  const pinned = flattenFields(getServiceSchema(35, 3));
  const pinnedById = new Map(pinned.map((field) => [field.id, field]));
  assert.ok(pinnedById.has("marital_status_radio"));
  assert.deepEqual(pinnedById.get("marital_status")?.visibleWhen, {
    field: "marital_status_radio",
    equals: true,
  });
  assert.ok(!pinnedById.has("character_occupation_bn"));
});

test("QAFIX-07: service 36 (NOC) keys the land and address blocks off a required NOC subject", () => {
  assert.equal(getServiceSchema(36).version, 6);
  const schema = getServiceSchema(36);
  const fields = flattenFields(schema);
  const byId = new Map(fields.map((field) => [field.id, field]));
  const details = schema.sections.find(
    (section) => section.id === "service_details",
  );
  const order = (details?.fields ?? []).map((field) => field.id);
  // The subject heads the form; the father's pair precedes the
  // mother's; the land block, address block and role/activity
  // close the section in their shipped relative order.
  assert.equal(order[0], "noc_subject");
  assert.ok(
    order.indexOf("proprietor_father_name_bn") <
      order.indexOf("proprietor_mother_name_bn"),
    "father pair precedes mother pair",
  );
  assert.deepEqual(
    (byId.get("noc_subject")?.options ?? []).map((opt) => opt.value),
    ["land", "business", "employment", "passport", "other"],
  );
  assert.equal(byId.get("noc_subject")?.constraints?.required, true);
  // The land block is gated on the land subject alone.
  for (const id of [
    "noc_org_mouza_name_bn",
    "noc_org_khatian_no",
    "noc_org_dag_no",
    "noc_org_total_area",
    "land_unit",
    "noc_org_area_holding",
  ])
    assert.deepEqual(
      byId.get(id)?.visibleWhen,
      { field: "noc_subject", equals: "land" },
      id,
    );
  // The address block is gated on land-or-business (engine `any`).
  for (const id of ["noc_org_add_type", "org_location", "post_office_id", "noc_org_ward_no"])
    assert.deepEqual(
      byId.get(id)?.visibleWhen,
      {
        any: [
          { field: "noc_subject", equals: "land" },
          { field: "noc_subject", equals: "business" },
        ],
      },
      id,
    );
  // The municipality branch composes both conditions (`all`).
  assert.deepEqual(byId.get("municipality_id")?.visibleWhen, {
    all: [
      {
        any: [
          { field: "noc_subject", equals: "land" },
          { field: "noc_subject", equals: "business" },
        ],
      },
      { field: "noc_org_add_type", equals: "municipality" },
    ],
  });
  // The organisation identity is gated on land/business/employment.
  assert.deepEqual(byId.get("noc_org_name_bn")?.visibleWhen, {
    any: [
      { field: "noc_subject", equals: "land" },
      { field: "noc_subject", equals: "business" },
      { field: "noc_subject", equals: "employment" },
    ],
  });
  // The proprietor label spelling is corrected.
  assert.equal(
    byId.get("noc_proprietor_bn")?.label.bn,
    "স্বত্বাধিকারী/প্রোপ্রাইটর নাম (বাংলায়)",
  );
  // The demo payload (subject = land) validates in full.
  const payload = getDemoPayload(36);
  assert.equal(payload.noc_subject, "land");
  assert.equal(validateServicePayload(36, payload).valid, true);
  // A land NOC without its khatian number is rejected.
  const { noc_org_khatian_no: _k, ...landMissing } = payload;
  assert.ok(
    validateServicePayload(36, landMissing).issues.some(
      (issue) => issue.path === "noc_org_khatian_no" && issue.code === "required",
    ),
  );
  // THE BLOCKER SCENARIO: a passport NOC needs no land, address or
  // organisation data at all — the same payload with the subject
  // switched and those blocks removed validates clean.
  const gated = [
    "noc_org_name_bn", "noc_org_name", "noc_org_type_bn", "noc_org_type",
    "noc_org_mouza_name_bn", "noc_org_mouza_name", "noc_org_khatian_no",
    "noc_org_dag_no", "noc_org_land_classification_bn",
    "noc_org_land_classification", "noc_org_total_area", "land_unit",
    "noc_org_area_holding_bn", "noc_org_area_holding", "noc_org_add_type",
    "org_location", "additional_thana_id", "post_office_id",
    "municipality_id", "city_corporation_id", "noc_org_ward_no",
  ];
  const passport: Record<string, unknown> = {
    ...payload,
    noc_subject: "passport",
  };
  for (const id of gated) delete passport[id];
  assert.equal(
    validateServicePayload(36, passport).valid,
    true,
    "a passport NOC carries no land, address or organisation data",
  );
  // Land data smuggled into a passport NOC is stale and rejected.
  assert.ok(
    validateServicePayload(36, {
      ...passport,
      noc_org_khatian_no: "123",
    }).issues.some(
      (issue) =>
        issue.path === "noc_org_khatian_no" && issue.code === "inactive_field",
    ),
  );
  // The pinned v5 has no subject, no gating, the mother pair first
  // and the uncorrected proprietor label.
  const pinned = flattenFields(getServiceSchema(36, 5));
  const pinnedById = new Map(pinned.map((field) => [field.id, field]));
  assert.ok(!pinnedById.has("noc_subject"));
  assert.equal(pinnedById.get("noc_org_khatian_no")?.visibleWhen, undefined);
  const pinnedDetails = getServiceSchema(36, 5).sections.find(
    (section) => section.id === "service_details",
  );
  const pinnedOrder = (pinnedDetails?.fields ?? []).map((field) => field.id);
  assert.ok(
    pinnedOrder.indexOf("proprietor_mother_name_bn") <
      pinnedOrder.indexOf("proprietor_father_name_bn"),
  );
});

test("QAFIX-08: service 37 (voter area transfer) aligns the previous-area pair and keeps the corrected reason label", () => {
  assert.equal(getServiceSchema(37).version, 5);
  const schema = getServiceSchema(37);
  const fields = flattenFields(schema);
  const byId = new Map(fields.map((field) => [field.id, field]));
  // The English companion mirrors the Bangla original exactly: a
  // required text field with the same limits (was an optional
  // textarea) — one required-ness rule per pair (§4 item 11), and
  // the pair cert-gates checks at issuance is always complete.
  const en = byId.get("previous_voter_area_en");
  assert.equal(en?.type, "text");
  assert.deepEqual(en?.constraints, {
    required: true,
    minLength: 2,
    maxLength: 500,
  });
  assert.deepEqual(byId.get("previous_voter_area")?.constraints, {
    required: true,
    minLength: 2,
    maxLength: 500,
  });
  // The pair sits adjacently, Bangla first.
  const details = schema.sections.find(
    (section) => section.id === "service_details",
  );
  const ids = (details?.fields ?? []).map((field) => field.id);
  assert.equal(
    ids.indexOf("previous_voter_area_en"),
    ids.indexOf("previous_voter_area") + 1,
  );
  // The reason label carries the §4-12 spelling কারণ (U+09A3).
  const reason = byId.get("application_voter_area_transfer_reason");
  assert.equal(reason?.label.bn, "ভোটার এলাকা স্থানান্তরের কারণ");
  assert.ok(reason?.label.bn.includes("কারণ"));
  assert.ok(!reason?.label.bn.includes("কারন"));
  // The demo payload validates; dropping the English companion now
  // fails as required (the pair is demanded together).
  const payload = getDemoPayload(37);
  assert.equal(validateServicePayload(37, payload).valid, true);
  const { previous_voter_area_en: _en, ...withoutEn } = payload;
  assert.ok(
    validateServicePayload(37, withoutEn).issues.some(
      (issue) =>
        issue.path === "previous_voter_area_en" && issue.code === "required",
    ),
  );
  // No identity fields were added: the certificate chassis prints
  // the applicant's identity from the citizen record (Form 15
  // precedent), so the form carries no name/parents/DOB/NID/mobile
  // field of its own.
  for (const id of [
    "applicant_name_bn",
    "father_name_bn",
    "mother_name_bn",
    "date_of_birth",
    "nid_number",
    "mobile",
  ])
    assert.equal(byId.has(id), false, `${id} must not be a form field`);
  // The pinned v4 keeps the optional textarea companion.
  const pinnedById = new Map(
    flattenFields(getServiceSchema(37, 4)).map((field) => [field.id, field]),
  );
  assert.equal(pinnedById.get("previous_voter_area_en")?.type, "textarea");
  assert.equal(
    pinnedById.get("previous_voter_area_en")?.constraints?.required,
    false,
  );
});

test("QAFIX-08: service 38 (disability) states who the application is for, grades severity, captures the diagnosis and names its medical evidence", () => {
  assert.equal(getServiceSchema(38).version, 5);
  const schema = getServiceSchema(38);
  const fields = flattenFields(schema);
  const byId = new Map(fields.map((field) => [field.id, field]));
  const details = schema.sections.find(
    (section) => section.id === "service_details",
  );
  // The relation heads the form; the subject pair is gated on
  // "other"; severity and the diagnosis pair follow the type.
  assert.deepEqual(
    (details?.fields ?? []).map((field) => field.id),
    [
      "disability_applicant_relation",
      "disability_subject_name_bn",
      "disability_subject_name",
      "application_autistic_type",
      "disability_severity",
      "disability_diagnosis_bn",
      "disability_diagnosis",
      "support_needs",
      "support_needs_en",
      "supporting_documents",
    ],
  );
  assert.deepEqual(
    (byId.get("disability_applicant_relation")?.options ?? []).map(
      (opt) => opt.value,
    ),
    ["self", "other"],
  );
  assert.deepEqual(byId.get("disability_subject_name_bn")?.visibleWhen, {
    field: "disability_applicant_relation",
    equals: "other",
  });
  assert.deepEqual(
    (byId.get("disability_severity")?.options ?? []).map((opt) => opt.value),
    ["mild", "moderate", "severe", "profound"],
  );
  // The support-needs pair is aligned: both required, same limits,
  // seated adjacently (Bangla first).
  assert.deepEqual(byId.get("support_needs")?.constraints, {
    required: true,
    minLength: 2,
    maxLength: 1000,
  });
  assert.deepEqual(byId.get("support_needs_en")?.constraints, {
    required: true,
    minLength: 2,
    maxLength: 1000,
  });
  // The documents step names the medical certificate and seeds a row.
  const docs = byId.get("supporting_documents");
  assert.equal(docs?.constraints?.minRows, 1);
  assert.match(docs?.description?.en ?? "", /medical\/disability certificate/);
  // The synthetic payload (relation = self) validates; an
  // application for someone else without the subject's name fails,
  // and a self application carrying subject names is stale data.
  const payload = getDemoPayload(38);
  assert.equal(payload.disability_applicant_relation, "self");
  assert.equal(validateServicePayload(38, payload).valid, true);
  const forOther = {
    ...payload,
    disability_applicant_relation: "other",
  };
  assert.ok(
    validateServicePayload(38, forOther).issues.some(
      (issue) =>
        issue.path === "disability_subject_name_bn" &&
        issue.code === "required",
    ),
  );
  const completeOther = {
    ...forOther,
    disability_subject_name_bn: "রহিমা খাতুন",
    disability_subject_name: "Rahima Khatun",
  };
  assert.equal(validateServicePayload(38, completeOther).valid, true);
  // Subject names smuggled into a self application are inactive.
  assert.ok(
    validateServicePayload(38, {
      ...payload,
      disability_subject_name_bn: "রহিমা খাতুন",
    }).issues.some(
      (issue) =>
        issue.path === "disability_subject_name_bn" &&
        issue.code === "inactive_field",
    ),
  );
  // The pinned v4 has none of the new fields and keeps the English
  // support needs optional.
  const pinnedById = new Map(
    flattenFields(getServiceSchema(38, 4)).map((field) => [field.id, field]),
  );
  assert.equal(pinnedById.has("disability_applicant_relation"), false);
  assert.equal(pinnedById.has("disability_severity"), false);
  assert.equal(
    pinnedById.get("support_needs_en")?.constraints?.required,
    false,
  );
  assert.equal(
    pinnedById.get("supporting_documents")?.constraints?.minRows,
    undefined,
  );
});

test("QAFIX-08: service 39 (same person) explains its name slots, reseats the second form and drops 'self' from the related-person list", () => {
  assert.equal(getServiceSchema(39).version, 5);
  const schema = getServiceSchema(39);
  const fields = flattenFields(schema);
  const byId = new Map(fields.map((field) => [field.id, field]));
  const details = schema.sections.find(
    (section) => section.id === "service_details",
  );
  // The full field order: both name forms together (the second no
  // longer parked after the documents group), the evidence pair,
  // then the deceased/related blocks, documents last.
  assert.deepEqual(
    (details?.fields ?? []).map((field) => field.id),
    [
      "spi_name_bn",
      "spi_name_en",
      "spi_name_2_bn",
      "spi_name_2_en",
      "spi_variant_evidence_bn",
      "spi_variant_evidence",
      "spi_is_dead",
      "spi_death_date",
      "relation_person",
      "spi_relation",
      "spi_relation_person_name_bn",
      "spi_relation_person_name",
      "supporting_documents",
    ],
  );
  // Both slots say they hold the name as written in the documents,
  // and each pair's Bangla field explains the split (the correct
  // name prints from the profile).
  assert.equal(
    byId.get("spi_name_bn")?.label.en,
    "Name as written in the documents (Bangla)",
  );
  assert.equal(
    byId.get("spi_name_2_en")?.label.en,
    "Other form of the name in the documents (English)",
  );
  assert.match(byId.get("spi_name_bn")?.description?.en ?? "", /correct name is printed/);
  assert.match(byId.get("spi_name_2_bn")?.description?.en ?? "", /different form or spelling/);
  // The related-person list no longer offers "self".
  assert.deepEqual(
    (byId.get("spi_relation")?.options ?? []).map((opt) => opt.value),
    ["spouse", "child", "parent", "sibling", "other"],
  );
  // The documents step names the variant-bearing documents.
  const docs = byId.get("supporting_documents");
  assert.equal(docs?.constraints?.minRows, 1);
  assert.match(docs?.description?.en ?? "", /name forms appear/);
  // The synthetic payload validates; the pinned v4 keeps the old
  // labels, the parked second pair and "self".
  assert.equal(validateServicePayload(39, getDemoPayload(39)).valid, true);
  const pinned = getServiceSchema(39, 4);
  const pinnedById = new Map(
    flattenFields(pinned).map((field) => [field.id, field]),
  );
  assert.equal(pinnedById.get("spi_name_bn")?.label.bn, "একই ব্যক্তির নাম (বাংলায়)");
  assert.deepEqual(
    (pinnedById.get("spi_relation")?.options ?? []).map((opt) => opt.value),
    ["self", "spouse", "child", "parent", "sibling", "other"],
  );
  const pinnedDetails = pinned.sections.find(
    (section) => section.id === "service_details",
  );
  const pinnedIds = (pinnedDetails?.fields ?? []).map((field) => field.id);
  assert.ok(
    pinnedIds.indexOf("spi_name_2_bn") > pinnedIds.indexOf("supporting_documents"),
    "v4 parked the second form after the documents group",
  );
});

test("QAFIX-08: service 40 (tribal) takes its community from the recognised list and names its identity proof", () => {
  assert.equal(getServiceSchema(40).version, 5);
  const schema = getServiceSchema(40);
  const fields = flattenFields(schema);
  const byId = new Map(fields.map((field) => [field.id, field]));
  // One bilingual select carries both languages (the service-18
  // list); the separate English free-text field is gone from the
  // form but stays in the version's evidence names.
  const community = byId.get("community_name");
  assert.equal(community?.type, "select");
  assert.deepEqual(community?.constraints, { required: true });
  assert.deepEqual(
    (community?.options ?? []).map((opt) => opt.value),
    (
      flattenFields(getServiceSchema(18)).find(
        (field) => field.id === "community_name",
      )?.options ?? []
    ).map((opt) => opt.value),
    "service 40 shares service 18's recognised-community list",
  );
  assert.ok((community?.options ?? []).some((opt) => opt.value === "chakma"));
  assert.ok((community?.options ?? []).some((opt) => opt.value === "other"));
  assert.equal(byId.has("community_name_en"), false);
  assert.deepEqual(community?.evidence?.fieldNames, [
    "community_name",
    "community_name_en",
  ]);
  // The basis of membership is a fixed select, not free text.
  assert.equal(byId.get("community_affiliation")?.type, "select");
  assert.deepEqual(
    (byId.get("community_affiliation")?.options ?? []).map((opt) => opt.value),
    ["by_birth", "by_descent", "by_marriage", "other"],
  );
  // The documents step names tribal-identity proof.
  const docs = byId.get("supporting_documents");
  assert.equal(docs?.constraints?.minRows, 1);
  assert.match(docs?.description?.en ?? "", /proof of ethnic-minority identity/);
  // The synthetic payload validates with a listed community.
  const payload = getDemoPayload(40);
  assert.equal(validateServicePayload(40, payload).valid, true);
  // The pinned v4 keeps both free-text fields and generic documents.
  const pinnedById = new Map(
    flattenFields(getServiceSchema(40, 4)).map((field) => [field.id, field]),
  );
  assert.equal(pinnedById.get("community_name")?.type, "text");
  assert.equal(pinnedById.get("community_name_en")?.type, "text");
  assert.equal(pinnedById.get("community_affiliation")?.type, "text");
  assert.equal(
    pinnedById.get("supporting_documents")?.constraints?.minRows,
    undefined,
  );
});

test("QAFIX-08: service 41 (premises licence) drops the citizen-typed fee fields and corrects its labels and help texts", () => {
  assert.equal(getServiceSchema(41).version, 6);
  const schema = getServiceSchema(41);
  const fields = flattenFields(schema);
  const byId = new Map(fields.map((field) => [field.id, field]));
  // (a) No citizen-entered fee or VAT field remains anywhere.
  assert.equal(byId.has("premises_fee_licence"), false);
  assert.equal(byId.has("premises_fee_vat"), false);
  // (b) The proprietor labels spell both words correctly, and the
  // pair sits Bangla-first in its section.
  assert.equal(
    byId.get("primises_license_proprietor_bn")?.label.bn,
    "স্বত্বাধিকারী/প্রোপ্রাইটর নাম (বাংলা)",
  );
  assert.equal(
    byId.get("primises_license_proprietor")?.label.bn,
    "স্বত্বাধিকারী/প্রোপ্রাইটর নাম (ইংরেজি)",
  );
  const proprietorSection = schema.sections.find((section) =>
    section.fields.some((field) => field.id === "primises_license_proprietor_bn"),
  );
  const proprietorIds = (proprietorSection?.fields ?? []).map(
    (field) => field.id,
  );
  assert.ok(
    proprietorIds.indexOf("primises_license_proprietor_bn") <
      proprietorIds.indexOf("primises_license_proprietor"),
    "proprietor pair is Bangla-first",
  );
  // (c) Each address component carries its own help text.
  assert.equal(
    byId.get("additional_thana_id")?.description?.en,
    "Write the police station (thana) name.",
  );
  assert.equal(
    byId.get("post_office_id")?.description?.en,
    "Write the post office name.",
  );
  assert.equal(
    byId.get("municipality_id")?.description?.en,
    "Write the municipality name.",
  );
  assert.equal(
    byId.get("city_corporation_id")?.description?.en,
    "Write the city corporation name.",
  );
  // (d) The capital label says amount in figures, BDT.
  assert.equal(
    byId.get("primises_license_capital")?.label.en,
    "Capital (amount in figures, BDT)",
  );
  // The synthetic payload validates without any fee values; the
  // pinned v5 still carries the fee fields and the old labels.
  assert.equal(validateServicePayload(41, getDemoPayload(41)).valid, true);
  const pinnedById = new Map(
    flattenFields(getServiceSchema(41, 5)).map((field) => [field.id, field]),
  );
  assert.equal(pinnedById.has("premises_fee_licence"), true);
  assert.equal(pinnedById.has("premises_fee_vat"), true);
  assert.match(
    pinnedById.get("primises_license_proprietor_bn")?.label.bn ?? "",
    /প্রোপাইটর/,
  );
});

test("QAFIX-08: service 42 (trade licence) drops its fee and family extras, fixes its organisation type and gains the purpose section", () => {
  assert.equal(getServiceSchema(42).version, 6);
  const schema = getServiceSchema(42);
  const fields = flattenFields(schema);
  const byId = new Map(fields.map((field) => [field.id, field]));
  // (a) All eight citizen-typed fee fields are gone.
  for (const gone of [
    "trade_fee_new",
    "trade_fee_renewal",
    "trade_fee_arrear",
    "trade_fee_surcharge",
    "trade_fee_amendment",
    "trade_fee_signboard",
    "trade_fee_profession_tax",
    "trade_fee_vat",
  ])
    assert.equal(byId.has(gone), false, `${gone} removed`);
  // (b) The copied family-name fields are gone.
  for (const gone of [
    "proprietor_mother_name_bn",
    "proprietor_mother_name",
    "proprietor_father_name_bn",
    "proprietor_father_name",
    "proprietor_spouse_name_bn",
    "proprietor_spouse_name",
  ])
    assert.equal(byId.has(gone), false, `${gone} removed`);
  // (c) The organisation type is one bilingual select; the Bangla
  // free-text twin is gone from the form but kept in the evidence
  // names.
  const orgType = byId.get("trade_license_org_type");
  assert.equal(orgType?.type, "select");
  assert.deepEqual(
    (orgType?.options ?? []).map((opt) => opt.value),
    [
      "proprietorship",
      "partnership",
      "private_limited",
      "public_limited",
      "cooperative",
      "other",
    ],
  );
  assert.deepEqual(orgType?.evidence?.fieldNames, [
    "trade_license_org_type_bn",
    "trade_license_org_type",
  ]);
  assert.equal(byId.has("trade_license_org_type_bn"), false);
  // (d) The standard purpose-and-language section closes the form,
  // without duplicating the renewal section's confirmation.
  const context = schema.sections.find(
    (section) => section.id === "application_context",
  );
  assert.deepEqual(
    (context?.fields ?? []).map((field) => field.id),
    ["address_source", "purpose", "purpose_language", "delivery_language"],
  );
  assert.equal(
    fields.filter((field) => field.id === "confirmation").length,
    1,
    "exactly one confirmation field",
  );
  // The praised previous-licence pattern is intact.
  assert.deepEqual(byId.get("previous_license_number")?.visibleWhen, {
    field: "has_previous_license",
    equals: true,
  });
  // The synthetic payload (fixture now carrying the context
  // fields) validates; the pinned v5 keeps the fees, the family
  // fields and no context section.
  const payload = getDemoPayload(42);
  assert.equal(payload.delivery_language, "bilingual");
  assert.equal(validateServicePayload(42, payload).valid, true);
  const pinned = getServiceSchema(42, 5);
  const pinnedById = new Map(
    flattenFields(pinned).map((field) => [field.id, field]),
  );
  assert.equal(pinnedById.has("trade_fee_vat"), true);
  assert.equal(pinnedById.has("proprietor_mother_name_bn"), true);
  assert.equal(pinnedById.get("trade_license_org_type")?.type, "text");
  assert.equal(
    pinned.sections.some((section) => section.id === "application_context"),
    false,
  );
});

test("QAFIX-09: service 43 (voter list inclusion) captures the dropped entry's identifiers and aligns the omission pair", () => {
  assert.equal(getServiceSchema(43).version, 5);
  const schema = getServiceSchema(43);
  const fields = flattenFields(schema);
  const byId = new Map(fields.map((field) => [field.id, field]));
  // The reference field now says what to write: the previous voter
  // area whose list carried the name.
  const reference = byId.get("previous_voter_reference");
  assert.equal(reference?.constraints?.required, true);
  assert.ok(reference?.description?.bn.includes("ভোটার এলাকার নাম"));
  assert.ok(reference?.description?.en.includes("previous voter area"));
  // The dropped entry's lookup keys are captured: voter ID
  // (required), serial (optional — one identifier is enough),
  // ward (required) and the omission date (required, not future).
  assert.equal(byId.get("previous_voter_id")?.type, "text");
  assert.equal(byId.get("previous_voter_id")?.constraints?.required, true);
  assert.equal(byId.get("previous_voter_serial")?.type, "text");
  assert.notEqual(byId.get("previous_voter_serial")?.constraints?.required, true);
  assert.equal(byId.get("omission_ward_no")?.type, "number");
  assert.equal(byId.get("omission_ward_no")?.constraints?.required, true);
  assert.equal(byId.get("omission_date")?.type, "date");
  assert.equal(byId.get("omission_date")?.constraints?.required, true);
  assert.equal(byId.get("omission_date")?.constraints?.notFuture, true);
  // The identifiers sit between the reference and the omission
  // pair, in service_details.
  const details = schema.sections.find(
    (section) => section.id === "service_details",
  );
  const ids = (details?.fields ?? []).map((field) => field.id);
  assert.deepEqual(ids.slice(0, 7), [
    "previous_voter_reference",
    "previous_voter_id",
    "previous_voter_serial",
    "omission_ward_no",
    "omission_date",
    "omission_details",
    "omission_details_en",
  ]);
  // One required-ness rule per pair (§4 item 11): the English
  // omission details are required like the Bangla original, and
  // the pair sits adjacently ahead of the documents group.
  assert.equal(byId.get("omission_details")?.constraints?.required, true);
  assert.equal(byId.get("omission_details_en")?.constraints?.required, true);
  assert.equal(
    ids.indexOf("omission_details_en"),
    ids.indexOf("omission_details") + 1,
  );
  assert.ok(ids.indexOf("supporting_documents") > ids.indexOf("omission_details_en"));
  // The catalogue name spells পড়ায় with the decomposed ড + ়
  // (U+09A1 U+09BC), like the form labels and the certificate —
  // never the precomposed ড় (U+09DC) (§4 item 12).
  const catalogued = serviceCatalog.find((service) => service.service_no === 43);
  assert.ok(
    catalogued?.name_bn.includes("\u09AA\u09A1\u09BC\u09BE\u09AF\u09BC"),
    "catalogue name spells পড়ায় with decomposed ড + ় and য + ়",
  );
  assert.ok(
    !catalogued?.name_bn.includes("\u09DC"),
    "catalogue name never uses precomposed ড় (U+09DC)",
  );
  // The demo payload validates; dropping a required lookup key or
  // the English omission text fails; a future omission date fails.
  const payload = getDemoPayload(43);
  assert.equal(validateServicePayload(43, payload).valid, true);
  const { previous_voter_id: _id, ...withoutId } = payload;
  assert.ok(
    validateServicePayload(43, withoutId).issues.some(
      (issue) => issue.path === "previous_voter_id" && issue.code === "required",
    ),
  );
  const { omission_details_en: _en, ...withoutEn } = payload;
  assert.ok(
    validateServicePayload(43, withoutEn).issues.some(
      (issue) =>
        issue.path === "omission_details_en" && issue.code === "required",
    ),
  );
  assert.ok(
    validateServicePayload(43, { ...payload, omission_date: "2999-01-01" })
      .issues.some((issue) => issue.path === "omission_date"),
  );
  // The pinned v4 has none of the identifiers and keeps the
  // English omission text optional.
  const pinnedById = new Map(
    flattenFields(getServiceSchema(43, 4)).map((field) => [field.id, field]),
  );
  assert.equal(pinnedById.has("previous_voter_id"), false);
  assert.equal(pinnedById.has("omission_date"), false);
  assert.notEqual(
    pinnedById.get("omission_details_en")?.constraints?.required,
    true,
  );
  assert.equal(
    pinnedById.get("previous_voter_reference")?.description,
    undefined,
  );
});

test("QAFIX-09: service 44 (non-remarriage) offers the divorce path, gates each date on its end type and fixes the declaration", () => {
  assert.equal(getServiceSchema(44).version, 5);
  const schema = getServiceSchema(44);
  const fields = flattenFields(schema);
  const byId = new Map(fields.map((field) => [field.id, field]));
  // The end-of-marriage select offers exactly death / divorce.
  const endType = byId.get("marriage_end_type");
  assert.equal(endType?.type, "select");
  assert.equal(endType?.constraints?.required, true);
  assert.deepEqual(
    (endType?.options ?? []).map((option) => option.value),
    ["spouse_death", "divorce"],
  );
  // Each date shows only on its own path and is required there.
  assert.deepEqual(byId.get("spouse_death_date")?.visibleWhen, {
    field: "marriage_end_type",
    equals: "spouse_death",
  });
  assert.equal(byId.get("spouse_death_date")?.constraints?.required, true);
  assert.deepEqual(byId.get("divorce_date")?.visibleWhen, {
    field: "marriage_end_type",
    equals: "divorce",
  });
  assert.equal(byId.get("divorce_date")?.constraints?.required, true);
  // The free-text declaration is gone; a fixed mustBeTrue
  // declaration checkbox stands in its place.
  assert.equal(byId.has("non_remarriage_declaration"), false);
  const declaration = byId.get("non_remarriage_declaration_confirmed");
  assert.equal(declaration?.type, "checkbox");
  assert.equal(declaration?.constraints?.mustBeTrue, true);
  assert.ok(declaration?.label.en.includes("I declare that I have not remarried"));
  // One required-ness rule per pair (§4 item 11).
  assert.equal(byId.get("previous_spouse_name")?.constraints?.required, true);
  assert.equal(byId.get("previous_spouse_name_en")?.constraints?.required, true);
  // The repaired block sits ahead of the documents group.
  const details = schema.sections.find(
    (section) => section.id === "service_details",
  );
  const ids = (details?.fields ?? []).map((field) => field.id);
  assert.deepEqual(ids, [
    "previous_spouse_name",
    "previous_spouse_name_en",
    "marriage_end_type",
    "spouse_death_date",
    "divorce_date",
    "non_remarriage_declaration_confirmed",
    "supporting_documents",
  ]);
  // The demo payload (death path) validates; the divorce path
  // demands its own date and ignores the death date; a payload
  // with no end type cannot demand either date.
  const payload = getDemoPayload(44);
  assert.equal(payload.marriage_end_type, "spouse_death");
  assert.equal(validateServicePayload(44, payload).valid, true);
  const divorce: Record<string, unknown> = {
    ...payload,
    marriage_end_type: "divorce",
    divorce_date: "2021-05-10",
  };
  delete divorce.spouse_death_date;
  assert.equal(validateServicePayload(44, divorce).valid, true);
  const divorceDateless: Record<string, unknown> = { ...divorce };
  delete divorceDateless.divorce_date;
  assert.ok(
    validateServicePayload(44, divorceDateless).issues.some(
      (issue) => issue.path === "divorce_date" && issue.code === "required",
    ),
  );
  const { marriage_end_type: _t, ...noType } = payload;
  assert.ok(
    validateServicePayload(44, noType).issues.some(
      (issue) => issue.path === "marriage_end_type" && issue.code === "required",
    ),
  );
  // The pinned v4 keeps the required death date, the free-text
  // declaration and the optional English name.
  const pinnedById = new Map(
    flattenFields(getServiceSchema(44, 4)).map((field) => [field.id, field]),
  );
  assert.equal(pinnedById.get("spouse_death_date")?.constraints?.required, true);
  assert.equal(pinnedById.get("spouse_death_date")?.visibleWhen, undefined);
  assert.equal(pinnedById.get("non_remarriage_declaration")?.type, "textarea");
  assert.notEqual(
    pinnedById.get("previous_spouse_name_en")?.constraints?.required,
    true,
  );
  assert.equal(pinnedById.has("marriage_end_type"), false);
});

test("QAFIX-09: service 45 (permanent resident) gains the address select and the residence-proof documents step", () => {
  assert.equal(getServiceSchema(45).version, 3);
  const schema = getServiceSchema(45);
  const fields = flattenFields(schema);
  const byId = new Map(fields.map((field) => [field.id, field]));
  // The standard applicable-address select, identical to the
  // siblings' application-context field.
  const addressSource = byId.get("address_source");
  assert.equal(addressSource?.type, "select");
  assert.equal(addressSource?.constraints?.required, true);
  assert.deepEqual(
    (addressSource?.options ?? []).map((option) => option.value),
    ["present", "permanent", "both"],
  );
  // The documents step exists, names the acceptable residence
  // proof and cannot be skipped silently (minRows 1, §4 item 5).
  const documents = byId.get("supporting_documents");
  assert.equal(documents?.type, "repeatable");
  assert.equal(documents?.constraints?.minRows, 1);
  assert.ok(documents?.description?.bn.includes("হোল্ডিং কর রসিদ"));
  assert.ok(documents?.description?.en.includes("holding-tax receipt"));
  const childById = new Map(
    (documents?.children ?? []).map((child) => [child.id, child]),
  );
  assert.equal(childById.get("description")?.constraints?.required, true);
  assert.equal(childById.get("file")?.constraints?.required, true);
  // The residency section carries the pair, the select ahead of
  // the purpose and the documents last.
  const residency = schema.sections.find(
    (section) => section.id === "residency",
  );
  assert.deepEqual(
    (residency?.fields ?? []).map((field) => field.id),
    [
      "permanent_address_bn",
      "permanent_address_en",
      "residence_since",
      "address_source",
      "purpose",
      "purpose_language",
      "supporting_documents",
    ],
  );
  // The language label already reads নথির ভাষা in the published
  // schema (QAFIX-01) — the §3.45 mismatch was the r8 build;
  // pinned here so it cannot regress.
  assert.equal(byId.get("delivery_language")?.label.bn, "নথির ভাষা");
  // The demo payload validates against the new version.
  assert.equal(validateServicePayload(45, getDemoPayload(45)).valid, true);
  // The pinned v2 has neither addition.
  const pinnedById = new Map(
    flattenFields(getServiceSchema(45, 2)).map((field) => [field.id, field]),
  );
  assert.equal(pinnedById.has("address_source"), false);
  assert.equal(pinnedById.has("supporting_documents"), false);
});

test("QAFIX-09: service 46 (vehicle licence) gates the licence number, restores the height label and drops the spouse pair", () => {
  assert.equal(getServiceSchema(46).version, 5);
  const schema = getServiceSchema(46);
  const fields = flattenFields(schema);
  const byId = new Map(fields.map((field) => [field.id, field]));
  // The previous-licence gate (Form 42 pattern): a plain required
  // checkbox; the number shows and is required only when ticked.
  const gate = byId.get("has_existing_transport_license");
  assert.equal(gate?.type, "checkbox");
  assert.equal(gate?.constraints?.required, true);
  assert.notEqual(gate?.constraints?.mustBeTrue, true);
  const licenceNo = byId.get("transport_license_no");
  assert.deepEqual(licenceNo?.visibleWhen, {
    field: "has_existing_transport_license",
    equals: true,
  });
  assert.equal(licenceNo?.constraints?.required, true);
  // The truncated label is whole again, matching its siblings.
  assert.equal(
    byId.get("transport_license_height")?.label.bn,
    "উচ্চতা সংখ্যায় (ইংরেজিতে)",
  );
  // Mobile is required, as on service 42.
  assert.equal(byId.get("transport_license_mobile")?.constraints?.required, true);
  // The copied spouse pair is gone.
  assert.equal(byId.has("proprietor_spouse_name_bn"), false);
  assert.equal(byId.has("proprietor_spouse_name"), false);
  // Motorcycle and car join the classes ahead of "other".
  assert.deepEqual(
    (byId.get("transport_vehicle_class")?.options ?? []).map(
      (option) => option.value,
    ),
    ["rickshaw", "van", "mishuk", "motorcycle", "car", "other"],
  );
  const classOptions = byId.get("transport_vehicle_class")?.options ?? [];
  assert.equal(
    classOptions.find((option) => option.value === "motorcycle")?.label.en,
    "Motorcycle",
  );
  assert.equal(
    classOptions.find((option) => option.value === "car")?.label.en,
    "Car / private car",
  );
  // The gate seats immediately ahead of the number it gates.
  const details = schema.sections.find(
    (section) => section.id === "service_details",
  );
  const ids = (details?.fields ?? []).map((field) => field.id);
  assert.equal(
    ids.indexOf("has_existing_transport_license"),
    ids.indexOf("transport_license_no") - 1,
  );
  // Payloads: the first-time path (gate unticked, no number)
  // validates; the renewal path demands the number.
  const payload = getDemoPayload(46);
  assert.equal(payload.has_existing_transport_license, false);
  assert.equal(validateServicePayload(46, payload).valid, true);
  const renewal = { ...payload, has_existing_transport_license: true };
  assert.ok(
    validateServicePayload(46, renewal).issues.some(
      (issue) => issue.path === "transport_license_no" && issue.code === "required",
    ),
  );
  assert.equal(
    validateServicePayload(46, {
      ...renewal,
      transport_license_no: "DHAKA-METRO-1234",
    }).valid,
    true,
  );
  // The pinned v4 keeps the always-required number, the optional
  // mobile, the spouse pair and the truncated label.
  const pinnedById = new Map(
    flattenFields(getServiceSchema(46, 4)).map((field) => [field.id, field]),
  );
  assert.equal(pinnedById.get("transport_license_no")?.visibleWhen, undefined);
  assert.notEqual(
    pinnedById.get("transport_license_mobile")?.constraints?.required,
    true,
  );
  assert.equal(pinnedById.has("proprietor_spouse_name"), true);
  assert.equal(pinnedById.get("transport_license_height")?.label.bn, "বাগা");
});

test("QAFIX-09: service 47 (miscellaneous) names the closing statement and explains it; pairs and spelling verified", () => {
  assert.equal(getServiceSchema(47).version, 4);
  const schema = getServiceSchema(47);
  const fields = flattenFields(schema);
  const byId = new Map(fields.map((field) => [field.id, field]));
  // The closing statement is named as such, with guidance, and
  // stays optional in both languages.
  const footerBn = byId.get("certificate_footer_bn");
  const footerEn = byId.get("certificate_footer_en");
  assert.equal(footerBn?.label.bn, "সনদের সমাপনী বক্তব্য (বাংলায়)");
  assert.equal(footerBn?.label.en, "Certificate closing statement (Bangla)");
  assert.equal(footerEn?.label.bn, "সনদের সমাপনী বক্তব্য (ইংরেজিতে)");
  assert.equal(footerEn?.label.en, "Certificate closing statement (English)");
  for (const footer of [footerBn, footerEn]) {
    assert.notEqual(footer?.constraints?.required, true);
    assert.ok(footer?.description?.bn.includes("সমাপনী লাইন"));
    assert.ok(footer?.description?.en.includes("closing line"));
    assert.ok(footer?.description?.en.includes("still issued if you leave it empty"));
  }
  // The fields sit as adjacent BN/EN pairs (§4 item 11) — the
  // published order, asserted so it cannot regress.
  const details = schema.sections.find(
    (section) => section.id === "service_details",
  );
  assert.deepEqual(
    (details?.fields ?? []).map((field) => field.id),
    [
      "application_prottoyon_for",
      "certificate_type_bn",
      "certificate_type_en",
      "certificate_details_bn",
      "certificate_details_en",
      "certificate_footer_bn",
      "certificate_footer_en",
      "supporting_documents",
    ],
  );
  // "নেওয়ার" is spelled with the decomposed য় (U+09AF U+09BC),
  // never the precomposed ড়/য় codepoints.
  const reasonLabel = byId.get("application_prottoyon_for")?.label.bn ?? "";
  assert.ok(reasonLabel.includes("নেও\u09AF\u09BC\u09BE\u09B0"));
  assert.ok(!reasonLabel.includes("\u09DC") && !reasonLabel.includes("\u09DF"));
  // The demo payload validates; the pinned v3 keeps the bare
  // "পরিশেষ" labels and no guidance.
  assert.equal(validateServicePayload(47, getDemoPayload(47)).valid, true);
  const pinnedById = new Map(
    flattenFields(getServiceSchema(47, 3)).map((field) => [field.id, field]),
  );
  assert.equal(pinnedById.get("certificate_footer_bn")?.label.bn, "পরিশেষ (বাংলায়)");
  assert.equal(pinnedById.get("certificate_footer_bn")?.description, undefined);
});

test("Phase 0: every service has a capture file headed with its number", async () => {
  const fs = await import("node:fs");
  const { captureDirectory, captureFileName } = await import(
    "../../../scripts/evidence/capture-files.js"
  );
  for (const service of serviceCatalog) {
    const file = `${captureDirectory}/${captureFileName(service.service_no, service.name_en)}`;
    assert.ok(fs.existsSync(file), `missing ${file}`);
    assert.match(
      fs.readFileSync(file, "utf8").split("\n")[0],
      new RegExp(`^# Service ${service.service_no}: `),
    );
  }
  assert.equal(fs.readdirSync(captureDirectory).filter((n: string) => n.endsWith(".md")).length, serviceCatalog.length);
});
