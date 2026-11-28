import React, { useEffect, useState, useSyncExternalStore } from "react";
import { HelpWidget, UtilityBar } from "./PublicHelp.js";
import { useSupportContact } from "./support-contact.js";
import { useWitnessAvailable } from "./witness-availability.js";
import { choose, useLanguage } from "./i18n.js";
import { useBranding } from "./branding.js";
import { hasPageHead } from "./seo/head.js";
import { GlobalNoticeBanner } from "./GlobalNotices.js";
import { DemoModeBanner } from "./DemoModeBanner.js";
import "./ui/kit.js";
import { BrandLockup } from "./BrandLockup.js";
import "./public-shell.css";
import "./du-shell.css";
import "./portal-shell.css";

/**
 * Phase UX: the one public shell — header, menu, footer — for every
 * signed-out surface (home, office registration, certificate verification,
 * and the citizen portal via its navigation adapter).
 *
 * Menu system: on desktop/tablet a top navigation bar; on phones a bottom
 * navigation bar (home · services · track · verify · menu) plus a drawer
 * with the full page list. Exactly one element carries the "Public
 * navigation" label at any viewport.
 */
/* PORTAL-A (prottoyon-style portal): one flat menu, no dropdowns — the
   things citizens come for, in the order they need them. Notices and the
   witness generator stay on the home help card, the drawer and the footer
   (the witness generator offers nothing until the owner enters its
   options, so it is not promoted to the menu). */
/* PORTAL-LANDING: the owner's reference portal menu. "Union offices" moved
   to the home help panel, the footer and the drawer. */
export const PUBLIC_NAV = [
  { href: "/", bn: "হোম", en: "Home" },
  { href: "/services", bn: "নাগরিক সেবা", en: "Services" },
  { href: "/tracking", bn: "আবেদনের অবস্থা", en: "Track application" },
  { href: "/verify", bn: "সনদ যাচাই", en: "Verify certificate" },
  { href: "/notices", bn: "নোটিশ বোর্ড", en: "Notice board" },
  { href: "/#steps", bn: "সেবা পাওয়ার ধাপ", en: "How it works" },
  { href: "/help", bn: "সাধারণ জিজ্ঞাসা", en: "Help & FAQ" },
] as const;

const DRAWER_EXTRA = [
  // R10LIVE-WSF (AUTH-NAV): the phone header now keeps its Register
  // button; the drawer still carries the same door under its "create an
  // account" label as a second entry point.
  { href: "/register", bn: "নতুন অ্যাকাউন্ট খুলুন", en: "Create an account" },
  { href: "/offices", bn: "ইউনিয়ন অফিস", en: "Union offices" },
  { href: "/witness", bn: "সাক্ষীর প্রত্যয়ন", en: "Witness statement" },
  { href: "/guide", bn: "ব্যবহার নির্দেশিকা", en: "User guide" },
  { href: "/policies", bn: "নীতি", en: "Policies" },
  { href: "/privacy", bn: "গোপনীয়তা নীতি", en: "Privacy policy" },
  { href: "/terms", bn: "ব্যবহারের শর্তাবলী", en: "Terms of use" },
  { href: "/register-office", bn: "অফিস অ্যাকাউন্ট খুলুন", en: "Open an office account" },
] as const;

/** Pages outside the citizen portal's page set (and the home page's step
    anchor, which the portal's page router cannot address): always a real
    page load. */
const HARD_LINKS = new Set(["/register-office", "/#steps"]);

const QUICK_NAV = [
  { href: "/", shortBn: "হোম", shortEn: "Home", fullBn: "হোম", fullEn: "Home" },
  { href: "/services", shortBn: "সেবা", shortEn: "Services", fullBn: "নাগরিক সেবা", fullEn: "Services" },
  { href: "/tracking", shortBn: "অবস্থা", shortEn: "Track", fullBn: "আবেদনের অবস্থা", fullEn: "Track application" },
  { href: "/verify", shortBn: "যাচাই", shortEn: "Verify", fullBn: "সনদ যাচাই", fullEn: "Verify certificate" },
] as const;

function usePhone(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia("(max-width: 767px)");
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(max-width: 767px)").matches,
    () => false,
  );
}

export type ShellNavigate = (href: string) => void;

