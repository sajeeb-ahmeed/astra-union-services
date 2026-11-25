import React, { useEffect, useState } from "react";
import { api, items } from "./api.js";
import { choose, useLanguage } from "./i18n.js";
import serviceCatalog from "./public-service-catalog.json" with { type: "json" };
import { PublicShell } from "./PublicShell.js";
import { PublicOffers } from "./GlobalNotices.js";
import { categoryLabel } from "./service-categories.js";
import { servicePath } from "./service-slugs.js";
import { HomeServiceDirectory, NoticeTicker } from "./HomeServiceDirectory.js";
import { HeroCarousel } from "./HeroCarousel.js";
import "./public-home.css";

import { certificateNumberInput, verificationToken } from "./verify-input.js";
import { HOME_SEO } from "./seo/service-seo.js";
import { applyPageHead } from "./seo/head.js";
import { navigate } from "./navigate.js";
import { useWitnessAvailable } from "./witness-availability.js";

export { certificateNumberInput, verificationToken } from "./verify-input.js";

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";

/**
 * PORTAL-A (supersedes HOME-REDESIGN-01/02): the homepage as a public
 * service portal — the layout people already know from union service
 * sites. Services come first; the quick jobs (track, verify, office
 * sign-up, help) sit in a side column; nothing else competes.
 *
 *   notice ticker → compact hero (find a certificate · register/sign in)
 *   → [ all services + four steps ] [ track · verify · offices · help ]
 *
 * The long explanatory bands (trust pillars, the office pitch, the FAQ
 * list) moved out: the FAQ lives on /help, office onboarding on
 * /register-office, and the "not a government website" statement stays
 * in the footer on every page.
 */
