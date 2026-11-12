/**
 * Phase 0: write one pre-filled capture file per service into docs/evidence/prottoyon-forms/.
 * Each file lists what Astra's current schema already has, so the owner only confirms or corrects rows
 * against the reference system. Existing files are never overwritten (they may hold captured evidence);
 * pass --force to regenerate them all.
 *
 *   npx tsx scripts/evidence/capture-files.ts [--force]
 */
import fs from "node:fs";
import path from "node:path";
import {
  getServiceSchema,
  serviceCatalog,
  type FieldDefinition,
  type FormSchema,
} from "@astra/shared-schemas";

export const captureDirectory = "docs/evidence/prottoyon-forms";

const cell = (value: unknown) =>
  String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
export const captureFileName = (serviceNo: number, nameEn: string) =>
  `s${String(serviceNo).padStart(2, "0")}-${slug(nameEn)}.md`;

function predicate(value: unknown): string {
  if (!value) return "";
  const p = value as Record<string, unknown>;
  if (typeof p.field === "string" && "equals" in p) return `${p.field} = ${JSON.stringify(p.equals)}`;
  return JSON.stringify(value);
}
function requiredText(field: FieldDefinition): string {
  if (field.constraints?.required) return "yes";
  if (field.requiredWhen) return `when ${predicate(field.requiredWhen)}`;
  return "no";
}
function limits(field: FieldDefinition): string {
  const c = (field.constraints ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ["minLength", "maxLength", "min", "max", "pattern", "geographyDepth"])
    if (c[key] !== undefined) parts.push(`${key} ${c[key]}`);
  if (c.geographyUnionWhen) parts.push(`union when ${predicate(c.geographyUnionWhen)}`);
  return parts.join("; ");
}
function options(field: FieldDefinition): string {
  return (field.options ?? [])
    .map((o) => `${o.label?.bn ?? ""} / ${o.label?.en ?? ""}`)
    .join("; ");
}
function rows(fields: readonly FieldDefinition[], prefix = ""): string[] {
  const out: string[] = [];
  for (const field of fields) {
    const evidence = (field as any).evidence ?? {};
    const repeat =
      field.type === "repeatable"
        ? `rows ${field.constraints?.minRows ?? 0}–${field.constraints?.maxRows ?? "?"}`
        : "";
    out.push(
      `| ${cell(prefix + field.id)} | ${cell((evidence.fieldNames ?? []).join(", "))} | ${cell(field.label?.bn)} | ${cell(field.label?.en)} | ${cell(field.type)} | ${cell(requiredText(field))} | ${cell(options(field))} | ${cell(limits(field))} | ${cell(repeat)} | ${cell(predicate(field.visibleWhen))} | ${cell(evidence.status ?? "")} |  |`,
    );
    if (field.type === "repeatable") out.push(...rows(field.children ?? [], `${prefix}${field.id} ↳ `));
  }
  return out;
}
function referenceNamesWithoutField(schema: FormSchema, referenceNames: readonly string[]): string[] {
  const used = new Set<string>();
  const walk = (fields: readonly FieldDefinition[]) => {
    for (const field of fields) {
      for (const name of ((field as any).evidence?.fieldNames ?? []) as string[]) used.add(name);
      used.add(field.id);
      if (field.children) walk(field.children);
    }
  };
  for (const section of schema.sections) walk(section.fields);
  return referenceNames.filter((name) => !used.has(name));
}

