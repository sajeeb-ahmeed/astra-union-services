import React, { useEffect, useRef, useState } from "react";
import { choose, LanguageSwitcher, useLanguage } from "./i18n.js";
import { useSupportContact } from "./support-contact.js";
import "./public-help.css";

/**
 * HOME-REDESIGN-02: the thin utility bar above the header — today's date
 * (public-service sites date their notices and people check it) and the
 * way to get help. Contact details appear only when configured.
 */
/** PORTAL-LANDING: text size (অ- / অ / অ+), remembered per browser. */
const TEXT_SIZES = [
  { key: "small", label: "অ-", bn: "লেখা ছোট করুন", en: "Smaller text", scale: "93.75%" },
  { key: "normal", label: "অ", bn: "স্বাভাবিক লেখা", en: "Normal text", scale: "100%" },
  { key: "large", label: "অ+", bn: "লেখা বড় করুন", en: "Larger text", scale: "112.5%" },
] as const;
type TextSize = (typeof TEXT_SIZES)[number]["key"];
function readTextSize(): TextSize {
  try {
    const stored = localStorage.getItem("astra.textSize");
    return TEXT_SIZES.some((s) => s.key === stored) ? (stored as TextSize) : "normal";
  } catch {
    return "normal";
  }
}
function applyTextSize(size: TextSize) {
  document.documentElement.style.fontSize = TEXT_SIZES.find((s) => s.key === size)!.scale;
}

export function UtilityBar() {
  const [lang] = useLanguage();
  // F-001: the owner-configured support contact (empty until set).
  const contact = useSupportContact();
  const [size, setSize] = useState<TextSize>(readTextSize);
  useEffect(() => applyTextSize(size), [size]);
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
        <span className="util-bar-platform">
          {choose({ bn: "ইউনিয়ন পরিষদ ডিজিটাল নাগরিক সেবা প্ল্যাটফর্ম", en: "Union Parishad digital citizen services platform" })}
        </span>
        <span className="util-bar-links">
          <span className="util-text-size" role="group" aria-label={choose({ bn: "লেখার আকার", en: "Text size" })}>
            {TEXT_SIZES.map((s) => (
              <button
                key={s.key}
                type="button"
                aria-pressed={size === s.key}
                aria-label={choose({ bn: s.bn, en: s.en })}
                title={choose({ bn: s.bn, en: s.en })}
                onClick={() => {
                  setSize(s.key);
                  try {
                    localStorage.setItem("astra.textSize", s.key);
                  } catch {
                    /* the choice still applies to this page */
                  }
                }}
              >
                {s.label}
              </button>
            ))}
          </span>
          <LanguageSwitcher />
          {contact.phone ? (
            <a href={`tel:${contact.phone.replace(/\s+/g, "")}`}>
              {choose({ bn: "হেল্পলাইন", en: "Helpline" })}: {contact.phone}
            </a>
          ) : (
            <a href="/#hotline">{choose({ bn: "জরুরি হটলাইন", en: "Emergency hotlines" })}</a>
          )}
          {contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}
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
  // F-001: the owner-configured support contact (empty until set).
  const contact = useSupportContact();
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
          {(contact.phone || contact.email) && (
            <div className="help-panel-contact">
              <span>{choose({ bn: "সরাসরি যোগাযোগ", en: "Talk to us" })}</span>
              {contact.phone && (
                <a href={`tel:${contact.phone.replace(/\s+/g, "")}`}>{contact.phone}</a>
              )}
              {contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}
              {contact.hours.bn && <small>{choose(contact.hours)}</small>}
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
