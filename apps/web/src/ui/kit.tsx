import React from "react";
import { choose, useLanguage } from "../i18n.js";
import { localDigits } from "./fmt.js";
import {
  CategoryIcon,
  categoryLabel,
  categoryTintClass,
} from "../service-categories.js";
import "./tokens.css";
import "./kit.css";
import "../service-icons.css";

/** Phase 1 component kit. Small, presentational, no data fetching; pages compose them. */

/**
 * REFINEMENT-02 P1-7: the catalogue card metadata line. Fees are set per
 * office (never invented here), and the document-upload count comes from
 * the service's operational schema (merged into the public catalog).
 */
export function serviceCardMeta(documentCount?: number): { bn: string; en: string } {
  const fee = { bn: "ফি: অফিস অনুযায়ী", en: "Fee: set by each office" };
  if (!documentCount || documentCount < 1) return fee;
  return {
    bn: `${fee.bn} · প্রয়োজনীয় নথি: ${localDigits(documentCount, "bn")}টি`,
    en: `${fee.en} · documents needed: ${documentCount}`,
  };
}

/** Taka from integer minor units (same integer math as ServicePriceList's
 *  taka(), but returns both languages instead of choosing one). */
function takaPair(minor: number): { bn: string; en: string } {
  const en = `৳${Math.trunc(minor / 100).toLocaleString("en-IN")}${minor % 100 ? `.${String(minor % 100).padStart(2, "0")}` : ""}`;
  return { bn: localDigits(en, "bn"), en };
}

/**
 * BUNDLE06-R5 C2: the catalogue card metadata line with real published
 * facts. When at least one office has published a fee policy for the
 * service, the card shows the fee (a range when offices differ), the
 * citizen-charter time and the document-upload count. When no office has
 * published yet, the card says exactly that — no filler.
 */
export function serviceCardMetaRich(
  documentCount: number | undefined,
  summary?: {
    feeMinMinor: number;
    feeMaxMinor: number;
    daysMin: number | null;
    daysMax: number | null;
  } | null,
): { bn: string; en: string } {
  const docs =
    documentCount && documentCount >= 1
      ? {
          bn: `প্রয়োজনীয় নথি: ${localDigits(documentCount, "bn")}টি`,
          en: `documents needed: ${documentCount}`,
        }
      : null;
  if (!summary) {
    // HOME-REDESIGN-01: "not yet published by any office" on every card
    // read as an empty platform. The fact that matters to the citizen is
    // who sets the fee; the exact figure appears once the office publishes.
    const base = {
      bn: "ফি ও সময়: আপনার ইউনিয়ন অফিস নির্ধারণ করে",
      en: "Fee & time: set by your union office",
    };
    return docs
      ? { bn: `${base.bn} · ${docs.bn}`, en: `${base.en} · ${docs.en}` }
      : base;
  }
  const feeLo = takaPair(summary.feeMinMinor);
  const feeHi = takaPair(summary.feeMaxMinor);
  const fee =
    summary.feeMinMinor === summary.feeMaxMinor
      ? { bn: `ফি ${feeLo.bn}`, en: `Fee ${feeLo.en}` }
      : {
          bn: `ফি ${feeLo.bn}–${feeHi.bn}`,
          en: `Fee ${feeLo.en}–${feeHi.en}`,
        };
  const parts = [fee];
  if (summary.daysMin != null && summary.daysMax != null) {
    parts.push(
      summary.daysMin === summary.daysMax
        ? {
            bn: `সময় ${localDigits(summary.daysMin, "bn")} দিন`,
            en: `${summary.daysMin} days`,
          }
        : {
            bn: `সময় ${localDigits(summary.daysMin, "bn")}–${localDigits(summary.daysMax, "bn")} দিন`,
            en: `${summary.daysMin}–${summary.daysMax} days`,
          },
    );
  }
  if (docs) parts.push(docs);
  return {
    bn: parts.map((p) => p.bn).join(" · "),
    en: parts.map((p) => p.en).join(" · "),
  };
}

