import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  deepFreeze,
  demoPayloads,
  evaluatePredicate,
  flattenFields,
  getCatalogPreviewSchema,
  getReferencePreview,
  getServiceSchema,
  isFieldVisible,
  namedDataFields,
  operationalSchemas,
  referenceCounts,
  serviceCatalog,
  stableSchemaJson,
  validateForm,
  validateServicePayload,
  type FormSchema,
} from "../src/index.js";

const clone = <T>(value: T): T => structuredClone(value);

test("47 service / 48 form / 26 common / 21 specialist / 39 groups / 217 data-name metadata boundary reconciles", () => {
  assert.equal(serviceCatalog.length, referenceCounts.services);
  assert.equal(new Set(serviceCatalog.map((item) => item.service_no)).size, 47);
  assert.equal(
    serviceCatalog.reduce((total, service) => total + service.forms.length, 0),
    48,
  );
  assert.equal(
    serviceCatalog.filter(
      (service) => service.initial_form_family === "common_order_payment",
    ).length,
    26,
  );
  assert.equal(
    serviceCatalog.filter(
      (service) =>
        service.initial_form_family === "specialist_additional_information",
    ).length,
    21,
  );
  assert.equal(
    new Set(
      serviceCatalog
        .flatMap((service) => service.field_group_codes)
        .filter((code) => code !== "C1"),
    ).size,
    39,
  );
  assert.equal(
    new Set(serviceCatalog.flatMap(namedDataFields).map((field) => field.name))
      .size,
    217,
  );
  assert.equal(
    new Set(
      serviceCatalog
        .flatMap((service) => service.forms.flatMap((form) => form.fields))
        .filter((field) => field.type === "hidden")
        .map((field) => field.name),
    ).size,
    25,
  );
  assert.equal(getReferencePreview(42).forms.length, 2);
});

