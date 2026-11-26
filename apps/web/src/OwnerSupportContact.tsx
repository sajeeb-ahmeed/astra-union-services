import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { choose, useLanguage } from "./i18n.js";
import { setCachedSupportContact } from "./support-contact.js";

const label = (bn: string, en: string) => choose({ bn, en });

/**
 * F-001: the owner edits the platform support contact — the phone, email
 * and office hours the public utility bar, help widget and footer show.
 * The values live in platform_settings; every change needs a reason and
 * lands in the settings history (Audit section). Clearing a field to empty
 * hides it publicly — an empty field is "not published", never a
 * placeholder. Enter the REAL channels only.
 */
export function OwnerSupportContact() {
  useLanguage();
  const [form, setForm] = useState({ phone: "", email: "", hoursBn: "", hoursEn: "" });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    const contact = await api("/owner/support-contact");
    setForm({
      phone: contact.phone ?? "",
      email: contact.email ?? "",
      hoursBn: contact.hoursBn ?? "",
      hoursEn: contact.hoursEn ?? "",
    });
  };
  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, []);

  async function save() {
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setError(label("সঠিক ইমেইল ঠিকানা লিখুন অথবা খালি রাখুন।", "Enter a valid email address or leave it blank."));
      return;
    }
    if (reason.trim().length < 8) {
      setError(label("পরিবর্তনের কারণ লিখুন (কমপক্ষে ৮ অক্ষর)।", "Give a reason for the change (at least 8 characters)."));
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const saved = await api("/owner/support-contact", "PUT", { ...form, reason: reason.trim() });
      setForm({
        phone: saved.phone ?? "",
        email: saved.email ?? "",
        hoursBn: saved.hoursBn ?? "",
        hoursEn: saved.hoursEn ?? "",
      });
      setCachedSupportContact({
        phone: saved.phone ?? "",
        email: saved.email ?? "",
        hours: { bn: saved.hoursBn ?? "", en: saved.hoursEn ?? "" },
      });
      setReason("");
      setMessage(label("সাপোর্ট যোগাযোগ হালনাগাদ হয়েছে।", "Support contact updated."));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h3>{label("সাপোর্ট যোগাযোগ", "Support contact")}</h3>
      <p className="hint">
        {label(
          "পাবলিক সাইটের উপরের বার, সাহায্য উইজেট ও ফুটারে দেখা যায়। আসল ফোন নম্বর ও ইমেইল লিখুন — খালি ঘর প্রকাশিত হয় না, প্লেসহোল্ডার দেখানো হয় না। প্রতিটি পরিবর্তনে কারণ বাধ্যতামূলক এবং তা অডিট ইতিহাসে থাকে।",
          "Shown in the public utility bar, help widget and footer. Enter the real phone number and email — an empty field is not published and no placeholder is shown. Every change needs a reason and is kept in the audit history.",
        )}
      </p>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="field-row">
        <label>
          {label("ফোন", "Phone")}
          <input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            maxLength={40}
            placeholder="+8801XXXXXXXXX"
          />
        </label>
        <label>
          {label("ইমেইল", "Email")}
          <input
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            maxLength={120}
            placeholder="support@your-domain"
          />
        </label>
      </div>
      <div className="field-row">
        <label>
          {label("অফিস সময় (বাংলা)", "Office hours (Bangla)")}
          <input
            value={form.hoursBn}
            onChange={(e) => setForm({ ...form, hoursBn: e.target.value })}
            maxLength={200}
            placeholder="শনি–বৃহস্পতি, সকাল ৯টা–বিকাল ৫টা"
          />
        </label>
        <label>
          {label("অফিস সময় (ইংরেজি)", "Office hours (English)")}
          <input
            value={form.hoursEn}
            onChange={(e) => setForm({ ...form, hoursEn: e.target.value })}
            maxLength={200}
            placeholder="Sat–Thu, 9am–5pm"
          />
        </label>
      </div>
      <div className="field-row">
        <label>
          {label("কারণ", "Reason")}
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </label>
        <button type="button" disabled={busy} onClick={save}>
          {label("সাপোর্ট যোগাযোগ সংরক্ষণ", "Save support contact")}
        </button>
      </div>
    </section>
  );
}