function NavLink({
  href,
  current,
  onNavigate,
  className,
  ariaLabel,
  children,
  onDone,
}: {
  href: string;
  current?: string;
  onNavigate?: ShellNavigate;
  className?: string;
  ariaLabel?: string;
  children: React.ReactNode;
  onDone?: () => void;
}) {
  const active = current === href;
  if (onNavigate && !HARD_LINKS.has(href))
    // L-006 follow-up: navigation stays a real <a href> — a <button>
    // broke link semantics (screen readers, middle-click / new tab,
    // right-click copy-link, crawlers) and every getByRole("link")
    // query in the browser suite. A plain left-click is intercepted
    // here (preventDefault + onNavigate, no reload); the delegated
    // interceptor in navigate.ts sees defaultPrevented and stands down,
    // so the navigation runs exactly once. Modified clicks keep the
    // browser default (new tab).
    return (
      <a
        className={className}
        href={href}
        aria-current={active ? "page" : undefined}
        aria-label={ariaLabel}
        onClick={(event) => {
          if (
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          )
            return;
          event.preventDefault();
          onDone?.();
          onNavigate(href);
        }}
      >
        {children}
      </a>
    );
  return (
    <a
      className={className}
      href={href}
      aria-current={active ? "page" : undefined}
      aria-label={ariaLabel}
    >
      {children}
    </a>
  );
}

const SHELL_ICONS: Record<string, React.ReactNode> = {
  building: <path d="M4 20.5h16M6 20.5V9l6-4.5 6 4.5v11.5M9.5 20.5v-5h5v5M9.5 11h1M13.5 11h1" />,
  user: <path d="M10 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM3.5 20a6.5 6.5 0 0 1 13 0M18.5 8.5v5M16 11h5" />,
  login: <path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14M10 8l4 4-4 4M14 12H4" />,
};
function ShellIcon({ name }: { name: keyof typeof SHELL_ICONS }) {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {SHELL_ICONS[name]}
    </svg>
  );
}

