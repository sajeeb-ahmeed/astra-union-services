import {
  t,
  tx,
  choose,
  recordName,
  useLanguage,
  LanguageSwitcher,
} from "./i18n.js";
import React, { lazy, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  operationalServiceNumbers,
  getServiceSchema,
} from "@astra/shared-schemas";
import { api, items } from "./api.js";
import emblem from "./assets/brand/emblem.webp";
import { AsyncPanel } from "./AsyncPanel.js";
import { DynamicForm } from "./DynamicForm.js";
import {
  PresentAddressFields,
  chosenCitizenAddress,
  emptyPresentAddress,
  presentAddressPayload,
} from "./PresentAddressFields.js";
import {
  CitizenDetailsEditor,
  CitizenDetailsFields,
  citizenDetailsPayload,
  emptyCitizenDetails,
} from "./CitizenDetailsFields.js";
import { ProfileCompleteness } from "./ProfileCompleteness.js";
import { WorkspaceWelcome } from "./WorkspaceWelcome.js";
import { withoutOrderLanguage } from "./order-schema.js";
import { ServiceFlow } from "./ServiceFlow.js";
import { WorkspaceDashboard } from "./WorkspaceDashboard.js";
import { SidebarNav } from "./ui/SidebarNav.js";
import { EmptyState, SkeletonRows } from "./ui/kit.js";
import { udcNavigation, usesUdcNavigation } from "./workspace-navigation.js";
import { ApplicationGuidance } from "./ApplicationGuidance.js";
import "./workspace-usability.css";
import "./du-workspace.css";
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
// UIUX-FIX-01 #15: owner-only and finance-only panels are lazy chunks, so
// citizens/chairmen never download platform-management or finance code.
const OwnerOperations = lazy(() =>
  import("./OwnerOperations.js").then((m) => ({ default: m.OwnerOperations })),
);
const OwnerAccountRequests = lazy(() =>
  import("./OwnerAccountRequests.js").then((m) => ({
    default: m.OwnerAccountRequests,
  })),
);
const OwnerRecharges = lazy(() =>
  import("./Recharge.js").then((m) => ({ default: m.OwnerRecharges })),
);
const RechargeRequests = lazy(() =>
  import("./Recharge.js").then((m) => ({ default: m.RechargeRequests })),
);
const OwnerInclusionRequests = lazy(() =>
  import("./OfficeInclusion.js").then((m) => ({
    default: m.OwnerInclusionRequests,
  })),
);
const OwnerWitnessTypes = lazy(() =>
  import("./WitnessGenerator.js").then((m) => ({
    default: m.OwnerWitnessTypes,
  })),
);
const PointsWallet = lazy(() =>
  import("./PointsWallet.js").then((m) => ({ default: m.PointsWallet })),
);
const OwnerPointPrices = lazy(() =>
  import("./PointsWallet.js").then((m) => ({ default: m.OwnerPointPrices })),
);
const OwnerPointsPanel = lazy(() =>
  import("./PointsWallet.js").then((m) => ({ default: m.OwnerPointsPanel })),
);
const OfficeRefunds = lazy(() =>
  import("./Refunds.js").then((m) => ({ default: m.OfficeRefunds })),
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
  request_correction: "Request correction",
  resubmit: "Resubmit application",
  approve: "Approve and issue certificate",
  reject: "Reject application",
  cancel: "Cancel application",
  summon: "Ask the applicant to come",
};
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
  // Phone layout (<=767px): card lists replace the wide tables; rendered conditionally so the
  // table data is never duplicated in the DOM on larger screens.
  const phoneLayout = useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia("(max-width: 767px)");
      mq.addEventListener("change", notify);
      return () => mq.removeEventListener("change", notify);
    },
    () => window.matchMedia("(max-width: 767px)").matches,
    () => false,
  );
  const [page, setPage] = useState("home"),
    [message, setMessage] = useState(""),
    [errorMessage, setErrorMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [catalog, setCatalog] = useState<any[]>([]),
    [citizens, setCitizens] = useState<any[]>([]),
    [citizenTotal, setCitizenTotal] = useState<number | null>(null),
    [applications, setApplications] = useState<any[]>([]),
    [wallet, setWallet] = useState<any>(null),
    [billing, setBilling] = useState<any>(null),
    [tenants, setTenants] = useState<any[]>([]);
  // Phase 1 slice (iii), approved: dashboard tiles open the guided application flow.
  const [flowService, setFlowService] = useState<number | null>(null);
  const [flowCitizen, setFlowCitizen] = useState<any>(null);
  const [returnToFlow, setReturnToFlow] = useState(false);
  const [selectedService, setSelectedService] = useState(45),
    [returnToIntake, setReturnToIntake] = useState(false),
    [detail, setDetail] = useState<any>(null),
    [reason, setReason] = useState(""),
    [filter, setFilter] = useState(""),
    [search, setSearch] = useState("");
  const [appSearch, setAppSearch] = useState(""),
    [appQuery, setAppQuery] = useState(""),
    [appPage, setAppPage] = useState(1),
    [appPageSize, setAppPageSize] = useState(25),
    [appTotal, setAppTotal] = useState(0);
  // Phase 6c: date range and renewals-only filters for the applications list.
  const [appFrom, setAppFrom] = useState(""),
    [appTo, setAppTo] = useState(""),
    [appRenewals, setAppRenewals] = useState(false);
  const [applicationReference, setApplicationReference] = useState("");
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
  const [citizenDetails, setCitizenDetails] = useState(emptyCitizenDetails);
  // Phase 3a: the citizen whose details panel is open on the citizens page.
  const [detailsCitizenId, setDetailsCitizenId] = useState("");
  useEffect(() => {
    setCitizenGeography(readGeography(session?.tenant));
  }, [session?.tenant?.id]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    setErrorMessage("");
    try {
      await fn();
    } catch (e) {
      setErrorMessage((e as Error).message);
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
            `/applications?${new URLSearchParams({ ...(filter ? { state: filter } : {}), q: appQuery, page: String(appPage), pageSize: String(appPageSize), ...(appFrom ? { from: appFrom } : {}), ...(appTo ? { to: appTo } : {}), ...(appRenewals ? { renewal: "true" } : {}) })}`,
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
    setCitizenTotal(citizenResult.total ?? items(citizenResult).length);
    setApplications(items(applicationResult));
    setAppTotal(applicationResult.total ?? items(applicationResult).length);
    setWallet(walletResult);
    setBilling(billingResult);
    setTenants(items(tenantResult));
  }
  useEffect(() => {
    if (session) run(refresh);
  }, [session, filter, appQuery, appPage, appPageSize, citizenQuery, appFrom, appTo, appRenewals]);
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
  const role = session?.user?.role || "",
    staff = ["staff", "admin"].includes(role),
    approver = role === "approver",
    finance = ["finance", "admin"].includes(role);
  const canApply = staff || role === "citizen";
  // Phase 1 slice (ii), approved: staff get the UDC sidebar; staff and office admins get the dashboard home.
  const udcPreview = usesUdcNavigation(role);
  const dashboardHome = staff;
  const udcCurrent =
    page === "home"
      ? "dashboard"
      : page === "services" || page === "flow"
        ? "new-application"
        : page === "prints"
          ? "print-certificate"
          : page === "applications" && filter === "ISSUED"
            ? "renewal"
            : page;
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
  const issueCost = detail?.serviceConfiguration?.creditCost ?? 1;
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
    setReturnToFlow(false);
    setPage(next);
    setDetail(null);
    setMessage("");
    setErrorMessage("");
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
          <span className="eyebrow">
            {choose({ bn: "সনদ", en: "CERTIFICATE" })}
          </span>
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
          {cert.verificationUrl ? (
            <a
              className="button secondary"
              href={cert.verificationUrl}
              target="_blank"
              rel="noreferrer"
            >
              {t("QR verification ")}
            </a>
          ) : (
            // The verify token is not stored (migration 017); the link exists only on the PDF.
            <span className="hint">
              {t(
                "যাচাই লিংক সনদের PDF-এ QR কোড হিসেবে আছে। / The verification link is on the certificate PDF as a QR code.",
              )}
            </span>
          )}
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
          <img
            className="brand-emblem"
            src={emblem}
            alt=""
            width={38}
            height={38}
          />
          <span>
            DigitalUnion
            <small>
              {choose({
                bn: "স্মার্ট ইউনিয়ন, স্মার্ট বাংলাদেশ",
                en: "Smart Union, Smart Bangladesh",
              })}
            </small>
          </span>
        </a>
        <p className="office">
          {tx(recordName(session.tenant) || "Platform owner")}
          <small>
            {tx(
              session.tenant ? "Office workspace" : "Union services platform",
            )}
          </small>
        </p>
        <div className="workspace-jump">
          <label htmlFor="workspace-jump">
            {choose({ bn: "কোথায় যেতে চান?", en: "Go to a page" })}
          </label>
          {udcPreview ? (
            <select
              id="workspace-jump"
              value={
                udcNavigation.find((i) => i.key === udcCurrent && !i.state && i.page)?.page ?? udcCurrent
              }
              onChange={(event) => {
                // Options use the page name (shared with the legacy picker); filtered items use their key.
                const item = udcNavigation.find(
                  (i) => (i.state ? i.key : (i.page ?? i.key)) === event.target.value,
                );
                if (item?.href) location.assign(item.href);
                else if (item?.page === "applications") openTask("applications", item.state ?? "");
                else if (item?.page) nav(item.page);
              }}
            >
              {udcNavigation
                .filter((item) => !item.soon)
                .map((item) => (
                  <option key={item.key} value={item.state ? item.key : (item.page ?? item.key)}>
                    {choose(item)}
                  </option>
                ))}
            </select>
          ) : (
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
          )}
        </div>
        {udcPreview ? (
          <SidebarNav
            items={udcNavigation}
            current={udcCurrent}
            label={t("Workspace navigation")}
            onSelect={(item) => {
              if (item.page === "applications") openTask("applications", item.state ?? "");
              else if (item.page) nav(item.page);
            }}
          />
        ) : (
        <nav aria-label={t("Workspace navigation")}>
          {tx(
            visiblePages.map((p) => (
              <button
                key={p}
                data-page={p}
                aria-current={page === p ? "page" : undefined}
                onClick={() => nav(p)}
              >
                <span>{choose({ bn: localized[p], en: labels[p] })}</span>
              </button>
            )),
          )}
        </nav>
        )}
        <div className="sidebar-bottom">
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
                setReturnToIntake(false);
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
      <main id="content" aria-busy={busy || undefined}>
        <header>
          <div>
            <span className="eyebrow">
              {t("DIGITALUNION · UNION SERVICES")}
            </span>
            <h1>
              {dashboardHome && page === "home"
                ? choose({ bn: "ড্যাশবোর্ড", en: "Dashboard" })
                : page === "flow"
                ? choose({ bn: "নতুন আবেদন", en: "New application" })
                : choose({ bn: localized[page], en: labels[page] })}
            </h1>
          </div>
          <div className="workspace-header-actions">
            <LanguageSwitcher />
          </div>
        </header>
        {tx(
          message && (
            <div role="status" className="notice message success">
              {tx(message)}
            </div>
          ),
        )}
        {tx(
          errorMessage && (
            <div role="alert" className="notice message error">
              {tx(errorMessage)}
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
        {page === "flow" && flowService !== null && (
          <ServiceFlow
            key={`${flowService}:${flowCitizen?.id ?? ""}`}
            serviceNo={flowService}
            initialCitizen={flowCitizen}
            tenant={session.tenant}
            onOpenApplication={(id) => void run(() => openApplication(id))}
            onRegisterCitizen={() => {
              nav("citizens");
              setReturnToIntake(true);
              setReturnToFlow(true);
            }}
            onExit={() => nav("home")}
            onChanged={() => void refresh()}
          />
        )}
        {page === "home" && dashboardHome && (
          <WorkspaceDashboard
            services={catalog}
            citizenTotal={citizenTotal}
            applicationTotal={appTotal}
            creditBalance={wallet?.balance ?? null}
            onStartService={(serviceNo) => {
              setSelectedService(serviceNo);
              setFlowService(serviceNo);
              setFlowCitizen(null);
              nav("flow");
            }}
            onOpenCitizens={() => nav("citizens")}
            onOpenApplications={() => openTask("applications")}
          />
        )}
        {page === "home" && dashboardHome && (
          <WorkspaceWelcome role={role} navigate={openTask} />
        )}
        {page === "home" && !dashboardHome && (
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
          </>
        )}
        {tx(
          page === "services" && (
            <>
              <section className="panel" id="service-choice">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">{t("NEW APPLICATION")}</span>
                    <h2 id="intake-heading">
                      {choose({
                        bn: "সেবা বাছাই করুন",
                        en: "Choose a service",
                      })}
                    </h2>
                  </div>
                  {staff && canApply && (
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
                  {choose({
                    bn: "সেবা বাছাই করলেই নির্দেশিত আবেদন শুরু হবে: নাগরিক, ফর্ম, ফি ও সরবরাহ, তারপর যাচাই করে জমা।",
                    en: "Choose a service to start the guided application: citizen, form, fees and delivery, then review and submit.",
                  })}
                </p>
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
                    {choose({ bn: "টি সেবা পাওয়া গেছে", en: "services found" })}
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
                  <EmptyState
                    title={choose({
                      bn: "এই নামে সেবা পাওয়া যায়নি।",
                      en: "No matching service.",
                    })}
                    hint={choose({
                      bn: "নাম বা সেবার নম্বর দিয়ে আবার খুঁজুন।",
                      en: "Try a different name or service number.",
                    })}
                  />
                )}
                <div className="catalog">
                  {tx(
                    matchingServices.map((s) => (
                      <button
                        className="service"
                        key={s.service_no}
                        disabled={!canApply}
                        onClick={() => {
                          setSelectedService(s.service_no);
                          setFlowService(s.service_no);
                          nav("flow");
                        }}
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
                                ? "Available"
                                : "Reference",
                            )}
                          </em>
                        </span>
                      </button>
                    )),
                  )}
                </div>
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
                      nav(returnToFlow ? "flow" : "services");
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
                <div className="table-wrap responsive-table">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("Citizen")}</th>
                        <th>{t("Identity state")}</th>
                        <th>{t("Record")}</th>
                        <th>{t("Details")}</th>
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
                                  {choose({
                                    bn: "নিবন্ধিত",
                                    en: "Registered",
                                  })}
                                </span>
                              </td>
                              <td>
                                <code>{tx(c.id.slice(0, 8))}</code>
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="secondary"
                                  aria-label={`${t("Details")}: ${c.nameEn || c.name_en}`}
                                  aria-expanded={detailsCitizenId === c.id}
                                  onClick={() =>
                                    setDetailsCitizenId(
                                      detailsCitizenId === c.id ? "" : c.id,
                                    )
                                  }
                                >
                                  {t("Details")}
                                </button>
                              </td>
                            </tr>
                          )),
                      )}
                    </tbody>
                  </table>
                </div>
                {busy && !citizens.length && <SkeletonRows rows={5} />}
                {phoneLayout && (
                  <div className="ax-card-list">
                  {tx(
                    citizens.map((c) => (
                      <article className="ax-card" key={c.id}>
                        <div className="ax-card-head">
                          <strong>{c.nameBn || c.name_bn}</strong>
                          <span className="status">
                            {choose({ bn: "নিবন্ধিত", en: "Registered" })}
                          </span>
                        </div>
                        <small>{c.nameEn || c.name_en}</small>
                        <code>{tx(c.id.slice(0, 8))}</code>
                        <button
                          type="button"
                          className="secondary"
                          aria-label={`${t("Details")}: ${c.nameEn || c.name_en}`}
                          aria-expanded={detailsCitizenId === c.id}
                          onClick={() =>
                            setDetailsCitizenId(
                              detailsCitizenId === c.id ? "" : c.id,
                            )
                          }
                        >
                          {t("Details")}
                        </button>
                      </article>
                    )),
                  )}
                </div>
                )}
              </section>
              {(() => {
                const open = citizens.find((c) => c.id === detailsCitizenId);
                return open ? (
                  <CitizenDetailsEditor
                    citizen={open}
                    canEdit={staff || role === "citizen"}
                    geographyRequired={!!session?.tenant?.divisionCode}
                    onClose={() => setDetailsCitizenId("")}
                    onSaved={(updated) =>
                      setCitizens((list) =>
                        list.map((c) => (c.id === updated.id ? updated : c)),
                      )
                    }
                  />
                ) : null;
              })()}
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
                            details: citizenDetailsPayload(citizenDetails),
                          });
                          await refresh();
                          setCitizenPresentAddress(emptyPresentAddress());
                          setCitizenDetails(emptyCitizenDetails());
                          setCitizenForm({
                            nameBn: "",
                            nameEn: "",
                            dateOfBirth: "",
                            addressBn: "",
                            addressEn: "",
                          });
                          if (returnToIntake && returnToFlow) {
                            // Back into the guided flow with the new citizen already chosen.
                            setFlowCitizen(created);
                            setCitizenSearch("");
                            setCitizenQuery("");
                            nav("flow");
                            setMessage(
                              "Citizen registered and selected. Complete the application below.",
                            );
                          } else if (returnToIntake) {
                            // One application flow: the new citizen is remembered
                            // and pre-selected when a service is launched.
                            setFlowCitizen(created);
                            setCitizenSearch("");
                            setCitizenQuery("");
                            setReturnToIntake(false);
                            nav("services");
                            setMessage(
                              choose({
                                bn: "নাগরিক নিবন্ধিত হয়েছে। এখন সেবা বাছাই করুন।",
                                en: "Citizen registered. Now choose a service.",
                              }),
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
                      <CitizenDetailsFields
                        prefix="citizen-details"
                        value={citizenDetails}
                        onChange={setCitizenDetails}
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
                      onClick={() => nav("services")}
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
                      "Full DigitalUnion application ID or certificate number",
                    )}
                  />
                  <button disabled={busy || !applicationReference.trim()}>
                    {t("Find record")}
                  </button>
                </div>
                <p id="application-reference-hint" className="hint">
                  {t(
                    "Use a DigitalUnion reference from your account or certificate. Numbers issued by other websites are not supported. Open an issued record to download or renew it.",
                  )}
                </p>
              </form>
              <label htmlFor="application-search">
                {t("Search applications")}
              </label>
              <input
                id="application-search"
                placeholder={t(
                  "Application ID, citizen name or reference",
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
              <div className="form-grid date-range">
                <div className="field">
                  <label htmlFor="application-from">{choose({ bn: "যে তারিখ থেকে", en: "From date" })}</label>
                  <input
                    id="application-from"
                    type="date"
                    value={appFrom}
                    max={appTo || undefined}
                    onChange={(e) => {
                      setAppFrom(e.target.value);
                      setAppPage(1);
                    }}
                  />
                </div>
                <div className="field">
                  <label htmlFor="application-to">{choose({ bn: "যে তারিখ পর্যন্ত", en: "To date" })}</label>
                  <input
                    id="application-to"
                    type="date"
                    value={appTo}
                    min={appFrom || undefined}
                    onChange={(e) => {
                      setAppTo(e.target.value);
                      setAppPage(1);
                    }}
                  />
                </div>
                <div className="check-field">
                  <label htmlFor="application-renewals">
                    <input
                      id="application-renewals"
                      type="checkbox"
                      checked={appRenewals}
                      onChange={(e) => {
                        setAppRenewals(e.target.checked);
                        setAppPage(1);
                      }}
                    />
                    <span>{choose({ bn: "শুধু নবায়নের আবেদন", en: "Renewals only" })}</span>
                  </label>
                </div>
              </div>
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
              <div className="table-wrap responsive-table">
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
              </div>
              {tx(busy && !applications.length && <SkeletonRows rows={5} />)}
              {tx(
                !busy && !applications.length && (
                  <EmptyState
                    title={choose(
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
                    hint={choose(
                      filter || appSearch
                        ? {
                            bn: "অন্য নাম দিয়ে খুঁজুন অথবা ফিল্টার মুছে সব আবেদন দেখুন।",
                            en: "Try another name or clear the filters to see all applications.",
                          }
                        : {
                            bn: "নতুন আবেদন শুরু করলে এখানে সেটির অবস্থা দেখা যাবে।",
                            en: "Applications will appear here with their progress.",
                          },
                    )}
                    action={
                      !filter && !appSearch && canApply ? (
                        <button onClick={() => nav("services")}>
                          {choose({
                            bn: "প্রথম আবেদন শুরু করুন",
                            en: "Start your first application",
                          })}
                        </button>
                      ) : undefined
                    }
                  />
                ),
              )}
              {phoneLayout && (
                <div className="ax-card-list">
                {tx(
                  applications.map((a) => (
                    <article className="ax-card" key={a.id}>
                      <div className="ax-card-head">
                        <code>{tx(a.id.slice(0, 8))}</code>
                        <span className="status">{tx(a.state || a.status)}</span>
                      </div>
                      <strong>
                        {t("#")}
                        {tx(a.serviceNo || a.service_no)}
                        {tx(" ")}
                        {tx(
                          recordName(
                            catalog.find(
                              (svc) =>
                                svc.service_no ===
                                (a.serviceNo || a.service_no),
                            ),
                          ),
                        )}
                      </strong>
                      <small>
                        {applicationDate(a.createdAt || a.created_at)}
                      </small>
                      <button
                        className="text-button"
                        onClick={() => run(() => openApplication(a.id))}
                      >
                        {t("Open application ")}
                      </button>
                    </article>
                  )),
                )}
              </div>
              )}
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
                {(() => {
                  // Phase 6a/W: the latest summons, while the Chairman's decision is still pending.
                  const summons = [...(detail.events || [])]
                    .reverse()
                    .find((e: any) => e.action === "summon");
                  return summons &&
                    ["SUBMITTED", "RESUBMITTED", "UNDER_REVIEW"].includes(
                      application.state,
                    ) ? (
                    <p className="notice summon-notice" role="status">
                      <strong>
                        {choose({
                          bn: "চেয়ারম্যান আবেদনকারীকে আসতে বলেছেন",
                          en: "The Chairman has asked the applicant to come",
                        })}
                        :
                      </strong>{" "}
                      {summons.reason}
                    </p>
                  ) : null;
                })()}
                {["APPROVED", "ISSUED"].includes(application.state) && (
                  <p className="hint wet-sign-notice">
                    {choose({
                      bn: "সনদ প্রিন্ট করার পরে চেয়ারম্যান নিজ হাতে স্বাক্ষর করবেন।",
                      en: "After the certificate is printed, the Chairman signs it by hand.",
                    })}
                  </p>
                )}
                {detail.profileCompleteness &&
                  role !== "citizen" &&
                  !detail.certificate &&
                  !["ISSUED", "REVOKED", "REJECTED", "CANCELLED"].includes(
                    application.state,
                  ) && (
                    <ProfileCompleteness
                      completeness={detail.profileCompleteness}
                      enforced={detail.profileCompleteness.enforced}
                      context="application"
                    />
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
                  {t("Decision or revocation reason ")}
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
                    approver &&
                      ["SUBMITTED", "RESUBMITTED"].includes(
                        application.state,
                      ) && (
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
                    approver &&
                      ["SUBMITTED", "RESUBMITTED"].includes(
                        application.state,
                      ) && (
                        <button
                          disabled={busy}
                          onClick={() => run(() => transition("approve"))}
                        >
                          {tx(actionText.approve)}
                        </button>
                      ),
                  )}
                  {tx(
                    approver &&
                      ["SUBMITTED", "RESUBMITTED"].includes(
                        application.state,
                      ) && (
                        <button
                          disabled={busy}
                          className="secondary"
                          onClick={() => run(() => transition("summon"))}
                        >
                          {tx(actionText.summon)}
                        </button>
                      ),
                  )}
                  {tx(
                    approver &&
                      ["SUBMITTED", "RESUBMITTED"].includes(
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
                              : `Issue certificate · ${issueCost} credit${issueCost === 1 ? "" : "s"}`,
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
              <PointsWallet>
                <RechargeRequests />
              </PointsWallet>
              <OfficeRefunds />
              <section className="panel">
                <h2>{t("Subscription and top-up")}</h2>
                {billing?.subscription ? (
                  <dl className="billing-summary">
                    <div>
                      <dt>{choose({ bn: "পরিকল্পনা", en: "Plan" })}</dt>
                      <dd>
                        {tx(
                          (billing?.plans || []).find(
                            (plan: any) =>
                              plan.id === billing.subscription.planId,
                          )?.name || "—",
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("Status")}</dt>
                      <dd>{tx(billing.subscription.status || "—")}</dd>
                    </div>
                    <div>
                      <dt>
                        {choose({ bn: "ক্রেডিট ব্যালান্স", en: "Credit balance" })}
                      </dt>
                      <dd>
                        {tx(wallet?.balance ?? wallet?.wallet?.balance ?? 0)}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p className="hint">
                    {choose({
                      bn: "কোনো সক্রিয় সাবস্ক্রিপশন নেই",
                      en: "No active subscription",
                    })}
                  </p>
                )}
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
                                o.status !== "SETTLED" &&
                                  billing?.demoSettleEnabled && (
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
                                    {t("Settle payment")}
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
          {tx(page === "owner" && <OwnerOperations />)}
          {tx(page === "owner" && <OwnerOnboarding onSaved={refresh} />)}
          {tx(page === "owner" && <OwnerAccountRequests />)}
          {tx(page === "owner" && <OwnerPointPrices />)}
          {tx(page === "owner" && <OwnerRecharges />)}
          {tx(page === "owner" && <OwnerInclusionRequests />)}
          {tx(page === "owner" && <OwnerWitnessTypes />)}
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
                        defaultValue=""
                      />
                      <button>{t("Record adjustment")}</button>
                    </form>
                    <OwnerPointsPanel tenantId={officeTenant.id} />
                  </div>
                )),
              )}
            </section>
          ),
        )}
        <footer>
          {t("DigitalUnion · Smart Union, Smart Bangladesh")}
        </footer>
      </main>
    </div>
  );
}
