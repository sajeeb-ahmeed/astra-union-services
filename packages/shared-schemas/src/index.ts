import referenceData from "./reference-catalog.json" with { type: "json" };
import legacyExpandedVersions from "./expanded-v1-schemas.json" with { type: "json" };
import type {
  FieldDefinition,
  FormSchema,
  ReferenceField,
  ReferenceService,
} from "./types.js";
import { deepFreeze, validateForm } from "./engine.js";
import { operationalSchemas, tradeLicenseV1, familyV1 } from "./schemas.js";

export * from "./types.js";
export * from "./engine.js";
export * from "./schemas.js";

/** Sanitized public metadata. No original tokens, captured values or record URLs are included. */
export const serviceCatalog = deepFreeze(
  referenceData.services as unknown as readonly ReferenceService[],
);
export const referenceCounts = deepFreeze({
  services: 47,
  forms: 48,
  common: 26,
  specialist: 21,
  groups: 39,
  namedDataFields: 217,
  hiddenFieldNames: 25,
});
export const operationalServiceNumbers: readonly number[] = deepFreeze(
  operationalSchemas.map((schema) => schema.serviceNo).sort((a, b) => a - b),
);
/** Historical schemas are retained byte-for-byte as objects for applications pinned before publication of v2. */
export const legacyOperationalSchemas: readonly FormSchema[] = deepFreeze(
  legacyExpandedVersions as unknown as readonly FormSchema[],
);
export const allServiceSchemaVersions: readonly FormSchema[] = deepFreeze([
  ...legacyOperationalSchemas,
  tradeLicenseV1,
  familyV1,
  ...operationalSchemas,
]);

export function getService(serviceNo: number): ReferenceService | undefined {
  return serviceCatalog.find((service) => service.service_no === serviceNo);
}
export function namedDataFields(
  service: ReferenceService,
): readonly ReferenceField[] {
  return service.forms
    .flatMap((form) => form.fields)
    .filter(
      (field) =>
        field.name && !["hidden", "submit", "button"].includes(field.type),
    );
}
/** Read-only catalog preview preserves exact initial field names including repeated controls. */
export function getReferencePreview(serviceNo: number): ReferenceService {
  const service = getService(serviceNo);
  if (!service) throw new RangeError(`Unknown service ${serviceNo}.`);
  return service;
}
export function getServiceSchema(
  serviceNo: number,
  version?: number,
): FormSchema {
  const schema =
    version === undefined
      ? operationalSchemas.find((item) => item.serviceNo === serviceNo)
      : allServiceSchemaVersions.find(
          (item) => item.serviceNo === serviceNo && item.version === version,
        );
  if (!schema)
    throw new RangeError(
      `Service ${serviceNo} version ${version} is not an enabled operational form.`,
    );
  return schema;
}
export function validateServicePayload(
  serviceNo: number,
  payload: unknown,
  version?: number,
) {
  return validateForm(getServiceSchema(serviceNo, version), payload);
}

const previewField = (
  field: ReferenceField,
  index: number,
): FieldDefinition => ({
  // Preview IDs retain both captured position and exact name, because radio controls repeat names.
  id: `${index}:${field.name}`,
  type:
    field.type === "file"
      ? "attachment"
      : field.type === "textarea"
        ? "textarea"
        : field.type === "checkbox"
          ? "checkbox"
          : "text",
  label: { bn: field.label_bn || field.name, en: field.name },
  description: {
    bn: "পর্যবেক্ষিত প্রাথমিক ঘর; জমা দেওয়ার জন্য সক্রিয় নয়।",
    en: `Observed ${field.type}; read-only reference preview. Required flag is HTML evidence, not approved server validation.`,
  },
  evidence: { status: "observed", fieldNames: [field.name] },
});
/** Renderer-compatible read-only schema. Its controls cannot be submitted as an application. */
export function getCatalogPreviewSchema(serviceNo: number): FormSchema {
  const service = getReferencePreview(serviceNo);
  return deepFreeze({
    serviceNo,
    version: 0,
    title: { bn: service.name_bn, en: service.name_en },
    stage: "catalog_preview",
    evidence: {
      status: "proposed",
      source: service.evidence_file,
      limitation: service.evidence_limit,
    },
    sections: service.forms.map((form) => ({
      id: `reference-form-${form.form_index}`,
      title: {
        bn: `প্রাথমিক ফর্ম ${form.form_index}`,
        en: `Observed entry form ${form.form_index}`,
      },
      fields: form.fields
        .filter(
          (field) =>
            field.name && !["hidden", "submit", "button"].includes(field.type),
        )
        .map(previewField),
    })),
  });
}