export function TitleBand({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section className="ax-title-band">
      <div className="ax-container">
        {eyebrow && <span className="ax-eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {children}
      </div>
    </section>
  );
}

export function StatCard({
  value,
  label,
  context,
  icon,
}: {
  value: React.ReactNode;
  label: React.ReactNode;
  /** FULL-UIUX-01 programme 12: one context line under the label. */
  context?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="ax-stat">
      {icon && <span className="ax-stat-icon" aria-hidden="true">{icon}</span>}
      {/* REFINEMENT-02 P1-3: label top, value at display size, context
          line — the shared StatCard form on every dashboard. */}
      <span className="ax-stat-label">{label}</span>
      <strong>{value}</strong>
      {context && <small className="ax-stat-context">{context}</small>}
    </div>
  );
}

export function ServiceTile({
  number,
  name,
  href,
  icon,
}: {
  number: number;
  name: React.ReactNode;
  href: string;
  icon?: React.ReactNode;
}) {
  return (
    <a className="ax-tile" href={href} data-service={number}>
      <span className="ax-tile-number" aria-hidden="true">
        {number}
      </span>
      {icon && <span className="ax-tile-icon">{icon}</span>}
      <span className="ax-tile-name">{name}</span>
    </a>
  );
}

export function RailPanel({
  title,
  children,
  id,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  id?: string;
}) {
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <section className="ax-rail-panel" aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      {children}
    </section>
  );
}

export function StatusPill({ children }: { children: React.ReactNode }) {
  return <span className="ax-pill">{children}</span>;
}

/**
 * FULL-UIUX-01 (programme 16/51, checklist B16): the one status language for
 * applications. A fixed state → localised label + tone map; the rendering
 * layer has no path that can print a raw enum — an unmapped state falls back
 * to a plain "recorded" label rather than the system word.
 */
const APPLICATION_STATUS: Record<
  string,
  { bn: string; en: string; tone: "ok" | "approved" | "warn" | "danger" | "neutral" | "info" }
> = {
  DRAFT: { bn: "খসড়া", en: "Draft", tone: "neutral" },
  // PP-1 (L8): submitted green, approved/issued purple, rejected red.
  SUBMITTED: { bn: "জমা দেওয়া", en: "Submitted", tone: "ok" },
  UNDER_REVIEW: { bn: "পর্যালোচনাধীন", en: "Under review", tone: "warn" },
  CORRECTION_REQUIRED: { bn: "সংশোধন প্রয়োজন", en: "Correction needed", tone: "danger" },
  RESUBMITTED: { bn: "পুনরায় জমা দেওয়া", en: "Resubmitted", tone: "ok" },
  APPROVED: { bn: "অনুমোদিত", en: "Approved", tone: "approved" },
  ISSUANCE_PENDING: { bn: "সনদ ইস্যুর অপেক্ষায়", en: "Awaiting issuance", tone: "warn" },
  ISSUED: { bn: "সনদ ইস্যু হয়েছে", en: "Certificate issued", tone: "approved" },
  REJECTED: { bn: "প্রত্যাখ্যাত", en: "Rejected", tone: "danger" },
  CANCELLED: { bn: "বাতিল", en: "Cancelled", tone: "neutral" },
  REVOKED: { bn: "প্রত্যাহৃত", en: "Revoked", tone: "danger" },
};

export function applicationStatusMeta(state: string | null | undefined) {
  return APPLICATION_STATUS[String(state ?? "").toUpperCase()] ?? null;
}

export function ApplicationStatus({ state }: { state: string | null | undefined }) {
  const meta = applicationStatusMeta(state);
  return (
    <span className={`ax-status tone-${meta?.tone ?? "neutral"}`}>
      {meta ? choose(meta) : choose({ bn: "নথিভুক্ত", en: "Recorded" })}
    </span>
  );
}

/**
 * FULL-UIUX-01 (D51): credit-ledger kinds get the same treatment — a fixed
 * localised map; an unmapped kind renders as a plain "credit entry", never
 * the raw system word (APPLICATION_FEE / PLAN_GRANT / ADJUSTMENT).
 */
const LEDGER_KINDS: Record<string, { bn: string; en: string }> = {
  APPLICATION_FEE: { bn: "আবেদনের ফি", en: "Application fee" },
  PLAN_GRANT: { bn: "প্ল্যানের ক্রেডিট", en: "Plan credit grant" },
  ADJUSTMENT: { bn: "সমন্বয়", en: "Adjustment" },
  TOPUP: { bn: "টপ-আপ", en: "Top-up" },
  SUBSCRIPTION: { bn: "সাবস্ক্রিপশন", en: "Subscription" },
  REFUND: { bn: "ফেরত", en: "Refund" },
  RECHARGE: { bn: "রিচার্জ", en: "Recharge" },
};

export function ledgerKindMeta(kind: string | null | undefined) {
  return (
    LEDGER_KINDS[String(kind ?? "").toUpperCase()] ?? {
      bn: "ক্রেডিট এন্ট্রি",
      en: "Credit entry",
    }
  );
}

