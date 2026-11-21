import React, { useEffect, useRef, useState } from "react";
import { choose, useLanguage } from "./i18n.js";
import "./hero-carousel.css";

/*
 * HOME-REDESIGN-03/04: the hero carousel — five photographs of the service
 * journey. Advances every 6 s; pauses on hover, on keyboard focus and when
 * the visitor presses Pause (WCAG 2.2.2); never auto-advances with
 * prefers-reduced-motion. Arrow buttons, dots and left/right keys move it.
 */

/** HOME-REDESIGN-04: photographs supplied by the owner. They are
 * illustrative (AI-generated scenes, not a specific client office), so each
 * carries a visible "illustrative image" tag. Files live in
 * public/images/carousel and travel through GitHub as .b64 siblings. */
const SLIDES = [
  {
    key: "apply",
    src: "/images/carousel/apply-from-home.webp",
    position: "60% 40%",
    alt: { bn: "উঠানে বসে এক দম্পতি মোবাইলে অনলাইন আবেদন ফরম পূরণ করছেন", en: "A couple filling an online application form on a phone at home" },
    title: { bn: "ঘরে বসে আবেদন", en: "Apply from home" },
    text: { bn: "মোবাইল থেকেই ফরম পূরণ করে নথিসহ জমা দিন — অফিসে লাইন দিতে হবে না।", en: "Fill the form and attach documents from your phone — no queue at the office." },
  },
  {
    key: "centre",
    src: "/images/carousel/digital-centre-help.webp",
    position: "50% 35%",
    alt: { bn: "ডিজিটাল সেন্টারের কর্মী বয়স্ক দম্পতিকে অনলাইন আবেদনে সাহায্য করছেন", en: "A digital centre worker helping an elderly couple apply online" },
    title: { bn: "ডিজিটাল সেন্টারেও সাহায্য", en: "Help at the digital centre" },
    text: { bn: "নিজে আবেদন করতে না পারলে ইউনিয়ন ডিজিটাল সেন্টারের কর্মী আপনার হয়ে আবেদন করে দিতে পারেন।", en: "If you cannot apply yourself, the union digital centre staff can apply for you." },
  },
  {
    key: "review",
    src: "/images/carousel/chairman-review.webp",
    position: "55% 40%",
    alt: { bn: "চেয়ারম্যান কম্পিউটারে আবেদন যাচাই করছেন", en: "A chairman reviewing an application on a computer" },
    title: { bn: "চেয়ারম্যানের যাচাই", en: "The chairman reviews" },
    text: { bn: "আপনার ইউনিয়নের চেয়ারম্যান নিজে নথি দেখে অনুমোদন দেন।", en: "Your union's chairman checks the documents and approves." },
  },
  {
    key: "certificate",
    src: "/images/carousel/certificate-received.webp",
    position: "50% 45%",
    alt: { bn: "ইউনিয়ন পরিষদ কার্যালয়ের সামনে দুজন নাগরিক হাতে সনদ নিয়ে হাসছেন", en: "Two citizens smiling with their certificates outside a Union Parishad office" },
    title: { bn: "সনদ হাতে পান", en: "Receive your certificate" },
    text: { bn: "অফিসের লোগো ও স্বাক্ষরসহ বাংলা ও ইংরেজি সনদ, QR কোড দিয়ে যাচাইযোগ্য।", en: "A Bangla and English certificate with the office's logo and signature, verifiable by QR." },
  },
  {
    key: "office",
    src: "/images/carousel/union-office.webp",
    position: "50% 50%",
    alt: { bn: "ইউনিয়ন পরিষদ কার্যালয় থেকে সেবা নিয়ে বের হচ্ছেন নাগরিকরা", en: "Citizens leaving a Union Parishad office after receiving services" },
    title: { bn: "আপনার ইউনিয়ন পরিষদ, অনলাইনে", en: "Your Union Parishad, online" },
    text: { bn: "একই অফিস, একই চেয়ারম্যান — শুধু আবেদন আর অপেক্ষা এখন সহজ।", en: "The same office and chairman — only applying and waiting are easier now." },
  },
];

const INTERVAL = 6000;

export function HeroCarousel() {
  const [lang] = useLanguage();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const running = !paused && !hovered && !focused && !reduced;
  useEffect(() => {
    if (!running) return;
    const id = window.setTimeout(() => setIndex((i) => (i + 1) % SLIDES.length), INTERVAL);
    return () => window.clearTimeout(id);
  }, [running, index]);
  const go = (i: number) => setIndex((i + SLIDES.length) % SLIDES.length);
  const digits = (n: number) => (lang === "bn" ? String(n).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]) : String(n));
  return (
    <div
      ref={rootRef}
      className="hc"
      role="region"
      aria-roledescription={choose({ bn: "স্লাইডশো", en: "carousel" })}
      aria-label={choose({ bn: "কীভাবে সেবা পাবেন", en: "How the service works" })}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node)) setFocused(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") go(index + 1);
        if (e.key === "ArrowLeft") go(index - 1);
      }}
    >
      <div className="hc-viewport">
        {SLIDES.map((s, i) => (
          <div
            key={s.key}
            className={`hc-slide${i === index ? " is-active" : ""}`}
            role="group"
            aria-roledescription={choose({ bn: "স্লাইড", en: "slide" })}
            aria-label={`${digits(i + 1)} / ${digits(SLIDES.length)}: ${choose(s.title)}`}
            aria-hidden={i === index ? undefined : true}
          >
            <img
              className="hc-photo"
              src={s.src}
              alt={choose(s.alt)}
              style={{ objectPosition: s.position }}
              loading={i === 0 ? "eager" : "lazy"}
              decoding="async"
              width={1200}
              height={675}
            />
            <span className="hc-tag">{choose({ bn: "প্রতীকী ছবি", en: "Illustrative image" })}</span>
          </div>
        ))}
      </div>
      <div className="hc-caption" aria-live={running ? "off" : "polite"}>
        <span className="hc-step">
          {digits(index + 1)}/{digits(SLIDES.length)}
        </span>
        <div>
          <strong>{choose(SLIDES[index].title)}</strong>
          <p>{choose(SLIDES[index].text)}</p>
        </div>
      </div>
      <div className="hc-controls">
        <button type="button" className="hc-arrow" onClick={() => go(index - 1)} aria-label={choose({ bn: "আগের স্লাইড", en: "Previous slide" })}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m14.5 6-6 6 6 6" /></svg>
        </button>
        <div className="hc-dots">
          {SLIDES.map((s, i) => (
            <button
              key={s.key}
              type="button"
              className={`hc-dot${i === index ? " is-active" : ""}`}
              aria-label={choose(s.title)}
              aria-current={i === index ? "true" : undefined}
              onClick={() => go(i)}
            >
              {i === index && running && <span className="hc-dot-fill" key={index} />}
            </button>
          ))}
        </div>
        <button type="button" className="hc-arrow" onClick={() => go(index + 1)} aria-label={choose({ bn: "পরের স্লাইড", en: "Next slide" })}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9.5 6 6 6-6 6" /></svg>
        </button>
        {!reduced && (
          <button
            type="button"
            className="hc-pause"
            onClick={() => setPaused(!paused)}
            aria-label={paused ? choose({ bn: "স্লাইডশো চালু করুন", en: "Play slideshow" }) : choose({ bn: "স্লাইডশো থামান", en: "Pause slideshow" })}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
              {paused ? <path d="M8 5.5v13l10.5-6.5z" /> : <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />}
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
