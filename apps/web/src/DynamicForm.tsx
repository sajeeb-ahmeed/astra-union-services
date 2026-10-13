import { t, tx, choose } from "./i18n.js";
import { useId, useRef, useState, type ReactNode } from "react";
import {
  evaluatePredicate,
  isFieldVisible,
  type FieldDefinition,
  type FormSchema,
  type ValidationIssue,
} from "@astra/shared-schemas";
import { api } from "./api.js";

type Values = Record<string, any>;
type Props = {
  schema: FormSchema;
  value: Values;
  onChange: (value: Values) => void;
  issues?: readonly ValidationIssue[];
  disabled?: boolean;
  citizenId?: string;
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
}: Props) {
  const prefix = useId();
  const currentValue = useRef(value);
  const context = `${schema.serviceNo}:${schema.version}:${citizenId ?? ""}`;
  const currentContext = useRef(context);
  currentValue.current = value;
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
        const required = !!(
          field.constraints?.required ||
          (field.requiredWhen && evaluatePredicate(field.requiredWhen, scope))
        );
        const update = (nextValue: any) => {
          // Resolve the latest root value so an asynchronous upload cannot overwrite intervening edits.
          const parentPath = tokens(key).slice(0, -1);
          const currentScope = atPath(currentValue.current, parentPath) ?? {};
          const nextScope = { ...currentScope, [field.id]: nextValue };
          for (const sibling of definitions)
            if (sibling.visibleWhen && !isFieldVisible(sibling, nextScope))
              delete nextScope[sibling.id];
          const next = replaceScope(
            currentValue.current,
            parentPath,
            nextScope,
          );
          currentValue.current = next;
          onChange(next);
        };
        const shared = {
          id,
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
            <fieldset
              {...shared}
              tabIndex={-1}
              key={key}
              className="repeatable"
            >
              <legend>{choose(field.label)}</legend>
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
            </fieldset>
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
            <div className="field" key={key}>
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
                    if (currentContext.current !== context) return;
                    const result = await api("/attachments", "POST", {
                      citizenId,
                      mimeType: file.type,
                      base64: btoa(binary),
                    });
                    const source = result.attachment ?? result;
                    if (
                      typeof source.attachmentId !== "string" ||
                      typeof source.mimeType !== "string" ||
                      typeof source.byteLength !== "number"
                    )
                      throw new Error(
                        "Upload service returned an invalid private attachment handle.",
                      );
                    if (currentContext.current === context)
                      update({
                        attachmentId: source.attachmentId,
                        mimeType: source.mimeType,
                        byteLength: source.byteLength,
                      });
                  } catch (uploadError) {
                    if (currentContext.current === context)
                      setUploadErrors((previous) => ({
                        ...previous,
                        [uploadKey]:
                          uploadError instanceof Error
                            ? uploadError.message
                            : "Document upload failed.",
                      }));
                  } finally {
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
                  <p className="hint" role="status">
                    {t("নথি সংরক্ষিত / Private upload saved:")}
                    {tx(" ")}
                    {tx(scope[field.id].byteLength)}
                    {t(" bytes ")}
                  </p>
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
                        type={
                          field.type === "date"
                            ? "date"
                            : field.type === "number"
                              ? "number"
                              : "text"
                        }
                        maxLength={field.constraints?.maxLength}
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
  return (
    <div className="dynamic-form" aria-busy={uploading}>
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