/**
 * REFINEMENT-02 P1-4: system-written ledger reasons are English strings in
 * the data; they are mapped at display time (the ledgerKindMeta pattern).
 * Owner/office-entered free text is not in the map and renders as written.
 */
const LEDGER_REASONS: Record<string, { bn: string; en: string }> = {
  "Application submission fee": {
    bn: "আবেদন জমার ফি",
    en: "Application submission fee",
  },
  "Initial credit grant": {
    bn: "প্রাথমিক ক্রেডিট অনুদান",
    en: "Initial credit grant",
  },
  "Plan credit grant": { bn: "প্ল্যানের ক্রেডিট অনুদান", en: "Plan credit grant" },
  "Subscription credit grant": {
    bn: "সাবস্ক্রিপশনের ক্রেডিট অনুদান",
    en: "Subscription credit grant",
  },
  "Manual adjustment": { bn: "ম্যানুয়াল সমন্বয়", en: "Manual adjustment" },
  "Credit top-up": { bn: "ক্রেডিট টপ-আপ", en: "Credit top-up" },
};
export function ledgerReasonText(reason: string | null | undefined): string {
  const raw = String(reason ?? "");
  const meta = LEDGER_REASONS[raw];
  return meta ? choose(meta) : raw;
}

/** REFINEMENT-02 P1-4: seeded plan names localised at display time. */
const PLAN_NAMES: Record<string, { bn: string; en: string }> = {
  "Standard Monthly": { bn: "স্ট্যান্ডার্ড মাসিক", en: "Standard Monthly" },
};
export function planNameText(name: string | null | undefined): string {
  const raw = String(name ?? "");
  const meta = PLAN_NAMES[raw];
  return meta ? choose(meta) : raw;
}

/** REFINEMENT-02 P1-4: certificate-asset history actions (raw enums leaked). */
const ASSET_ACTIONS: Record<string, { bn: string; en: string }> = {
  UPLOADED: { bn: "আপলোড হয়েছে", en: "Uploaded" },
  REPLACED: { bn: "বদলানো হয়েছে", en: "Replaced" },
  REMOVED: { bn: "সরানো হয়েছে", en: "Removed" },
  DELETED: { bn: "মুছে ফেলা হয়েছে", en: "Deleted" },
};
export function assetActionMeta(action: string | null | undefined) {
  return (
    ASSET_ACTIONS[String(action ?? "").toUpperCase()] ?? {
      bn: "পরিবর্তন হয়েছে",
      en: "Changed",
    }
  );
}

/**
 * The public 16-digit reference as a copyable chip (programme 14): digits are
 * localised for display; the copy action always copies the canonical form.
 */
export function RefChip({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = React.useState(false);
  const canonical = String(value).replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d)));
  return (
    <span className="ax-refchip">
      {label && <span className="ax-refchip-label">{label}</span>}
      <code>{localDigits(canonical, useLanguage()[0])}</code>
      <button
        type="button"
        className="ax-refchip-copy"
        aria-label={choose({ bn: "রেফারেন্স কপি করুন", en: "Copy reference" })}
        onClick={() => {
          const done = () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          };
          if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(canonical).then(done).catch(done);
          } else {
            done();
          }
        }}
      >
        {copied ? "✓" : "⧉"}
      </button>
      {copied && (
        <span className="ax-refchip-done" role="status">
          {choose({ bn: "কপি হয়েছে", en: "Copied" })}
        </span>
      )}
    </span>
  );
}

/**
 * FULL-UIUX-01 (programme 6, checklist A7): ONE service card in three
 * densities — tile (grids), row (lists/pickers), compact (related services).
 * Category medallion + category eyebrow come from the shared category system.
 */
