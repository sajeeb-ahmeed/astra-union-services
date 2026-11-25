import {
  t,
  tx,
  choose,
  recordName,
  useLanguage,
  LanguageSwitcher,
} from "./i18n.js";
import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  operationalServiceNumbers,
  getServiceSchema,
} from "@astra/shared-schemas";
import { api, clearSessionToken, items } from "./api.js";
import { useBranding } from "./branding.js";
import { GlobalNoticeBanner } from "./GlobalNotices.js";
import emblem from "./assets/brand/emblem.webp";
import { AsyncPanel, lazyWithRetry } from "./AsyncPanel.js";
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
import { ServiceFlow, PayloadDetails } from "./ServiceFlow.js";
import { WorkspaceDashboard } from "./WorkspaceDashboard.js";
import { SidebarNav } from "./ui/SidebarNav.js";
import {
  ApplicationStatus,
  APPLICATION_STATES,
  applicationStatusLabel,
  applicationStatusMeta,
  normalizeApplicationState,
  ledgerKindMeta,
  ledgerReasonText,
  planNameText,
  EmptyState,
  RefChip,
  ServiceCard,
  SkeletonRows,
  StatCard,
  Stepper,
} from "./ui/kit.js";
import { formatDate, formatDateTime, localDigits } from "./ui/fmt.js";
import { BrandLockup } from "./BrandLockup.js";
import { NavIcon } from "./ui/nav-icons.js";
import { udcNavigation, usesUdcNavigation } from "./workspace-navigation.js";
import { ApplicationGuidance } from "./ApplicationGuidance.js";
import "./workspace-usability.css";
import "./du-workspace.css";
import "./owner-console.css";
import { StatusBadge, statusTone } from "./OwnerUi.js";
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
const AdminWorkspace = lazyWithRetry(() => import("./AdminWorkspace.js"), (m) => m.AdminWorkspace);
// UIUX-FIX-01 #15: owner-only and finance-only panels are lazy chunks, so
// citizens/chairmen never download platform-management or finance code.
const OwnerOperations = lazyWithRetry(() => import("./OwnerOperations.js"), (m) => m.OwnerOperations);
const OwnerAccountRequests = lazyWithRetry(() => import("./OwnerAccountRequests.js"), (m) => m.OwnerAccountRequests);
const OwnerRecharges = lazyWithRetry(() => import("./Recharge.js"), (m) => m.OwnerRecharges);
const RechargeRequests = lazyWithRetry(() => import("./Recharge.js"), (m) => m.RechargeRequests);
const OwnerInclusionRequests = lazyWithRetry(() => import("./OfficeInclusion.js"), (m) => m.OwnerInclusionRequests);
const OwnerWitnessTypes = lazyWithRetry(() => import("./WitnessGenerator.js"), (m) => m.OwnerWitnessTypes);
const PointsWallet = lazyWithRetry(() => import("./PointsWallet.js"), (m) => m.PointsWallet);
const OwnerPricing = lazyWithRetry(() => import("./OwnerPricing.js"), (m) => m.OwnerPricing);
const OwnerPlans = lazyWithRetry(() => import("./OwnerPlans.js"), (m) => m.OwnerPlans);
const OwnerBranding = lazyWithRetry(() => import("./OwnerBranding.js"), (m) => m.OwnerBranding);
const OwnerAudit = lazyWithRetry(() => import("./OwnerAudit.js"), (m) => m.OwnerAudit);
const OwnerCoupons = lazyWithRetry(() => import("./OwnerCoupons.js"), (m) => m.OwnerCoupons);
const OwnerNotices = lazyWithRetry(() => import("./OwnerNotices.js"), (m) => m.OwnerNotices);
const OwnerDemand = lazyWithRetry(() => import("./OwnerDemand.js"), (m) => m.OwnerDemand);
const OwnerPointsPanel = lazyWithRetry(() => import("./PointsWallet.js"), (m) => m.OwnerPointsPanel);
const OwnerSubscriptionPanel = lazyWithRetry(() => import("./OwnerSubscriptions.js"), (m) => m.OwnerSubscriptionPanel);
const OwnerPendingOrders = lazyWithRetry(() => import("./OwnerSubscriptions.js"), (m) => m.OwnerPendingOrders);
const OfficeRefunds = lazyWithRetry(() => import("./Refunds.js"), (m) => m.OfficeRefunds);
const NotificationHealthCard = lazyWithRetry(() => import("./NotificationHealth.js"), (m) => m.NotificationHealthCard);
const AccountSecurity = lazyWithRetry(() => import("./AdminWorkspace.js"), (m) => m.AccountSecurity);
const OwnerOnboarding = lazyWithRetry(() => import("./AdminWorkspace.js"), (m) => m.OwnerOnboarding);
const AdditionalWorkspace = lazyWithRetry(() => import("./AdditionalWorkspace.js"), (m) => m.AdditionalWorkspace);
const UserGuide = lazyWithRetry(() => import("./UserGuide.js"), (m) => m.UserGuide);
const ApplicationPayment = lazyWithRetry(() => import("./OnlinePayments.js"), (m) => m.ApplicationPayment);
const PaymentsWorkspace = lazyWithRetry(() => import("./OnlinePayments.js"), (m) => m.PaymentsWorkspace);
// W-009: one idempotency key per intended wallet adjustment, keyed by
// tenant. The adjust form lives inside a tenants.map, so it cannot hold
// per-form state; the key is minted on first submit, reused on retry (a
// lost response replays instead of applying twice), and rotated only
// after a successful apply. A rejected attempt consumes no key, so the
// same key stays valid for a corrected resubmit.
const walletAdjustKeys = new Map<string, string>();
function walletAdjustKey(tenantId: string): string {
  let key = walletAdjustKeys.get(tenantId);
  if (!key) {
    key = crypto.randomUUID();
    walletAdjustKeys.set(tenantId, key);
  }
  return key;
}
const labels: Record<string, string> = {
  home: "Overview",
  services: "Service catalog",
  citizens: "Citizens",
  applications: "Applications",
  pending: "Pending applications",
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
  guide: "User guide",
};
const localized: Record<string, string> = {
  home: "সেবার সারসংক্ষেপ",
  services: "সেবার তালিকা",
  citizens: "নাগরিক",
  applications: "আবেদন",
  pending: "অপেক্ষমাণ আবেদন",
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
  guide: "ব্যবহার নির্দেশিকা",
};
/** FULL-UIUX-01 (P2-20): the H1 always equals the nav label — the staff
    dashboard is the one deliberate exception, labelled ড্যাশবোর্ড in both. */
const pageTitles: Record<string, { bn: string; en: string }> = Object.fromEntries(
  Object.keys(labels).map((key) => [
    key,
    { bn: localized[key], en: labels[key] },
  ]),
);
/** Sidebar groups (programme 3): main work, office, account. */
const NAV_GROUPS: { title: { bn: string; en: string }; pages: string[] }[] = [
  {
    title: { bn: "প্রধান", en: "Main" },
    pages: ["home", "services", "applications", "pending"],
  },
  {
    title: { bn: "অফিস", en: "Office" },
    pages: ["citizens", "prints", "payments", "billing", "reports", "admin"],
  },
  {
    title: { bn: "অ্যাকাউন্ট", en: "Account" },
    pages: ["profile", "notifications", "security", "guide", "support", "owner"],
  },
];
const actionText: Record<string, string> = {
  submit: "Submit application",
  request_correction: "Request correction",
  resubmit: "Resubmit application",
  approve: "Approve and issue certificate",
  reject: "Reject application",
  cancel: "Cancel application",
  summon: "Ask the applicant to come",
};
/** FULL-UIUX-01: transition confirmations in the reader's language —
    the banner is a full sentence, never an English fragment. */
const actionDone: Record<string, { bn: string; en: string }> = {
  submit: { bn: "আবেদন জমা দেওয়া হয়েছে।", en: "Application submitted." },
  request_correction: {
    bn: "সংশোধনের অনুরোধ পাঠানো হয়েছে।",
    en: "Correction requested.",
  },
  resubmit: { bn: "আবেদন আবার জমা দেওয়া হয়েছে।", en: "Application resubmitted." },
  approve: {
    bn: "অনুমোদন সম্পন্ন — সনদ ইস্যু হয়েছে।",
    en: "Approved — the certificate has been issued.",
  },
  reject: { bn: "আবেদন প্রত্যাখ্যান করা হয়েছে।", en: "Application rejected." },
  cancel: { bn: "আবেদন বাতিল করা হয়েছে।", en: "Application cancelled." },
  summon: {
    bn: "আবেদনকারীকে আসতে বলা হয়েছে।",
    en: "The applicant has been asked to come.",
  },
};
/** QA-13 → QAFIX-09 (B1): the irreversible decisions (approve,
    reject) are confirmed in an in-app modal in the reader's
    language — the copy the native window.confirm used to carry,
    minus its trailing question (the modal's buttons ask it). */
const transitionConfirmText: Record<string, { bn: string; en: string }> = {
  approve: {
    bn: "অনুমোদন করলে সঙ্গে সঙ্গে সনদ ইস্যু হবে এবং তা ফেরানো যাবে না।",
    en: "Approving issues the certificate immediately and cannot be undone.",
  },
  reject: {
    bn: "আবেদনটি প্রত্যাখ্যান করবেন? এটি ফেরানো যাবে না।",
    en: "Reject this application? This cannot be undone.",
  },
};
const transitionConfirmTitle: Record<string, { bn: string; en: string }> = {
  approve: {
    bn: "অনুমোদন করে সনদ ইস্যু করুন",
    en: "Approve and issue certificate",
  },
  reject: { bn: "প্রত্যাখ্যান করুন", en: "Reject application" },
};
const transitionConfirmButton: Record<string, { bn: string; en: string }> = {
  approve: { bn: "হ্যাঁ, অনুমোদন করুন", en: "Confirm approval" },
  reject: { bn: "হ্যাঁ, প্রত্যাখ্যান করুন", en: "Confirm rejection" },
};
/* FULL-UIUX-01 · OWNER-DECISION 1: real workspace routes. Hash-based
   (production is an SPA behind LiteSpeed with no rewrite control):
   #/<page>, #/applications/<id>, #/applications?state=X&service=N,
   #/owner/<section> (the legacy #owner-<section> stays readable).
   Refresh and Back restore the view; a deep link beats the role default. */
const OWNER_SECTIONS = [
  "overview",
  "offices",
  "demand",
  "subscriptions",
  "pricing",
  "coupons",
  "notices",
  "permissions",
  "audit",
  "settings",
];
type WorkspaceRoute = {
  page?: string;
  detailId?: string;
  state?: string;
  service?: string;
  ownerSection?: string;
};
function parseWorkspaceHash(): WorkspaceRoute {
  const hash = window.location.hash;
  if (hash.startsWith("#owner-")) {
    const section = hash.slice("#owner-".length);
    return OWNER_SECTIONS.includes(section)
      ? { page: "owner", ownerSection: section }
      : { page: "owner" };
  }
  if (!hash.startsWith("#/")) return {};
  const [path, query] = hash.slice(1).split("?");
  const segments = path.split("/").filter(Boolean);
  const params = new URLSearchParams(query ?? "");
  if (segments[0] === "owner") {
    const section = segments[1] ?? "";
    return {
      page: "owner",
      ownerSection: OWNER_SECTIONS.includes(section) ? section : "overview",
    };
  }
  // CH-004: the hash is untrusted input — a bad link (e.g. ?state=
  // AWAITING_ISSUANCE, which is not a state in the state machine) must
  // degrade to the unfiltered list, never crash the section (the old code
  // stored the raw value, and choose(applicationStatusMeta(filter)) threw
  // on the null meta, tripping the error boundary until a full reload) and
  // never 422 the list request. Unknown states become "" (all states);
  // a non-numeric or out-of-range service (API serviceNo is 1..47) is dropped.
  const rawService = params.get("service") ?? undefined;
  const serviceNo = Number(rawService);
  return {
    page: segments[0] || "home",
    detailId: segments[0] === "applications" ? segments[1] : undefined,
    state: normalizeApplicationState(params.get("state")),
    service:
      rawService !== undefined &&
      /^\d+$/.test(rawService) &&
      Number.isInteger(serviceNo) &&
      serviceNo >= 1 &&
      serviceNo <= 47
        ? rawService
        : undefined,
  };
}
function roleDefaultPage(role: string): string {
  // OWNER-DECISION 3 (UX S3): role-shaped landings as real defaults.
  if (role === "approver" || role === "reviewer") return "pending";
  if (role === "finance") return "billing";
  if (role === "owner") return "owner";
  return "home";
}
/** WS4 (Phase 3 remainder), integrated at BUNDLE-06 merge: settled-revenue
    KPI for the owner Overview, rendered as the shared StatCard (WS2 P1-11
    style). Reads the existing owner endpoint
    GET /owner/payment-orders?status=SETTLED — no new API. amountMinor is
    poisha; the card shows taka (minor / 100). Until the fetch resolves — or
    if it fails — the value stays "—" rather than a fabricated zero. */
