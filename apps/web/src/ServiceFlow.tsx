import React, { useEffect, useRef, useState } from "react";
import {
  getServiceSchema,
  isFieldVisible,
  validateForm,
  type FieldDefinition,
  type FormSchema,
  type ValidationIssue,
} from "@astra/shared-schemas";
import { api, errorCode, items } from "./api.js";
import { choose, recordName, useLanguage } from "./i18n.js";
import { DynamicForm } from "./DynamicForm.js";
import { ApplicationOrder, type IntakeOrderState } from "./ApplicationOrder.js";
import { chosenCitizenAddress } from "./PresentAddressFields.js";
import { withoutOrderLanguage } from "./order-schema.js";
import { ApplicationStatus, RefChip, Stepper } from "./ui/kit.js";
import { SampleCertificate } from "./TrustVisual.js";
import { ProfileCompletionCard, profileGapsFor } from "./ProfileCompletion.js";
import "./service-flow.css";

const steps = [
  { bn: "নাগরিক", en: "Citizen" },
  { bn: "আবেদনের তথ্য", en: "Application form" },
  { bn: "ফি ও সরবরাহ", en: "Fees and delivery" },
  { bn: "যাচাই ও জমা", en: "Review and submit" },
  { bn: "সম্পন্ন", en: "Done" },
] as const;

const citizenName = (c: any) =>
  choose({ bn: c?.nameBn || c?.name_bn, en: c?.nameEn || c?.name_en });

const presentValue = (value: unknown): boolean =>
  value !== undefined &&
  value !== null &&
  !(typeof value === "string" && value.trim() === "");

/**
 * PORTAL-B: form fields that ask again for what the citizen record already
 * holds. The form opens with these filled (still editable), so nobody types
 * the same address or parents' names twice.
 */
const CITIZEN_FIELD_SOURCES: Record<string, string> = {
  permanent_address_bn: "addressBn",
  permanent_address_en: "addressEn",
  father_name_bn: "fatherNameBn",
  father_name_en: "fatherNameEn",
  mother_name_bn: "motherNameBn",
  mother_name_en: "motherNameEn",
  spouse_name_bn: "spouseNameBn",
  spouse_name_en: "spouseNameEn",
  date_of_birth: "dateOfBirth",
};

/** Starting values for a new application: top-level text/date fields only. */
export function citizenFormDefaults(schema: FormSchema, citizen: any): Record<string, string> {
  const defaults: Record<string, string> = {};
  if (!citizen) return defaults;
  for (const section of schema.sections)
    for (const field of section.fields) {
      const source = CITIZEN_FIELD_SOURCES[field.id];
      if (!source || !["text", "textarea", "date"].includes(field.type)) continue;
      const value = citizen[source];
      if (typeof value === "string" && value.trim()) defaults[field.id] = value.trim();
    }
  return defaults;
}

/** Human-readable rendering of one entered value, for the review step. */
function detailText(field: FieldDefinition, value: any): string | null {
  if (field.type === "repeatable") {
    if (!Array.isArray(value) || !value.length) return null;
    const rows = value
      .map((row: Record<string, any>, index: number) => {
        const parts = (field.children ?? [])
          .filter((child) => isFieldVisible(child, row ?? {}))
          .map((child) => {
            const childText = detailText(child, row?.[child.id]);
            return childText ? `${choose(child.label)}: ${childText}` : null;
          })
          .filter(Boolean);
        return parts.length ? `${index + 1}. ${parts.join(", ")}` : null;
      })
      .filter(Boolean);
    return rows.length ? rows.join("; ") : null;
  }
  if (!presentValue(value)) return null;
  switch (field.type) {
    case "checkbox":
      // Only an actively ticked box is a detail worth reviewing.
      return value === true ? choose({ bn: "হ্যাঁ", en: "Yes" }) : null;
    case "select": {
      const option = field.options?.find((item) => item.value === value);
      return option ? choose(option.label) : String(value);
    }
    case "attachment":
      return typeof value?.byteLength === "number"
        ? `${choose({ bn: "সংযুক্ত নথি", en: "Attached document" })} (${Math.max(1, Math.round(value.byteLength / 1024))} KB)`
        : choose({ bn: "সংযুক্ত নথি", en: "Attached document" });
    case "geography":
      return Object.values(value ?? {}).filter(Boolean).join(" / ") || null;
    default:
      return String(value);
  }
}

