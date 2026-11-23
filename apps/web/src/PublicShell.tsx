import React, { useEffect, useState, useSyncExternalStore } from "react";
import { HelpWidget, UtilityBar } from "./PublicHelp.js";
import { SUPPORT_CONTACT } from "./support-contact.js";
import { choose, LanguageSwitcher, useLanguage } from "./i18n.js";
import { useBranding } from "./branding.js";
import { hasPageHead } from "./seo/head.js";
import { GlobalNoticeBanner } from "./GlobalNotices.js";
import "./ui/kit.js";
import { BrandLockup } from "./BrandLockup.js";
import "./public-shell.css";
import "./du-shell.css";

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
export const PUBLIC_NAV = [
  { href: "/", bn: "হোম", en: "Home" },
  { href: "/services", bn: "নাগরিক সেবা", en: "Services" },
  { href: "/tracking", bn: "আবেদনের অবস্থা", en: "Track application" },
  { href: "/verify", bn: "সনদ যাচাই", en: "Verify certificate" },
  { href: "/offices", bn: "ইউনিয়ন অফিস", en: "Union offices" },
  { href: "/help", bn: "সাধারণ জিজ্ঞাসা", en: "Help & FAQ" },
] as const;

const DRAWER_EXTRA = [
  // HOME-REDESIGN-01: the phone header hides its Register button, so the
  // drawer carries it.
  { href: "/register", bn: "নতুন অ্যাকাউন্ট খুলুন", en: "Create an account" },
  { href: "/notices", bn: "নোটিশ", en: "Notices" },
  { href: "/witness", bn: "সাক্ষীর প্রত্যয়ন", en: "Witness statement" },
  { href: "/guide", bn: "ব্যবহার নির্দেশিকা", en: "User guide" },
  { href: "/policies", bn: "নীতি", en: "Policies" },
  { href: "/register-office", bn: "অফিস অ্যাকাউন্ট খুলুন", en: "Open an office account" },
] as const;

/** Pages outside the citizen portal's page set: always a real page load. */
const HARD_LINKS = new Set(["/register-office"]);

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
    return (
      <button
        type="button"
        className={className}
        aria-current={active ? "page" : undefined}
        aria-label={ariaLabel}
        onClick={() => {
          onDone?.();
          onNavigate(href);
        }}
      >
        {children}
      </button>
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
          <span className="du-header-welcome">
            {choose({
              bn: "ডিজিটাল নাগরিক সেবায় স্বাগতম",
              en: "Welcome to digital citizen services",
            })}
          </span>
          <div className="du-header-actions">
            <LanguageSwitcher />
            {account ?? (
              <>
                {/* PORTAL-A: the three doors of a public service portal —
                    a free citizen account, an office account, sign in. */}
                <NavLink href="/register" onNavigate={onNavigate} className="du-btn du-btn-ghost">
                  {choose({ bn: "নিবন্ধন", en: "Register" })}
                </NavLink>
                <NavLink
                  href="/register-office"
                  onNavigate={onNavigate}
                  className="du-btn du-btn-ghost du-btn-office"
                >
                  {choose({ bn: "অফিস অ্যাকাউন্ট", en: "Office account" })}
                </NavLink>
                <NavLink href="/login" onNavigate={onNavigate} className="du-btn du-btn-primary">
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
                {[...PUBLIC_NAV, ...DRAWER_EXTRA].map((item) => (
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
          {/* PORTAL-E (owner scope): the brand only — no pilot-office line,
              no "who we are" paragraphs, no tagline sentence. */}
          <BrandLockup size={40} tagline />
        </div>
        <nav aria-label={choose({ bn: "সেবা", en: "Services" })}>
          <h3>{choose({ bn: "সেবা", en: "Services" })}</h3>
          {servicesSlot ?? (
            <ul>
              {link("/services", "সব নাগরিক সেবা", "All citizen services", "services-all")}
              {link("/services", "নতুন আবেদন করুন", "Start an application", "services-apply")}
              {link("/offices", "আপনার ইউনিয়ন অফিস", "Your union office")}
            </ul>
          )}
        </nav>
        <nav aria-label={choose({ bn: "দ্রুত লিংক", en: "Quick links" })}>
          <h3>{choose({ bn: "দ্রুত লিংক", en: "Quick links" })}</h3>
          <ul>
            {link("/verify", "সনদ যাচাই", "Verify certificate")}
            {link("/tracking", "আবেদনের অবস্থা", "Track application")}
            {link("/witness", "সাক্ষীর প্রত্যয়ন", "Witness statement")}
            {link("/notices", "নোটিশ", "Notices")}
            {link("/register", "নতুন অ্যাকাউন্ট", "Create an account")}
            {link("/register-office", "অফিস অ্যাকাউন্ট খুলুন", "Open an office account")}
          </ul>
        </nav>
        <div>
          <h3>{choose({ bn: "সাহায্য ও তথ্য", en: "Help & information" })}</h3>
          <ul>
            {link("/help", "সাধারণ জিজ্ঞাসা", "Help & FAQ")}
            {link("/guide", "ব্যবহার নির্দেশিকা", "User guide")}
            {link("/policies", "নীতি", "Policies")}
          </ul>
          {(SUPPORT_CONTACT.phone || SUPPORT_CONTACT.email) && (
            <ul className="du-footer-contact">
              {SUPPORT_CONTACT.phone && (
                <li>
                  <a href={`tel:${SUPPORT_CONTACT.phone.replace(/s+/g, "")}`}>{SUPPORT_CONTACT.phone}</a>
                </li>
              )}
              {SUPPORT_CONTACT.email && (
                <li>
                  <a href={`mailto:${SUPPORT_CONTACT.email}`}>{SUPPORT_CONTACT.email}</a>
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
              © {new Date().getFullYear()} {branding.name}
              {choose({ bn: ` · ${branding.taglineBn}`, en: ` · ${branding.taglineEn}` })}
            </span>
          )}
        </div>
      </div>
    </footer>
  );
}

export function PublicShell({
  current,
  children,
}: {
  current: string;
  children: React.ReactNode;
}) {
  useLanguage();
  return (
    <div className="ax-public du-public">
      <a className="skip" href="#ax-content">
        {choose({ bn: "মূল অংশে যান", en: "Skip to main content" })}
      </a>
      <UtilityBar />
      <SiteHeader current={current} />
      <main id="ax-content" className="ax-main">
        <GlobalNoticeBanner />
        {children}
      </main>
      <SiteFooter />
      <HelpWidget />
    </div>
  );
}
