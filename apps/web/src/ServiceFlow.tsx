import React, { useEffect, useRef, useState } from "react";
import { randomUUID } from "./uuid.js";
import {
  getServiceSchema,
  groupControllerIds,
  isFieldVisible,
  serviceDescriptions,
  validateForm,
  type FieldDefinition,
  type FormSchema,
  type ValidationIssue,
} from "@astra/shared-schemas/web";
import { api, errorCode, items } from "./api.js";
import { choose, recordName, useLanguage } from "./i18n.js";
import { DynamicForm } from "./DynamicForm.js";
import {
  ApplicationOrder,
  money,
  prefetchOrderOptions,
  type IntakeOrderState,
} from "./ApplicationOrder.js";
import { geographyNames } from "./GeographyFields.js";
import { useFormatters } from "./ui/fmt.js";
import { chosenCitizenAddress } from "./PresentAddressFields.js";
import { withoutOrderLanguage } from "./order-schema.js";
import { ApplicationStatus, RefChip, Stepper } from "./ui/kit.js";
import { ProfileCompletionCard, profileGapsFor } from "./ProfileCompletion.js";
import { citizenFormDefaults } from "./citizen-prefill.js";
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
 * R10LIVE-WSB (S2): a checkbox with mustBeTrue is a declaration/attestation
 * the citizen actively gives on the form step — its "হ্যাঁ/Yes" is not
 * applicant data and must never render as a review data row. Plain
 * checkboxes (is_minor, spi_is_dead, has_previous_license, …) carry real
 * facts and stay. Group-controller checkboxes are filtered separately
 * below (QAFIX-01); this covers the confirmation + service declarations.
 */
const isDeclarationField = (field: FieldDefinition): boolean =>
  field.type === "checkbox" && field.constraints?.mustBeTrue === true;

/** Human-readable rendering of one entered value, for the review step. */
function detailText(
  field: FieldDefinition,
  value: any,
  formatDate?: (iso: string) => string,
): string | null {
  if (field.type === "repeatable") {
    if (!Array.isArray(value) || !value.length) return null;
    const rows = value
      .map((row: Record<string, any>, index: number) => {
        const parts = (field.children ?? [])
          .filter((child) => isFieldVisible(child, row ?? {}))
          // R10LIVE-WSB (S2): declarations inside a repeating group are
          // form mechanics too — same exclusion as the top-level filter.
          .filter((child) => !isDeclarationField(child))
          .map((child) => {
            const childText = detailText(child, row?.[child.id], formatDate);
            return childText ? `${choose(child.label)}: ${childText}` : null;
          })
          .filter(Boolean);
        return parts.length ? `${index + 1}. ${parts.join(", ")}` : null;
      })
      .filter(Boolean);
    // QAFIX-01 (§4 item 10): one row per line — a run-on joined string is
    // what read as "cut off mid-line" on the family/heir lists.
    return rows.length ? rows.join("\n") : null;
  }
  if (!presentValue(value)) return null;
  switch (field.type) {
    case "checkbox":
      // Only an actively ticked box is a detail worth reviewing.
      return value === true ? choose({ bn: "হ্যাঁ", en: "Yes" }) : null;
    case "select": {
      const option = field.options?.find((item) => item.value === value);
      // R10LIVE-WSB (service 27): a select whose resolved display text is
      // empty must never render as a blank review row — skip it instead.
      // (Live r10 reported a blank "উদ্দেশ্যের ভাষা" row; the current
      // schema maps "bn" to "বাংলা" and the probe could not reproduce a
      // blank, so this is a guard, not a reproduction fix.)
      const resolved = option ? choose(option.label) : String(value);
      return resolved.trim() ? resolved : null;
    }
    case "attachment":
      return typeof value?.byteLength === "number"
        ? `${choose({ bn: "সংযুক্ত নথি", en: "Attached document" })} (${Math.max(1, Math.round(value.byteLength / 1024))} KB)`
        : choose({ bn: "সংযুক্ত নথি", en: "Attached document" });
    case "geography":
      // Rendered by GeographyDetailText (names, never codes); the string
      // form only survives for nested use, where no geography field occurs.
      return Object.values(value ?? {}).filter(Boolean).join(" / ") || null;
    case "date":
      // QAFIX-01 (§4 item 10): human dates on the review screen, never ISO.
      return formatDate ? formatDate(String(value)) : String(value);
    default:
      return String(value);
  }
}