/**
 * FULL-UIUX-01 (P0-5i): a validation path ("father_name", "guardians[0].name")
 * is a schema key, not language. Resolve it to the field's own bilingual
 * label by walking the schema; only an unmapped path falls back to itself.
 */
function fieldLabelForPath(
  schema: FormSchema,
  path: string,
): { bn: string; en: string } | null {
  const parts = path
    .replace(/\[\d+\]/g, "")
    .split(".")
    .filter(Boolean);
  let fields: readonly FieldDefinition[] | undefined = schema.sections.flatMap(
    (s) => s.fields,
  );
  let found: FieldDefinition | undefined;
  for (const part of parts) {
    found = fields?.find((f) => f.id === part);
    if (!found) return null;
    fields = found.children;
  }
  return found?.label ?? null;
}

/**
 * Phase 4: the review step lists the service-specific details the citizen
 * actually entered, grouped by form section — not only the generic
 * service/applicant/office/fee summary.
 * FULL-UIUX-01: exported — the workspace application detail reuses this
 * exact renderer as its read-only summary (one summary pattern).
 */
export function PayloadDetails({
  schema,
  payload,
}: {
  schema: FormSchema;
  payload: Record<string, any>;
}) {
  const sections = schema.sections
    .map((section) => ({
      section,
      rows: section.fields
        .filter((field) => isFieldVisible(field, payload))
        .map((field) => ({
          field,
          text: detailText(field, payload[field.id]),
        }))
        .filter((row) => row.text !== null),
    }))
    .filter((entry) => entry.rows.length);
  if (!sections.length) return null;
  return (
    <div className="ax-flow-details">
      {sections.map(({ section, rows }) => (
        <div key={section.id} className="ax-flow-details-section">
          <h4>{choose(section.title)}</h4>
          <dl className="ax-flow-details-list">
            {rows.map((row) => {
              /* P2-5: long declarations span both columns. */
              const wide = String(row.text ?? "").length > 120;
              return (
                <React.Fragment key={row.field.id}>
                  <dt className={wide ? "wide" : undefined}>
                    {choose(row.field.label)}
                  </dt>
                  <dd className={wide ? "wide" : undefined}>
                    {row.text}
                    {/* QA-05: reviewers must be able to open what they approve. */}
                    {attachmentIds(row.field, payload[row.field.id]).map(
                      (id, index, all) => (
                        <a
                          key={id}
                          className="ax-flow-attachment-link"
                          href={`/api/v1/attachments/${encodeURIComponent(id)}`}
                          target="_blank"
                          rel="noopener"
                        >
                          {choose({ bn: "নথি খুলুন", en: "Open document" })}
                          {all.length > 1 ? ` ${index + 1}` : ""}
                        </a>
                      ),
                    )}
                  </dd>
                </React.Fragment>
              );
            })}
          </dl>
        </div>
      ))}
    </div>
  );
}

/** QA-05: every stored attachment id under a field (repeating groups included). */
function attachmentIds(field: FieldDefinition, value: any): string[] {
  if (field.type === "attachment")
    return typeof value?.attachmentId === "string" ? [value.attachmentId] : [];
  if (Array.isArray(value) && field.children?.length)
    return value.flatMap((row) =>
      field.children!.flatMap((child) => attachmentIds(child, row?.[child.id])),
    );
  return [];
}

/**
 * Phase 1 slice (iii): one service application as a guided flow — citizen, form, fees, review, done.
 * Uses the same validation, order component and API as the legacy intake: POST /applications creates the
 * draft and the "submit" transition sends it to the office.
 */
