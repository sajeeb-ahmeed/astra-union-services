import React, { useEffect, useRef, useState } from "react";
import { api, items } from "./api.js";
import { choose, useLanguage } from "./i18n.js";
import serviceCatalog from "./public-service-catalog.json" with { type: "json" };
import { PublicShell } from "./PublicShell.js";
import { PublicOffers } from "./GlobalNotices.js";
import { categoryLabel } from "./service-categories.js";
import { servicePath } from "./service-slugs.js";
import { TrustStrip } from "./TrustVisual.js";
import { HomeServiceDirectory, NoticeTicker } from "./HomeServiceDirectory.js";
import { HeroCarousel } from "./HeroCarousel.js";
import { useFormatters } from "./ui/fmt.js";
import "./public-home.css";

import { certificateNumberInput, verificationToken } from "./verify-input.js";
import { HOME_SEO } from "./seo/service-seo.js";
import { applyPageHead } from "./seo/head.js";

export { certificateNumberInput, verificationToken } from "./verify-input.js";

/**
 * REFINEMENT-02 P1-2: photographic band for the for-offices section. The
 * product owns no licensed photograph of the pilot office yet, and stock
 * that misrepresents the pilot is forbidden — so the band renders only
 * once a real photo is dropped at public/images/up-office.webp (the
 * <img> hides itself on error until then). Treatment: brand-green
 * duotone via CSS blend so the photo sits in the palette.
 */
function OfficePhotoBand() {
  const [loaded, setLoaded] = useState(false);
  return (
    <figure className={`home-photo-band${loaded ? " is-loaded" : ""}`} hidden={!loaded}>
      <img
        src="/images/up-office.webp"
        alt={choose({
          bn: "ইউনিয়ন পরিষদ অফিসে নাগরিক সেবা দেওয়া হচ্ছে",
          en: "Citizen services being delivered at a Union Parishad office",
        })}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(false)}
      />
      <figcaption>
        {choose({
          bn: "বেলাবো ইউনিয়ন পরিষদ — পাইলট অফিস। ছবি: অফিসের নিজস্ব সংগ্রহ।",
          en: "Belabo Union Parishad — the pilot office. Photo: the office's own collection.",
        })}
      </figcaption>
    </figure>
  );
}

