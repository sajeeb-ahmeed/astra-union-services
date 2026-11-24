import { t, tx, choose } from "./i18n.js";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  evaluatePredicate,
  isFieldVisible,
  type FieldDefinition,
  type FormSchema,
  type ValidationIssue,
} from "@astra/shared-schemas";
import { api } from "./api.js";
import { AttachmentStatus } from "./AttachmentStatus.js";
import {
  GeographyFields,
  geographyPayload,
  readGeography,
} from "./GeographyFields.js";

type Values = Record<string, any>;
type Props = {
  schema: FormSchema;
  value: Values;
  onChange: (value: Values) => void;
  issues?: readonly ValidationIssue[];
  disabled?: boolean;
  citizenId?: string;
  contextKey?: string;
};
const tokens = (path: string) => path.match(/[^.[\]]+/g) ?? [];
const atPath = (value: any, path: readonly string[]) =>
  path.reduce((current, key) => current?.[key], value);
function replaceScope(
  value: any,
  path: readonly string[],
  replacement: any,
): any {
  if (!path.length) return replacement;
  const [head, ...tail] = path;
  const copy = Array.isArray(value) ? [...value] : { ...value };
  copy[head] = replaceScope(value?.[head], tail, replacement);
  return copy;
}

export function DynamicForm({
  schema,
  value,
  onChange,
  issues = [],
  disabled = false,
  citizenId,
  contextKey = "",
}: Props) {
  const prefix = useId();
  const currentValue = useRef(value);
  const currentOnChange = useRef(onChange);
  const context = `${contextKey}:${schema.serviceNo}:${schema.version}:${citizenId ?? ""}`;
  const currentContext = useRef(context);
  const lifetime = useRef(0);
  useEffect(() => {
    lifetime.current += 1;
    setUploadErrors({});
    setUploads({});
    return () => {
      lifetime.current += 1;
    };
  }, [context]);
  // FORM-UX: a repeatable that requires rows (minRows >= 1) must not open as
  // an empty fieldset whose fields stay hidden until the citizen discovers
  // the Add button — seed the minimum rows once per form context. Rows the
  // citizen (or a loaded draft) already has are never touched.
  useEffect(() => {
    const seed: Values = { ...currentValue.current };
    let changed = false;
    for (const section of schema.sections)
      for (const field of section.fields) {
        if (field.type !== "repeatable") continue;
        const minRows = field.constraints?.minRows ?? 0;
        if (minRows < 1) continue;
        const existing = Array.isArray(seed[field.id]) ? seed[field.id] : [];
        if (existing.length >= minRows) continue;
        const blankRow = () =>
          Object.fromEntries(
            (field.children ?? [])
              .filter((child) => child.type === "checkbox")
              .map((child) => [child.id, false]),
          );
        seed[field.id] = [
          ...existing,
          ...Array.from({ length: minRows - existing.length }, blankRow),
        ];
        changed = true;
      }
    if (changed) {
      currentValue.current = seed;
      currentOnChange.current(seed);
    }
    // Runs once per form context (the parent remounts on context change).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context]);
  currentValue.current = value;
  currentOnChange.current = onChange;
  currentContext.current = context;
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});
  const [uploads, setUploads] = useState<Record<string, boolean>>({});
  const uploading = Object.entries(uploads).some(
    ([key, active]) => key.startsWith(`${context}:`) && active,
  );

  function fields(
    definitions: readonly FieldDefinition[],
    scope: Values,
    path = "",
  ): ReactNode {
    return definitions
      .filter((field) => isFieldVisible(field, scope))
      .map((field) => {
        const key = path ? `${path}.${field.id}` : field.id;
        const id = `${prefix}-${key}`;
        const uploadKey = `${context}:${key}`;
        const error = issues.find((issue) => issue.path === key);
        const localUploadError = uploadErrors[uploadKey];
        // Matches the shared engine (Phase 4): a plain checkbox is answered
        // by its state — unticked means "no" — so it is never presented as a
        // required field. Only a mustBeTrue declaration must be actively given.
        const required =
          !!(
            field.constraints?.required ||
            (field.requiredWhen && evaluatePredicate(field.requiredWhen, scope))
          ) &&
          (field.type !== "checkbox" || !!field.constraints?.mustBeTrue);
        // FORM-UX: pattern-constrained text fields get the keyboard and the
        // example their format needs (mobile keypad for 01… numbers, email
        // keyboard for addresses) instead of a plain text box.
        const pattern = field.constraints?.pattern;
        const isMobileField = !!pattern && pattern.startsWith("^01");
        const isEmailField = !!pattern && pattern.includes("@");
        const update = (nextValue: any) => {
          // Resolve the latest root value so an asynchronous upload cannot overwrite intervening edits.
          const parentPath = tokens(key).slice(0, -1);
          const currentScope = atPath(currentValue.current, parentPath) ?? {};
          const nextScope = { ...currentScope, [field.id]: nextValue };
          for (const sibling of definitions) {
            if (sibling.visibleWhen && !isFieldVisible(sibling, nextScope))
              delete nextScope[sibling.id];
            // A union picked for a union address must not linger after switching to a municipality/city address.
            const location = nextScope[sibling.id];
            if (
              sibling.type === "geography" &&
              location &&
              (sibling.constraints?.geographyDepth ?? "upazila") ===
                "upazila" &&
              sibling.constraints?.geographyUnionWhen &&
              !evaluatePredicate(
                sibling.constraints.geographyUnionWhen,
                nextScope,
              ) &&
              (location.unionCode || location.wardCode)
            ) {
              const { unionCode: _union, wardCode: _ward, ...rest } = location;
              nextScope[sibling.id] = rest;
            }
          }
          const next = replaceScope(
            currentValue.current,
            parentPath,
            nextScope,
          );
          currentValue.current = next;
          currentOnChange.current(next);
        };
        const shared = {
          id,
          "data-field-path": key,
          disabled,
          "aria-required": required || undefined,
          "aria-invalid": !!error,
          "aria-describedby": error ? `${id}-error` : undefined,
        };

        if (field.type === "repeatable") {
          const rows = Array.isArray(scope[field.id]) ? scope[field.id] : [];
          const latestRows = () =>
            atPath(currentValue.current, tokens(key)) ?? [];
          return (
            /* REFINEMENT-02 P2-10: repeatables flatten from a nested
               fieldset (a bordered box inside the section's bordered
               box) into a headed group with a divider. */
            <div
              id={id}
              data-field-path={key}
              aria-required={required || undefined}
              aria-invalid={!!error}
              aria-describedby={error ? `${id}-error` : undefined}
              role="group"
              aria-label={choose(field.label)}
              tabIndex={-1}
              key={key}
              className="repeatable repeatable-flat"
            >
              <div className="repeatable-heading">
                {choose(field.label)}
                {/* FORM-UX: required repeatables carry the same " *" marker
                    as every other required field (was an unmarked legend). */}
                {required ? " *" : ""}
              </div>
              {/* QAFIX-04 (§4 item 5): a repeatable's guidance was never
                  rendered — the regular-field branch below shows
                  field.description, the repeatable branch did not, so
                  document requirements (e.g. service 16's death
                  certificate) were invisible to the citizen. */}
              {tx(
                field.description && (
                  <p className="hint">{choose(field.description)}</p>
                ),
              )}
              {tx(
                rows.map((row: Values, index: number) => (
                  <div className="repeat-row" key={index}>
                    <div className="row-heading">
                      <strong>
                        {choose(field.label)} {tx(index + 1)}
                      </strong>
                      <button
                        type="button"
                        className="text-button"
                        disabled={disabled || uploading}
                        onClick={() =>
                          update(
                            latestRows().filter(
                              (_: any, position: number) => position !== index,
                            ),
                          )
                        }
                      >
                        {t("Remove ")}
                        {tx(index + 1)}
                      </button>
                    </div>
                    <div className="form-grid">
                      {tx(
                        fields(field.children ?? [], row, `${key}[${index}]`),
                      )}
                    </div>
                  </div>
                )),
              )}
              <button
                type="button"
                className="secondary"
                disabled={
                  disabled ||
                  uploading ||
                  rows.length >= (field.constraints?.maxRows ?? 30)
                }
                onClick={() =>
                  update([
                    ...latestRows(),
                    Object.fromEntries(
                      (field.children ?? [])
                        .filter((child) => child.type === "checkbox")
                        .map((child) => [child.id, false]),
                    ),
                  ])
                }
              >
                {t("+ Add ")}
                {choose(field.label)}
              </button>
              {tx(
                error && (
                  <p id={`${id}-error`} className="field-error">
                    {choose(error.message)}
                  </p>
                ),
              )}
            </div>
          );
        }

        if (field.type === "geography") {
          const rules = field.constraints ?? {};
          const through =
            rules.geographyDepth === "ward"
              ? "ward"
              : rules.geographyDepth === "union" ||
                  (rules.geographyUnionWhen &&
                    evaluatePredicate(rules.geographyUnionWhen, scope))
                ? "union"
                : "upazila";
          return (
            <div
              className="field geography-picker"
              key={key}
              data-field-path={key}
              tabIndex={-1}
              aria-invalid={!!error}
            >
              <GeographyFields
                prefix={id}
                legend={`${choose(field.label)}${required ? " *" : ""}`}
                through={through}
                required={required}
                disabled={disabled}
                value={readGeography(scope[field.id])}
                onChange={(next) => {
                  const payload = geographyPayload(next);
                  update(Object.keys(payload).length ? payload : undefined);
                }}
              />
              {tx(
                field.description && (
                  <p className="hint">{choose(field.description)}</p>
                ),
              )}
              {tx(
                error && (
                  <p id={`${id}-error`} className="field-error">
                    {choose(error.message)}
                  </p>
                ),
              )}
            </div>
          );
        }

        if (field.type === "attachment") {
          const uploadUnavailable = !citizenId;
          const describedBy = [
            error ? `${id}-error` : "",
            localUploadError ? `${id}-upload-error` : "",
            `${id}-upload-hint`,
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <div className="field" data-field-type="attachment" key={key}>
              <label htmlFor={id}>
                {choose(field.label)}
                {required ? " *" : ""}
              </label>
              <input
                {...shared}
                disabled={disabled || uploadUnavailable || uploading}
                aria-invalid={!!error || !!localUploadError}
                aria-describedby={describedBy}
                type="file"
                accept={field.constraints?.acceptedMimeTypes?.join(",")}
                onChange={async (event) => {
                  const file = event.currentTarget.files?.[0];
                  if (!file) return;
                  const epoch = lifetime.current;
                  const current = () =>
                    currentContext.current === context &&
                    lifetime.current === epoch;
                  // Permit retrying the same file after a rejected upload without retaining browser-local file data.
                  event.currentTarget.value = "";
                  setUploadErrors((previous) => ({
                    ...previous,
                    [uploadKey]: "",
                  }));
                  if (!citizenId) {
                    setUploadErrors((previous) => ({
                      ...previous,
                      [uploadKey]:
                        "Select a citizen before uploading a supporting document.",
                    }));
                    return;
                  }
                  const maxBytes = Math.min(
                    field.constraints?.maxBytes ?? 2_097_152,
                    2_097_152,
                  );
                  if (file.size < 8 || file.size > maxBytes) {
                    setUploadErrors((previous) => ({
                      ...previous,
                      [uploadKey]:
                        "Document must contain at least 8 bytes and be no larger than 2 MiB.",
                    }));
                    return;
                  }
                  if (
                    !field.constraints?.acceptedMimeTypes?.includes(file.type)
                  ) {
                    setUploadErrors((previous) => ({
                      ...previous,
                      [uploadKey]: "Select a PDF, PNG or JPEG document.",
                    }));
                    return;
                  }
                  setUploads((previous) => ({
                    ...previous,
                    [uploadKey]: true,
                  }));
                  try {
                    const bytes = new Uint8Array(await file.arrayBuffer());
                    let binary = "";
                    for (
                      let offset = 0;
                      offset < bytes.length;
                      offset += 16_384
                    )
                      binary += String.fromCharCode(
                        ...bytes.subarray(offset, offset + 16_384),
                      );
                    if (!current()) return;
                    const result = await api("/attachments", "POST", {
                      citizenId,
                      mimeType: file.type,
                      base64: btoa(binary),
                    });
                    const source = result.attachment ?? result;
                    if (
                      typeof source.attachmentId !== "string" ||
                      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                        source.attachmentId,
                      ) ||
                      source.mimeType !== file.type ||
                      source.byteLength !== file.size
                    )
                      throw new Error(
                        "Upload service returned an invalid private attachment handle.",
                      );
                    if (current())
                      update({
                        attachmentId: source.attachmentId,
                        mimeType: source.mimeType,
                        byteLength: source.byteLength,
                      });
                  } catch (uploadError) {
                    if (current())
                      setUploadErrors((previous) => ({
                        ...previous,
                        [uploadKey]:
                          uploadError instanceof Error
                            ? uploadError.message
                            : "Document upload failed.",
                      }));
                  } finally {
                    if (current())
                      setUploads((previous) => ({
                        ...previous,
                        [uploadKey]: false,
                      }));
                  }
                }}
              />
              <p id={`${id}-upload-hint`} className="hint">
                {tx(
                  uploadUnavailable
                    ? "নথি দেওয়ার আগে নাগরিক নির্বাচন করুন। / Select a citizen before uploading."
                    : "ব্যক্তিগত নথি: PDF, PNG বা JPEG; সর্বোচ্চ 2 MiB। / Private document, maximum 2 MiB.",
                )}
              </p>
              {tx(
                scope[field.id] && (
                  <AttachmentStatus
                    key={`${context}:${scope[field.id].attachmentId}`}
                    attachment={scope[field.id]}
                    editable={!disabled && !uploadUnavailable && !uploading}
                    inputId={id}
                  />
                ),
              )}
              {tx(
                uploads[uploadKey] && (
                  <p role="status">
                    {t("নথি সংরক্ষণ চলছে… / Uploading document…")}
                  </p>
                ),
              )}
              {tx(
                localUploadError && (
                  <p
                    id={`${id}-upload-error`}
                    role="alert"
                    className="field-error"
                  >
                    {t("নথি সংরক্ষণ করা যায়নি / ")}
                    {tx(localUploadError)}
                  </p>
                ),
              )}
              {tx(
                error && (
                  <p id={`${id}-error`} className="field-error">
                    {choose(error.message)}
                  </p>
                ),
              )}
            </div>
          );
        }

        return (
          <div
            className={`field ${field.type === "checkbox" ? "check-field" : ""}`}
            data-field-type={field.type}
            key={key}
          >
            {tx(
              field.type === "checkbox" ? (
                <label htmlFor={id}>
                  <input
                    {...shared}
                    type="checkbox"
                    checked={scope[field.id] === true}
                    onChange={(event) => update(event.target.checked)}
                  />
                  <span>{choose(field.label)}</span>
                </label>
              ) : (
                <>
                  <label htmlFor={id}>
                    {choose(field.label)}
                    {required ? " *" : ""}
                  </label>
                  {tx(
                    field.type === "select" ? (
                      <select
                        {...shared}
                        value={scope[field.id] ?? ""}
                        onChange={(event) => update(event.target.value)}
                      >
                        <option value="">
                          {t("নির্বাচন করুন / Select an option")}
                        </option>
                        {tx(
                          field.options?.map((option) => (
                            <option key={option.value} value={option.value}>
                              {choose(option.label)}
                            </option>
                          )),
                        )}
                      </select>
                    ) : field.type === "textarea" ? (
                      <textarea
                        {...shared}
                        rows={3}
                        maxLength={field.constraints?.maxLength}
                        value={scope[field.id] ?? ""}
                        onChange={(event) => update(event.target.value)}
                      />
                    ) : (
                      <input
                        {...shared}
                        // Phase 4: dates render as a plain text input with an
                        // ISO placeholder. Native date inputs reject direct
                        // typed entry in several browsers/locales (the live
                        // campaign needed a spinbutton workaround on service
                        // 16); a text input accepts typing and paste
                        // everywhere, and the shared engine still validates
                        // the value as a real YYYY-MM-DD calendar date.
                        type={field.type === "number" ? "number" : "text"}
                        inputMode={
                          field.type === "number"
                            ? "decimal"
                            : field.type === "date"
                              ? "numeric"
                              : isMobileField
                                ? "numeric"
                                : isEmailField
                                  ? "email"
                                  : undefined
                        }
                        placeholder={
                          field.type === "date"
                            ? "YYYY-MM-DD"
                            : isMobileField
                              ? "01XXXXXXXXX"
                              : isEmailField
                                ? "name@example.com"
                                : undefined
                        }
                        maxLength={
                          field.type === "date"
                            ? 10
                            : field.constraints?.maxLength
                        }
                        value={scope[field.id] ?? ""}
                        onChange={(event) =>
                          update(
                            field.type === "number" && event.target.value !== ""
                              ? Number(event.target.value)
                              : event.target.value,
                          )
                        }
                      />
                    ),
                  )}
                </>
              ),
            )}
            {tx(
              field.description && (
                <p className="hint">{choose(field.description)}</p>
              ),
            )}
            {tx(
              error && (
                <p id={`${id}-error`} className="field-error">
                  {choose(error.message)}
                </p>
              ),
            )}
          </div>
        );
      });
  }
  const hasRequired = schema.sections.some((section) =>
    section.fields.some(
      (field) => field.constraints?.required || field.requiredWhen,
    ),
  );
  return (
    <div className="dynamic-form" aria-busy={uploading}>
      {hasRequired && (
        <p className="hint required-legend">
          {choose({
            bn: "* চিহ্নিত ঘরগুলো আবশ্যক",
            en: "Fields marked * are required",
          })}
        </p>
      )}
      {tx(
        schema.sections.map((section) => (
          <fieldset key={section.id}>
            <legend>{choose(section.title)}</legend>
            <div className="form-grid">{tx(fields(section.fields, value))}</div>
          </fieldset>
        )),
      )}
    </div>
  );
}
