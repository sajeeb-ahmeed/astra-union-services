import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { choose, useLanguage } from "./i18n.js";

/**
 * CERT-FEE (owner): the fixed per-certificate platform prices (one for the
 * Bangla version, one for the English version; both cost the sum), the queue
 * of self-registered offices awaiting verification, and each office's billing
 * mode (per certificate, or the established submit billing).
 */
const label = (bn: string, en: string) => choose({ bn, en });
const taka = (minor: number) => `৳${(minor / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const toMinor = (text: string) => Math.round(Number(text) * 100);
const validTaka = (text: string) => text.trim() !== "" && Number.isFinite(Number(text)) && Number(text) >= 0 && Number(text) <= 100000;

function FeeSettings() {
  const [fees, setFees] = useState<{ feeBnMinor: number; feeEnMinor: number; configured: boolean; updatedAt: string | null } | null>(null);
  const [bn, setBn] = useState("");
  const [en, setEn] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const load = () =>
    api("/owner/certificate-fees")
      .then((r) => {
        setFees(r);
        setBn(r.configured ? String(r.feeBnMinor / 100) : "");
        setEn(r.configured ? String(r.feeEnMinor / 100) : "");
      })
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
  }, []);
  const ok = validTaka(bn) && validTaka(en) && reason.trim().length >= 8;
  return (
    <section className="panel" aria-labelledby="owner-cert-fees-title">
      <h3 id="owner-cert-fees-title">{label("প্রতি সনদের প্ল্যাটফর্ম ফি", "Platform fee per certificate")}</h3>
      <p className="hint">
        {label(
          "প্রতি-সনদ বিলিংয়ের অফিস চেয়ারম্যানের অনুমোদনের সময় এই ফি দেয়। বাংলা ও ইংরেজি দুটো নিলে দুটোর যোগফল।",
          "Offices on per-certificate billing pay this when the Chairman approves. Both Bangla and English cost the sum of the two.",
        )}
      </p>
      {fees && !fees.configured && (
        <p className="notice" role="status">
          {label("ফি এখনো নির্ধারণ করা হয়নি — নির্ধারণ না করা পর্যন্ত প্রতি-সনদ অফিস সনদ ইস্যু করতে পারবে না।", "No fee is set yet — per-certificate offices cannot issue until it is.")}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setMessage("");
          api("/owner/certificate-fees", "PUT", { feeBnMinor: toMinor(bn), feeEnMinor: toMinor(en), reason: reason.trim() })
            .then((r) => {
              setFees(r);
              setReason("");
              setMessage(label("ফি সংরক্ষিত হয়েছে।", "Fees saved."));
            })
            .catch((err) => setError((err as Error).message))
            .finally(() => setBusy(false));
        }}
      >
        <div className="form-grid">
          <div className="field">
            <label htmlFor="owner-fee-bn">{label("বাংলা সনদ (টাকা)", "Bangla certificate (taka)")}</label>
            <input id="owner-fee-bn" inputMode="decimal" value={bn} onChange={(e) => setBn(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="owner-fee-en">{label("ইংরেজি সনদ (টাকা)", "English certificate (taka)")}</label>
            <input id="owner-fee-en" inputMode="decimal" value={en} onChange={(e) => setEn(e.target.value)} required />
          </div>
        </div>
        <p className="owner-fee-both" aria-live="polite">
          {label("দুটোই (বাংলা ও ইংরেজি)", "Both (Bangla and English)")}:{" "}
          <strong>{validTaka(bn) && validTaka(en) ? taka(toMinor(bn) + toMinor(en)) : "—"}</strong>
        </p>
        <label htmlFor="owner-fee-reason">{label("পরিবর্তনের কারণ (কমপক্ষে ৮ অক্ষর)", "Reason for the change (at least 8 characters)")}</label>
        <input id="owner-fee-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required minLength={8} />
        <button disabled={busy || !ok}>{label("ফি সংরক্ষণ করুন", "Save fees")}</button>
      </form>
      {message && <p className="notice" role="status">{message}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

function OfficeVerifications() {
  const [items, setItems] = useState<any[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const load = () =>
    api("/owner/office-verifications?status=PENDING")
      .then((r) => setItems(r.items))
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
  }, []);
  const decide = (id: string, decision: "VERIFIED" | "REJECTED") => {
    setBusy(true);
    setError("");
    setMessage("");
    api(`/owner/tenants/${id}/verification`, "POST", { decision, ...(notes[id]?.trim() ? { note: notes[id].trim() } : {}) })
      .then(() => {
        setMessage(decision === "VERIFIED" ? label("অফিস যাচাই হয়েছে।", "Office verified.") : label("অফিস যাচাই প্রত্যাখ্যাত।", "Office verification refused."));
        return load();
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setBusy(false));
  };
  return (
    <section className="panel" aria-labelledby="owner-office-verify-title">
      <h3 id="owner-office-verify-title">{label("যাচাইয়ের অপেক্ষায় থাকা অফিস", "Offices awaiting verification")}</h3>
      <p className="hint">
        {label(
          "নিজে খোলা অফিস যাচাই না হওয়া পর্যন্ত জনসাধারণের তালিকায় আসে না এবং সনদ ইস্যু করতে পারে না।",
          "A self-registered office is not listed publicly and cannot issue certificates until you verify it.",
        )}
      </p>
      {items.length === 0 ? (
        <p>{label("এখন কোনো অফিস অপেক্ষায় নেই।", "No office is waiting.")}</p>
      ) : (
        <ul className="owner-verify-list">
          {items.map((o) => (
            <li key={o.id} className="owner-verify-item">
              <strong>{choose({ bn: o.nameBn, en: o.nameEn })}</strong>
              <small>
                {[o.upazila, o.district, o.division].filter(Boolean).join(", ")} · {o.adminName} ({o.adminEmail}) ·{" "}
                {new Date(o.createdAt).toLocaleDateString()}
              </small>
              <div className="owner-verify-actions">
                <input
                  aria-label={label("নোট (প্রত্যাখ্যানে আবশ্যক)", "Note (required to refuse)")}
                  placeholder={label("নোট", "Note")}
                  value={notes[o.id] ?? ""}
                  onChange={(e) => setNotes({ ...notes, [o.id]: e.target.value })}
                  maxLength={500}
                />
                <button disabled={busy} onClick={() => decide(o.id, "VERIFIED")}>
                  {label("যাচাই করুন", "Verify")}
                </button>
                <button className="danger" disabled={busy || (notes[o.id]?.trim().length ?? 0) < 3} onClick={() => decide(o.id, "REJECTED")}>
                  {label("প্রত্যাখ্যান", "Refuse")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {message && <p className="notice" role="status">{message}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

function BillingModes() {
  const [offices, setOffices] = useState<any[]>([]);
  const [selected, setSelected] = useState("");
  const [mode, setMode] = useState<"SUBMIT_CREDIT" | "PER_CERTIFICATE">("PER_CERTIFICATE");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const load = () =>
    api("/owner/tenants")
      .then((r) => setOffices(r.items ?? []))
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
  }, []);
  const current = offices.find((o) => o.id === selected);
  return (
    <section className="panel" aria-labelledby="owner-billing-mode-title">
      <h3 id="owner-billing-mode-title">{label("অফিসের বিলিং পদ্ধতি", "Office billing mode")}</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setMessage("");
          api(`/owner/tenants/${selected}/billing-mode`, "PUT", { billingMode: mode, reason: reason.trim() })
            .then(() => {
              setReason("");
              setMessage(label("বিলিং পদ্ধতি সংরক্ষিত হয়েছে।", "Billing mode saved."));
              return load();
            })
            .catch((err) => setError((err as Error).message))
            .finally(() => setBusy(false));
        }}
      >
        <div className="form-grid">
          <div className="field">
            <label htmlFor="owner-billing-office">{label("অফিস", "Office")}</label>
            <select id="owner-billing-office" value={selected} onChange={(e) => setSelected(e.target.value)} required>
              <option value="">{label("অফিস বাছুন", "Choose an office")}</option>
              {offices.map((o) => (
                <option key={o.id} value={o.id}>
                  {choose({ bn: o.nameBn ?? o.name_bn, en: o.nameEn ?? o.name_en })}
                </option>
              ))}
            </select>
            {current && (
              <small>
                {label("বর্তমান", "Current")}:{" "}
                {(current.billingMode ?? current.billing_mode) === "PER_CERTIFICATE"
                  ? label("প্রতি সনদ", "Per certificate")
                  : label("জমার সময় ক্রেডিট / সাবস্ক্রিপশন", "Credit at submit / subscription")}
              </small>
            )}
          </div>
          <div className="field">
            <label htmlFor="owner-billing-mode">{label("নতুন পদ্ধতি", "New mode")}</label>
            <select id="owner-billing-mode" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="PER_CERTIFICATE">{label("প্রতি সনদ (অনুমোদনের সময় ফি)", "Per certificate (fee at approval)")}</option>
              <option value="SUBMIT_CREDIT">{label("জমার সময় ক্রেডিট / সাবস্ক্রিপশন", "Credit at submit / subscription")}</option>
            </select>
          </div>
        </div>
        <label htmlFor="owner-billing-reason">{label("কারণ (কমপক্ষে ৮ অক্ষর)", "Reason (at least 8 characters)")}</label>
        <input id="owner-billing-reason" value={reason} onChange={(e) => setReason(e.target.value)} minLength={8} maxLength={500} required />
        <button disabled={busy || !selected || reason.trim().length < 8}>{label("সংরক্ষণ করুন", "Save")}</button>
      </form>
      {message && <p className="notice" role="status">{message}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

export function OwnerCertificateFees() {
  useLanguage();
  return (
    <div className="owner-certificate-fees">
      <FeeSettings />
      <OfficeVerifications />
      <BillingModes />
    </div>
  );
}
