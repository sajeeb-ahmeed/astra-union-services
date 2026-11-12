import React from "react";
import { choose, LanguageSwitcher, useLanguage } from "./i18n.js";
import "./ui/kit.js";
import "./public-shell.css";

/** Phase 1 public shell: header, navigation and footer shared by new public pages. Links are plain URLs. */
export const publicNavigation: { href: string; bn: string; en: string }[] = [
  { href: "/", bn: "হোম", en: "Home" },
  { href: "/services", bn: "নাগরিক সেবা", en: "Services" },
  { href: "/tracking", bn: "আবেদনের অবস্থা", en: "Track application" },
  { href: "/verify", bn: "সনদ যাচাই", en: "Verify certificate" },
  { href: "/offices", bn: "সেবার আওতাভুক্ত অফিস", en: "Office directory" },
  { href: "/notices", bn: "বিজ্ঞপ্তি", en: "Notices" },
  { href: "/help", bn: "সহায়িকা", en: "Help" },
];

export function PublicShell({
  current,
  children,
}: {
  current: string;
  children: React.ReactNode;
}) {
  useLanguage();
  return (
    <div className="ax-public">
      <a className="skip" href="#ax-content">
        {choose({ bn: "মূল অংশে যান", en: "Skip to main content" })}
      </a>
      <div className="ax-topline">
        <div className="ax-container">
          <span>
            {choose({
              bn: "ডিজিটাল নাগরিক সেবায় স্বাগতম",
              en: "Welcome to digital citizen services",
            })}
          </span>
          <span className="ax-demo-flag">
            {choose({ bn: "প্রদর্শনী · সরকারি নয়", en: "DEMO · NOT OFFICIAL" })}
          </span>
        </div>
      </div>
      <header className="ax-header ax-container">
        <a className="ax-brand" href="/">
          <span className="ax-brand-mark" aria-hidden="true">
            A
          </span>
          <span>
            <strong>{choose({ bn: "অ্যাস্ট্রা", en: "Astra" })}</strong>
            <small>ASTRA · UNION SERVICES</small>
          </span>
        </a>
        <div className="ax-header-actions">
          <LanguageSwitcher />
          <a className="button secondary" href="/register">
            {choose({ bn: "নিবন্ধন", en: "Register" })}
          </a>
          <a className="button" href="/login">
            {choose({ bn: "লগইন", en: "Sign in" })}
          </a>
        </div>
      </header>
      <nav
        className="ax-nav"
        aria-label={choose({ bn: "প্রধান মেনু", en: "Public navigation" })}
      >
        <div className="ax-container">
          {publicNavigation.map((item) => (
            <a
              key={item.href}
              href={item.href}
              aria-current={current === item.href ? "page" : undefined}
            >
              {choose(item)}
            </a>
          ))}
        </div>
      </nav>
      <main id="ax-content">{children}</main>
      <footer className="ax-footer">
        <div className="ax-container">
          <p>
            {choose({
              bn: "অ্যাস্ট্রা একটি স্বাধীন প্রদর্শনী ব্যবস্থা। এখানকার সনদ সরকারি নয়।",
              en: "Astra is an independent demonstration. Certificates issued here are not official.",
            })}
          </p>
          <nav aria-label={choose({ bn: "নীতিমালা", en: "Policies" })}>
            <a href="/policies">
              {choose({ bn: "গোপনীয়তা ও শর্তাবলি", en: "Privacy and terms" })}
            </a>
            <a href="/help">{choose({ bn: "সহায়িকা", en: "Help" })}</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
