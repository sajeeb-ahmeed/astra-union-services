/** Repeatable, strict whitelist-only derivation from the curated handoff; never reads audit.zip. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { getServiceSchema, stableSchemaJson } from "../src/index.js";

const root = resolve(import.meta.dirname, "../../..");
// Local execution evidence is separate from the captured reference metadata.
// Missing results must not turn an implemented workflow into a verified claim.
const qaText = await readFile(resolve(root, "execution/all-services-qa.json"), "utf8")
  .catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
const localQa = qaText ? JSON.parse(qaText) : null;
const input = JSON.parse(
  await readFile(
    resolve(root, "handoff/SANITIZED_SERVICE_FORM_SCHEMAS.json"),
    "utf8",
  ),
);
const fieldKeys = [
  "name",
  "type",
  "label_bn",
  "required_html",
  "maxlength",
  "accept",
  "repeatable_array",
];
const serviceKeys = [
  "service_no",
  "name_bn",
  "name_en",
  "category_en",
  "initial_form_path_pattern",
  "initial_form_family",
  "field_group_codes",
  "service_specific_visible_field_names",
  "form_count",
  "evidence_file",
  "evidence_limit",
];
const pick = (source: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(keys.map((key) => [key, source[key]]));
const services = input.services.map(
  (
    service: Record<string, unknown> & { forms: Record<string, unknown>[] },
  ) => ({
    ...pick(service, serviceKeys),
    forms: service.forms.map((form: Record<string, unknown>) => ({
      ...pick(form, ["form_index", "method", "observed_submit_path"]),
      fields: (form.fields as Record<string, unknown>[]).map((field) => {
        if (Object.keys(field).some((key) => !fieldKeys.includes(key)))
          throw new Error(
            `Unexpected field attribute: ${Object.keys(field).join(",")}`,
          );
        return pick(field, fieldKeys);
      }),
    })),
  }),
);
const output = {
  generated_from: input.generated_from,
  scope: input.scope,
  redaction: input.redaction,
  service_count: input.service_count,
  form_count: input.form_count,
  non_hidden_distinct_data_fields_reported:
    input.non_hidden_distinct_data_fields_reported,
  hidden_distinct_names_reported: input.hidden_distinct_names_reported,
  distinct_field_group_definitions: input.distinct_field_group_definitions,
  services,
};
await mkdir(resolve(root, "docs"), { recursive: true });
await writeFile(
  resolve(root, "packages/shared-schemas/src/reference-catalog.json"),
  `${JSON.stringify(output, null, 2)}\n`,
);

const headers = [
  "service_no",
  "service_bn",
  "service_en",
  "category",
  "initial_form_family",
  "form_count",
  "field_group_codes",
  "observed_named_data_fields",
  "observed_hidden_field_names",
  "observed_form_method_paths",
  "observed_form_fields_json",
  "reference_evidence",
  "initial_form_evidence",
  "client_API_status",
  "reference_success_path",
  "independent_implementation_stage",
  "production_validation",
  "downstream_evidence_gaps",
  "current_schema_version",
  "current_schema_sha256",
  "local_workflow_verification",
  "local_workflow_evidence",
];
const csv = (value: unknown) =>
  `"${String(value ?? "").replaceAll('"', '""')}"`;
const rows = services.map((service: any) => {
  const schema = getServiceSchema(service.service_no);
  const locallyPassed = localQa?.mode === "SYNTHETIC_DEMO" &&
    localQa.services?.some((entry: any) =>
      entry.serviceNo === service.service_no && entry.status === "PASS");
  const fields = service.forms.flatMap((form: any) => form.fields);
  const dataNames = [
    ...new Set(
      fields
        .filter(
          (field: any) => !["hidden", "submit", "button"].includes(field.type),
        )
        .map((field: any) => field.name),
    ),
  ];
  const hiddenNames = [
    ...new Set(
      fields
        .filter((field: any) => field.type === "hidden")
        .map((field: any) => field.name),
    ),
  ];
  return [
    service.service_no,
    service.name_bn,
    service.name_en,
    service.category_en,
    service.initial_form_family,
    service.form_count,
    service.field_group_codes.join("; "),
    dataNames.join("; "),
    hiddenNames.join("; "),
    service.forms
      .map((form: any) => `${form.method} ${form.observed_submit_path}`)
      .join("; "),
    JSON.stringify(service.forms),
    service.evidence_file,
    "OBSERVED_INITIAL_DOM_METADATA",
    "INFERRED_CLIENT_METADATA_ONLY",
    "UNVERIFIED",
    "INDEPENDENT_OPERATIONAL_DEMO_WORKFLOW_AND_EXACT_REFERENCE_PREVIEW",
    "PROPOSED_INDEPENDENT_RULES; DOMAIN_APPROVAL_PENDING",
    service.evidence_limit,
    schema.version,
    createHash("sha256").update(stableSchemaJson(schema)).digest("hex"),
    locallyPassed ? "CURRENT_DEMO_WORKFLOW_VERIFIED" : "LOCAL_EXECUTION_UNVERIFIED",
    locallyPassed
      ? `execution/all-services-qa.json (serviceNo=${service.service_no}); apps/api/test/expansion.test.ts ALL47-01; execution/forms-current.log`
      : "No recorded passing service workflow result found.",
  ];
});
await writeFile(
  resolve(root, "docs/REFERENCE_PARITY.csv"),
  `${headers.map(csv).join(",")}\n${rows.map((row: unknown[]) => row.map(csv).join(",")).join("\n")}\n`,
);
process.stdout.write(
  `Derived ${services.length} service rows from sanitized handoff only.\n`,
);
