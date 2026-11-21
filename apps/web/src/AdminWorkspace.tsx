import { t, tx, choose } from "./i18n.js";
import { SignInIdentifiers } from "./SignInIdentifiers.js";
import React, { useEffect, useState } from "react";
import { api, items } from "./api.js";
import { OrderPolicySettings } from "./OrderPolicySettings.js";
import { CertificateAssetsSettings } from "./CertificateAssets.js";
import { CouponSettings } from "./CouponSettings.js";
import { BkashMerchantSettings, PaymentMerchantSettings } from "./PaymentMerchantSettings.js";
import { AccountSessions } from "./AccountSessions.js";
import { AccountMfa } from "./AccountMfa.js";
import {
  GeographyFields,
  geographyPayload,
  emptyGeography,
  readGeography,
} from "./GeographyFields.js";

const read = (o: any, a: string, b: string) => o?.[a] ?? o?.[b] ?? "";
export function AccountSecurity() {
  const [message, setMessage] = useState(""),
    [errorMessage, setErrorMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [securityRevision, setSecurityRevision] = useState(0);
  return (
    <>
      {/* FULL-UIUX-01 (C40/P2-20): the security page's panels share ONE
          width system — the former "narrow" first panel is gone. */}
      <section className="panel">
        <h2>{t("Account security")}</h2>
        <p>
          {t("Change your password. Other signed-in sessions will be expired.")}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget,
              data = new FormData(form);
            setBusy(true);
            setMessage("");
            setErrorMessage("");
            try {
              await api("/auth/password", "POST", {
                currentPassword: data.get("currentPassword"),
                newPassword: data.get("newPassword"),
              });
              form.reset();
              setSecurityRevision((value) => value + 1);
              setMessage("Password updated. Other sessions have been expired.");
            } catch (e) {
              setErrorMessage((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor="current-password">{t("Current password")}</label>
          <input
            id="current-password"
            type="password"
            name="currentPassword"
            autoComplete="current-password"
            required
          />
          <label htmlFor="new-password">{t("New password")}</label>
          <input
            id="new-password"
            type="password"
            name="newPassword"
            minLength={6}
            maxLength={18}
            autoComplete="new-password"
            required
          />
          <button disabled={busy}>{t("Update password")}</button>
        </form>
        {tx(
          message && (
            <p role="status" className="notice success">
              {tx(message)}
            </p>
          ),
        )}
        {tx(
          errorMessage && (
            <p role="alert" className="notice error">
              {tx(errorMessage)}
            </p>
          ),
        )}
      </section>
      <AccountSessions revision={securityRevision} />
      <AccountMfa revision={securityRevision} onChange={() => setSecurityRevision((value) => value + 1)} />
      <SignInIdentifiers />
    </>
  );
}
export function AdminWorkspace() {
  const [recovery, setRecovery] = useState<any>(null);
  const [officeGeography, setOfficeGeography] = useState(emptyGeography);
  const [officeType, setOfficeType] = useState("UNION");
  // FULL-UIUX-01 (C35/P2-11): the default tab IS the first tab — the
  // panel no longer opens on a tab the header doesn't show first.
  const [tab, setTab] = useState("order-policies"),
    [office, setOffice] = useState<any>(null),
    [users, setUsers] = useState<any[]>([]),
    [accountTypes, setAccountTypes] = useState<any[]>([]),
    [newPost, setNewPost] = useState(""),
    [services, setServices] = useState<any[]>([]),
    [notices, setNotices] = useState<any[]>([]),
    [authorizations, setAuthorizations] = useState<any[]>([]),
    [message, setMessage] = useState(""),
    [errorMessage, setErrorMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    const [u, s, n, a, o, types] = await Promise.all([
      api("/admin/users"),
      api("/admin/services"),
      api("/admin/notices"),
      api("/admin/authorizations"),
      api("/admin/office"),
      api("/admin/account-types"),
    ]);
    setAccountTypes(items(types));
    setOffice(o);
    setOfficeGeography(readGeography(o.geography));
    setOfficeType(o.officeType);
    setUsers(items(u));
    setServices(items(s));
    setNotices(items(n));
    setAuthorizations(items(a));
  }
  async function run(fn: () => Promise<void>, success: string) {
    setBusy(true);
    setMessage("");
    setErrorMessage("");
    try {
      await fn();
      await load();
      setMessage(success);
    } catch (e) {
      setErrorMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    load().catch((e) => setErrorMessage(e.message));
  }, []);
  return (
    <>
      <section className="panel">
        {/* FULL-UIUX-01 (C35/P2-11): no second title duplicating the page
            H1 — the panel opens with its purpose line. */}
        <p>
          {t(
            "Manage your office's staff, service availability, explicit approval assignments and published notices. ",
          )}
        </p>
        <div
          className="tabs"
          role="tablist"
          aria-label={t("Administration sections")}
        >
          <button
            role="tab"
            aria-selected={tab === "order-policies"}
            className={tab === "order-policies" ? "" : "secondary"}
            onClick={() => setTab("order-policies")}
          >
            {choose({ bn: "আবেদন ফি নীতি", en: "Application fee policies" })}
          </button>
          {tx(
            // FULL-UIUX-01 (B23/P1-13): every tab label has a Bangla form —
            // "Certificate assets" no longer renders as raw English jargon.
            (
              [
                ["office", { bn: "অফিসের তথ্য", en: "Office profile" }],
                ["cert-assets", { bn: "সনদে ব্যবহৃত ছবি", en: "Certificate images" }],
                ["users", { bn: "কর্মীদের অ্যাকাউন্ট", en: "Staff accounts" }],
                ["services", { bn: "সেবার সেটিংস", en: "Service settings" }],
                ["authority", { bn: "অনুমোদনের ক্ষমতা", en: "Approval authority" }],
                ["notices", { bn: "অফিসের নোটিশ", en: "Office notices" }],
                ["coupons", { bn: "কুপন", en: "Coupons" }],
                ["payments", { bn: "অনলাইন পেমেন্ট", en: "Online payments" }],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                className={tab === key ? "" : "secondary"}
                onClick={() => setTab(key)}
              >
                {choose(label)}
              </button>
            )),
          )}
        </div>
        {tx(
          message && (
            <p className="notice success" role="status">
              {tx(message)}
            </p>
          ),
        )}
        {tx(
          errorMessage && (
            <p className="notice error" role="alert">
              {tx(errorMessage)}
            </p>
          ),
        )}
        {tx(
          recovery && (
            <div className="notice">
              <strong>{t("Private one-use recovery link")}</strong>
              <p>
                {t(
                  "Only provide this to the intended account holder through your trusted contact channel. Valid until",
                )}
                {tx(" ")}
                {tx(new Date(recovery.expiresAt).toLocaleString())}
                {t(". ")}
              </p>
              <label htmlFor="admin-recovery-link">{t("Recovery link")}</label>
              <input
                id="admin-recovery-link"
                readOnly
                value={recovery.recoveryUrl}
                onFocus={(e) => e.target.select()}
              />
              <button
                className="secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(recovery.recoveryUrl);
                    setMessage("Recovery link copied.");
                  } catch {
                    document.getElementById("admin-recovery-link")?.focus();
                    setMessage(
                      "Select and copy the recovery link from the field.",
                    );
                  }
                }}
              >
                {t("Copy recovery link ")}
              </button>
              {tx(" ")}
              <button className="text-button" onClick={() => setRecovery(null)}>
                {t("Dismiss recovery link ")}
              </button>
            </div>
          ),
        )}
      </section>
      {tx(
        tab === "office" && office && (
          <section className="panel">
            <h2>{t("Office profile and directory information")}</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const d = new FormData(e.currentTarget);
                void run(async () => {
                  if (
                    officeGeography.divisionCode &&
                    !(officeType === "UNION"
                      ? officeGeography.unionCode
                      : officeGeography.upazilaCode)
                  )
                    throw Error(
                      "Complete the office's administrative area before saving.",
                    );
                  await api("/admin/office", "PATCH", {
                    ...Object.fromEntries(d),
                    ...(officeGeography.divisionCode
                      ? { geography: geographyPayload(officeGeography) }
                      : {
                          division: office.division,
                          district: office.district,
                          upazila: office.upazila,
                        }),
                  });
                }, "Office profile saved.");
              }}
            >
              <div className="form-grid">
                {tx(
                  [
                    ["nameBn", "Office name (Bangla)"],
                    ["nameEn", "Office name (English)"],
                  ].map(([key, label]) => (
                    <label key={key}>
                      {tx(label)}
                      <input
                        name={key}
                        defaultValue={office[key]}
                        required
                        minLength={2}
                      />
                    </label>
                  )),
                )}
                <label>
                  {t("Office type ")}
                  <select
                    aria-label={t("Office type")}
                    name="officeType"
                    value={officeType}
                    onChange={(e) => {
                      setOfficeType(e.target.value);
                      if (e.target.value !== "UNION")
                        setOfficeGeography((previous) => ({
                          ...previous,
                          unionCode: "",
                          wardCode: "",
                        }));
                    }}
                  >
                    <option value="UNION">{t("Union Parishad")}</option>
                    <option value="MUNICIPALITY">{t("Municipality")}</option>
                    <option value="CITY_CORPORATION">
                      {t("City corporation")}
                    </option>
                  </select>
                </label>
              </div>
              {tx(
                !office.geography?.divisionCode && (
                  <p className="notice">
                    {t("This existing office has an unmapped location:")}
                    {tx(" ")}
                    {tx(
                      [office.upazila, office.district, office.division]
                        .filter(Boolean)
                        .join(", "),
                    )}
                    {t(
                      ". You can keep it while editing, or select a dataset location below. Mapping a location links it to this office. ",
                    )}
                  </p>
                ),
              )}
              <GeographyFields
                prefix="admin-geo"
                value={officeGeography}
                onChange={setOfficeGeography}
                through={officeType === "UNION" ? "union" : "upazila"}
                required={!!officeGeography.divisionCode}
                legend="অফিসের প্রশাসনিক এলাকা / Office administrative area"
              />
              {tx(
                officeType !== "UNION" && (
                  <p className="hint">
                    {t(
                      "Municipality and city ward boundaries are not in this dataset. The selected upazila is an administrative reference only. ",
                    )}
                  </p>
                ),
              )}
              <button disabled={busy}>{t("Save office profile")}</button>
            </form>
            <fieldset className="citizen-details completeness-setting">
              <legend>{t("নাগরিক প্রোফাইলের পূর্ণতা / Citizen profile completeness")}</legend>
              <div className="check-field">
                <label htmlFor="require-complete-profile">
                  <input
                    id="require-complete-profile"
                    type="checkbox"
                    checked={!!office?.requireCompleteProfile}
                    disabled={busy}
                    onChange={(e) => {
                      const requireCompleteProfile = e.target.checked;
                      void run(async () => {
                        setOffice(
                          await api("/admin/office/profile-completeness", "PUT", {
                            requireCompleteProfile,
                          }),
                        );
                      }, requireCompleteProfile
                        ? "Certificates now require a complete citizen profile."
                        : "Incomplete profiles now show a warning only.");
                    }}
                  />
                  <span>
                    {t(
                      "সম্পূর্ণ প্রোফাইল ছাড়া সনদ ইস্যু করা যাবে না / Issue certificates only for complete citizen profiles",
                    )}
                  </span>
                </label>
              </div>
              <p className="hint">
                {t(
                  "Complete means: name, date of birth and address, an NID or birth registration number, and a mobile number or a 'no mobile' declaration. When off, approvers see a warning only.",
                )}
              </p>
            </fieldset>
          </section>
        ),
      )}
      {tx(
        tab === "users" && (
          <>
            <section className="panel">
              <h2>{t("Add staff account")}</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget,
                    d = new FormData(form);
                  void run(async () => {
                    // Phase 2a: a post fixes the role, so only one of the two is sent.
                    const body = Object.fromEntries(d) as Record<string, string>;
                    if (body.accountType) delete body.role;
                    else delete body.accountType;
                    await api("/admin/users", "POST", body);
                    form.reset();
                    setNewPost("");
                  }, "Staff account created.");
                }}
              >
                <div className="form-grid">
                  <label>
                    {t("Staff email ")}
                    <input name="email" type="email" required />
                  </label>
                  <label>
                    {t("Staff display name ")}
                    <input name="displayName" required />
                  </label>
                  <label>
                    {t("Initial password ")}
                    <input
                      name="password"
                      type="password"
                      minLength={6}
                      maxLength={18}
                      autoComplete="new-password"
                      required
                    />
                  </label>
                  <label>
                    {choose({ bn: "পদ", en: "Office post" })}
                    <select
                      aria-label={choose({ bn: "পদ", en: "Office post" })}
                      name="accountType"
                      value={newPost}
                      onChange={(e) => setNewPost(e.target.value)}
                    >
                      <option value="">
                        {choose({ bn: "অন্য — সরাসরি ভূমিকা বেছে নিন", en: "Other — choose a role directly" })}
                      </option>
                      {accountTypes
                        .filter((type) => type.available)
                        .map((type) => (
                          <option key={type.code} value={type.code}>
                            {choose({ bn: type.nameBn, en: type.nameEn })} → {type.role}
                            {type.status === "provisional" ? choose({ bn: " (অস্থায়ী)", en: " (provisional)" }) : ""}
                          </option>
                        ))}
                    </select>
                  </label>
                  {!newPost && (
                    <label>
                      {t("Staff role ")}
                      <select aria-label={t("Staff role")} name="role">
                        {tx(
                          [
                            "staff",
                            "reviewer",
                            "approver",
                            "finance",
                            "admin",
                          ].map((r) => (
                            <option key={r} value={r}>
                              {tx(r)}
                            </option>
                          )),
                        )}
                      </select>
                    </label>
                  )}
                </div>
                <button disabled={busy}>{t("Create staff account")}</button>
              </form>
            </section>
            <section className="panel">
              <h2>{t("Office accounts")}</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t("User")}</th>
                      <th>{choose({ bn: "পদ", en: "Office post" })}</th>
                      <th>{t("Role")}</th>
                      <th>{t("Status")}</th>
                      <th>{t("Update")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tx(
                      users.map((u) => (
                        <tr key={u.id || u.userId}>
                          <td>
                            {tx(read(u, "displayName", "display_name"))}
                            <small>{u.email}</small>
                          </td>
                          <td>
                            {u.role === "citizen" ? (
                              "—"
                            ) : (
                              <select
                                aria-label={`${choose({ bn: "পদ", en: "Office post" })}: ${u.email}`}
                                value={u.accountType || ""}
                                disabled={busy}
                                onChange={(e) =>
                                  e.target.value &&
                                  void run(async () => {
                                    await api(`/admin/users/${u.id || u.userId}`, "PATCH", {
                                      accountType: e.target.value,
                                    });
                                  }, "Office post updated.")
                                }
                              >
                                <option value="">{choose({ bn: "নির্ধারিত নয়", en: "Not set" })}</option>
                                {accountTypes
                                  .filter((type) => type.available)
                                  .map((type) => (
                                    <option key={type.code} value={type.code}>
                                      {choose({ bn: type.nameBn, en: type.nameEn })}
                                    </option>
                                  ))}
                              </select>
                            )}
                          </td>
                          <td>
                            <select
                              aria-label={`${t("Role for")} ${u.email}`}
                              value={u.role}
                              disabled={u.role === "citizen" || busy}
                              onChange={(e) =>
                                void run(async () => {
                                  await api(
                                    `/admin/users/${u.id || u.userId}`,
                                    "PATCH",
                                    { role: e.target.value },
                                  );
                                }, "Staff role updated.")
                              }
                            >
                              {tx(
                                [
                                  "citizen",
                                  "staff",
                                  "reviewer",
                                  "approver",
                                  "finance",
                                  "admin",
                                ].map((r) => (
                                  <option key={r} value={r}>
                                    {tx(r)}
                                  </option>
                                )),
                              )}
                            </select>
                          </td>
                          <td>
                            {tx(u.active === false ? "Suspended" : "Active")}
                          </td>
                          <td>
                            <button
                              className="secondary"
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  await api(
                                    `/admin/users/${u.id || u.userId}`,
                                    "PATCH",
                                    { active: u.active === false },
                                  );
                                }, "Account access updated.")
                              }
                            >
                              {tx(u.active === false ? "Activate" : "Suspend")}
                            </button>
                            {tx(
                              u.active !== false &&
                                !["admin", "owner"].includes(u.role) && (
                                  <button
                                    className="text-button"
                                    disabled={busy}
                                    onClick={() =>
                                      void run(async () => {
                                        setRecovery(
                                          await api(
                                            `/admin/users/${u.id || u.userId}/recovery`,
                                            "POST",
                                            {},
                                          ),
                                        );
                                      }, "One-use recovery link generated.")
                                    }
                                  >
                                    {t("Generate recovery link ")}
                                  </button>
                                ),
                            )}
                          </td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ),
      )}
      {tx(
        tab === "services" && (
          <section className="panel">
            {/* Phase 3D (3B follow-up): the legacy per-office credit_cost editor is
                gone from this screen. Since 3B it no longer moves money — the
                platform credit price (owner Pricing panel) is what a submit
                charges — so showing an editable "credits per issue" here only
                misled office admins. The API field itself is untouched. */}
            <h2>
              {choose({ bn: "সেবার প্রাপ্যতা", en: "Service availability" })}
            </h2>
            <p className="hint">
              {choose({
                bn: "এখানে শুধু সেবা চালু বা বন্ধ করা যায়। প্রতিটি আবেদনের ক্রেডিট মূল্য প্ল্যাটফর্ম মালিক মূল্য নির্ধারণ প্যানেল থেকে নির্ধারণ করেন — আবেদন প্রথমবার জমা দেওয়ার সময় সেই মূল্যই কাটা হয়। আবেদন ফি নীতিতে সরকারি ফি ও প্রসেসিং ফি আলাদাভাবে নির্ধারিত হয়।",
                en: "Here you only switch services on or off. The credit price of each application is set by the platform owner in the Pricing panel — that is the price charged when an application is first submitted. Statutory and processing fees are configured separately under Application fee policies.",
              })}
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("Service")}</th>
                    <th>{t("Available")}</th>
                  </tr>
                </thead>
                <tbody>
                  {tx(
                    services.map((s) => {
                      const no = s.serviceNo || s.service_no;
                      return (
                        <tr key={no}>
                          <td>
                            {t("#")}
                            {tx(no)}{" "}
                            {choose({
                              bn: read(s, "nameBn", "name_bn"),
                              en: read(s, "nameEn", "name_en"),
                            })}
                          </td>
                          <td>
                            <button
                              disabled={busy}
                              className={s.enabled ? "secondary" : ""}
                              onClick={() =>
                                void run(async () => {
                                  await api(`/admin/services/${no}`, "PATCH", {
                                    enabled: !s.enabled,
                                  });
                                }, "Service availability saved.")
                              }
                            >
                              {tx(
                                s.enabled
                                  ? "Disable service"
                                  : "Enable service",
                              )}
                            </button>
                          </td>
                        </tr>
                      );
                    }),
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ),
      )}
      {tab === "order-policies" && <OrderPolicySettings services={services} />}
      {tab === "cert-assets" && <CertificateAssetsSettings />}
      {tab === "coupons" && <CouponSettings services={services} />}
      {tab === "payments" && (
        <>
          <PaymentMerchantSettings />
          <BkashMerchantSettings />
        </>
      )}
      {tx(
        tab === "authority" && (
          <section className="panel">
            <h2>{t("Explicit service approval authority")}</h2>
            <p className="notice">
              {t(
                "These assignments control who can approve applications for each service.",
              )}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const d = new FormData(e.currentTarget);
                void run(async () => {
                  await api(
                    `/admin/authorizations/${d.get("userId")}/${d.get("serviceNo")}`,
                    "PUT",
                    {
                      active: d.get("active") === "true",
                      authorityNote: d.get("authorityNote"),
                    },
                  );
                }, "Approval authorization recorded.");
              }}
            >
              <div className="form-grid">
                <label>
                  {t("Approver ")}
                  <select aria-label={t("Approver")} name="userId" required>
                    <option value="">{t("Choose approver")}</option>
                    {tx(
                      users
                        .filter((u) => u.role === "approver")
                        .map((u) => (
                          <option
                            value={u.id || u.userId}
                            key={u.id || u.userId}
                          >
                            {u.email}
                          </option>
                        )),
                    )}
                  </select>
                </label>
                <label>
                  {t("Authorized service ")}
                  <select aria-label={t("Authorized service")} name="serviceNo">
                    {tx(
                      services.map((s) => (
                        <option
                          value={s.serviceNo || s.service_no}
                          key={s.serviceNo || s.service_no}
                        >
                          {t("#")}
                          {tx(s.serviceNo || s.service_no)}
                          {tx(" ")}
                          {choose({
                            bn: read(s, "nameBn", "name_bn"),
                            en: read(s, "nameEn", "name_en"),
                          })}
                        </option>
                      )),
                    )}
                  </select>
                </label>
                <label>
                  {t("Authorization status ")}
                  <select aria-label={t("Authorization status")} name="active">
                    <option value="true">{t("Active")}</option>
                    <option value="false">{t("Revoked")}</option>
                  </select>
                </label>
                <label>
                  {t("Authority note ")}
                  <input
                    name="authorityNote"
                    minLength={12}
                    required
                    placeholder={t("Authorization scope and reason")}
                  />
                </label>
              </div>
              <button disabled={busy}>{t("Save authorization")}</button>
            </form>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("Approver")}</th>
                    <th>{t("Service")}</th>
                    <th>{t("State")}</th>
                    <th>{t("Note")}</th>
                  </tr>
                </thead>
                <tbody>
                  {tx(
                    authorizations.map((a, i) => (
                      <tr key={a.id || i}>
                        <td>
                          {tx(
                            a.email ||
                              users.find(
                                (u) =>
                                  (u.id || u.userId) ===
                                  (a.userId || a.user_id),
                              )?.email ||
                              a.userId ||
                              a.user_id,
                          )}
                        </td>
                        <td>{tx(a.serviceNo || a.service_no)}</td>
                        <td>{tx(a.active ? "Active" : "Revoked")}</td>
                        <td>
                          {tx(read(a, "authorityNote", "authority_note"))}
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ),
      )}
      {tx(
        tab === "notices" && (
          <>
            <section className="panel">
              <h2>{t("Publish an office notice")}</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget,
                    d = new FormData(form);
                  void run(async () => {
                    await api("/admin/notices", "POST", {
                      titleBn: d.get("titleBn"),
                      titleEn: d.get("titleEn"),
                      bodyBn: d.get("bodyBn"),
                      bodyEn: d.get("bodyEn"),
                      published: d.get("published") === "true",
                    });
                    form.reset();
                  }, "Office notice saved.");
                }}
              >
                <div className="form-grid">
                  <label>
                    {t("Notice title (Bangla) ")}
                    <input name="titleBn" required />
                  </label>
                  <label>
                    {t("Notice title (English) ")}
                    <input name="titleEn" required />
                  </label>
                  <label>
                    {t("Notice body (Bangla) ")}
                    <textarea name="bodyBn" required />
                  </label>
                  <label>
                    {t("Notice body (English) ")}
                    <textarea name="bodyEn" required />
                  </label>
                  <label>
                    {t("Publication ")}
                    <select aria-label={t("Publication")} name="published">
                      <option value="false">{t("Save draft")}</option>
                      <option value="true">{t("Publish publicly")}</option>
                    </select>
                  </label>
                </div>
                <button disabled={busy}>{t("Save notice")}</button>
              </form>
            </section>
            <section className="panel">
              <h2>{t("Saved notices")}</h2>
              {tx(
                notices.map((n) => (
                  <article key={n.id} className="notice-entry">
                    <h3>{tx(read(n, "titleBn", "title_bn"))}</h3>
                    <p>{tx(read(n, "bodyBn", "body_bn"))}</p>
                    <small>{tx(read(n, "titleEn", "title_en"))}</small>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api(`/admin/notices/${n.id}`, "PATCH", {
                            published: !n.published,
                          });
                        }, "Notice publication updated.")
                      }
                    >
                      {tx(n.published ? "Unpublish notice" : "Publish notice")}
                    </button>
                  </article>
                )),
              )}
            </section>
          </>
        ),
      )}
    </>
  );
}

