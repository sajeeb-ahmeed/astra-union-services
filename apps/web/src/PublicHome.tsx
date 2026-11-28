import React, { useEffect, useMemo, useState } from "react";
import { api, items } from "./api.js";
import { choose, useLanguage } from "./i18n.js";
import serviceCatalog from "./service-catalog.js";
import { PublicShell } from "./PublicShell.js";
import { PublicOffers } from "./GlobalNotices.js";
import { categoryLabel } from "./service-categories.js";
import { servicePath } from "./service-slugs.js";
import { NoticeTicker } from "./HomeServiceDirectory.js";
import { HOTLINES, POPULAR_SERVICES, PORTAL_GROUPS, type PortalGroup } from "./portal-groups.js";
import "./public-home.css";
import "./portal-home.css";

import { certificateNumberInput, verificationToken } from "./verify-input.js";
import { HOME_SEO } from "./seo/service-seo.js";
import { applyPageHead } from "./seo/head.js";
import { navigate } from "./navigate.js";
import { useWitnessAvailable } from "./witness-availability.js";

export { certificateNumberInput, verificationToken } from "./verify-input.js";

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const digits = (value: number | string, lang: string) =>
  lang === "bn" ? String(value).replace(/\d/g, (d) => BN_DIGITS[Number(d)]) : String(value);

