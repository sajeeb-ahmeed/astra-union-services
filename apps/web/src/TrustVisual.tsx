import React from "react";
import { choose, useLanguage } from "./i18n.js";
import sampleCertificate from "./assets/sample-certificate.webp";
import sampleNumber from "./assets/sample-certificate-number.webp";
import sampleQr from "./assets/sample-certificate-qr.webp";
import "./trust-visual.css";

/**
 * FULL-UIUX-01 (programme 22/26, BD-LANDING-PLAN-01 §3/§6): the product's own
 * best artefact as the visual — a certificate in the issued format, rendered
 * as a clearly-marked SAMPLE (BD DO-NOT-CLAIM #9: a sample must be
 * recognisable as a sample; no real citizen data, no real number).
 *
 * REFINEMENT-02 P1-1: the visual is no longer a hand-drawn wireframe. The
 * full variant is a raster of the REAL react-pdf certificate template
 * (Belabo citizenship certificate, sample citizen data, sample number
 * 2026111812345678, real QR of the by-number verify URL) with a নমুনা/SAMPLE
 * watermark burned in. The compact variant is a cropped detail of the same
 * document (number strip + QR close-up) so secondary surfaces never repeat
 * the hero image pixel-for-pixel.
 */
export function SampleCertificate({ compact = false }: { compact?: boolean }) {
  useLanguage();
  if (compact) {
    return (
      <div className="sample-cert is-compact sample-cert-detail" aria-hidden="true">
        <span className="sample-cert-chip">
          {choose({ bn: "নমুনা সনদ", en: "Sample" })}
        </span>
        <img className="sample-cert-detail-number" src={sampleNumber} alt="" />
        <div className="sample-cert-detail-row">
          <img className="sample-cert-detail-qr" src={sampleQr} alt="" />
          <p>
            {choose({
              bn: "সনদের নম্বর ও QR কোড — যাচাই পেজে লিখলেই বা স্ক্যান করলেই আসল তথ্য মিলবে।",
              en: "The certificate number and QR code — type or scan on the verify page to see the real record.",
            })}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="sample-cert sample-cert-doc" aria-hidden="true">
      <span className="sample-cert-chip sample-cert-chip-overlay">
        {choose({ bn: "নমুনা সনদ", en: "Sample" })}
      </span>
      <img className="sample-cert-doc-img" src={sampleCertificate} alt="" />
    </div>
  );
}

/**
 * The trust strip: ONLY the BD verified-proof list (checklist A4) —
 * Belabo pilot · 47 services · 47/47 issued · QR verify · BN+EN.
 */
export function TrustStrip() {
  useLanguage();
  const facts = [
    { bn: "বেলাবো ইউনিয়ন পরিষদ — লাইভ পাইলট অফিস", en: "Belabo Union Parishad — live pilot office" },
    { bn: "৪৭টি ইউনিয়ন সেবা", en: "47 union services" },
    { bn: "৪৭টির সবকটিতেই সনদ ইস্যু হয়েছে", en: "Certificates issued in all 47 services" },
    { bn: "প্রতিটি সনদ QR দিয়ে যাচাইযোগ্য", en: "Every certificate is QR-verifiable" },
    { bn: "বাংলা ও ইংরেজি — দুই ভাষায় সনদ", en: "Certificates in Bangla and English" },
  ];
  return (
    <ul className="trust-strip">
      {facts.map((fact) => (
        <li key={fact.en}>
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m4.5 12.5 5 5 10-11" />
          </svg>
          {choose(fact)}
        </li>
      ))}
    </ul>
  );
}
