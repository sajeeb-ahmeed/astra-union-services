import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { choose, useLanguage } from "./i18n.js";
import { setCachedBranding, type Branding } from "./branding.js";

const label = (bn: string, en: string) => choose({ bn, en });

/**
 * Phase 3D: branding basics (billing plan §3.9). The owner edits the platform display
 * name and taglines; the values live in platform_settings and every change needs a
 * reason and lands in the settings history (Audit section). The public header/footer
 * and the workspace brand render these values, falling back to the built-in defaults.
 * The logo is a fixed brand image asset and is not editable here.
 */
export function OwnerBranding() {
  useLanguage();
  const [form, setForm] = useState<Branding>({ name: "", taglineBn: "", taglineEn: "" });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    const branding = await api("/owner/branding");
    setForm({
      name: branding.name,
      taglineBn: branding.taglineBn,
      taglineEn: branding.taglineEn,
    });
  };
  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, []);

  async function save() {
    if (!form.name.trim() || !form.taglineBn.trim() || !form.taglineEn.trim()) {
      setError(label("নাম ও দুটি স্লোগানই পূরণ করুন।", "Fill in the name and both taglines."));
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
      const saved = await api("/owner/branding", "PUT", { ...form, reason: reason.trim() });
      setForm({ name: saved.name, taglineBn: saved.taglineBn, taglineEn: saved.taglineEn });
      setCachedBranding({ name: saved.name, taglineBn: saved.taglineBn, taglineEn: saved.taglineEn });
      setReason("");
      setMessage(label("ব্র্যান্ডিং হালনাগাদ হয়েছে।", "Branding updated."));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h3>{label("ব্র্যান্ডিং", "Branding")}</h3>
      <p className="hint">
        {label(
          "প্ল্যাটফর্মের নাম ও স্লোগান পাবলিক হেডার/ফুটার এবং ওয়ার্কস্পেসে দেখা যায়। লোগো একটি স্থির ব্র্যান্ড ছবি — এখানে বদলানো যায় না। প্রতিটি পরিবর্তনে কারণ বাধ্যতামূলক এবং তা অডিট ইতিহাসে থাকে।",
          "The platform name and taglines appear in the public header/footer and the workspace. The logo is a fixed brand image and cannot be changed here. Every change needs a reason and is kept in the audit history.",
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
          {label("প্ল্যাটফর্মের নাম", "Platform name")}
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            maxLength={80}
          />
        </label>
        <label>
          {label("স্লোগান (বাংলা)", "Tagline (Bangla)")}
          <input
            value={form.taglineBn}
            onChange={(e) => setForm({ ...form, taglineBn: e.target.value })}
            maxLength={200}
          />
        </label>
        <label>
          {label("স্লোগান (ইংরেজি)", "Tagline (English)")}
          <input
            value={form.taglineEn}
            onChange={(e) => setForm({ ...form, taglineEn: e.target.value })}
            maxLength={200}
          />
        </label>
      </div>
      <div className="field-row">
        <label>
          {label("কারণ", "Reason")}
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </label>
        <button type="button" disabled={busy} onClick={save}>
          {label("ব্র্যান্ডিং সংরক্ষণ", "Save branding")}
        </button>
      </div>
    </section>
  );
}
