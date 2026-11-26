import { choose, t, tx, useLanguage } from "./i18n.js";
import serviceCatalog from "./public-service-catalog.json" with { type: "json" };
import { formatDateTime } from "./ui/fmt.js";
import { EmptyState, applicationStatusMeta, ledgerKindMeta } from "./ui/kit.js";
import React, { useEffect, useState } from "react";
import { api, fieldErrors, items } from "./api.js";
import {
  PresentAddressFields,
  presentAddressPayload,
  readPresentAddress,
} from "./PresentAddressFields.js";
import {
  CitizenPhoto,
  citizenDetailsPayload,
  readCitizenDetails,
  type CitizenDetailsDraft,
} from "./CitizenDetailsFields.js";
import { CitizenDocumentsVault } from "./CitizenDocumentsVault.js";
import { ProfileCompleteness } from "./ProfileCompleteness.js";
import { citizenProfileCompleteness } from "@astra/shared-schemas";
import { OfficeIdentitySettings } from "./OfficeIdentity.js";
import {
  GeographyFields,
  geographyPayload,
  readGeography,
} from "./GeographyFields.js";

function Field({
  label,
  name,
  value,
  onChange,
  type = "text",
  required = false,
  maxLength = 150,
  disabled = false,
  hint,
  error,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  maxLength?: number;
  disabled?: boolean;
  hint?: string;
  error?: string;
}) {
  return (
    <label htmlFor={name}>
      {tx(label)}
      <input
        id={name}
        name={name}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        maxLength={maxLength}
        disabled={disabled}
        aria-describedby={hint ? `${name}-hint` : undefined}
      />
      {hint && (
        <span className="hint" id={`${name}-hint`}>
          {tx(hint)}
        </span>
      )}
      {error && (
        <span className="error" role="alert">
          {tx(error)}
        </span>
      )}
    </label>
  );
}
export function AdditionalWorkspace({
  page,
  session,
  onOpenApplication,
}: {
  page: string;
  session: any;
  /** REFINEMENT-02 P2-4: notification rows open their application. */
  onOpenApplication?: (applicationId: string) => void;
}) {
  // FULL-UIUX-01: dates render through the shared locale formatter —
  // never the browser's own locale string.
  const [uiLanguage] = useLanguage();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [ownCitizen, setOwnCitizen] = useState<any>(null);
  const [profile, setProfile] = useState<any>({
    displayName: "",
    nameBn: "",
    phone: "",
    address: "",
    citizenNameEn: "",
    dateOfBirth: "",
    permanentAddressBn: "",
    permanentAddressEn: "",
  });
  // Citizen dashboard + profile (2026-11-26): the citizen profile page is
  // ONE form over two existing endpoints. `details` is the typed draft for
  // PATCH /citizens/:id/details; `profileErrors` carries per-field errors
  // from either endpoint; `revealed` is the audited full-number view.
  const [details, setDetails] = useState<CitizenDetailsDraft | null>(null);
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<{ nid: string | null; birthReg: string | null } | null>(null);
  useEffect(() => {
    if (ownCitizen) {
      setDetails(readCitizenDetails(ownCitizen));
      setRevealed(null);
    }
  }, [ownCitizen?.id]);
  const [citizens, setCitizens] = useState<any[]>([]),
    [requests, setRequests] = useState<any[]>([]),
    [citizenId, setCitizenId] = useState("");
  const [citizenSearch, setCitizenSearch] = useState("");
  const [kind, setKind] = useState("biodata"),
    [language, setLanguage] = useState("bilingual"),
    [requestKey, setRequestKey] = useState(crypto.randomUUID());
  const [printPage, setPrintPage] = useState(1),
    [printTotal, setPrintTotal] = useState(0);
  // Phase 6c: find copies by name, reference or mobile within a date range.
  const [printSearch, setPrintSearch] = useState(""),
    [printFrom, setPrintFrom] = useState(""),
    [printTo, setPrintTo] = useState("");
  const [holding, setHolding] = useState({
    number: "",
    ownerBn: "",
    ownerEn: "",
    addressBn: "",
    addressEn: "",
    annualValueMinor: "0",
  });
  const [witness, setWitness] = useState({
    deceasedNameBn: "",
    deceasedNameEn: "",
    witnessNameBn: "",
    witnessNameEn: "",
    statement: "",
  });
  const [notifications, setNotifications] = useState<any[]>([]),
    [feedback, setFeedback] = useState<any[]>([]),
    [feedbackStatus, setFeedbackStatus] = useState("");
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [report, setReport] = useState<any>(null),
    [reportQuery, setReportQuery] = useState("");
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const filterQuery = () =>
    `?${new URLSearchParams({ page: String(printPage), kind, ...(printSearch.trim() ? { q: printSearch.trim() } : {}), ...(printFrom ? { from: printFrom } : {}), ...(printTo ? { to: printTo } : {}) })}`;
  async function loadPrints() {
    const r = await api(`/print-requests${filterQuery()}`);
    setRequests(items(r));
    setPrintTotal(r.total);
  }
  useEffect(() => {
    void run(async () => {
      if (page === "profile") {
        // QAFIX-01 (§4 item 13): the profile and citizen reads run in
        // parallel — they used to be sequential awaits, so the page's
        // spinner lasted the sum of both round trips.
        const [loaded, citizensResult] = await Promise.all([
          api("/profile"),
          session.user.role === "citizen"
            ? api("/citizens")
            : Promise.resolve(null),
        ]);
        // QAFIX-01: for a citizen, the Bangla name field shows the citizen
        // record's name — the one completeness and certificates read.
        if (session.user.role === "citizen" && loaded.citizenNameBn)
          loaded.nameBn = loaded.citizenNameBn;
        setProfile(loaded);
        // Phase 3a: a citizen also keeps their own personal and identity details.
        if (session.user.role === "citizen")
          setOwnCitizen(items(citizensResult)[0] ?? null);
      }
      if (page === "prints") {
        const c = items(await api("/citizens"));
        setCitizens(c);
        setCitizenId((v) => v || c[0]?.id || "");
        await loadPrints();
      }
      if (page === "notifications")
        setNotifications(items(await api("/notifications")));
      if (page === "support")
        setFeedback(
          items(
            await api(
              `/owner/feedback${feedbackStatus ? "?status=" + feedbackStatus : ""}`,
            ),
          ),
        );
      if (page === "reports") setReport(await api("/reports"));
    });
  }, [page, kind, printPage, feedbackStatus]);
  const setHoldingField = (name: string, v: string) => {
    setHolding({ ...holding, [name]: v });
    setRequestKey(crypto.randomUUID());
  };
  const setWitnessField = (name: string, v: string) => {
    setWitness({ ...witness, [name]: v });
    setRequestKey(crypto.randomUUID());
  };
  return (
    <div className="workspace-additional">
      {tx(
        error && (
          <div className="notice error" role="alert">
            {tx(error)}
          </div>
        ),
      )}
      {tx(
        message && (
          <div className="notice success" role="status">
            {tx(message)}
          </div>
        ),
      )}
      {tx(
        page === "profile" && (
          <>
            <section className="panel">
              <span className="eyebrow">{t("MY ACCOUNT")}</span>
              <h2>{t("আমার প্রোফাইল / My profile")}</h2>
              <p>
                {session.user.email}
                {t(" · ")}
                {tx(session.user.role)}
              </p>
              {/* WS-D3: the stored identity, read-only — kept for office
                  accounts; citizens see their stored values in the four
                  sections below, so the panel would only repeat them. */}
              {session.user.role !== "citizen" && (
                <section className="panel" data-testid="profile-identity">
                  <h3>{t("সংরক্ষিত পরিচয় / Stored identity")}</h3>
                  <dl>
                    <dt>{t("Account display name")}</dt>
                    <dd>
                      {profile.displayName?.trim() ? (
                        profile.displayName
                      ) : (
                        <em>{t("Not provided / দেওয়া নেই")}</em>
                      )}
                    </dd>
                    <dt>{t("নাম (বাংলা)")}</dt>
                    <dd>
                      {profile.nameBn?.trim() ? (
                        profile.nameBn
                      ) : (
                        <em>{t("Not provided / দেওয়া নেই")}</em>
                      )}
                    </dd>
                    <dt>{t("Email")}</dt>
                    <dd>{session.user.email}</dd>
                    <dt>{t("Role / ভূমিকা")}</dt>
                    <dd>{tx(session.user.role)}</dd>
                    <dt>{t("Office / অফিস")}</dt>
                    <dd>
                      {session.tenant
                        ? uiLanguage === "bn"
                          ? (session.tenant.nameBn ?? session.tenant.name_bn ?? "")
                          : (session.tenant.nameEn ?? session.tenant.name_en ?? "")
                        : "—"}
                    </dd>
                    <dt>{t("Mobile / মোবাইল")}</dt>
                    <dd>
                      {profile.phone?.trim() ? (
                        profile.phone
                      ) : (
                        <em>{t("Not provided / দেওয়া নেই")}</em>
                      )}
                    </dd>
                    <dt>{t("Address / ঠিকানা")}</dt>
                    <dd>
                      {profile.address?.trim() ? (
                        profile.address
                      ) : (
                        <em>{t("Not provided / দেওয়া নেই")}</em>
                      )}
                    </dd>
                  </dl>
                  <p className="hint">
                    {t(
                      "নাম, মোবাইল বা ঠিকানা যোগ করতে নিচের ফর্মটি ব্যবহার করুন। / Use the form below to add a name, mobile number or address.",
                    )}
                  </p>
                </section>
              )}
              {session.user.role === "approver" && (
                <section className="panel" data-testid="approval-authority">
                  <h3>{t("অনুমোদনের ক্ষমতা / Approval authority")}</h3>
                  {profile.approvalAuthorizations?.length ? (
                    <>
                      <p>
                        {choose({
                          bn: `এই অ্যাকাউন্ট ${profile.approvalAuthorizations.length}টি সেবার আবেদন অনুমোদন করতে পারে।`,
                          en: `This account may approve applications for ${profile.approvalAuthorizations.length} services.`,
                        })}
                      </p>
                      <ul>
                        {profile.approvalAuthorizations.map((a: any) => {
                          const svc = (
                            serviceCatalog as readonly {
                              service_no: number;
                              name_bn: string;
                              name_en: string;
                            }[]
                          ).find(
                            (s) => s.service_no === Number(a.serviceNo),
                          );
                          return (
                            <li key={a.serviceNo}>
                              {svc
                                ? choose({ bn: svc.name_bn, en: svc.name_en })
                                : choose({
                                    bn: `সেবা ${a.serviceNo}`,
                                    en: `Service ${a.serviceNo}`,
                                  })}
                              {a.authorityNote ? ` — ${a.authorityNote}` : ""}
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  ) : (
                    <>
                      <p>
                        {t(
                          "কোনো সেবার আবেদন অনুমোদনের ক্ষমতা এই অ্যাকাউন্টকে দেওয়া হয়নি। / No approval authority has been given to this account.",
                        )}
                      </p>
                      <p className="hint">
                        {t(
                          "ক্ষমতা যোগ করতে অফিস প্রশাসককে বলুন। / Ask the office admin to add the authority.",
                        )}
                      </p>
                    </>
                  )}
                </section>
              )}
              {session.user.role === "citizen" && ownCitizen && details ? (
                <form
                  data-testid="citizen-profile-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void (async () => {
                      setBusy(true);
                      setError("");
                      setMessage("");
                      setProfileErrors({});
                      try {
                        // ONE Save, two proven endpoints in sequence:
                        // PATCH /profile (names, DOB, addresses, geography)
                        // then PATCH /citizens/:id/details (parents, spouse,
                        // gender, blood, NID/birth-reg, mobile). A failure
                        // in either surfaces its field errors and shows no
                        // "saved" message — partial failure is never hidden.
                        let saved: any;
                        try {
                          saved = await api("/profile", "PATCH", {
                            displayName: profile.displayName,
                            nameBn: profile.nameBn,
                            phone: profile.phone,
                            address: profile.address,
                            ...(profile.citizenNameEn?.trim()
                              ? { citizenNameEn: profile.citizenNameEn.trim() }
                              : {}),
                            ...(profile.dateOfBirth
                              ? { dateOfBirth: profile.dateOfBirth }
                              : {}),
                            ...(profile.permanentAddressBn?.trim()
                              ? {
                                  permanentAddressBn:
                                    profile.permanentAddressBn.trim(),
                                }
                              : {}),
                            ...(profile.permanentAddressEn?.trim()
                              ? {
                                  permanentAddressEn:
                                    profile.permanentAddressEn.trim(),
                                }
                              : {}),
                            ...(profile.geography?.divisionCode
                              ? {
                                  geography: geographyPayload(
                                    readGeography(profile.geography),
                                  ),
                                }
                              : {}),
                            ...(profile.presentAddress
                              ? {
                                  presentAddress: presentAddressPayload(
                                    readPresentAddress(profile.presentAddress),
                                  ),
                                }
                              : {}),
                          });
                        } catch (err) {
                          setProfileErrors(fieldErrors(err));
                          throw err;
                        }
                        if (saved.citizenNameBn) saved.nameBn = saved.citizenNameBn;
                        setProfile(saved);
                        let updated: any;
                        try {
                          updated = await api(
                            `/citizens/${ownCitizen.id}/details`,
                            "PATCH",
                            citizenDetailsPayload(details),
                          );
                        } catch (err) {
                          setProfileErrors(fieldErrors(err));
                          throw err;
                        }
                        setOwnCitizen(updated);
                        setDetails(readCitizenDetails(updated));
                        setRevealed(null);
                        setMessage("Profile saved / প্রোফাইল সংরক্ষিত হয়েছে");
                      } catch (err) {
                        setError((err as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    })();
                  }}
                >
                  <ProfileCompleteness
                    completeness={citizenProfileCompleteness(ownCitizen, {
                      geographyRequired: !!session.tenant?.divisionCode,
                    })}
                  />
                  <fieldset className="profile-section">
                    <legend>{t("১. ব্যক্তিগত তথ্য / 1. Personal information")}</legend>
                    <div className="form-grid">
                      <Field
                        label={t("Display name") + " *"}
                        name="profile-name"
                        value={profile.displayName}
                        onChange={(v) => setProfile({ ...profile, displayName: v })}
                        required
                        maxLength={120}
                        error={profileErrors.displayName}
                      />
                      <Field
                        label={t("নাম (বাংলা)") + " *"}
                        name="profile-bn"
                        value={profile.nameBn}
                        onChange={(v) => setProfile({ ...profile, nameBn: v })}
                        maxLength={120}
                        error={profileErrors.nameBn}
                      />
                      <Field
                        label={t("নাম (ইংরেজি) / Name (English)") + " *"}
                        name="profile-name-en"
                        value={profile.citizenNameEn ?? ""}
                        onChange={(v) =>
                          setProfile({ ...profile, citizenNameEn: v })
                        }
                        maxLength={120}
                        error={profileErrors.citizenNameEn}
                      />
                      {(
                        [
                          ["fatherNameBn", "পিতার নাম (বাংলা) / Father's name (Bangla)", true],
                          ["fatherNameEn", "পিতার নাম (ইংরেজি) / Father's name (English)", true],
                          ["motherNameBn", "মাতার নাম (বাংলা) / Mother's name (Bangla)", true],
                          ["motherNameEn", "মাতার নাম (ইংরেজি) / Mother's name (English)", true],
                          ["spouseNameBn", "স্বামী/স্ত্রীর নাম (বাংলা) / Spouse's name (Bangla)", false],
                          ["spouseNameEn", "স্বামী/স্ত্রীর নাম (ইংরেজি) / Spouse's name (English)", false],
                        ] as const
                      ).map(([key, label, required]) => (
                        <Field
                          key={key}
                          label={t(label) + (required ? " *" : "")}
                          name={`profile-details-${key}`}
                          value={details[key]}
                          onChange={(v) => setDetails({ ...details, [key]: v })}
                          maxLength={120}
                          error={profileErrors[key]}
                        />
                      ))}
                      <div className="field">
                        <label htmlFor="profile-details-gender">
                          {t("লিঙ্গ / Gender")} *
                        </label>
                        <select
                          id="profile-details-gender"
                          value={details.gender}
                          onChange={(e) =>
                            setDetails({ ...details, gender: e.target.value })
                          }
                        >
                          <option value="">{t("নির্বাচন করুন / Not given")}</option>
                          <option value="female">{t("নারী / Female")}</option>
                          <option value="male">{t("পুরুষ / Male")}</option>
                          <option value="other">{t("অন্যান্য / Other")}</option>
                        </select>
                        {profileErrors.gender && (
                          <span className="error" role="alert">
                            {tx(profileErrors.gender)}
                          </span>
                        )}
                      </div>
                      <div className="field">
                        <label htmlFor="profile-details-blood">
                          {t("রক্তের গ্রুপ / Blood group")} *
                        </label>
                        <select
                          id="profile-details-blood"
                          value={details.bloodGroup}
                          onChange={(e) =>
                            setDetails({ ...details, bloodGroup: e.target.value })
                          }
                        >
                          <option value="">{t("নির্বাচন করুন / Not given")}</option>
                          {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map(
                            (group) => (
                              <option key={group} value={group}>
                                {group}
                              </option>
                            ),
                          )}
                        </select>
                        {profileErrors.bloodGroup && (
                          <span className="error" role="alert">
                            {tx(profileErrors.bloodGroup)}
                          </span>
                        )}
                      </div>
                      <Field
                        label={t("জন্ম তারিখ / Date of birth") + " *"}
                        name="profile-dob"
                        value={profile.dateOfBirth ?? ""}
                        onChange={(v) =>
                          setProfile({ ...profile, dateOfBirth: v })
                        }
                        type="date"
                        error={profileErrors.dateOfBirth}
                      />
                      <Field
                        label={t("জাতীয় পরিচয়পত্র নম্বর / NID number") + " *"}
                        name="profile-details-nid"
                        value={details.nid}
                        onChange={(v) => setDetails({ ...details, nid: v })}
                        maxLength={40}
                        error={profileErrors.nid}
                        hint={t(
                          ownCitizen.nidHint
                            ? `সংরক্ষিত: ${ownCitizen.nidHint} — খালি রাখলে আগেরটাই থাকবে। / On file: ${ownCitizen.nidHint} — leave blank to keep it.`
                            : "NID ১০, ১৩ বা ১৭ সংখ্যার। / NID: 10, 13 or 17 digits.",
                        )}
                      />
                      <Field
                        label={t("জন্ম নিবন্ধন নম্বর / Birth registration number") + " *"}
                        name="profile-details-birth-reg"
                        value={details.birthReg}
                        onChange={(v) => setDetails({ ...details, birthReg: v })}
                        maxLength={40}
                        error={profileErrors.birthReg}
                        hint={t(
                          ownCitizen.birthRegHint
                            ? `সংরক্ষিত: ${ownCitizen.birthRegHint} — খালি রাখলে আগেরটাই থাকবে। / On file: ${ownCitizen.birthRegHint} — leave blank to keep it.`
                            : "জন্ম নিবন্ধন ১৭ সংখ্যার। / Birth registration: 17 digits.",
                        )}
                      />
                    </div>
                    <p className="hint">
                      {t(
                        "NID অথবা জন্ম নিবন্ধন — যেকোনো একটি নম্বর দিলেই চলবে। নম্বরগুলো এনক্রিপ্ট করে সংরক্ষিত থাকে। / Give either the NID or the birth registration number. Numbers are stored encrypted.",
                      )}
                    </p>
                    {(ownCitizen.nidHint || ownCitizen.birthRegHint) && (
                      <dl className="identity-summary">
                        <dt>{t("জাতীয় পরিচয়পত্র / NID")}</dt>
                        <dd data-testid="nid-value">
                          {revealed ? (revealed.nid ?? "—") : (ownCitizen.nidHint ?? "—")}
                        </dd>
                        <dt>{t("জন্ম নিবন্ধন / Birth registration")}</dt>
                        <dd data-testid="birth-reg-value">
                          {revealed
                            ? (revealed.birthReg ?? "—")
                            : (ownCitizen.birthRegHint ?? "—")}
                        </dd>
                      </dl>
                    )}
                    {(ownCitizen.nidHint || ownCitizen.birthRegHint) && !revealed && (
                      <>
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              const r = await api(`/citizens/${ownCitizen.id}/identity`);
                              setRevealed({ nid: r.nid, birthReg: r.birthReg });
                            })
                          }
                        >
                          {t("পূর্ণ নম্বর দেখুন / Show full numbers")}
                        </button>
                        <p className="hint">
                          {t("Viewing full numbers is recorded in the audit log.")}
                        </p>
                      </>
                    )}
                    <div className="form-grid">
                      <Field
                        label={t("মোবাইল নম্বর / Mobile number")}
                        name="profile-details-mobile"
                        value={details.mobile}
                        onChange={(v) => setDetails({ ...details, mobile: v })}
                        type="tel"
                        maxLength={40}
                        disabled={details.noMobile}
                        error={profileErrors.mobile}
                      />
                      <div className="check-field">
                        <label htmlFor="profile-details-no-mobile">
                          <input
                            id="profile-details-no-mobile"
                            type="checkbox"
                            checked={details.noMobile}
                            onChange={(e) =>
                              setDetails({
                                ...details,
                                noMobile: e.target.checked,
                                mobile: e.target.checked ? "" : details.mobile,
                              })
                            }
                          />
                          <span>{t("মোবাইল নম্বর নেই / Has no mobile number")}</span>
                        </label>
                      </div>
                      <Field
                        label={t("সাইন-ইন মোবাইল / Sign-in mobile")}
                        name="profile-phone"
                        value={profile.phone}
                        onChange={(v) => setProfile({ ...profile, phone: v })}
                        type="tel"
                        maxLength={11}
                        disabled
                        hint={t(
                          "সাইন-ইনের নম্বর — বদলাতে অফিসে যোগাযোগ করুন। / Your sign-in number — contact the office to change it.",
                        )}
                      />
                    </div>
                  </fieldset>
                  <fieldset className="profile-section">
                    <legend>{t("২. ছবি / 2. Photo")}</legend>
                    <p className="hint">
                      {t(
                        "ছবি আপলোড বা মুছে ফেললেই সাথে সাথে কার্যকর হয় — এর জন্য Save চাপতে হয় না। নিচের Save বাটন শুধু লেখা তথ্যগুলো সংরক্ষণ করে। / Photo upload and removal apply immediately — no Save needed. The Save button below saves the typed fields only.",
                      )}
                    </p>
                    <CitizenPhoto
                      citizen={ownCitizen}
                      onChanged={setOwnCitizen}
                    />
                  </fieldset>
                  <fieldset className="profile-section">
                    <legend>{t("৩. ঠিকানা / 3. Address")}</legend>
                    <div className="form-grid">
                      <Field
                        label={
                          t("স্থায়ী ঠিকানা (বাংলা) / Permanent address (Bangla)") + " *"
                        }
                        name="profile-permanent-address-bn"
                        value={profile.permanentAddressBn ?? ""}
                        onChange={(v) =>
                          setProfile({ ...profile, permanentAddressBn: v })
                        }
                        maxLength={500}
                        error={profileErrors.permanentAddressBn}
                      />
                      <Field
                        label={
                          t("স্থায়ী ঠিকানা (ইংরেজি) / Permanent address (English)") + " *"
                        }
                        name="profile-permanent-address-en"
                        value={profile.permanentAddressEn ?? ""}
                        onChange={(v) =>
                          setProfile({ ...profile, permanentAddressEn: v })
                        }
                        maxLength={500}
                        error={profileErrors.permanentAddressEn}
                      />
                      <Field
                        label={t("Address")}
                        name="profile-address"
                        value={profile.address}
                        onChange={(v) => setProfile({ ...profile, address: v })}
                        maxLength={1000}
                        error={profileErrors.address}
                      />
                    </div>
                    <fieldset className="profile-geography">
                      <legend>{t("Geographic address")}</legend>
                      <p>
                        {t(
                          "Save your division, district, upazila, union and ward.",
                        )}
                      </p>
                      <GeographyFields
                        prefix="profile-geo"
                        value={readGeography(profile.geography)}
                        onChange={(geography) =>
                          setProfile({ ...profile, geography })
                        }
                        required={!!profile.geography?.divisionCode}
                      />
                    </fieldset>
                    {profile.presentAddress && (
                      <PresentAddressFields
                        prefix="profile-present"
                        value={readPresentAddress(profile.presentAddress)}
                        onChange={(presentAddress) =>
                          setProfile({ ...profile, presentAddress })
                        }
                      />
                    )}
                  </fieldset>
                  <fieldset className="profile-section">
                    <legend>{t("৪. নথিপত্র / 4. Documents")}</legend>
                    <p className="hint">
                      {t(
                        "আপনার পরিচয় নথি এখানে যুক্ত করুন। নথি আপলোড/মুছে ফেলা সাথে সাথে কার্যকর হয়। / Link your identity document here. Document upload and removal apply immediately.",
                      )}
                    </p>
                    {/* WS-C: the documents vault replaces the older
                        single identity-document control here — it covers
                        both kinds, dual-reads legacy links, and keeps
                        the legacy slot in sync (see CitizenDocumentsVault). */}
                    <CitizenDocumentsVault
                      citizen={ownCitizen}
                      canEdit={true}
                      onChanged={setOwnCitizen}
                    />
                  </fieldset>
                  <button disabled={busy}>{t("Save profile")}</button>
                </form>
              ) : session.user.role !== "citizen" ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(async () => {
                      const saved = await api("/profile", "PATCH", {
                        displayName: profile.displayName,
                        nameBn: profile.nameBn,
                        phone: profile.phone,
                        address: profile.address,
                      });
                      setProfile(saved);
                      setMessage("Profile saved / প্রোফাইল সংরক্ষিত হয়েছে");
                    });
                  }}
                >
                  <div className="form-grid">
                    <Field
                      label={t("Display name")}
                      name="profile-name"
                      value={profile.displayName}
                      onChange={(v) => setProfile({ ...profile, displayName: v })}
                      required
                      maxLength={120}
                    />
                    <Field
                      label={t("নাম (বাংলা)")}
                      name="profile-bn"
                      value={profile.nameBn}
                      onChange={(v) => setProfile({ ...profile, nameBn: v })}
                      maxLength={120}
                    />
                    <Field
                      label={t("Mobile (optional, 11 digits)")}
                      name="profile-phone"
                      value={profile.phone}
                      onChange={(v) => setProfile({ ...profile, phone: v })}
                      type="tel"
                      maxLength={11}
                    />
                    <Field
                      label={t("Address")}
                      name="profile-address"
                      value={profile.address}
                      onChange={(v) => setProfile({ ...profile, address: v })}
                      maxLength={1000}
                    />
                  </div>
                  <button disabled={busy}>{t("Save profile")}</button>
                </form>
              ) : null}
            </section>
            {/* PROFILE-DYNAMIC: the chairman (and the office admin) manage the
                office identity — UP name, logo, seal, signature — from their
                own profile page, not only from the admin workspace. */}
            {(session.user.role === "approver" ||
              session.user.role === "admin") && <OfficeIdentitySettings />}
            {/* Citizen dashboard + profile (2026-11-26): password, sessions
                and two-factor settings live only in Account settings — the
                duplicated blocks that used to sit here were removed. */}
          </>
        ),
      )}
      {tx(
        page === "prints" && (
          <>
            <section className="panel">
              <span className="eyebrow">{t("PRIVATE DOCUMENT COPIES")}</span>
              <h2>{t("তথ্য প্রিন্ট / Print requests")}</h2>
              <p>
                {t(
                  "Generate a private copy from saved citizen details. Holding values and witness statements are supplied by the applicant.",
                )}
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    const body: any = { kind, citizenId, language, requestKey };
                    if (kind === "holding")
                      body.holding = {
                        ...holding,
                        annualValueMinor: Number(holding.annualValueMinor),
                      };
                    if (kind === "witness") body.witness = witness;
                    const saved = await api("/print-requests", "POST", body);
                    setMessage(`Copy ready: ${saved.id}`);
                    await loadPrints();
                  });
                }}
              >
                <div className="actions">
                  <Field
                    label={t("Find applicant by name or reference")}
                    name="print-applicant-search"
                    value={citizenSearch}
                    onChange={setCitizenSearch}
                  />
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const c = items(
                          await api(
                            `/citizens?q=${encodeURIComponent(citizenSearch)}`,
                          ),
                        );
                        setCitizens(c);
                        setCitizenId(c[0]?.id || "");
                        setRequestKey(crypto.randomUUID());
                      })
                    }
                  >
                    {t("Find applicant")}
                  </button>
                </div>
                <div className="form-grid">
                  <label htmlFor="print-kind">
                    {t("Copy type")}
                    <select
                      id="print-kind"
                      aria-label={t("Copy type")}
                      value={kind}
                      onChange={(e) => {
                        setKind(e.target.value);
                        setPrintPage(1);
                        setRequestKey(crypto.randomUUID());
                      }}
                    >
                      <option value="biodata">
                        {t("জীবনবৃত্তান্ত / Biodata")}
                      </option>
                      <option value="holding">
                        {t("হোল্ডিং তথ্য / Holding information")}
                      </option>
                      <option value="witness">
                        {t("সাক্ষীর বক্তব্য / Witness statement")}
                      </option>
                    </select>
                  </label>
                  <label htmlFor="print-citizen">
                    {t("Applicant")}
                    <select
                      id="print-citizen"
                      aria-label={t("Applicant")}
                      value={citizenId}
                      onChange={(e) => {
                        setCitizenId(e.target.value);
                        setRequestKey(crypto.randomUUID());
                      }}
                      required
                    >
                      <option value="">{t("Select citizen")}</option>
                      {tx(
                        citizens.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nameBn}
                            {t(" · ")}
                            {c.syntheticReference}
                          </option>
                        )),
                      )}
                    </select>
                  </label>
                  <label htmlFor="print-language">
                    {t("Language")}
                    <select
                      id="print-language"
                      aria-label={t("Language")}
                      value={language}
                      onChange={(e) => {
                        setLanguage(e.target.value);
                        setRequestKey(crypto.randomUUID());
                      }}
                    >
                      <option value="bilingual">{t("বাংলা ও English")}</option>
                      <option value="bn">{t("বাংলা")}</option>
                      <option value="en">{t("English")}</option>
                    </select>
                  </label>
                </div>
                {tx(
                  kind === "holding" && (
                    <fieldset>
                      <legend>{t("Holding details")}</legend>
                      <div className="form-grid">
                        {tx(
                          Object.entries({
                            number: "Holding number",
                            ownerBn: "মালিকের নাম (বাংলা)",
                            ownerEn: "Owner name (English)",
                            addressBn: "হোল্ডিং ঠিকানা (বাংলা)",
                            addressEn: "Holding address (English)",
                            annualValueMinor:
                              "Declared annual value (paisa, 100 = BDT 1)",
                          }).map(([k, label]) => (
                            <Field
                              key={k}
                              name={`holding-${k}`}
                              label={t(label)}
                              value={(holding as any)[k]}
                              onChange={(v) => setHoldingField(k, v)}
                              type={
                                k === "annualValueMinor" ? "number" : "text"
                              }
                              required
                              maxLength={k.startsWith("address") ? 1000 : 150}
                            />
                          )),
                        )}
                      </div>
                    </fieldset>
                  ),
                )}
                {tx(
                  kind === "witness" && (
                    <fieldset>
                      <legend>
                        {t("Witness statement / সাক্ষীর বক্তব্য")}
                      </legend>
                      <div className="form-grid">
                        {tx(
                          Object.entries({
                            deceasedNameBn: "মৃত ব্যক্তির নাম (বাংলা)",
                            deceasedNameEn: "Deceased name (English)",
                            witnessNameBn: "সাক্ষীর নাম (বাংলা)",
                            witnessNameEn: "Witness name (English)",
                          }).map(([k, label]) => (
                            <Field
                              key={k}
                              name={`witness-${k}`}
                              label={t(label)}
                              value={(witness as any)[k]}
                              onChange={(v) => setWitnessField(k, v)}
                              required
                            />
                          )),
                        )}
                      </div>
                      <label htmlFor="witness-statement">
                        {t("Statement (minimum 10 characters)")}
                        <textarea
                          id="witness-statement"
                          value={witness.statement}
                          onChange={(e) =>
                            setWitnessField("statement", e.target.value)
                          }
                          required
                          minLength={10}
                          maxLength={2000}
                        />
                      </label>
                    </fieldset>
                  ),
                )}
                <button disabled={busy || !citizenId}>
                  {tx(busy ? "Generating…" : "Generate private PDF")}
                </button>
              </form>
            </section>
            <section className="panel">
              <h2>{t("Request history")}</h2>
              <form
                className="form-grid print-filters"
                onSubmit={(e) => {
                  e.preventDefault();
                  setPrintPage(1);
                  void run(loadPrints);
                }}
              >
                <label htmlFor="print-search">
                  {t("নাম, রেফারেন্স বা মোবাইল / Name, reference or mobile")}
                  <input id="print-search" value={printSearch} onChange={(e) => setPrintSearch(e.target.value)} maxLength={100} />
                </label>
                <label htmlFor="print-from">
                  {t("যে তারিখ থেকে / From date")}
                  <input id="print-from" type="date" value={printFrom} max={printTo || undefined} onChange={(e) => setPrintFrom(e.target.value)} />
                </label>
                <label htmlFor="print-to">
                  {t("যে তারিখ পর্যন্ত / To date")}
                  <input id="print-to" type="date" value={printTo} min={printFrom || undefined} onChange={(e) => setPrintTo(e.target.value)} />
                </label>
                <button className="secondary" disabled={busy}>{t("খুঁজুন / Search")}</button>
              </form>
              {tx(
                requests.length === 0 ? (
                  <EmptyState title={choose({ bn: "এই ধরনের কোনো কপি এখনো তৈরি হয়নি।", en: "No copies of this type yet." })} hint={choose({ bn: "নাগরিক বেছে নিয়ে উপরে কপি তৈরি করুন।", en: "Choose a citizen above to generate a copy." })} />
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>{t("Type")}</th>
                          <th>{t("নাগরিক / Citizen")}</th>
                          <th>{t("Language")}</th>
                          <th>{t("Created")}</th>
                          <th>{t("Document")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tx(
                          requests.map((r) => (
                            <tr key={r.id}>
                              <td>{choose(
                                r.kind === "biodata"
                                  ? { bn: "জীবনবৃত্তান্ত", en: "Biodata" }
                                  : r.kind === "holding"
                                    ? { bn: "হোল্ডিং তথ্য", en: "Holding information" }
                                    : r.kind === "witness"
                                      ? { bn: "সাক্ষীর বক্তব্য", en: "Witness statement" }
                                      : { bn: "নথি", en: "Document" },
                              )}</td>
                              <td>{r.citizenNameBn ? `${r.citizenNameBn} / ${r.citizenNameEn}` : "—"}</td>
                              <td>{tx(r.language)}</td>
                              <td>
                                {formatDateTime(r.createdAt, uiLanguage)}
                              </td>
                              <td>
                                <a href={r.pdfUrl} className="button secondary">
                                  {t("Download PDF")}
                                </a>
                              </td>
                            </tr>
                          )),
                        )}
                      </tbody>
                    </table>
                  </div>
                ),
              )}
              <div className="actions">
                <button
                  className="secondary"
                  disabled={busy || printPage === 1}
                  onClick={() => setPrintPage(printPage - 1)}
                >
                  {t("Previous")}
                </button>
                <span>
                  {t("Page ")}
                  {tx(printPage)}
                  {t(" · ")}
                  {tx(printTotal)}
                  {t(" copies")}
                </span>
                <button
                  className="secondary"
                  disabled={busy || printPage * 20 >= printTotal}
                  onClick={() => setPrintPage(printPage + 1)}
                >
                  {t("Next")}
                </button>
              </div>
            </section>
          </>
        ),
      )}
      {tx(
        page === "notifications" && (
          <section className="panel">
            <span className="eyebrow">{t("IN-APP UPDATES")}</span>
            <h2>{t("বিজ্ঞপ্তি / Notifications")}</h2>
            <p>
              {t(
                "Application and certificate updates for your permitted records.",
              )}
            </p>
            {tx(
              notifications.length === 0 ? (
                <EmptyState title={choose({ bn: "এখনো কোনো আপডেট নেই।", en: "No updates yet." })} hint={choose({ bn: "আবেদন বা সনদের নতুন খবর এলে এখানে দেখা যাবে।", en: "Application and certificate updates will appear here." })} />
              ) : (
                notifications.map((n) => {
                  /* P2-4: the title names the service and the outcome —
                     never a bare "status changed"; the sub-line carries
                     office + date; the whole row opens the application;
                     unread rows get an accent bar and a dot. */
                  const svc = (
                    serviceCatalog as readonly {
                      service_no: number;
                      name_bn: string;
                      name_en: string;
                    }[]
                  ).find((s) => s.service_no === Number(n.serviceNo));
                  const svcName = svc
                    ? choose({ bn: svc.name_bn, en: svc.name_en })
                    : "";
                  const outcome =
                    n.kind === "APPLICATION_SUBMITTED"
                      ? choose({ bn: "নতুন আবেদন জমা পড়েছে", en: "New application submitted" })
                      : n.kind === "APPLICATION_RESUBMITTED"
                        ? choose({ bn: "আবেদন পুনরায় জমা পড়েছে", en: "Application resubmitted" })
                        : n.kind === "APPLICATION_REJECTED"
                          ? choose({ bn: "আবেদন প্রত্যাখ্যান করা হয়েছে", en: "Application rejected" })
                          : /* QA-08: the two new citizen notifications. */
                            n.kind === "APPLICATION_CORRECTION_REQUIRED"
                            ? choose({ bn: "আবেদনে সংশোধন প্রয়োজন", en: "Correction requested" })
                            : n.kind === "CERTIFICATE_REVOKED"
                              ? choose({ bn: "সনদ প্রত্যাহার করা হয়েছে", en: "Certificate revoked" })
                              : choose({ bn: "সনদ ইস্যু হয়েছে", en: "Certificate issued" });
                  const officeName = session.tenant
                    ? uiLanguage === "bn"
                      ? (session.tenant.nameBn ?? session.tenant.name_bn ?? "")
                      : (session.tenant.nameEn ?? session.tenant.name_en ?? "")
                    : "";
                  const openRow =
                    n.applicationId && onOpenApplication
                      ? () => {
                          if (!n.readAt)
                            void api(`/notifications/${n.id}/read`, "POST", {}).catch(
                              () => undefined,
                            );
                          onOpenApplication(n.applicationId);
                        }
                      : undefined;
                  return (
                  <article
                    className={`notice${n.readAt ? "" : " notice-unread"}`}
                    key={n.id}
                    onClick={openRow}
                    style={openRow ? { cursor: "pointer" } : undefined}
                  >
                    <strong>
                      {!n.readAt && (
                        <span className="notice-dot" aria-hidden="true" />
                      )}
                      {outcome}
                      {svcName ? ` — ${svcName}` : ""}
                      {n.kind !== "APPLICATION_SUBMITTED" &&
                      n.kind !== "APPLICATION_RESUBMITTED" &&
                      n.kind !== "APPLICATION_REJECTED" &&
                      n.certificateNumber
                        ? ` · ${n.certificateNumber}`
                        : ""}
                    </strong>
                    {tx(
                      [
                        "APPLICATION_REJECTED",
                        "APPLICATION_CORRECTION_REQUIRED",
                        "CERTIFICATE_REVOKED",
                      ].includes(n.kind) && n.detail ? (
                        <p>
                          {choose({ bn: "কারণ", en: "Reason" })}: {n.detail}
                        </p>
                      ) : null,
                    )}
                    <p>
                      {officeName ? `${officeName} · ` : ""}
                      {formatDateTime(n.createdAt, uiLanguage)}
                    </p>
                    {tx(
                      n.readAt ? (
                        <small>{t("Read / পঠিত")}</small>
                      ) : (
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await api(
                                `/notifications/${n.id}/read`,
                                "POST",
                                {},
                              );
                              setNotifications(
                                items(await api("/notifications")),
                              );
                            })
                          }
                        >
                          {t("Mark read")}
                        </button>
                      ),
                    )}
                  </article>
                  );
                })
              ),
            )}
          </section>
        ),
      )}
      {tx(
        page === "reports" && (
          <section className="panel">
            <span className="eyebrow">{t("TENANT FINANCE")}</span>
            <h2>{t("প্রতিবেদন / Reports")}</h2>
            <p>
              {t(
                "Credit accounting and application counts. Date boundaries are UTC. Statutory fees remain separately unconfigured.",
              )}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const q = new URLSearchParams();
                  if (from) q.set("from", from);
                  if (to) q.set("to", to);
                  setReport(await api(`/reports?${q}`));
                  setReportQuery(q.toString());
                });
              }}
            >
              <div className="form-grid">
                <Field
                  label={t("From date")}
                  name="report-from"
                  value={from}
                  onChange={setFrom}
                  type="date"
                />
                <Field
                  label={t("To date")}
                  name="report-to"
                  value={to}
                  onChange={setTo}
                  type="date"
                />
              </div>
              <button disabled={busy}>{t("Apply date range")}</button>
            </form>
            {tx(
              !report && (
                <EmptyState
                  title={choose({
                    bn: "তারিখের পরিসর বেছে নিয়ে প্রতিবেদন তৈরি করুন।",
                    en: "Choose a date range to build the report.",
                  })}
                  hint={choose({
                    bn: "উপরের তারিখ দিয়ে “তারিখের পরিসর প্রয়োগ করুন” চাপুন।",
                    en: "Set the dates above and press “Apply date range”.",
                  })}
                />
              ),
            )}
            {tx(
              report && (
                <>
                  <div className="stats">
                    <article>
                      <h3>{tx(report.balance)}</h3>
                      <p>{t("Current credit balance")}</p>
                    </article>
                    <article>
                      <h3>{tx(report.ledger.length)}</h3>
                      <p>{t("Entries in selected range")}</p>
                    </article>
                  </div>
                  <div className="actions">
                    <a
                      className="button secondary"
                      href={`/api/v1/reports?${reportQuery}${reportQuery ? "&" : ""}format=csv`}
                    >
                      {t("Export CSV")}
                    </a>
                    <a
                      className="button secondary"
                      href={`/api/v1/reports?${reportQuery}${reportQuery ? "&" : ""}format=pdf`}
                    >
                      {t("Export PDF")}
                    </a>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>{t("Application state")}</th>
                          <th>{t("Count")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tx(
                          report.states.map((s: any) => (
                            <tr key={s.state}>
                              <td>{applicationStatusMeta(String(s.state)) ? choose(applicationStatusMeta(String(s.state))!) : choose({ bn: "নথিভুক্ত", en: "Recorded" })}</td>
                              <td>{tx(s.count)}</td>
                            </tr>
                          )),
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>{t("Type")}</th>
                          <th>{t("Credits")}</th>
                          <th>{t("Balance after")}</th>
                          <th>{t("Timestamp")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tx(
                          report.ledger.map((r: any) => (
                            <tr key={r.id}>
                              <td>{choose(ledgerKindMeta(r.kind))}</td>
                              <td>{tx(r.delta)}</td>
                              <td>{tx(r.balanceAfter)}</td>
                              <td>
                                {formatDateTime(r.createdAt, uiLanguage)}
                              </td>
                            </tr>
                          )),
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              ),
            )}
          </section>
        ),
      )}
      {tx(
        page === "support" && (
          <section className="panel">
            <span className="eyebrow">{t("PLATFORM SUPPORT")}</span>
            <h2>{t("Feedback inbox")}</h2>
            <label htmlFor="support-status">
              {t("Status")}
              <select
                id="support-status"
                aria-label={t("Status")}
                value={feedbackStatus}
                onChange={(e) => setFeedbackStatus(e.target.value)}
              >
                <option value="">{t("All")}</option>
                <option value="OPEN">{t("Open")}</option>
                <option value="RESOLVED">{t("Resolved")}</option>
              </select>
            </label>
            {tx(
              feedback.length === 0 ? (
                <EmptyState title={choose({ bn: "এই তালিকায় কোনো অনুরোধ নেই।", en: "No requests in this view." })} hint={choose({ bn: "অবস্থা বদলে অন্য তালিকা দেখুন।", en: "Change the status filter to see other requests." })} />
              ) : (
                feedback.map((f) => (
                  <article className="notice" key={f.id}>
                    <h3>{f.subject}</h3>
                    <p>{f.message}</p>
                    <p>
                      {f.name}
                      {t(" · ")}
                      {tx(f.email || "No email")}
                      {t(" · ")}
                      {formatDateTime(f.createdAt, uiLanguage)}
                    </p>
                    <button
                      disabled={busy}
                      className="secondary"
                      onClick={() =>
                        void run(async () => {
                          await api(`/owner/feedback/${f.id}`, "PATCH", {
                            status: f.status === "OPEN" ? "RESOLVED" : "OPEN",
                          });
                          setFeedback(
                            items(
                              await api(
                                `/owner/feedback${feedbackStatus ? "?status=" + feedbackStatus : ""}`,
                              ),
                            ),
                          );
                        })
                      }
                    >
                      {tx(f.status === "OPEN" ? "Mark resolved" : "Reopen")}
                    </button>
                  </article>
                ))
              ),
            )}
          </section>
        ),
      )}
    </div>
  );
}
