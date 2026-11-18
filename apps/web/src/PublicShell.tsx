import React, { useEffect, useState, useSyncExternalStore } from "react";
import { choose, LanguageSwitcher, useLanguage } from "./i18n.js";
import { useBranding } from "./branding.js";
import { GlobalNoticeBanner } from "./GlobalNotices.js";
import "./ui/kit.js";
import { SubscriptionForm } from "./SubscriptionForm.js";
import logoLockup from "./assets/brand/logo-lockup.webp";
import emblem from "./assets/brand/emblem.webp";
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
export const PUBLIC_NAV = [
  { href: "/", bn: "হোম", en: "Home" },
  { href: "/services", bn: "নাগরিক সেবা", en: "Services" },
  { href: "/tracking", bn: "আবেদনের অবস্থা", en: "Track application" },
  { href: "/verify", bn: "সনদ যাচাই", en: "Verify certificate" },
  { href: "/offices", bn: "ইউনিয়ন অফিস", en: "Union offices" },
  { href: "/notices", bn: "নোটিশ", en: "Notices" },
  { href: "/help", bn: "সাধারণ জিজ্ঞাসা", en: "Help & FAQ" },
] as const;

const DRAWER_EXTRA = [
  { href: "/guide", bn: "ব্যবহার নির্দেশিকা", en: "User guide" },
  { href: "/policies", bn: "নীতি", en: "Policies" },
  { href: "/register-office", bn: "অফিস অ্যাকাউন্ট খুলুন", en: "Open an office account" },
] as const;

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
  if (onNavigate)
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
    document.title = `${branding.name} — ${branding.taglineBn}`;
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
      <div className="du-topline">
        <div className="du-container">
          <span>
            {choose({
              bn: "ডিজিটাল নাগরিক সেবায় স্বাগতম",
              en: "Welcome to digital citizen services",
            })}
          </span>
        </div>
      </div>
      <header className="du-header">
        <div className="du-container du-header-row">
          <NavLink
            href="/"
            onNavigate={onNavigate}
            className="du-brand"
            ariaLabel={choose({ bn: `${branding.name} হোম`, en: `${branding.name} home` })}
          >
            <img className="du-brand-lockup" src={logoLockup} alt={branding.name} width={176} height={81} />
            <span className="du-brand-mini">
              <img src={emblem} alt="" width={40} height={40} />
              <span>
                <strong>{branding.name}</strong>
                <small>
                  {choose({ bn: branding.taglineBn, en: branding.taglineEn })}
                </small>
              </span>
            </span>
          </NavLink>
          <div className="du-header-actions">
            <LanguageSwitcher />
            {account ?? (
              <>
                <NavLink href="/register" onNavigate={onNavigate} className="du-btn du-btn-ghost">
                  {choose({ bn: "নিবন্ধন", en: "Register" })}
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
  const link = (href: string, bn: string, en: string) => (
    <li key={href}>
      <NavLink href={href} onNavigate={onNavigate} className="du-footlink">
        {choose({ bn, en })}
      </NavLink>
    </li>
  );
  return (
    <footer className="du-footer">
      <div className="du-container du-footer-grid">
        <div className="du-footer-brand">
          <span className="du-footer-lockup">
            <img src={emblem} alt="" width={44} height={44} />
            <strong>{branding.name}</strong>
          </span>
          <p>{choose({ bn: branding.taglineBn, en: branding.taglineEn })}</p>
          <p className="du-footer-note">
            {choose({
              bn: "ইউনিয়ন পরিষদের নাগরিক সেবা — আবেদন, অবস্থা ও সনদ যাচাই এক ঠিকানায়।",
              en: "Union Parishad citizen services — apply, track and verify in one place.",
            })}
          </p>
        </div>
        <nav aria-label={choose({ bn: "সেবা", en: "Services" })}>
          <h3>{choose({ bn: "সেবা", en: "Services" })}</h3>
          {servicesSlot ?? (
            <ul>
              {link("/services", "সব নাগরিক সেবা", "All citizen services")}
              {link("/services", "নতুন আবেদন করুন", "Start an application")}
              {link("/offices", "আপনার ইউনিয়ন অফিস", "Your union office")}
            </ul>
          )}
        </nav>
        <nav aria-label={choose({ bn: "দ্রুত লিংক", en: "Quick links" })}>
          <h3>{choose({ bn: "দ্রুত লিংক", en: "Quick links" })}</h3>
          <ul>
            {link("/verify", "সনদ যাচাই", "Verify certificate")}
            {link("/tracking", "আবেদনের অবস্থা", "Track application")}
            {link("/notices", "নোটিশ", "Notices")}
            {link("/register", "নতুন অ্যাকাউন্ট", "Create an account")}
          </ul>
        </nav>
        <div>
          <h3>{choose({ bn: "সাহায্য ও তথ্য", en: "Help & information" })}</h3>
          <ul>
            {link("/help", "সাধারণ জিজ্ঞাসা", "Help & FAQ")}
            {link("/guide", "ব্যবহার নির্দেশিকা", "User guide")}
            {link("/policies", "নীতি", "Policies")}
          </ul>
          <div className="du-footer-subscribe">
            {subscribeSlot ?? <SubscriptionForm />}
          </div>
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
      <SiteHeader current={current} />
      <main id="ax-content" className="ax-main">
        <GlobalNoticeBanner />
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
