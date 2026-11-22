/**
 * REG-UX Phase 1 (design note §2.3, guide §7): inline profile completion inside the
 * apply flow. A short-signup account has no date of birth, address, second-script
 * name or ward yet; before the form, the citizen is asked for ONLY those missing
 * items — never the whole profile — and the flow then continues into the form.
 *
 * The values are sent to PATCH /citizens/:id/profile (fill-only on the server).
 * Field errors from the API are shown at the field (the F2 pattern).
 */
import React, { useState } from "react";
import { applicationProfileGaps, type CompletenessItem } from "@astra/shared-schemas";
import { api, fieldErrors } from "./api.js";
import { choose } from "./i18n.js";
import { GeographyFields, geographyPayload, readGeography } from "./GeographyFields.js";
import "./profile-completion.css";

/** The deferred items this citizen still lacks for a new application. */
export function profileGapsFor(citizen: any): CompletenessItem[] {
  if (!citizen) return [];
  // A citizen of a geography-mapped office carries that office's area; only then
  // is the ward part of the gate (legacy offices have no structured geography).
  return applicationProfileGaps(citizen, { geographyRequired: !!citizen?.geography?.divisionCode });
}

const filled = (v: unknown) => typeof v === "string" && v.trim().length > 0;

export function ProfileCompletionCard({
  citizen,
  onSaved,
}: {
  citizen: any;
  onSaved: (citizen: any) => void;
}) {
  const gaps = profileGapsFor(citizen);
  const needNameBn = gaps.includes("name") && !filled(citizen?.nameBn);
  const needNameEn = gaps.includes("name") && !filled(citizen?.nameEn);
  const needDob = gaps.includes("dateOfBirth");
  const needAddressBn = gaps.includes("address") && !filled(citizen?.addressBn);
  const needAddressEn = gaps.includes("address") && !filled(citizen?.addressEn);
  const needWard = gaps.includes("geography");
  const [form, setForm] = useState({ nameBn: "", nameEn: "", dateOfBirth: "", addressBn: "", addressEn: "" });
  const [geography, setGeography] = useState(() => readGeography(citizen?.geography));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pageError, setPageError] = useState("");
  const [busy, setBusy] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((previous) => ({ ...previous, [key]: e.target.value }));
    if (errors[key]) setErrors(({ [key]: _drop, ...rest }) => rest);
  };
  const err = (key: string) =>
    errors[key] ? (
      <p className="du-field-error" id={`pc-${key}-error`} role="alert">
        {errors[key]}
      </p>
    ) : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (needWard && !geography.wardCode) {
      setErrors((previous) => ({
        ...previous,
        geography: choose({ bn: "আপনার ওয়ার্ড বেছে নিন।", en: "Choose your ward." }),
      }));
      return;
    }
    setBusy(true);
    setPageError("");
    setErrors({});
    try {
      const body: Record<string, unknown> = {};
      if (needNameBn) body.nameBn = form.nameBn.trim();
      if (needNameEn) body.nameEn = form.nameEn.trim();
      if (needDob) body.dateOfBirth = form.dateOfBirth;
      if (needAddressBn) body.addressBn = form.addressBn.trim();
      if (needAddressEn) body.addressEn = form.addressEn.trim();
      if (needWard) body.geography = geographyPayload(geography);
      onSaved(await api(`/citizens/${citizen.id}/profile`, "PATCH", body));
    } catch (error) {
      const mapped = fieldErrors(error);
      if (Object.keys(mapped).length) setErrors(mapped);
      else setPageError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!gaps.length) return null;
  return (
    <form className="du-profile-completion" onSubmit={save} aria-labelledby="pc-title">
      <div className="du-profile-completion-head">
        <h4 id="pc-title">{choose({ bn: "আবেদনের আগে কয়েকটি তথ্য দিন", en: "A few details before you apply" })}</h4>
        <p>
          {choose({
            bn: "সনদে ছাপা হবে বলে এই তথ্যগুলো লাগবে। শুধু যা নেই তা-ই চাওয়া হচ্ছে — একবার দিলেই হবে।",
            en: "These print on your certificate. Only what is missing is asked — you give it once.",
          })}
        </p>
      </div>
      <div className="du-profile-completion-grid">
        {needNameBn && (
          <label htmlFor="pc-nameBn">
            {choose({ bn: "নাম (বাংলায়)", en: "Name (in Bangla)" })}
            <input id="pc-nameBn" required minLength={2} maxLength={120} lang="bn" value={form.nameBn} onChange={set("nameBn")} aria-invalid={!!errors.nameBn} aria-describedby={errors.nameBn ? "pc-nameBn-error" : undefined} />
            {err("nameBn")}
          </label>
        )}
        {needNameEn && (
          <label htmlFor="pc-nameEn">
            {choose({ bn: "নাম (ইংরেজিতে)", en: "Name (in English)" })}
            <input id="pc-nameEn" required minLength={2} maxLength={120} lang="en" autoComplete="name" value={form.nameEn} onChange={set("nameEn")} aria-invalid={!!errors.nameEn} aria-describedby={errors.nameEn ? "pc-nameEn-error" : undefined} />
            {err("nameEn")}
          </label>
        )}
        {needDob && (
          <label htmlFor="pc-dateOfBirth">
            {choose({ bn: "জন্ম তারিখ", en: "Date of birth" })}
            <input id="pc-dateOfBirth" type="date" required min="1900-01-01" max={today} value={form.dateOfBirth} onChange={set("dateOfBirth")} aria-invalid={!!errors.dateOfBirth} aria-describedby={errors.dateOfBirth ? "pc-dateOfBirth-error" : undefined} />
            {err("dateOfBirth")}
          </label>
        )}
        {needAddressBn && (
          <label htmlFor="pc-addressBn" className="du-span-2">
            {choose({ bn: "স্থায়ী ঠিকানা (বাংলায়) — গ্রাম, বাড়ি, রাস্তা", en: "Permanent address (in Bangla) — village, house, road" })}
            <input id="pc-addressBn" required minLength={4} maxLength={500} lang="bn" value={form.addressBn} onChange={set("addressBn")} aria-invalid={!!errors.addressBn} aria-describedby={errors.addressBn ? "pc-addressBn-error" : undefined} />
            {err("addressBn")}
          </label>
        )}
        {needAddressEn && (
          <label htmlFor="pc-addressEn" className="du-span-2">
            {choose({ bn: "স্থায়ী ঠিকানা (ইংরেজিতে)", en: "Permanent address (in English)" })}
            <input id="pc-addressEn" required minLength={4} maxLength={500} lang="en" value={form.addressEn} onChange={set("addressEn")} aria-invalid={!!errors.addressEn} aria-describedby={errors.addressEn ? "pc-addressEn-error" : undefined} />
            {err("addressEn")}
          </label>
        )}
      </div>
      {needWard && (
        <div className="du-profile-completion-ward">
          <GeographyFields
            prefix="pc-geo"
            value={geography}
            onChange={setGeography}
            required
            legend={choose({ bn: "আপনার ওয়ার্ড (এলাকা)", en: "Your ward (area)" })}
          />
          {err("geography")}
        </div>
      )}
      {pageError && (
        <p className="notice error" role="alert">
          {pageError}
        </p>
      )}
      <div className="du-profile-completion-actions">
        <button type="submit" disabled={busy}>
          {busy
            ? choose({ bn: "সংরক্ষণ হচ্ছে…", en: "Saving…" })
            : choose({ bn: "সংরক্ষণ করে আবেদন চালিয়ে যান", en: "Save and continue to the form" })}
        </button>
      </div>
    </form>
  );
}
