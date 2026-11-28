import React, { useState } from "react";
import { api } from "./api.js";
import { choose, useLanguage } from "./i18n.js";
import { GeographyFields, emptyGeography, geographyPayload, type GeographyValue } from "./GeographyFields.js";

const label = (bn: string, en: string) => choose({ bn, en });
const typeLabel = (type: string) =>
  ({
    UNION: label("ইউনিয়ন পরিষদ", "Union parishad"),
    MUNICIPALITY: label("পৌরসভা", "Municipality"),
    CITY_CORPORATION: label("সিটি কর্পোরেশন", "City corporation"),
  })[type] ?? type;

/**
 * CERT-FEE: a union office opens itself on the platform. The office signs in
 * and sets itself up at once; it is hidden from the public, and cannot issue
 * certificates, until the platform owner verifies it.
 */
export function OfficeSelfSetupForm() {
  useLanguage();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    nameBn: "",
    nameEn: "",
    officeType: "UNION",
    adminName: "",
    adminEmail: "",
    adminPassword: "",
    confirmPassword: "",
    acceptTerms: false,
  });
  const [geography, setGeography] = useState<GeographyValue>(emptyGeography());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | { email: string }>(null);
  const [error, setError] = useState("");
  const set =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm({
        ...form,
        [key]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value,
      });
  const through = form.officeType === "UNION" ? "union" : "upazila";

  if (done)
    return (
      <section className="panel office-self-setup" aria-labelledby="office-setup-title">
        <h2 id="office-setup-title">{label("অফিস খোলা হয়েছে", "Your office is open")}</h2>
        <p className="notice" role="status">
          {label(
            `${done.email} দিয়ে সাইন ইন করে অফিসের কর্মকর্তা, সেবা, স্বাক্ষর ও অন্যান্য সেটিং ঠিক করুন। প্ল্যাটফর্ম কর্তৃপক্ষ অফিসটি যাচাই করার পর এটি জনসাধারণের তালিকায় আসবে এবং সনদ ইস্যু করা যাবে।`,
            `Sign in with ${done.email} to set up your staff, services, signature and settings. Once the platform owner verifies the office, it appears in the public directory and can issue certificates.`,
          )}
        </p>
        <a className="button" href="/login">
          {label("সাইন ইন করুন", "Sign in")}
        </a>
      </section>
    );

  return (
    <section className="panel office-self-setup" id="office-setup" aria-labelledby="office-setup-title">
      <h2 id="office-setup-title">{label("নতুন অফিস খুলুন", "Open a new office")}</h2>
      <p>
        {label(
          "আপনার ইউনিয়ন পরিষদ নিজেই DigitalUnion-এ খুলুন এবং সাথে সাথে সেটআপ শুরু করুন। অফিস চালাতে কোনো মাসিক খরচ নেই; চেয়ারম্যান আবেদন অনুমোদন করলে প্রতিটি সনদের জন্য প্ল্যাটফর্ম ফি দিতে হয় — বাংলা, ইংরেজি বা দুটোই।",
          "Open your union office on DigitalUnion yourself and start setting it up straight away. There is no monthly cost to run the office; the platform fee is paid per certificate when the Chairman approves an application — Bangla, English or both.",
        )}
      </p>
      {!open ? (
        <button onClick={() => setOpen(true)}>{label("অফিস খোলা শুরু করুন", "Start opening an office")}</button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            if (form.adminPassword !== form.confirmPassword) {
              setError(label("দুটি পাসওয়ার্ড মেলেনি।", "The two passwords do not match."));
              return;
            }
            setBusy(true);
            api("/public/offices/self-register", "POST", {
              nameBn: form.nameBn.trim(),
              nameEn: form.nameEn.trim(),
              officeType: form.officeType,
              geography: geographyPayload(geography),
              adminName: form.adminName.trim(),
              adminEmail: form.adminEmail.trim(),
              adminPassword: form.adminPassword,
              acceptTerms: form.acceptTerms,
            })
              .then(() => setDone({ email: form.adminEmail.trim() }))
              .catch((err) => setError((err as Error).message))
              .finally(() => setBusy(false));
          }}
        >
          <div className="form-grid">
            <div className="field">
              <label htmlFor="setup-name-bn">{label("অফিসের নাম (বাংলা)", "Office name (Bangla)")}</label>
              <input id="setup-name-bn" value={form.nameBn} onChange={set("nameBn")} required minLength={2} maxLength={150} />
            </div>
            <div className="field">
              <label htmlFor="setup-name-en">{label("অফিসের নাম (ইংরেজি)", "Office name (English)")}</label>
              <input id="setup-name-en" value={form.nameEn} onChange={set("nameEn")} required minLength={2} maxLength={150} />
            </div>
            <div className="field">
              <label htmlFor="setup-type">{label("অফিসের ধরন", "Office type")}</label>
              <select
                id="setup-type"
                value={form.officeType}
                onChange={(e) => {
                  set("officeType")(e);
                  setGeography(emptyGeography());
                }}
              >
                {["UNION", "MUNICIPALITY", "CITY_CORPORATION"].map((type) => (
                  <option key={type} value={type}>
                    {typeLabel(type)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <GeographyFields
            value={geography}
            onChange={setGeography}
            prefix="setup-geo"
            through={through}
            required
            legend="অফিসের এলাকা / Office area"
          />
          <div className="form-grid">
            <div className="field">
              <label htmlFor="setup-admin-name">{label("প্রশাসকের নাম", "Administrator's name")}</label>
              <input id="setup-admin-name" value={form.adminName} onChange={set("adminName")} required minLength={2} maxLength={120} autoComplete="name" />
            </div>
            <div className="field">
              <label htmlFor="setup-admin-email">{label("প্রশাসকের ইমেইল", "Administrator's email")}</label>
              <input id="setup-admin-email" type="email" value={form.adminEmail} onChange={set("adminEmail")} required maxLength={200} autoComplete="email" />
            </div>
            <div className="field">
              <label htmlFor="setup-password">{label("পাসওয়ার্ড (৬–১৮ অক্ষর)", "Password (6–18 characters)")}</label>
              <input id="setup-password" type="password" value={form.adminPassword} onChange={set("adminPassword")} required minLength={6} maxLength={18} autoComplete="new-password" />
            </div>
            <div className="field">
              <label htmlFor="setup-password-confirm">{label("পাসওয়ার্ড আবার লিখুন", "Repeat the password")}</label>
              <input id="setup-password-confirm" type="password" value={form.confirmPassword} onChange={set("confirmPassword")} required minLength={6} maxLength={18} autoComplete="new-password" />
            </div>
          </div>
          <label className="checkbox-label">
            <input type="checkbox" checked={form.acceptTerms} onChange={set("acceptTerms")} required />{" "}
            {label(
              "আমি এই অফিসের পক্ষে কাজ করার জন্য অনুমোদিত এবং জানি যে প্ল্যাটফর্ম কর্তৃপক্ষ যাচাই না করা পর্যন্ত অফিসটি সনদ ইস্যু করতে পারবে না।",
              "I am authorised to act for this office, and I understand it cannot issue certificates until the platform owner verifies it.",
            )}
          </label>
          <button disabled={busy}>{label("অফিস খুলুন", "Open the office")}</button>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