/* Small stroke icons (decorative; the text always carries the meaning). */
const ICONS: Record<string, React.ReactNode> = {
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  clipboard: (
    <>
      <rect x="6" y="4.5" width="12" height="16" rx="1.5" />
      <path d="M9.5 4.5h5v2.5h-5zM9 11h6M9 14.5h6M9 18h3.5" />
    </>
  ),
  qr: (
    <>
      <rect x="4" y="4" width="6" height="6" />
      <rect x="14" y="4" width="6" height="6" />
      <rect x="4" y="14" width="6" height="6" />
      <path d="M14 14h2v2h-2zM18 14h2M14 18h2v2M18 18h2v2" />
    </>
  ),
  user: (
    <>
      <circle cx="10" cy="8" r="3.5" />
      <path d="M3.5 20a6.5 6.5 0 0 1 13 0M18.5 8.5v5M16 11h5" />
    </>
  ),
  login: (
    <>
      <path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14" />
      <path d="M10 8l4 4-4 4M14 12H4" />
    </>
  ),
  files: (
    <>
      <path d="M8 3.5h7l4 4V18a1.5 1.5 0 0 1-1.5 1.5h-9.5A1.5 1.5 0 0 1 6.5 18V5A1.5 1.5 0 0 1 8 3.5Z" />
      <path d="M14.5 3.5V8H19M9.5 12h6M9.5 15.5h4" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2" />
      <path d="M11 18.5h2" />
    </>
  ),
  pdf: (
    <>
      <path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5Z" />
      <path d="M13.5 3.5V8H18M12 11v6M9.5 14.5 12 17l2.5-2.5" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15L6 16.5Z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </>
  ),
  siren: (
    <>
      <path d="M6 18v-6a6 6 0 0 1 12 0v6M4 18h16v2.5H4z" />
      <path d="M12 3V1.5M4.5 6 3.4 4.9M19.5 6l1.1-1.1" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.8-2.4 2.2-2.4 3.8M12 17h.01" />
    </>
  ),
  book: (
    <>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 0 4 20.5v-15ZM20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5a1.5 1.5 0 0 1 1.5 1.5v-15Z" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11Z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  building: (
    <>
      <path d="M4 20.5h16M6 20.5V9l6-4.5 6 4.5v11.5" />
      <path d="M9.5 20.5v-5h5v5M9.5 11h1M13.5 11h1" />
    </>
  ),
  check: <path d="m6 12.5 4 4 8-9" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  license: (
    <>
      <rect x="4" y="3.5" width="16" height="17" rx="1.5" />
      <path d="M8 8h8M8 11.5h8M8 15h4.5" />
    </>
  ),
  family: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20v-1.5A5.5 5.5 0 0 1 9 13a5.5 5.5 0 0 1 5.5 5.5V20" />
      <circle cx="17" cy="9.5" r="2.4" />
      <path d="M16 13.6a4.8 4.8 0 0 1 4.5 4.9V20" />
    </>
  ),
  marriage: (
    <>
      <path d="M12 20s-7-4.4-7-9.6A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.4C19 15.6 12 20 12 20Z" />
    </>
  ),
  identity: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <circle cx="8.6" cy="11" r="2" />
      <path d="M5.8 16.2a3 3 0 0 1 5.6 0M14.5 9.5H18M14.5 12.5H18" />
    </>
  ),
  voter: (
    <>
      <path d="M5 10.5h14l-1.2 9.5H6.2L5 10.5Z" />
      <path d="M9.5 10.5 11 13l4.5-6M4 20.5h16" />
    </>
  ),
  income: (
    <>
      <rect x="3.5" y="7.5" width="17" height="12" rx="2" />
      <path d="M9 7.5V6a3 3 0 0 1 6 0v1.5M3.5 12.5h17M12 11v3" />
    </>
  ),
  other: (
    <>
      <path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5Z" />
      <path d="M13.5 3.5V8H18M9 13h6M9 16.5h4" />
    </>
  ),
};
function Icon({ name, size = 20 }: { name: keyof typeof ICONS | string; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

/** Platform facts shown on the notice board when no office has published a notice. */
const PLATFORM_NOTICES = [
  {
    bn: "সনদের আবেদন এখন সম্পূর্ণ অনলাইনে, ইউনিয়ন পরিষদ অফিসে লাইন দিতে হবে না।",
    en: "Certificate applications are now fully online — no queue at the Union Parishad office.",
  },
  {
    bn: "প্রতিটি সনদে QR কোড থাকে, সনদ নম্বর বা QR লিংক দিয়ে যেকোনো সময় বিনামূল্যে যাচাই করুন।",
    en: "Every certificate carries a QR code — verify it any time, free, by number or QR link.",
  },
  {
    bn: "আবেদন জমার পর রেফারেন্স নম্বর সংরক্ষণ করুন, এই নম্বর দিয়ে আবেদনের অবস্থা জানা যাবে।",
    en: "Keep the reference number you get after applying — it shows your application's status.",
  },
  {
    bn: "চেয়ারম্যানের যাচাই শেষে সনদ বাংলা ও ইংরেজি PDF আকারে ডাউনলোড করা যাবে।",
    en: "After the Chairman's review, download the certificate as Bangla and English PDFs.",
  },
  {
    bn: "ইউনিয়ন পরিষদ অফিসগুলো অফিস অ্যাকাউন্ট খুলে প্ল্যাটফর্মে যুক্ত হতে পারবে।",
    en: "Union Parishad offices can join the platform by opening an office account.",
  },
];

const FEATURES = [
  { icon: "files", bn: "৪৭টি সনদ ও প্রত্যয়ন", en: "47 certificates", dBn: "ইউনিয়ন পরিষদের সব সেবা এক জায়গায়", dEn: "Every Union Parishad service in one place" },
  { icon: "phone", bn: "ঘরে বসে আবেদন", en: "Apply from home", dBn: "মোবাইল থেকেই ফরম পূরণ ও নথি জমা", dEn: "Fill the form and attach documents from your phone" },
  { icon: "qr", bn: "QR যাচাইযোগ্য সনদ", en: "QR-verifiable certificates", dBn: "চেয়ারম্যানের ইস্যু করা, জাল করা কঠিন", dEn: "Issued by the Chairman, hard to forge" },
  { icon: "pdf", bn: "বাংলা ও ইংরেজি PDF", en: "Bangla & English PDF", dBn: "অনুমোদনের পর QR কোডসহ ডাউনলোড", dEn: "Download with a QR code after approval" },
];

const STEPS = [
  { bn: "অ্যাকাউন্ট খুলুন", en: "Create an account", dBn: "নাগরিক অ্যাকাউন্ট খুলুন, নিবন্ধন সম্পূর্ণ বিনামূল্যে।", dEn: "Open a citizen account — registration is free." },
  { bn: "আবেদন জমা দিন", en: "Submit the application", dBn: "প্রয়োজনীয় সনদ বেছে ফরম পূরণ করুন এবং নথি যুক্ত করুন।", dEn: "Pick the certificate, fill in the form and attach documents." },
  { bn: "চেয়ারম্যানের যাচাই", en: "Chairman's review", dBn: "তথ্য সংশোধন দরকার হলে কারণসহ আপনাকে জানানো হবে।", dEn: "If anything needs correcting, you are told why." },
  { bn: "সনদ ডাউনলোড", en: "Download the certificate", dBn: "QR কোডসহ বাংলা ও ইংরেজি PDF সনদ ডাউনলোড করুন।", dEn: "Download Bangla and English PDFs with a QR code." },
];

const FAQ = [
  {
    qBn: "নিবন্ধন করতে কি কোনো ফি লাগে?",
    qEn: "Does registration cost anything?",
    aBn: "না, ডিজিটাল ইউনিয়নে নাগরিক অ্যাকাউন্ট খোলা সম্পূর্ণ বিনামূল্যে।",
    aEn: "No, opening a citizen account on DigitalUnion is completely free.",
  },
  {
    qBn: "আমার সনদ আসল কিনা কীভাবে যাচাই করবো?",
    qEn: "How do I check that my certificate is genuine?",
    aBn: "সনদের QR কোড স্ক্যান করুন, অথবা এই পাতার “সনদ যাচাই” অংশে সনদ নম্বর লিখুন। ইস্যুকারী অফিসের নথির সঙ্গে মিলিয়ে ফলাফল দেখানো হবে, অ্যাকাউন্ট লাগে না।",
    aEn: "Scan the certificate's QR code, or enter its number under “Verify certificate” on this page. The result is checked against the issuing office's record; no account is needed.",
  },
  {
    qBn: "সনদ কে ইস্যু করেন?",
    qEn: "Who issues the certificate?",
    aBn: "আপনার ইউনিয়ন পরিষদের চেয়ারম্যান আবেদন যাচাই করে অনুমোদন দিলে সনদ ইস্যু হয়।",
    aEn: "Your Union Parishad Chairman issues it after reviewing and approving the application.",
  },
  {
    qBn: "আবেদনের অবস্থা কীভাবে জানবো?",
    qEn: "How do I follow my application?",
    aBn: "আবেদন জমার পর পাওয়া রেফারেন্স নম্বর দিয়ে “আবেদনের অবস্থা” থেকে দেখুন, অথবা অ্যাকাউন্টে লগইন করে “আবেদন” পাতায় দেখুন।",
    aEn: "Use the reference number you received under “Track application”, or sign in and open “Applications”.",
  },
  {
    qBn: "সনদ কোন ভাষায় পাওয়া যায়?",
    qEn: "In which language is the certificate issued?",
    aBn: "বাংলা, ইংরেজি অথবা দুই ভাষাতেই আবেদন করা যায়; অনুমোদনের পর বাংলা ও ইংরেজি PDF ডাউনলোড করা যায়।",
    aEn: "You can apply in Bangla, English or both; after approval the Bangla and English PDFs can be downloaded.",
  },
];

function SectionHead({ id, bn, en, subBn, subEn }: { id: string; bn: string; en: string; subBn: string; subEn: string }) {
  return (
    <div className="ph-section-head">
      <h2 id={id}>{choose({ bn, en })}</h2>
      <p>{choose({ bn: subBn, en: subEn })}</p>
    </div>
  );
}

/**
 * PORTAL-LANDING (supersedes PORTAL-A): the home page in the owner's
 * reference portal layout —
 *
 *   notice ticker
 *   → hero photo with the headline · service search with popular shortcuts
 *     | quick service (track / verify tabs) · citizen account
 *   → four feature tiles
 *   → [ services in seven groups · four steps · FAQ ]
 *     [ notice board · emergency hotlines · help ]
 *   → for Union Parishad offices → footer (shell)
 */
export function PublicHome() {
  const [lang] = useLanguage();
  // L-004: the witness help link hides once the options list is confirmed
  // empty (fail-open while unknown).
  const witnessAvailable = useWitnessAvailable();
  // L-006: idle-prefetch the portal chunk so the first navigation from home
  // to a portal page does not wait on a lazy chunk.
  useEffect(() => {
    const prefetch = () => {
      import("./PublicPortal.js").catch(() => {});
    };
    if ("requestIdleCallback" in window) {
      const id = (
        window as unknown as {
          requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => number;
        }
      ).requestIdleCallback(prefetch, { timeout: 3000 });
      return () =>
        (
          window as unknown as { cancelIdleCallback?: (id: number) => void }
        ).cancelIdleCallback?.(id);
    }
    const timer = setTimeout(prefetch, 1500);
    return () => clearTimeout(timer);
  }, []);
  // SEO P5: the homepage head (title/meta/canonical/OG) for the SPA route.
  useEffect(() => {
    applyPageHead({
      title: HOME_SEO.title[lang],
      description: HOME_SEO.description[lang],
      canonicalPath: "/",
    });
  }, [lang]);
  const [query, setQuery] = useState("");
  const [searchFocus, setSearchFocus] = useState(false);
  const [notices, setNotices] = useState<any[] | null>(null);
  const [quickTab, setQuickTab] = useState<"track" | "verify">("track");
  const [trackInput, setTrackInput] = useState("");
  const [trackError, setTrackError] = useState("");
  const [verifyInput, setVerifyInput] = useState("");
  const [verifyError, setVerifyError] = useState("");
  const [group, setGroup] = useState<string>("all");
  const [filter, setFilter] = useState("");
  useEffect(() => {
    let active = true;
    api("/notices?pageSize=5")
      .then((r) => active && setNotices(items(r)))
      .catch(() => active && setNotices([]));
    return () => {
      active = false;
    };
  }, []);
  const normalize = (value: string) =>
    value
      .trim()
      .replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)))
      .toLowerCase()
      .normalize("NFC");
  const normalized = normalize(query);
  const matches = normalized
    ? serviceCatalog
        .filter((s) => `${s.service_no} ${s.name_bn} ${s.name_en}`.toLowerCase().normalize("NFC").includes(normalized))
        .slice(0, 6)
    : [];
  const byNo = useMemo(() => new Map(serviceCatalog.map((s) => [s.service_no, s])), []);
  const filterText = normalize(filter);
  const visibleGroups: { group: PortalGroup; services: (typeof serviceCatalog)[number][] }[] = PORTAL_GROUPS.filter(
    (g) => group === "all" || g.id === group,
  )
    .map((g) => ({
      group: g,
      services: g.services
        .map((no) => byNo.get(no)!)
        .filter(Boolean)
        .filter((s) =>
          filterText ? `${s.service_no} ${s.name_bn} ${s.name_en}`.toLowerCase().normalize("NFC").includes(filterText) : true,
        ),
    }))
    .filter((g) => g.services.length > 0);
  const shownCount = visibleGroups.reduce((n, g) => n + g.services.length, 0);
  function submitTrack(e: React.FormEvent) {
    e.preventDefault();
    const reference = trackInput.trim();
    if (!reference) {
      setTrackError(choose({ bn: "আবেদনের রেফারেন্স নম্বরটি লিখুন।", en: "Enter the application reference." }));
      return;
    }
    // L-006: client-side — the tracking page reads ?searchText= on mount.
    navigate(`/tracking?searchText=${encodeURIComponent(reference)}`);
  }
  function submitVerify(e: React.FormEvent) {
    e.preventDefault();
    const number = certificateNumberInput(verifyInput);
    if (number) {
      navigate(`/verify?searchText=${encodeURIComponent(number)}`);
      return;
    }
    const token = verificationToken(verifyInput);
    if (!token) {
      setVerifyError(
        choose({
          bn: "সনদের QR লিংক, যাচাই কোড বা সনদ নম্বরটি সম্পূর্ণ লিখুন।",
          en: "Enter the full QR link, verification code or certificate number.",
        }),
      );
      return;
    }
    navigate(`/verify/${encodeURIComponent(token)}`);
  }
  const boardNotices: { key: string; text: string; office?: string }[] =
    notices && notices.length
      ? notices.slice(0, 5).map((n) => ({
          key: n.id,
          text: choose({ bn: n.titleBn, en: n.titleEn }),
          office: choose({ bn: n.officeBn, en: n.officeEn }) || undefined,
        }))
      : PLATFORM_NOTICES.map((n, i) => ({ key: `platform-${i}`, text: choose(n) }));
  const tickerNotices =
    notices && notices.length
      ? notices
      : PLATFORM_NOTICES.map((n, i) => ({ id: `platform-${i}`, titleBn: n.bn, titleEn: n.en, officeBn: "", officeEn: "" }));
  return (
    <PublicShell current="/" onNavigate={(href) => navigate(href)}>
      <NoticeTicker notices={tickerNotices} />

      {/* Hero: photo + headline and service search | quick service and citizen account. */}
      <section id="hero" className="hx-hero ph-hero" aria-labelledby="ph-hero-title">
        <div className="du-container ph-hero-grid">
          <div className="ph-hero-main">
            <figure className="ph-hero-media">
              <img
                src="/images/carousel/union-office.webp"
                alt=""
                width={860}
                height={480}
                fetchPriority="high"
                decoding="async"
              />
              <span className="ph-photo-tag">{choose({ bn: "প্রতীকী ছবি", en: "Illustrative image" })}</span>
              <figcaption className="ph-hero-copy">
                <p className="ph-hero-kicker">
                  {choose({ bn: "ইউনিয়ন পরিষদের নাগরিক সেবা", en: "Union Parishad citizen services" })}
                </p>
                <h1 id="ph-hero-title">
                  {choose({ bn: "আপনার ইউনিয়নের সনদ, এখন অনলাইনে", en: "Your union's certificates, now online" })}
                </h1>
                <p className="ph-hero-lead">
                  {choose({
                    bn: "ইউনিয়ন পরিষদের ৪৭টি সনদ ও প্রত্যয়নের আবেদন করুন ঘরে বসে। চেয়ারম্যানের ইস্যু করা প্রতিটি সনদ QR কোডে যাচাইযোগ্য।",
                    en: "Apply for any of the Union Parishad's 47 certificates from home. Every certificate the Chairman issues is verifiable by QR code.",
                  })}
                </p>
              </figcaption>
            </figure>
            <div className="ph-search-card">
              <form
                className="ph-search"
                role="search"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (matches.length) navigate(servicePath(matches[0].service_no));
                  else navigate("/services");
                }}
              >
                <label htmlFor="home-service-search">
                  <Icon name="search" size={18} />
                  {choose({ bn: "সেবা খুঁজুন", en: "Find a service" })}
                </label>
                <div className="ph-search-field">
                  <input
                    id="home-service-search"
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onFocus={() => setSearchFocus(true)}
                    onBlur={() => window.setTimeout(() => setSearchFocus(false), 150)}
                    placeholder={choose({
                      bn: "সনদের নাম লিখুন, যেমন: নাগরিকত্ব সনদ",
                      en: "Type a certificate name, e.g. citizenship certificate",
                    })}
                    autoComplete="off"
                  />
                  {searchFocus && normalized && (
                    <div className="hx-search-results">
                      {matches.length ? (
                        matches.map((s) => (
                          <a key={s.service_no} href={servicePath(s.service_no)}>
                            <strong>{choose({ bn: s.name_bn, en: s.name_en })}</strong>
                            <small>{choose(categoryLabel(s.category_en))}</small>
                          </a>
                        ))
                      ) : (
                        <a href="/services">
                          <strong>{choose({ bn: "এই নামে কোনো সেবা পাওয়া যায়নি", en: "No service by that name" })}</strong>
                          <small>{choose({ bn: "সব ৪৭টি সেবা দেখুন", en: "See all 47 services" })}</small>
                        </a>
                      )}
                    </div>
                  )}
                </div>
                <button type="submit" className="ph-btn ph-btn-primary">
                  {choose({ bn: "খুঁজুন", en: "Search" })}
                </button>
              </form>
              <p className="ph-popular">
                <span>{choose({ bn: "বেশি খোঁজা:", en: "Most searched:" })}</span>
                {POPULAR_SERVICES.map((p) => (
                  <a key={p.no} href={servicePath(p.no)}>
                    {choose({ bn: p.bn, en: p.en })}
                  </a>
                ))}
              </p>
            </div>
          </div>

          <aside className="ph-hero-side" aria-label={choose({ bn: "দ্রুত সেবা", en: "Quick services" })}>
            <section className="ph-quick" aria-labelledby="home-quick-heading">
              <h2 id="home-quick-heading" className="ph-card-title">
                <Icon name="shield" />
                {choose({ bn: "দ্রুত সেবা", en: "Quick services" })}
              </h2>
              <div className="ph-tabs" role="tablist" aria-label={choose({ bn: "দ্রুত সেবা", en: "Quick services" })}>
                <button
                  type="button"
                  role="tab"
                  id="home-tab-track"
                  aria-controls="home-panel-track"
                  aria-selected={quickTab === "track"}
                  className={quickTab === "track" ? "is-active" : ""}
                  onClick={() => setQuickTab("track")}
                >
                  <Icon name="clipboard" size={16} />
                  {choose({ bn: "আবেদনের অবস্থা", en: "Track application" })}
                </button>
                <button
                  type="button"
                  role="tab"
                  id="home-tab-verify"
                  aria-controls="home-panel-verify"
                  aria-selected={quickTab === "verify"}
                  className={quickTab === "verify" ? "is-active" : ""}
                  onClick={() => setQuickTab("verify")}
                >
                  <Icon name="qr" size={16} />
                  {choose({ bn: "সনদ যাচাই", en: "Verify certificate" })}
                </button>
              </div>
              {quickTab === "track" ? (
                <div role="tabpanel" id="home-panel-track" aria-labelledby="home-tab-track" className="ph-tab-panel">
                  <h3 id="home-track-heading">
                    {choose({ bn: "আপনার আবেদন কোন পর্যায়ে আছে জানুন", en: "See where your application stands" })}
                  </h3>
                  <form className="ph-form" onSubmit={submitTrack} noValidate>
                    <label htmlFor="home-track-input">
                      {choose({ bn: "আবেদনের রেফারেন্স নম্বর", en: "Application reference" })}
                    </label>
                    <input
                      id="home-track-input"
                      value={trackInput}
                      placeholder={choose({ bn: "যেমন: ২০২৬১১১৮১২৩৪৫৬৭৮", en: "e.g. 2026111812345678" })}
                      onChange={(e) => {
                        setTrackInput(e.target.value);
                        setTrackError("");
                      }}
                      aria-invalid={trackError ? true : undefined}
                      aria-describedby={trackError ? "home-track-error" : "home-track-hint"}
                    />
                    {trackError && (
                      <p id="home-track-error" role="alert" className="hx-verify-error">
                        {trackError}
                      </p>
                    )}
                    <button type="submit" className="ph-btn ph-btn-primary ph-btn-block">
                      <Icon name="search" size={18} />
                      {choose({ bn: "অবস্থা দেখুন", en: "Check status" })}
                    </button>
                    <p id="home-track-hint" className="ph-hint">
                      {choose({
                        bn: "আবেদন জমার পর পাওয়া রেফারেন্স নম্বরটি লিখুন।",
                        en: "Enter the reference number you received after applying.",
                      })}
                    </p>
                  </form>
                </div>
              ) : (
                <div role="tabpanel" id="home-panel-verify" aria-labelledby="home-tab-verify" className="ph-tab-panel">
                  <h3 id="home-verify-heading">
                    {choose({ bn: "সনদটি আসল কিনা যাচাই করুন", en: "Check that a certificate is genuine" })}
                  </h3>
                  <form className="hx-verify-form ph-form" onSubmit={submitVerify} noValidate>
                    <label htmlFor="home-verify-input">
                      {choose({ bn: "সনদ নম্বর বা QR লিংক", en: "Certificate number or QR link" })}
                    </label>
                    <input
                      id="home-verify-input"
                      inputMode="text"
                      value={verifyInput}
                      placeholder={choose({ bn: "সনদ নম্বর", en: "Certificate number" })}
                      onChange={(e) => {
                        setVerifyInput(e.target.value);
                        setVerifyError("");
                      }}
                      aria-invalid={verifyError ? true : undefined}
                      aria-describedby={verifyError ? "home-verify-error" : "home-verify-hint"}
                    />
                    {verifyError && (
                      <p id="home-verify-error" role="alert" className="hx-verify-error">
                        {verifyError}
                      </p>
                    )}
                    <button type="submit" className="ph-btn ph-btn-primary ph-btn-block">
                      <Icon name="qr" size={18} />
                      {choose({ bn: "যাচাই করুন", en: "Verify" })}
                    </button>
                    <p id="home-verify-hint" className="ph-hint">
                      {choose({ bn: "বিনামূল্যে, অ্যাকাউন্ট লাগে না।", en: "Free, no account needed." })}
                    </p>
                  </form>
                </div>
              )}
            </section>
            <section className="ph-account" aria-labelledby="home-account-heading">
              <h2 id="home-account-heading">{choose({ bn: "নাগরিক অ্যাকাউন্ট", en: "Citizen account" })}</h2>
              <p>
                {choose({
                  bn: "আবেদন করতে অ্যাকাউন্ট লাগবে, নিবন্ধন সম্পূর্ণ বিনামূল্যে।",
                  en: "You need an account to apply — registration is free.",
                })}
              </p>
              <div className="ph-account-actions">
                <a className="ph-btn ph-btn-outline" href="/register">
                  <Icon name="user" size={18} />
                  {choose({ bn: "নিবন্ধন", en: "Register" })}
                </a>
                <a className="ph-btn ph-btn-primary" href="/login">
                  <Icon name="login" size={18} />
                  {choose({ bn: "লগইন", en: "Login" })}
                </a>
              </div>
            </section>
          </aside>
        </div>
      </section>

      <div className="du-container ph-features">
        {FEATURES.map((f) => (
          <div key={f.en} className="ph-feature">
            <span className="ph-feature-icon">
              <Icon name={f.icon} />
            </span>
            <span>
              <strong>{choose({ bn: f.bn, en: f.en })}</strong>
              <small>{choose({ bn: f.dBn, en: f.dEn })}</small>
            </span>
          </div>
        ))}
      </div>

      <div className="du-container ph-layout">
        <div className="ph-main">
          <section id="services" className="ph-section" aria-labelledby="home-services-heading">
            <SectionHead
              id="home-services-heading"
              bn="নাগরিক সেবাসমূহ"
              en="Citizen services"
              subBn="ইউনিয়ন পরিষদের ৪৭টি সনদ ও প্রত্যয়ন, ধরন অনুযায়ী সাজানো"
              subEn="The Union Parishad's 47 certificates, grouped by kind"
            />
            <label className="ph-filter">
              <Icon name="search" size={18} />
              <span className="sr-only">{choose({ bn: "সেবা খুঁজুন", en: "Filter services" })}</span>
              <input
                id="home-service-filter"
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={choose({
                  bn: "সেবার নাম লিখে খুঁজুন, বাংলা বা ইংরেজিতে",
                  en: "Type a service name, in Bangla or English",
                })}
                autoComplete="off"
              />
            </label>
            <div className="ph-chips" role="group" aria-label={choose({ bn: "সেবার ধরন", en: "Service kind" })}>
              <button
                type="button"
                className={group === "all" ? "is-active" : ""}
                aria-pressed={group === "all"}
                onClick={() => setGroup("all")}
              >
                {choose({ bn: "সব সেবা", en: "All services" })}
                <span className="ph-count">{digits(47, lang)}</span>
              </button>
              {PORTAL_GROUPS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={group === g.id ? "is-active" : ""}
                  aria-pressed={group === g.id}
                  onClick={() => setGroup(g.id)}
                >
                  {choose({ bn: g.bn, en: g.en })}
                  <span className="ph-count">{digits(g.services.length, lang)}</span>
                </button>
              ))}
            </div>
            <p className="ph-status" role="status">
              {shownCount === 47
                ? choose({ bn: "মোট ৪৭টি সেবা, ধরন অনুযায়ী সাজানো", en: "All 47 services, grouped by kind" })
                : choose({
                    bn: `${digits(shownCount, lang)}টি সেবা দেখানো হচ্ছে`,
                    en: `Showing ${shownCount} service${shownCount === 1 ? "" : "s"}`,
                  })}
            </p>
            {visibleGroups.length ? (
              <div className="ph-groups">
                {visibleGroups.map(({ group: g, services }) => (
                  <section key={g.id} className="ph-group" aria-labelledby={`ph-group-${g.id}`}>
                    <h3 id={`ph-group-${g.id}`}>
                      <Icon name={g.icon} size={18} />
                      <span>{choose({ bn: g.bn, en: g.en })}</span>
                      <small>{choose({ bn: `${digits(g.services.length, "bn")}টি`, en: String(g.services.length) })}</small>
                    </h3>
                    <ul>
                      {services.map((s) => (
                        <li key={s.service_no}>
                          <a className="ph-service" href={servicePath(s.service_no)}>
                            <Icon name="chevron" size={14} />
                            <span>{choose({ bn: s.name_bn, en: s.name_en })}</span>
                            <span className="ph-apply">{choose({ bn: "আবেদন", en: "Apply" })}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            ) : (
              <p className="ph-empty">
                {choose({ bn: "এই নামে কোনো সেবা পাওয়া যায়নি।", en: "No service matches that name." })}{" "}
                <button
                  type="button"
                  className="ph-link-button"
                  onClick={() => {
                    setFilter("");
                    setGroup("all");
                  }}
                >
                  {choose({ bn: "সব সেবা দেখুন", en: "Show all services" })}
                </button>
              </p>
            )}
            <div className="ph-section-foot">
              <a className="ph-btn ph-btn-outline" href="/services">
                {choose({ bn: "সেবার বিস্তারিত পাতা", en: "All 47 services" })}
                <Icon name="arrow" size={16} />
              </a>
            </div>
          </section>

          <section id="steps" className="ph-section" aria-labelledby="home-how-heading">
            <SectionHead
              id="home-how-heading"
              bn="চার ধাপে সনদ"
              en="Your certificate in four steps"
              subBn="অফিসে না গিয়েই ঘরে বসে সনদ হাতে পাওয়ার পুরো প্রক্রিয়া"
              subEn="The whole process of getting a certificate from home, without visiting the office"
            />
            <div className="ph-steps-grid">
              <figure className="ph-steps-media">
                <img
                  src="/images/carousel/apply-from-home.webp"
                  alt={choose({
                    bn: "বাড়িতে বসে মোবাইলে অনলাইন আবেদন পূরণ করছেন নাগরিক",
                    en: "A citizen filling in an online application on a phone at home",
                  })}
                  width={353}
                  height={441}
                  loading="lazy"
                  decoding="async"
                />
                <span className="ph-photo-tag">{choose({ bn: "প্রতীকী ছবি", en: "Illustrative image" })}</span>
              </figure>
              <div>
                <ol className="ph-steps">
                  {STEPS.map((step, i) => (
                    <li key={step.en}>
                      <span className="ph-step-no" aria-hidden="true">
                        {choose({ bn: BN_DIGITS[i + 1], en: String(i + 1) })}
                      </span>
                      <span>
                        <strong>{choose({ bn: step.bn, en: step.en })}</strong>
                        <small>{choose({ bn: step.dBn, en: step.dEn })}</small>
                      </span>
                    </li>
                  ))}
                </ol>
                <a className="ph-btn ph-btn-primary" href="/services">
                  {choose({ bn: "এখনই আবেদন শুরু করুন", en: "Start an application now" })}
                  <Icon name="arrow" size={16} />
                </a>
              </div>
            </div>
          </section>

          <section id="faq" className="ph-section" aria-labelledby="home-faq-heading">
            <SectionHead
              id="home-faq-heading"
              bn="সাধারণ জিজ্ঞাসা"
              en="Common questions"
              subBn="নাগরিকদের সবচেয়ে বেশি জানতে চাওয়া প্রশ্নের উত্তর"
              subEn="Answers to what citizens ask most often"
            />
            <div className="ph-faq">
              {FAQ.map((item, i) => (
                <details key={item.qEn} open={i === 0}>
                  <summary>
                    <span>{choose({ bn: item.qBn, en: item.qEn })}</span>
                    <Icon name="plus" size={16} />
                  </summary>
                  <p>{choose({ bn: item.aBn, en: item.aEn })}</p>
                </details>
              ))}
            </div>
            <p className="ph-faq-more">
              <a href="/help">{choose({ bn: "আরও প্রশ্ন ও উত্তর দেখুন", en: "More questions and answers" })}</a>
            </p>
          </section>
        </div>

        <aside className="ph-aside" aria-label={choose({ bn: "নোটিশ ও সহায়তা", en: "Notices and help" })}>
          <section id="notices" className="ph-panel" aria-labelledby="home-notices-heading">
            <h2 id="home-notices-heading" className="ph-panel-title">
              <Icon name="bell" />
              {choose({ bn: "নোটিশ বোর্ড", en: "Notice board" })}
            </h2>
            <ol className="ph-notices">
              {boardNotices.map((n, i) => (
                <li key={n.key}>
                  <span className="ph-notice-no" aria-hidden="true">
                    {digits(i + 1, lang)}
                  </span>
                  <span>
                    {n.office && <strong>{n.office}: </strong>}
                    {n.text}
                  </span>
                </li>
              ))}
            </ol>
            {notices && notices.length > 0 && (
              <a className="ph-panel-more" href="/notices">
                {choose({ bn: "সব নোটিশ", en: "All notices" })}
              </a>
            )}
          </section>

          <section id="hotline" className="ph-panel" aria-labelledby="home-hotline-heading">
            <h2 id="home-hotline-heading" className="ph-panel-title is-red">
              <Icon name="siren" />
              {choose({ bn: "জরুরি হটলাইন", en: "Emergency hotlines" })}
            </h2>
            <ul className="ph-hotlines">
              {HOTLINES.map((h) => (
                <li key={h.number}>
                  <a href={`tel:${h.number}`}>
                    <strong>{digits(h.number, lang)}</strong>
                    <small>{choose({ bn: h.bn, en: h.en })}</small>
                  </a>
                </li>
              ))}
            </ul>
          </section>

          <section id="help" className="ph-panel" aria-labelledby="home-help-heading">
            <h2 id="home-help-heading" className="ph-panel-title">
              <Icon name="help" />
              {choose({ bn: "সহায়তা", en: "Help" })}
            </h2>
            <ul className="ph-links hp-links">
              <li>
                <a href="#steps">
                  <Icon name="book" size={18} />
                  <span>{choose({ bn: "সেবা পাওয়ার ধাপ", en: "How to get a service" })}</span>
                  <Icon name="chevron" size={16} />
                </a>
              </li>
              <li>
                <a href="/help">
                  <Icon name="help" size={18} />
                  <span>{choose({ bn: "সাধারণ জিজ্ঞাসা", en: "Common questions" })}</span>
                  <Icon name="chevron" size={16} />
                </a>
              </li>
              <li>
                <a href="/offices">
                  <Icon name="pin" size={18} />
                  <span>{choose({ bn: "অংশগ্রহণকারী ইউনিয়ন অফিস", en: "Participating union offices" })}</span>
                  <Icon name="chevron" size={16} />
                </a>
              </li>
              <li>
                <a href="/guide">
                  <Icon name="book" size={18} />
                  <span>{choose({ bn: "ব্যবহার নির্দেশিকা", en: "User guide" })}</span>
                  <Icon name="chevron" size={16} />
                </a>
              </li>
              {/* L-004: the witness link hides once the options list is
                  confirmed empty (fail-open while unknown). */}
              {witnessAvailable && (
                <li>
                  <a href="/witness">
                    <Icon name="files" size={18} />
                    <span>{choose({ bn: "সাক্ষীর প্রত্যয়ন তৈরি", en: "Make a witness statement" })}</span>
                    <Icon name="chevron" size={16} />
                  </a>
                </li>
              )}
            </ul>
          </section>
        </aside>
      </div>

      {/* Platform offers for offices (coupons); renders only when one is public. */}
      <div className="ph-offers">
        <PublicOffers />
      </div>

      <section id="for-offices" className="ph-offices" aria-labelledby="home-offices-heading">
        <div className="du-container ph-offices-row">
          <div>
            <p className="ph-offices-kicker">
              <Icon name="building" size={16} />
              {choose({ bn: "ইউনিয়ন পরিষদ অফিসের জন্য", en: "For Union Parishad offices" })}
            </p>
            <h2 id="home-offices-heading">
              {choose({
                bn: "আপনার ইউনিয়ন পরিষদকে ডিজিটাল ইউনিয়নে যুক্ত করুন",
                en: "Bring your Union Parishad onto DigitalUnion",
              })}
            </h2>
            <ul>
              {[
                { bn: "নাগরিকের আবেদন অনলাইনে গ্রহণ ও যাচাই", en: "Receive and review citizen applications online" },
                { bn: "চেয়ারম্যানের অনুমোদনে QR যুক্ত সনদ ইস্যু", en: "Issue QR certificates on the Chairman's approval" },
                { bn: "সব আবেদনের হিসাব এক জায়গায়", en: "Every application accounted for in one place" },
              ].map((point) => (
                <li key={point.en}>
                  <Icon name="check" size={16} />
                  {choose(point)}
                </li>
              ))}
            </ul>
          </div>
          <div className="ph-offices-actions">
            <a className="ph-btn ph-btn-light" href="/register-office">
              <Icon name="building" size={18} />
              {choose({ bn: "অফিস যুক্ত করার আবেদন", en: "Request to add your office" })}
            </a>
            <a className="ph-btn ph-btn-ghost-light" href="/login">
              <Icon name="login" size={18} />
              {choose({ bn: "অফিস লগইন", en: "Office sign-in" })}
            </a>
          </div>
        </div>
      </section>
    </PublicShell>
  );
}
