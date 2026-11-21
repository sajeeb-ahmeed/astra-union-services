import React, { type ReactNode } from "react";
import { useLanguage } from "./i18n.js";

/**
 * OWNER-REDESIGN-01: shared presentation primitives for the platform
 * management console — one status badge and one empty state, reused by every
 * owner section so statuses and empty lists look identical everywhere.
 * Presentation only: these render values the caller already has.
 */
export type BadgeTone = "ok" | "warn" | "danger" | "neutral" | "info";

export function StatusBadge({
  tone = "neutral",
  children,
}: {
  tone?: BadgeTone;
  children: ReactNode;
}) {
  useLanguage();
  return <span className={`status-badge tone-${tone}`}>{children}</span>;
}

/** Map a raw platform status word to a badge tone. */
export function statusTone(status: string | undefined | null): BadgeTone {
  switch (String(status ?? "").toUpperCase()) {
    case "ACTIVE":
    case "APPROVED":
    case "SETTLED":
    case "LIVE":
      return "ok";
    case "PENDING":
    case "SCHEDULED":
      return "warn";
    case "SUSPENDED":
    case "REJECTED":
    case "CANCELLED":
      return "danger";
    case "EXPIRED":
      return "neutral";
    default:
      return "neutral";
  }
}

/**
 * Designed empty state: a small mark, a heading line and one line of text,
 * plus the relevant action where the caller has one. Replaces the plain
 * one-sentence paragraphs the sections used before the redesign.
 */
export function EmptyState({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children?: ReactNode;
}) {
  useLanguage();
  return (
    <div className="empty-state owner-empty">
      <svg
        className="owner-empty-mark"
        width="30"
        height="30"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M3.5 9h17" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8 14.5h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <p className="owner-empty-title">{title}</p>
      {hint && <p className="owner-empty-hint">{hint}</p>}
      {children}
    </div>
  );
}