const FAQS: { q: { bn: string; en: string }; a: { bn: string; en: string } }[] = [
  {
    q: { bn: "নাগরিক নিবন্ধনে কি কোনো ফি লাগে?", en: "Is there a fee to register as a citizen?" },
    a: {
      bn: "না — নিবন্ধন সম্পূর্ণ ফ্রি। আবেদনের সময় সংশ্লিষ্ট অফিসের প্রকাশিত সেবা ফি (যদি থাকে) প্রযোজ্য হতে পারে; ফি সেবার পৃষ্ঠায় ও আবেদনের আগেই দেখা যায়।",
      en: "No — registration is completely free. At application time the office's published service fee (if any) may apply; the fee is shown on the service page before you apply.",
    },
  },
  {
    q: { bn: "সনদ পেতে কতদিন লাগবে?", en: "How long does a certificate take?" },
    a: {
      bn: "চেয়ারম্যানের যাচাই ও অনুমোদনের ওপর নির্ভর করে। অফিস সেবা প্রদানের সময় প্রকাশ করে থাকলে তা সেবার পৃষ্ঠায় দেখা যাবে।",
      en: "It depends on the chairman's review and approval. Where an office publishes a service time, it is shown on the service page.",
    },
  },
  {
    q: { bn: "আমার ইউনিয়ন এই প্ল্যাটফর্মে না থাকলে?", en: "What if my union is not on this platform?" },
    a: {
      bn: "অফিসসমূহ পৃষ্ঠায় আপনার ইউনিয়ন খুঁজুন। তালিকায় না থাকলে সেখানেই চাহিদা জানিয়ে রাখতে পারবেন — অফিস যুক্ত হলে তখন আবেদন করা যাবে।",
      en: "Search for your union on the Offices page. If it is not listed yet, you can leave your details there — you will be able to apply once the office joins.",
    },
  },
  {
    q: { bn: "সনদ আসল কিনা কীভাবে বুঝব?", en: "How do I know a certificate is genuine?" },
    a: {
      bn: "সনদের QR কোড স্ক্যান করুন অথবা ১৬ ডিজিটের নম্বরটি যাচাই পৃষ্ঠায় লিখুন — অফিস ও সেবাসহ ফলাফল দেখা যাবে। অ্যাকাউন্ট লাগে না, কোনো ফি-ও লাগে না। যাচাইয়ে দেখা যায় সনদটি প্ল্যাটফর্মের নথির সঙ্গে মিলে কিনা।",
      en: "Scan the certificate's QR code or enter its 16-digit number on the Verify page — the result shows the office and service. No account and no fee are needed. Verification shows whether the certificate matches the platform's record.",
    },
  },
  {
    q: { bn: "সনদে ভুল থাকলে কী হবে?", en: "What if a certificate has a mistake?" },
    a: {
      bn: "চেয়ারম্যান সংশোধনের অনুরোধ পাঠাতে পারেন। তখন একই আবেদনটি ঠিক করে আবার জমা দেওয়া যায় — নতুন করে শুরু করতে হয় না।",
      en: "The chairman can send a correction request. You then fix and resubmit the same application — there is no need to start over.",
    },
  },
  {
    q: { bn: "অফিসের জন্য খরচ কত?", en: "What does it cost an office?" },
    a: {
      bn: "অফিসগুলো সাবস্ক্রিপশন প্ল্যান ও ক্রেডিট মডেলে চলে, যা প্ল্যাটফর্ম কর্তৃপক্ষ নিয়ন্ত্রণ করে। নির্দিষ্ট মূল্য জানতে প্ল্যাটফর্ম কর্তৃপক্ষের সঙ্গে যোগাযোগ করুন। নাগরিক নিবন্ধন ফ্রি।",
      en: "Offices run on subscription plans and credits, controlled by the platform owner. Contact the platform owner for exact pricing. Citizen registration is free.",
    },
  },
  {
    q: { bn: "অফিসের ডেটা কি আলাদা থাকে?", en: "Is each office's data kept separate?" },
    a: {
      bn: "হ্যাঁ — প্রতিটি অফিসের আবেদন, নাগরিক ও নথি শুধু সেই অফিসেরই; অন্য অফিস তা দেখতে পায় না।",
      en: "Yes — each office's applications, citizens and records belong to that office only; other offices cannot see them.",
    },
  },
  {
    q: { bn: "এটি কি সরকারি ওয়েবসাইট?", en: "Is this a government website?" },
    a: {
      bn: "না — DigitalUnion একটি বেসরকারি প্ল্যাটফর্ম, যা ইউনিয়ন পরিষদ অফিসগুলো তাদের সেবা দিতে ব্যবহার করে। সরকারি সিস্টেমটি হলো unionservices.gov.bd।",
      en: "No — DigitalUnion is a private platform that Union Parishad offices use to deliver their services. The government system is unionservices.gov.bd.",
    },
  },
];

