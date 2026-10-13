import { t, tx } from "./i18n.js";
import React, { useEffect, useState } from "react";
import { api, items } from "./api.js";
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
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  maxLength?: number;
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
      />
    </label>
  );
}
export function AdditionalWorkspace({
  page,
  session,
}: {
  page: string;
  session: any;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [profile, setProfile] = useState<any>({
    displayName: "",
    nameBn: "",
    phone: "",
    address: "",
  });
  const [currentPassword, setCurrentPassword] = useState(""),
    [newPassword, setNewPassword] = useState(""),
    [confirmPassword, setConfirmPassword] = useState("");
  const [citizens, setCitizens] = useState<any[]>([]),
    [requests, setRequests] = useState<any[]>([]),
    [citizenId, setCitizenId] = useState("");
  const [citizenSearch, setCitizenSearch] = useState("");
  const [kind, setKind] = useState("biodata"),
    [language, setLanguage] = useState("bilingual"),
    [requestKey, setRequestKey] = useState(crypto.randomUUID());
  const [printPage, setPrintPage] = useState(1),
    [printTotal, setPrintTotal] = useState(0);
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
  const filterQuery = () => `?page=${printPage}&kind=${kind}`;
  async function loadPrints() {
    const r = await api(`/print-requests${filterQuery()}`);
    setRequests(items(r));
    setPrintTotal(r.total);
  }
  useEffect(() => {
    void run(async () => {
      if (page === "profile") setProfile(await api("/profile"));
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
          <div className="notice" role="status">
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
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    setProfile(
                      await api("/profile", "PATCH", {
                        displayName: profile.displayName,
                        nameBn: profile.nameBn,
                        phone: profile.phone,
                        address: profile.address,
                        ...(session.user.role === "citizen" &&
                        profile.geography?.divisionCode
                          ? {
                              geography: geographyPayload(
                                readGeography(profile.geography),
                              ),
                            }
                          : {}),
                      }),
                    );
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
                {session.user.role === "citizen" && (
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
                )}
                <button disabled={busy}>{t("Save profile")}</button>
              </form>
            </section>
            <section className="panel">
              <h2>{t("পাসওয়ার্ড পরিবর্তন / Change password")}</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    if (newPassword !== confirmPassword)
                      throw Error("New passwords must match.");
                    if (newPassword.length < 12)
                      throw Error("Use at least 12 characters.");
                    await api("/auth/password", "POST", {
                      currentPassword,
                      newPassword,
                    });
                    setCurrentPassword("");
                    setNewPassword("");
                    setConfirmPassword("");
                    setMessage(
                      "Password changed. Other sessions have been signed out.",
                    );
                  });
                }}
              >
                <div className="form-grid">
                  <Field
                    label={t("Current password")}
                    name="password-current"
                    value={currentPassword}
                    onChange={setCurrentPassword}
                    type="password"
                    required
                    maxLength={200}
                  />
                  <Field
                    label={t("New password (minimum 12 characters)")}
                    name="password-new"
                    value={newPassword}
                    onChange={setNewPassword}
                    type="password"
                    required
                    maxLength={200}
                  />
                  <Field
                    label={t("Confirm new password")}
                    name="password-confirm"
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    type="password"
                    required
                    maxLength={200}
                  />
                </div>
                <button disabled={busy}>{t("Change password")}</button>
              </form>
            </section>
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
                  "Generate a private copy from saved citizen details. Holding values and witness statements are supplied by the applicant. Copies are marked DEMO and do not assess tax or certify a legal statement.",
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
                    label={t("Find applicant by name or synthetic reference")}
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
              {tx(
                requests.length === 0 ? (
                  <p>{t("No copies for this type yet.")}</p>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>{t("Type")}</th>
                          <th>{t("Language")}</th>
                          <th>{t("Created")}</th>
                          <th>{t("Document")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tx(
                          requests.map((r) => (
                            <tr key={r.id}>
                              <td>{tx(r.kind)}</td>
                              <td>{tx(r.language)}</td>
                              <td>
                                {tx(new Date(r.createdAt).toLocaleString())}
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
              {t("Certificate issuance updates for your permitted records.")}
            </p>
            {tx(
              notifications.length === 0 ? (
                <p>{t("No updates yet.")}</p>
              ) : (
                notifications.map((n) => (
                  <article className="notice" key={n.id}>
                    <strong>
                      {t("Certificate issued · ")}
                      {n.certificateNumber}
                    </strong>
                    <p>{tx(new Date(n.createdAt).toLocaleString())}</p>
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
                ))
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
                              <td>{tx(s.state)}</td>
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
                              <td>{tx(r.kind)}</td>
                              <td>{tx(r.delta)}</td>
                              <td>{tx(r.balanceAfter)}</td>
                              <td>
                                {tx(new Date(r.createdAt).toLocaleString())}
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
                <p>{t("No requests in this view.")}</p>
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
                      {tx(new Date(f.createdAt).toLocaleString())}
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