test("sanitized derivation preserves every original safe field attribute in every captured form", async () => {
  const original = JSON.parse(
    await readFile(
      new URL(
        "../../../handoff/SANITIZED_SERVICE_FORM_SCHEMAS.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  for (const service of original.services) {
    const actual = getReferencePreview(service.service_no);
    assert.deepEqual(actual.forms, service.forms);
    assert.deepEqual(actual.field_group_codes, service.field_group_codes);
    assert.equal(actual.evidence_file, service.evidence_file);
    assert.ok(!("reference_service_selector" in actual));
    for (const form of actual.forms)
      for (const field of form.fields) {
        assert.deepEqual(
          Object.keys(field).sort(),
          [
            "accept",
            "label_bn",
            "maxlength",
            "name",
            "repeatable_array",
            "required_html",
            "type",
          ].sort(),
        );
      }
  }
});

test("all 47 renderer catalog previews preserve exact named controls in all 48 initial forms", () => {
  for (const service of serviceCatalog) {
    const preview = getCatalogPreviewSchema(service.service_no);
    assert.equal(preview.stage, "catalog_preview");
    assert.equal(preview.version, 0);
    assert.equal(preview.sections.length, service.forms.length);
    assert.deepEqual(
      flattenFields(preview).flatMap(
        (field) => field.evidence?.fieldNames ?? [],
      ),
      namedDataFields(service).map((field) => field.name),
    );
    for (const field of flattenFields(preview))
      assert.equal(field.evidence?.status, "observed");
  }
});

test("all 47 proposed schemas enabled; versions remain pinned and cannot silently fall forward", () => {
  assert.deepEqual(
    operationalSchemas.map((schema) => schema.serviceNo).sort((a, b) => a - b),
    Array.from({ length: 47 }, (_, index) => index + 1),
  );
  assert.throws(() => getServiceSchema(48), RangeError);
  assert.throws(() => getServiceSchema(45, 2), RangeError);
  assert.throws(() => getReferencePreview(48), RangeError);
  assert.equal(validateServicePayload(1, {}).valid, false);
});

test("published schema and catalog metadata are recursively immutable", () => {
  const schema = getServiceSchema(45);
  assert.ok(Object.isFrozen(schema));
  assert.ok(Object.isFrozen(schema.sections[0].fields[0].constraints));
  assert.throws(() => {
    (
      schema.sections[0].fields[0].constraints as { required: boolean }
    ).required = false;
  }, TypeError);
  assert.throws(() => {
    (serviceCatalog as unknown as unknown[]).pop();
  }, TypeError);
  const hash = () =>
    createHash("sha256").update(stableSchemaJson(schema)).digest("hex");
  const before = hash();
  const isolated = clone(schema);
  (isolated as unknown as { version: number }).version = 99;
  assert.equal(hash(), before);
  assert.equal(getServiceSchema(45).version, 1);
});

test("canonical schema serialization ignores object key insertion order", () => {
  const schema = getServiceSchema(45);
  const reordered = Object.fromEntries(
    Object.entries(schema).reverse(),
  ) as unknown as FormSchema;
  assert.equal(stableSchemaJson(schema), stableSchemaJson(reordered));
  const changed = clone(schema) as unknown as { version: number };
  changed.version = 2;
  assert.notEqual(
    stableSchemaJson(schema),
    stableSchemaJson(changed as unknown as FormSchema),
  );
});

test("all operational bilingual synthetic fixtures validate; declared labels are nonempty", () => {
  for (const schema of operationalSchemas) {
    assert.deepEqual(validateForm(schema, demoPayloads[schema.serviceNo]), {
      valid: true,
      issues: [],
    });
    for (const section of schema.sections) {
      assert.ok(section.title.bn && section.title.en);
      for (const field of section.fields)
        assert.ok(field.label.bn && field.label.en);
    }
  }
});

test("required fields, unknown fields and boolean confirmations fail accessibly", () => {
  const invalid = {
    ...demoPayloads[45],
    purpose_bn: "",
    confirmation: false,
    tenant_id: "tenant-b",
  };
  const result = validateServicePayload(45, invalid);
  assert.equal(result.valid, false);
  assert.ok(
    result.issues.some(
      (issue) => issue.path === "purpose_bn" && issue.code === "required",
    ),
  );
  assert.ok(
    result.issues.some(
      (issue) => issue.path === "confirmation" && issue.code === "confirmation",
    ),
  );
  assert.ok(
    result.issues.some(
      (issue) => issue.path === "tenant_id" && issue.code === "unknown_field",
    ),
  );
  assert.ok(
    result.issues.every((issue) => issue.message.bn && issue.message.en),
  );
});

test("date, Unicode length, select membership and payload root type are validated", () => {
  assert.ok(
    validateServicePayload(45, {
      ...demoPayloads[45],
      residence_since: "2025-02-30",
    }).issues.some((issue) => issue.code === "date"),
  );
  assert.ok(
    validateServicePayload(45, {
      ...demoPayloads[45],
      delivery_language: "invalid",
    }).issues.some((issue) => issue.code === "option"),
  );
  assert.ok(
    validateServicePayload(45, {
      ...demoPayloads[45],
      purpose_en: "x".repeat(501),
    }).issues.some((issue) => issue.code === "max_length"),
  );
  assert.equal(validateServicePayload(45, []).valid, false);
  assert.equal(validateServicePayload(45, null).valid, false);
});

test("conditional fields use local row context and reject stale inactive data", () => {
  const schema = getServiceSchema(2);
  const members = [
    {
      name_bn: "নমুনা শিশু",
      name_en: "Sample Child",
      relationship: "child",
      dob: "2020-01-01",
      is_minor: true,
    },
  ];
  let result = validateForm(schema, { ...demoPayloads[2], members });
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.path === "members[0].guardian_name_bn" &&
        issue.code === "required",
    ),
  );
  result = validateForm(schema, {
    ...demoPayloads[2],
    members: [{ ...members[0], guardian_name_bn: "নমুনা অভিভাবক" }],
  });
  assert.equal(result.valid, true);
  result = validateForm(schema, {
    ...demoPayloads[2],
    members: [
      { ...members[0], is_minor: false, guardian_name_bn: "নমুনা অভিভাবক" },
    ],
  });
  assert.ok(result.issues.some((issue) => issue.code === "inactive_field"));
  const guardian = flattenFields(schema)
    .find((field) => field.id === "members")!
    .children!.find((field) => field.id === "guardian_name_bn")!;
  assert.equal(isFieldVisible(guardian, { is_minor: false }), false);
  assert.equal(isFieldVisible(guardian, { is_minor: true }), true);
});

