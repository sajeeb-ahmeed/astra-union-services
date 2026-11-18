import React, { useEffect, useState } from "react";
import { t, useLanguage } from "./i18n.js";
import { api } from "./api.js";
import { citizenProfileCompleteness } from "@astra/shared-schemas";
import { ProfileCompleteness } from "./ProfileCompleteness.js";
import { IdentityDocument } from "./IdentityDocument.js";

/**
 * Phase 3a: personal and identity details of a citizen record. NID and birth-registration numbers are sent
 * only when typed; existing numbers are shown as masked hints, and the full numbers are fetched on request
 * from the audited identity endpoint.
 */
export type CitizenDetailsDraft = {
  gender: string;
  fatherNameBn: string;
  fatherNameEn: string;
  motherNameBn: string;
  motherNameEn: string;
  spouseNameBn: string;
  spouseNameEn: string;
  bloodGroup: string;
  nid: string;
  birthReg: string;
  mobile: string;
  noMobile: boolean;
};
const nameFields = [
  ["fatherNameBn", "পিতার নাম (বাংলা) / Father's name (Bangla)"],
  ["fatherNameEn", "পিতার নাম (ইংরেজি) / Father's name (English)"],
  ["motherNameBn", "মাতার নাম (বাংলা) / Mother's name (Bangla)"],
  ["motherNameEn", "মাতার নাম (ইংরেজি) / Mother's name (English)"],
  ["spouseNameBn", "স্বামী/স্ত্রীর নাম (বাংলা) / Spouse's name (Bangla)"],
  ["spouseNameEn", "স্বামী/স্ত্রীর নাম (ইংরেজি) / Spouse's name (English)"],
] as const;
const bloodGroups = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

export const emptyCitizenDetails = (): CitizenDetailsDraft => ({
  gender: "",
  fatherNameBn: "",
  fatherNameEn: "",
  motherNameBn: "",
  motherNameEn: "",
  spouseNameBn: "",
  spouseNameEn: "",
  bloodGroup: "",
  nid: "",
  birthReg: "",
  mobile: "",
  noMobile: false,
});
export function readCitizenDetails(citizen: any): CitizenDetailsDraft {
  const draft = emptyCitizenDetails();
  for (const [key] of nameFields) draft[key] = citizen?.[key] ?? "";
  return {
    ...draft,
    gender: citizen?.gender ?? "",
    bloodGroup: citizen?.bloodGroup ?? "",
    mobile: citizen?.contactMobile ?? "",
    noMobile: !!citizen?.noMobile,
  };
}
/**
 * The API payload. Names, gender and blood group are always sent (blank clears them); numbers only when typed,
 * so a blank number field keeps the stored one.
 */
export function citizenDetailsPayload(draft: CitizenDetailsDraft) {
  const blank = (value: string) => (value.trim() ? value.trim() : null);
  const payload: Record<string, unknown> = {
    gender: blank(draft.gender),
    bloodGroup: blank(draft.bloodGroup),
    noMobile: draft.noMobile,
  };
  for (const [key] of nameFields) payload[key] = blank(draft[key]);
  if (draft.nid.trim()) payload.nid = draft.nid.trim();
  if (draft.birthReg.trim()) payload.birthReg = draft.birthReg.trim();
  if (!draft.noMobile) payload.mobile = blank(draft.mobile);
  return payload;
}

