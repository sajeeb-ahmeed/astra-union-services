import React from "react";

/**
 * FULL-UIUX-01 (checklist A6 / programme 7): a category icon & colour
 * language for the 47 services. Ten categories, each with its own drawn
 * 1.5px-stroke icon and a soft tint; the old 3-glyph rotation (bank / person
 * / document dealt at random) is retired. Icons are decorative — the service
 * name always carries the meaning in text.
 */
export const CATEGORY_LABELS: Record<string, { bn: string; en: string }> = {
  "Property and local taxation": { bn: "সম্পত্তি ও স্থানীয় কর", en: "Property and local taxation" },
  "Family and civil status": { bn: "পারিবারিক ও নাগরিক অবস্থা", en: "Family and civil status" },
  "Identity and citizenship": { bn: "পরিচয় ও নাগরিকত্ব", en: "Identity and citizenship" },
  "Voter and identity records": { bn: "ভোটার ও পরিচয় নথি", en: "Voter and identity records" },
  "Occupation and economic status": { bn: "পেশা ও অর্থনৈতিক অবস্থা", en: "Occupation and economic status" },
  "Community and social status": { bn: "সামাজিক অবস্থা", en: "Community and social status" },
  "Consent and authorization": { bn: "সম্মতি ও অনুমোদন", en: "Consent and authorization" },
  Licensing: { bn: "লাইসেন্স", en: "Licensing" },
  Utilities: { bn: "ইউটিলিটি সেবা", en: "Utilities" },
  Miscellaneous: { bn: "বিবিধ", en: "Miscellaneous" },
};

export const categoryLabel = (category: string): { bn: string; en: string } =>
  CATEGORY_LABELS[category] ?? { bn: category, en: category };

const PATHS: Record<string, React.ReactNode> = {
  "Property and local taxation": (
    <>
      <path d="M4 11 12 4l8 7" />
      <path d="M6.5 9.5V20h11V9.5" />
      <circle cx="12" cy="14.5" r="2.6" />
      <path d="M12 12.8v3.4M10.9 13.6h1.7a1 1 0 0 1 0 2h-1.4" />
    </>
  ),
  "Family and civil status": (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20v-1.5A5.5 5.5 0 0 1 9 13a5.5 5.5 0 0 1 5.5 5.5V20" />
      <circle cx="17" cy="9.5" r="2.4" />
      <path d="M16 13.6a4.8 4.8 0 0 1 4.5 4.9V20" />
    </>
  ),
  "Identity and citizenship": (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <circle cx="8.6" cy="11" r="2" />
      <path d="M5.8 16.2a3 3 0 0 1 5.6 0M14.5 9.5H18M14.5 12.5H18M14.5 15.5h2.5" />
    </>
  ),
  "Voter and identity records": (
    <>
      <path d="M5 10.5h14l-1.2 9.5H6.2L5 10.5Z" />
      <path d="M9.5 10.5 11 13l4.5-6" />
      <path d="M4 20.5h16" />
    </>
  ),
  "Occupation and economic status": (
    <>
      <rect x="3.5" y="7.5" width="17" height="12" rx="2" />
      <path d="M9 7.5V6a3 3 0 0 1 6 0v1.5M3.5 12.5h17M12 11v3" />
    </>
  ),
  "Community and social status": (
    <>
      <path d="M12 20s-6.5-4.1-8.3-8A5 5 0 0 1 12 6.4 5 5 0 0 1 20.3 12c-1.8 3.9-8.3 8-8.3 8Z" />
    </>
  ),
  "Consent and authorization": (
    <>
      <path d="M7 3.5h7L19 8v12.5H7z" />
      <path d="M13.5 3.5V8H19" />
      <path d="m9.8 15.8 1.8 1.8 3.4-3.8" />
    </>
  ),
  Licensing: (
    <>
      <circle cx="12" cy="10" r="5.5" />
      <path d="m9.8 14.8-1.3 5.7 3.5-2 3.5 2-1.3-5.7M9.7 10l1.7 1.7 3-3.2" />
    </>
  ),
  Utilities: (
    <>
      <path d="M12 3.5s6 6.6 6 10.6a6 6 0 0 1-12 0C6 10.1 12 3.5 12 3.5Z" />
      <path d="M12.8 10.5 10.4 14h2l-1.2 3.5 3.4-4.2h-2.2l1.4-2.8Z" />
    </>
  ),
  Miscellaneous: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
};

const FALLBACK = PATHS["Miscellaneous"];

/** Tint class per category (soft background + deep ink), defined in kit.css. */
export const categoryTintClass = (category: string): string => {
  const index = Object.keys(CATEGORY_LABELS).indexOf(category);
  return `cat-tint-${index >= 0 ? index : 9}`;
};

export function CategoryIcon({ category }: { category: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="26"
      height="26"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[category] ?? FALLBACK}
    </svg>
  );
}