function OwnerSettledRevenueCard() {
  const [language] = useLanguage();
  const [settled, setSettled] = useState<{ count: number; totalMinor: number } | null>(null);
  useEffect(() => {
    let live = true;
    api("/owner/payment-orders?status=SETTLED")
      .then((r: any) => {
        if (!live) return;
        const rows: any[] = r?.items ?? [];
        setSettled({
          count: rows.length,
          totalMinor: rows.reduce((sum, o) => sum + (Number(o.amountMinor) || 0), 0),
        });
      })
      .catch(() => {
        if (live) setSettled(null);
      });
    return () => {
      live = false;
    };
  }, []);
  const taka = settled ? (settled.totalMinor / 100).toFixed(2) : null;
  return (
    <StatCard
      label={choose({ bn: "নিষ্পত্তিকৃত রাজস্ব", en: "Settled revenue" })}
      value={taka === null ? "—" : `৳${localDigits(taka, language)}`}
      context={
        settled === null
          ? choose({ bn: "পেমেন্ট অর্ডার থেকে", en: "From payment orders" })
          : choose({
              bn: `${localDigits(String(settled.count), language)}টি নিষ্পত্তিকৃত অর্ডার`,
              en: `${settled.count} settled order(s)`,
            })
      }
      icon={<NavIcon name="reports" />}
    />
  );
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
  const branding = useBranding();
  // QA-19: the workspace is served under /login, so the tab kept the sign-in
  // page's title ("লগইন | DigitalUnion") after signing in.
  useEffect(() => {
    document.title =
      language === "bn" ? "কর্মক্ষেত্র | DigitalUnion" : "Workspace | DigitalUnion";
  }, [language]);
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
  const [page, setPage] = useState<string>(
    () =>
      parseWorkspaceHash().page ??
      roleDefaultPage(session?.user?.role ?? ""),
  ),
    [message, setMessage] = useState(""),
    [errorMessage, setErrorMessage] = useState(""),
    [actionError, setActionError] = useState(""),
    [busy, setBusy] = useState(false);
  const [catalog, setCatalog] = useState<any[]>([]),
    [citizens, setCitizens] = useState<any[]>([]),
    [citizenTotal, setCitizenTotal] = useState<number | null>(null),
    [applications, setApplications] = useState<any[]>([]),
    [wallet, setWallet] = useState<any>(null),
    [billing, setBilling] = useState<any>(null),
    // Phase 3E (§3.7): the office's coupon code for its next order, if any.
    [orderCoupon, setOrderCoupon] = useState(""),
    [tenants, setTenants] = useState<any[]>([]),
    [plans, setPlans] = useState<any[]>([]);
  // OWNER-REDESIGN-01 + FULL-UIUX-01: the owner console shows ONE section
  // at a time; the route hash names it (#owner-<section> legacy or
  // #/owner/<section>) so clicks, reloads and deep links agree.
  const [ownerSection, setOwnerSection] = useState<string>(
    () => parseWorkspaceHash().ownerSection ?? "overview",
  );
  // Phase 1 slice (iii), approved: dashboard tiles open the guided application flow.
  const [flowService, setFlowService] = useState<number | null>(null);
  const [flowCitizen, setFlowCitizen] = useState<any>(null);
  const [returnToFlow, setReturnToFlow] = useState(false);
  const [selectedService, setSelectedService] = useState(45),
    [returnToIntake, setReturnToIntake] = useState(false),
    [detail, setDetail] = useState<any>(null),
    [confirmAction, setConfirmAction] = useState<string | null>(null),
    [reason, setReason] = useState(""),
    [filter, setFilter] = useState(""),
    [search, setSearch] = useState("");
  const [appSearch, setAppSearch] = useState(""),
    [appQuery, setAppQuery] = useState(""),
    [appPage, setAppPage] = useState(1),
    [appPageSize, setAppPageSize] = useState(25),
    // QAFIX-01 (§4 item 13): null until the first list answer arrives —
    // totals show a loading dash, never a confident 0 that later jumps.
    [appTotal, setAppTotal] = useState<number | null>(null),
    // CH-004: the last applications-list failure, if any — the section
    // renders it with a retry instead of a stale/empty list.
    [appLoadError, setAppLoadError] = useState("");
  // Phase 6c: date range and renewals-only filters for the applications list.
  const [appFrom, setAppFrom] = useState(""),
    [appTo, setAppTo] = useState(""),
    [appRenewals, setAppRenewals] = useState(false);
  // CHAIRMAN-DASH-01: service filter for the applications list, and the Pending
  // applications queue (per-state counts from the API + each pending state's rows).
  const [appService, setAppService] = useState("");
  const [pendingCounts, setPendingCounts] = useState<any>(null),
    [pendingLists, setPendingLists] = useState<
      Record<string, { items: any[]; total: number }>
    >({});
  const [applicationReference, setApplicationReference] = useState("");
  /* FULL-UIUX-01 · OWNER-DECISION 2: one global header search — services
     from the loaded catalog, applications and citizens from the existing
     list endpoints (role-gated). No new endpoint was needed. */
  const [globalQuery, setGlobalQuery] = useState("");
  const [globalResults, setGlobalResults] = useState<{
    services: any[];
    applications: any[];
    citizens: any[];
  } | null>(null);
  const [globalFocus, setGlobalFocus] = useState(false);
  const [tabSheet, setTabSheet] = useState(false);

  useEffect(() => {
    const q = globalQuery.trim();
    if (q.length < 2) {
      setGlobalResults(null);
      return;
    }
    let active = true;
    const timer = setTimeout(async () => {
      const services = catalog
        .filter((service) =>
          normalizeSearch(
            `${service.service_no} ${service.name_bn} ${service.name_en}`,
          ).includes(normalizeSearch(q)),
        )
        .slice(0, 4);
      let applications: any[] = [];
      let citizens: any[] = [];
      try {
        if (!["owner", "finance"].includes(role)) {
          applications = items(
            await api(
              `/applications?q=${encodeURIComponent(q)}&pageSize=5`,
            ),
          );
        }
        if (["staff", "admin", "reviewer", "approver"].includes(role)) {
          citizens = items(
            await api(`/citizens?q=${encodeURIComponent(q)}&pageSize=5`),
          );
        }
      } catch {
        // Search is best-effort: a failed lookup shows what was found locally.
      }
      if (active) setGlobalResults({ services, applications, citizens });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalQuery]);
  const [renewalOrder, setRenewalOrder] = useState<IntakeOrderState | null>(
    null,
  );
  const [renewalLanguageChoice, setRenewalLanguageChoice] = useState<{
    id: string;
    // W-024: the renewal panel inherits the source application's
    // delivery_language, which may be "bilingual".
    language: "bn" | "en" | "bilingual";
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
  /* REFINEMENT-02 P2-7: registration is a true stepper — one section per
     step (identity → area & address → identity details), submit only on
     the last step. */
  const [regStep, setRegStep] = useState(0);
  // Phase 3a: the citizen whose details panel is open on the citizens page.
  const [detailsCitizenId, setDetailsCitizenId] = useState("");
  useEffect(() => {
    setCitizenGeography(readGeography(session?.tenant));
  }, [session?.tenant?.id]);
  // QAFIX-01 (§4 item 13): the global "Working…" line belongs to the
  // initial load only. It used to re-render on every background refresh,
  // which is why it looked stuck on the Applications page long after the
  // list had loaded — the list's own skeletons cover later loads.
  const [initialLoaded, setInitialLoaded] = useState(false);
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
      setInitialLoaded(true);
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
            `/applications?${new URLSearchParams({ ...(filter ? { state: filter } : {}), ...(appService ? { serviceNo: appService } : {}), q: appQuery, page: String(appPage), pageSize: String(appPageSize), ...(appFrom ? { from: appFrom } : {}), ...(appTo ? { to: appTo } : {}), ...(appRenewals ? { renewal: "true" } : {}) })}`,
          )
            // CH-004: a failed list fetch must not reject the whole
            // refresh (which would leave every panel stale) and must not
            // leave a dead screen — the section below renders the
            // failure with a retry. The previously loaded rows stay
            // visible until a fetch succeeds.
            .then((r) => {
              setAppLoadError("");
              return r;
            })
            .catch((e) => {
              setAppLoadError((e as Error).message);
              return null;
            })
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
    // CH-004: null when the list fetch failed (see above) — keep the
    // previously loaded rows and total instead of wiping the list.
    if (applicationResult) {
      setApplications(items(applicationResult));
      setAppTotal(applicationResult.total ?? items(applicationResult).length);
    }
    setWallet(walletResult);
    setBilling(billingResult);
    setTenants(items(tenantResult));
    setPlans(tenantResult.plans ?? []);
  }
  useEffect(() => {
    if (session) run(refresh);
  }, [session, filter, appService, appQuery, appPage, appPageSize, citizenQuery, appFrom, appTo, appRenewals]);
  const paymentReturnHandled = useRef(false);
  useEffect(() => {
    if (!session || !paymentReturnApplication || paymentReturnHandled.current)
      return;
    paymentReturnHandled.current = true;
    onPaymentReturnHandled();
    void run(async () => {
      await openApplication(paymentReturnApplication, false);
      history.replaceState({}, "", `#/applications/${paymentReturnApplication}`);
      setMessage(
        choose({
          bn: "আপনি পেমেন্ট পৃষ্ঠা থেকে ফিরে এসেছেন। নিচে সার্ভার-যাচাইকৃত পেমেন্টের অবস্থা দেখুন।",
          en: "You returned from the gateway. Check the server-verified payment status below.",
        }),
      );
    });
  }, [session]);
  const role = session?.user?.role || "",
    staff = ["staff", "admin"].includes(role),
    approver = role === "approver",
    finance = ["finance", "admin"].includes(role);
  const canApply = staff || role === "citizen";
  /** FULL-UIUX-01 (UX M14): the signed-in citizen's own record — the
      citizens list is self-scoped for the citizen role, so their record is
      the one whose user matches the session (fallback: the only record). */
  function ownCitizen() {
    if (role !== "citizen") return null;
    return (
      citizens.find((c) => (c.userId ?? c.user_id) === session.user.id) ??
      citizens[0] ??
      null
    );
  }
  /* FULL-UIUX-01 (B17/P1-5): the citizen home is status-first — per-state
     totals from the list endpoint itself (pageSize=1 reads), never from
     counting a fetched page. */
  const [citizenCounts, setCitizenCounts] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    if (role !== "citizen" || page !== "home") return;
    let active = true;
    (async () => {
      const states = [
        "DRAFT",
        "CORRECTION_REQUIRED",
        "SUBMITTED",
        "UNDER_REVIEW",
        "RESUBMITTED",
        "APPROVED",
        // ISSUANCE_PENDING is deliberately NOT requested: it is not a
        // state in the current state machine (the API's state enum
        // dropped it — see the /applications/counts note in app.ts), so
        // the request always failed 422 INPUT_INVALID and only added a
        // browser console error on every citizen-home load. Its count
        // could only ever be 0, and the totals below already read it
        // with ?? 0, so no displayed number changes.
        "ISSUED",
      ];
      const entries = await Promise.all(
        states.map(async (s) => {
          try {
            const r = await api(`/applications?state=${s}&pageSize=1`);
            return [s, r.total ?? items(r).length] as const;
          } catch {
            return [s, 0] as const;
          }
        }),
      );
      if (active) setCitizenCounts(Object.fromEntries(entries));
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, page, appTotal]);
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
          : page === "guide"
            ? "user-guide"
            : page === "applications" && filter === "ISSUED" && appService === "42"
              ? "trade-renewal"
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
        // FULL-UIUX-01 (B19/P1-8): a citizen's sidebar carries no office
        // citizen-registry entry — that register is staff tooling.
        (p !== "citizens" || role !== "citizen") &&
        (p !== "admin" || role === "admin") &&
        (p !== "pending" ||
          ["staff", "admin", "reviewer", "approver"].includes(role)) &&
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
      .toLowerCase()
      .normalize("NFC"); // HOME-REDESIGN-02: one form for Bangla য়/ড়/ঢ়
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
    setAppService("");
    setAppSearch("");
    setAppQuery("");
    setAppPage(1);
  }
  /* FULL-UIUX-01 · OWNER-DECISION 1: route writes. Every navigation keeps
     the hash truthful; applying a hash never writes one back. */
  function writeRoute(hash: string) {
    if (window.location.hash !== hash) history.pushState({}, "", hash);
  }
  function routeHashFor(next: string): string {
    return next === "owner" ? `#/owner/${ownerSection}` : `#/${next}`;
  }
  function applicationsHash(): string {
    const params = new URLSearchParams({
      ...(filter ? { state: filter } : {}),
      ...(appService ? { service: appService } : {}),
    });
    const query = params.toString();
    return `#/applications${query ? `?${query}` : ""}`;
  }
  function applyRoute(route: WorkspaceRoute) {
    if (route.ownerSection) setOwnerSection(route.ownerSection);
    if (!route.page) return;
    if (route.page === "applications") {
      // CH-004: normalize again at the boundary (parseWorkspaceHash
      // already normalizes; this covers any future caller passing a raw
      // value) and repair the URL when the hash carried a value that
      // normalized away, so a refresh or bookmark does not re-carry the
      // bad filter. replaceState fires no hashchange, so this cannot loop.
      const state = normalizeApplicationState(route.state);
      setFilter(state);
      setAppService(route.service ?? "");
      setAppPage(1);
      if (!route.detailId) {
        const params = new URLSearchParams({
          ...(state ? { state } : {}),
          ...(route.service ? { service: route.service } : {}),
        });
        const query = params.toString();
        const cleanHash = `#/applications${query ? `?${query}` : ""}`;
        if (window.location.hash !== cleanHash) {
          history.replaceState({}, "", cleanHash);
        }
      }
    }
    setDetail(null);
    setPage(route.page);
    if (route.page === "applications" && route.detailId) {
      void openApplication(route.detailId, false);
    }
  }
  useEffect(() => {
    const route = parseWorkspaceHash();
    if (route.page) applyRoute(route);
    else {
      history.replaceState(
        {},
        "",
        routeHashFor(
          parseWorkspaceHash().page ??
            roleDefaultPage(session?.user?.role ?? ""),
        ),
      );
    }
    const onHash = () => {
      const next = parseWorkspaceHash();
      if (next.page) applyRoute(next);
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
    // Mount once: the route is the source of truth from here on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function openTask(next: string, state = "", serviceNo = "") {
    if (next === "applications") {
      clearApplicationFilters();
      // CH-004: dashboard tiles and deep links pass state names; normalize
      // so an unknown value degrades to "all" instead of crashing the list.
      const normalizedState = normalizeApplicationState(state);
      setFilter(normalizedState);
      setAppService(serviceNo);
      setDetail(null);
      setPage("applications");
      const params = new URLSearchParams({
        ...(normalizedState ? { state: normalizedState } : {}),
        ...(serviceNo ? { service: serviceNo } : {}),
      });
      const query = params.toString();
      writeRoute(`#/applications${query ? `?${query}` : ""}`);
      // PORTAL-B: re-read even when the filters are unchanged (the filter
      // effect only fires on a change; its later epoch wins when they do).
      void run(refresh);
      return;
    }
    nav(next);
  }
  const application = detail?.application || detail,
    detailPayload = detail?.payload || application?.payload || {};
  const renewalLanguage =
    renewalLanguageChoice && renewalLanguageChoice.id === application?.id
      ? renewalLanguageChoice.language
      : detailPayload.delivery_language;
  async function openApplication(id: string, push = true) {
    setActionError("");
    setDetail(await api(`/applications/${id}`));
    setPage("applications");
    setReason("");
    if (push) writeRoute(`#/applications/${id}`);
  }
  function closeDetail() {
    setActionError("");
    setConfirmAction(null);
    setDetail(null);
    writeRoute(applicationsHash());
  }
  async function transition(action: string) {
    // QAFIX-09 (B1): decisions that cannot be undone (QA-13) ask
    // once before they run — in the in-app confirmation modal
    // rendered below, not window.confirm: the native dialog is
    // auto-cancelled by automated browsers, which silently
    // stranded the chairman's approve/reject, and it cannot show
    // the application reference. Other transitions run at once.
    if (transitionConfirmText[action]) {
      setConfirmAction(action);
      return;
    }
    await runTransition(action);
  }
  async function runTransition(action: string) {
    setActionError("");
    try {
      await api(`/applications/${application.id}/transition`, "POST", {
        action,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
    } catch (e) {
      // F2 (FULL-LIVE-QA-R5 finding, 21 Nov): a rejected transition —
      // e.g. 409 ATTACHMENT_NOT_READY when a supporting document is
      // still unscanned — used to surface only in the workspace's top
      // banner, far from the detail view where the action was taken;
      // at the button itself the click appeared to do nothing while
      // the application stayed DRAFT. Keep the failure with the
      // application instead: the detail view renders the server's own
      // message beside its actions (see .detail-action-error below),
      // and the status keeps reading the server state — never an
      // optimistic SUBMITTED.
      setActionError((e as Error).message);
      return;
    }
    await openApplication(application.id);
    await refresh();
    setMessage(choose(actionDone[action] ?? actionText[action] ?? { bn: "সম্পন্ন হয়েছে।", en: "Done." }));
  }
  // CHAIRMAN-DASH-01: the Pending applications queue. Counts always come from the
  // API (/applications/counts) — never from counting a fetched page — and the rows
  // come from the same list endpoint the applications page uses, one state at a
  // time. CORRECTION_REQUIRED is excluded on purpose: after a correction request
  // the next move is the citizen's, so it is not office-pending work.
  const pendingReviewStates = ["SUBMITTED", "RESUBMITTED", "UNDER_REVIEW"],
    pendingIssuanceStates = ["APPROVED"];
  async function loadPendingCounts() {
    const counts = await api("/applications/counts");
    setPendingCounts(counts);
  }
  async function loadPending() {
    await loadPendingCounts();
    const lists: Record<string, { items: any[]; total: number }> = {};
    await Promise.all(
      [...pendingReviewStates, ...pendingIssuanceStates].map(async (state) => {
        const r = await api(
          `/applications?${new URLSearchParams({ state, page: "1", pageSize: "100" })}`,
        );
        lists[state] = {
          items: items(r),
          total: r.total ?? items(r).length,
        };
      }),
    );
    setPendingLists(lists);
  }
  useEffect(() => {
    if (!session) return;
    if (page === "pending") void run(loadPending);
    /* The dashboard's pending-applications tile (P1-8) reads pendingCounts,
       which only the pending page loaded — on home it sat at "—" forever.
       Load the counts for the staff dashboard too. */
    else if (page === "home" && staff) void run(loadPendingCounts);
  }, [page, session]);
  // FULL-UIUX-01 (B24/P1-14): one row presentation for application lists,
  // shared by the applications page and the Pending queue. A row is
  // identified by the citizen's 16-digit reference (RefChip), names the
  // citizen, carries the shared status badge, and ends in a real button.
  const lastSubmittedReference = (() => {
    try {
      return sessionStorage.getItem("du:last-submitted-reference");
    } catch {
      return null;
    }
  })();
  function citizenNameFor(a: any): string {
    const found = citizens.find(
      (c) => c.id === (a.citizenId ?? a.citizen_id),
    );
    return found ? recordName(found) : "";
  }
  function isNewApplication(a: any): boolean {
    return (
      !!lastSubmittedReference &&
      (a.reference === lastSubmittedReference || a.id === lastSubmittedReference)
    );
  }
  function applicationRow(a: any, hideCitizen = false) {
    const serviceNo = a.serviceNo || a.service_no;
    const isNew = isNewApplication(a);
    return (
      <tr key={a.id} className={isNew ? "ax-row-new" : undefined}>
        <td>
          <RefChip value={a.reference || a.id} />
          <small>{applicationDate(a.createdAt || a.created_at)}</small>
          {isNew && (
            <span className="ax-new-badge">
              {choose({ bn: "নতুন", en: "New" })}
            </span>
          )}
        </td>
        {!hideCitizen && <td>{citizenNameFor(a) || "—"}</td>}
        <td>
          {/* P2-3: no internal "#NN" prefix in list contexts — the
              service number survives as an explicit field on detail
              pages only. */}
          {tx(recordName(catalog.find((s) => s.service_no === serviceNo)))}
          {/* REFINEMENT-02 P2-9: queue triage — an age chip on staff
              rows. Amber ONLY when the wait exceeds the office's stated
              service time for the service (a.statedDays, when the API
              supplies it); otherwise the chip stays neutral. */}
          {!hideCitizen &&
            (() => {
              const created = new Date(a.createdAt || a.created_at);
              if (Number.isNaN(created.getTime())) return null;
              const days = Math.max(
                0,
                Math.floor((Date.now() - created.getTime()) / 86_400_000),
              );
              const stated = Number(a.statedDays ?? a.serviceDays ?? NaN);
              const overdue = Number.isFinite(stated) && days > stated;
              return (
                <span className={`age-chip${overdue ? " age-chip-warn" : ""}`}>
                  {days === 0
                    ? choose({ bn: "আজ জমা", en: "Submitted today" })
                    : choose({
                        bn: `${localDigits(String(days), language)} দিন অপেক্ষমাণ`,
                        en: `${days} day${days === 1 ? "" : "s"} waiting`,
                      })}
                </span>
              );
            })()}
        </td>
        <td>
          <ApplicationStatus state={String(a.state || a.status || "")} />
        </td>
        <td>
          <button
            type="button"
            className="secondary"
            onClick={() => run(() => openApplication(a.id))}
          >
            {choose({ bn: "খুলুন", en: "Open" })}
          </button>
        </td>
      </tr>
    );
  }
  function applicationCard(a: any) {
    const serviceNo = a.serviceNo || a.service_no;
    const isNew = isNewApplication(a);
    return (
      <article className={`ax-card${isNew ? " ax-card-new" : ""}`} key={a.id}>
        <div className="ax-card-head">
          <RefChip value={a.reference || a.id} />
          <ApplicationStatus state={String(a.state || a.status || "")} />
        </div>
        <strong>
          {tx(recordName(catalog.find((svc) => svc.service_no === serviceNo)))}
        </strong>
        {citizenNameFor(a) && <span>{citizenNameFor(a)}</span>}
        <small>{applicationDate(a.createdAt || a.created_at)}</small>
        {isNew && (
          <span className="ax-new-badge">
            {choose({ bn: "নতুন জমা", en: "Just submitted" })}
          </span>
        )}
        <button
          type="button"
          className="secondary"
          onClick={() => run(() => openApplication(a.id))}
        >
          {choose({ bn: "খুলুন", en: "Open" })}
        </button>
      </article>
    );
  }
  // CHAIRMAN-DASH-01: one Pending queue group — a heading with the API count,
  // then the group's rows in the shared list presentation. When a group holds
  // more than the fetched rows, each state links into the full filtered list.
  function pendingGroupSection(
    title: { bn: string; en: string },
    count: number | null,
    states: string[],
  ) {
    const rows = states
      .flatMap((state) => pendingLists[state]?.items ?? [])
      /* P2-9: queues triage oldest-first — the longest wait is the
         first row, and the heading says so. */
      .sort((x, y) =>
        String(x.createdAt || x.created_at || "").localeCompare(
          String(y.createdAt || y.created_at || ""),
        ),
      );
    return (
      <section className="panel">
        <div className="section-heading">
          <h2>
            {choose(title)}
            {count !== null &&
              ` · ${count.toLocaleString(language === "bn" ? "bn-BD" : "en-GB")}`}
          </h2>
          {/* P2-9: the sort order is stated, not implicit. */}
          <span className="hint">
            {choose({ bn: "পুরনো আবেদন আগে", en: "Oldest first" })}
          </span>
        </div>
        {rows.length ? (
          <>
            <div className="table-wrap responsive-table">
              <table>
                <thead>
                  <tr>
                    <th>{choose({ bn: "রেফারেন্স", en: "Reference" })}</th>
                    <th>{choose({ bn: "নাগরিক", en: "Citizen" })}</th>
                    <th>{choose({ bn: "সেবা", en: "Service" })}</th>
                    <th>{choose({ bn: "অবস্থা", en: "Status" })}</th>
                    <th>
                      <span className="visually-hidden">
                        {choose({ bn: "খুলুন", en: "Open" })}
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>{tx(rows.map((a) => applicationRow(a)))}</tbody>
              </table>
            </div>
            {phoneLayout && (
              <div className="ax-card-list">
                {tx(rows.map(applicationCard))}
              </div>
            )}
          </>
        ) : (
          <EmptyState
            title={choose({
              bn: "এই মুহূর্তে কিছুই অপেক্ষমাণ নেই",
              en: "Nothing is waiting right now",
            })}
            hint={choose({
              bn: "নতুন আবেদন এলে এখানে দেখা যাবে।",
              en: "New applications will appear here.",
            })}
          />
        )}
        {count !== null && count > rows.length && (
          <p className="hint">
            {choose({
              bn: "সাম্প্রতিকগুলো দেখানো হচ্ছে — বাকিগুলো আবেদনের তালিকায়:",
              en: "Showing the most recent — see the rest in the applications list:",
            })}
            {tx(" ")}
            {states.map((state) => (
              <button
                key={state}
                className="text-button"
                onClick={() => openTask("applications", state)}
              >
                {choose(applicationStatusMeta(state))}
              </button>
            ))}
          </p>
        )}
      </section>
    );
  }
  function nav(next: string) {
    setReturnToIntake(false);
    setReturnToFlow(false);
    setPage(next);
    setDetail(null);
    setMessage("");
    setErrorMessage("");
    setSearch("");
    writeRoute(routeHashFor(next));
    // PORTAL-B: opening the list (or the dashboard counts) re-reads it, so a
    // decision made since the last load shows at once — before, a citizen
    // could see "Submitted" on an application the Chairman had issued.
    if (next === "applications" || next === "home") void run(refresh);
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
          {cert.pdfUrlEn ? (
            <a
              className="button secondary"
              href={cert.pdfUrlEn}
              target="_blank"
              rel="noreferrer"
            >
              {t("Download PDF (English)")}
            </a>
          ) : null}
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
                      throw Error(
                        choose({
                          bn: "প্রত্যাহারের কারণ লিখুন।",
                          en: "Enter a revocation reason.",
                        }),
                      );
                    // QA-13: revocation is permanent; confirm with the number.
                    if (
                      !window.confirm(
                        choose({
                          bn: `সনদ ${cert.number} প্রত্যাহার করবেন? এটি ফেরানো যাবে না।`,
                          en: `Revoke certificate ${cert.number}? This cannot be undone.`,
                        }),
                      )
                    )
                      return;
                    await api(`/certificates/${cert.id}/revoke`, "POST", {
                      reason,
                    });
                    await openApplication(application.id);
                    setMessage(
                      choose({
                        bn: "সনদ প্রত্যাহার করা হয়েছে।",
                        en: "Certificate revoked.",
                      }),
                    );
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
  const roleLabels: Record<string, { bn: string; en: string }> = {
    citizen: { bn: "নাগরিক", en: "Citizen" },
    staff: { bn: "অফিস কর্মী", en: "Office staff" },
    admin: { bn: "অফিস অ্যাডমিন", en: "Office admin" },
    approver: { bn: "চেয়ারম্যান (অনুমোদনকারী)", en: "Chairman (approver)" },
    reviewer: { bn: "পর্যালোচক", en: "Reviewer" },
    finance: { bn: "হিসাব", en: "Finance" },
    owner: { bn: "প্ল্যাটফর্ম মালিক", en: "Platform owner" },
  };
  const pendingBadge =
    pendingCounts != null
      ? (pendingCounts.awaitingReview ?? 0) + (pendingCounts.awaitingIssuance ?? 0)
      : null;
  return (
    <div className={`shell${page === "owner" ? " shell-owner" : ""}`}>
      <a className="skip" href="#content">
        {t("Skip to main content ")}
      </a>
      <aside>
        <a className="brand" href="/" aria-label={choose({ bn: "DigitalUnion হোম", en: "DigitalUnion home" })}>
          {/* OWNER-DECISION 4: the one platform lockup in the workspace shell. */}
          <BrandLockup size={38} />
        </a>
        <p className="office">
          {tx(recordName(session.tenant) || "Platform owner")}
          <small>
            {/* HOME-REDESIGN-01: a citizen is not in the office's workspace;
                they are using that office's services. */}
            {role === "citizen"
              ? choose({ bn: "আপনার ইউনিয়ন অফিস", en: "Your union office" })
              : tx(session.tenant ? "Office workspace" : "Union services platform")}
          </small>
        </p>
        {udcPreview ? (
          <SidebarNav
            items={udcNavigation}
            current={udcCurrent}
            label={t("Workspace navigation")}
            onSelect={(item) => {
              if (item.page === "applications")
                openTask("applications", item.state ?? "", item.serviceNo ?? "");
              else if (item.page) nav(item.page);
            }}
          />
        ) : (
        <nav aria-label={t("Workspace navigation")} className="ws-nav">
          {tx(
            NAV_GROUPS.map((group) => {
              const groupPages = group.pages.filter((p) =>
                visiblePages.includes(p),
              );
              if (!groupPages.length) return null;
              return (
                <div className="ws-nav-group" key={group.title.en}>
                  <span className="ws-nav-group-title">
                    {/* PORTAL-B: a citizen's print copies are a service to
                        them, not "office" work. */}
                    {role === "citizen" && group.title.en === "Office"
                      ? choose({ bn: "অন্যান্য সেবা", en: "More services" })
                      : choose(group.title)}
                  </span>
                  {groupPages.map((p) => (
                    <button
                      key={p}
                      data-page={p}
                      aria-current={page === p ? "page" : undefined}
                      onClick={() => nav(p)}
                    >
                      <NavIcon name={p} />
                      <span>{choose({ bn: localized[p], en: labels[p] })}</span>
                      {p === "pending" && pendingBadge ? (
                        <span className="ws-nav-badge">
                          {localDigits(String(pendingBadge), language)}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              );
            }),
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
            <small>
              {roleLabels[role]
                ? choose(roleLabels[role])
                : tx(role)}
            </small>
          </p>
          <button
            className="text-button"
            onClick={() =>
              run(async () => {
                // Phase 5 (5A): leaving the workspace must never depend on the logout
                // request succeeding — in the broken-session state that request is
                // exactly what fails (it is CSRF-protected like every POST), which left
                // sign-out clicks doing nothing. The API client first resyncs and tries
                // to complete the server logout; whatever the outcome, local state is
                // cleared and the user returns to the sign-in portal. A server session
                // that could not be ended here expires on its own schedule.
                try {
                  await api("/auth/logout", "POST");
                } catch {
                  // Ignored deliberately: local sign-out proceeds regardless.
                }
                clearSessionToken();
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
        <GlobalNoticeBanner />
        <header>
          <div>
            <span className="eyebrow">
              {choose({ bn: "ডিজিটাল ইউনিয়ন · ইউনিয়ন সেবা", en: "DigitalUnion · Union services" })}
            </span>
            <h1>
              {page === "flow"
                ? choose({ bn: "নতুন আবেদন", en: "New application" })
                : page === "applications" && detail
                  ? choose({ bn: "আবেদনের বিবরণ", en: "Application details" })
                  : page === "applications" && filter === "ISSUED"
                    ? appService === "42"
                      ? choose({ bn: "ট্রেড লাইসেন্স নবায়ন", en: "Trade licence renewal" })
                      : choose({ bn: "সনদ নবায়ন", en: "Certificate renewal" })
                    : dashboardHome && page === "home"
                      ? choose({ bn: "ড্যাশবোর্ড", en: "Dashboard" })
                      : choose(pageTitles[page] ?? { bn: localized[page] ?? page, en: labels[page] ?? page })}
            </h1>
          </div>
          <div className="workspace-header-actions">
            <div className="ws-global-search">
              <label htmlFor="ws-global-search-input" className="visually-hidden">
                {choose({
                  bn: "সেবা, আবেদন বা নাগরিক খুঁজুন",
                  en: "Search services, applications or citizens",
                })}
              </label>
              <NavIcon name="search" size={18} />
              <input
                id="ws-global-search-input"
                type="search"
                value={globalQuery}
                onChange={(e) => setGlobalQuery(e.target.value)}
                onFocus={() => setGlobalFocus(true)}
                onBlur={() => window.setTimeout(() => setGlobalFocus(false), 180)}
                placeholder={choose({
                  bn: "খুঁজুন — সেবা, আবেদন, নাগরিক…",
                  en: "Search — services, applications, citizens…",
                })}
                autoComplete="off"
              />
              {globalFocus && globalResults && (
                <div className="ws-global-results" role="listbox">
                  {globalResults.services.length > 0 && (
                    <div className="ws-global-group">
                      <span>{choose({ bn: "সেবা", en: "Services" })}</span>
                      {globalResults.services.map((s) => (
                        <button
                          key={s.service_no}
                          type="button"
                          onClick={() => {
                            setGlobalQuery("");
                            if (canApply) {
                              setSelectedService(s.service_no);
                              setFlowService(s.service_no);
                              setFlowCitizen(
                                role === "citizen" ? ownCitizen() : null,
                              );
                              nav("flow");
                            } else nav("services");
                          }}
                        >
                          {recordName(s)}
                        </button>
                      ))}
                    </div>
                  )}
                  {globalResults.applications.length > 0 && (
                    <div className="ws-global-group">
                      <span>{choose({ bn: "আবেদন", en: "Applications" })}</span>
                      {globalResults.applications.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => {
                            setGlobalQuery("");
                            void run(() => openApplication(a.id));
                          }}
                        >
                          {a.reference || a.id} ·{" "}
                          {choose(applicationStatusLabel(String(a.state || a.status || "")))}
                        </button>
                      ))}
                    </div>
                  )}
                  {globalResults.citizens.length > 0 && (
                    <div className="ws-global-group">
                      <span>{choose({ bn: "নাগরিক", en: "Citizens" })}</span>
                      {globalResults.citizens.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            setGlobalQuery("");
                            nav("citizens");
                            setDetailsCitizenId(c.id);
                          }}
                        >
                          {recordName(c)}
                          {c.syntheticReference
                            ? ` · ${c.syntheticReference}`
                            : ""}
                        </button>
                      ))}
                    </div>
                  )}
                  {!globalResults.services.length &&
                    !globalResults.applications.length &&
                    !globalResults.citizens.length && (
                      <p className="ws-global-empty">
                        {choose({
                          bn: "কিছু পাওয়া যায়নি।",
                          en: "Nothing found.",
                        })}
                      </p>
                    )}
                </div>
              )}
            </div>
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
          busy && !initialLoaded && (
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
            selfCitizen={role === "citizen" && !!flowCitizen}
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
            pendingTotal={
              pendingCounts != null
                ? (pendingCounts.awaitingReview ?? 0) +
                  (pendingCounts.awaitingIssuance ?? 0)
                : null
            }
            creditBalance={wallet?.balance ?? null}
            onStartService={(serviceNo) => {
              setSelectedService(serviceNo);
              setFlowService(serviceNo);
              setFlowCitizen(role === "citizen" ? ownCitizen() : null);
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
            {/* HOME-REDESIGN-01: a new citizen (no applications yet) sees
            {/* what to do first; returning citizens keep their status on top. */}
            {role === "citizen" && applications.length === 0 && (
              <WorkspaceWelcome role={role} navigate={openTask} />
            )}
            {role === "citizen" && (
              <section
                className="citizen-status-home"
                aria-label={choose({ bn: "আমার আবেদনের অবস্থা", en: "My application status" })}
              >
                {citizenCounts && (citizenCounts.CORRECTION_REQUIRED ?? 0) > 0 && (
                  <div className="citizen-correction-card">
                    <div>
                      <strong>
                        {choose({
                          bn: "সংশোধন প্রয়োজন",
                          en: "Correction needed",
                        })}
                        {" · "}
                        {localDigits(String(citizenCounts.CORRECTION_REQUIRED), language)}
                      </strong>
                      <p>
                        {choose({
                          bn: "অফিস একটি আবেদনে সংশোধন চেয়েছে। কারণ পড়ে ঠিক করে আবার জমা দিন।",
                          en: "The office asked for a correction on an application. Read the reason, fix it and resubmit.",
                        })}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => openTask("applications", "CORRECTION_REQUIRED")}
                    >
                      {choose({ bn: "আবেদনগুলো দেখুন", en: "View applications" })}
                    </button>
                  </div>
                )}
                <div className="citizen-status-cards">
                  <button
                    type="button"
                    className="ax-stat-button"
                    onClick={() => openTask("applications", "DRAFT")}
                  >
                    <StatCard
                      value={
                        citizenCounts
                          ? localDigits(String(citizenCounts.DRAFT ?? 0), language)
                          : "—"
                      }
                      label={choose({ bn: "খসড়া", en: "Drafts" })}
                      icon={<NavIcon name="applications" />}
                      context={choose({ bn: "চালিয়ে যান", en: "Continue" })}
                    />
                  </button>
                  <button
                    type="button"
                    className="ax-stat-button"
                    onClick={() => openTask("applications")}
                  >
                    <StatCard
                      value={
                        citizenCounts
                          ? localDigits(
                              String(
                                (citizenCounts.SUBMITTED ?? 0) +
                                  (citizenCounts.UNDER_REVIEW ?? 0) +
                                  (citizenCounts.RESUBMITTED ?? 0) +
                                  (citizenCounts.APPROVED ?? 0) +
                                  (citizenCounts.ISSUANCE_PENDING ?? 0),
                              ),
                              language,
                            )
                          : "—"
                      }
                      label={choose({ bn: "পর্যালোচনাধীন", en: "In review" })}
                      icon={<NavIcon name="pending" />}
                      context={choose({ bn: "অবস্থা দেখুন", en: "Check status" })}
                    />
                  </button>
                  <button
                    type="button"
                    className="ax-stat-button"
                    onClick={() => openTask("applications", "ISSUED")}
                  >
                    <StatCard
                      value={
                        citizenCounts
                          ? localDigits(String(citizenCounts.ISSUED ?? 0), language)
                          : "—"
                      }
                      label={choose({ bn: "ইস্যু হয়েছে", en: "Issued" })}
                      icon={<NavIcon name="print-certificate" />}
                      context={choose({ bn: "সনদ ডাউনলোড", en: "Download certificates" })}
                    />
                  </button>
                </div>
                {(() => {
                  const draft = applications.find(
                    (a) => (a.state || a.status) === "DRAFT",
                  );
                  return draft ? (
                    <div className="citizen-draft-card">
                      <div>
                        <strong>
                          {choose({ bn: "খসড়া চালিয়ে যান: ", en: "Continue your draft: " })}
                          {tx(
                            recordName(
                              catalog.find(
                                (s) =>
                                  s.service_no ===
                                  (draft.serviceNo || draft.service_no),
                              ),
                            ),
                          )}
                        </strong>
                        <RefChip value={draft.reference || draft.id} />
                      </div>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => run(() => openApplication(draft.id))}
                      >
                        {choose({ bn: "খুলুন", en: "Open" })}
                      </button>
                    </div>
                  ) : null;
                })()}
                {applications.length > 0 && (
                  <div className="citizen-recent">
                    <h2>{choose({ bn: "সাম্প্রতিক আবেদন", en: "Recent applications" })}</h2>
                    <ul>
                      {applications.slice(0, 5).map((a) => (
                        <li key={a.id}>
                          <RefChip value={a.reference || a.id} />
                          <span>
                            {tx(
                              recordName(
                                catalog.find(
                                  (s) =>
                                    s.service_no ===
                                    (a.serviceNo || a.service_no),
                                ),
                              ),
                            )}
                          </span>
                          <ApplicationStatus
                            state={String(a.state || a.status || "")}
                          />
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => run(() => openApplication(a.id))}
                          >
                            {choose({ bn: "খুলুন", en: "Open" })}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}
            {!(role === "citizen" && applications.length === 0) && (
              <WorkspaceWelcome role={role} navigate={openTask} />
            )}
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
                {/* FULL-UIUX-01 (A7 + C42/P2-23): the services page uses the
                    one ServiceCard. Roles that cannot apply see the SAME
                    full-strength cards with a "শুধু দেখার জন্য" badge and
                    this explanation — never a washed-out disabled grid. */}
                {!canApply && (
                  <p className="notice" role="note">
                    {choose({
                      bn: "আপনার ভূমিকায় নতুন আবেদন শুরু করা যায় না — এই তালিকাটি শুধু দেখার জন্য।",
                      en: "Your role cannot start new applications — this list is for reference only.",
                    })}
                  </p>
                )}
                <div className="catalog">
                  {tx(
                    matchingServices.map((s) => (
                      <ServiceCard
                        key={s.service_no}
                        serviceNo={s.service_no}
                        name={choose({ bn: s.name_bn, en: s.name_en })}
                        category={
                          s.category_en ?? s.categoryEn ?? s.category ?? "Miscellaneous"
                        }
                        status={
                          <span className="ax-status tone-neutral">
                            {operationalServiceNumbers.includes(s.service_no)
                              ? canApply
                                ? choose({ bn: "আবেদন করা যায়", en: "Available" })
                                : choose({ bn: "শুধু দেখার জন্য", en: "View only" })
                              : choose({ bn: "তথ্যের জন্য", en: "Reference" })}
                          </span>
                        }
                        onClick={
                          canApply
                            ? () => {
                                setSelectedService(s.service_no);
                                setFlowService(s.service_no);
                                setFlowCitizen(
                                  role === "citizen" ? ownCitizen() : flowCitizen,
                                );
                                nav("flow");
                              }
                            : undefined
                        }
                      />
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
                        // Phase 5 (5B): the server already filters this list by the same
                        // query (Bangla + English names, reference, mobile). The old extra
                        // client-side substring filter over the serialized citizen could
                        // only hide server matches — the phone card list below never
                        // applied it, so the two layouts could disagree.
                        citizens.map((c) => (
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
                                {/* FULL-UIUX-01 (C31/P2-7): the citizen's own
                                    record reference, never a truncated UUID. */}
                                <code>
                                  {tx(
                                    c.syntheticReference ||
                                      c.synthetic_reference ||
                                      c.id.slice(0, 8),
                                  )}
                                </code>
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
                        <code>
                          {tx(
                            c.syntheticReference ||
                              c.synthetic_reference ||
                              c.id.slice(0, 8),
                          )}
                        </code>
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
                        /* P2-7: Enter/Continue advances the stepper;
                           only the last step submits. */
                        if (regStep < 2) {
                          setRegStep(regStep + 1);
                          return;
                        }
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
                          setRegStep(0);
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
                              choose({
                                bn: "নাগরিক নিবন্ধিত ও নির্বাচিত হয়েছে। নিচে আবেদনটি সম্পূর্ণ করুন।",
                                en: "Citizen registered and selected. Complete the application below.",
                              }),
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
                              choose({
                                bn: "নাগরিক নিবন্ধিত হয়েছে। একই পরিচয় তথ্য দিয়ে দ্বিতীয় নিবন্ধন গ্রহণ করা হয় না।",
                                en: "Citizen registered. Duplicate identity keys are rejected.",
                              }),
                            );
                          }
                        });
                      }}
                    >
                      <Stepper
                        steps={[
                          choose({ bn: "পরিচিতি", en: "Identity" }),
                          choose({ bn: "এলাকা ও ঠিকানা", en: "Area & address" }),
                          choose({ bn: "পরিচয় বিবরণ", en: "Identity details" }),
                        ]}
                        current={regStep}
                        label={choose({ bn: "নিবন্ধনের ধাপ", en: "Registration steps" })}
                      />
                      {regStep === 0 && (
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
                                minLength={
                                  key === "dateOfBirth"
                                    ? undefined
                                    : key.startsWith("address")
                                      ? 4
                                      : 2
                                }
                                maxLength={
                                  key === "dateOfBirth"
                                    ? undefined
                                    : key.startsWith("address")
                                      ? 500
                                      : 120
                                }
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
                      )}
                      {regStep === 1 && (
                        <>
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
                        </>
                      )}
                      {regStep === 2 && (
                        <CitizenDetailsFields
                          prefix="citizen-details"
                          value={citizenDetails}
                          onChange={setCitizenDetails}
                        />
                      )}
                      <div className="actions">
                        {regStep > 0 && (
                          <button
                            type="button"
                            className="secondary"
                            disabled={busy}
                            onClick={() => setRegStep(regStep - 1)}
                          >
                            {choose({ bn: "পেছনে", en: "Back" })}
                          </button>
                        )}
                        {regStep < 2 ? (
                          <button type="submit">
                            {choose({ bn: "পরবর্তী ধাপ", en: "Continue" })}
                          </button>
                        ) : (
                          /* P2-7: the submit is full-strength primary —
                             never a washed-out default. */
                          <button disabled={busy} className="primary-strong">
                            {t("Register citizen")}
                          </button>
                        )}
                      </div>
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
              {/* FULL-UIUX-01 (B20/P1-9): ONE toolbar row — search, status
                  and service together; everything else lives behind the
                  "আরও ফিল্টার" disclosure, so the first row of results is
                  above the fold instead of under a filter stack. */}
              <div className="app-toolbar">
                <div className="app-toolbar-main">
                  <div className="app-toolbar-field app-toolbar-search">
                    <label htmlFor="application-search">
                      {choose({ bn: "আবেদন খুঁজুন", en: "Search applications" })}
                    </label>
                    <input
                      id="application-search"
                      placeholder={choose({
                        bn: "রেফারেন্স, নাগরিকের নাম বা সেবা",
                        en: "Reference, citizen name or service",
                      })}
                      value={appSearch}
                      onChange={(e) => setAppSearch(e.target.value)}
                    />
                  </div>
                  <div className="app-toolbar-field">
                    <label htmlFor="state-filter">
                      {choose({ bn: "অবস্থা", en: "Status" })}
                    </label>
                    <select
                      id="state-filter"
                      value={filter}
                      onChange={(e) => {
                        setFilter(e.target.value);
                        setAppPage(1);
                        writeRoute(
                          e.target.value || appService
                            ? `#/applications?${new URLSearchParams({
                                ...(e.target.value ? { state: e.target.value } : {}),
                                ...(appService ? { service: appService } : {}),
                              })}`
                            : "#/applications",
                        );
                      }}
                    >
                      <option value="">{choose({ bn: "সব অবস্থা", en: "All states" })}</option>
                      {tx(
                        // CH-004: the options are the API's accepted states
                        // by construction — ISSUANCE_PENDING was offered
                        // here but the API rejects it with 422, so
                        // selecting it only ever produced an error.
                        APPLICATION_STATES.map((s) => (
                          <option key={s} value={s}>
                            {choose(applicationStatusMeta(s))}
                          </option>
                        )),
                      )}
                    </select>
                  </div>
                  <div className="app-toolbar-field">
                    <label htmlFor="service-filter">
                      {choose({ bn: "সেবা", en: "Service" })}
                    </label>
                    <select
                      id="service-filter"
                      value={appService}
                      onChange={(e) => {
                        setAppService(e.target.value);
                        setAppPage(1);
                        writeRoute(
                          filter || e.target.value
                            ? `#/applications?${new URLSearchParams({
                                ...(filter ? { state: filter } : {}),
                                ...(e.target.value ? { service: e.target.value } : {}),
                              })}`
                            : "#/applications",
                        );
                      }}
                    >
                      <option value="">
                        {choose({ bn: "সব সেবা", en: "All services" })}
                      </option>
                      {tx(
                        catalog.map((s) => (
                          <option key={s.service_no} value={s.service_no}>
                            {tx(recordName(s))}
                          </option>
                        )),
                      )}
                    </select>
                  </div>
                </div>
                {(filter || appService || appSearch || appFrom || appTo || appRenewals) && (
                  <div className="app-filter-chips">
                    {filter && (
                      <span className="app-chip">
                        {choose(applicationStatusLabel(filter))}
                        <button
                          type="button"
                          aria-label={choose({ bn: "অবস্থার ফিল্টার সরান", en: "Remove status filter" })}
                          onClick={() => {
                            setFilter("");
                            setAppPage(1);
                          }}
                        >
                          ×
                        </button>
                      </span>
                    )}
                    {appService && (
                      <span className="app-chip">
                        {tx(
                          recordName(
                            catalog.find(
                              (s) => String(s.service_no) === appService,
                            ),
                          ),
                        )}
                        <button
                          type="button"
                          aria-label={choose({ bn: "সেবার ফিল্টার সরান", en: "Remove service filter" })}
                          onClick={() => {
                            setAppService("");
                            setAppPage(1);
                          }}
                        >
                          ×
                        </button>
                      </span>
                    )}
                    {appSearch && (
                      <span className="app-chip">
                        “{appSearch}”
                        <button
                          type="button"
                          aria-label={choose({ bn: "খোঁজা মুছুন", en: "Clear search" })}
                          onClick={() => setAppSearch("")}
                        >
                          ×
                        </button>
                      </span>
                    )}
                    {(appFrom || appTo) && (
                      <span className="app-chip">
                        {appFrom ? formatDate(appFrom, language) : "…"} —{" "}
                        {appTo ? formatDate(appTo, language) : "…"}
                        <button
                          type="button"
                          aria-label={choose({ bn: "তারিখের ফিল্টার সরান", en: "Remove date filter" })}
                          onClick={() => {
                            setAppFrom("");
                            setAppTo("");
                            setAppPage(1);
                          }}
                        >
                          ×
                        </button>
                      </span>
                    )}
                    {appRenewals && (
                      <span className="app-chip">
                        {choose({ bn: "শুধু নবায়ন", en: "Renewals only" })}
                        <button
                          type="button"
                          aria-label={choose({ bn: "নবায়নের ফিল্টার সরান", en: "Remove renewals filter" })}
                          onClick={() => {
                            setAppRenewals(false);
                            setAppPage(1);
                          }}
                        >
                          ×
                        </button>
                      </span>
                    )}
                    <button
                      className="text-button"
                      onClick={clearApplicationFilters}
                    >
                      {choose({ bn: "সব ফিল্টার মুছুন", en: "Clear filters" })}
                    </button>
                  </div>
                )}
                <details className="app-more-filters">
                  <summary>
                    {choose({ bn: "আরও ফিল্টার ও রেফারেন্স খোঁজা", en: "More filters & reference lookup" })}
                  </summary>
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
                    <div className="field">
                      <label htmlFor="application-page-size">
                        {choose({ bn: "প্রতি পৃষ্ঠায় আবেদন", en: "Applications per page" })}
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
                    </div>
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
                      {choose({
                        bn: "রেফারেন্স দিয়ে আবেদন বা সনদ খুঁজুন",
                        en: "Find application or certificate by reference",
                      })}
                    </label>
                    <div className="reference-lookup-controls">
                      <input
                        id="application-reference"
                        value={applicationReference}
                        onChange={(e) => setApplicationReference(e.target.value)}
                        required
                        maxLength={120}
                        aria-describedby="application-reference-hint"
                        placeholder={choose({
                          bn: "সম্পূর্ণ রেফারেন্স নম্বর বা সনদ নম্বর",
                          en: "Full reference or certificate number",
                        })}
                      />
                      {/* FULL-UIUX-01 (B25/P1-15): the button renders at full
                          strength — the required input itself guards the
                          empty submit; it no longer washes out while typing. */}
                      <button disabled={busy}>
                        {choose({ bn: "খুঁজুন", en: "Find record" })}
                      </button>
                    </div>
                    <p id="application-reference-hint" className="hint">
                      {choose({
                        bn: "আপনার অ্যাকাউন্ট বা সনদে থাকা DigitalUnion রেফারেন্স ব্যবহার করুন। অন্য ওয়েবসাইটের নম্বর এখানে চলবে না। ইস্যু হওয়া রেকর্ড খুলে ডাউনলোড বা নবায়ন করা যায়।",
                        en: "Use a DigitalUnion reference from your account or certificate. Numbers issued by other websites are not supported. Open an issued record to download or renew it.",
                      })}
                    </p>
                  </form>
                </details>
                <div className="application-filter-tools">
                  <p className="hint" role="status">
                    {appTotal === null
                      ? "—"
                      : appTotal.toLocaleString(
                          language === "bn" ? "bn-BD" : "en-GB",
                        )}{" "}
                    {choose({ bn: "টি আবেদন", en: "applications" })}
                  </p>
                </div>
              </div>
              {/* CH-004: a failed list fetch shows here with a retry —
                  never a dead screen, and never the misleading "No
                  applications yet" empty state below while the load failed. */}
              {tx(
                appLoadError && (
                  <div className="panel narrow" role="alert">
                    <p>
                      {choose({
                        bn: "আবেদনের তালিকা লোড করা যায়নি।",
                        en: "The applications list could not be loaded.",
                      })}{" "}
                      {tx(appLoadError)}
                    </p>
                    <button type="button" onClick={() => void run(refresh)}>
                      {choose({ bn: "আবার চেষ্টা করুন", en: "Try again" })}
                    </button>
                  </div>
                ),
              )}
              <div className="table-wrap responsive-table">
                <table>
                  <thead>
                    <tr>
                      <th>{choose({ bn: "রেফারেন্স", en: "Reference" })}</th>
                      {/* P2-3: role-shaped columns — a citizen's own list
                          drops the Citizen column (every row is them). */}
                      {role !== "citizen" && (
                        <th>{choose({ bn: "নাগরিক", en: "Citizen" })}</th>
                      )}
                      <th>{choose({ bn: "সেবা", en: "Service" })}</th>
                      <th>{choose({ bn: "অবস্থা", en: "Status" })}</th>
                      <th>
                        <span className="visually-hidden">
                          {choose({ bn: "খুলুন", en: "Open" })}
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {tx(applications.map((a) => applicationRow(a, role === "citizen")))}
                  </tbody>
                </table>
              </div>
              {tx(busy && !applications.length && <SkeletonRows rows={5} />)}
              {tx(
                !busy && !applications.length && !appLoadError && (
                  <EmptyState
                    title={choose(
                      filter || appService || appSearch
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
                      filter || appService || appSearch
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
                      !filter && !appService && !appSearch && canApply ? (
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
                  {tx(applications.map(applicationCard))}
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
                  {tx(appTotal ?? "—")}
                  {t(" results · Page ")}
                  {tx(appPage)}
                  {t(" /")}
                  {tx(" ")}
                  {tx(Math.max(1, Math.ceil((appTotal ?? 0) / appPageSize)))}
                </span>
                <button
                  className="secondary"
                  disabled={busy || appPage * appPageSize >= (appTotal ?? 0)}
                  onClick={() => setAppPage(appPage + 1)}
                >
                  {t("Next applications ")}
                </button>
              </div>
            </section>
          ),
        )}
        {tx(
          page === "applications" && detail && (
            <>
              {/* FULL-UIUX-01 (B18/P1-7 + OWNER-DECISION 3/UX S5): the detail
                  is a two-column surface — the record in the main column,
                  a sticky decision rail beside it (status, reference,
                  completeness, reason, decision actions). */}
              <div className="detail-layout">
              <div className="detail-main">
              <section className="panel">
                <button className="text-button" onClick={closeDetail}>
                  {choose({ bn: "← সব আবেদন", en: "← All applications" })}
                </button>
                <div className="section-heading">
                  <div>
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
                    <RefChip value={application.reference || application.id} />
                  </div>
                  <ApplicationStatus
                    state={String(application.state || application.status || "")}
                  />
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
                {(() => {
                  const detailSchema = (detail.order
                    ? withoutOrderLanguage
                    : (value: ReturnType<typeof getServiceSchema>) => value)(
                    getServiceSchema(
                      application.serviceNo || application.service_no,
                      application.schemaVersion || 1,
                    ),
                  );
                  const canEditPayload =
                    (staff || role === "citizen") &&
                    ["DRAFT", "CORRECTION_REQUIRED"].includes(application.state);
                  // FULL-UIUX-01 (B18/P1-7): a non-editable payload renders
                  // as the shared read-only summary — never a greyed-out
                  // form pretending to be a record.
                  return canEditPayload ? (
                    <>
                      <DynamicForm
                        key={application.id}
                        contextKey={application.id}
                        schema={detailSchema}
                        citizenId={application.citizenId}
                        value={detailPayload}
                        onChange={(v) => setDetail({ ...detail, payload: v })}
                      />
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
                            setMessage(
                              choose({
                                bn: "পরিবর্তন সংরক্ষিত হয়েছে।",
                                en: "Changes saved.",
                              }),
                            );
                          })
                        }
                      >
                        {choose({ bn: "পরিবর্তন সংরক্ষণ করুন", en: "Save changes" })}
                      </button>
                    </>
                  ) : (
                    <PayloadDetails
                      schema={detailSchema}
                      payload={detailPayload}
                    />
                  );
                })()}
                {!approver && <div id="application-actions" tabIndex={-1} />}
                {actionError && (
                  <div
                    role="alert"
                    className="notice message error detail-action-error"
                  >
                    {tx(actionError)}
                  </div>
                )}
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
                          {choose({ bn: "আবেদন বাতিল করুন", en: "Cancel application" })}
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
                          {choose({ bn: "আবেদন জমা দিন", en: "Submit application" })}
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
                          {choose({ bn: "আবার জমা দিন", en: "Resubmit application" })}
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
                      {choose({
                        bn: "এটি একটি নবায়নের আবেদন। আগের সনদ নম্বর: ",
                        en: "This is a renewal application. Source certificate number: ",
                      })}
                      {detail.renewal.sourceNumber ? (
                        <RefChip value={String(detail.renewal.sourceNumber)} />
                      ) : (
                        tx("—")
                      )}
                      {detail.renewal.sourceApplicationId && (
                        <>
                          {tx(" ")}
                          <button
                            type="button"
                            className="text-button"
                            onClick={() =>
                              run(() =>
                                openApplication(detail.renewal.sourceApplicationId),
                              )
                            }
                          >
                            {choose({
                              bn: "আগের আবেদনটি খুলুন",
                              en: "Open the source application",
                            })}
                          </button>
                        </>
                      )}
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
                    (detail.events || [])
                      /* REFINEMENT-02 P2-5: issuance used to appear twice
                         — the approve event ("অনুমোদন সম্পন্ন — সনদ ইস্যু
                         হয়েছে") and a paired state event to ISSUED at the
                         same timestamp. One issuance event: the paired
                         state row is dropped when its approve twin exists. */
                      .filter((event: any, _i: number, all: any[]) => {
                        const toState = event.toState || event.to_state;
                        const actionKey = String(event.action || "").toLowerCase();
                        if (toState !== "ISSUED" || actionKey === "approve")
                          return true;
                        const stamp = event.createdAt || event.created_at;
                        return !all.some(
                          (other: any) =>
                            String(other.action || "").toLowerCase() ===
                              "approve" &&
                            (other.createdAt || other.created_at) === stamp,
                        );
                      })
                      .map((event: any, i: number) => {
                      // FULL-UIUX-01 (B21/P1-10): localised dates, named
                      // actions, actor ROLES — never raw ISO strings or
                      // actor UUIDs.
                      const actionKey = String(
                        event.action || "",
                      ).toLowerCase();
                      const toState = event.toState || event.to_state;
                      const stateMeta = toState
                        ? applicationStatusMeta(String(toState))
                        : null;
                      const label = actionDone[actionKey]
                        ? choose(actionDone[actionKey])
                        : stateMeta
                          ? choose(stateMeta)
                          : choose({
                              bn: "নথিভুক্ত কাজ",
                              en: "Recorded action",
                            });
                      const actorRole =
                        event.actorRole || event.actor_role || event.role;
                      return (
                        <li key={event.id || i}>
                          <strong>{label}</strong>
                          {event.reason && <p>{tx(event.reason)}</p>}
                          <small>
                            {formatDateTime(
                              event.createdAt || event.created_at,
                              language,
                            )}
                            {actorRole && roleLabels[String(actorRole)]
                              ? ` · ${choose(roleLabels[String(actorRole)])}`
                              : ""}
                          </small>
                        </li>
                      );
                    }),
                  )}
                </ol>
                <p className="hint">
                  {choose({ bn: "তথ্যের সংস্করণ: ", en: "Payload versions: " })}
                  {tx(
                    detail.versions?.length != null
                      ? localDigits(String(detail.versions.length), language)
                      : choose({
                          bn: "সার্ভারে সংরক্ষিত",
                          en: "preserved by server",
                        }),
                  )}
                </p>
              </section>
              </div>
              <aside className="detail-rail" aria-label={choose({ bn: "সিদ্ধান্ত ও অবস্থা", en: "Decision and status" })}>
                <div id={approver ? "application-actions" : undefined} tabIndex={-1} />
                <div className="detail-rail-block">
                  <span className="detail-rail-label">
                    {choose({ bn: "বর্তমান অবস্থা", en: "Current status" })}
                  </span>
                  <ApplicationStatus
                    state={String(application.state || application.status || "")}
                  />
                  <span className="detail-rail-label">
                    {choose({ bn: "রেফারেন্স", en: "Reference" })}
                  </span>
                  {/* FULL-UIUX-01 (C32/P2-8): the reference is copyable
                      text (RefChip), never a read-only form input. */}
                  <RefChip value={application.reference || application.id} />
                  <p className="hint">
                    {choose({
                      bn: "এই রেফারেন্স দিয়ে সর্বজনীন অবস্থা পৃষ্ঠায় আবেদনের অবস্থা দেখা যায় — শুধু অবস্থা ও সেবার তথ্য ফেরত আসে।",
                      en: "This reference works on the public tracking page. Only status and service information are returned.",
                    })}
                  </p>
                  {/* P0-4: on non-decision states the rail is a light
                      summary card — status, reference, issued date and
                      a verify link — not an empty slab. */}
                  {detail.certificate && (
                    <>
                      <span className="detail-rail-label">
                        {choose({ bn: "ইস্যুর তারিখ", en: "Issued" })}
                      </span>
                      <span>
                        {formatDate(detail.certificate.issuedAt, language)}
                      </span>
                      <a
                        href={
                          detail.certificate.verificationUrl || "/verify"
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        {choose({
                          bn: "সনদ যাচাই করুন",
                          en: "Verify this certificate",
                        })}
                      </a>
                    </>
                  )}
                </div>
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
                {tx(
                  approver &&
                    (["SUBMITTED", "RESUBMITTED", "UNDER_REVIEW"].includes(
                      application.state,
                    ) ||
                      detail.certificate) && (
                      <div className="detail-rail-block">
                        {/* FULL-UIUX-01 (C33/P2-9): the reason field exists
                            only where a decision is actually made — it no
                            longer leaks into the citizen's correction view. */}
                        <label htmlFor="reason">
                          {choose({
                            bn: "সিদ্ধান্ত বা প্রত্যাহারের কারণ",
                            en: "Decision or revocation reason",
                          })}
                        </label>
                        <textarea
                          id="reason"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          placeholder={choose({
                            bn: "সিদ্ধান্তের কারণ লিখুন",
                            en: "Explain this decision",
                          })}
                        />
                      </div>
                    ),
                )}
                {tx(
                  approver &&
                    ["SUBMITTED", "RESUBMITTED", "UNDER_REVIEW"].includes(
                      application.state,
                    ) && (
                      <div className="detail-rail-actions">
                        {/* QA-14: without an authorization for this service the
                            decision buttons are replaced by a plain note. */}
                        {detail.canApprove === false && (
                          <p className="hint" role="note">
                            {choose({
                              bn: "এই সেবার আবেদন অনুমোদনের ক্ষমতা আপনাকে দেওয়া হয়নি। অফিস প্রশাসককে ‘অনুমোদনের ক্ষমতা’ থেকে এই সেবা যুক্ত করতে বলুন। আপনি সংশোধন চাইতে বা প্রত্যাখ্যান করতে পারবেন।",
                              en: "You are not authorized to approve this service. Ask the office admin to add it under ‘Approval authority’. You can still request a correction or reject.",
                            })}
                          </p>
                        )}
                        {detail.canApprove !== false && (
                        <button
                          disabled={busy}
                          onClick={() => run(() => transition("approve"))}
                        >
                          {choose({
                            bn: "অনুমোদন করে সনদ ইস্যু করুন",
                            en: "Approve and issue certificate",
                          })}
                        </button>
                        )}
                        <button
                          disabled={busy}
                          className="secondary"
                          onClick={() =>
                            run(() => transition("request_correction"))
                          }
                        >
                          {choose({
                            bn: "সংশোধন চান",
                            en: "Request correction",
                          })}
                        </button>
                        {/* QA-14: summon needs the service authorization;
                            reject does not (server rule), so it stays. */}
                        {detail.canApprove !== false && (
                          <button
                            disabled={busy}
                            className="secondary"
                            onClick={() => run(() => transition("summon"))}
                          >
                            {choose({
                              bn: "আবেদনকারীকে আসতে বলুন",
                              en: "Ask the applicant to come",
                            })}
                          </button>
                        )}
                        {/* P0-4: the destructive action is separated from
                            the decision stack by a divider. */}
                        <div
                          className="detail-rail-divider"
                          aria-hidden="true"
                        />
                        <button
                          className="danger"
                          disabled={busy}
                          onClick={() => run(() => transition("reject"))}
                        >
                          {choose({ bn: "প্রত্যাখ্যান করুন", en: "Reject application" })}
                        </button>
                      </div>
                    ),
                )}
                {tx(
                  approver &&
                    ["APPROVED", "ISSUANCE_PENDING", "ISSUED"].includes(
                      application.state,
                    ) && (
                      <div className="detail-rail-actions">
                        {/* PORTAL-C: once issued, re-issuing is a safe
                            recovery (it returns the same certificate), not
                            the next step — it must not look like one. */}
                        <button
                          className={application.state === "ISSUED" ? "secondary" : undefined}
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
                                choose({
                                  bn: "সনদ ইস্যু হয়েছে। আবেদনের ফি জমার সময়ই নিষ্পত্তি হয়েছে; আবার চেষ্টা করলে একই সনদই ফেরত আসবে।",
                                  en: "Certificate issued. The application fee was settled at submission; retries return the same certificate.",
                                }),
                              );
                            })
                          }
                        >
                          {application.state === "ISSUED"
                            ? choose({
                                bn: "নিরাপদে আবার ইস্যু চেষ্টা করুন",
                                en: "Retry issuance safely",
                              })
                            : choose({ bn: "সনদ ইস্যু করুন", en: "Issue certificate" })}
                        </button>
                      </div>
                    ),
                )}
              </aside>
              </div>
            </>
          ),
        )}
        {tx(
          page === "pending" && (
            <>
              {pendingGroupSection(
                { bn: "পর্যালোচনার অপেক্ষায়", en: "Awaiting review" },
                pendingCounts ? pendingCounts.awaitingReview : null,
                pendingReviewStates,
              )}
              {pendingGroupSection(
                { bn: "সনদ ইস্যুর অপেক্ষায়", en: "Awaiting issuance" },
                pendingCounts ? pendingCounts.awaitingIssuance : null,
                pendingIssuanceStates,
              )}
              <p className="hint">
                {choose({
                  bn: "সংশোধনের জন্য ফেরত পাঠানো আবেদন এই তালিকায় নেই — সেটির পরের পদক্ষেপ নাগরিকের।",
                  en: "Applications sent back for correction are not listed here — the next step there is the citizen's.",
                })}
              </p>
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
                    {localDigits(
                      String(wallet?.balance ?? wallet?.wallet?.balance ?? 0),
                      language,
                    )}
                  </strong>
                  <small>
                    {t("Cost follows your office service settings")}
                  </small>
                  {/* P2-6: one summary card — the top-up CTA sits at the
                      top with the balance it affects. */}
                  <a className="text-button" href="#billing-topup">
                    {choose({ bn: "টপ-আপ করুন ↓", en: "Top up ↓" })}
                  </a>
                </div>
                <div className="stat">
                  {/* FULL-UIUX-01 (B16/P0-4): the second stat is the office's
                      subscription standing — the "Sandbox" environment
                      headline is gone from the billing surface. */}
                  <span>
                    {choose({ bn: "সাবস্ক্রিপশন", en: "SUBSCRIPTION" })}
                  </span>
                  <strong>
                    {billing?.subscription
                      ? billing.subscription.status === "ACTIVE"
                        ? choose({ bn: "সক্রিয়", en: "Active" })
                        : billing.subscription.status === "PAST_DUE"
                          ? choose({ bn: "বকেয়া আছে", en: "Past due" })
                          : billing.subscription.status === "EXPIRED"
                            ? choose({ bn: "মেয়াদ শেষ", en: "Expired" })
                            : billing.subscription.status === "CANCELLED"
                              ? choose({ bn: "বাতিল", en: "Cancelled" })
                              : choose({ bn: "নথিভুক্ত অবস্থা", en: "Recorded status" })
                      : choose({ bn: "নেই", en: "None" })}
                  </strong>
                  <small>
                    {billing?.subscription
                      ? tx(
                          (billing?.plans || []).find(
                            (plan: any) =>
                              plan.id === billing.subscription.planId,
                          )?.name ||
                            billing?.currentPlan?.name ||
                            "",
                        ) ||
                        choose({
                          bn: "নিচে বিস্তারিত দেখুন",
                          en: "See details below",
                        })
                      : choose({
                          bn: "সক্রিয় সাবস্ক্রিপশন নেই",
                          en: "No active subscription",
                        })}
                  </small>
                </div>
              </div>
              <PointsWallet>
                <RechargeRequests />
              </PointsWallet>
              <OfficeRefunds />
              <section className="panel" id="billing-topup">
                <h2>{t("Subscription and top-up")}</h2>
                {/* P2-6: plan / status / balance live ONCE, in the summary
                    card at the top of this page — not repeated here. */}
                {!billing?.subscription && (
                  <p className="hint">
                    {choose({
                      bn: "কোনো সক্রিয় সাবস্ক্রিপশন নেই",
                      en: "No active subscription",
                    })}
                  </p>
                )}
                <label htmlFor="order-coupon-code">
                  {choose({ bn: "কুপন কোড (যদি থাকে)", en: "Coupon code (if any)" })}
                </label>
                <input
                  id="order-coupon-code"
                  value={orderCoupon}
                  onChange={(e) => setOrderCoupon(e.target.value)}
                  placeholder={choose({ bn: "কোড লিখুন", en: "Enter code" })}
                />
                <div className="actions">
                  <button
                    onClick={() =>
                      run(async () => {
                        await api("/billing/orders", "POST", {
                          kind: "topup",
                          credits: 10,
                          ...(orderCoupon.trim()
                            ? { couponCode: orderCoupon.trim() }
                            : {}),
                        });
                        setBilling(await api("/billing"));
                        setMessage(
                          choose({
                            bn: "১০ ক্রেডিটের টপ-আপ অর্ডার তৈরি হয়েছে।",
                            en: "10-credit top-up order created.",
                          }),
                        );
                      })
                    }
                  >
                    {choose({ bn: "১০ ক্রেডিট টপ-আপ করুন", en: "Create 10-credit top-up" })}
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
                              ...(orderCoupon.trim()
                                ? { couponCode: orderCoupon.trim() }
                                : {}),
                            });
                            setBilling(await api("/billing"));
                            setMessage(
                              choose({
                                bn: "সাবস্ক্রিপশন অর্ডার তৈরি হয়েছে।",
                                en: "Subscription order created.",
                              }),
                            );
                          })
                        }
                      >
                        {choose({ bn: "নবায়ন: ", en: "Renew " })}
                        {planNameText(plan.name)}
                        {choose({ bn: " প্ল্যান", en: " plan" })}
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
                            <td>
                              {o.kind === "topup"
                                ? choose({ bn: "টপ-আপ", en: "Top-up" })
                                : o.kind === "subscription"
                                  ? choose({ bn: "সাবস্ক্রিপশন", en: "Subscription" })
                                  : tx(o.kind)}
                            </td>
                            <td>
                              {tx(o.amountMinor ?? o.amount_minor)}
                              {tx(
                                o.couponCode
                                  ? ` · ${o.couponCode} −${o.discountMinor ?? 0}`
                                  : "",
                              )}
                            </td>
                            <td>
                              {o.status === "SETTLED"
                                ? choose({ bn: "নিষ্পত্তি হয়েছে", en: "Settled" })
                                : o.status === "PENDING"
                                  ? choose({ bn: "অপেক্ষমাণ", en: "Pending" })
                                  : o.status === "CANCELLED"
                                    ? choose({ bn: "বাতিল", en: "Cancelled" })
                                    : o.status === "EXPIRED"
                                      ? choose({ bn: "মেয়াদ শেষ", en: "Expired" })
                                      : o.status === "FAILED"
                                        ? choose({ bn: "ব্যর্থ", en: "Failed" })
                                        : choose({ bn: "নথিভুক্ত অবস্থা", en: "Recorded status" })}
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
                                          choose({
                                            bn: "পেমেন্ট নিষ্পত্তি সম্পন্ন হয়েছে। একই অর্ডারে পুনরায় নিষ্পত্তি করলে দুইবার ক্রেডিট যোগ হবে না।",
                                            en: "Payment settled. Settling the same order again cannot grant credits twice.",
                                          }),
                                        );
                                      })
                                    }
                                  >
                                    {choose({ bn: "পেমেন্ট নিষ্পত্তি করুন", en: "Settle payment" })}
                                  </button>
                                ),
                              )}
                            </td>
                          </tr>
                        )),
                      )}
                      {/* P2-6: in-body empty row (see ledger). */}
                      {!(billing?.orders || []).length && (
                        <tr>
                          <td colSpan={4} className="empty-cell">
                            {choose({
                              bn: "এখনো কোনো অর্ডার নেই — টপ-আপ বা সাবস্ক্রিপশন অর্ডার তৈরি করলে এখানে দেখা যাবে।",
                              en: "No orders yet — top-up and subscription orders will appear here.",
                            })}
                          </td>
                        </tr>
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
                            <td>{choose(ledgerKindMeta(l.kind))}</td>
                            <td>{localDigits(String(l.delta ?? 0), language)}</td>
                            <td>{ledgerReasonText(l.reason)}</td>
                            <td>
                              {formatDateTime(l.createdAt || l.created_at, language)}
                            </td>
                          </tr>
                        )),
                      )}
                      {/* P2-6: the empty state lives INSIDE the table
                          body, not as a card floating below the header. */}
                      {!(wallet?.ledger || []).length && (
                        <tr>
                          <td colSpan={4} className="empty-cell">
                            {choose({
                              bn: "খতিয়ানে এখনো কোনো এন্ট্রি নেই — ক্রেডিট যোগ বা খরচ হলে প্রতিটি এন্ট্রি এখানে থাকবে।",
                              en: "No ledger entries yet — every credit addition or charge will be listed here.",
                            })}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
              {/* P2-6: sections with no data do not render at all. */}
              {(billing?.invoices || []).length > 0 && (
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
              )}
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
          {/* FULL-UIUX-01: the staff guide opens as a themed in-workspace
              page (the accordion), not a trip out to the public shell. */}
          {tx(
            page === "guide" && (
              <React.Suspense
                fallback={<p role="status">{t("Loading…")}</p>}
              >
                <UserGuide />
              </React.Suspense>
            ),
          )}
          {tx(
            [
              "profile",
              "prints",
              "notifications",
              "reports",
              "support",
            ].includes(page) && (
              <AdditionalWorkspace
                page={page}
                session={session}
                onOpenApplication={(id) => void run(() => openApplication(id))}
              />
            ),
          )}
          {tx(
            page === "owner" && (
              <div className="owner-console">
                {/* OWNER-REDESIGN-01: the owner console is a sectioned console —
                    a sticky sub-navigation (vertical on desktop, horizontal tab
                    bar on mobile) with exactly ONE section visible at a time,
                    chosen by state; the links keep their #owner-* hrefs so the
                    hash, reloads and deep links agree with the visible section.
                    Branding + witness types moved out of Overview into their
                    own Settings section. Every control, field, validation and
                    action is unchanged — presentation only. */}
                <nav
                  className="owner-nav"
                  aria-label={choose({
                    bn: "প্ল্যাটফর্ম ব্যবস্থাপনার অংশসমূহ",
                    en: "Platform management sections",
                  })}
                >
                  {/* REFINEMENT-02 P1-11: the owner nav now speaks the
                      workspace sidebar language — grouped sections with
                      icons and the shared item geometry, not a pill stack. */}
                  {(
                    [
                      {
                        title: { bn: "প্ল্যাটফর্ম", en: "Platform" },
                        items: [
                          ["overview", "dashboard", { bn: "সারসংক্ষেপ", en: "Overview" }],
                          ["offices", "home", { bn: "অফিসসমূহ", en: "Offices" }],
                          ["demand", "applications", { bn: "নিবন্ধনের চাহিদা", en: "Registration demand" }],
                        ],
                      },
                      {
                        title: { bn: "ব্যবসা", en: "Business" },
                        items: [
                          ["subscriptions", "billing", { bn: "সাবস্ক্রিপশন", en: "Subscriptions" }],
                          ["pricing", "payments", { bn: "মূল্য নির্ধারণ", en: "Pricing" }],
                          ["coupons", "reports", { bn: "কুপন", en: "Coupons" }],
                        ],
                      },
                      {
                        title: { bn: "সিস্টেম", en: "System" },
                        items: [
                          ["notices", "notifications", { bn: "নোটিশ", en: "Notices" }],
                          ["permissions", "security", { bn: "অনুমতি", en: "Permissions" }],
                          ["audit", "search", { bn: "অডিট", en: "Audit" }],
                          ["settings", "admin", { bn: "সেটিংস", en: "Settings" }],
                        ],
                      },
                    ] as const
                  ).map((group) => (
                    <div className="ws-nav-group" key={group.title.en}>
                      <span className="ws-nav-group-title">{choose(group.title)}</span>
                      {group.items.map(([key, icon, text]) => (
                        <a
                          key={key}
                          href={`#owner-${key}`}
                          aria-current={ownerSection === key ? "page" : undefined}
                          onClick={() => setOwnerSection(key)}
                        >
                          <NavIcon name={icon} />
                          <span>{choose(text)}</span>
                        </a>
                      ))}
                    </div>
                  ))}
                </nav>
                <div className="owner-content">
                {ownerSection === "overview" && (
                <section className="owner-section" id="owner-overview">
                  <h2>{choose({ bn: "সারসংক্ষেপ", en: "Overview" })}</h2>
                  {/* P1-11: overview KPIs use the shared StatCard, like
                      every other dashboard in the product. */}
                  <div className="kpi-grid">
                    <StatCard
                      label={choose({ bn: "মোট অফিস", en: "Offices" })}
                      value={localDigits(String(tenants.length), language)}
                      context={choose({ bn: "নিবন্ধিত অফিস", en: "Registered offices" })}
                      icon={<NavIcon name="home" />}
                    />
                    <StatCard
                      label={choose({ bn: "সক্রিয় সাবস্ক্রিপশন", en: "Active subscriptions" })}
                      value={localDigits(
                        String(
                          tenants.filter((t) => t.subscription?.status === "ACTIVE").length,
                        ),
                        language,
                      )}
                      context={choose({ bn: "চলমান মেয়াদসহ অফিস", en: "Offices in a running term" })}
                      icon={<NavIcon name="billing" />}
                    />
                    {/* WS4 (Phase 3 remainder), integrated at BUNDLE-06 merge:
                        total credits across all office wallets, from the
                        already-loaded tenants list — no extra fetch. */}
                    <StatCard
                      label={choose({ bn: "মোট ক্রেডিট", en: "Total credits" })}
                      value={localDigits(
                        String(
                          tenants.reduce(
                            (sum, t) => sum + (Number(t.balance ?? t.walletBalance) || 0),
                            0,
                          ),
                        ),
                        language,
                      )}
                      context={choose({ bn: "সব অফিসের ব্যালান্সের যোগফল", en: "Sum of all office balances" })}
                      icon={<NavIcon name="payments" />}
                    />
                    <OwnerSettledRevenueCard />
                  </div>
                  {/* W-010: notification provider health — a log provider
                      sends nothing, so the card says so plainly. */}
                  <NotificationHealthCard />
                  <OwnerOperations
                    onOpen={(section, selector) => {
                      // PORTAL-D: open the section that handles the queue,
                      // then bring its (lazily loaded) panel into view.
                      setOwnerSection(section);
                      let tries = 0;
                      const bring = () => {
                        const panel = document.querySelector<HTMLElement>(selector);
                        if (panel) {
                          panel.scrollIntoView({ block: "start" });
                          panel.querySelector<HTMLElement>("h2, h3")?.setAttribute("tabindex", "-1");
                          panel.querySelector<HTMLElement>("h2, h3")?.focus({ preventScroll: true });
                        } else if (++tries < 40) window.setTimeout(bring, 50);
                      };
                      window.setTimeout(bring, 0);
                    }}
                  />
                </section>
                )}
                {ownerSection === "offices" && (
                <section className="owner-section" id="owner-offices">
                  <h2>{choose({ bn: "অফিসসমূহ", en: "Offices" })}</h2>
                  {/* FULL-UIUX-01 (C34/P2-10): the offices section is list-first — the office register leads, onboarding and requests follow. */}
                  {/* DESIGN-PHASE-C: the register itself — one row per office
                      (status, plan, subscription, credits, expiry) so the
                      owner reads the whole platform before opening a card. */}
                  <section className="panel owner-glance" aria-labelledby="owner-glance-title">
                    <h3 id="owner-glance-title">
                      {choose({ bn: "এক নজরে অফিসসমূহ", en: "Offices at a glance" })}
                    </h3>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>{choose({ bn: "অফিস", en: "Office" })}</th>
                            <th>{choose({ bn: "অবস্থা", en: "Status" })}</th>
                            <th>{choose({ bn: "প্ল্যান", en: "Plan" })}</th>
                            <th>{choose({ bn: "সাবস্ক্রিপশন", en: "Subscription" })}</th>
                            <th className="num">{choose({ bn: "ক্রেডিট", en: "Credits" })}</th>
                            <th>{choose({ bn: "মেয়াদ", en: "Valid until" })}</th>
                            <th className="num">{choose({ bn: "বাকি সময়", en: "Time left" })}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tenants.map((officeTenant) => {
                            const sub = officeTenant.subscription;
                            const validTime = sub?.validUntil
                              ? new Date(String(sub.validUntil)).getTime()
                              : Number.NaN;
                            const days = Number.isNaN(validTime)
                              ? null
                              : Math.ceil((validTime - Date.now()) / 86_400_000);
                            return (
                              <tr key={officeTenant.id}>
                                <td>{tx(recordName(officeTenant))}</td>
                                <td>
                                  <StatusBadge tone={statusTone(officeTenant.status)}>
                                    {officeTenant.status === "ACTIVE"
                                      ? choose({ bn: "সক্রিয়", en: "Active" })
                                      : officeTenant.status === "SUSPENDED"
                                        ? choose({ bn: "স্থগিত", en: "Suspended" })
                                        : choose({ bn: "নথিভুক্ত অবস্থা", en: "Recorded status" })}
                                  </StatusBadge>
                                </td>
                                <td>{sub ? sub.planId : "—"}</td>
                                <td>
                                  {sub ? (
                                    <StatusBadge tone={statusTone(sub.status)}>
                                      {sub.status === "ACTIVE"
                                        ? choose({ bn: "সক্রিয়", en: "Active" })
                                        : sub.status === "SUSPENDED"
                                          ? choose({ bn: "স্থগিত", en: "Suspended" })
                                          : choose({ bn: "মেয়াদোত্তীর্ণ", en: "Expired" })}
                                    </StatusBadge>
                                  ) : (
                                    "—"
                                  )}
                                </td>
                                <td className="num">
                                  {localDigits(
                                    String(Number(officeTenant.balance ?? officeTenant.walletBalance) || 0),
                                    language,
                                  )}
                                </td>
                                <td>
                                  {sub?.validUntil ? formatDate(sub.validUntil, language) : "—"}
                                </td>
                                <td className="num">
                                  {days === null
                                    ? "—"
                                    : days >= 0
                                      ? choose({
                                          bn: `${localDigits(String(days), language)} দিন বাকি`,
                                          en: `${days} days left`,
                                        })
                                      : choose({
                                          bn: `${localDigits(String(-days), language)} দিন আগে শেষ`,
                                          en: `${-days} days past expiry`,
                                        })}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                  <section className="panel">
              <h3>{t("Tenant credit management")}</h3>
              <p>
                {t(
                  "Owner adjustments require a reason and append a compensating ledger entry. Official approval authority belongs to assigned tenant officials. ",
                )}
              </p>
              {tx(
                tenants.map((officeTenant) => (
                  <div className="tenant-card" key={officeTenant.id}>
                    <div className="office-card-head">
                      <h3>
                        {tx(recordName(officeTenant))}
                        <StatusBadge tone={statusTone(officeTenant.status)}>
                          {officeTenant.status === "ACTIVE"
                            ? choose({ bn: "সক্রিয়", en: "Active" })
                            : officeTenant.status === "SUSPENDED"
                              ? choose({ bn: "স্থগিত", en: "Suspended" })
                              : choose({ bn: "নথিভুক্ত অবস্থা", en: "Recorded status" })}
                        </StatusBadge>
                      </h3>
                      <button
                        className={
                          officeTenant.status === "ACTIVE" ? "danger" : undefined
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
                            setMessage(
                              choose({
                                bn: "অফিসের অবস্থা হালনাগাদ হয়েছে।",
                                en: "Tenant status updated.",
                              }),
                            );
                          })
                        }
                      >
                        {tx(
                          officeTenant.status === "ACTIVE"
                            ? "Suspend office"
                            : "Activate office",
                        )}
                      </button>
                    </div>
                    <div className="labelled-fields">
                      <div className="labelled-field">
                        <span className="field-label">{t("Credits")}</span>
                        <span className="field-value">
                          {tx(
                            officeTenant.balance ??
                              officeTenant.walletBalance ??
                              "see ledger",
                          )}
                        </span>
                      </div>
                    </div>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const data = new FormData(e.currentTarget);
                        run(async () => {
                          const requestKey = walletAdjustKey(officeTenant.id);
                          await api(
                            `/owner/tenants/${officeTenant.id}/adjust`,
                            "POST",
                            {
                              delta: Number(data.get("delta")),
                              reason: data.get("reason"),
                              requestKey,
                            },
                          );
                          walletAdjustKeys.delete(officeTenant.id);
                          await refresh();
                          setMessage(
                            choose({
                              bn: "অডিটসহ ক্ষতিপূরণমূলক এন্ট্রি যোগ হয়েছে।",
                              en: "Audited compensating entry added.",
                            }),
                          );
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
                    <OwnerSubscriptionPanel
                      tenantId={officeTenant.id}
                      subscription={officeTenant.subscription}
                      plans={plans}
                      onChanged={refresh}
                    />
                  </div>
                )),
              )}
                  </section>
                  <OwnerOnboarding onSaved={refresh} />
                  <OwnerInclusionRequests />
                  <OwnerRecharges />
                </section>
                )}
                {ownerSection === "demand" && (
                <section className="owner-section" id="owner-demand">
                  <h2>{choose({ bn: "নিবন্ধনের চাহিদা", en: "Registration demand" })}</h2>
                  <OwnerDemand />
                </section>
                )}
                {ownerSection === "subscriptions" && (
                <section className="owner-section" id="owner-subscriptions">
                  <h2>{choose({ bn: "সাবস্ক্রিপশন", en: "Subscriptions" })}</h2>
                  <p className="hint">
                    {choose({
                      bn: "প্রতিটি অফিসের সাবস্ক্রিপশন চালু করা, মেয়াদ বাড়ানো, স্থগিত করা ও প্ল্যান বদল — অফিস অংশে প্রতিটি অফিসের কার্ডে নিয়ন্ত্রণ করা যায়। এই অংশে প্ল্যানের তালিকা ও অপেক্ষমাণ পেমেন্ট অর্ডার থাকে।",
                      en: "Activating, extending, suspending and changing each office's subscription is controlled on its card in the Offices section. This section holds the plan catalogue and the waiting payment orders.",
                    })}
                  </p>
                  <OwnerPlans />
                  <OwnerPendingOrders />
                </section>
                )}
                {ownerSection === "pricing" && (
                <section className="owner-section" id="owner-pricing">
                  <h2>{choose({ bn: "মূল্য নির্ধারণ", en: "Pricing" })}</h2>
                  <OwnerPricing />
                </section>
                )}
                {ownerSection === "coupons" && (
                <section className="owner-section" id="owner-coupons">
                  <h2>{choose({ bn: "কুপন", en: "Coupons" })}</h2>
                  <OwnerCoupons />
                </section>
                )}
                {ownerSection === "notices" && (
                <section className="owner-section" id="owner-notices">
                  <h2>{choose({ bn: "নোটিশ", en: "Notices" })}</h2>
                  <OwnerNotices />
                </section>
                )}
                {ownerSection === "permissions" && (
                <section className="owner-section" id="owner-permissions">
                  <h2>{choose({ bn: "অনুমতি", en: "Permissions" })}</h2>
                  <OwnerAccountRequests />
                </section>
                )}
                {ownerSection === "audit" && (
                <section className="owner-section" id="owner-audit">
                  <h2>{choose({ bn: "অডিট", en: "Audit" })}</h2>
                  <OwnerAudit />
                </section>
                )}
                {ownerSection === "settings" && (
                <section className="owner-section" id="owner-settings">
                  <h2>{choose({ bn: "সেটিংস", en: "Settings" })}</h2>
                  <OwnerBranding />
                  <OwnerWitnessTypes />
                </section>
                )}
                </div>
              </div>
            ),
          )}
        </AsyncPanel>
        <footer>
          {branding.name} · {choose({ bn: branding.taglineBn, en: branding.taglineEn })}
        </footer>
      </main>
      {/* QAFIX-09 (B1): the irreversible-decision confirmation —
          an in-app modal replacing window.confirm (QA-13). It
          names the application it will act on; confirming runs
          the same transition the button asked for. */}
      {tx(
        confirmAction && application && (
          <div
            className="ws-confirm-backdrop"
            onClick={() => setConfirmAction(null)}
          >
            <div
              className="ws-confirm"
              role="dialog"
              aria-modal="true"
              aria-label={actionText[confirmAction]}
              onClick={(event) => event.stopPropagation()}
            >
              <h2>{choose(transitionConfirmTitle[confirmAction])}</h2>
              <p>
                {choose({ bn: "আবেদন নম্বর", en: "Application" })}
                {tx(": ")}
                <strong>{tx(application.reference)}</strong>
              </p>
              <p>{choose(transitionConfirmText[confirmAction])}</p>
              <div className="ws-confirm-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setConfirmAction(null)}
                >
                  {choose({ bn: "বাতিল", en: "Cancel" })}
                </button>
                <button
                  type="button"
                  className={confirmAction === "reject" ? "danger" : undefined}
                  data-testid="confirm-transition"
                  disabled={busy}
                  onClick={() => {
                    const action = confirmAction;
                    setConfirmAction(null);
                    void run(() => runTransition(action));
                  }}
                >
                  {choose(transitionConfirmButton[confirmAction])}
                </button>
              </div>
            </div>
          </div>
        ),
      )}
      {/* FULL-UIUX-01 (B27/P1-12): the phone workspace gets a bottom tab
          bar — the role's top destinations (the pending tab carries the
          queue count) plus a "আরও" sheet with every page. The desktop
          #workspace-jump select is deleted outright. */}
      {phoneLayout && (
        <>
          {tabSheet && (
            <div
              className="ws-tab-sheet"
              role="dialog"
              aria-label={choose({ bn: "সব পৃষ্ঠা", en: "All pages" })}
            >
              {visiblePages.map((p) => (
                <button
                  key={p}
                  type="button"
                  data-page={p}
                  aria-current={page === p ? "page" : undefined}
                  onClick={() => {
                    setTabSheet(false);
                    nav(p);
                  }}
                >
                  <NavIcon name={p} />
                  <span>{choose({ bn: localized[p], en: labels[p] })}</span>
                </button>
              ))}
            </div>
          )}
          <nav
            className="ws-tabbar"
            aria-label={choose({ bn: "প্রধান পৃষ্ঠা", en: "Main pages" })}
          >
            {["home", "pending", "applications", "services", "citizens", "profile"]
              .filter((p) => visiblePages.includes(p))
              .slice(0, 4)
              .map((p) => (
                <button
                  key={p}
                  type="button"
                  data-tab={p}
                  aria-current={page === p ? "page" : undefined}
                  onClick={() => {
                    setTabSheet(false);
                    nav(p);
                  }}
                >
                  <NavIcon name={p} />
                  <span>
                    {p === "home"
                      ? choose({ bn: "হোম", en: "Home" })
                      : p === "pending"
                        ? choose({ bn: "অপেক্ষমাণ", en: "Pending" })
                        : p === "applications"
                          ? choose({ bn: "আবেদন", en: "Applications" })
                          : p === "services"
                            ? choose({ bn: "সেবা", en: "Services" })
                            : p === "citizens"
                              ? choose({ bn: "নাগরিক", en: "Citizens" })
                              : choose({ bn: "প্রোফাইল", en: "Profile" })}
                  </span>
                  {p === "pending" && pendingBadge ? (
                    <span className="ws-nav-badge">
                      {localDigits(String(pendingBadge), language)}
                    </span>
                  ) : null}
                </button>
              ))}
            <button
              type="button"
              data-tab="more"
              aria-expanded={tabSheet}
              onClick={() => setTabSheet(!tabSheet)}
            >
              <NavIcon name="more" />
              <span>{choose({ bn: "আরও", en: "More" })}</span>
            </button>
          </nav>
        </>
      )}
    </div>
  );
}