export function SiteHeader({
  current,
  onNavigate,
  account,
  bottomNav = true,
  navItems,
}: {
  current: string;
  onNavigate?: ShellNavigate;
  account?: React.ReactNode;
  /** Phone bottom navigation (public shell). The citizen portal keeps its
      full button navigation at every width and passes false. */
  bottomNav?: boolean;
  /** Full top-navigation override (the portal's own page labels). */
  navItems?: readonly { href: string; bn: string; en: string }[];
}) {
  useLanguage();
  const branding = useBranding();
  // L-004: the witness entry points hide once the options list is
  // confirmed empty (fail-open while unknown — see witness-availability.ts).
  const witnessAvailable = useWitnessAvailable();
  useEffect(() => {
    // SEO P5: a page that applied its own head (seo/head.ts) owns the
    // title; the branding default must not overwrite it when the branding
    // fetch resolves after the page's head effect ran.
    if (!hasPageHead()) document.title = `${branding.name} — ${branding.taglineBn}`;
  }, [branding]);
  const phone = usePhone();
  const [drawer, setDrawer] = useState(false);
  useEffect(() => {
    if (!drawer) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawer(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [drawer]);
  const navLabel = choose({ bn: "প্রধান মেনু", en: "Public navigation" });
  return (
    <>
      {/* BUNDLE06-R5 C3: the old dark welcome strip (.du-topline) is
          gone — the header is now two bars (brand row + nav row). The
          welcome line rides inside the brand row as muted text and is
          hidden on phones, where the bottom nav carries the chrome. */}
      {/* PORTAL-LANDING: the utility bar (date · platform · text size ·
          language · hotline · help) tops every public surface, home and
          portal pages alike. */}
      <UtilityBar />
      <header className="du-header">
        <div className="du-container du-header-row">
          <NavLink
            href="/"
            onNavigate={onNavigate}
            className="du-brand"
            ariaLabel={choose({ bn: `${branding.name} হোম`, en: `${branding.name} home` })}
          >
            {/* FULL-UIUX-01 · OWNER-DECISION 4: the one platform lockup —
                mark + BN/EN wordmark; it never wraps or swaps variants. */}
            <BrandLockup size={46} />
          </NavLink>
          <div className="du-header-actions">
            {account ?? (
              <>
                {/* PORTAL-LANDING: office account · register · login, the
                    reference portal's three doors in its order. */}
                <NavLink
                  href="/register-office"
                  onNavigate={onNavigate}
                  className="du-btn du-btn-text du-btn-office"
                >
                  <ShellIcon name="building" />
                  {choose({ bn: "অফিস অ্যাকাউন্ট", en: "Office account" })}
                </NavLink>
                <NavLink href="/register" onNavigate={onNavigate} className="du-btn du-btn-ghost">
                  <ShellIcon name="user" />
                  {choose({ bn: "নিবন্ধন", en: "Register" })}
                </NavLink>
                <NavLink href="/login" onNavigate={onNavigate} className="du-btn du-btn-primary">
                  <ShellIcon name="login" />
                  {choose({ bn: "লগইন", en: "Login" })}
                </NavLink>
              </>
            )}
          </div>
        </div>
        {(!phone || !bottomNav) && (
          <nav className="du-topnav" aria-label={navLabel}>
            <div className="du-container du-topnav-row">
              {(navItems ?? PUBLIC_NAV).map((item) => (
                <NavLink
                  key={item.href}
                  href={item.href}
                  current={current}
                  onNavigate={onNavigate}
                  className="du-navlink"
                >
                  {choose({ bn: item.bn, en: item.en })}
                </NavLink>
              ))}
            </div>
          </nav>
        )}
      </header>
      {phone && bottomNav && (
        <>
          <nav className="du-bottomnav" aria-label={navLabel}>
            {QUICK_NAV.map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                current={current}
                onNavigate={onNavigate}
                className="du-quicklink"
                ariaLabel={choose({ bn: item.fullBn, en: item.fullEn })}
              >
                {choose({ bn: item.shortBn, en: item.shortEn })}
              </NavLink>
            ))}
            <button
              type="button"
              className="du-quicklink"
              aria-haspopup="dialog"
              aria-expanded={drawer}
              onClick={() => setDrawer(true)}
            >
              {choose({ bn: "মেনু", en: "Menu" })}
            </button>
          </nav>
          {drawer && (
            <div className="du-drawer-backdrop" onClick={() => setDrawer(false)}>
              <div
                className="du-drawer"
                role="dialog"
                aria-modal="true"
                aria-label={choose({ bn: "সব পৃষ্ঠা", en: "All pages" })}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="du-drawer-head">
                  <strong>{choose({ bn: "সব পৃষ্ঠা", en: "All pages" })}</strong>
                  <button type="button" className="du-btn du-btn-ghost" onClick={() => setDrawer(false)}>
                    {choose({ bn: "বন্ধ করুন", en: "Close" })}
                  </button>
                </div>
                {[...PUBLIC_NAV, ...DRAWER_EXTRA]
                  .filter((item) => witnessAvailable || item.href !== "/witness")
                  .map((item) => (
                  <NavLink
                    key={item.href}
                    href={item.href}
                    current={current}
                    onNavigate={onNavigate}
                    className="du-drawer-link"
                    onDone={() => setDrawer(false)}
                  >
                    {choose({ bn: item.bn, en: item.en })}
                  </NavLink>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

export function SiteFooter({
  onNavigate,
  servicesSlot,
  subscribeSlot,
  bottomLine,
}: {
  onNavigate?: ShellNavigate;
  servicesSlot?: React.ReactNode;
  subscribeSlot?: React.ReactNode;
  bottomLine?: React.ReactNode;
}) {
  useLanguage();
  const branding = useBranding();
  // F-001: the owner-configured support contact (empty until set).
  const contact = useSupportContact();
  // L-004: the witness quick link hides once the options list is
  // confirmed empty (fail-open while unknown).
  const witnessAvailable = useWitnessAvailable();
  const link = (href: string, bn: string, en: string, key?: string) => (
    <li key={key ?? href}>
      <NavLink href={href} onNavigate={onNavigate} className="du-footlink">
        {choose({ bn, en })}
      </NavLink>
    </li>
  );
  return (
    <footer className="du-footer">
      <div className="du-container du-footer-grid">
        <div className="du-footer-brand">
          <BrandLockup size={40} tagline />
          <p className="du-footer-about">
            {choose({
              bn: "ইউনিয়ন পরিষদের ৪৭টি সনদ ও প্রত্যয়নের অনলাইন আবেদন, চেয়ারম্যানের ইস্যু করা QR যাচাইযোগ্য সনদ এবং আবেদনের অবস্থা জানার একক প্ল্যাটফর্ম।",
              en: "One platform to apply online for the Union Parishad's 47 certificates, get QR-verifiable certificates issued by the Chairman, and follow your application.",
            })}
          </p>
        </div>
        <nav aria-label={choose({ bn: "নাগরিক সেবা", en: "Citizen services" })}>
          <h3>{choose({ bn: "নাগরিক সেবা", en: "Citizen services" })}</h3>
          {servicesSlot ?? (
            <ul>
              {link("/services", "সব নাগরিক সেবা", "All citizen services", "services-all")}
              {link("/register", "নতুন অ্যাকাউন্ট খুলুন", "Create an account")}
              {link("/tracking", "আবেদনের অবস্থা", "Track application")}
              {link("/verify", "সনদ যাচাই", "Verify certificate")}
              {witnessAvailable && link("/witness", "সাক্ষীর প্রত্যয়ন", "Witness statement")}
            </ul>
          )}
        </nav>
        <nav aria-label={choose({ bn: "ইউনিয়ন অফিস", en: "Union offices" })}>
          <h3>{choose({ bn: "ইউনিয়ন অফিস", en: "Union offices" })}</h3>
          <ul>
            {link("/offices", "অংশগ্রহণকারী অফিস", "Participating offices")}
            {link("/register-office", "অফিস অ্যাকাউন্ট খুলুন", "Open an office account")}
            {link("/login", "লগইন", "Login", "office-login")}
          </ul>
        </nav>
        <div>
          <h3>{choose({ bn: "সহায়তা ও তথ্য", en: "Help & information" })}</h3>
          <ul>
            {link("/#steps", "সেবা পাওয়ার ধাপ", "How it works")}
            {link("/help", "সাধারণ জিজ্ঞাসা", "Help & FAQ")}
            {link("/notices", "নোটিশ বোর্ড", "Notice board")}
            {link("/guide", "ব্যবহার নির্দেশিকা", "User guide")}
          </ul>
          {(contact.phone || contact.email) && (
            <ul className="du-footer-contact">
              {contact.phone && (
                <li>
                  <a href={`tel:${contact.phone.replace(/s+/g, "")}`}>{contact.phone}</a>
                </li>
              )}
              {contact.email && (
                <li>
                  <a href={`mailto:${contact.email}`}>{contact.email}</a>
                </li>
              )}
            </ul>
          )}
          {/* PORTAL-E: no "updates" sign-up by default — outgoing email is
              not connected, so it promised updates nobody would send. The
              form returns only where a page passes it explicitly. */}
          {subscribeSlot && <div className="du-footer-subscribe">{subscribeSlot}</div>}
        </div>
      </div>
      <div className="du-footer-bottom">
        <div className="du-container">
          {bottomLine ?? (
            <span>
              © {choose({ bn: String(new Date().getFullYear()).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]), en: String(new Date().getFullYear()) })}{" "}
              {branding.name} · {choose({ bn: "সর্বস্বত্ব সংরক্ষিত", en: "All rights reserved" })}
            </span>
          )}
          <span className="du-footer-legal">
            <NavLink href="/policies" onNavigate={onNavigate} className="du-footlink">
              {choose({ bn: "নীতি", en: "Policies" })}
            </NavLink>
            <NavLink href="/privacy" onNavigate={onNavigate} className="du-footlink">
              {choose({ bn: "গোপনীয়তা নীতি", en: "Privacy policy" })}
            </NavLink>
            <NavLink href="/terms" onNavigate={onNavigate} className="du-footlink">
              {choose({ bn: "ব্যবহারের শর্তাবলী", en: "Terms of use" })}
            </NavLink>
          </span>
        </div>
      </div>
    </footer>
  );
}

export function PublicShell({
  current,
  children,
  onNavigate,
}: {
  current: string;
  children: React.ReactNode;
  /**
   * L-006: client-side navigation for the shell's links. PublicHome
   * passes `navigate` here; without it every header/drawer/footer link
   * rendered as a plain `<a href>` and a click from the homepage was a
   * full page load (and another splash). Surfaces that render their own
   * shell (PublicPortal) pass their own handler instead.
   */
  onNavigate?: ShellNavigate;
}) {
  useLanguage();
  return (
    <div className="ax-public du-public">
      <a className="skip" href="#ax-content">
        {choose({ bn: "মূল অংশে যান", en: "Skip to main content" })}
      </a>
      <SiteHeader current={current} onNavigate={onNavigate} />
      {/* F-008: the issuance-mode banner — renders only in DEMO mode. */}
      <DemoModeBanner />
      <main id="ax-content" className="ax-main">
        <GlobalNoticeBanner />
        {children}
      </main>
      <SiteFooter onNavigate={onNavigate} />
      <HelpWidget />
    </div>
  );
}
