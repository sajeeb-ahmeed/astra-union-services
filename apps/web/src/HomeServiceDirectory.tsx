import React, { useMemo, useState } from "react";
import { choose, useLanguage } from "./i18n.js";
import serviceCatalog from "./service-catalog.js";
import { CategoryIcon, categoryLabel, categoryTintClass } from "./service-categories.js";
import { servicePath } from "./service-slugs.js";
import { localDigits } from "./ui/fmt.js";
import "./home-directory.css";

const FIRST_ROWS = 18;

/**
 * HOME-REDESIGN-02: every service on the homepage, the way citizens expect
 * a service portal to work — one glance at all of them, narrowed by
 * category tabs or by typing. The first 18 show at rest; the rest open in
 * place, so the page stays scannable.
 */
export function HomeServiceDirectory({
  showCategories = true,
}: {
  /** PORTAL-A: the homepage shows icons + one filter box only; category
      browsing lives on /services. */
  showCategories?: boolean;
} = {}) {
  const [lang] = useLanguage();
  const [category, setCategory] = useState<string>("all");
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState(false);
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of serviceCatalog) counts.set(s.category_en, (counts.get(s.category_en) ?? 0) + 1);
    return [...counts.entries()];
  }, []);
  const needle = filter
    .trim()
    .replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d)))
    .toLowerCase()
    .normalize("NFC");
  const matches = serviceCatalog.filter(
    (s) =>
      (category === "all" || s.category_en === category) &&
      (!needle ||
        `${s.service_no} ${s.name_bn} ${s.name_en}`.toLowerCase().normalize("NFC").includes(needle)),
  );
  // Narrowing (a tab or a search) always shows every match.
  const narrowed = category !== "all" || !!needle;
  const shown = expanded || narrowed ? matches : matches.slice(0, FIRST_ROWS);
  return (
    <div className="hsd">
      <div className="hsd-controls">
        {showCategories && (
          <div className="hsd-tabs" role="tablist" aria-label={choose({ bn: "বিভাগ", en: "Category" })}>
            {[["all", serviceCatalog.length] as [string, number], ...categories].map(([c, n]) => (
              <button
                key={c}
                type="button"
                role="tab"
                aria-selected={category === c}
                className={`hsd-tab${category === c ? " is-active" : ""}`}
                onClick={() => setCategory(c)}
              >
                {c === "all" ? choose({ bn: "সব সেবা", en: "All" }) : choose(categoryLabel(c))}
                <span className="hsd-count">{localDigits(n, lang)}</span>
              </button>
            ))}
          </div>
        )}
        <label className="hsd-filter">
          <span className="sr-only">{choose({ bn: "সেবার তালিকায় খুঁজুন", en: "Filter services" })}</span>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4 4" />
          </svg>
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={choose({ bn: "এই তালিকায় খুঁজুন", en: "Filter this list" })}
          />
        </label>
      </div>
      <p className="hsd-status" role="status">
        {choose({
          bn: `${localDigits(matches.length, "bn")}টি সেবা`,
          en: `${matches.length} services`,
        })}
      </p>
      {matches.length ? (
        <ul className="hsd-grid">
          {shown.map((s) => (
            <li key={s.service_no}>
              <a className="hsd-tile" href={servicePath(s.service_no)}>
                <span className={`hsd-icon ${categoryTintClass(s.category_en)}`}>
                  <CategoryIcon category={s.category_en} />
                </span>
                <span className="hsd-name">{choose({ bn: s.name_bn, en: s.name_en })}</span>
                <span className="hsd-apply" aria-hidden="true">
                  {choose({ bn: "আবেদন", en: "Apply" })}
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <div className="hsd-empty">
          <p>
            {choose({
              bn: "এই নামে কোনো সেবা পাওয়া যায়নি। অন্য শব্দে খুঁজুন বা সব সেবা দেখুন।",
              en: "No service matches that. Try another word or show all services.",
            })}
          </p>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setFilter("");
              setCategory("all");
            }}
          >
            {choose({ bn: "সব সেবা দেখুন", en: "Show all services" })}
          </button>
        </div>
      )}
      {!narrowed && matches.length > FIRST_ROWS && (
        <button
          type="button"
          className="secondary hsd-more"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded
            ? choose({ bn: "কম দেখুন", en: "Show fewer" })
            : choose({
                bn: `সব ${localDigits(matches.length, "bn")}টি সেবা দেখুন`,
                en: `Show all ${matches.length} services`,
              })}
        </button>
      )}
    </div>
  );
}

/**
 * HOME-REDESIGN-02: office notices as a single moving line under the
 * header — the familiar notice-board strip of public service sites. It
 * pauses on hover/focus and stays still for reduced-motion users.
 */
export function NoticeTicker({ notices }: { notices: any[] }) {
  useLanguage();
  if (!notices.length) return null;
  const items = notices.map((n) => ({
    id: n.id,
    title: choose({ bn: n.titleBn, en: n.titleEn }),
    office: choose({ bn: n.officeBn, en: n.officeEn }) || choose({ bn: "প্ল্যাটফর্ম", en: "Platform" }),
  }));
  return (
    <div className="ntk" role="region" aria-label={choose({ bn: "সর্বশেষ বিজ্ঞপ্তি", en: "Latest notices" })}>
      <div className="du-container ntk-row">
        <a className="ntk-label" href="/notices">
          {choose({ bn: "বিজ্ঞপ্তি", en: "Notices" })}
        </a>
        <div className="ntk-track">
          <ul className="ntk-list">
            {[...items, ...items].map((n, i) => (
              <li key={`${n.id}-${i}`} aria-hidden={i >= items.length ? true : undefined}>
                <a href="/notices" tabIndex={i >= items.length ? -1 : undefined}>
                  <strong>{n.office}</strong> {n.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
        <a className="ntk-all" href="/notices">
          {choose({ bn: "সব দেখুন", en: "View all" })}
        </a>
      </div>
    </div>
  );
}