test("repeatable rows validate order, limits, nested private attachments and unknown properties", () => {
  const schema = getServiceSchema(2);
  assert.ok(
    validateForm(schema, { ...demoPayloads[2], members: [] }).issues.some(
      (issue) => issue.code === "min_rows",
    ),
  );
  assert.ok(
    validateForm(schema, {
      ...demoPayloads[2],
      members: Array(31).fill((demoPayloads[2].members as unknown[])[0]),
    }).issues.some((issue) => issue.code === "max_rows"),
  );
  const base = clone((demoPayloads[2].members as Record<string, unknown>[])[0]);
  assert.ok(
    validateForm(schema, {
      ...demoPayloads[2],
      members: [{ ...base, secret: "bad" }],
    }).issues.some((issue) => issue.path === "members[0].secret"),
  );
  const attachment = {
    description: "Demo evidence",
    file: {
      attachmentId: "file_demo_123",
      mimeType: "application/pdf",
      byteLength: 1000,
    },
  };
  assert.equal(
    validateForm(schema, {
      ...demoPayloads[2],
      members: [{ ...base, attachments: [attachment] }],
    }).valid,
    true,
  );
  assert.ok(
    validateForm(schema, {
      ...demoPayloads[2],
      members: [
        {
          ...base,
          attachments: [
            {
              ...attachment,
              file: { ...attachment.file, mimeType: "text/html" },
            },
          ],
        },
      ],
    }).issues.some(
      (issue) =>
        issue.path === "members[0].attachments[0].file" &&
        issue.code === "attachment_type",
    ),
  );
});

test("attachment handles reject URLs, oversized/malformed metadata and extra claims", () => {
  const attachments = [
    {
      description: "Demo evidence",
      file: {
        attachmentId: "file_demo_123",
        mimeType: "image/png",
        byteLength: 1000,
      },
    },
  ];
  assert.equal(
    validateServicePayload(42, { ...demoPayloads[42], attachments }).valid,
    true,
  );
  const result = validateServicePayload(42, {
    ...demoPayloads[42],
    attachments: [
      {
        ...attachments[0],
        file: {
          attachmentId: "https://evil.test/file",
          mimeType: "text/html",
          byteLength: 9_000_000,
          malwareClean: true,
        },
      },
    ],
  });
  assert.deepEqual(
    new Set(result.issues.map((issue) => issue.code)),
    new Set(["attachment_reference", "attachment_type", "attachment_size"]),
  );
  assert.equal(
    validateServicePayload(42, {
      ...demoPayloads[42],
      attachments: [
        {
          ...attachments[0],
          file: { ...attachments[0].file, byteLength: 2_097_152 },
        },
      ],
    }).valid,
    true,
  );
  assert.ok(
    validateServicePayload(42, {
      ...demoPayloads[42],
      attachments: [
        {
          ...attachments[0],
          file: { ...attachments[0].file, byteLength: 2_097_153 },
        },
      ],
    }).issues.some((issue) => issue.code === "attachment_size"),
  );
});

test("trade v1 keeps independent sections and conditional previous license linkage", () => {
  const schema = getServiceSchema(42, 1);
  assert.equal(schema.sections.length, 4);
  const result = validateServicePayload(42, {
    ...demoPayloads[42],
    has_previous_license: true,
  });
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.path === "previous_license_number" && issue.code === "required",
    ),
  );
  assert.equal(
    validateServicePayload(42, {
      ...demoPayloads[42],
      has_previous_license: true,
      previous_license_number: "DEMO-2025-0001",
    }).valid,
    true,
  );
  assert.ok(
    validateServicePayload(42, {
      ...demoPayloads[42],
      mobile: "+8801000000000",
    }).issues.some((issue) => issue.code === "format"),
  );
});

test("predicate composition supports nested values and present checks without executing code", () => {
  assert.equal(
    evaluatePredicate(
      {
        all: [
          { field: "nested.value", equals: "demo" },
          { field: "email", present: false },
        ],
      },
      { nested: { value: "demo" } },
    ),
    true,
  );
  assert.equal(
    evaluatePredicate(
      {
        any: [
          { field: "active", equals: true },
          { field: "alternate", present: true },
        ],
      },
      { active: false, alternate: "" },
    ),
    false,
  );
  assert.ok(
    Object.isFrozen(deepFreeze({ nested: { list: [1, 2] } }).nested.list),
  );
});
