import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { choose, useLanguage } from "./i18n.js";

const label = (bn: string, en: string) => choose({ bn, en });
const typeLabel = (type: string) =>
  ({
    UNION: label("ইউনিয়ন পরিষদ", "Union parishad"),
    MUNICIPALITY: label("পৌরসভা", "Municipality"),
    CITY_CORPORATION: label("সিটি কর্পোরেশন", "City corporation"),
  })[type] ?? type;

/** Phase 6b: designated issuing officers on an office's public page (name, post and services only). */
export function DesignatedOfficers({ officers }: { officers: any[] }) {
  useLanguage();
  if (!officers?.length) return null;
  return (
    <section className="designated-officers" aria-labelledby="officers-title">
      <h3 id="officers-title">{label("দায়িত্বপ্রাপ্ত সনদ প্রদানকারী কর্মকর্তা", "Designated issuing officers")}</h3>
      <ul>
        {officers.map((o, i) => (
          <li key={i}>
            <strong>{o.name}</strong>
            {o.postBn || o.postEn ? ` · ${choose({ bn: o.postBn ?? o.postEn, en: o.postEn ?? o.postBn })}` : ""}
            <small>
              {" "}
              · {label("সেবা", "Services")} {o.services.length}
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Phase 6b: anyone can ask for their office to be added; the platform owner follows up. */
export function OfficeInclusionForm() {
  useLanguage();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ officeName: "", officeType: "UNION", contactName: "", contactRole: "", contactMobile: "", contactEmail: "", message: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [key]: e.target.value });
  return (
    <section className="panel office-inclusion">
      <h2>{label("আপনার অফিস তালিকায় নেই?", "Office not listed?")}</h2>
      <p>
        {label(
          "আপনার ইউনিয়ন, পৌরসভা বা সিটি কর্পোরেশন অফিস DigitalUnion-তে যুক্ত করতে অনুরোধ পাঠান। প্ল্যাটফর্ম কর্তৃপক্ষ যোগাযোগ করবে।",
          "Ask for your union, municipality or city corporation office to be added to DigitalUnion. The platform team will contact you.",
        )}
      </p>
      {!open ? (
        <button className="secondary" onClick={() => setOpen(true)}>
          {label("অফিস যুক্ত করার অনুরোধ", "Request to add an office")}
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            api("/public/office-inclusion-requests", "POST", {
              ...form,
              contactEmail: form.contactEmail.trim(),
              message: form.message.trim() || undefined,
            })
              .then(() => {
                setMessage(label("অনুরোধ পাওয়া গেছে। ধন্যবাদ।", "Request received. Thank you."));
                setOpen(false);
              })
              .catch((err) => setError((err as Error).message))
              .finally(() => setBusy(false));
          }}
        >
          <div className="form-grid">
            <div className="field">
              <label htmlFor="inclusion-office">{label("অফিসের নাম", "Office name")}</label>
              <input id="inclusion-office" value={form.officeName} onChange={set("officeName")} required minLength={3} maxLength={160} />
            </div>
            <div className="field">
              <label htmlFor="inclusion-type">{label("অফিসের ধরন", "Office type")}</label>
              <select id="inclusion-type" value={form.officeType} onChange={set("officeType")}>
                {["UNION", "MUNICIPALITY", "CITY_CORPORATION"].map((type) => (
                  <option key={type} value={type}>
                    {typeLabel(type)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="inclusion-contact">{label("যোগাযোগকারীর নাম", "Contact name")}</label>
              <input id="inclusion-contact" value={form.contactName} onChange={set("contactName")} required minLength={2} maxLength={120} />
            </div>
            <div className="field">
              <label htmlFor="inclusion-role">{label("পদবি", "Position")}</label>
              <input id="inclusion-role" value={form.contactRole} onChange={set("contactRole")} required minLength={2} maxLength={120} />
            </div>
            <div className="field">
              <label htmlFor="inclusion-mobile">{label("মোবাইল নম্বর", "Mobile number")}</label>
              <input id="inclusion-mobile" type="tel" value={form.contactMobile} onChange={set("contactMobile")} required maxLength={40} />
            </div>
            <div className="field">
              <label htmlFor="inclusion-email">{label("ইমেইল (ঐচ্ছিক)", "Email (optional)")}</label>
              <input id="inclusion-email" type="email" value={form.contactEmail} onChange={set("contactEmail")} maxLength={200} />
            </div>
          </div>
          <label htmlFor="inclusion-message">{label("বার্তা (ঐচ্ছিক)", "Message (optional)")}</label>
          <textarea id="inclusion-message" value={form.message} onChange={set("message")} maxLength={1000} />
          <button disabled={busy}>{label("অনুরোধ পাঠান", "Send request")}</button>
        </form>
      )}
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
    </section>
  );
}

/** Phase 6b: the owner's queue of office inclusion requests. */
export function OwnerInclusionRequests() {
  useLanguage();
  const [items, setItems] = useState<any[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const load = () =>
    api("/owner/office-inclusion-requests")
      .then((r) => setItems(r.items))
      .catch((e) => setMessage((e as Error).message));
  useEffect(() => {
    void load();
  }, []);
  const decide = (id: string, status: string) =>
    api(`/owner/office-inclusion-requests/${id}/status`, "POST", { status, ...(notes[id]?.trim() ? { note: notes[id].trim() } : {}) })
      .then(() => {
        setMessage(label("হালনাগাদ হয়েছে।", "Updated."));
        return load();
      })
      .catch((e) => setMessage((e as Error).message));
  return (
    <section className="panel owner-inclusion">
      <h2>{label("অফিস যুক্ত করার অনুরোধ", "Office inclusion requests")}</h2>
      {message && <p role="status">{message}</p>}
      {items.length === 0 ? (
        <p>{label("খোলা কোনো অনুরোধ নেই।", "No open requests.")}</p>
      ) : (
        items.map((r) => (
          <article key={r.id} className="inclusion-item">
            <h3>
              {r.officeName} · {typeLabel(r.officeType)}
            </h3>
            <p>
              {r.contactName} ({r.contactRole}) · <code>{r.contactMobile}</code>
              {r.contactEmail ? ` · ${r.contactEmail}` : ""}
            </p>
            {r.message && <p>{r.message}</p>}
            <label htmlFor={`inclusion-note-${r.id}`}>{label("মন্তব্য", "Note")}</label>
            <input
              id={`inclusion-note-${r.id}`}
              value={notes[r.id] ?? ""}
              maxLength={500}
              onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
            />
            <div className="actions">
              {r.status === "NEW" && (
                <button className="secondary" onClick={() => void decide(r.id, "CONTACTED")}>
                  {label("যোগাযোগ করা হয়েছে", "Mark contacted")}
                </button>
              )}
              <button onClick={() => void decide(r.id, "ACCEPTED")}>{label("গ্রহণ করুন", "Accept")}</button>
              <button className="secondary" onClick={() => void decide(r.id, "DECLINED")}>
                {label("নাকচ করুন", "Decline")}
              </button>
            </div>
          </article>
        ))
      )}
    </section>
  );
}