export function CitizenDetailsFields({
  value,
  onChange,
  prefix,
  hints,
}: {
  value: CitizenDetailsDraft;
  onChange: (value: CitizenDetailsDraft) => void;
  prefix: string;
  /** Masked numbers already on file; when present, a blank field keeps them. */
  hints?: { nid?: string | null; birthReg?: string | null };
}) {
  useLanguage();
  const set = (patch: Partial<CitizenDetailsDraft>) => onChange({ ...value, ...patch });
  return (
    <fieldset className="citizen-details">
      <legend>{t("ব্যক্তিগত তথ্য / Personal details")}</legend>
      <div className="form-grid">
        <div className="field">
          <label htmlFor={`${prefix}-nid`}>{t("জাতীয় পরিচয়পত্র নম্বর / NID number")}</label>
          <input
            id={`${prefix}-nid`}
            inputMode="numeric"
            autoComplete="off"
            maxLength={40}
            value={value.nid}
            placeholder={hints?.nid ?? ""}
            aria-describedby={`${prefix}-numbers-hint`}
            onChange={(e) => set({ nid: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor={`${prefix}-birth-reg`}>
            {t("জন্ম নিবন্ধন নম্বর / Birth registration number")}
          </label>
          <input
            id={`${prefix}-birth-reg`}
            inputMode="numeric"
            autoComplete="off"
            maxLength={40}
            value={value.birthReg}
            placeholder={hints?.birthReg ?? ""}
            aria-describedby={`${prefix}-numbers-hint`}
            onChange={(e) => set({ birthReg: e.target.value })}
          />
        </div>
      </div>
      <p id={`${prefix}-numbers-hint`} className="hint">
        {t(
          hints?.nid || hints?.birthReg
            ? "Leave a number blank to keep the one on file. Numbers are stored encrypted."
            : "NID: 10, 13 or 17 digits. Birth registration: 17 digits. Numbers are stored encrypted.",
        )}
      </p>
      <div className="form-grid">
        <div className="field">
          <label htmlFor={`${prefix}-mobile`}>{t("মোবাইল নম্বর / Mobile number")}</label>
          <input
            id={`${prefix}-mobile`}
            type="tel"
            inputMode="tel"
            maxLength={40}
            value={value.mobile}
            disabled={value.noMobile}
            onChange={(e) => set({ mobile: e.target.value })}
          />
        </div>
        <div className="check-field">
          <label htmlFor={`${prefix}-no-mobile`}>
            <input
              id={`${prefix}-no-mobile`}
              type="checkbox"
              checked={value.noMobile}
              onChange={(e) => set({ noMobile: e.target.checked, mobile: e.target.checked ? "" : value.mobile })}
            />
            <span>{t("মোবাইল নম্বর নেই / Has no mobile number")}</span>
          </label>
        </div>
        <div className="field">
          <label htmlFor={`${prefix}-gender`}>{t("লিঙ্গ / Gender")}</label>
          <select id={`${prefix}-gender`} value={value.gender} onChange={(e) => set({ gender: e.target.value })}>
            <option value="">{t("নির্বাচন করুন / Not given")}</option>
            <option value="female">{t("নারী / Female")}</option>
            <option value="male">{t("পুরুষ / Male")}</option>
            <option value="other">{t("অন্যান্য / Other")}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${prefix}-blood`}>{t("রক্তের গ্রুপ / Blood group")}</label>
          <select id={`${prefix}-blood`} value={value.bloodGroup} onChange={(e) => set({ bloodGroup: e.target.value })}>
            <option value="">{t("নির্বাচন করুন / Not given")}</option>
            {bloodGroups.map((group) => (
              <option key={group} value={group}>
                {group}
              </option>
            ))}
          </select>
        </div>
        {nameFields.map(([key, label]) => (
          <div className="field" key={key}>
            <label htmlFor={`${prefix}-${key}`}>{t(label)}</label>
            <input
              id={`${prefix}-${key}`}
              maxLength={120}
              value={value[key]}
              onChange={(e) => set({ [key]: e.target.value } as Partial<CitizenDetailsDraft>)}
            />
          </div>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * CERTNO-01: the citizen's optional photo. It prints on certificates only
 * when present; removing it leaves no trace on the document. Uploads are
 * PNG/JPEG, validated again server-side by the attachments pipeline.
 */
export function CitizenPhoto({
  citizen,
  canEdit = true,
  onChanged,
}: {
  citizen: any;
  canEdit?: boolean;
  onChanged: (citizen: any) => void;
}) {
  useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stamp, setStamp] = useState(0);
  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read the file."));
        reader.readAsDataURL(file);
      });
      const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
      if (!match) throw new Error("Could not read the file.");
      const updated = await api(`/citizens/${citizen.id}/photo`, "PUT", {
        mimeType: match[1],
        base64: match[2],
      });
      setStamp((s) => s + 1);
      onChanged(updated);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError("");
    try {
      const updated = await api(`/citizens/${citizen.id}/photo`, "DELETE");
      setStamp((s) => s + 1);
      onChanged(updated);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="citizen-photo-control">
      <h3>{t("ছবি / Photo")}</h3>
      {citizen.hasPhoto ? (
        <img
          src={`/api/v1/citizens/${citizen.id}/photo/image?v=${stamp}`}
          alt={t("নাগরিকের ছবি / Citizen photo")}
          style={{ width: 76, height: 96, objectFit: "cover" }}
        />
      ) : (
        <p className="hint">{t("কোনো ছবি নেই — সনদে ছবির জায়গায় কিছুই ছাপা হবে না / No photo — nothing prints in the photo position on certificates.")}</p>
      )}
      {canEdit && (
        <div className="actions">
          <label className="button secondary">
            {t(citizen.hasPhoto ? "ছবি বদলান / Replace photo" : "ছবি আপলোড / Upload photo")}
            <input
              type="file"
              accept="image/png,image/jpeg"
              hidden
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
                e.target.value = "";
              }}
            />
          </label>
          {citizen.hasPhoto && (
            <button type="button" className="secondary" disabled={busy} onClick={() => void remove()}>
              {t("ছবি মুছুন / Remove photo")}
            </button>
          )}
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

/** Edit an existing citizen's details, with an audited reveal of the full numbers. */
export function CitizenDetailsEditor({
  citizen,
  onSaved,
  onClose,
  canEdit = true,
  geographyRequired = false,
}: {
  citizen: any;
  onSaved: (citizen: any) => void;
  onClose?: () => void;
  canEdit?: boolean;
  /** Phase 3b: whether the office uses structured geography, so the address area counts. */
  geographyRequired?: boolean;
}) {
  useLanguage();
  const [draft, setDraft] = useState(() => readCitizenDetails(citizen));
  const [revealed, setRevealed] = useState<{ nid: string | null; birthReg: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setDraft(readCitizenDetails(citizen));
    setRevealed(null);
    setSaved(false);
    setError("");
  }, [citizen.id]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const hasNumbers = !!(citizen.nidHint || citizen.birthRegHint);
  return (
    <section className="panel citizen-details-editor" aria-labelledby={`details-${citizen.id}`}>
      <h2 id={`details-${citizen.id}`}>
        {t("নাগরিকের তথ্য / Citizen details")}: {citizen.nameBn} <small>{citizen.nameEn}</small>
      </h2>
      <ProfileCompleteness completeness={citizenProfileCompleteness(citizen, { geographyRequired })} />
      <dl className="identity-summary">
        <dt>{t("জাতীয় পরিচয়পত্র / NID")}</dt>
        <dd data-testid="nid-value">{revealed ? (revealed.nid ?? "—") : (citizen.nidHint ?? "—")}</dd>
        <dt>{t("জন্ম নিবন্ধন / Birth registration")}</dt>
        <dd data-testid="birth-reg-value">
          {revealed ? (revealed.birthReg ?? "—") : (citizen.birthRegHint ?? "—")}
        </dd>
      </dl>
      {hasNumbers && !revealed && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const r = await api(`/citizens/${citizen.id}/identity`);
              setRevealed({ nid: r.nid, birthReg: r.birthReg });
            })
          }
        >
          {t("পূর্ণ নম্বর দেখুন / Show full numbers")}
        </button>
      )}
      {hasNumbers && !revealed && (
        <p className="hint">{t("Viewing full numbers is recorded in the audit log.")}</p>
      )}
      <IdentityDocument citizen={citizen} canEdit={canEdit} onChanged={onSaved} />
      <CitizenPhoto citizen={citizen} canEdit={canEdit} onChanged={onSaved} />
      {canEdit && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const updated = await api(`/citizens/${citizen.id}/details`, "PATCH", citizenDetailsPayload(draft));
              setDraft(readCitizenDetails(updated));
              setRevealed(null);
              setSaved(true);
              onSaved(updated);
            });
          }}
        >
          <CitizenDetailsFields
            prefix={`details-${citizen.id.slice(0, 8)}`}
            value={draft}
            onChange={(next) => {
              setDraft(next);
              setSaved(false);
            }}
            hints={{ nid: citizen.nidHint, birthReg: citizen.birthRegHint }}
          />
          <div className="actions">
            <button disabled={busy}>{t("তথ্য সংরক্ষণ করুন / Save details")}</button>
            {onClose && (
              <button type="button" className="secondary" onClick={onClose}>
                {t("বন্ধ করুন / Close")}
              </button>
            )}
          </div>
        </form>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {saved && (
        <div className="notice" role="status">
          {t("তথ্য সংরক্ষিত হয়েছে / Details saved")}
        </div>
      )}
    </section>
  );
}