export function ServiceCard({
  serviceNo,
  name,
  category,
  variant = "tile",
  href,
  onClick,
  onNavigate,
  feeHint,
  status,
  disabled,
}: {
  serviceNo: number;
  name: React.ReactNode;
  category: string;
  variant?: "tile" | "row" | "compact";
  href?: string;
  onClick?: () => void;
  /** SPA interception for the anchor variant (the href stays canonical). */
  onNavigate?: (event: React.MouseEvent) => void;
  feeHint?: React.ReactNode;
  status?: React.ReactNode;
  disabled?: boolean;
}) {
  const content = (
    <>
      <span className={`svc-medallion ${categoryTintClass(category)}`}>
        <CategoryIcon category={category} />
      </span>
      <span className="svc-card-text">
        {/* REFINEMENT-02 P1-7: the eyebrow carries the service number —
            known data that aids wayfinding in a 47-card grid. */}
        <span className="svc-card-category">
          {choose({ bn: "সেবা", en: "Service" })} {localDigits(serviceNo, useLanguage()[0])} ·{" "}
          {choose(categoryLabel(category))}
        </span>
        <strong className="svc-card-name">{name}</strong>
        {feeHint && <span className="svc-card-fee">{feeHint}</span>}
      </span>
      {status}
    </>
  );
  const className = `svc-card svc-${variant}`;
  if (href)
    return (
      <a className={className} href={href} data-service={serviceNo} onClick={onNavigate}>
        {content}
      </a>
    );
  if (onClick)
    return (
      <button type="button" className={className} data-service={serviceNo} onClick={onClick} disabled={disabled}>
        {content}
      </button>
    );
  return (
    <div className={className} data-service={serviceNo}>
      {content}
    </div>
  );
}

/**
 * FULL-UIUX-01 (programme 19, checklist B23): the styled upload control that
 * replaces every native file input — dashed dropzone, Bangla instruction,
 * selected-file chip with remove. The caller owns the actual upload logic.
 */
export function UploadField({
  id,
  label,
  hint,
  fileName,
  onPick,
  onClear,
  accept,
}: {
  id: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  fileName?: string | null;
  onPick: (file: File | null) => void;
  onClear?: () => void;
  accept?: string;
}) {
  return (
    <div className="ax-upload">
      <span className="ax-upload-label" id={`${id}-label`}>
        {label}
      </span>
      {fileName ? (
        <div className="ax-upload-file">
          <span className="ax-upload-file-name">{fileName}</span>
          {onClear && (
            <button type="button" className="text-button" onClick={onClear}>
              {choose({ bn: "সরান", en: "Remove" })}
            </button>
          )}
        </div>
      ) : (
        <label className="ax-upload-zone" htmlFor={id}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 16V5m0 0-4 4m4-4 4 4" />
            <path d="M4 17v1.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V17" />
          </svg>
          <span>{choose({ bn: "ফাইল বেছে নিন বা এখানে ছেড়ে দিন", en: "Choose a file or drop it here" })}</span>
          {hint && <small>{hint}</small>}
        </label>
      )}
      <input
        id={id}
        type="file"
        accept={accept}
        className="ax-upload-input"
        aria-labelledby={`${id}-label`}
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}

/**
 * The one empty-state treatment (UIUX-FIX-01 #14): an icon, one line saying
 * what happened, an optional hint, and the primary recovery action. Replaces
 * the former .empty-state / .ax-home-empty / .service-empty /
 * .application-empty / .ax-dashboard-empty variants.
 */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="ax-empty-state">
      <span className="ax-empty-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="M15.5 15.5 21 21" />
        </svg>
      </span>
      <h3>{title}</h3>
      {hint && <p>{hint}</p>}
      {action}
    </div>
  );
}

/** Shimmer placeholder rows shown while a table or list is loading. */
export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="ax-skeleton" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div className="ax-skeleton-row" key={i} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

/** Numbered progress indicator for multi-step flows; the current step is announced as such.
 *  FULL-UIUX-01 (checklist C39): on phones the chip row collapses to a
 *  "ধাপ N / ৫ — <name>" line plus a progress bar — step names never truncate
 *  to a single character again. */
export function Stepper({
  steps,
  current,
  label,
}: {
  steps: readonly React.ReactNode[];
  current: number;
  label: string;
}) {
  const [language] = useLanguage();
  const total = steps.length;
  const percent = total > 1 ? Math.round(((current + 1) / total) * 100) : 100;
  return (
    <div className="ax-stepper-wrap">
      <p className="ax-stepper-summary" aria-hidden="true">
        {choose({ bn: "ধাপ", en: "Step" })}{" "}
        {localDigits(current + 1, language)} / {localDigits(total, language)} —{" "}
        {steps[current]}
      </p>
      <div className="ax-stepper-progress" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>
      <ol className="ax-stepper" aria-label={label}>
        {steps.map((step, index) => (
          <li
            key={index}
            className={index < current ? "is-done" : index === current ? "is-current" : undefined}
            aria-current={index === current ? "step" : undefined}
          >
            <span className="ax-step-number" aria-hidden="true">
              {index < current ? "✓" : localDigits(index + 1, language)}
            </span>
            <span className="ax-step-label">{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
