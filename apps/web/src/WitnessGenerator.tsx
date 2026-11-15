import React, { useEffect, useMemo, useState } from "react";
import { api } from "./api.js";
import { choose, useLanguage } from "./i18n.js";

const label = (bn: string, en: string) => choose({ bn, en });

/**
 * Phase 4c: the free public witness-statement generator. Options come from the platform owner's list; the
 * finished PDF is a utility document (not an office certificate) and nothing entered here is stored.
 */
export function WitnessGenerator() {
  useLanguage();
  const [types, setTypes] = useState<any[]>([]);
  const [religion, setReligion] = useState("");
  const [typeId, setTypeId] = useState("");
  const [form, setForm] = useState({ deceasedNameBn: "", attestorNameBn: "", mobile: "", nid: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [download, setDownload] = useState<string | null>(null);
  useEffect(() => {
    api("/public/witness/options")
      .then((r) => setTypes(r.items))
      .catch((e) => setError((e as Error).message));
  }, []);
  const religions = useMemo(() => {
    const seen = new Map<string, any>();
    for (const t of types) if (!seen.has(t.religionEn)) seen.set(t.religionEn, t);
    return [...seen.values()];
  }, [types]);
  const forReligion = types.filter((t) => t.religionEn === religion);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });
  return (
    <section className="panel witness-generator">
      <h1>{label("সাক্ষীর প্রত্যয়ন তৈরি", "Witness statement")}</h1>
      <p className="notice">
        {label(
          "এটি একটি সহায়ক নথি, অফিসের সনদ নয়। প্রত্যয়নকারী স্বাক্ষর করে সংশ্লিষ্ট অফিসে জমা দেবেন। আপনার দেওয়া তথ্য সংরক্ষণ করা হয় না।",
          "This is a utility document, not an office certificate. The attestor signs it and submits it to the office. Nothing you enter is stored.",
        )}
      </p>
      {types.length === 0 && !error ? (
        <p>{label("এখনও কোনো ধরন যুক্ত করা হয়নি।", "No certificate types have been added yet.")}</p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            if (download) URL.revokeObjectURL(download);
            setDownload(null);
            fetch("/api/v1/public/witness", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ typeId, ...form }),
            })
              .then(async (r) => {
                if (!r.ok) throw Error((await r.json().catch(() => null))?.error?.message ?? `Request failed (${r.status})`);
                setDownload(URL.createObjectURL(await r.blob()));
              })
              .catch((err) => setError((err as Error).message))
              .finally(() => setBusy(false));
          }}
        >
          <div className="form-grid">
            <div className="field">
              <label htmlFor="witness-religion">{label("ধর্ম", "Religion")}</label>
              <select
                id="witness-religion"
                value={religion}
                required
                onChange={(e) => {
                  setReligion(e.target.value);
                  setTypeId("");
                }}
              >
                <option value="">{label("নির্বাচন করুন", "Choose")}</option>
                {religions.map((r) => (
                  <option key={r.religionEn} value={r.religionEn}>
                    {choose({ bn: r.religionBn, en: r.religionEn })}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="witness-type">{label("সনদের ধরন", "Certificate type")}</label>
              <select id="witness-type" value={typeId} required disabled={!religion} onChange={(e) => setTypeId(e.target.value)}>
                <option value="">{label("নির্বাচন করুন", "Choose")}</option>
                {forReligion.map((t) => (
                  <option key={t.id} value={t.id}>
                    {choose({ bn: t.nameBn, en: t.nameEn })}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="witness-deceased">{label("মৃত ব্যক্তির নাম (বাংলা)", "Deceased's name (Bangla)")}</label>
              <input id="witness-deceased" value={form.deceasedNameBn} onChange={set("deceasedNameBn")} required minLength={2} maxLength={150} />
            </div>
            <div className="field">
              <label htmlFor="witness-attestor">{label("প্রত্যয়নকারীর নাম (বাংলা)", "Attestor's name (Bangla)")}</label>
              <input id="witness-attestor" value={form.attestorNameBn} onChange={set("attestorNameBn")} required minLength={2} maxLength={150} />
            </div>
            <div className="field">
              <label htmlFor="witness-mobile">{label("প্রত্যয়নকারীর মোবাইল", "Attestor's mobile")}</label>
              <input id="witness-mobile" type="tel" value={form.mobile} onChange={set("mobile")} required maxLength={40} />
            </div>
            <div className="field">
              <label htmlFor="witness-nid">{label("প্রত্যয়নকারীর এনআইডি (১০ বা ১৭ অঙ্ক)", "Attestor's NID (10 or 17 digits)")}</label>
              <input id="witness-nid" inputMode="numeric" value={form.nid} onChange={set("nid")} required maxLength={40} autoComplete="off" />
            </div>
          </div>
          <button disabled={busy}>{label("নথি তৈরি করুন", "Create document")}</button>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {download && (
        <p role="status">
          <a className="button" href={download} download="witness-statement.pdf">
            {label("পিডিএফ ডাউনলোড করুন", "Download PDF")}
          </a>
        </p>
      )}
    </section>
  );
}

/** Phase 4c: the owner's list of religions and certificate types offered by the generator. */
export function OwnerWitnessTypes() {
  useLanguage();
  const [items, setItems] = useState<any[]>([]);
  const [form, setForm] = useState({ religionBn: "", religionEn: "", nameBn: "", nameEn: "" });
  const [message, setMessage] = useState("");
  const load = () =>
    api("/owner/witness-types")
      .then((r) => setItems(r.items))
      .catch((e) => setMessage((e as Error).message));
  useEffect(() => {
    void load();
  }, []);
  return (
    <section className="panel owner-witness-types">
      <h2>{label("সাক্ষীর প্রত্যয়নের ধরন", "Witness statement types")}</h2>
      <p className="hint">
        {label(
          "পাবলিক সাক্ষীর প্রত্যয়ন পাতায় এই তালিকার ধর্ম ও সনদের ধরনই দেখানো হয়।",
          "The public witness statement page offers exactly the religions and certificate types in this list.",
        )}
      </p>
      <ul>
        {items.map((t) => (
          <li key={t.id}>
            {t.religionBn} / {t.religionEn} · {t.nameBn} / {t.nameEn}{" "}
            <button
              type="button"
              className="secondary"
              onClick={() =>
                api(`/owner/witness-types/${t.id}`, "PATCH", { active: !t.active })
                  .then(load)
                  .catch((e) => setMessage((e as Error).message))
              }
            >
              {t.active ? label("চালু · বন্ধ করুন", "On · switch off") : label("বন্ধ · চালু করুন", "Off · switch on")}
            </button>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          api("/owner/witness-types", "POST", form)
            .then(() => {
              setForm({ religionBn: "", religionEn: "", nameBn: "", nameEn: "" });
              setMessage(label("যুক্ত হয়েছে।", "Added."));
              return load();
            })
            .catch((err) => setMessage((err as Error).message));
        }}
      >
        <div className="form-grid">
          {(
            [
              ["religionBn", label("ধর্ম (বাংলা)", "Religion (Bangla)")],
              ["religionEn", label("ধর্ম (ইংরেজি)", "Religion (English)")],
              ["nameBn", label("সনদের ধরন (বাংলা)", "Certificate type (Bangla)")],
              ["nameEn", label("সনদের ধরন (ইংরেজি)", "Certificate type (English)")],
            ] as const
          ).map(([key, text]) => (
            <div className="field" key={key}>
              <label htmlFor={`witness-type-${key}`}>{text}</label>
              <input
                id={`witness-type-${key}`}
                value={form[key]}
                required
                minLength={2}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            </div>
          ))}
        </div>
        <button>{label("ধরন যুক্ত করুন", "Add type")}</button>
      </form>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
