import React from "react";
import { choose, useLanguage } from "./i18n.js";
import "./brand-lockup.css";

/**
 * FULL-UIUX-01 · OWNER-DECISION 4 (AD-S3): ONE clean typographic logo lockup
 * for the DigitalUnion platform, replacing the clip-art lockup image on
 * platform surfaces (public header/footer, auth, workspace shells, owner
 * console). The mark is a geometric roof line over a folded document — a
 * union office and its certificate — drawn in the existing green system.
 * Office/UP logos and certificate headers are a separate track and are NOT
 * touched by this component. The old asset files stay in place.
 */
export function BrandMark({
  size = 40,
  tone = "brand",
}: {
  size?: number;
  tone?: "brand" | "light";
}) {
  return (
    <svg
      className={`brand-mark tone-${tone}`}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      <rect className="brand-mark-bg" width="48" height="48" rx="11" />
      <path
        className="brand-mark-roof"
        d="M10 19.5 24 9l14 10.5"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        className="brand-mark-doc"
        d="M17 22.5h9.2L31 27.3V38H17z"
        strokeWidth="2.6"
        strokeLinejoin="round"
      />
      <path
        className="brand-mark-fold"
        d="M26 22.5v5h5"
        strokeWidth="2.6"
        strokeLinejoin="round"
      />
      <path
        className="brand-mark-line"
        d="M20.5 31.5h7.5M20.5 34.8h5"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * REFINEMENT-02 P2-12 — THE brand lockup spec (the only sizes allowed):
 *   header  46px mark — public header, login brand panel (hero surfaces)
 *   sidebar 38px mark — workspace sidebar AND the owner strip (one size
 *                       for every signed-in shell surface)
 *   footer  40px mark — public footer, always with the tagline
 * The wordmark scales WITH the mark per size (brand-lockup.css keys off
 * data-lockup), so the lockup is one artwork at three sizes — never a
 * fixed wordmark beside a resized mark.
 */
export const BRAND_LOCKUP_SIZES = {
  header: 46,
  sidebar: 38,
  footer: 40,
} as const;

export function BrandLockup({
  size = 40,
  tone = "brand",
  tagline = false,
}: {
  size?: number;
  tone?: "brand" | "light";
  tagline?: boolean;
}) {
  useLanguage();
  const spec =
    size >= BRAND_LOCKUP_SIZES.header
      ? "header"
      : size >= BRAND_LOCKUP_SIZES.footer
        ? "footer"
        : "sidebar";
  return (
    <span className={`brand-lockup tone-${tone}`} data-lockup={spec}>
      <BrandMark size={size} tone={tone} />
      <span className="brand-lockup-words">
        <strong className="brand-lockup-bn">ডিজিটাল ইউনিয়ন</strong>
        <span className="brand-lockup-en">DIGITALUNION</span>
        {tagline && (
          <small className="brand-lockup-tag">
            {choose({ bn: "স্মার্ট ইউনিয়ন, স্মার্ট বাংলাদেশ", en: "Smart Union, Smart Bangladesh" })}
          </small>
        )}
      </span>
    </span>
  );
}
