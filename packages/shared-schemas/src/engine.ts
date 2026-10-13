import type {
  FieldDefinition,
  FormSchema,
  LocalizedText,
  Predicate,
  ValidationIssue,
  ValidationResult,
} from "./types.js";

/** Freeze recursively at publication so consumers cannot edit an application-pinned version. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function empty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "")
  );
}
export function evaluatePredicate(
  predicate: Predicate,
  payload: Readonly<Record<string, unknown>>,
): boolean {
  if ("all" in predicate)
    return predicate.all.every((item) => evaluatePredicate(item, payload));
  if ("any" in predicate)
    return predicate.any.some((item) => evaluatePredicate(item, payload));
  const value = predicate.field
    .split(".")
    .reduce<unknown>(
      (current, key) => (isRecord(current) ? current[key] : undefined),
      payload,
    );
  return "equals" in predicate
    ? value === predicate.equals
    : !empty(value) === predicate.present;
}
export function isFieldVisible(
  field: FieldDefinition,
  payload: Readonly<Record<string, unknown>>,
): boolean {
  return !field.visibleWhen || evaluatePredicate(field.visibleWhen, payload);
}
export function flattenFields(schema: FormSchema): readonly FieldDefinition[] {
  return schema.sections.flatMap((section) => section.fields);
}
function text(bn: string, en: string): LocalizedText {
  return { bn, en };
}

/** Deterministic shared validation; callers still authorize tenant, citizen and attachment references. */
export function validateForm(
  schema: FormSchema,
  payload: unknown,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const issue = (path: string, code: string, message: LocalizedText) => {
    issues.push({ path, code, message });
  };
  if (!isRecord(payload))
    return {
      valid: false,
      issues: [
        {
          path: "",
          code: "object",
          message: text(
            "ফর্ম তথ্য সঠিক নয়।",
            "Form payload must be an object.",
          ),
        },
      ],
    };
  const visit = (
    fields: readonly FieldDefinition[],
    values: Record<string, unknown>,
    prefix: string,
  ) => {
    const names = new Set(fields.map((field) => field.id));
    for (const name of Object.keys(values))
      if (!names.has(name))
        issue(
          `${prefix}${name}`,
          "unknown_field",
          text("অজানা ঘর গ্রহণ করা হয় না।", "Unknown field is not allowed."),
        );
    for (const field of fields) {
      const path = `${prefix}${field.id}`;
      const value = values[field.id];
      if (!isFieldVisible(field, values)) {
        if (!empty(value))
          issue(
            path,
            "inactive_field",
            text(
              "এই ঘর এখন প্রযোজ্য নয়।",
              "Field is inactive for this selection.",
            ),
          );
        continue;
      }
      const rules = field.constraints ?? {};
      const required =
        rules.required ||
        (field.requiredWhen && evaluatePredicate(field.requiredWhen, values));
      if (empty(value)) {
        if (required)
          issue(
            path,
            "required",
            text("এই ঘরটি পূরণ করুন।", "This field is required."),
          );
        continue;
      }
      if (
        rules.differentFrom &&
        typeof value === "string" &&
        typeof values[rules.differentFrom] === "string" &&
        value.trim() === (values[rules.differentFrom] as string).trim()
      )
        issue(
          path,
          "different_value",
          text(
            "সংশোধিত তথ্য আগের তথ্য থেকে ভিন্ন হতে হবে।",
            "Corrected information must differ from the previous value.",
          ),
        );
      if (field.type === "repeatable") {
        if (!Array.isArray(value)) {
          issue(
            path,
            "array",
            text("সারি তালিকা দিন।", "Expected an array of rows."),
          );
          continue;
        }
        if (value.length < (rules.minRows ?? 0))
          issue(
            path,
            "min_rows",
            text("আরও সারি যোগ করুন।", `Add at least ${rules.minRows} rows.`),
          );
        if (value.length > (rules.maxRows ?? 50))
          issue(
            path,
            "max_rows",
            text(
              "সারির সীমা অতিক্রম করেছে।",
              `At most ${rules.maxRows ?? 50} rows are allowed.`,
            ),
          );
        const uniqueValues = new Set<unknown>();
        value.slice(0, rules.maxRows ?? 50).forEach((row, index) => {
          if (!isRecord(row))
            issue(
              `${path}[${index}]`,
              "object",
              text("সারির তথ্য সঠিক নয়।", "Row must be an object."),
            );
          else {
            if (rules.uniqueBy && !empty(row[rules.uniqueBy])) {
              if (uniqueValues.has(row[rules.uniqueBy]))
                issue(
                  `${path}[${index}].${rules.uniqueBy}`,
                  "duplicate_value",
                  text(
                    "একই বিষয় একাধিক বার দেওয়া যাবে না।",
                    "Each category may occur only once.",
                  ),
                );
              uniqueValues.add(row[rules.uniqueBy]);
            }
            visit(field.children ?? [], row, `${path}[${index}].`);
          }
        });
        continue;
      }
      if (field.type === "attachment") {
        if (!isRecord(value)) {
          issue(
            path,
            "attachment",
            text(
              "নথির পরিচিতি দিন।",
              "Expected a private attachment reference.",
            ),
          );
          continue;
        }
        const keys = Object.keys(value);
        if (
          keys.some(
            (key) => !["attachmentId", "mimeType", "byteLength"].includes(key),
          ) ||
          typeof value.attachmentId !== "string" ||
          !/^[A-Za-z0-9_-]{8,100}$/.test(value.attachmentId)
        ) {
          issue(
            path,
            "attachment_reference",
            text("নথির পরিচিতি সঠিক নয়।", "Invalid private attachment handle."),
          );
        }
        if (
          typeof value.mimeType !== "string" ||
          !rules.acceptedMimeTypes?.includes(value.mimeType)
        )
          issue(
            path,
            "attachment_type",
            text(
              "নথির ধরন অনুমোদিত নয়।",
              "Attachment MIME type is not allowed.",
            ),
          );
        if (
          typeof value.byteLength !== "number" ||
          !Number.isSafeInteger(value.byteLength) ||
          value.byteLength <= 0 ||
          value.byteLength > (rules.maxBytes ?? 2_097_152)
        )
          issue(
            path,
            "attachment_size",
            text(
              "নথির আকার অনুমোদিত নয়।",
              "Attachment is empty, oversized, or has an invalid size.",
            ),
          );
        continue;
      }
      if (field.type === "checkbox") {
        if (typeof value !== "boolean")
          issue(
            path,
            "boolean",
            text("হ্যাঁ অথবা না নির্বাচন করুন।", "Expected a boolean."),
          );
        else if (rules.mustBeTrue && value !== true)
          issue(
            path,
            "confirmation",
            text("ঘোষণায় সম্মতি দিন।", "Confirmation must be accepted."),
          );
        continue;
      }
      if (field.type === "number") {
        if (typeof value !== "number" || !Number.isFinite(value))
          issue(
            path,
            "number",
            text("বৈধ সংখ্যা দিন।", "Expected a finite number."),
          );
        else if (rules.integer && !Number.isSafeInteger(value))
          issue(
            path,
            "integer",
            text("পূর্ণসংখ্যা দিন।", "Expected a safe integer."),
          );
        else if (
          (rules.min !== undefined && value < rules.min) ||
          (rules.max !== undefined && value > rules.max)
        )
          issue(
            path,
            "range",
            text(
              "সংখ্যাটি সীমার বাইরে।",
              "Number is outside the permitted range.",
            ),
          );
        continue;
      }
      if (typeof value !== "string") {
        issue(path, "string", text("লেখা দিন।", "Expected a string."));
        continue;
      }
      const length = [...value.trim()].length;
      if (rules.minLength !== undefined && length < rules.minLength)
        issue(
          path,
          "min_length",
          text(
            "আরও বিস্তারিত দিন।",
            `Use at least ${rules.minLength} characters.`,
          ),
        );
      if (rules.maxLength !== undefined && length > rules.maxLength)
        issue(
          path,
          "max_length",
          text(
            "লেখাটি বেশি দীর্ঘ।",
            `Use at most ${rules.maxLength} characters.`,
          ),
        );
      if (rules.pattern && !new RegExp(rules.pattern, "u").test(value))
        issue(
          path,
          "format",
          text("বিন্যাসটি সঠিক নয়।", "Value has an invalid format."),
        );
      if (
        field.type === "select" &&
        !field.options?.some((option) => option.value === value)
      )
        issue(
          path,
          "option",
          text("তালিকা থেকে নির্বাচন করুন।", "Select a permitted option."),
        );
      if (field.type === "date") {
        const date = new Date(`${value}T00:00:00.000Z`);
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          !Number.isFinite(date.getTime()) ||
          date.toISOString().slice(0, 10) !== value
        )
          issue(
            path,
            "date",
            text(
              "বৈধ তারিখ দিন (YYYY-MM-DD)।",
              "Use a valid ISO calendar date (YYYY-MM-DD).",
            ),
          );
      }
    }
  };
  visit(flattenFields(schema), payload, "");
  return { valid: issues.length === 0, issues };
}

/** Stable serialization for an immutable version hash; does not include any applicant values. */
export function stableSchemaJson(schema: FormSchema): string {
  const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (isRecord(value))
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, canonicalize(value[key])]),
      );
    return value;
  };
  return JSON.stringify(canonicalize(schema));
}
