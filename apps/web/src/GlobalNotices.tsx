import { useEffect, useState } from "react";
import { api } from "./api.js";
import { choose, useLanguage } from "./i18n.js";
import "./global-notices.css";

/**
 * Phase 3E (§3.8 + §3.7): the portal-wide surfaces of the owner's global notices
 * and public coupons.
 *
 * GlobalNoticeBanner renders the notices the owner has live right now
 * (GET /global-notices) as a banner strip; it renders nothing when there are
 * none, so the portal is unchanged until the owner publishes one. It is mounted
 * in the public shell, the citizen portal and the signed-in workspace, per the
 * plan: "shown as a portal-wide banner (homepage + dashboards)".
 *
 * PublicOffers renders the coupons the owner chose to make public
 * (GET /public/coupons) as an offers section on the homepage. Hidden coupons are
 * never listed — they work only for an office that knows the code.
 */
type GlobalNotice = {
  id: string;
  titleBn: string;
  titleEn: string;
  bodyBn: string;
  bodyEn: string;
  linkUrl: string | null;
};
type PublicCoupon = {
  code: string;
  discountKind: "percent" | "fixed";
  discountValue: number;
  appliesTo: "subscription" | "topup" | "both";
  planId: string | null;
  validUntil: string | null;
};

export function GlobalNoticeBanner() {
  useLanguage();
  const [notices, setNotices] = useState<GlobalNotice[]>([]);
  useEffect(() => {
    let active = true;
    api("/global-notices")
      .then((r) => active && setNotices(Array.isArray(r?.items) ? r.items : []))
      .catch(() => active && setNotices([]));
    return () => {
      active = false;
    };
  }, []);
  if (!notices.length) return null;
  return (
    <div className="du-global-notices" role="region" aria-label={choose({ bn: "ঘোষণা", en: "Announcements" })}>
      {notices.map((n) => (
        <article className="du-global-notice" key={n.id}>
          <strong>{choose({ bn: n.titleBn, en: n.titleEn })}</strong>
          <span>{choose({ bn: n.bodyBn, en: n.bodyEn })}</span>
          {n.linkUrl && (
            <a href={n.linkUrl} target="_blank" rel="noreferrer">
              {choose({ bn: "বিস্তারিত", en: "Details" })}
            </a>
          )}
        </article>
      ))}
    </div>
  );
}

export function PublicOffers() {
  useLanguage();
  const [offers, setOffers] = useState<PublicCoupon[]>([]);
  useEffect(() => {
    let active = true;
    api("/public/coupons")
      .then((r) => active && setOffers(Array.isArray(r?.items) ? r.items : []))
      .catch(() => active && setOffers([]));
    return () => {
      active = false;
    };
  }, []);
  if (!offers.length) return null;
  const scope = (o: PublicCoupon) =>
    o.appliesTo === "subscription"
      ? choose({ bn: "সাবস্ক্রিপশন কেনায়", en: "On subscription purchases" })
      : o.appliesTo === "topup"
        ? choose({ bn: "ক্রেডিট টপ-আপে", en: "On credit top-ups" })
        : choose({ bn: "সাবস্ক্রিপশন ও টপ-আপে", en: "On subscriptions and top-ups" });
  return (
    <section className="du-public-offers" aria-label={choose({ bn: "অফার", en: "Offers" })}>
      <h2>{choose({ bn: "অফিসগুলোর জন্য অফার", en: "Offers for offices" })}</h2>
      <div className="du-public-offer-list">
        {offers.map((o) => (
          <article className="du-public-offer" key={o.code}>
            <code>{o.code}</code>
            <strong>
              {o.discountKind === "percent"
                ? choose({ bn: `${o.discountValue}% ছাড়`, en: `${o.discountValue}% off` })
                : choose({
                    bn: `৳${(o.discountValue / 100).toLocaleString("en-IN")} ছাড়`,
                    en: `BDT ${(o.discountValue / 100).toLocaleString("en-IN")} off`,
                  })}
            </strong>
            <span>{scope(o)}</span>
            {o.validUntil && (
              <span>
                {choose({ bn: "মেয়াদ", en: "Valid until" })}:{" "}
                {new Date(o.validUntil).toLocaleDateString()}
              </span>
            )}
          </article>
        ))}
      </div>
      <p>
        {choose({
          bn: "অফিসের বিলিং প্যানেল থেকে অর্ডারের সময় কোডটি ব্যবহার করুন।",
          en: "Use the code when ordering from your office billing panel.",
        })}
      </p>
    </section>
  );
}