export function captureFile(serviceNo: number): string {
  const service = serviceCatalog.find((s) => s.service_no === serviceNo)!;
  const schema = getServiceSchema(serviceNo);
  const unmapped = referenceNamesWithoutField(schema, service.service_specific_visible_field_names ?? []);
  const lines = [
    `# Service ${serviceNo}: ${service.name_bn} / ${service.name_en}`,
    "",
    "> Pre-filled from Astra's current schema. Check every row against the reference form while signed in with the [synthetic citizen](../SYNTHETIC-CITIZEN-SPEC.md), following the [capture rules](../README.md#capture-rules). In **Check**, write ✅, a correction, or `?`. Add rows for anything Astra lacks.",
    "",
    "## Header",
    "",
    "| Item | Value |",
    "| --- | --- |",
    `| Astra schema | version ${schema.version}, stage \`${schema.stage}\`, evidence \`${schema.evidence?.status ?? ""}\` |`,
    `| Reference form family | \`${cell(service.initial_form_family)}\` (${service.form_count ?? "?"} form(s)) |`,
    `| Reference path pattern | \`${cell(service.initial_form_path_pattern)}\` |`,
    "| Captured by / date | |",
    "| Account type used | |",
    "| Menu path to the form | |",
    "",
    "## 1. Fields",
    "",
    "Astra's fields in display order. *Reference field name* is the input name recorded in the October 2026 baseline. *Evidence* is Astra's own confidence: `proposed` and `inferred` both still need checking.",
    "",
    "| Astra field | Reference field name | Label BN | Label EN | Type | Required? | Options (Astra; verify verbatim) | Limits | Repeatable? | Shown when | Evidence | Check |",
    "| ----------- | -------------------- | -------- | -------- | ---- | --------- | -------------------------------- | ------ | ----------- | ---------- | -------- | ----- |",
  ];
  for (const section of schema.sections) {
    lines.push(`| **${cell(section.title?.en ?? section.id)}** | | ${cell(section.title?.bn)} | | section | | | | | | | |`);
    lines.push(...rows(section.fields));
  }
  lines.push(
    "",
    "### Reference field names with no Astra field",
    "",
    unmapped.length
      ? "These names appeared on the reference form in the baseline but no Astra field claims them. Record what each one is (label, type, options, required) or mark it `not shown`."
      : "None: every baseline field name is claimed by an Astra field.",
    "",
    ...(unmapped.length
      ? ["| Reference field name | Label BN | Label EN | Type | Required? | Options (verbatim) | Check |", "| --- | --- | --- | --- | --- | --- | --- |", ...unmapped.map((name) => `| \`${cell(name)}\` | | | | | | |`)]
      : []),
    "",
    "## 2. Uploads",
    "",
    "| Document | Required? | Accepted types | Max size | Count | Notes |",
    "| -------- | --------- | -------------- | -------- | ----- | ----- |",
    "",
    "## 3. Checkout controls (before payment)",
    "",
    "| Control | Present? | Choices / values | Default | Notes |",
    "| ------- | -------- | ---------------- | ------- | ----- |",
    "| Fee lines (base, service, other) | | | | |",
    "| Delivery (pickup / courier / digital) | | | | |",
    "| Urgency (normal / urgent) and its days | | | | |",
    "| Certificate language (BN / EN / both) | | | | |",
    "| Payment methods shown | | | | |",
    "| Coupon / discount code | | | | |",
    "| Points balance used / deducted | | | | |",
    "",
    "## 4. After submission",
    "",
    "| Item | What happens |",
    "| ---- | ------------ |",
    "| Success screen (summarise, do not copy prose) | |",
    "| Tracking number format | |",
    "| Status names shown to the applicant | |",
    "| Notifications (SMS / email) observed | |",
    "| Where the application appears afterwards | |",
    "",
    "## 5. Notes and open questions",
    "",
  );
  return lines.join("\n");
}

export function writeCaptureFiles(force = false) {
  fs.mkdirSync(captureDirectory, { recursive: true });
  let written = 0,
    kept = 0;
  for (const service of serviceCatalog) {
    const file = path.join(captureDirectory, captureFileName(service.service_no, service.name_en));
    if (fs.existsSync(file) && !force) {
      kept++;
      continue;
    }
    fs.writeFileSync(file, captureFile(service.service_no));
    written++;
  }
  return { written, kept };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve("scripts/evidence/capture-files.ts")) {
  const result = writeCaptureFiles(process.argv.includes("--force"));
  console.log(`Capture files: ${result.written} written, ${result.kept} kept unchanged in ${captureDirectory}.`);
}