/** Small stroke icons for the task tiles and trust pillars (decorative). */
function Icon({ name }: { name: "apply" | "track" | "verify" | "chair" | "lock" | "info" | "seal" | "fee" | "inbox" }) {
  const paths: Record<string, React.ReactNode> = {
    apply: (<><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /><path d="M10 13h6M10 17h4" /></>),
    track: (<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>),
    verify: (<><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" /><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2" /></>),
    chair: (<><circle cx="12" cy="7.5" r="3.5" /><path d="M5 20c.8-3.6 3.6-6 7-6s6.2 2.4 7 6" /><path d="m15.5 17 1.7 1.7 3.3-3.4" /></>),
    lock: (<><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" /></>),
    info: (<><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5M12 7.8v.2" /></>),
    seal: (<><circle cx="12" cy="10" r="6" /><path d="m9.5 10 1.7 1.7L14.7 8.5" /><path d="M9 15.3 8 21l4-2 4 2-1-5.7" /></>),
    fee: (<><path d="M6 4h11M6 9h11M6 4c5 0 5 5 0 5l8 11" /></>),
    inbox: (<><path d="M4 13.5 6.5 5h11l2.5 8.5V19H4z" /><path d="M4 13.5h4.5l1.5 2.5h4l1.5-2.5H20" /></>),
  };
  return (
    <svg className="hx-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

/**
 * HOME-REDESIGN-01: what anyone sees after scanning a certificate's QR —
 * the product's core trust promise, shown on the hero certificate. Static
 * sample (marked as such); mirrors the real /verify result rows, including
 * the partly masked holder name.
 */
function VerifyResultSample() {
  return (
    <div className="hx-verify-card" aria-hidden="true">
      <div className="hx-verify-card-head">
        <span className="hx-verify-tick">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
        </span>
        <div>
          <strong>{choose({ bn: "সনদ বৈধ — ইস্যু হয়েছে", en: "Valid — certificate issued" })}</strong>
          <small>{choose({ bn: "QR স্ক্যান করলে যা দেখবেন (নমুনা)", en: "What a QR scan shows (sample)" })}</small>
        </div>
      </div>
      <dl>
        <dt>{choose({ bn: "অফিস", en: "Office" })}</dt>
        <dd>{choose({ bn: "বেলাবো ইউনিয়ন পরিষদ", en: "Belabo Union Parishad" })}</dd>
        <dt>{choose({ bn: "সেবা", en: "Service" })}</dt>
        <dd>{choose({ bn: "নাগরিকত্ব সনদ", en: "Citizenship certificate" })}</dd>
        <dt>{choose({ bn: "সনদধারী", en: "Holder" })}</dt>
        <dd>{choose({ bn: "আ**ল ক***ম", en: "A***l K***m" })}</dd>
      </dl>
    </div>
  );
}

/**
 * HOME-REDESIGN-01: a static, clearly-marked sample of the chairman's queue
 * for the offices section — shows the buyer the daily workflow instead of
 * describing it. No real names or numbers.
 */
function ChairmanQueueSample() {
  const rows = [
    { bn: "নাগরিকত্ব সনদ", en: "Citizenship certificate", sBn: "নতুন জমা", sEn: "New", tone: "new" },
    { bn: "ওয়ারিশ সনদ", en: "Heirship certificate", sBn: "সংশোধনের পর জমা", sEn: "Resubmitted", tone: "re" },
    { bn: "ট্রেড লাইসেন্স", en: "Trade licence", sBn: "নতুন জমা", sEn: "New", tone: "new" },
  ];
  return (
    <figure className="hx-queue" aria-label={choose({ bn: "চেয়ারম্যানের অপেক্ষমাণ তালিকা — নমুনা", en: "Chairman's pending queue — sample" })}>
      <div className="hx-queue-bar">
        <strong>{choose({ bn: "অপেক্ষমাণ আবেদন", en: "Pending applications" })}</strong>
        <span className="hx-queue-sample">{choose({ bn: "নমুনা", en: "Sample" })}</span>
      </div>
      <ul>
        {rows.map((r) => (
          <li key={r.en}>
            <div>
              <strong>{choose({ bn: r.bn, en: r.en })}</strong>
              <span className={`hx-queue-state is-${r.tone}`}>{choose({ bn: r.sBn, en: r.sEn })}</span>
            </div>
            <div className="hx-queue-actions">
              <span className="hx-queue-btn is-primary">{choose({ bn: "অনুমোদন", en: "Approve" })}</span>
              <span className="hx-queue-btn">{choose({ bn: "সংশোধন", en: "Correction" })}</span>
            </div>
          </li>
        ))}
      </ul>
      <figcaption>
        {choose({
          bn: "নথি খুলে দেখুন, এক ক্লিকে অনুমোদন দিন — সনদ সঙ্গে সঙ্গে তৈরি হয়।",
          en: "Open the documents, approve in one click — the certificate is generated at once.",
        })}
      </figcaption>
    </figure>
  );
}

/**
 * HOME-REDESIGN-01 (supersedes the FULL-UIUX-01 composition): one job per
 * section and one primary action per audience.
 *   Hero (citizen: find + apply; the certificate with its verify result)
 *   → three task tiles (apply · track · verify) → notices → popular services
 *   → how it works (a real sequence) → why trust it (honest pillars + the
 *   verified-proof list) → verify box → for offices (the B2B pitch with a
 *   sample of the chairman's queue, onboarding steps and one CTA) → FAQ.
 * Every claim stays inside the BD verified proof list; no invented
 * statistics, no price table, no testimonials.
 */
export function PublicHome({ login }: { login?: React.ReactNode } = {}) {
  const [lang] = useLanguage();
  // SEO P5: the homepage head (title/meta/canonical/OG) for the SPA route.
  useEffect(() => {
    applyPageHead({
      title: HOME_SEO.title[lang],
      description: HOME_SEO.description[lang],
      canonicalPath: "/",
    });
  }, [lang]);
  const fmt = useFormatters();
  const [query, setQuery] = useState("");
  const [searchFocus, setSearchFocus] = useState(false);
  const [notices, setNotices] = useState<any[] | null>(null);
  const [verifyInput, setVerifyInput] = useState("");
  const [verifyError, setVerifyError] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    api("/notices?pageSize=4")
      .then((r) => active && setNotices(items(r)))
      .catch(() => active && setNotices([]));
    return () => {
      active = false;
    };
  }, []);
  const normalized = query
    .trim()
    .replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d)))
    .toLowerCase()
    .normalize("NFC");
  const matches = normalized
    ? serviceCatalog
        .filter((s) =>
          `${s.service_no} ${s.name_bn} ${s.name_en}`.toLowerCase().normalize("NFC").includes(normalized),
        )
        .slice(0, 6)
    : [];
  function submitVerify(e: React.FormEvent) {
    e.preventDefault();
    const number = certificateNumberInput(verifyInput);
    if (number) {
      location.assign(`/verify?searchText=${encodeURIComponent(number)}`);
      return;
    }
    const token = verificationToken(verifyInput);
    if (!token) {
      setVerifyError(
        choose({
          bn: "সনদের QR লিংক, যাচাই কোড বা ১৬ ডিজিটের নম্বরটি সম্পূর্ণ লিখুন।",
          en: "Enter the full QR link, verification code or 16-digit certificate number.",
        }),
      );
      return;
    }
    location.assign(`/verify/${encodeURIComponent(token)}`);
  }
  return (
    <PublicShell current="/">
      {notices && notices.length > 0 && <NoticeTicker notices={notices} />}
      {/* Hero — citizens first: one search, one primary action, and the
          product's proof (a certificate with what its QR scan shows). */}
      <section className="hx-hero">
        <div className="ax-container hx-hero-grid">
          <div className="hx-hero-copy">
            <p className="hx-hero-kicker">
              {choose({ bn: "ইউনিয়ন পরিষদের নাগরিক সেবা", en: "Union Parishad citizen services" })}
            </p>
            <h1>
              {choose({
                bn: "আপনার ইউনিয়নের সনদ, এখন অনলাইনে",
                en: "Your union's certificates, now online",
              })}
            </h1>
            <p className="hx-hero-sub">
              {choose({
                bn: "ঘরে বসে আবেদন করুন। চেয়ারম্যান নিজে যাচাই করে সনদ দেন — বাংলা ও ইংরেজিতে, QR দিয়ে যে কেউ যাচাই করতে পারে।",
                en: "Apply from home. Your chairman checks and issues the certificate — in Bangla and English, verifiable by anyone with its QR code.",
              })}
            </p>
            <form
              className="hx-search"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                if (matches.length) location.assign(servicePath(matches[0].service_no));
                else location.assign("/services");
              }}
            >
              <label htmlFor="home-service-search">
                {choose({ bn: "কোন সনদ লাগবে?", en: "Which certificate do you need?" })}
              </label>
              <div className="hx-search-row">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="6.5" />
                  <path d="m16 16 4 4" />
                </svg>
                <input
                  id="home-service-search"
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onFocus={() => setSearchFocus(true)}
                  onBlur={() => window.setTimeout(() => setSearchFocus(false), 150)}
                  placeholder={choose({
                    bn: "যেমন: নাগরিকত্ব, ওয়ারিশ, ট্রেড লাইসেন্স",
                    en: "e.g. citizenship, heirship, trade licence",
                  })}
                  autoComplete="off"
                />
                <button type="submit">{choose({ bn: "খুঁজুন", en: "Search" })}</button>
              </div>
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
                      <strong>
                        {choose({
                          bn: "এই নামে কোনো সেবা পাওয়া যায়নি",
                          en: "No service by that name",
                        })}
                      </strong>
                      <small>{choose({ bn: "সব ৪৭টি সেবা দেখুন", en: "See all 47 services" })}</small>
                    </a>
                  )}
                </div>
              )}
            </form>
            <div className="hx-hero-ctas">
              <a className="button hx-cta-light" href="/register">
                {choose({ bn: "বিনামূল্যে অ্যাকাউন্ট খুলুন", en: "Create a free account" })}
              </a>
              <p>
                {choose({ bn: "অ্যাকাউন্ট আছে?", en: "Have an account?" })}{" "}
                <a href="/login">{choose({ bn: "লগইন করুন", en: "Sign in" })}</a>
              </p>
            </div>
          </div>
          <div className="hx-hero-visual">
            <HeroCarousel />
          </div>
        </div>
      </section>

      {/* The three things people come to do. */}
      <nav className="hx-tasks" aria-label={choose({ bn: "আপনি কী করতে চান", en: "What do you want to do" })}>
        <div className="ax-container hx-tasks-grid">
          {[
            {
              icon: "apply" as const,
              href: "/services",
              bn: "নতুন আবেদন",
              en: "Apply for a certificate",
              dBn: "সেবা বেছে নিন, নির্দেশিত ফরম পূরণ করে জমা দিন।",
              dEn: "Choose the service, fill the guided form and submit.",
            },
            {
              icon: "track" as const,
              href: "/tracking",
              bn: "আবেদনের অবস্থা",
              en: "Track an application",
              dBn: "জমার রেফারেন্স নম্বর দিয়ে দেখুন কোন ধাপে আছে।",
              dEn: "Use your reference number to see where it stands.",
            },
            {
              icon: "verify" as const,
              href: "/verify",
              bn: "সনদ যাচাই",
              en: "Verify a certificate",
              dBn: "QR স্ক্যান বা ১৬ সংখ্যার নম্বর — অ্যাকাউন্ট লাগে না।",
              dEn: "Scan the QR or type the 16-digit number — no account needed.",
            },
          ].map((t) => (
            <a key={t.href} className="hx-task" href={t.href}>
              <Icon name={t.icon} />
              <span>
                <strong>{choose({ bn: t.bn, en: t.en })}</strong>
                <small>{choose({ bn: t.dBn, en: t.dEn })}</small>
              </span>
            </a>
          ))}
        </div>
      </nav>

      <PublicOffers />

      {/* Popular services; the full 47 live on /services. */}
      <section className="hx-band" aria-labelledby="home-services-heading">
        <div className="ax-container">
          <div className="hx-band-head">
            <div>
              <h2 id="home-services-heading">
                {choose({ bn: "আমাদের সেবাসমূহ", en: "Our services" })}
              </h2>
              <p className="hx-lede">
                {choose({
                  bn: "সেবা বেছে নিন — কী কী লাগবে দেখে অনলাইনে আবেদন করুন।",
                  en: "Pick a service, see what you need, and apply online.",
                })}
              </p>
            </div>
            <a href="/services">{choose({ bn: "সব ৪৭টি সেবা", en: "All 47 services" })}</a>
          </div>
          <HomeServiceDirectory />
        </div>
      </section>

      {/* How it works — a real sequence, so it is numbered. */}
      <section className="hx-band hx-how" aria-labelledby="home-how-heading">
        <div className="ax-container">
          <h2 id="home-how-heading">
            {choose({ bn: "চার ধাপে সনদ", en: "Your certificate in four steps" })}
          </h2>
          <ol className="hx-steps">
            {[
              {
                bn: "অ্যাকাউন্ট খুলুন",
                en: "Create an account",
                dBn: "আপনার ইউনিয়ন বেছে নিন। নিবন্ধন সম্পূর্ণ ফ্রি।",
                dEn: "Choose your union. Registration is free.",
              },
              {
                bn: "আবেদন জমা দিন",
                en: "Submit the application",
                dBn: "নির্দেশিত ফরম পূরণ করুন, প্রয়োজনীয় নথি যুক্ত করুন।",
                dEn: "Fill the guided form and attach the documents asked for.",
              },
              {
                bn: "চেয়ারম্যানের যাচাই",
                en: "Chairman's review",
                dBn: "কিছু ঠিক করতে হলে কারণসহ জানানো হবে — নতুন করে শুরু করতে হয় না।",
                dEn: "If anything needs fixing you are told why — no need to start over.",
              },
              {
                bn: "সনদ ডাউনলোড",
                en: "Download the certificate",
                dBn: "বাংলা ও ইংরেজি PDF, QR কোডসহ।",
                dEn: "Bangla and English PDFs with a QR code.",
              },
            ].map((step, i) => (
              <li key={step.en}>
                <span className="hx-step-no" aria-hidden="true">
                  {choose({ bn: "০১২৩৪৫৬৭৮৯"[i + 1], en: String(i + 1) })}
                </span>
                <strong>{choose({ bn: step.bn, en: step.en })}</strong>
                <p>{choose({ bn: step.dBn, en: step.dEn })}</p>
              </li>
            ))}
          </ol>
          <a className="button" href="/register">
            {choose({ bn: "আবেদন শুরু করুন", en: "Start an application" })}
          </a>
        </div>
      </section>

      {/* Why trust it — the honest pillars, then the verified proof list. */}
      <section className="hx-band hx-trust" aria-labelledby="home-trust-heading">
        <div className="ax-container">
          <h2 id="home-trust-heading">
            {choose({ bn: "কেন নিশ্চিন্তে ব্যবহার করবেন", en: "Why you can rely on it" })}
          </h2>
          <ul className="hx-pillars">
            {[
              {
                icon: "chair" as const,
                bn: "চেয়ারম্যানই অনুমোদন দেন",
                en: "Your chairman approves",
                dBn: "প্রতিটি সনদ আপনার ইউনিয়নের চেয়ারম্যান নিজে যাচাই করে ইস্যু করেন — মাঝে কোনো দালাল নেই।",
                dEn: "Every certificate is checked and issued by your own union's chairman — no middleman.",
              },
              {
                icon: "verify" as const,
                bn: "যে কেউ যাচাই করতে পারে",
                en: "Anyone can verify it",
                dBn: "QR বা নম্বর দিয়ে ব্যাংক, অফিস বা স্কুল সঙ্গে সঙ্গে দেখতে পারে সনদটি আসল কিনা। সনদধারীর নাম আংশিক দেখায়, তাই নকল ধরা সহজ।",
                dEn: "Banks, employers and schools can check a certificate instantly by QR or number. The holder's name shows partly masked, so forgeries are easy to spot.",
              },
              {
                icon: "lock" as const,
                bn: "আপনার তথ্য আপনার অফিসেই থাকে",
                en: "Your data stays with your office",
                dBn: "আপনার আবেদন ও নথি শুধু আপনার ইউনিয়ন অফিস দেখতে পায়; অন্য কোনো অফিস নয়।",
                dEn: "Only your own union office can see your applications and documents.",
              },
              {
                icon: "info" as const,
                bn: "আমরা কারা, স্পষ্টভাবে",
                en: "Who we are, plainly",
                dBn: "DigitalUnion একটি বেসরকারি প্ল্যাটফর্ম, যা ইউনিয়ন পরিষদ অফিসগুলো ব্যবহার করে। সরকারি সিস্টেমটি unionservices.gov.bd।",
                dEn: "DigitalUnion is a private platform used by Union Parishad offices. The government system is unionservices.gov.bd.",
              },
            ].map((p) => (
              <li key={p.en}>
                <Icon name={p.icon} />
                <strong>{choose({ bn: p.bn, en: p.en })}</strong>
                <p>{choose({ bn: p.dBn, en: p.dEn })}</p>
              </li>
            ))}
          </ul>
          <div className="hx-proof">
            <span className="hx-proof-label">{choose({ bn: "ইতিমধ্যে চালু", en: "Already live" })}</span>
            <TrustStrip />
          </div>
        </div>
      </section>

      {/* Verify box. */}
      <section className="hx-band hx-verify" aria-labelledby="home-verify-heading">
        <div className="ax-container hx-verify-grid">
          <div>
            <h2 id="home-verify-heading">
              {choose({ bn: "একটি সনদ যাচাই করুন", en: "Check a certificate" })}
            </h2>
            <p className="hx-lede">
              {choose({
                bn: "সনদের ১৬ সংখ্যার নম্বর, QR লিংক বা যাচাই কোড লিখুন। ফ্রি, অ্যাকাউন্ট লাগে না।",
                en: "Enter the certificate's 16-digit number, QR link or verification code. Free, no account needed.",
              })}
            </p>
            <form className="hx-verify-form" onSubmit={submitVerify}>
              <label htmlFor="home-verify-input">
                {choose({ bn: "সনদ নম্বর বা QR লিংক", en: "Certificate number or QR link" })}
              </label>
              <div className="hx-verify-row">
                <input
                  id="home-verify-input"
                  inputMode="text"
                  value={verifyInput}
                  placeholder={choose({ bn: "যেমন: ২০২৬১১১৮১২৩৪৫৬৭৮", en: "e.g. 2026111812345678" })}
                  onChange={(e) => {
                    setVerifyInput(e.target.value);
                    setVerifyError("");
                  }}
                  aria-invalid={verifyError ? true : undefined}
                  aria-describedby={verifyError ? "home-verify-error" : undefined}
                />
                <button type="submit">{choose({ bn: "যাচাই করুন", en: "Verify" })}</button>
              </div>
              {verifyError && (
                <p id="home-verify-error" role="alert" className="hx-verify-error">
                  {verifyError}
                </p>
              )}
            </form>
            <p className="hx-verify-alt">
              {choose({ bn: "আবেদনের অবস্থা দেখতে চান?", en: "Checking an application instead?" })}{" "}
              <a href="/tracking">{choose({ bn: "আবেদন ট্র্যাক করুন", en: "Track it here" })}</a>
            </p>
          </div>
          <VerifyResultSample />
        </div>
      </section>

      {/* For offices — the business pitch: outcome, workflow sample,
          onboarding steps, one action. */}
      <section className="hx-offices" id="for-offices" aria-labelledby="home-offices-heading">
        <div className="ax-container">
          <div className="hx-offices-grid">
            <div className="hx-offices-copy">
              <p className="hx-offices-kicker">
                {choose({ bn: "ইউনিয়ন পরিষদ অফিসের জন্য", en: "For Union Parishad offices" })}
              </p>
              <h2 id="home-offices-heading">
                {choose({
                  bn: "খাতা-কলম ছাড়াই আবেদন থেকে সনদ, এক জায়গায়",
                  en: "From application to certificate in one place, without the paper register",
                })}
              </h2>
              <p className="hx-offices-lede">
                {choose({
                  bn: "নাগরিক অনলাইনে আবেদন করেন, আপনার অফিস এক স্ক্রিনে যাচাই করে, সনদ তৈরি হয় অফিসের লোগো ও চেয়ারম্যানের স্বাক্ষরসহ।",
                  en: "Citizens apply online, your office reviews on one screen, and the certificate is produced with your logo and the chairman's signature.",
                })}
              </p>
              <ul className="hx-offices-points">
                {[
                  {
                    icon: "inbox" as const,
                    bn: "সব ৪৭টি সেবার আবেদন এক তালিকায়",
                    en: "Applications for all 47 services in one queue",
                  },
                  {
                    icon: "seal" as const,
                    bn: "আপনার লোগো, সিল ও স্বাক্ষরসহ দ্বিভাষিক সনদ",
                    en: "Bilingual certificates with your logo, seal and signature",
                  },
                  {
                    icon: "lock" as const,
                    bn: "প্রতিটি অফিসের তথ্য সম্পূর্ণ আলাদা",
                    en: "Each office's data kept fully separate",
                  },
                  {
                    icon: "fee" as const,
                    bn: "সেবা ফি আপনার অফিসই নির্ধারণ ও প্রকাশ করে",
                    en: "Your office sets and publishes its own service fees",
                  },
                ].map((p) => (
                  <li key={p.en}>
                    <Icon name={p.icon} />
                    {choose({ bn: p.bn, en: p.en })}
                  </li>
                ))}
              </ul>
            </div>
            <ChairmanQueueSample />
          </div>
          <div className="hx-onboard">
            <ol>
              {[
                { bn: "অফিস যুক্ত করার আবেদন পাঠান", en: "Send a request to add your office" },
                { bn: "প্ল্যাটফর্ম টিম যাচাই করে অফিস চালু করে", en: "The platform team verifies and activates it" },
                { bn: "চেয়ারম্যান ও কর্মী যুক্ত করে সেবা শুরু করুন", en: "Add your chairman and staff, then start serving" },
              ].map((s, i) => (
                <li key={s.en}>
                  <span aria-hidden="true">{choose({ bn: "০১২৩৪৫৬৭৮৯"[i + 1], en: String(i + 1) })}</span>
                  {choose({ bn: s.bn, en: s.en })}
                </li>
              ))}
            </ol>
            <div className="hx-onboard-actions">
              <a className="button hx-cta-light" href="/register-office">
                {choose({ bn: "অফিস যুক্ত করার আবেদন করুন", en: "Request to add your office" })}
              </a>
              <a className="hx-onboard-link" href="/login">
                {choose({ bn: "ইতিমধ্যে যুক্ত? অফিস লগইন", en: "Already on board? Office sign-in" })}
              </a>
            </div>
          </div>
          <OfficePhotoBand />
        </div>
      </section>

      {/* FAQ — including the mandatory government-website answer. */}
      <section className="hx-band" aria-labelledby="home-faq-heading">
        <div className="ax-container hx-faq">
          <div className="hx-faq-head">
            <h2 id="home-faq-heading">
              {choose({ bn: "সাধারণ জিজ্ঞাসা", en: "Common questions" })}
            </h2>
            <p className="hx-lede">
              {choose({
                bn: "উত্তর না পেলে সহায়তা পৃষ্ঠা দেখুন বা আপনার ইউনিয়ন অফিসে যোগাযোগ করুন।",
                en: "Not answered here? See the help page or contact your union office.",
              })}
            </p>
            <a href="/help">{choose({ bn: "সহায়তা পৃষ্ঠা", en: "Help page" })}</a>
          </div>
          <div className="hx-faq-list">
            {FAQS.map((item) => (
              <details key={item.q.en} className="hx-faq-item">
                <summary>{choose(item.q)}</summary>
                <p>{choose(item.a)}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </PublicShell>
  );
}
