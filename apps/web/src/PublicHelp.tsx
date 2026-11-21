import React, { useEffect, useRef, useState } from "react";
import { choose, useLanguage } from "./i18n.js";
import { SUPPORT_CONTACT } from "./support-contact.js";
import "./public-help.css";

/**
 * HOME-REDESIGN-02: the thin utility bar above the header — today's date
 * (public-service sites date their notices and people check it) and the
 * way to get help. Contact details appear only when configured.
 */
export function UtilityBar() {
  const [lang] = useLanguage();
  const today = new Intl.DateTimeFormat(lang === "bn" ? "bn-BD" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
  return (
    <div className="util-bar">
      <div className="du-container util-bar-row">
        <span className="util-bar-date">{today}</span>
        <span className="util-bar-links">
          {SUPPORT_CONTACT.phone && (
            <a href={`tel:${SUPPORT_CONTACT.phone.replace(/\s+/g, "")}`}>
              {choose({ bn: "হেল্পলাইন", en: "Helpline" })}: {SUPPORT_CONTACT.phone}
            </a>
          )}
          {SUPPORT_CONTACT.email && <a href={`mailto:${SUPPORT_CONTACT.email}`}>{SUPPORT_CONTACT.email}</a>}
          <a href="/help">{choose({ bn: "সহায়তা কেন্দ্র", en: "Help centre" })}</a>
        </span>
      </div>
    </div>
  );
}

/**
 * HOME-REDESIGN-02: a floating help button that opens the four answers
 * people most often need, plus the support contact when configured; and a
 * back-to-top button once the page has scrolled. Escape closes the panel
 * and returns focus to the button.
 */
export function HelpWidget() {
  useLanguage();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 700);
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    return () => removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open]);
  const links = [
    { href: "/guide", bn: "কীভাবে আবেদন করবেন", en: "How to apply" },
    { href: "/tracking", bn: "আবেদনের অবস্থা দেখুন", en: "Track an application" },
    { href: "/verify", bn: "সনদ যাচাই করুন", en: "Verify a certificate" },
    { href: "/help", bn: "সাধারণ জিজ্ঞাসা", en: "Common questions" },
  ];
  return (
    <div className="help-fab-wrap">
      {scrolled && (
        <button
          type="button"
          className="help-top"
          aria-label={choose({ bn: "পৃষ্ঠার উপরে যান", en: "Back to top" })}
          onClick={() => window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m6 14 6-6 6 6" />
          </svg>
        </button>
      )}
      {open && (
        <div className="help-panel" role="dialog" aria-label={choose({ bn: "সহায়তা", en: "Help" })}>
          <strong>{choose({ bn: "কী সাহায্য দরকার?", en: "What do you need help with?" })}</strong>
          <ul>
            {links.map((l) => (
              <li key={l.href}>
                <a href={l.href}>{choose({ bn: l.bn, en: l.en })}</a>
              </li>
            ))}
          </ul>
          {(SUPPORT_CONTACT.phone || SUPPORT_CONTACT.email) && (
            <div className="help-panel-contact">
              <span>{choose({ bn: "সরাসরি যোগাযোগ", en: "Talk to us" })}</span>
              {SUPPORT_CONTACT.phone && (
                <a href={`tel:${SUPPORT_CONTACT.phone.replace(/\s+/g, "")}`}>{SUPPORT_CONTACT.phone}</a>
              )}
              {SUPPORT_CONTACT.email && <a href={`mailto:${SUPPORT_CONTACT.email}`}>{SUPPORT_CONTACT.email}</a>}
              {SUPPORT_CONTACT.hours.bn && <small>{choose(SUPPORT_CONTACT.hours)}</small>}
            </div>
          )}
          <p className="help-panel-office">
            {choose({
              bn: "আবেদনের বিষয়ে আপনার ইউনিয়ন পরিষদ অফিসও সাহায্য করতে পারে।",
              en: "Your Union Parishad office can also help with an application.",
            })}
          </p>
        </div>
      )}
      <button
        ref={buttonRef}
        type="button"
        className={`help-fab${open ? " is-open" : ""}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {open ? (
            <path d="M6 6l12 12M18 6 6 18" />
          ) : (
            <>
              <circle cx="12" cy="12" r="9" />
              <path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.3M12 16.6v.2" />
            </>
          )}
        </svg>
        {open ? choose({ bn: "বন্ধ করুন", en: "Close" }) : choose({ bn: "সহায়তা", en: "Help" })}
      </button>
    </div>
  );
}