export function ServiceFlow({
  serviceNo,
  initialCitizen = null,
  selfCitizen = false,
  tenant,
  onOpenApplication,
  onRegisterCitizen,
  onExit,
  onChanged,
}: {
  serviceNo: number;
  /** A citizen registered from inside the flow; the flow resumes at the form with them selected. */
  initialCitizen?: any;
  /** FULL-UIUX-01 (UX M14): the signed-in citizen applying for themselves —
      their own record is pre-selected and the citizen step leaves the stepper. */
  selfCitizen?: boolean;
  tenant: any;
  onOpenApplication: (id: string) => void;
  onRegisterCitizen: () => void;
  onExit: () => void;
  onChanged: () => void;
}) {
  useLanguage();
  const schema = getServiceSchema(serviceNo);
  const [step, setStep] = useState(initialCitizen ? 1 : 0);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<any[] | null>(null);
  // Phase 5 (5B): a failed search request is not the same as "no citizen found" — during the
  // live campaign a broken session made every search look like an empty result.
  const [searchFailed, setSearchFailed] = useState(false);
  const [citizen, setCitizen] = useState<any>(initialCitizen);
  const [payload, setPayload] = useState<Record<string, any>>({});
  const [issues, setIssues] = useState<readonly ValidationIssue[]>([]);
  const [order, setOrder] = useState<IntakeOrderState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ id: string; reference?: string; state: string; note?: string } | null>(null);
  // FULL-UIUX-01 (FE S8): when the office has no fee policy, the fee step
  // has nothing to ask — it is skipped in both directions.
  const [feeSkipped, setFeeSkipped] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const context = `flow:${citizen?.id ?? ""}:${serviceNo}`;
  const orderConfigured = order?.context === context && order.configured;
  const formSchema = orderConfigured ? withoutOrderLanguage(schema) : schema;
  const feeStepEmpty =
    order?.context === context && order.ready && !order.configured;
  useEffect(() => {
    if (feeStepEmpty && step === 2) {
      setFeeSkipped(true);
      setStep(3);
    }
  }, [feeStepEmpty, step]);

  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  // PORTAL-B: a citizen applying for themselves starts from what their own
  // record already holds. Staff intake keeps its blank form (Release 0.4,
  // "citizen-first blank applications" — the intake tests pin it).
  const formReady =
    selfCitizen && step === 1 && !!citizen && profileGapsFor(citizen).length === 0;
  useEffect(() => {
    if (!formReady) return;
    const defaults = citizenFormDefaults(formSchema, citizen);
    if (!Object.keys(defaults).length) return;
    setPayload((current) => (Object.keys(current).length ? current : defaults));
  }, [formReady, citizen, formSchema]);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      api(`/citizens?q=${encodeURIComponent(query)}`)
        .then((r) => {
          if (!active) return;
          setSearchFailed(false);
          setFound(items(r));
        })
        .catch(() => {
          if (!active) return;
          setSearchFailed(true);
          setFound([]);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  function go(next: number) {
    setError("");
    setStep(next);
  }
  function chooseCitizen(next: any) {
    if (next?.id !== citizen?.id) {
      setPayload({});
      setIssues([]);
      setOrder(null);
      setFeeSkipped(false);
    }
    setCitizen(next);
  }
  async function create(submit: boolean) {
    setBusy(true);
    setError("");
    try {
      const created = await api("/applications", "POST", {
        citizenId: citizen.id,
        serviceNo,
        payload,
        ...(order?.order ? { order: order.order } : {}),
      });
      const createdApplication = created.application || created;
      const id = createdApplication.id as string;
      // Phase 5 (5C): the citizen tracks by the public reference, not the internal UUID;
      // applications created before Phase 5 have no reference and fall back to the id.
      const reference = (createdApplication.reference as string) || undefined;
      onChanged();
      if (!submit) {
        setResult({ id, reference, state: "DRAFT" });
        go(4);
        return;
      }
      try {
        await api(`/applications/${id}/transition`, "POST", { action: "submit" });
        setResult({ id, reference, state: "SUBMITTED" });
        // FULL-UIUX-01 (B20): mark the just-submitted reference so the
        // applications list can surface it at the top with a "new" badge.
        try {
          sessionStorage.setItem(
            "du:last-submitted-reference",
            reference ?? id,
          );
        } catch {
          // Storage unavailable (private mode): the list simply shows no badge.
        }
      } catch (submitError) {
        // The draft exists; say so plainly instead of hiding it behind a generic failure.
        setResult({ id, reference, state: "DRAFT", note: (submitError as Error).message });
      }
      onChanged();
      go(4);
    } catch (createError) {
      setError((createError as Error).message);
      // REG-UX Phase 1: the server's application gate found deferred profile items
      // missing — return to the form step, where the inline completion card shows.
      if (errorCode(createError) === "PROFILE_INCOMPLETE") setStep(1);
    } finally {
      setBusy(false);
    }
  }

  const title = choose(schema.title);
  return (
    <div className="ax-flow">
      <div className="ax-flow-head">
        <div>
          <span className="ax-eyebrow">
            {choose({ bn: `সেবা ${serviceNo.toLocaleString("bn-BD")}`, en: `Service ${serviceNo}` })}
          </span>
          <h2 className="ax-flow-title">{title}</h2>
        </div>
        {step < 4 && (
          <button type="button" className="text-button" onClick={onExit}>
            {choose({ bn: "বাতিল করে ড্যাশবোর্ডে ফিরুন", en: "Cancel and return to dashboard" })}
          </button>
        )}
      </div>
      <Stepper
        steps={(selfCitizen ? steps.slice(1) : steps).map((s) => choose(s))}
        current={selfCitizen ? Math.max(0, step - 1) : step}
        label={choose({ bn: "আবেদনের ধাপ", en: "Application steps" })}
      />
      <section className="ax-flow-panel" aria-labelledby="ax-flow-step-heading">
        <h3 id="ax-flow-step-heading" ref={heading} tabIndex={-1}>
          {choose(steps[step])}
        </h3>
        {error && (
          <p role="alert" className="ax-flow-error">
            {error}
          </p>
        )}

        {step === 0 && (
          <>
            <label className="ax-flow-field" htmlFor="ax-flow-citizen-search">
              {/* PORTAL-C: the search already matches the contact mobile
                  (Phase 5B) — the number a walk-in citizen knows by heart. */}
              {choose({ bn: "নাগরিক খুঁজুন (নাম, মোবাইল বা রেফারেন্স)", en: "Find a citizen (name, mobile or reference)" })}
              <input
                id="ax-flow-citizen-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            {found === null ? (
              <p className="ax-flow-muted">{choose({ bn: "লোড হচ্ছে…", en: "Loading…" })}</p>
            ) : found.length ? (
              <div
                className="ax-citizen-list"
                role="radiogroup"
                aria-label={choose({ bn: "নাগরিক বাছাই", en: "Choose citizen" })}
              >
                {found.slice(0, 12).map((c) => (
                  <label key={c.id} className={`ax-citizen ${citizen?.id === c.id ? "is-selected" : ""}`}>
                    <input
                      type="radio"
                      name="ax-flow-citizen"
                      value={c.id}
                      checked={citizen?.id === c.id}
                      onChange={() => chooseCitizen(c)}
                    />
                    <span>
                      <strong>{citizenName(c)}</strong>
                      <small>
                        {[c.dateOfBirth || c.date_of_birth, c.syntheticReference || c.synthetic_reference]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
            ) : searchFailed ? (
              <p className="ax-flow-muted" role="alert">
                {choose({ bn: "খোঁজা সম্পন্ন হয়নি। সংযোগ বা সাইন-ইন পরীক্ষা করে আবার চেষ্টা করুন।", en: "The search could not be completed. Check your connection or sign-in and try again." })}
              </p>
            ) : (
              <p className="ax-flow-muted">
                {choose({ bn: "কোনো নাগরিক পাওয়া যায়নি।", en: "No citizen found." })}
              </p>
            )}
            <div className="ax-flow-actions">
              <button type="button" className="secondary" onClick={onRegisterCitizen}>
                {choose({ bn: "নতুন নাগরিক নিবন্ধন", en: "Register a new citizen" })}
              </button>
              <button type="button" disabled={!citizen} onClick={() => go(1)}>
                {choose({ bn: "পরবর্তী: আবেদনের তথ্য", en: "Next: application form" })}
              </button>
            </div>
          </>
        )}

        {step === 1 && profileGapsFor(citizen).length > 0 && (
          // REG-UX Phase 1: only the missing deferred items, inline, then the form.
          <ProfileCompletionCard
            citizen={citizen}
            onSaved={(next) => {
              setCitizen(next);
              setError("");
              onChanged();
            }}
          />
        )}
        {step === 1 && profileGapsFor(citizen).length === 0 && (
          <>
            <p className="ax-flow-muted">
              {choose({ bn: "আবেদনকারী: ", en: "Applicant: " })}
              <strong>{citizenName(citizen)}</strong>
            </p>
            {issues.length > 0 && (
              <div role="alert" className="error-summary" tabIndex={-1}>
                <strong>{choose({ bn: "নিচের ঘরগুলো সংশোধন করুন", en: "Correct these fields" })}</strong>
                <ul>
                  {issues.map((i) => {
                    const label = fieldLabelForPath(formSchema, i.path);
                    return (
                      <li key={i.path}>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() =>
                            document
                              .querySelector<HTMLElement>(`.ax-flow [data-field-path="${CSS.escape(i.path)}"]`)
                              ?.focus()
                          }
                        >
                          {label ? choose(label) : i.path}: {choose(i.message)}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            <div className="application-form" data-testid="service-application-form">
              <DynamicForm
                key={context}
                contextKey={context}
                schema={formSchema}
                citizenId={citizen.id}
                value={payload}
                onChange={(next) => {
                  setPayload(next);
                  // FORM-UX: after the first validation attempt, keep the
                  // issues live — a field the citizen has just corrected
                  // must lose its error immediately, not keep showing a
                  // stale message until the next "Next" click. Before the
                  // first attempt nothing is flagged while typing.
                  if (issues.length) {
                    const rechecked = validateForm(formSchema, next);
                    setIssues(rechecked.issues);
                    if (rechecked.valid) setError("");
                  }
                }}
                issues={issues}
              />
            </div>
            <div className="ax-flow-actions">
              {!selfCitizen && (
                <button type="button" className="secondary" onClick={() => go(0)}>
                  {choose({ bn: "← নাগরিক", en: "← Citizen" })}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  const checked = validateForm(formSchema, payload);
                  setIssues(checked.issues);
                  if (checked.valid) go(2);
                  else
                    setError(
                      choose({
                        bn: "চিহ্নিত ঘরগুলো সংশোধন করুন।",
                        en: "Please correct the highlighted fields.",
                      }),
                    );
                }}
              >
                {choose({ bn: "পরবর্তী: ফি ও সরবরাহ", en: "Next: fees and delivery" })}
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <ApplicationOrder
              key={context}
              context={context}
              serviceNo={serviceNo}
              certificateLanguage={payload.delivery_language}
              officeName={recordName(tenant)}
              address={choose(chosenCitizenAddress(citizen, payload.address_source))}
              onLanguageChange={(language) =>
                setPayload((current) => ({ ...current, delivery_language: language }))
              }
              onChange={setOrder}
            />
            <div className="ax-flow-actions">
              <button type="button" className="secondary" onClick={() => go(1)}>
                {choose({ bn: "← আবেদনের তথ্য", en: "← Application form" })}
              </button>
              <button
                type="button"
                disabled={order?.context !== context || !order.ready}
                onClick={() => go(3)}
              >
                {choose({ bn: "পরবর্তী: যাচাই ও জমা", en: "Next: review and submit" })}
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <dl className="ax-flow-summary">
              <dt>{choose({ bn: "সেবা", en: "Service" })}</dt>
              <dd>{title}</dd>
              <dt>{choose({ bn: "আবেদনকারী", en: "Applicant" })}</dt>
              <dd>{citizenName(citizen)}</dd>
              <dt>{choose({ bn: "অফিস", en: "Office" })}</dt>
              <dd>{recordName(tenant)}</dd>
              <dt>{choose({ bn: "সনদে যে ঠিকানা যাবে", en: "Address on the certificate" })}</dt>
              <dd>{choose(chosenCitizenAddress(citizen, payload.address_source))}</dd>
              {(payload.delivery_language === "bn" || payload.delivery_language === "en") && (
                <>
                  <dt>{choose({ bn: "সনদের ভাষা", en: "Certificate language" })}</dt>
                  <dd>{payload.delivery_language === "en" ? "English" : "বাংলা"}</dd>
                </>
              )}
              <dt>{choose({ bn: "ফি", en: "Fees" })}</dt>
              <dd>
                {order?.configured
                  ? choose({ bn: "আগের ধাপে গ্রহণ করা হিসাব অনুযায়ী", en: "As accepted in the previous step" })
                  : choose({ bn: "এই অফিসে ফি নীতি নির্ধারিত নেই", en: "No fee policy is configured for this office" })}
              </dd>
            </dl>
            <PayloadDetails schema={formSchema} payload={payload} />
            <p className="ax-flow-muted">
              {choose({
                bn: "জমা দিলে আবেদন অফিসের পর্যালোচনায় যাবে। পরে সংশোধন চাওয়া হলে আবার পাঠাতে পারবেন।",
                en: "Submitting sends the application for office review. If a correction is requested, you can resend it.",
              })}
            </p>
            <div className="ax-flow-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => go(feeSkipped ? 1 : 2)}
              >
                {feeSkipped
                  ? choose({ bn: "← আবেদনের তথ্য", en: "← Application form" })
                  : choose({ bn: "← ফি ও সরবরাহ", en: "← Fees and delivery" })}
              </button>
              <button type="button" className="secondary" disabled={busy} onClick={() => create(false)}>
                {choose({ bn: "শুধু খসড়া সংরক্ষণ", en: "Save as draft only" })}
              </button>
              <button type="button" disabled={busy} onClick={() => create(true)}>
                {busy
                  ? choose({ bn: "জমা হচ্ছে…", en: "Submitting…" })
                  : choose({ bn: "আবেদন জমা দিন", en: "Submit application" })}
              </button>
            </div>
          </>
        )}

        {step === 4 && result && (
          <div className="ax-flow-done" role="status">
            {/* FULL-UIUX-01 (D53/programme 25): the completion moment gets
                the brand treatment — a check medallion, and for a submitted
                application the sample-certificate visual showing what the
                finished document looks like (clearly marked as a sample). */}
            <span className="ax-done-medallion" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4.5 12.5 10 18 19.5 6.5" />
              </svg>
            </span>
            <ApplicationStatus state={result.state} />
            <p>
              {result.state === "SUBMITTED"
                ? choose({ bn: "আবেদন জমা হয়েছে এবং অফিসের পর্যালোচনায় আছে।", en: "The application is submitted and waiting for office review." })
                : choose({ bn: "আবেদন খসড়া হিসেবে সংরক্ষিত হয়েছে; এখনো জমা হয়নি।", en: "The application is saved as a draft; it is not submitted yet." })}
            </p>
            {result.note && <p className="ax-flow-error">{result.note}</p>}
            <p>
              {choose({ bn: "আবেদনের রেফারেন্স", en: "Application reference" })}:{" "}
              <RefChip value={result.reference || result.id} />
            </p>
            {result.state === "SUBMITTED" && (
              <div className="ax-flow-done-visual">
                <SampleCertificate compact />
                <p className="hint">
                  {choose({
                    bn: "অনুমোদনের পর আপনার সনদটি দেখতে এমনই হবে — উপরেরটি একটি নমুনা।",
                    en: "After approval, your certificate will look like this — the one above is a sample.",
                  })}
                </p>
              </div>
            )}
            <div className="ax-flow-actions">
              <button type="button" onClick={() => onOpenApplication(result.id)}>
                {choose({ bn: "আবেদন খুলুন", en: "Open application" })}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setPayload({});
                  setIssues([]);
                  setOrder(null);
                  setFeeSkipped(false);
                  setResult(null);
                  go(1);
                }}
              >
                {selfCitizen
                  ? choose({ bn: "এই সেবায় আরেকটি আবেদন", en: "Another application for this service" })
                  : choose({ bn: "একই নাগরিকের আরেকটি আবেদন", en: "Another application for this citizen" })}
              </button>
              <button type="button" className="secondary" onClick={onExit}>
                {choose({ bn: "ড্যাশবোর্ড", en: "Dashboard" })}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