/**
 * QAFIX-01 (§4 item 10): a geography value on the review screen resolves
 * to place names (বেলাবো, নরসিংদী…) — the raw dataset codes citizens saw
 * before (div-01 / dis-10 / upa-047) never render.
 */
function GeographyDetailText({ value }: { value: any }) {
  useLanguage();
  const [names, setNames] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setNames(null);
    setFailed(false);
    geographyNames(value)
      .then((resolved) => {
        if (active) setNames(resolved);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [JSON.stringify(value ?? null)]);
  if (failed)
    return (
      <>
        {choose({
          bn: "এলাকার নাম লোড হয়নি",
          en: "Area names could not be loaded",
        })}
      </>
    );
  if (!names)
    return <>{choose({ bn: "লোড হচ্ছে…", en: "Loading…" })}</>;
  return <>{names.join(" / ")}</>;
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
  const { date: formatDate } = useFormatters();
  const sections = schema.sections
    .map((section) => ({
      section,
      rows: section.fields
        .filter((field) => isFieldVisible(field, payload))
        // QAFIX-01 (§4 item 10): group-controller checkboxes (the opt-in
        // toggles) are form mechanics — their "হ্যাঁ" never leaks onto the
        // review screen as if it were applicant data.
        // R10LIVE-WSB (S2): the same holds for declaration/attestation
        // checkboxes (confirmation + service declarations) — the box
        // itself stays functional on the form step; only its review row
        // goes away.
        .filter(
          (field) =>
            !(field.type === "checkbox" && groupControllerIds.has(field.id)) &&
            !isDeclarationField(field),
        )
        .map((field) => ({
          field,
          text:
            field.type === "geography"
              ? presentValue(payload[field.id])
                ? "geography"
                : null
              : detailText(field, payload[field.id], formatDate),
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
              /* P2-5: long declarations span both columns. QAFIX-01:
                 repeatable lists always span — one member/heir per line. */
              const wide =
                row.field.type === "repeatable" ||
                (row.field.type !== "geography" &&
                  String(row.text ?? "").length > 120);
              return (
                <React.Fragment key={row.field.id}>
                  <dt className={wide ? "wide" : undefined}>
                    {choose(row.field.label)}
                  </dt>
                  <dd
                    className={
                      [wide ? "wide" : "", row.field.type === "repeatable" ? "repeatable" : ""]
                        .filter(Boolean)
                        .join(" ") || undefined
                    }
                  >
                    {row.field.type === "geography" ? (
                      <GeographyDetailText value={payload[row.field.id]} />
                    ) : (
                      row.text
                    )}
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
  // W-004: one idempotency key per flow mount. Every create from this
  // attempt (draft or submit, including a retry after a network failure)
  // carries the same key, so the server returns the original application
  // instead of a duplicate draft. A new flow mount mints a new key, so
  // a legitimate repeat application is still possible.
  const [requestKey] = useState(() => randomUUID());
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ id: string; reference?: string; state: string; note?: string; partial?: boolean } | null>(null);
  // W-013: whether this office has an order policy for the service. A
  // partial (half-filled) draft can only be saved before the delivery step
  // when no policy exists — with a policy, the draft needs the order
  // snapshot, which is only chosen at the delivery step. Resolved from the
  // same prefetched options the delivery step uses.
  const [orderPolicyConfigured, setOrderPolicyConfigured] = useState<boolean | null>(null);
  // W-006: the fee outcome of this submit, fetched when the review step is
  // reached so the citizen / responsible office sees it BEFORE committing.
  // The preview is advisory (balances move); the submit stays authoritative.
  const [feePreview, setFeePreview] = useState<any>(null);
  useEffect(() => {
    if (step !== 3) return;
    let active = true;
    api(`/fee-preview?serviceNo=${serviceNo}`)
      .then((r) => {
        if (active) setFeePreview(r);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [step, serviceNo]);
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
  // QAFIX-01 (§4 item 4): start the fee-settings request while the citizen
  // is still filling the form, so the fee step resolves the moment it is
  // reached instead of spinning on a cold call (the live QA measured
  // 8–10 s on services 36/41). The server stays authoritative: the quote
  // and the application creation re-read the policy server-side.
  useEffect(() => {
    if (step === 1 && citizen) {
      prefetchOrderOptions(serviceNo);
      // W-013: learn whether a policy exists so the form step knows if an
      // incomplete draft can be saved here (no policy) or only after the
      // delivery step (policy configured).
      let active = true;
      prefetchOrderOptions(serviceNo)
        .then((options) => {
          if (active) setOrderPolicyConfigured(Boolean(options?.configured));
        })
        .catch(() => {});
      return () => {
        active = false;
      };
    }
  }, [step, citizen, serviceNo]);
  // QAFIX-01 (§1 bug 5): the record handed in at mount is the workspace's
  // snapshot from sign-in time. A citizen who completed their profile a
  // minute ago — on the profile page, in this same session — was still
  // asked for the same items again, because the flow never looked again.
  // A self-applying citizen's own record is re-read when the flow opens;
  // staff intake (a searched-for citizen) is untouched.
  useEffect(() => {
    if (!selfCitizen || !initialCitizen?.id) return;
    let active = true;
    api("/citizens")
      .then((r) => {
        if (!active) return;
        const fresh =
          items(r).find((c: any) => c.id === initialCitizen.id) ?? null;
        if (fresh) setCitizen(fresh);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
    // Mount-only: the snapshot is replaced once, when the flow opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const formReady =
    selfCitizen && step === 1 && !!citizen && profileGapsFor(citizen).length === 0;
  useEffect(() => {
    if (!formReady) return;
    const defaults = citizenFormDefaults(formSchema, citizen);
    if (!Object.keys(defaults).length) return;
    // QAFIX-02 (found on service 2): merge the defaults UNDER whatever the
    // form already holds. The old all-or-nothing seeding lost every default
    // on services with a required repeatable (family members, heirs): the
    // form's row-seeding effect runs first and puts a blank row in the
    // payload, so the payload was never empty when this effect ran and the
    // citizen's own facts were silently never prefilled. Values already
    // present (seeded rows, anything typed) always win.
    setPayload((current) => {
      const missing = Object.keys(defaults).filter((key) => !(key in current));
      return missing.length ? { ...defaults, ...current } : current;
    });
  }, [formReady, citizen, formSchema]);
  // WS-C (Md's decision): NID autofill for the applicant's OWN record
  // only. The full number never rides the citizen list/detail payload —
  // it is fetched here through the existing audited reveal endpoint
  // (GET /citizens/:id/identity, which writes a CITIZEN_IDENTITY_VIEWED
  // audit event) inside the citizen's own authenticated session, and
  // merged UNDER anything already typed, exactly like the other
  // defaults. Staff intake (selfCitizen false) never autofills another
  // person's NID. Services with a top-level nid_number field: 15/27/33/37.
  const nidAutofillDone = useRef<string>("");
  const autofillCitizenId = citizen?.id;
  const autofillNidHint = citizen?.nidHint;
  useEffect(() => {
    if (!formReady || !autofillCitizenId || !autofillNidHint) return;
    const asksNid = formSchema.sections.some((section) =>
      section.fields.some((field) => field.id === "nid_number" && field.type === "text"),
    );
    if (!asksNid) return;
    const key = `${autofillCitizenId}:${formSchema.serviceNo}`;
    if (nidAutofillDone.current === key) return;
    nidAutofillDone.current = key;
    let active = true;
    let settled = false;
    api(`/citizens/${autofillCitizenId}/identity`)
      .then((numbers) => {
        settled = true;
        if (!active || typeof numbers?.nid !== "string" || !numbers.nid) return;
        setPayload((current) =>
          "nid_number" in current ? current : { nid_number: numbers.nid, ...current },
        );
      })
      .catch(() => {
        settled = true;
      });
    return () => {
      active = false;
      // Integration fix: a request cancelled before it answered (e.g. the
      // mount-time citizen refresh re-ran this effect) must not leave the key
      // marked done, or the re-run exits early and the field stays empty.
      if (!settled && nidAutofillDone.current === key) nidAutofillDone.current = "";
    };
    // Primitive deps: a refreshed citizen object with the same id/hint does not
    // re-run (and re-audit) the reveal.
  }, [formReady, autofillCitizenId, autofillNidHint, formSchema]);
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
        requestKey,
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

  // W-013: save the half-filled form as a partial draft — no client-side
  // validation, no order input (only offered when no order policy exists, so
  // the server never has to refuse it for a missing order snapshot). The
  // server marks it partial; submit re-validates fully.
  // W-013 follow-up (Stage 4): when the delivery options are already
  // chosen (step 2), the order snapshot travels with the draft too — the
  // server accepts partial+order (it skips only form validation), so a
  // policy-configured service can now save mid-flow instead of waiting
  // for the review step.
  async function savePartialDraft() {
    setBusy(true);
    setError("");
    try {
      const created = await api("/applications", "POST", {
        citizenId: citizen.id,
        serviceNo,
        payload,
        requestKey,
        partial: true,
        ...(order?.order ? { order: order.order } : {}),
      });
      const createdApplication = created.application || created;
      onChanged();
      setResult({
        id: createdApplication.id as string,
        reference: (createdApplication.reference as string) || undefined,
        state: "DRAFT",
        partial: true,
      });
      go(4);
    } catch (saveError) {
      setError((saveError as Error).message);
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
          {/* QAFIX-02 (§3.4/§4 item 3): near-duplicate services carry a
              one-line distinguishing description under the title, so the
              citizen can tell them apart before starting. */}
          {serviceDescriptions[serviceNo] && (
            <p className="ax-flow-desc">{choose(serviceDescriptions[serviceNo])}</p>
          )}
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
              {/* W-013: save the half-filled form. Only when this office has no
                  order policy for the service — with a policy the draft needs
                  the delivery options, which are chosen at the next step, and
                  a draft can be saved at the review step instead. */}
              {orderPolicyConfigured === false && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => void savePartialDraft()}
                >
                  {choose({ bn: "অসম্পূর্ণ খসড়া সংরক্ষণ", en: "Save incomplete draft" })}
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
            {orderPolicyConfigured === true && (
              <p className="hint">
                {choose({
                  bn: "এই সেবায় ডেলিভারি অপশন বেছে নেওয়ার পর পরের ধাপেই খসড়া সংরক্ষণ করা যাবে।",
                  en: "For this service, a draft can be saved once the delivery options are chosen, at the next step.",
                })}
              </p>
            )}
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
              {/* W-013 follow-up (Stage 4): with a policy-configured
                  service the draft can be saved here, once the delivery
                  options are chosen — enabled on the same condition as
                  "Next", so the order snapshot is always present. */}
              <button
                type="button"
                className="secondary"
                disabled={busy || order?.context !== context || !order.ready}
                onClick={() => void savePartialDraft()}
              >
                {choose({ bn: "অসম্পূর্ণ খসড়া সংরক্ষণ", en: "Save incomplete draft" })}
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
              {(payload.delivery_language === "bn" ||
                payload.delivery_language === "en" ||
                payload.delivery_language === "bilingual") && (
                <>
                  <dt>{choose({ bn: "নথির ভাষা", en: "Document language" })}</dt>
                  <dd>
                    {payload.delivery_language === "en"
                      ? "English"
                      : payload.delivery_language === "bilingual"
                        ? choose({
                            bn: "দ্বিভাষিক (বাংলা ও ইংরেজি)",
                            en: "Bilingual (Bangla and English)",
                          })
                        : "বাংলা"}
                  </dd>
                </>
              )}
              <dt>{choose({ bn: "ফি", en: "Fees" })}</dt>
              <dd>
                {order?.configured
                  ? choose({ bn: "আগের ধাপে গ্রহণ করা হিসাব অনুযায়ী", en: "As accepted in the previous step" })
                  : choose({ bn: "এই অফিসে ফি নীতি নির্ধারিত নেই", en: "No fee policy is configured for this office" })}
              </dd>
            </dl>
            {/* W-006: the financial outcome of this submit, before the citizen commits. */}
            <div className="ax-flow-fee-preview" data-testid="fee-preview">
              <h4>{choose({ bn: "ফি — জমা দেওয়ার আগে", en: "Fees — before you submit" })}</h4>
              {!feePreview ? (
                <p className="ax-flow-muted">
                  {choose({ bn: "ফির হিসাব লোড হচ্ছে…", en: "Loading the fee summary…" })}
                </p>
              ) : (
                <>
                  {orderConfigured && order?.quoteTotalMinor != null ? (
                    <p>
                      {choose({
                        bn: `সেবার ফি: ${money(order.quoteTotalMinor)} ৳ — সনদ ইস্যুর আগে এই ফি পরিশোধ করতে হবে।`,
                        en: `Service fee: ৳${money(order.quoteTotalMinor)} — payable before the certificate is issued.`,
                      })}
                    </p>
                  ) : null}
                  {feePreview.method === "ALLOWANCE" ? (
                    <p>
                      {choose({
                        bn: `প্ল্যাটফর্ম ফি: সাবস্ক্রিপশন সুবিধা থেকে কাটা হবে — ০ ক্রেডিট। এই মাসে ব্যবহৃত ${feePreview.allowance.used} / সীমা ${feePreview.allowance.limit ?? "সীমাহীন"}।`,
                        en: `Platform fee: covered by the subscription allowance — 0 credits. Used this month ${feePreview.allowance.used} of ${feePreview.allowance.limit ?? "unlimited"}.`,
                      })}
                    </p>
                  ) : feePreview.method === "FREE" ? (
                    <p>
                      {choose({
                        bn: "প্ল্যাটফর্ম ফি: এই সেবার জন্য কোনো ফি নেই।",
                        en: "Platform fee: no fee for this service.",
                      })}
                    </p>
                  ) : (
                    <p>
                      {choose({
                        bn: `প্ল্যাটফর্ম ফি: অফিসের ওয়ালেট থেকে ${feePreview.credits} ক্রেডিট কাটা হবে। ওয়ালেট ব্যালেন্স: ${feePreview.walletBalance} ক্রেডিট।`,
                        en: `Platform fee: ${feePreview.credits} credit${feePreview.credits === 1 ? "" : "s"} will be taken from the office wallet. Wallet balance: ${feePreview.walletBalance} credits.`,
                      })}
                      {feePreview.allowance && feePreview.allowance.remaining === 0
                        ? choose({
                            bn: " সাবস্ক্রিপশন সুবিধা এই মাসে শেষ — তাই ওয়ালেট থেকে কাটা হবে।",
                            en: " The subscription allowance is used up this month, so the wallet pays instead.",
                          })
                        : ""}
                    </p>
                  )}
                  {feePreview.isDefaultPrice ? (
                    <p className="ax-flow-muted">
                      {choose({
                        bn: "ডিফল্ট মূল্য — অফিস এখনো এই সেবার মূল্য প্রকাশ করেনি।",
                        en: "Default price — the office has not published a price for this service.",
                      })}
                    </p>
                  ) : null}
                  {feePreview.willBlockSubmit ? (
                    <p className="ax-flow-error" role="alert">
                      {feePreview.blockReason}
                    </p>
                  ) : null}
                  <p className="ax-flow-muted">
                    {choose({
                      bn: "জমা দেওয়ার মুহূর্তের হিসাবই চূড়ান্ত হবে।",
                      en: "The amounts at the moment of submit are final.",
                    })}
                  </p>
                </>
              )}
            </div>
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
                : result.partial
                  ? choose({ bn: "অসম্পূর্ণ খসড়া সংরক্ষিত হয়েছে — আবেদনের তালিকা থেকে খুলে ফরমটি শেষ করুন।", en: "Incomplete draft saved — open it from your applications to finish the form." })
                  : choose({ bn: "আবেদন খসড়া হিসেবে সংরক্ষিত হয়েছে; এখনো জমা হয়নি।", en: "The application is saved as a draft; it is not submitted yet." })}
            </p>
            {result.note && <p className="ax-flow-error">{result.note}</p>}
            <p>
              {choose({ bn: "আবেদনের রেফারেন্স", en: "Application reference" })}:{" "}
              <RefChip value={result.reference || result.id} />
            </p>
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