export function OwnerOnboarding({ onSaved }: { onSaved: () => Promise<void> }) {
  const [geography, setGeography] = useState(emptyGeography);
  const [officeType, setOfficeType] = useState("UNION");
  const [activateNow, setActivateNow] = useState(false);
  const [plans, setPlans] = useState<any[]>([]);
  const [message, setMessage] = useState(""),
    [errorMessage, setErrorMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api("/owner/tenants")
      .then((r) => setPlans(r.plans ?? []))
      .catch(() => setPlans([]));
  }, []);
  return (
    <section className="panel">
      <h3>{t("নতুন অফিস যুক্ত করুন / Onboard an office")}</h3>
      <p>
        {t(
          "Create an isolated tenant and its first administrator.",
        )}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget,
            d = new FormData(form);
          setBusy(true);
          setMessage("");
          setErrorMessage("");
          try {
            if (
              !(officeType === "UNION"
                ? geography.unionCode
                : geography.upazilaCode)
            )
              throw Error("Choose the office's complete administrative area.");
            const fields = Object.fromEntries(d) as Record<string, any>;
            const {
              activationPlanId,
              activationDays,
              activationGrantCredits,
              ...officeFields
            } = fields;
            await api("/owner/tenants", "POST", {
              ...officeFields,
              geography: geographyPayload(geography),
              ...(activateNow
                ? {
                    activateSubscription: {
                      planId: String(activationPlanId || "standard-monthly"),
                      ...(Number(activationDays)
                        ? { days: Number(activationDays) }
                        : {}),
                      grantCredits: activationGrantCredits === "on",
                    },
                  }
                : {}),
            });
            await onSaved();
            form.reset();
            setGeography(emptyGeography());
            setOfficeType("UNION");
            setMessage("Office and initial administrator created.");
          } catch (e) {
            setErrorMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          {tx(
            [
              ["slug", "Unique office slug"],
              ["nameBn", "Office name (Bangla)"],
              ["nameEn", "Office name (English)"],
              ["adminEmail", "Administrator email"],
              ["adminName", "Administrator display name"],
              ["adminPassword", "Administrator initial password"],
            ].map(([key, label]) => (
              <label key={key}>
                {tx(label)}
                <input
                  name={key}
                  required
                  type={
                    key === "adminPassword"
                      ? "password"
                      : key === "adminEmail"
                        ? "email"
                        : "text"
                  }
                  minLength={key === "adminPassword" ? 6 : undefined}
                  maxLength={key === "adminPassword" ? 18 : undefined}
                  pattern={key === "slug" ? "[a-z0-9-]+" : undefined}
                  autoComplete="off"
                />
              </label>
            )),
          )}
          <label>
            {t("Office type ")}
            <select
              aria-label={t("Office type")}
              name="officeType"
              value={officeType}
              onChange={(e) => {
                setOfficeType(e.target.value);
                if (e.target.value !== "UNION")
                  setGeography((previous) => ({
                    ...previous,
                    unionCode: "",
                    wardCode: "",
                  }));
              }}
            >
              <option value="UNION">{t("Union Parishad")}</option>
              <option value="MUNICIPALITY">{t("Municipality")}</option>
              <option value="CITY_CORPORATION">{t("City corporation")}</option>
            </select>
          </label>
        </div>
        <GeographyFields
          prefix="owner-geo"
          value={geography}
          onChange={setGeography}
          through={officeType === "UNION" ? "union" : "upazila"}
          required
          legend="অফিসের প্রশাসনিক এলাকা / Office administrative area"
        />
        {tx(
          officeType !== "UNION" && (
            <p className="hint">
              {t(
                "Municipality and city ward boundaries are not in this dataset. The selected upazila is an administrative reference only. ",
              )}
            </p>
          ),
        )}
        <fieldset className="subscription-activation">
          <legend>{t("Subscription on approval")}</legend>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={activateNow}
              onChange={(e) => setActivateNow(e.target.checked)}
            />{" "}
            {t("Activate subscription now")}
          </label>
          {activateNow && (
            <div className="form-grid">
              <label>
                {t("Plan")}
                <select name="activationPlanId" defaultValue="standard-monthly">
                  {(plans.length ? plans : [{ id: "standard-monthly", name: "Standard Monthly" }]).map(
                    (p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.name ?? p.id}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                {t("Days (optional)")}
                <input name="activationDays" type="number" min={1} max={3650} />
              </label>
              <label className="checkbox-label">
                <input name="activationGrantCredits" type="checkbox" defaultChecked />{" "}
                {t("Grant the plan credits")}
              </label>
            </div>
          )}
        </fieldset>
        <button disabled={busy}>{t("Create office")}</button>
      </form>
      {tx(
        message && (
          <p role="status" className="notice success">
            {tx(message)}
          </p>
        ),
      )}
      {tx(
        errorMessage && (
          <p role="alert" className="notice error">
            {tx(errorMessage)}
          </p>
        ),
      )}
    </section>
  );
}
