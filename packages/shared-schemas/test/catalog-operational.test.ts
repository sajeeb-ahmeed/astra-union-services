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
        field.id !== "confirmation",
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
  // 44 legacy v1 + trade/family v1 + 3 superseded v2 (geography release) + 47 current.
  assert.equal(allServiceSchemaVersions.length, 96);
  assert.equal(
    new Set(
      allServiceSchemaVersions.map(
        (schema) => `${schema.serviceNo}:${schema.version}`,
      ),
    ).size,
    96,
  );
  for (const historical of legacyOperationalSchemas) {
    assert.equal(historical.version, 1);
    assert.equal(
      stableSchemaJson(getServiceSchema(historical.serviceNo, 1)),
      stableSchemaJson(historical),
    );
    assert.equal(
      getServiceSchema(historical.serviceNo).version,
      [36, 41].includes(historical.serviceNo) ? 3 : 2,
    );
    assert.throws(() => getServiceSchema(historical.serviceNo, 99), RangeError);
  }
  assert.equal(getServiceSchema(42).version, 3);
  assert.equal(getServiceSchema(2).version, 2);
  assert.equal(getServiceSchema(45).version, 1);
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
  assert.equal(validateServicePayload(42, getDemoPayload(42), 1).valid, true);
  assert.equal(validateServicePayload(42, getDemoPayload(42), 2).valid, true);
  const expanded = {
    ...getDemoPayload(42),
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
  assert.equal(validateServicePayload(2, base, 1).valid, true);
  assert.equal(validateServicePayload(2, base, 2).valid, true);
  const member = (base.members as Record<string, unknown>[])[0];
  const expanded = {
    ...base,
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
  for (const service of serviceCatalog) {
    const fields = descend(flattenFields(getServiceSchema(service.service_no)));
    const mapped = new Set(
      fields.flatMap((field) => field.evidence?.fieldNames ?? []),
    );
    for (const name of service.service_specific_visible_field_names)
      assert.ok(mapped.has(name), `${service.service_no}: ${name}`);
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
  for (const no of [3, 4, 5, 8, 9]) {
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
    [20, "other_freedom_fighter", "other_freedom_fighter_name"],
    [23, "other_person", "other_person_name"],
    [29, "other_person", "other_person_name"],
    [35, "marital_status_radio", "marital_status"],
    [39, "spi_is_dead", "spi_death_date"],
    [39, "relation_person", "spi_relation_person_name"],
  ] as const;
  for (const [no, flag, dependent] of cases) {
    const payload = getDemoPayload(no);
    assert.ok(
      validateServicePayload(no, { ...payload, [flag]: true }).issues.some(
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
    assert.equal(current.version, 3);
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
      dead_info_dod: "2026-02-30",
    }).issues.some((issue) => issue.code === "date"),
  );
  const file = {
    attachmentId: "attachment_demo_123",
    mimeType: "application/pdf",
    byteLength: 500,
  };
  const payload = {
    ...getDemoPayload(22),
    application_parents_consent_letter: file,
  };
  assert.equal(validateServicePayload(22, payload).valid, true);
  assert.ok(
    validateServicePayload(22, {
      ...payload,
      application_parents_consent_letter: {
        ...file,
        url: "https://untrusted.example.test/document",
      },
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
