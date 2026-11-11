import {
  t,
  tx,
  choose,
  recordName,
  useLanguage,
  LanguageSwitcher,
} from "./i18n.js";
import React, { lazy, useEffect, useRef, useState } from "react";
import {
  demoPayloads,
  operationalServiceNumbers,
  getServiceSchema,
  getCatalogPreviewSchema,
  validateForm,
  type ValidationIssue,
} from "@astra/shared-schemas";
import { api, items } from "./api.js";
import { AsyncPanel } from "./AsyncPanel.js";
import { DynamicForm } from "./DynamicForm.js";
import {
  PresentAddressFields,
  chosenCitizenAddress,
  emptyPresentAddress,
  presentAddressPayload,
} from "./PresentAddressFields.js";
import { WorkspaceWelcome } from "./WorkspaceWelcome.js";
import { ApplicationGuidance } from "./ApplicationGuidance.js";
import "./workspace-usability.css";
import {
  ApplicationOrder,
  OrderSummary,
  type IntakeOrderState,
} from "./ApplicationOrder.js";
import {
  GeographyFields,
  emptyGeography,
  geographyPayload,
  readGeography,
} from "./GeographyFields.js";
const AdminWorkspace = lazy(() =>
  import("./AdminWorkspace.js").then((m) => ({ default: m.AdminWorkspace })),
);
const AccountSecurity = lazy(() =>
  import("./AdminWorkspace.js").then((m) => ({ default: m.AccountSecurity })),
);
const OwnerOnboarding = lazy(() =>
  import("./AdminWorkspace.js").then((m) => ({ default: m.OwnerOnboarding })),
);
const AdditionalWorkspace = lazy(() =>
  import("./AdditionalWorkspace.js").then((m) => ({
    default: m.AdditionalWorkspace,
  })),
);
const ApplicationPayment = lazy(() =>
  import("./OnlinePayments.js").then((m) => ({
    default: m.ApplicationPayment,
  })),
);
const PaymentsWorkspace = lazy(() =>
  import("./OnlinePayments.js").then((m) => ({ default: m.PaymentsWorkspace })),
);
const localDemo = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(
  location.hostname,
);
const labels: Record<string, string> = {
  home: "Overview",
  services: "Service catalog",
  citizens: "Citizens",
  applications: "Applications",
  billing: "Subscription & credits",
  payments: "Payments and receipts",
  owner: "Platform management",
  admin: "Office administration",
  security: "Account security",
  profile: "My profile",
  prints: "Print requests",
  notifications: "Notifications",
  reports: "Reports",
  support: "Support inbox",
};
const localized: Record<string, string> = {
  home: "সেবার সারসংক্ষেপ",
  services: "সেবার তালিকা",
  citizens: "নাগরিক",
  applications: "আবেদন",
  billing: "সাবস্ক্রিপশন ও ক্রেডিট",
  payments: "পেমেন্ট ও রসিদ",
  owner: "প্ল্যাটফর্ম ব্যবস্থাপনা",
  admin: "অফিস ব্যবস্থাপনা",
  security: "অ্যাকাউন্ট নিরাপত্তা",
  profile: "আমার প্রোফাইল",
  prints: "প্রিন্ট অনুরোধ",
  notifications: "নোটিফিকেশন",
  reports: "প্রতিবেদন",
  support: "সহায়তা ইনবক্স",
};
const actionText: Record<string, string> = {
  submit: "Submit application",
  review: "Begin review",
  request_correction: "Request correction",
  resubmit: "Resubmit application",
  approve: "Approve application",
  reject: "Reject application",
  cancel: "Cancel application",
};
function withoutOrderLanguage(schema: ReturnType<typeof getServiceSchema>) {
  return {
    ...schema,
    sections: schema.sections.map((section) => ({
      ...section,
      fields: section.fields.filter(
        (field) => field.id !== "delivery_language",
      ),
    })),
  };
}
export function WorkspaceApp({
  session,
  onSignOut,
  paymentReturnApplication,
  onPaymentReturnHandled,
}: {
  session: any;
  onSignOut: () => void;
  paymentReturnApplication: string | null;
  onPaymentReturnHandled: () => void;
}) {
  const [language] = useLanguage();
  const [page, setPage] = useState("home"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [catalog, setCatalog] = useState<any[]>([]),
    [citizens, setCitizens] = useState<any[]>([]),
    [applications, setApplications] = useState<any[]>([]),
    [wallet, setWallet] = useState<any>(null),
    [billing, setBilling] = useState<any>(null),
    [tenants, setTenants] = useState<any[]>([]);
  const [selectedService, setSelectedService] = useState(45),
    [preview, setPreview] = useState(false),
    [payload, setPayload] = useState<Record<string, any>>({}),
    [citizenId, setCitizenId] = useState(""),
    [selectedCitizen, setSelectedCitizen] = useState<any>(null),
    [returnToIntake, setReturnToIntake] = useState(false),
    [issues, setIssues] = useState<readonly ValidationIssue[]>([]),
    [detail, setDetail] = useState<any>(null),
    [reason, setReason] = useState(""),
    [filter, setFilter] = useState(""),
    [search, setSearch] = useState("");
  const [appSearch, setAppSearch] = useState(""),
    [appQuery, setAppQuery] = useState(""),
    [appPage, setAppPage] = useState(1),
    [appPageSize, setAppPageSize] = useState(25),
    [appTotal, setAppTotal] = useState(0);
  const [applicationReference, setApplicationReference] = useState("");
  const [intakeOrder, setIntakeOrder] = useState<IntakeOrderState | null>(null);
  const [renewalOrder, setRenewalOrder] = useState<IntakeOrderState | null>(
    null,
  );
  const [renewalLanguageChoice, setRenewalLanguageChoice] = useState<{
    id: string;
    language: "bn" | "en";
  } | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      setAppQuery(appSearch);
      setAppPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [appSearch]);
  const [citizenSearch, setCitizenSearch] = useState(""),
    [citizenQuery, setCitizenQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setCitizenQuery(citizenSearch), 250);
    return () => clearTimeout(timer);
  }, [citizenSearch]);
  const [citizenForm, setCitizenForm] = useState({
    nameBn: "",
    nameEn: "",
    dateOfBirth: "",
    addressBn: "",
    addressEn: "",
  });
  const [citizenGeography, setCitizenGeography] = useState(emptyGeography);
  const [citizenPresentAddress, setCitizenPresentAddress] = useState(
    emptyPresentAddress(),
  );
  useEffect(() => {
    setCitizenGeography(readGeography(session?.tenant));
  }, [session?.tenant?.id]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const refreshEpoch = useRef(0);
  async function refresh() {
    const role = session?.user?.role;
    if (!role) return;
    const epoch = ++refreshEpoch.current;
    const [
      servicesResult,
      citizenResult,
      applicationResult,
      walletResult,
      billingResult,
      tenantResult,
    ] = await Promise.all([
      api("/services"),
      !["owner", "finance"].includes(role)
        ? api(`/citizens?q=${encodeURIComponent(citizenQuery)}`)
        : Promise.resolve({ items: [] }),
      !["owner", "finance"].includes(role)
        ? api(
            `/applications?${new URLSearchParams({ ...(filter ? { state: filter } : {}), q: appQuery, page: String(appPage), pageSize: String(appPageSize) })}`,
          )
        : Promise.resolve({ items: [], total: 0 }),
      ["admin", "finance", "approver"].includes(role)
        ? api("/wallet")
        : Promise.resolve(null),
      ["admin", "finance"].includes(role)
        ? api("/billing")
        : Promise.resolve(null),
      role === "owner" ? api("/owner/tenants") : Promise.resolve({ items: [] }),
    ]);
    if (epoch !== refreshEpoch.current) return;
    setCatalog(items(servicesResult));
    setCitizens(items(citizenResult));
    setApplications(items(applicationResult));
    setAppTotal(applicationResult.total ?? items(applicationResult).length);
    setWallet(walletResult);
    setBilling(billingResult);
    setTenants(items(tenantResult));
  }
  useEffect(() => {
    if (session) run(refresh);
  }, [session, filter, appQuery, appPage, appPageSize, citizenQuery]);
  const paymentReturnHandled = useRef(false);
  useEffect(() => {
    if (!session || !paymentReturnApplication || paymentReturnHandled.current)
      return;
    paymentReturnHandled.current = true;
    onPaymentReturnHandled();
    void run(async () => {
      await openApplication(paymentReturnApplication);
      history.replaceState({}, "", "/");
      setMessage(
        "You returned from the gateway. Check the server-verified payment status below.",
      );
    });
  }, [session]);
  useEffect(() => {
    setPayload({});
    setPreview(false);
    setIssues([]);
  }, [selectedService]);
  const role = session?.user?.role || "",
    staff = ["staff", "admin"].includes(role),
    reviewer = role === "reviewer",
    approver = role === "approver",
    finance = ["finance", "admin"].includes(role);
  const canApply = staff || role === "citizen";
  const visiblePages = Object.keys(labels).filter((p) =>
    role === "owner"
      ? [
          "home",
          "services",
          "owner",
          "security",
          "profile",
          "support",
        ].includes(p)
      : !["owner", "support"].includes(p) &&
        (p !== "admin" || role === "admin") &&
        (p !== "reports" || finance) &&
        (p !== "prints" || staff || role === "citizen") &&
        (p !== "billing" || finance) &&
        (p !== "payments" || ["staff", "admin", "finance"].includes(role)) &&
        (role !== "finance" ||
          [
            "home",
            "services",
            "billing",
            "payments",
            "security",
            "profile",
            "notifications",
            "reports",
          ].includes(p)),
  );
  const normalizeSearch = (value: string) =>
    value
      .replace(/[০-৯]/g, (digit) => String(digit.charCodeAt(0) - 0x09e6))
      .trim()
      .toLowerCase();
  const matchingServices = catalog.filter((service) =>
    normalizeSearch(
      `${service.service_no} ${service.name_bn} ${service.name_en}`,
    ).includes(normalizeSearch(search)),
  );
  const errorSummary = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (issues.length) errorSummary.current?.focus();
  }, [issues]);
  function focusIssue(path: string) {
    const field = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid="service-application-form"] [data-field-path]',
      ),
    ).find((element) => element.dataset.fieldPath === path);
    field?.focus();
  }
  function fieldLabel(path: string): string {
    let definitions = schema.sections.flatMap((section) => [...section.fields]);
    const labels: string[] = [];
    for (const part of path.match(/[^.[\]]+/g) ?? []) {
      if (/^\d+$/.test(part)) {
        labels.push(
          choose({ bn: "সারি", en: "Row" }) +
            " " +
            (Number(part) + 1).toLocaleString(
              language === "bn" ? "bn-BD" : "en-GB",
            ),
        );
        continue;
      }
      const field = definitions.find((field) => field.id === part);
      if (!field) continue;
      labels.push(choose(field.label));
      definitions = [...(field.children ?? [])];
    }
    return (
      labels.join(" → ") ||
      choose({ bn: "তথ্য সংশোধন করুন", en: "Check this field" })
    );
  }
  function applicationDate(raw: string) {
    const date = new Date(raw);
    return Number.isNaN(date.getTime())
      ? "—"
      : date.toLocaleDateString(language === "bn" ? "bn-BD" : "en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        });
  }
  function clearApplicationFilters() {
    setFilter("");
    setAppSearch("");
    setAppQuery("");
    setAppPage(1);
  }
  function openTask(next: string, state = "") {
    if (next === "applications") {
      clearApplicationFilters();
      setFilter(state);
    }
    nav(next);
  }
  const applicantChoices =
    selectedCitizen && !citizens.some((c) => c.id === selectedCitizen.id)
      ? [selectedCitizen, ...citizens]
      : citizens;
  function selectApplicant(
    id: string,
    citizen = applicantChoices.find((c) => c.id === id),
  ) {
    if (id !== citizenId) {
      setPayload({});
      setIssues([]);
    }
    setCitizenId(id);
    setSelectedCitizen(citizen ?? null);
  }
  const operational =
      operationalServiceNumbers.includes(selectedService) && !preview,
    schema = operational
      ? getServiceSchema(selectedService)
      : getCatalogPreviewSchema(selectedService);
  const issueCost = detail?.serviceConfiguration?.creditCost ?? 1;
  const intakeContext = `${citizenId}:${selectedService}`;
  const orderConfigured =
    intakeOrder?.context === intakeContext && intakeOrder.configured;
  const application = detail?.application || detail,
    detailPayload = detail?.payload || application?.payload || {};
  const renewalLanguage =
    renewalLanguageChoice && renewalLanguageChoice.id === application?.id
      ? renewalLanguageChoice.language
      : detailPayload.delivery_language;
  async function openApplication(id: string) {
    setDetail(await api(`/applications/${id}`));
    setPage("applications");
    setReason("");
  }
  async function transition(action: string) {
    await api(`/applications/${application.id}/transition`, "POST", {
      action,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    });
    await openApplication(application.id);
    await refresh();
    setMessage(`${actionText[action]} completed.`);
  }
  function nav(next: string) {
    setReturnToIntake(false);
    setPage(next);
    setDetail(null);
    setMessage("");
    setSearch("");
  }
  function certificatePanel(cert: any) {
    if (!cert) return null;
    return (
      <div
        className="certificate-card"
        id="application-certificate"
        tabIndex={-1}
      >
        <div>
          <span className="eyebrow">{t("DEMO CERTIFICATE")}</span>
          <h3>
            {tx(
              cert.number ||
                cert.certificateNumber ||
                cert.certificate_number ||
                cert.id,
            )}
          </h3>
          <p>
            {t("Public verification reveals office, service, date and status.")}
          </p>
        </div>
        <div className="actions">
          <a
            className="button"
            href={`/api/v1/certificates/${cert.id}/pdf`}
            target="_blank"
            rel="noreferrer"
          >
            {t("Download PDF ")}
          </a>
          <a
            className="button secondary"
            href={cert.verificationUrl || cert.verification_url}
            target="_blank"
            rel="noreferrer"
          >
            {t("QR verification ")}
          </a>
          {tx(
            approver && cert.status !== "REVOKED" && (
              <button
                className="danger"
                onClick={() =>
                  run(async () => {
                    if (reason.trim().length < 3)
                      throw Error("Enter a revocation reason.");
                    await api(`/certificates/${cert.id}/revoke`, "POST", {
                      reason,
                    });
                    await openApplication(application.id);
                    setMessage("Certificate revoked.");
                  })
                }
              >
                {t("Revoke certificate ")}
              </button>
            ),
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="shell">
      <a className="skip" href="#content">
        {t("Skip to main content ")}
      </a>
      <aside>
        <a className="brand" href="/">
          {t("A")}
          <span>{t("ASTRA UNION SERVICES")}</span>
        </a>
        <p className="office">
          {tx(recordName(session.tenant) || "Platform owner")}
          <small>
            {tx(
              session.tenant ? "Office workspace" : "Independent SaaS platform",
            )}
          </small>
        </p>
        <div className="workspace-jump">
          <label htmlFor="workspace-jump">
            {choose({ bn: "কোথায় যেতে চান?", en: "Go to a page" })}
          </label>
          <select
            id="workspace-jump"
            value={page}
            onChange={(event) => nav(event.target.value)}
          >
            {visiblePages.map((key) => (
              <option key={key} value={key}>
                {choose({ bn: localized[key], en: labels[key] })}
              </option>
            ))}
          </select>
        </div>
        <nav aria-label={t("Workspace navigation")}>
          {tx(
            visiblePages.map((p) => (
              <button
                key={p}
                aria-current={page === p ? "page" : undefined}
                onClick={() => nav(p)}
              >
                <span>{choose({ bn: localized[p], en: labels[p] })}</span>
              </button>
            )),
          )}
        </nav>
        <div className="sidebar-bottom">
          <span className="status">{t("DEMO WORKSPACE")}</span>
          <p>
            {tx(
              session.user.displayName ||
                session.user.display_name ||
                session.user.email,
            )}
            <small>{tx(role)}</small>
          </p>
          <button
            className="text-button"
            onClick={() =>
              run(async () => {
                await api("/auth/logout", "POST");
                refreshEpoch.current++;
                onSignOut();
                setCitizens([]);
                setApplications([]);
                setWallet(null);
                setBilling(null);
                setTenants([]);
                setCitizenId("");
                setSelectedCitizen(null);
                setReturnToIntake(false);
                setPayload({});
                setIssues([]);
                setCitizenSearch("");
                setAppSearch("");
                setApplicationReference("");
                setAppPage(1);
                setAppTotal(0);
                setFilter("");
                setDetail(null);
                setPage("home");
              })
            }
          >
            {t("Sign out ")}
          </button>
        </div>
      </aside>
      <main id="content">
        <header>
          <div>
            <span className="eyebrow">
              {t("ASTRA · DIGITAL UNION SERVICES")}
            </span>
            <h1>{choose({ bn: localized[page], en: labels[page] })}</h1>
          </div>
          <div className="workspace-header-actions">
            <LanguageSwitcher />
            <span className="demo-pill">{t("DEMO / NOT OFFICIAL")}</span>
          </div>
        </header>
        {tx(
          message && (
            <div role="status" className="notice message">
              {tx(message)}
            </div>
          ),
        )}
        {tx(
          busy && (
            <p role="status" className="working">
              {t("Working… ")}
            </p>
          ),
        )}
        {page === "home" && (
          <>
            <WorkspaceWelcome role={role} navigate={openTask} />
            <section className="panel">
              <h2>
                {choose({
                  bn: "যেভাবে আবেদন এগোয়",
                  en: "How an application moves forward",
                })}
              </h2>
              <ol className="intake-steps">
                <li>
                  <span>1</span>
                  {choose({
                    bn: "তথ্য দিয়ে আবেদন জমা",
                    en: "Fill in and submit",
                  })}
                </li>
                <li>
                  <span>2</span>
                  {choose({
                    bn: "অফিসের পর্যালোচনা ও অনুমোদন",
                    en: "Office review and approval",
                  })}
                </li>
                <li>
                  <span>3</span>
                  {choose({
                    bn: "শর্ত পূরণ হলে সনদ সংগ্রহ",
                    en: "Receive the certificate when requirements are met",
                  })}
                </li>
              </ol>
              <p className="hint">
                {choose({
                  bn: "খসড়া সংরক্ষণ করলে আবেদন জমা হয় না। আবেদন খুলে “আবেদন জমা দিন” চাপতে হবে। ফি থাকলে যাচাইকৃত পরিশোধের পর অনুমোদনকারী সনদ ইস্যু করবেন।",
                  en: "Saving a draft does not submit it. Open the draft and choose “Submit application”. Any assessed fee must be verified before an authorized approver issues a certificate.",
                })}
              </p>
            </section>
            <details className="panel workspace-information">
              <summary>
                {choose({
                  bn: "সিস্টেমের বর্তমান সীমা ও সেবার তথ্য",
                  en: "Current service availability and limitations",
                })}
              </summary>
              <p>
                {choose({
                  bn: "৪৭টি সেবার ফর্ম ব্যবহার করা যায়। সনদগুলো DEMO / NOT OFFICIAL। পরিচয় যাচাই, সরকারি কর্তৃত্ব ও live payment collection চালু নেই।",
                  en: "Forms are available for 47 services. Certificates are DEMO / NOT OFFICIAL. Identity verification, official issuing authority and live payment collection are not enabled.",
                })}
              </p>
              <p>
                {t(
                  "All 47 services have independently authored operational demo forms. Original initial-field captures are separately available as read-only evidence previews. Original submission, payment and official issuance behavior remains unverified. ",
                )}
              </p>
            </details>
          </>
        )}
        {tx(
          page === "services" && (
            <>
              {canApply && (
                <ol
                  className="intake-steps"
                  aria-label={choose({
                    bn: "আবেদনের ধাপ",
                    en: "Application steps",
                  })}
                >
                  <li aria-current={!citizenId ? "step" : undefined}>
                    <a href="#intake-heading">
                      <span>1</span>
                      {choose({ bn: "নাগরিক বাছাই", en: "Choose citizen" })}
                    </a>
                  </li>
                  <li
                    aria-current={
                      citizenId && !Object.keys(payload).length
                        ? "step"
                        : undefined
                    }
                  >
                    <a href="#service-choice">
                      <span>2</span>
                      {choose({ bn: "সেবা বাছাই", en: "Choose service" })}
                    </a>
                  </li>
                  <li
                    aria-current={
                      citizenId && Object.keys(payload).length
                        ? "step"
                        : undefined
                    }
                  >
                    <a href="#service-form-panel">
                      <span>3</span>
                      {choose({
                        bn: "তথ্য, ফি ও খসড়া",
                        en: "Details, fees and draft",
                      })}
                    </a>
                  </li>
                </ol>
              )}
              {canApply && (
                <section
                  className="panel intake-panel"
                  aria-labelledby="intake-heading"
                >
                  <div className="section-heading">
                    <div>
                      <span className="eyebrow">{t("NEW APPLICATION")}</span>
                      <h2 id="intake-heading">
                        {t("Choose the citizen first")}
                      </h2>
                    </div>
                    {staff && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          nav("citizens");
                          setReturnToIntake(true);
                        }}
                      >
                        {t("Register a new citizen")}
                      </button>
                    )}
                  </div>
                  <p className="hint">
                    {t(
                      "Select an existing citizen, choose a service, then complete the application. New applications start with empty fields.",
                    )}
                  </p>
                  <div className="form-grid">
                    <div className="field">
                      <label htmlFor="applicant-search">
                        {t("Find applicant")}
                      </label>
                      <input
                        id="applicant-search"
                        placeholder={t("Name or unique demo reference")}
                        value={citizenSearch}
                        onChange={(e) => setCitizenSearch(e.target.value)}
                      />
                      <p className="hint">
                        {t(
                          "Searches your office records. Up to 100 matching citizens are shown.",
                        )}
                      </p>
                    </div>
                    <div className="field">
                      <label htmlFor="applicant">{t("Citizen / নাগরিক")}</label>
                      <select
                        id="applicant"
                        value={citizenId}
                        onChange={(e) => selectApplicant(e.target.value)}
                      >
                        <option value="">{t("Choose citizen")}</option>
                        {applicantChoices.map((c) => (
                          <option value={c.id} key={c.id}>
                            {choose({
                              bn: c.nameBn || c.name_bn,
                              en: c.nameEn || c.name_en,
                            })}
                          </option>
                        ))}
                      </select>
                      <p className="hint">
                        {t(
                          "Changing the citizen clears unsaved application details.",
                        )}
                      </p>
                    </div>
                  </div>
                  {selectedCitizen && (
                    <p className="intake-selection" role="status">
                      <strong>{t("Selected citizen")}: </strong>
                      {choose({
                        bn: selectedCitizen.nameBn || selectedCitizen.name_bn,
                        en: selectedCitizen.nameEn || selectedCitizen.name_en,
                      })}
                    </p>
                  )}
                </section>
              )}
              <section className="panel" id="service-choice">
                <label htmlFor="service-search">{t("Search services")}</label>
                <input
                  id="service-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("Name or service number")}
                />
                <div className="application-filter-tools">
                  <p className="hint" role="status">
                    {matchingServices.length.toLocaleString(
                      language === "bn" ? "bn-BD" : "en-GB",
                    )}{" "}
                    {choose({ bn: "টি সেবা পাওয়া গেছে", en: "services found" })}
                  </p>
                  {search && (
                    <button
                      className="text-button"
                      onClick={() => setSearch("")}
                    >
                      {choose({ bn: "সার্চ মুছুন", en: "Clear search" })}
                    </button>
                  )}
                </div>
                {!matchingServices.length && (
                  <p className="service-empty">
                    {choose({
                      bn: "এই নামে সেবা পাওয়া যায়নি। নাম বা সেবার নম্বর দিয়ে আবার খুঁজুন।",
                      en: "No matching service. Try a different name or service number.",
                    })}
                  </p>
                )}
                <div className="catalog">
                  {tx(
                    matchingServices.map((s) => (
                      <button
                        className={`service ${selectedService === s.service_no ? "selected" : ""}`}
                        key={s.service_no}
                        aria-pressed={selectedService === s.service_no}
                        onClick={() => setSelectedService(s.service_no)}
                      >
                        <span className="service-number">
                          {tx(String(s.service_no).padStart(2, "0"))}
                        </span>
                        <span>
                          <strong>
                            {choose({ bn: s.name_bn, en: s.name_en })}
                          </strong>
                          <em>
                            {tx(
                              operationalServiceNumbers.includes(s.service_no)
                                ? "Working demo"
                                : "Reference preview",
                            )}
                          </em>
                        </span>
                      </button>
                    )),
                  )}
                </div>
                <div className="selected-service-shortcut">
                  <p>
                    <small>
                      {choose({ bn: "বাছাই করা সেবা", en: "Selected service" })}
                    </small>
                    <strong>{choose(schema.title)}</strong>
                  </p>
                  <a
                    className="button secondary"
                    href={
                      canApply && !citizenId
                        ? "#intake-heading"
                        : "#service-form-panel"
                    }
                  >
                    {choose(
                      canApply && !citizenId
                        ? {
                            bn: "আগে নাগরিক বাছাই করুন",
                            en: "Choose citizen first",
                          }
                        : { bn: "ফর্মে যান", en: "Go to form" },
                    )}
                  </a>
                </div>
              </section>
              <section className="panel" id="service-form-panel">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">
                      {t("SERVICE ")}
                      {tx(selectedService)}
                      {t(" · SCHEMA V")}
                      {tx(schema.version)}
                    </span>
                    <h2>{choose(schema.title)}</h2>
                  </div>
                  <span className="status">
                    {tx(operational ? "DEMO ENABLED" : "READ-ONLY EVIDENCE")}
                  </span>
                </div>
                <p className="hint">{tx(schema.evidence.limitation)}</p>
                {tx(
                  operationalServiceNumbers.includes(selectedService) && (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setPreview(!preview)}
                    >
                      {tx(
                        preview
                          ? "Use independent demo form"
                          : "View observed reference fields",
                      )}
                    </button>
                  ),
                )}
                {tx(
                  issues.length > 0 && (
                    <div
                      ref={errorSummary}
                      role="alert"
                      className="error-summary"
                      tabIndex={-1}
                    >
                      <strong>
                        {t("Correct these fields / নিচের ঘরগুলো সংশোধন করুন ")}
                      </strong>
                      <ul>
                        {tx(
                          issues.map((i) => (
                            <li key={i.path}>
                              <button
                                className="text-button"
                                type="button"
                                onClick={() => focusIssue(i.path)}
                              >
                                {fieldLabel(i.path)}: {choose(i.message)}
                              </button>
                            </li>
                          )),
                        )}
                      </ul>
                    </div>
                  ),
                )}
                {!operational || (canApply && citizenId) ? (
                  <div
                    className="application-form"
                    data-testid="service-application-form"
                  >
                    <DynamicForm
                      key={intakeContext}
                      contextKey={intakeContext}
                      schema={
                        operational && orderConfigured
                          ? withoutOrderLanguage(schema)
                          : schema
                      }
                      citizenId={citizenId}
                      value={operational ? payload : {}}
                      onChange={setPayload}
                      issues={issues}
                      disabled={!operational}
                    />
                  </div>
                ) : (
                  <p className="notice" role="status">
                    {t(
                      canApply
                        ? "Choose a citizen above to open this service's application form."
                        : "Your role can view reference fields. Applications are created by citizens or authorized counter staff.",
                    )}
                  </p>
                )}
                {tx(
                  operational && canApply && citizenId && (
                    <>
                      <ApplicationOrder
                        key={intakeContext}
                        context={intakeContext}
                        serviceNo={selectedService}
                        certificateLanguage={payload.delivery_language}
                        officeName={recordName(session.tenant)}
                        address={choose(
                          chosenCitizenAddress(
                            selectedCitizen,
                            payload.address_source,
                          ),
                        )}
                        onLanguageChange={(language) =>
                          setPayload((current) => ({
                            ...current,
                            delivery_language: language,
                          }))
                        }
                        onChange={setIntakeOrder}
                      />
                      <div className="actions">
                        <button
                          disabled={
                            busy ||
                            intakeOrder?.context !== intakeContext ||
                            !intakeOrder.ready
                          }
                          onClick={() =>
                            run(async () => {
                              const result = validateForm(schema, payload);
                              setIssues(result.issues);
                              if (!result.valid) {
                                throw Error(
                                  "Please correct the highlighted fields.",
                                );
                              }
                              if (!citizenId) throw Error("Choose a citizen.");
                              const resultApi = await api(
                                "/applications",
                                "POST",
                                {
                                  citizenId,
                                  serviceNo: selectedService,
                                  payload,
                                  ...(intakeOrder?.order
                                    ? { order: intakeOrder.order }
                                    : {}),
                                },
                              );
                              await refresh();
                              await openApplication(
                                (resultApi.application || resultApi).id,
                              );
                              setPayload({});
                              setIssues([]);
                              setMessage(
                                "Draft saved. Open the draft and submit it when ready.",
                              );
                            })
                          }
                        >
                          {t("Save draft application ")}
                        </button>
                        {localDemo && (
                          <button
                            className="secondary"
                            onClick={() => {
                              setPayload(
                                structuredClone(demoPayloads[selectedService]),
                              );
                              setIssues([]);
                            }}
                          >
                            {t("Fill synthetic example ")}
                          </button>
                        )}
                      </div>
                    </>
                  ),
                )}
              </section>
            </>
          ),
        )}
        {tx(
          page === "citizens" && (
            <>
              {returnToIntake && (
                <section className="panel">
                  <p>
                    {t(
                      "Register this citizen to continue the selected service application.",
                    )}
                  </p>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setReturnToIntake(false);
                      nav("services");
                    }}
                  >
                    {t("Back to application")}
                  </button>
                </section>
              )}
              <section className="panel">
                <h2>{t("নাগরিক তালিকা")}</h2>
                <label htmlFor="citizen-search">
                  {t("Search within your tenant")}
                </label>
                <input
                  id="citizen-search"
                  value={citizenSearch}
                  onChange={(e) => setCitizenSearch(e.target.value)}
                />
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("Citizen")}</th>
                        <th>{t("Identity state")}</th>
                        <th>{t("Record")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tx(
                        citizens
                          .filter((c) =>
                            JSON.stringify(c)
                              .toLowerCase()
                              .includes(citizenQuery.toLowerCase()),
                          )
                          .map((c) => (
                            <tr key={c.id}>
                              <td>
                                {c.nameBn || c.name_bn}
                                <small>{c.nameEn || c.name_en}</small>
                              </td>
                              <td>
                                <span className="status">
                                  {t("SYNTHETIC DEMO")}
                                </span>
                              </td>
                              <td>
                                <code>{tx(c.id.slice(0, 8))}</code>
                              </td>
                            </tr>
                          )),
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
              {tx(
                staff && (
                  <section className="panel">
                    <h2>{t("Register citizen")}</h2>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        run(async () => {
                          if (!citizenGeography.wardCode)
                            throw Error(
                              "Choose your complete administrative area and registration office.",
                            );
                          const created = await api("/citizens", "POST", {
                            ...citizenForm,
                            geography: geographyPayload(citizenGeography),
                            presentAddress: presentAddressPayload(
                              citizenPresentAddress,
                            ),
                          });
                          await refresh();
                          setCitizenPresentAddress(emptyPresentAddress());
                          setCitizenForm({
                            nameBn: "",
                            nameEn: "",
                            dateOfBirth: "",
                            addressBn: "",
                            addressEn: "",
                          });
                          if (returnToIntake) {
                            selectApplicant(created.id, created);
                            setCitizenSearch("");
                            setCitizenQuery("");
                            setReturnToIntake(false);
                            nav("services");
                            setMessage(
                              "Citizen registered and selected. Complete the application below.",
                            );
                          } else {
                            setMessage(
                              "Citizen registered. Duplicate identity keys are rejected.",
                            );
                          }
                        });
                      }}
                    >
                      <div className="form-grid">
                        {tx(
                          Object.entries(citizenForm).map(([key, val]) => (
                            <div className="field" key={key}>
                              <label htmlFor={`citizen-${key}`}>
                                {tx(
                                  {
                                    nameBn: "নাম (বাংলা) / Name (Bangla)",
                                    nameEn: "নাম (ইংরেজি) / Name (English)",
                                    dateOfBirth: "জন্ম তারিখ / Date of birth",
                                    addressBn:
                                      "ঠিকানা (বাংলা) / Address (Bangla)",
                                    addressEn:
                                      "ঠিকানা (ইংরেজি) / Address (English)",
                                  }[key],
                                )}
                              </label>
                              <input
                                type={key === "dateOfBirth" ? "date" : "text"}
                                id={`citizen-${key}`}
                                value={val}
                                required
                                onChange={(e) =>
                                  setCitizenForm({
                                    ...citizenForm,
                                    [key]: e.target.value,
                                  })
                                }
                              />
                            </div>
                          )),
                        )}
                      </div>
                      <GeographyFields
                        prefix="citizen-geo"
                        value={citizenGeography}
                        onChange={setCitizenGeography}
                        required
                        showCoverage
                      />
                      <PresentAddressFields
                        prefix="citizen-present"
                        value={citizenPresentAddress}
                        onChange={setCitizenPresentAddress}
                      />
                      <button disabled={busy}>{t("Register citizen")}</button>
                    </form>
                  </section>
                ),
              )}
            </>
          ),
        )}
        {tx(
          page === "applications" && !detail && (
            <section className="panel">
              <div className="section-heading">
                <h2>{t("আবেদনসমূহ")}</h2>
                {tx(
                  (staff || role === "citizen") && (
                    <button
                      onClick={() => {
                        setSelectedService(45);
                        selectApplicant("");
                        setPayload({});
                        setIssues([]);
                        setPreview(false);
                        nav("services");
                      }}
                    >
                      {t("+ New application ")}
                    </button>
                  ),
                )}
              </div>
              <form
                className="reference-lookup"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    const found = await api(
                      `/applications/lookup?${new URLSearchParams({ reference: applicationReference.trim() })}`,
                    );
                    await openApplication(found.application.id);
                  });
                }}
              >
                <label htmlFor="application-reference">
                  {t("Find application or certificate")}
                </label>
                <div className="reference-lookup-controls">
                  <input
                    id="application-reference"
                    value={applicationReference}
                    onChange={(e) => setApplicationReference(e.target.value)}
                    required
                    maxLength={120}
                    aria-describedby="application-reference-hint"
                    placeholder={t(
                      "Full Astra application ID or certificate number",
                    )}
                  />
                  <button disabled={busy || !applicationReference.trim()}>
                    {t("Find record")}
                  </button>
                </div>
                <p id="application-reference-hint" className="hint">
                  {t(
                    "Use an Astra reference from your account or certificate. Numbers issued by other websites are not supported. Open an issued record to download or renew it.",
                  )}
                </p>
              </form>
              <label htmlFor="application-search">
                {t("Search applications")}
              </label>
              <input
                id="application-search"
                placeholder={t(
                  "Application ID, citizen name or demo reference",
                )}
                value={appSearch}
                onChange={(e) => setAppSearch(e.target.value)}
              />
              <label htmlFor="state-filter">{t("Status filter")}</label>
              <select
                id="state-filter"
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setAppPage(1);
                }}
              >
                <option value="">{t("All states")}</option>
                {tx(
                  [
                    "DRAFT",
                    "SUBMITTED",
                    "UNDER_REVIEW",
                    "CORRECTION_REQUIRED",
                    "RESUBMITTED",
                    "APPROVED",
                    "ISSUED",
                    "REJECTED",
                    "CANCELLED",
                    "REVOKED",
                  ].map((s) => (
                    <option key={s} value={s}>
                      {tx(s)}
                    </option>
                  )),
                )}
              </select>
              <div className="application-filter-tools">
                <p className="hint" role="status">
                  {appTotal.toLocaleString(
                    language === "bn" ? "bn-BD" : "en-GB",
                  )}{" "}
                  {choose({ bn: "টি আবেদন", en: "applications" })}
                </p>
                {(filter || appSearch) && (
                  <button
                    className="secondary"
                    onClick={clearApplicationFilters}
                  >
                    {choose({ bn: "সব ফিল্টার মুছুন", en: "Clear filters" })}
                  </button>
                )}
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t("Application")}</th>
                      <th>{t("Service")}</th>
                      <th>{t("Status")}</th>
                      <th>{t("Open")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tx(
                      applications.map((a) => (
                        <tr key={a.id}>
                          <td>
                            <code>{tx(a.id.slice(0, 8))}</code>
                            <small>
                              {applicationDate(a.createdAt || a.created_at)}
                            </small>
                          </td>
                          <td>
                            {t("#")}
                            {tx(a.serviceNo || a.service_no)}
                            {tx(" ")}
                            {tx(
                              recordName(
                                catalog.find(
                                  (s) =>
                                    s.service_no ===
                                    (a.serviceNo || a.service_no),
                                ),
                              ),
                            )}
                          </td>
                          <td>
                            <span className="status">
                              {tx(a.state || a.status)}
                            </span>
                          </td>
                          <td>
                            <button
                              className="text-button"
                              onClick={() => run(() => openApplication(a.id))}
                            >
                              {t("Open application ")}
                            </button>
                          </td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
                {tx(
                  !applications.length && (
                    <div className="application-empty">
                      <h3>
                        {choose(
                          filter || appSearch
                            ? {
                                bn: "মিলে এমন আবেদন নেই",
                                en: "No matching applications",
                              }
                            : {
                                bn: "এখনও কোনো আবেদন নেই",
                                en: "No applications yet",
                              },
                        )}
                      </h3>
                      <p>
                        {choose(
                          filter || appSearch
                            ? {
                                bn: "অন্য নাম দিয়ে খুঁজুন অথবা ফিল্টার মুছে সব আবেদন দেখুন।",
                                en: "Try another name or clear the filters to see all applications.",
                              }
                            : {
                                bn: "নতুন আবেদন শুরু করলে এখানে সেটির অবস্থা দেখা যাবে।",
                                en: "Applications will appear here with their progress.",
                              },
                        )}
                      </p>
                      {!filter && !appSearch && canApply && (
                        <button onClick={() => nav("services")}>
                          {choose({
                            bn: "প্রথম আবেদন শুরু করুন",
                            en: "Start your first application",
                          })}
                        </button>
                      )}
                    </div>
                  ),
                )}
              </div>
              <div className="pagination">
                <button
                  className="secondary"
                  disabled={busy || appPage <= 1}
                  onClick={() => setAppPage(appPage - 1)}
                >
                  {t("Previous applications ")}
                </button>
                <span>
                  {tx(appTotal)}
                  {t(" results · Page ")}
                  {tx(appPage)}
                  {t(" /")}
                  {tx(" ")}
                  {tx(Math.max(1, Math.ceil(appTotal / appPageSize)))}
                </span>
                <button
                  className="secondary"
                  disabled={busy || appPage * appPageSize >= appTotal}
                  onClick={() => setAppPage(appPage + 1)}
                >
                  {t("Next applications ")}
                </button>
              </div>
              <label htmlFor="application-page-size">
                {t("Applications per page")}
              </label>
              <select
                id="application-page-size"
                value={appPageSize}
                onChange={(e) => {
                  setAppPageSize(Number(e.target.value));
                  setAppPage(1);
                }}
              >
                {tx(
                  [10, 25, 50, 100].map((n) => (
                    <option key={n} value={n}>
                      {tx(n)}
                    </option>
                  )),
                )}
              </select>
            </section>
          ),
        )}
        {tx(
          page === "applications" && detail && (
            <>
              <section className="panel">
                <button className="text-button" onClick={() => setDetail(null)}>
                  {t("← All applications ")}
                </button>
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">
                      {t("APPLICATION ")}
                      {tx(application.id?.slice(0, 8))}
                    </span>
                    <h2>
                      {tx(
                        recordName(
                          catalog.find(
                            (s) =>
                              s.service_no ===
                              (application.serviceNo || application.service_no),
                          ),
                        ) || "Application details",
                      )}
                    </h2>
                  </div>
                  <span className="status">
                    {tx(application.state || application.status)}
                  </span>
                </div>
                {tx(
                  detail.citizen && (
                    <p>
                      {t("Citizen: ")}
                      {detail.citizen.nameBn || detail.citizen.name_bn}
                      {t(" /")}
                      {tx(" ")}
                      {detail.citizen.nameEn || detail.citizen.name_en}
                    </p>
                  ),
                )}
                <ApplicationGuidance
                  state={application.state || application.status}
                  role={role}
                  hasCertificate={
                    !!(detail.certificate || application.certificate)
                  }
                  revoked={
                    application.state === "REVOKED" ||
                    detail.certificate?.status === "REVOKED"
                  }
                  order={detail.order}
                />
                <label htmlFor="application-reference">
                  {t("Full application reference ")}
                </label>
                <input
                  id="application-reference"
                  readOnly
                  value={application.id}
                  onFocus={(e) => e.target.select()}
                />
                <p className="hint">
                  {t(
                    "Use this reference on the public application tracking page. Only status and service information are returned. ",
                  )}
                </p>
                {detail.order && (
                  <>
                    <OrderSummary order={detail.order} />
                    <AsyncPanel
                      key={application.id}
                      fallback={
                        <p role="status">
                          {choose({
                            bn: "পেমেন্টের তথ্য লোড হচ্ছে…",
                            en: "Loading payment details…",
                          })}
                        </p>
                      }
                    >
                      <ApplicationPayment
                        key={application.id}
                        applicationId={application.id}
                        role={role}
                        revision={application.state}
                      />
                    </AsyncPanel>
                    <p className="hint">
                      {choose({
                        bn: "সংরক্ষিত ভাষা, সনদ সংগ্রহের মাধ্যম ও ফি এই আবেদনে অপরিবর্তনীয়। এগুলো বদলাতে নতুন আবেদন শুরু করুন।",
                        en: "The saved language, delivery choice and fees are fixed for this application. Start a new application to change them.",
                      })}
                    </p>
                  </>
                )}
                <DynamicForm
                  key={application.id}
                  contextKey={application.id}
                  schema={(detail.order
                    ? withoutOrderLanguage
                    : (value: ReturnType<typeof getServiceSchema>) => value)(
                    getServiceSchema(
                      application.serviceNo || application.service_no,
                      application.schemaVersion || 1,
                    ),
                  )}
                  citizenId={application.citizenId}
                  value={detailPayload}
                  onChange={(v) => setDetail({ ...detail, payload: v })}
                  disabled={
                    !(
                      (staff || role === "citizen") &&
                      ["DRAFT", "CORRECTION_REQUIRED"].includes(
                        application.state,
                      )
                    )
                  }
                />
                {tx(
                  (staff || role === "citizen") &&
                    ["DRAFT", "CORRECTION_REQUIRED"].includes(
                      application.state,
                    ) && (
                      <button
                        className="secondary"
                        onClick={() =>
                          run(async () => {
                            await api(
                              `/applications/${application.id}`,
                              "PATCH",
                              {
                                payload: detailPayload,
                              },
                            );
                            await openApplication(application.id);
                            setMessage("Changes saved.");
                          })
                        }
                      >
                        {t("Save changes ")}
                      </button>
                    ),
                )}
                <div id="application-actions" tabIndex={-1} />
                <label htmlFor="reason">
                  {t("Review, approval or revocation reason ")}
                </label>
                <textarea
                  id="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t("Explain this decision")}
                />
                <div className="actions">
                  {tx(
                    (staff || role === "citizen") &&
                      ["DRAFT", "SUBMITTED", "CORRECTION_REQUIRED"].includes(
                        application.state,
                      ) && (
                        <button
                          className="danger"
                          disabled={busy}
                          onClick={() => run(() => transition("cancel"))}
                        >
                          {t("Cancel application ")}
                        </button>
                      ),
                  )}
                  {tx(
                    (staff || role === "citizen") &&
                      application.state === "DRAFT" && (
                        <button
                          disabled={busy}
                          onClick={() => run(() => transition("submit"))}
                        >
                          {tx(actionText.submit)}
                        </button>
                      ),
                  )}
                  {tx(
                    reviewer &&
                      ["SUBMITTED", "RESUBMITTED"].includes(
                        application.state,
                      ) && (
                        <button
                          disabled={busy}
                          onClick={() => run(() => transition("review"))}
                        >
                          {tx(actionText.review)}
                        </button>
                      ),
                  )}
                  {tx(
                    reviewer && application.state === "UNDER_REVIEW" && (
                      <button
                        disabled={busy}
                        className="secondary"
                        onClick={() =>
                          run(() => transition("request_correction"))
                        }
                      >
                        {tx(actionText.request_correction)}
                      </button>
                    ),
                  )}
                  {tx(
                    (staff || role === "citizen") &&
                      application.state === "CORRECTION_REQUIRED" && (
                        <button
                          disabled={busy}
                          onClick={() => run(() => transition("resubmit"))}
                        >
                          {tx(actionText.resubmit)}
                        </button>
                      ),
                  )}
                  {tx(
                    approver && application.state === "UNDER_REVIEW" && (
                      <button
                        disabled={busy}
                        onClick={() => run(() => transition("approve"))}
                      >
                        {tx(actionText.approve)}
                      </button>
                    ),
                  )}
                  {tx(
                    (reviewer || approver) &&
                      ["SUBMITTED", "UNDER_REVIEW", "RESUBMITTED"].includes(
                        application.state,
                      ) && (
                        <button
                          className="danger"
                          disabled={busy}
                          onClick={() => run(() => transition("reject"))}
                        >
                          {tx(actionText.reject)}
                        </button>
                      ),
                  )}
                  {tx(
                    approver &&
                      ["APPROVED", "ISSUANCE_PENDING", "ISSUED"].includes(
                        application.state,
                      ) && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              await api(
                                `/applications/${application.id}/issue`,
                                "POST",
                                {},
                              );
                              await openApplication(application.id);
                              await refresh();
                              setMessage(
                                `Certificate issued. ${issueCost} credit${issueCost === 1 ? "" : "s"} debited once; retries return the same certificate.`,
                              );
                            })
                          }
                        >
                          {tx(
                            application.state === "ISSUED"
                              ? "Retry issuance safely"
                              : `Issue demo certificate · ${issueCost} credit${issueCost === 1 ? "" : "s"}`,
                          )}
                        </button>
                      ),
                  )}
                </div>
                {tx(
                  certificatePanel(
                    detail.certificate || application.certificate,
                  ),
                )}
                {tx(
                  detail.renewal && (
                    <p className="notice">
                      {t("Renewal lineage: ")}
                      {tx(JSON.stringify(detail.renewal))}
                    </p>
                  ),
                )}
                {tx(
                  (staff || role === "citizen") &&
                    application.state === "ISSUED" && (
                      <>
                        <ApplicationOrder
                          key={`renew:${application.id}`}
                          context={`renew:${application.id}`}
                          serviceNo={
                            application.serviceNo || application.service_no
                          }
                          certificateLanguage={renewalLanguage}
                          officeName={recordName(session.tenant)}
                          address={choose(
                            chosenCitizenAddress(
                              detail.citizen,
                              detail.payload?.address_source,
                            ),
                          )}
                          onLanguageChange={(language) =>
                            setRenewalLanguageChoice({
                              id: application.id,
                              language,
                            })
                          }
                          onChange={setRenewalOrder}
                        />
                        <button
                          className="secondary"
                          disabled={
                            busy ||
                            renewalOrder?.context !==
                              `renew:${application.id}` ||
                            !renewalOrder.ready
                          }
                          onClick={() =>
                            run(async () => {
                              const renewal = await api(
                                `/applications/${application.id}/renew`,
                                "POST",
                                {
                                  ...(renewalOrder?.order
                                    ? {
                                        order: renewalOrder.order,
                                        payload: {
                                          ...detailPayload,
                                          delivery_language: renewalLanguage,
                                        },
                                      }
                                    : {}),
                                },
                              );
                              await refresh();
                              await openApplication(
                                (renewal.application || renewal).id,
                              );
                              setMessage(
                                "Renewal draft created with linked source certificate.",
                              );
                            })
                          }
                        >
                          {tx(
                            (application.serviceNo ||
                              application.service_no) === 42
                              ? "Start trade license renewal"
                              : "Start renewal application",
                          )}
                        </button>
                      </>
                    ),
                )}
              </section>
              <section className="panel">
                <h2>
                  {choose({ bn: "আবেদনের ইতিহাস", en: "Application history" })}
                </h2>
                <ol className="timeline">
                  {tx(
                    (detail.events || []).map((event: any, i: number) => (
                      <li key={event.id || i}>
                        <strong>
                          {tx(
                            event.action ||
                              event.toState ||
                              event.to_state ||
                              event.event_type,
                          )}
                        </strong>
                        <p>{tx(event.reason || "Recorded action")}</p>
                        <small>
                          {tx(event.createdAt || event.created_at)}
                          {t(" ·")}
                          {tx(" ")}
                          {tx(event.actorId || event.actor_id)}
                        </small>
                      </li>
                    )),
                  )}
                </ol>
                <p className="hint">
                  {t("Payload versions:")}
                  {tx(" ")}
                  {tx(detail.versions?.length ?? "preserved by server")}
                </p>
              </section>
            </>
          ),
        )}
        {tx(
          page === "billing" && (
            <>
              <div className="stats">
                <div className="stat">
                  <span>{t("PREPAID BALANCE")}</span>
                  <strong>
                    {tx(wallet?.balance ?? wallet?.wallet?.balance ?? 0)}
                  </strong>
                  <small>
                    {t("Cost follows your office service settings")}
                  </small>
                </div>
                <div className="stat">
                  <span>{t("PAYMENT ENVIRONMENT")}</span>
                  <strong>{t("Sandbox")}</strong>
                  <small>{t("Engineering fixture prices only")}</small>
                </div>
              </div>
              <section className="panel">
                <h2>{t("Subscription and top-up")}</h2>
                <p>
                  {t(
                    "Local sandbox settlement persists invoices, subscription grants and payment events. Demo prices are configuration fixtures awaiting commercial approval. ",
                  )}
                </p>
                <pre className="compact-json">
                  {tx(JSON.stringify(billing?.subscription, null, 2))}
                </pre>
                <div className="actions">
                  <button
                    onClick={() =>
                      run(async () => {
                        await api("/billing/orders", "POST", {
                          kind: "topup",
                          credits: 10,
                        });
                        setBilling(await api("/billing"));
                        setMessage("Sandbox top-up order created.");
                      })
                    }
                  >
                    {t("Create 10-credit top-up ")}
                  </button>
                  {tx(
                    (billing?.plans || []).map((plan: any) => (
                      <button
                        className="secondary"
                        key={plan.id}
                        onClick={() =>
                          run(async () => {
                            await api("/billing/orders", "POST", {
                              kind: "subscription",
                              planId: plan.id,
                            });
                            setBilling(await api("/billing"));
                            setMessage("Subscription order created.");
                          })
                        }
                      >
                        {t("Renew ")}
                        {tx(plan.name)}
                        {t(" plan ")}
                      </button>
                    )),
                  )}
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("Order")}</th>
                        <th>{t("Kind")}</th>
                        <th>{t("Amount (minor BDT)")}</th>
                        <th>{t("Status / action")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tx(
                        (billing?.orders || []).map((o: any) => (
                          <tr key={o.id}>
                            <td>{tx(o.id.slice(0, 8))}</td>
                            <td>{tx(o.kind)}</td>
                            <td>{tx(o.amountMinor ?? o.amount_minor)}</td>
                            <td>
                              {tx(o.status)}
                              {tx(" ")}
                              {tx(
                                o.status !== "SETTLED" && (
                                  <button
                                    className="text-button"
                                    onClick={() =>
                                      run(async () => {
                                        await api(
                                          `/billing/orders/${o.id}/demo-settle`,
                                          "POST",
                                          {},
                                        );
                                        await refresh();
                                        setMessage(
                                          "Verified sandbox settlement processed. Replay cannot grant credits twice.",
                                        );
                                      })
                                    }
                                  >
                                    {t("Settle in local sandbox ")}
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
              <section className="panel">
                <h2>{t("Credit ledger")}</h2>
                <p>
                  {t(
                    "Government fees have separate accounting and are not charged to this wallet. ",
                  )}
                </p>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("Kind")}</th>
                        <th>{t("Credits")}</th>
                        <th>{t("Reason")}</th>
                        <th>{t("Time")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tx(
                        (wallet?.ledger || []).map((l: any) => (
                          <tr key={l.id}>
                            <td>{tx(l.kind)}</td>
                            <td>{tx(l.delta)}</td>
                            <td>{tx(l.reason)}</td>
                            <td>{tx(l.createdAt || l.created_at)}</td>
                          </tr>
                        )),
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="panel">
                <h2>{t("Invoices")}</h2>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("Invoice")}</th>
                        <th>{t("Amount (minor BDT)")}</th>
                        <th>{t("Payment type")}</th>
                        <th>{t("Invoice copy")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tx(
                        (billing?.invoices || []).map((i: any) => (
                          <tr key={i.id}>
                            <td>{tx(i.number || i.id)}</td>
                            <td>{tx(i.amountMinor ?? i.amount_minor)}</td>
                            <td>{t("SaaS subscription / credits")}</td>
                            <td>
                              <a
                                className="button secondary"
                                target="_blank"
                                rel="noreferrer"
                                href={`/api/v1/invoices/${i.id}/pdf`}
                              >
                                {t("Download invoice PDF ")}
                              </a>
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
        <AsyncPanel
          key={page}
          fallback={<p role="status">{t("Loading workspace…")}</p>}
        >
          {page === "payments" &&
            ["staff", "admin", "finance"].includes(role) && (
              <PaymentsWorkspace role={role} />
            )}
          {tx(page === "admin" && role === "admin" && <AdminWorkspace />)}
          {tx(page === "security" && <AccountSecurity />)}
          {tx(
            [
              "profile",
              "prints",
              "notifications",
              "reports",
              "support",
            ].includes(page) && (
              <AdditionalWorkspace page={page} session={session} />
            ),
          )}
          {tx(page === "owner" && <OwnerOnboarding onSaved={refresh} />)}
        </AsyncPanel>
        {tx(
          page === "owner" && (
            <section className="panel">
              <h2>{t("Tenant credit management")}</h2>
              <p>
                {t(
                  "Owner adjustments require a reason and append a compensating ledger entry. Official approval authority belongs to assigned tenant officials. ",
                )}
              </p>
              {tx(
                tenants.map((officeTenant) => (
                  <div className="tenant-card" key={officeTenant.id}>
                    <h3>{tx(recordName(officeTenant))}</h3>
                    <p>
                      {tx(officeTenant.status)}
                      {t(" · Credits:")}
                      {tx(" ")}
                      {tx(
                        officeTenant.balance ??
                          officeTenant.walletBalance ??
                          "see ledger",
                      )}
                    </p>
                    <button
                      className={
                        officeTenant.status === "ACTIVE"
                          ? "danger"
                          : "secondary"
                      }
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await api(
                            `/owner/tenants/${officeTenant.id}`,
                            "PATCH",
                            {
                              status:
                                officeTenant.status === "ACTIVE"
                                  ? "SUSPENDED"
                                  : "ACTIVE",
                            },
                          );
                          await refresh();
                          setMessage("Tenant status updated.");
                        })
                      }
                    >
                      {tx(
                        officeTenant.status === "ACTIVE"
                          ? "Suspend office"
                          : "Activate office",
                      )}
                    </button>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const data = new FormData(e.currentTarget);
                        run(async () => {
                          await api(
                            `/owner/tenants/${officeTenant.id}/adjust`,
                            "POST",
                            {
                              delta: Number(data.get("delta")),
                              reason: data.get("reason"),
                            },
                          );
                          await refresh();
                          setMessage("Audited compensating entry added.");
                        });
                      }}
                    >
                      <label htmlFor={`delta-${officeTenant.id}`}>
                        {t("Credit adjustment")}
                      </label>
                      <input
                        id={`delta-${officeTenant.id}`}
                        name="delta"
                        type="number"
                        defaultValue={5}
                        required
                      />
                      <label htmlFor={`adjust-reason-${officeTenant.id}`}>
                        {t("Reason")}
                      </label>
                      <input
                        id={`adjust-reason-${officeTenant.id}`}
                        name="reason"
                        required
                        minLength={5}
                        defaultValue="Demo support adjustment"
                      />
                      <button>{t("Record adjustment")}</button>
                    </form>
                  </div>
                )),
              )}
            </section>
          ),
        )}
        <footer>
          {t(
            "Astra · Independently authored software · Independent demonstration · Reference evidence is limited to initial forms. ",
          )}
        </footer>
      </main>
    </div>
  );
}