export function PublicHome() {
  const [lang] = useLanguage();
  // L-004: the witness help-card link hides once the options list is
  // confirmed empty (fail-open while unknown).
  const witnessAvailable = useWitnessAvailable();
  // L-006: idle-prefetch the portal chunk so the first navigation from
  // home to a portal page does not wait on a lazy chunk (and its loading
  // panel). requestIdleCallback keeps this off first paint; if the
  // prefetch fails the lazy import retries on demand (M-003).
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
  const [trackInput, setTrackInput] = useState("");
  const [trackError, setTrackError] = useState("");
  const [verifyInput, setVerifyInput] = useState("");
  const [verifyError, setVerifyError] = useState("");
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
    .replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)))
    .toLowerCase()
    .normalize("NFC");
  const matches = normalized
    ? serviceCatalog
        .filter((s) =>
          `${s.service_no} ${s.name_bn} ${s.name_en}`.toLowerCase().normalize("NFC").includes(normalized),
        )
        .slice(0, 6)
    : [];
  function submitTrack(e: React.FormEvent) {
    e.preventDefault();
    const reference = trackInput.trim();
    if (!reference) {
      setTrackError(
        choose({
          bn: "আবেদনের রেফারেন্স নম্বরটি লিখুন।",
          en: "Enter the application reference.",
        }),
      );
      return;
    }
    // L-006: client-side — the tracking page reads ?searchText= on mount.
    navigate(`/tracking?searchText=${encodeURIComponent(reference)}`);
  }
  function submitVerify(e: React.FormEvent) {
    e.preventDefault();
    const number = certificateNumberInput(verifyInput);
    if (number) {
      // L-006: client-side — the App re-renders on the new pathname and
      // CertificateVerification fetches for the new number.
      navigate(`/verify?searchText=${encodeURIComponent(number)}`);
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
    navigate(`/verify/${encodeURIComponent(token)}`);
  }
  const steps = [
    { bn: "অ্যাকাউন্ট খুলুন", en: "Create an account", dBn: "নিবন্ধন সম্পূর্ণ ফ্রি।", dEn: "Registration is free." },
    {
      bn: "আবেদন জমা দিন",
      en: "Submit the application",
      dBn: "সেবা বেছে ফরম পূরণ করুন, নথি যুক্ত করুন।",
      dEn: "Pick the service, fill the form, attach documents.",
    },
    {
      bn: "চেয়ারম্যানের যাচাই",
      en: "Chairman's review",
      dBn: "কিছু ঠিক করতে হলে কারণসহ জানানো হবে।",
      dEn: "If anything needs fixing, you are told why.",
    },
    {
      bn: "সনদ ডাউনলোড",
      en: "Download the certificate",
      dBn: "বাংলা ও ইংরেজি PDF, QR কোডসহ।",
      dEn: "Bangla and English PDFs with a QR code.",
    },
  ];
  return (
    // L-006: the shell's links navigate client-side — without onNavigate
    // every header/drawer/footer link was a plain <a href> and a click
    // from the homepage was a full page load (and another splash).
    <PublicShell current="/" onNavigate={(href) => navigate(href)}>
      {notices && notices.length > 0 && <NoticeTicker notices={notices} />}
      {/* Compact hero: one search, register / sign in, and the carousel. */}
      <section className="hx-hero hx-hero-compact">
        <div className="du-container hx-hero-grid">
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
            <form
              className="hx-search"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                if (matches.length) navigate(servicePath(matches[0].service_no));
                else navigate("/services");
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
          {/* PORTAL-E2 (owner, 23 Nov 2026): the carousel returns — it
              builds trust. Its scenes are AI-generated, so each keeps its
              existing "প্রতীকী ছবি / Illustrative image" tag. */}
          <div className="hx-hero-visual">
            <HeroCarousel />
          </div>
        </div>
      </section>

      <PublicOffers />

      <div className="du-container hp-layout">
        <div className="hp-main">
          {/* Every service, narrowed by category or typing. */}
          <section className="hp-panel" aria-labelledby="home-services-heading">
            <div className="hp-panel-head">
              <h2 id="home-services-heading">
                {choose({ bn: "সনদের সেবাসমূহ", en: "Certificate services" })}
              </h2>
              <a href="/services">{choose({ bn: "সব ৪৭টি সেবা", en: "All 47 services" })}</a>
            </div>
            <HomeServiceDirectory showCategories={false} />
          </section>

          {/* How it works — a real sequence, so it is numbered. */}
          <section className="hp-panel" aria-labelledby="home-how-heading">
            <div className="hp-panel-head">
              <h2 id="home-how-heading">
                {choose({ bn: "চার ধাপে সনদ", en: "Your certificate in four steps" })}
              </h2>
            </div>
            <ol className="hx-steps hp-steps">
              {steps.map((step, i) => (
                <li key={step.en}>
                  <span className="hx-step-no" aria-hidden="true">
                    {choose({ bn: BN_DIGITS[i + 1], en: String(i + 1) })}
                  </span>
                  <strong>{choose({ bn: step.bn, en: step.en })}</strong>
                  <p>{choose({ bn: step.dBn, en: step.dEn })}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="hp-aside" aria-label={choose({ bn: "দ্রুত কাজ", en: "Quick tasks" })}>
          <section className="hp-card" aria-labelledby="home-track-heading">
            <h2 id="home-track-heading">
              {choose({ bn: "আবেদনের অবস্থা জানুন", en: "Track an application" })}
            </h2>
            <form className="hp-form" onSubmit={submitTrack} noValidate>
              <label htmlFor="home-track-input">
                {choose({ bn: "আবেদনের রেফারেন্স নম্বর", en: "Application reference" })}
              </label>
              <div className="hx-verify-row">
                <input
                  id="home-track-input"
                  value={trackInput}
                  placeholder={choose({ bn: "যেমন: ২০২৬১১১৮১২৩৪৫৬৭৮", en: "e.g. 2026111812345678" })}
                  onChange={(e) => {
                    setTrackInput(e.target.value);
                    setTrackError("");
                  }}
                  aria-invalid={trackError ? true : undefined}
                  aria-describedby={trackError ? "home-track-error" : undefined}
                />
                <button type="submit">{choose({ bn: "দেখুন", en: "Track" })}</button>
              </div>
              {trackError && (
                <p id="home-track-error" role="alert" className="hx-verify-error">
                  {trackError}
                </p>
              )}
            </form>
          </section>

          <section className="hp-card" aria-labelledby="home-verify-heading">
            <h2 id="home-verify-heading">
              {choose({ bn: "একটি সনদ যাচাই করুন", en: "Check a certificate" })}
            </h2>
            <form className="hx-verify-form hp-form" onSubmit={submitVerify} noValidate>
              <label htmlFor="home-verify-input">
                {choose({ bn: "সনদ নম্বর বা QR লিংক", en: "Certificate number or QR link" })}
              </label>
              <div className="hx-verify-row">
                <input
                  id="home-verify-input"
                  inputMode="text"
                  value={verifyInput}
                  placeholder={choose({ bn: "১৬ সংখ্যার সনদ নম্বর", en: "16-digit certificate number" })}
                  onChange={(e) => {
                    setVerifyInput(e.target.value);
                    setVerifyError("");
                  }}
                  aria-invalid={verifyError ? true : undefined}
                  aria-describedby={verifyError ? "home-verify-error" : undefined}
                />
                <button type="submit">{choose({ bn: "যাচাই", en: "Verify" })}</button>
              </div>
              {verifyError && (
                <p id="home-verify-error" role="alert" className="hx-verify-error">
                  {verifyError}
                </p>
              )}
            </form>
            <p className="hp-card-note">
              {choose({ bn: "ফ্রি, অ্যাকাউন্ট লাগে না।", en: "Free, no account needed." })}
            </p>
          </section>

          <section className="hp-card hp-card-office" aria-labelledby="home-offices-heading">
            <h2 id="home-offices-heading">
              {choose({ bn: "ইউনিয়ন পরিষদ অফিসের জন্য", en: "For Union Parishad offices" })}
            </h2>
            <p>
              {choose({
                bn: "আপনার অফিস যুক্ত করুন — আবেদন যাচাই থেকে সনদ ইস্যু, এক জায়গায়।",
                en: "Add your office — from reviewing applications to issuing certificates, in one place.",
              })}
            </p>
            <a className="button" href="/register-office">
              {choose({ bn: "অফিস যুক্ত করার আবেদন", en: "Request to add your office" })}
            </a>
            <a className="hp-card-link" href="/login">
              {choose({ bn: "ইতিমধ্যে যুক্ত? অফিস লগইন", en: "Already on board? Office sign-in" })}
            </a>
          </section>

          <section className="hp-card" aria-labelledby="home-help-heading">
            <h2 id="home-help-heading">{choose({ bn: "সাহায্য", en: "Help" })}</h2>
            <ul className="hp-links">
              <li>
                <a href="/help">{choose({ bn: "সাধারণ জিজ্ঞাসা", en: "Common questions" })}</a>
              </li>
              <li>
                <a href="/guide">{choose({ bn: "ব্যবহার নির্দেশিকা", en: "User guide" })}</a>
              </li>
              {/* L-004: the witness link hides once the options list is
                  confirmed empty (fail-open while unknown). */}
              {witnessAvailable && (
                <li>
                  <a href="/witness">{choose({ bn: "সাক্ষীর প্রত্যয়ন তৈরি", en: "Make a witness statement" })}</a>
                </li>
              )}
              <li>
                <a href="/notices">{choose({ bn: "সব নোটিশ", en: "All notices" })}</a>
              </li>
            </ul>
          </section>
        </aside>
      </div>
    </PublicShell>
  );
}
