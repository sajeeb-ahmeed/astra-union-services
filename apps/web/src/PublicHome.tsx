import React, { useEffect, useState } from "react";
import { api, items } from "./api.js";
import { choose, useLanguage } from "./i18n.js";
import serviceCatalog from "./public-service-catalog.json" with { type: "json" };
import { CivicIcon } from "./PublicPortal.js";
import { PublicShell } from "./PublicShell.js";
import { PublicOffers } from "./GlobalNotices.js";
import { EmptyState, RailPanel, ServiceTile, StatCard, StatusPill, TitleBand } from "./ui/kit.js";
import "./public-home.css";

/** Accepts a full QR link (…/verify/<token>) or the bare token. */
export function verificationToken(input: string): string | null {
  const value = input.trim();
  const fromUrl = value.match(/\/verify\/([^/?#\s]+)/)?.[1];
  const token = fromUrl ?? value;
  return /^[A-Za-z0-9_-]{8,128}$/.test(token) ? token : null;
}

/**
 * Phase Y: official-format documents print the certificate number as the
 * verification key (/verify?searchText={no}). Accepts the number as printed —
 * Bangla digits included — and returns it normalised for the by-number lookup.
 */
export function certificateNumberInput(input: string): string | null {
  const value = input
    .trim()
    .replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d)));
  const fromUrl = value.match(/[?&]searchText=([^&#\s]+)/)?.[1];
  const number = (fromUrl ? decodeURIComponent(fromUrl) : value).toUpperCase();
  if (/^[A-F0-9]{64}$/.test(number)) return null; // that is a QR token, not a number
  return /^[A-Z0-9][A-Z0-9-]{3,79}$/.test(number) && number.includes("-")
    ? number
    : null;
}

const digits = (value: number) =>
  choose({ bn: value.toLocaleString("bn-BD"), en: String(value) });

/** Phase 1 slice (i): all services on one page with a right rail of everyday actions. */
export function PublicHome({ login }: { login?: React.ReactNode } = {}) {
  useLanguage();
  const [query, setQuery] = useState("");
  const [officeCount, setOfficeCount] = useState<number | null>(null);
  const [notices, setNotices] = useState<any[] | null>(null);
  const [verifyInput, setVerifyInput] = useState("");
  const [verifyError, setVerifyError] = useState("");
  const [trackInput, setTrackInput] = useState("");
  const [track, setTrack] = useState<{ busy: boolean; result?: any; error?: string }>({
    busy: false,
  });
  useEffect(() => {
    let active = true;
    api("/offices?pageSize=1")
      .then((r) => active && setOfficeCount(Number(r.total ?? 0)))
      .catch(() => active && setOfficeCount(null));
    api("/notices?pageSize=5")
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
  const services = serviceCatalog.filter((s) =>
    `${s.service_no} ${s.name_bn} ${s.name_en}`.toLowerCase().includes(normalized),
  );
  return (
    <PublicShell current="/">
      <TitleBand
        eyebrow={choose({ bn: "নাগরিক সেবা", en: "Citizen services" })}
        title={choose({
          bn: "আপনার প্রয়োজনীয় সেবাটি বেছে নিন",
          en: "Choose the service you need",
        })}
      >
        <div className="ax-home-search">
          <label htmlFor="ax-service-search">
            {choose({ bn: "সেবা খুঁজুন", en: "Search services" })}
          </label>
          <input
            id="ax-service-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={choose({
              bn: "সেবার নাম বা নম্বর লিখুন",
              en: "Type a service name or number",
            })}
          />
        </div>
        <div className="ax-home-stats">
          <StatCard
            value={digits(serviceCatalog.length)}
            label={choose({ bn: "অনলাইন সেবা", en: "Online services" })}
          />
          <StatCard
            value={officeCount === null ? "—" : digits(officeCount)}
            label={choose({ bn: "অংশগ্রহণকারী অফিস", en: "Participating offices" })}
          />
          <StatCard
            value="QR"
            label={choose({ bn: "যেকোনো সময় সনদ যাচাই", en: "Verify any certificate" })}
          />
        </div>
      </TitleBand>
      <PublicOffers />
      <div className="ax-container ax-home-layout">
        <section
          className="ax-home-services"
          aria-label={choose({ bn: "সব সেবা", en: "All services" })}
        >
          <p className="ax-home-count" role="status" aria-live="polite">
            {choose({
              bn: `${services.length.toLocaleString("bn-BD")}টি সেবা`,
              en: `${services.length} services`,
            })}
          </p>
          {services.length ? (
            <div className="ax-tile-grid">
              {services.map((s) => (
                <ServiceTile
                  key={s.service_no}
                  number={s.service_no}
                  href={`/services?service=${s.service_no}`}
                  icon={<CivicIcon index={s.service_no} />}
                  name={choose({ bn: s.name_bn, en: s.name_en })}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title={choose({
                bn: "এই নামে কোনো সেবা পাওয়া যায়নি।",
                en: "No service matches.",
              })}
              hint={choose({
                bn: "নামের ছোট অংশ বা নম্বর দিয়ে খুঁজুন।",
                en: "Try part of the name or the number.",
              })}
              action={
                <button type="button" className="secondary" onClick={() => setQuery("")}>
                  {choose({ bn: "সব সেবা দেখুন", en: "Show all services" })}
                </button>
              }
            />
          )}
        </section>
        <aside className="ax-home-rail">
          <RailPanel id="ax-rail-account" title={choose({ bn: "আপনার অ্যাকাউন্ট", en: "Your account" })}>
            {login ? (
              <div className="ax-rail-login">
                {login}
                <a className="ax-rail-more" href="/register">
                  {choose({ bn: "নতুন? নিবন্ধন করুন →", en: "New here? Register →" })}
                </a>
                <a className="ax-rail-more" href="/register-office">
                  {choose({ bn: "অফিস কর্মকর্তা? অ্যাকাউন্টের আবেদন →", en: "Office staff? Request an account →" })}
                </a>
              </div>
            ) : (
              <>
                <p className="ax-rail-text">
                  {choose({
                    bn: "আবেদন করতে লগইন করুন; নতুন হলে নিবন্ধন করুন।",
                    en: "Sign in to apply; register if you are new.",
                  })}
                </p>
                <div className="ax-rail-actions">
                  <a className="button" href="/login">
                    {choose({ bn: "লগইন", en: "Sign in" })}
                  </a>
                  <a className="button secondary" href="/register">
                    {choose({ bn: "নিবন্ধন", en: "Register" })}
                  </a>
                </div>
              </>
            )}
          </RailPanel>
          <RailPanel id="ax-rail-verify" title={choose({ bn: "সনদ যাচাই", en: "Verify a certificate" })}>
            <form
              onSubmit={(e) => {
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
                      bn: "সনদের QR লিংক বা যাচাই কোড সম্পূর্ণ লিখুন।",
                      en: "Enter the full QR link or verification code.",
                    }),
                  );
                  return;
                }
                location.assign(`/verify/${encodeURIComponent(token)}`);
              }}
            >
              <label htmlFor="ax-verify-input">
                {choose({ bn: "QR লিংক বা যাচাই কোড", en: "QR link or verification code" })}
              </label>
              <input
                id="ax-verify-input"
                value={verifyInput}
                onChange={(e) => {
                  setVerifyInput(e.target.value);
                  setVerifyError("");
                }}
              />
              {verifyError && (
                <p role="alert" className="ax-rail-error">
                  {verifyError}
                </p>
              )}
              <button type="submit">{choose({ bn: "যাচাই করুন", en: "Verify" })}</button>
            </form>
          </RailPanel>
          <RailPanel id="ax-rail-track" title={choose({ bn: "আবেদনের অবস্থা", en: "Track an application" })}>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setTrack({ busy: true });
                try {
                  setTrack({
                    busy: false,
                    result: await api(`/track/${encodeURIComponent(trackInput.trim())}`),
                  });
                } catch {
                  setTrack({
                    busy: false,
                    error: choose({
                      bn: "আবেদন পাওয়া যায়নি। সম্পূর্ণ রেফারেন্স দিয়ে আবার চেষ্টা করুন।",
                      en: "Application not found. Check the full reference and try again.",
                    }),
                  });
                }
              }}
            >
              <label htmlFor="ax-track-input">
                {choose({ bn: "আবেদনের রেফারেন্স", en: "Application reference" })}
              </label>
              <input
                id="ax-track-input"
                required
                value={trackInput}
                onChange={(e) => setTrackInput(e.target.value)}
              />
              <button type="submit" disabled={track.busy}>
                {choose({ bn: "অবস্থা দেখুন", en: "Check status" })}
              </button>
            </form>
            {track.error && (
              <p role="alert" className="ax-rail-error">
                {track.error}
              </p>
            )}
            {track.result && (
              <div className="ax-rail-result" role="status">
                <strong>{choose({ bn: track.result.serviceBn, en: track.result.serviceEn })}</strong>
                <StatusPill>{String(track.result.status)}</StatusPill>
                <small>{choose({ bn: track.result.officeBn, en: track.result.officeEn })}</small>
              </div>
            )}
          </RailPanel>
          <RailPanel id="ax-rail-notices" title={choose({ bn: "সাম্প্রতিক বিজ্ঞপ্তি", en: "Latest notices" })}>
            {notices === null ? (
              <p className="ax-rail-text">{choose({ bn: "লোড হচ্ছে…", en: "Loading…" })}</p>
            ) : notices.length ? (
              <ul className="ax-notice-list">
                {notices.map((n: any) => (
                  <li key={n.id}>
                    <a href="/notices">{choose({ bn: n.titleBn, en: n.titleEn })}</a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ax-rail-text">{choose({ bn: "কোনো বিজ্ঞপ্তি নেই।", en: "No notices yet." })}</p>
            )}
            <a className="ax-rail-more" href="/notices">
              {choose({ bn: "সব বিজ্ঞপ্তি →", en: "All notices →" })}
            </a>
          </RailPanel>
        </aside>
      </div>
    </PublicShell>
  );
}
