import React, { useEffect, useRef, useState } from "react";
import { api, items } from "./api.js";
import { choose, useLanguage } from "./i18n.js";
import serviceCatalog from "./public-service-catalog.json" with { type: "json" };
import { PublicShell } from "./PublicShell.js";
import { PublicOffers } from "./GlobalNotices.js";
import { ServiceCard, serviceCardMetaRich } from "./ui/kit.js";
import {
  loadServiceOfficeSummaries,
  type ServiceOfficeSummary,
} from "./service-office-summary.js";
import { categoryLabel } from "./service-categories.js";
import { servicePath } from "./service-slugs.js";
import { SampleCertificate, TrustStrip } from "./TrustVisual.js";
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

const POPULAR = [12, 2, 42, 1, 3, 8, 45, 35];
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

/**
 * FULL-UIUX-01: the homepage is a composed landing (BD-LANDING-PLAN-01's
 * 10-section blueprint), not the catalog. Hero → trust strip → notices →
 * service discovery → how it works (+ account) → verification spotlight →
 * for offices → onboarding CTA → FAQ → footer (shell). The full 47-service
 * grid lives only on /services. Every claim stays inside the BD verified
 * proof list; no invented statistics, no price table, no testimonials.
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
  // BUNDLE06-R5 C2: published fee/time summaries for the service cards.
  const [officeSummaries, setOfficeSummaries] =
    useState<Map<number, ServiceOfficeSummary> | null>(null);
  useEffect(() => {
    let active = true;
    void loadServiceOfficeSummaries().then((map) => {
      if (active) setOfficeSummaries(map);
    });
    return () => {
      active = false;
    };
  }, []);
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
    .toLowerCase();
  const matches = normalized
    ? serviceCatalog
        .filter((s) =>
          `${s.service_no} ${s.name_bn} ${s.name_en}`.toLowerCase().includes(normalized),
        )
        .slice(0, 6)
    : [];
  const popular = POPULAR.map((no) =>
    serviceCatalog.find((s) => s.service_no === no),
  ).filter(Boolean) as typeof serviceCatalog;
  const categories = [...new Set(serviceCatalog.map((s) => s.category_en))];
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
      {/* §2 Hero — the Civic Stage: deep-green stage, one dominant search,
          the certificate itself as the visual (marked sample). */}
      <section className="home-hero">
        <div className="ax-container home-hero-grid">
          <div className="home-hero-copy">
            <span className="home-hero-eyebrow">
              {choose({ bn: "ইউনিয়ন পরিষদের নাগরিক সেবা", en: "Union Parishad citizen services" })}
            </span>
            <h1>
              {choose({
                bn: "আপনার ইউনিয়নের সনদ, এখন অনলাইনে",
                en: "Your union's certificates, now online",
              })}
            </h1>
            <p className="home-hero-sub">
              {choose({
                bn: "ঘরে বসে আবেদন করুন — চেয়ারম্যানের অনুমোদনে QR-যাচাইযোগ্য সনদ, বাংলা ও ইংরেজি দুই ভাষাতেই।",
                en: "Apply from home — a QR-verifiable certificate with your chairman's approval, in Bangla and English.",
              })}
            </p>
            <form
              className="home-hero-search"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                if (matches.length) location.assign(servicePath(matches[0].service_no));
                else location.assign("/services");
              }}
            >
              <label htmlFor="home-service-search">
                {choose({ bn: "কোন সনদ লাগবে? খুঁজুন…", en: "Which certificate do you need? Search…" })}
              </label>
              <div className="home-hero-search-row">
                <input
                  id="home-service-search"
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onFocus={() => setSearchFocus(true)}
                  onBlur={() => window.setTimeout(() => setSearchFocus(false), 150)}
                  placeholder={choose({
                    bn: "সেবার নাম বা নম্বর লিখুন",
                    en: "Type a service name or number",
                  })}
                  autoComplete="off"
                />
                <button type="submit">
                  {choose({ bn: "খুঁজুন", en: "Search" })}
                </button>
              </div>
              {searchFocus && normalized && (
                <div className="home-hero-results">
                  {matches.length ? (
                    matches.map((s) => (
                      <a key={s.service_no} href={servicePath(s.service_no)}>
                        <strong>{choose({ bn: s.name_bn, en: s.name_en })}</strong>
                        <small>{choose(categoryLabel(s.category_en))}</small>
                      </a>
                    ))
                  ) : (
                    <p>
                      {choose({
                        bn: "এই নামে কোনো সেবা পাওয়া যায়নি। সব সেবা দেখুন →",
                        en: "No service by that name. See all services →",
                      })}
                    </p>
                  )}
                </div>
              )}
            </form>
            <div className="home-hero-ctas">
              <a className="button home-cta-primary" href="/register">
                {choose({ bn: "সনদের জন্য আবেদন করুন", en: "Apply for a certificate" })}
              </a>
              <a className="button home-cta-secondary" href="#for-offices">
                {choose({ bn: "আপনার ইউনিয়ন যুক্ত করুন", en: "Bring your union online" })}
              </a>
              <a className="home-hero-verify-link" href="/verify">
                {choose({ bn: "সনদ যাচাই করুন →", en: "Verify a certificate →" })}
              </a>
            </div>
          </div>
          <div className="home-hero-visual">
            <SampleCertificate />
            <p className="home-hero-visual-note">
              {choose({
                bn: "প্রতিটি সনদে থাকে ১৬ ডিজিটের নম্বর ও QR কোড — নমুনা চিত্র।",
                en: "Every certificate carries a 16-digit number and a QR code — sample shown.",
              })}
            </p>
          </div>
        </div>
      </section>
      <PublicOffers />
      {/* §3 Trust strip — verified proof only. */}
      <section className="home-band home-trust" aria-label={choose({ bn: "ইতিমধ্যে লাইভ", en: "Already live" })}>
        <div className="ax-container">
          <h2 className="home-band-title">
            {choose({ bn: "ইতিমধ্যে লাইভ", en: "Already live" })}
          </h2>
          <TrustStrip />
        </div>
      </section>
      {/* Notices band — every notice attributed to its office (checklist A15). */}
      {notices && notices.length > 0 && (
        <section
          className={`home-band home-notices${notices.length < 3 ? " is-ticker" : ""}`}
          aria-label={choose({ bn: "অফিসের বিজ্ঞপ্তি", en: "Office notices" })}
        >
          <div className="ax-container">
            <div className="home-band-head">
              <h2 className="home-band-title">
                {choose({ bn: "অফিসের বিজ্ঞপ্তি", en: "Office notices" })}
              </h2>
              <a href="/notices">{choose({ bn: "সব বিজ্ঞপ্তি →", en: "All notices →" })}</a>
            </div>
            <ul className="home-notice-list">
              {notices.map((n: any) => (
                <li key={n.id}>
                  <a href="/notices">{choose({ bn: n.titleBn, en: n.titleEn })}</a>
                  {/* REFINEMENT-02 P2-1: every notice carries its date +
                      office attribution chip. */}
                  <small>
                    <span className="home-notice-office">
                      {choose({ bn: n.officeBn, en: n.officeEn }) ||
                        choose({ bn: "প্ল্যাটফর্ম", en: "Platform" })}
                    </span>
                    {(n.createdAt ?? n.startsAt ?? n.created_at) && (
                      <span className="home-notice-date">
                        {fmt.date(n.createdAt ?? n.startsAt ?? n.created_at)}
                      </span>
                    )}
                  </small>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
      {/* §4 Service discovery — popular services + categories; the full
          grid lives only on /services. */}
      <section className="home-band" aria-labelledby="home-services-heading">
        <div className="ax-container">
          <h2 id="home-services-heading" className="home-band-title">
            {choose({ bn: "সব সেবা — ৪৭টি ইউনিয়ন সেবা", en: "All 47 union services" })}
          </h2>
          <p className="home-band-lede">
            {choose({
              bn: "যে সনদ বা লাইসেন্স লাগবে, খুঁজে নিন — তারপর আপনার ইউনিয়ন বেছে আবেদন করুন।",
              en: "Find the certificate or licence you need — then choose your union and apply.",
            })}
          </p>
          <div className="home-service-grid">
            {popular.map((s) => (
              <ServiceCard
                key={s.service_no}
                serviceNo={s.service_no}
                name={choose({ bn: s.name_bn, en: s.name_en })}
                category={s.category_en}
                href={servicePath(s.service_no)}
                feeHint={choose(
                  serviceCardMetaRich(
                    s.document_count,
                    officeSummaries?.get(s.service_no),
                  ),
                )}
              />
            ))}
          </div>
          <div className="home-category-row">
            {categories.map((c) => (
              <a key={c} className="home-category-chip" href="/services">
                {choose(categoryLabel(c))}
              </a>
            ))}
          </div>
          <a className="button secondary" href="/services">
            {choose({ bn: "সব ৪৭টি সেবা দেখুন", en: "See all 47 services" })}
          </a>
        </div>
      </section>
      {/* §5 How it works + the account card (the home sign-in lives here,
          at full usable width — checklist A10). */}
      <section className="home-band home-how" aria-labelledby="home-how-heading">
        <div className="ax-container home-how-grid">
          <div>
            <h2 id="home-how-heading" className="home-band-title">
              {choose({ bn: "কীভাবে সনদ পাবেন", en: "How to get your certificate" })}
            </h2>
            <ol className="home-steps">
              {[
                {
                  bn: "নিবন্ধন করুন — সম্পূর্ণ ফ্রি",
                  en: "Register — completely free",
                  dBn: "আপনার ইউনিয়ন বেছে নাগরিক অ্যাকাউন্ট খুলুন।",
                  dEn: "Choose your union and open a citizen account.",
                },
                {
                  bn: "আবেদন করুন",
                  en: "Apply",
                  dBn: "সেবা বেছে নির্দেশিত ফরম পূরণ করে জমা দিন।",
                  dEn: "Pick the service, fill the guided form and submit.",
                },
                {
                  bn: "চেয়ারম্যান যাচাই ও ইস্যু",
                  en: "Chairman verifies and issues",
                  dBn: "অনুমোদন চেয়ারম্যানের সিদ্ধান্ত; প্রয়োজনে তিনি সংশোধনের অনুরোধ পাঠাতে পারেন।",
                  dEn: "Approval is the chairman's decision; he may ask for a correction where needed.",
                },
                {
                  bn: "সনদ ডাউনলোড করুন",
                  en: "Download your certificate",
                  dBn: "বাংলা ও ইংরেজি PDF — QR দিয়ে যে কেউ যাচাই করতে পারবে।",
                  dEn: "Bangla and English PDFs — anyone can verify by QR.",
                },
              ].map((step, i) => (
                <li key={step.en}>
                  <span className="home-step-number">{choose({ bn: "০১২৩৪৫৬৭৮৯"[i + 1], en: String(i + 1) })}</span>
                  <div>
                    <strong>{choose({ bn: step.bn, en: step.en })}</strong>
                    <p>{choose({ bn: step.dBn, en: step.dEn })}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="home-account-card">
            <h2 className="home-band-title">
              {choose({ bn: "আপনার অ্যাকাউন্ট", en: "Your account" })}
            </h2>
            {/* REFINEMENT-02 P2-1: the full sign-in form no longer embeds
                mid-page (it duplicated /login and unbalanced the band);
                this is a compact CTA card to the split-screen login. The
                `login` prop is accepted for compatibility but not embedded. */}
            <p>
              {choose({
                bn: "আবেদন করতে লগইন করুন; নতুন হলে নিবন্ধন করুন — সম্পূর্ণ ফ্রি।",
                en: "Sign in to apply; register if you are new — completely free.",
              })}
            </p>
            <div className="home-account-actions">
              <a className="button" href="/login">
                {choose({ bn: "লগইন", en: "Sign in" })}
              </a>
              <a className="button secondary" href="/register">
                {choose({ bn: "নিবন্ধন", en: "Register" })}
              </a>
            </div>
            <a className="home-account-more" href="/register-office">
              {choose({
                bn: "অফিস কর্মকর্তা? অ্যাকাউন্টের আবেদন →",
                en: "Office staff? Request an account →",
              })}
            </a>
          </div>
        </div>
      </section>
      {/* §6 Verification spotlight — the verify box, framed (checklist A8). */}
      <section className="home-band home-verify" aria-labelledby="home-verify-heading">
        <div className="ax-container home-verify-grid">
          <div>
            <h2 id="home-verify-heading" className="home-band-title">
              {choose({
                bn: "সনদ যাচাই — যে কেউ, যেকোনো সময়",
                en: "Verify a certificate — anyone, anytime",
              })}
            </h2>
            <p className="home-band-lede">
              {choose({
                bn: "সনদের QR কোড স্ক্যান করুন বা ১৬ ডিজিটের নম্বরটি লিখুন — অ্যাকাউন্ট ছাড়াই, ফ্রি।",
                en: "Scan the certificate's QR code or type its 16-digit number — no account, no fee.",
              })}
            </p>
            <form className="home-verify-form" onSubmit={submitVerify}>
              <label htmlFor="home-verify-input">
                {choose({ bn: "সনদ নম্বর, QR লিংক বা যাচাই কোড", en: "Certificate number, QR link or verification code" })}
              </label>
              <div className="home-verify-row">
                <input
                  id="home-verify-input"
                  value={verifyInput}
                  onChange={(e) => {
                    setVerifyInput(e.target.value);
                    setVerifyError("");
                  }}
                />
                <button type="submit">{choose({ bn: "যাচাই করুন", en: "Verify" })}</button>
              </div>
              {verifyError && (
                <p role="alert" className="home-verify-error">
                  {verifyError}
                </p>
              )}
            </form>
            <p className="home-verify-alt">
              <a href="/tracking">
                {choose({ bn: "আবেদনের অবস্থা দেখতে চান? →", en: "Checking an application instead? →" })}
              </a>
            </p>
          </div>
          <SampleCertificate compact />
        </div>
      </section>
      {/* §7 For offices. */}
      <section className="home-band home-offices" id="for-offices" aria-labelledby="home-offices-heading">
        <div className="ax-container">
          <h2 id="home-offices-heading" className="home-band-title">
            {choose({ bn: "ইউনিয়ন অফিসের জন্য", en: "For Union Parishad offices" })}
          </h2>
          <p className="home-band-lede">
            {choose({
              bn: "আবেদন অনলাইনে আসবে, চেয়ারম্যান যাচাই করে ইস্যু করবেন, নাগরিক যাচাইযোগ্য সনদ পাবেন — খাতা-কলমের ঝামেলা ছাড়া।",
              en: "Applications arrive online, the chairman verifies and issues, citizens receive a verifiable certificate — without the paper register.",
            })}
          </p>
          <ul className="home-office-points">
            {[
              { bn: "সব ৪৭টি সেবার অনলাইন আবেদন", en: "Online applications for all 47 services" },
              { bn: "চেয়ারম্যান সরাসরি যাচাই ও ইস্যু — মাঝখানে অতিরিক্ত ধাপ নেই", en: "Chairman-direct verification and issuance — no middleman step" },
              { bn: "অফিসের নিজের লোগো ও চেয়ারম্যানের স্বাক্ষরসহ সনদ", en: "Certificates with the office's own logo and the chairman's signature" },
              { bn: "প্রতিটি অফিসের ডেটা সম্পূর্ণ আলাদা ও নিরাপদ", en: "Each office's data fully separate" },
              { bn: "অফিস নিজেই সেবা ফি নির্ধারণ ও প্রকাশ করে", en: "The office sets and publishes its own service fees" },
              { bn: "সাবস্ক্রিপশন ও ক্রেডিট প্ল্যাটফর্ম কর্তৃপক্ষের নিয়ন্ত্রণে; নিবন্ধন ফ্রি", en: "Subscription and credits controlled by the platform owner; registration is free" },
            ].map((point) => (
              <li key={point.en}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m4.5 12.5 5 5 10-11" />
                </svg>
                {choose(point)}
              </li>
            ))}
          </ul>
          <OfficePhotoBand />
        </div>
      </section>
      {/* §8 Onboarding CTA. */}
      <section className="home-band home-onboard" aria-labelledby="home-onboard-heading">
        <div className="ax-container home-onboard-inner">
          <div>
            <h2 id="home-onboard-heading" className="home-band-title">
              {choose({
                bn: "আপনার ইউনিয়ন পরিষদ অনলাইনে আনুন",
                en: "Take your Union Parishad online",
              })}
            </h2>
            <p>
              {choose({
                bn: "আবেদন পাওয়ার পর প্ল্যাটফর্ম টিম অফিসটি যাচাই করে চালু করে দেবে।",
                en: "Once your request arrives, the platform team verifies and activates the office.",
              })}
            </p>
          </div>
          <a className="button" href="/register-office">
            {choose({ bn: "অফিস যুক্ত করার আবেদন করুন", en: "Request to add your office" })}
          </a>
        </div>
      </section>
      {/* §9 FAQ — including the mandatory government-website answer. */}
      <section className="home-band" aria-labelledby="home-faq-heading">
        <div className="ax-container home-faq">
          <h2 id="home-faq-heading" className="home-band-title">
            {choose({ bn: "সাধারণ জিজ্ঞাসা", en: "Frequently asked questions" })}
          </h2>
          {FAQS.map((item) => (
            <details key={item.q.en} className="home-faq-item">
              <summary>{choose(item.q)}</summary>
              <p>{choose(item.a)}</p>
            </details>
          ))}
          <p className="home-faq-more">
            <a href="/help">
              {choose({ bn: "আরও সহায়তা ও জিজ্ঞাসা →", en: "More help and questions →" })}
            </a>
          </p>
        </div>
      </section>
    </PublicShell>
  );
}
