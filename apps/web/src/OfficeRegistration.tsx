import React, { useEffect, useState } from "react";
import { api, items } from "./api.js";
import { choose, useLanguage } from "./i18n.js";
import { applyPageHead } from "./seo/head.js";
import { MobileOtpField, type VerifiedMobile } from "./MobileOtpField.js";
import { TitleBand } from "./ui/kit.js";
import "./office-registration.css";

/**
 * Phase 2d: office staff ask for an account for their post. The platform owner verifies the request;
 * until then the account cannot sign in.
 */
export function OfficeRegistration() {
  const [language] = useLanguage();
  // F-006: this page owns its head — without this call it inherited the
  // previous page's document.title (PublicShell only sets the branding
  // default when no page has applied a head).
  useEffect(() => {
    applyPageHead({
      title:
        language === "bn"
          ? "অফিস অ্যাকাউন্ট খুলুন | DigitalUnion"
          : "Open an office account | DigitalUnion",
      description:
        language === "bn"
          ? "আপনার ইউনিয়ন পরিষদের জন্য একটি অফিস অ্যাকাউন্টের অনুরোধ করুন। প্ল্যাটফর্ম মালিক যাচাই করার পর অ্যাকাউন্ট সক্রিয় হয়।"
          : "Request an office account for your Union Parishad. The account is activated once the platform owner verifies it.",
      canonicalPath: "/register-office",
    });
  }, [language]);
  const [offices, setOffices] = useState<any[] | null>(null);
  const [tenantId, setTenantId] = useState("");
  const [types, setTypes] = useState<any[]>([]);
  const [accountType, setAccountType] = useState("");
  const [form, setForm] = useState({ displayName: "", email: "", password: "" });
  const [mobile, setMobile] = useState<VerifiedMobile | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    // PORTAL-E: every office, not just the first page — the API returns at
    // most 100 per page, so offices beyond the 100th could not be chosen.
    (async () => {
      const first: any = await api("/offices?pageSize=100&page=1");
      const total = Number(first?.total ?? 0);
      const pages = Math.max(1, Math.ceil(total / 100));
      const rest = await Promise.all(
        Array.from({ length: pages - 1 }, (_, i) => api(`/offices?pageSize=100&page=${i + 2}`)),
      );
      return [first, ...rest].flatMap((r) => items(r));
    })()
      .then(setOffices)
      .catch(() => setOffices([]));
  }, []);
  useEffect(() => {
    setAccountType("");
    setTypes([]);
    if (!tenantId) return;
    api(`/public/offices/${tenantId}/account-types`)
      .then((r) => setTypes(items(r)))
      .catch((e) => setError((e as Error).message));
  }, [tenantId]);
  const officeName = (o: any) => choose({ bn: o.nameBn ?? o.name_bn, en: o.nameEn ?? o.name_en });
  if (done)
    return (
      <>
        <TitleBand title={choose({ bn: "আবেদন পাঠানো হয়েছে", en: "Request sent" })} />
        <div className="ax-container office-registration">
          <section className="panel" role="status">
            <p>
              {choose({
                bn: "প্ল্যাটফর্ম পরিচালক আপনার তথ্য যাচাই করবেন। অনুমোদনের পর একই ইমেইল ও পাসওয়ার্ড দিয়ে লগইন করতে পারবেন।",
                en: "The platform operator will verify your details. Once approved, sign in with the same email and password.",
              })}
            </p>
            <a className="button" href="/">
              {choose({ bn: "হোমে ফিরুন", en: "Back to home" })}
            </a>
          </section>
        </div>
      </>
    );
  return (
    <>
      <TitleBand
        eyebrow={choose({ bn: "অফিসের অ্যাকাউন্ট", en: "Office account" })}
        title={choose({ bn: "অফিস কর্মকর্তা হিসেবে নিবন্ধন", en: "Register as office staff" })}
      >
        <p>
          {choose({
            bn: "নাগরিকেরা এখানে নয়, নাগরিক নিবন্ধন পাতায় নিবন্ধন করুন। অফিসের অ্যাকাউন্ট যাচাইয়ের পরে চালু হয়।",
            en: "Citizens should use citizen registration instead. Office accounts are activated after verification.",
          })}
        </p>
      </TitleBand>
      <div className="ax-container office-registration">
        <form
          className="panel"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await api("/auth/office-registration", "POST", {
                tenantId,
                accountType,
                ...form,
                ...(mobile ?? {}),
              });
              setDone(true);
            } catch (failure) {
              setError((failure as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="form-grid">
            <label htmlFor="office-reg-office">
              {choose({ bn: "অফিস", en: "Office" })}
              <select
                id="office-reg-office"
                required
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
              >
                <option value="">
                  {offices === null
                    ? choose({ bn: "লোড হচ্ছে…", en: "Loading…" })
                    : choose({ bn: "অফিস বেছে নিন", en: "Choose your office" })}
                </option>
                {(offices ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {officeName(o)}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="office-reg-post">
              {choose({ bn: "পদ", en: "Post" })}
              <select
                id="office-reg-post"
                required
                disabled={!tenantId}
                value={accountType}
                onChange={(e) => setAccountType(e.target.value)}
              >
                <option value="">{choose({ bn: "পদ বেছে নিন", en: "Choose your post" })}</option>
                {types.map((type) => (
                  <option key={type.code} value={type.code}>
                    {choose({ bn: type.nameBn, en: type.nameEn })}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="office-reg-name">
              {choose({ bn: "আপনার নাম", en: "Your name" })}
              <input
                id="office-reg-name"
                required
                minLength={2}
                maxLength={120}
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              />
            </label>
            <label htmlFor="office-reg-email">
              {choose({ bn: "ইমেইল", en: "Email" })}
              <input
                id="office-reg-email"
                type="email"
                required
                autoComplete="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </label>
            <label htmlFor="office-reg-password">
              {choose({ bn: "পাসওয়ার্ড (৬ থেকে ১৮ অক্ষর)", en: "Password (6 to 18 characters)" })}
              <input
                id="office-reg-password"
                type="password"
                required
                minLength={6}
                maxLength={18}
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </label>
          </div>
          <MobileOtpField value={mobile} onChange={setMobile} />
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button disabled={busy || !tenantId || !accountType}>
            {busy
              ? choose({ bn: "পাঠানো হচ্ছে…", en: "Sending…" })
              : choose({ bn: "যাচাইয়ের জন্য পাঠান", en: "Send for verification" })}
          </button>
        </form>
      </div>
    </>
  );
}
