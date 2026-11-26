import {
  t,
  tx,
  choose,
  recordName,
  useLanguage,
  LanguageSwitcher,
} from "./i18n.js";
import { randomUUID } from "./uuid.js";
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  operationalServiceNumbers,
  getServiceSchema,
  type FormSchema,
} from "@astra/shared-schemas/web";
import { api, clearSessionToken, items } from "./api.js";
import { useBranding } from "./branding.js";
import { GlobalNoticeBanner } from "./GlobalNotices.js";
import { DemoModeBanner } from "./DemoModeBanner.js";
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
import {
  AttachmentStatus,
  type AttachmentHandle,
} from "./AttachmentStatus.js";
import { WorkspaceDashboard } from "./WorkspaceDashboard.js";
import { CitizenDashboard } from "./CitizenDashboard.js";
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
// W-012: global platform statistics on the owner overview.
const OwnerStatistics = lazyWithRetry(() => import("./OwnerStatistics.js"), (m) => m.OwnerStatistics);
// W-020: the platform-health screen.
const OwnerPlatformHealth = lazyWithRetry(() => import("./OwnerPlatformHealth.js"), (m) => m.OwnerPlatformHealth);
const OwnerAccountRequests = lazyWithRetry(() => import("./OwnerAccountRequests.js"), (m) => m.OwnerAccountRequests);
const OwnerRecharges = lazyWithRetry(() => import("./Recharge.js"), (m) => m.OwnerRecharges);
const RechargeRequests = lazyWithRetry(() => import("./Recharge.js"), (m) => m.RechargeRequests);
const OwnerInclusionRequests = lazyWithRetry(() => import("./OfficeInclusion.js"), (m) => m.OwnerInclusionRequests);
const OwnerWitnessTypes = lazyWithRetry(() => import("./WitnessGenerator.js"), (m) => m.OwnerWitnessTypes);
const PointsWallet = lazyWithRetry(() => import("./PointsWallet.js"), (m) => m.PointsWallet);
const OwnerPricing = lazyWithRetry(() => import("./OwnerPricing.js"), (m) => m.OwnerPricing);
const OwnerPlans = lazyWithRetry(() => import("./OwnerPlans.js"), (m) => m.OwnerPlans);
const OwnerBranding = lazyWithRetry(() => import("./OwnerBranding.js"), (m) => m.OwnerBranding);
const OwnerSupportContact = lazyWithRetry(() => import("./OwnerSupportContact.js"), (m) => m.OwnerSupportContact);
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
    key = randomUUID();
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
  security: "Account settings",
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
  security: "অ্যাকাউন্ট সেটিংস",
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
  revoke: {
    bn: "সনদ প্রত্যাহার করা হয়েছে।",
    en: "Certificate revoked.",
  },
};
/** QA-13 → QAFIX-09 (B1): the irreversible decisions (approve,
    reject, revoke) are confirmed in an in-app modal in the reader's
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
  request_correction: {
    bn: "আবেদনকারীকে জানানো হবে কোন তথ্য সংশোধন করতে হবে এবং কত দিনের মধ্যে।",
    en: "The applicant will be told what to correct and by when.",
  },
  summon: {
    bn: "আবেদনকারীকে জানানো হবে কবে ও কোথায় আসতে হবে। আবেদনটি জমা দেওয়া অবস্থায়ই থাকবে।",
    en: "The applicant will be told when and where to come. The application stays submitted.",
  },
  revoke: {
    bn: "এই সনদটি প্রত্যাহার করলে তা ফেরানো যাবে না।",
    en: "Revoking this certificate cannot be undone.",
  },
};
const transitionConfirmTitle: Record<string, { bn: string; en: string }> = {
  approve: {
    bn: "অনুমোদন করে সনদ ইস্যু করুন",
    en: "Approve and issue certificate",
  },
  reject: { bn: "প্রত্যাখ্যান করুন", en: "Reject application" },
  request_correction: { bn: "সংশোধন চান", en: "Request correction" },
  summon: {
    bn: "আবেদনকারীকে আসতে বলুন",
    en: "Ask the applicant to come",
  },
  revoke: { bn: "সনদ প্রত্যাহার করুন", en: "Revoke certificate" },
};
const transitionConfirmButton: Record<string, { bn: string; en: string }> = {
  approve: { bn: "হ্যাঁ, অনুমোদন করুন", en: "Confirm approval" },
  reject: { bn: "হ্যাঁ, প্রত্যাখ্যান করুন", en: "Confirm rejection" },
  request_correction: { bn: "সংশোধনের অনুরোধ পাঠান", en: "Send correction request" },
  summon: { bn: "আসতে বলুন", en: "Ask to come" },
  revoke: { bn: "হ্যাঁ, প্রত্যাহার করুন", en: "Confirm revocation" },
};
/** WS-D2 (item 16): decision dialogs carry preset reasons — a rejection,
    correction request or summons is never sent without a reason. The
    presets are the reason the citizen reads; the free-text note adds
    detail. "অন্যান্য" always needs the note (enforced in the dialog). */
const rejectReasons: { value: string; bn: string; en: string }[] = [
  { value: "incomplete", bn: "তথ্য অসম্পূর্ণ", en: "Information is incomplete" },
  { value: "incorrect", bn: "ভুল তথ্য দেওয়া হয়েছে", en: "Incorrect information was given" },
  { value: "missing-document", bn: "প্রয়োজনীয় নথি জমা হয়নি", en: "A required document was not submitted" },
  { value: "ineligible", bn: "সেবার শর্ত পূরণ হয়নি", en: "The service conditions are not met" },
  { value: "other", bn: "অন্যান্য", en: "Other" },
];
const correctionReasons: { value: string; bn: string; en: string }[] = [
  { value: "wrong-info", bn: "তথ্যে ভুল আছে", en: "Some information is wrong" },
  { value: "unreadable-document", bn: "নথি অস্পষ্ট বা পড়া যাচ্ছে না", en: "A document is unclear or unreadable" },
  { value: "missing-document", bn: "প্রয়োজনীয় নথি জমা হয়নি", en: "A required document was not submitted" },
  { value: "unverifiable", bn: "ঠিকানা বা পরিচয় যাচাই করা যায়নি", en: "The address or identity could not be verified" },
  { value: "other", bn: "অন্যান্য", en: "Other" },
];
const summonReasons: { value: string; bn: string; en: string }[] = [
  { value: "verify-originals", bn: "মূল নথি যাচাই করতে হবে", en: "Original documents must be verified" },
  { value: "verify-info", bn: "তথ্য যাচাই করতে হবে", en: "Information must be verified" },
  { value: "signature", bn: "স্বাক্ষর প্রয়োজন", en: "A signature is required" },
  { value: "other", bn: "অন্যান্য", en: "Other" },
];
/** WS-D2 (item 16): correction deadlines are presets, never a date
    picker — the chairman picks a window, the reason carries it. */
const correctionDeadlines: { value: string; bn: string; en: string }[] = [
  { value: "3", bn: "৩ দিন", en: "3 days" },
  { value: "7", bn: "৭ দিন", en: "7 days" },
  { value: "14", bn: "১৪ দিন", en: "14 days" },
  { value: "30", bn: "৩০ দিন", en: "30 days" },
];
/** WS-D2 (item 9): the citizen's linked identity document (NID / birth
    registration image) is an attachment like any other — its scan state
    and gated download come from the shared AttachmentStatus display.
    Only the handle (mime + bytes) is fetched here, from the status
    endpoint; AttachmentStatus itself is untouched. */
function IdentityDocumentStatus({
  attachmentId,
  kind,
}: {
  attachmentId: string;
  kind: string;
}) {
  useLanguage();
  const [handle, setHandle] = useState<AttachmentHandle | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setHandle(null);
    setFailed(false);
    api(`/attachments/${attachmentId}/status`)
      .then((status: any) => {
        if (!live) return;
        if (
          typeof status?.mimeType === "string" &&
          typeof status?.byteLength === "number"
        )
          setHandle({
            attachmentId,
            mimeType: status.mimeType,
            byteLength: status.byteLength,
          });
        else setFailed(true);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [attachmentId]);
  return (
    <div className="detail-identity-document">
      <dt>
        {choose({
          bn:
            kind === "birth_reg"
              ? "জন্ম নিবন্ধনের ছবি"
              : "জাতীয় পরিচয়পত্রের ছবি",
          en:
            kind === "birth_reg"
              ? "Birth registration image"
              : "National ID image",
        })}
      </dt>
      <dd>
        {failed ? (
          <p className="hint">
            {choose({
              bn: "পরিচয়পত্রের ছবির অবস্থা পাওয়া যায়নি।",
              en: "The identity document status could not be loaded.",
            })}
          </p>
        ) : handle ? (
          <AttachmentStatus attachment={handle} />
        ) : (
          <p className="hint">
            {choose({ bn: "লোড হচ্ছে…", en: "Loading…" })}
          </p>
        )}
      </dd>
    </div>
  );
}
/** WS-D2 (item 9): every attachment handle in the application payload,
    with the field label the chairman reads it under. Walks top-level
    attachment fields and repeatable rows (supporting_documents); a row's
    own description names the document when present. */
function collectApplicationAttachments(
  schema: any,
  payload: Record<string, any>,
): { title: { bn: string; en: string }; handle: AttachmentHandle }[] {
  if (!schema || !payload) return [];
  const found: { title: { bn: string; en: string }; handle: AttachmentHandle }[] = [];
  const isHandle = (value: any): value is AttachmentHandle =>
    !!value &&
    typeof value === "object" &&
    typeof value.attachmentId === "string" &&
    typeof value.mimeType === "string" &&
    typeof value.byteLength === "number";
  const walk = (fields: any[], value: Record<string, any>, prefix: { bn: string; en: string } | null) => {
    for (const field of fields ?? []) {
      const fieldValue = value?.[field.id];
      if (field.type === "attachment" && isHandle(fieldValue)) {
        found.push({
          title: prefix ?? { bn: field.label?.bn ?? field.id, en: field.label?.en ?? field.id },
          handle: fieldValue,
        });
      } else if (Array.isArray(fieldValue) && field.children?.length) {
        fieldValue.forEach((row: any, index: number) => {
          const rowTitle =
            typeof row?.description === "string" && row.description.trim()
              ? { bn: row.description, en: row.description }
              : {
                  bn: `${field.label?.bn ?? field.id} ${index + 1}`,
                  en: `${field.label?.en ?? field.id} ${index + 1}`,
                };
          walk(field.children, row, rowTitle);
        });
      } else if (field.children?.length) {
        walk(field.children, fieldValue ?? {}, prefix);
      }
    }
  };
  for (const section of schema.sections ?? []) walk(section.fields, payload, null);
  return found;
}
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
  // W-020: the platform-health screen.
  "health",
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

/**
 * B-003 / F-015: the pinned schema for one application. The current
 * operational schema ships with the bundle (web entry); an application
 * pinned to a superseded version loads its schema on demand from the
 * legacy entry, so the 512 KB historical-schema JSON never enters the
 * initial bundle. While it loads, the payload section shows a loading
 * status — never a wrong (current-version) form — and a failed load is
 * an alert, not a silent empty form.
 */
function PinnedSchema({
  serviceNo,
  schemaVersion,
  order,
  children,
}: {
  serviceNo: number;
  schemaVersion?: number;
  order: boolean;
  children: (schema: FormSchema) => React.ReactNode;
}) {
  const current = useMemo(() => getServiceSchema(serviceNo), [serviceNo]);
  const needsLegacy =
    schemaVersion != null && schemaVersion !== current.version;
  const [legacy, setLegacy] = useState<FormSchema | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!needsLegacy) return;
    let live = true;
    setLegacy(null);
    setFailed(false);
    import("@astra/shared-schemas/legacy")
      .then((m) => {
        if (live)
          setLegacy(m.getLegacyServiceSchema(serviceNo, schemaVersion!));
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [serviceNo, schemaVersion, needsLegacy]);
  if (failed) {
    return (
      <p role="alert" className="ax-flow-error">
        {choose({
          bn: "এই আবেদনের ফরমের পুরনো সংস্করণটি লোড করা যায়নি।",
          en: "The older form version for this application could not be loaded.",
        })}
      </p>
    );
  }
  if (needsLegacy && !legacy) {
    return (
      <p role="status" className="ax-flow-muted">
        {choose({
          bn: "আবেদনের ফরম লোড হচ্ছে…",
          en: "Loading the application's form…",
        })}
      </p>
    );
  }
  const schema = legacy ?? current;
  return <>{children(order ? withoutOrderLanguage(schema) : schema)}</>;
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
    // R13-GAPS (B1 limit): the certificate the revoke confirmation acts
    // on — captured at click time so the modal revokes exactly the
    // certificate whose button was pressed.
    [revokeTarget, setRevokeTarget] = useState<any>(null),
    [reason, setReason] = useState(""),
    // WS-D2 (item 16): decision-dialog fields — preset reason, free-text
    // note, correction field + deadline, summons when/where, dialog error.
    [dialogReason, setDialogReason] = useState(""),
    [dialogNote, setDialogNote] = useState(""),
    [dialogField, setDialogField] = useState(""),
    [dialogDeadline, setDialogDeadline] = useState("7"),
    [dialogWhen, setDialogWhen] = useState(""),
    [dialogWhere, setDialogWhere] = useState(""),
    [dialogError, setDialogError] = useState<{ bn: string; en: string } | null>(null),
    [filter, setFilter] = useState(""),
    [search, setSearch] = useState("");
  const [appSearch, setAppSearch] = useState(""),
    [appQuery, setAppQuery] = useState(""),
    [appPage, setAppPage] = useState(1),
    [appPageSize, setAppPageSize] = useState(25),
    // WS-D1: list sort (default newest-first). The list's own loading
    // flag is appListLoading (CH-005) below.
    [appSort, setAppSort] = useState("newest"),
    // QAFIX-01 (§4 item 13): null until the first list answer arrives —
    // totals show a loading dash, never a confident 0 that later jumps.
    [appTotal, setAppTotal] = useState<number | null>(null),
    // CH-004: the last applications-list failure, if any — the section
    // renders it with a retry instead of a stale/empty list.
    [appLoadError, setAppLoadError] = useState(""),
    // CH-005: true while a list fetch is in flight (filter/page/search
    // change) — the list renders skeletons instead of the previous
    // filter's rows, and the total reads "—" until the answer arrives.
    [appListLoading, setAppListLoading] = useState(false);
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
    >({}),
    // WS-D1 / CH-003: the pending queue's own loading flag — the queue
    // renders skeletons, never the "nothing is waiting" empty state,
    // until the counts and lists have actually arrived.
    [pendingLoading, setPendingLoading] = useState(false);
  const pendingEpoch = useRef(0);
  // CH-009: the Citizens directory paginates on its own fetch — the
  // shared `citizens` list stays the unpaginated register the flow and
  // the citizen home read from, so a citizen's own record is never
  // hidden by the directory's page. Page and page size (citizenPage /
  // citizenPageSize, WS-D3) are declared beside the citizen search below.
  const [directoryCitizens, setDirectoryCitizens] = useState<any[]>([]),
    [directoryTotal, setDirectoryTotal] = useState<number | null>(null),
    [directoryLoading, setDirectoryLoading] = useState(false),
    // CH-009 follow-up: the directory is its own fetch, so a citizen
    // registered on this page does not appear in it until something
    // re-triggers the fetch — bumping this epoch after a registration
    // refetches page 1 (newest first), where the new citizen lands.
    [directoryEpoch, setDirectoryEpoch] = useState(0);
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
  /* WS-D3: Enter in the global search goes somewhere — the first loaded
     application (a reference lookup), else the first citizen, else the
     first service; with no loaded result it opens the applications list
     filtered by the query. Before this, Enter did nothing at all: the
     input had no key handler and was not in a form. */
  function globalSearchEnter() {
    const q = globalQuery.trim();
    if (!q) return;
    const firstApp = globalResults?.applications?.[0];
    const firstCitizen = globalResults?.citizens?.[0];
    const firstService = globalResults?.services?.[0];
    setGlobalQuery("");
    setGlobalFocus(false);
    if (firstApp) {
      void run(() => openApplication(firstApp.id));
      return;
    }
    if (firstCitizen) {
      // The citizens list is paged: filter it to this citizen so the
      // details panel can find the record on the first page.
      setCitizenSearch(
        firstCitizen.nameBn || firstCitizen.name_bn || firstCitizen.nameEn || firstCitizen.name_en || "",
      );
      nav("citizens");
      setDetailsCitizenId(firstCitizen.id);
      return;
    }
    if (firstService) {
      if (canApply) {
        setSelectedService(firstService.service_no);
        setFlowService(firstService.service_no);
        setFlowCitizen(role === "citizen" ? ownCitizen() : null);
        nav("flow");
      } else {
        nav("services");
      }
      return;
    }
    setAppSearch(q);
    setAppPage(1);
    nav("applications");
  }
  const [renewalOrder, setRenewalOrder] = useState<IntakeOrderState | null>(
    null,
  );
  // W-004 (follow-up): one idempotency key per source application, minted
  // on the first renew click and reused on every retry of that renewal —
  // a retried renew then returns the original draft instead of a second
  // one. The key is kept after success too: the certificate can only ever
  // have one active renewal, so a later click replays the same draft
  // rather than failing with RENEWAL_EXISTS.
  const renewalRequestKeys = useRef(new Map<string, string>());
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
  // WS-D3: the citizens register is paged (25/page) — the list endpoint
  // caps at 100 rows with no page before this, so a large register simply
  // stopped. Page state lives beside the applications paging above.
  const [citizenPage, setCitizenPage] = useState(1),
    [citizenPageSize, setCitizenPageSize] = useState(25);
  useEffect(() => {
    const timer = setTimeout(() => {
      setCitizenQuery(citizenSearch);
      setCitizenPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [citizenSearch]);
  // CH-009: the directory's own paginated fetch (25 per page). A new
  // search resets to page 1; the shared `citizens` register is untouched.
  useEffect(() => {
    setCitizenPage(1);
  }, [citizenQuery]);
  useEffect(() => {
    if (!session || page !== "citizens") return;
    let active = true;
    setDirectoryLoading(true);
    (async () => {
      try {
        const r = await api(
          `/citizens?${new URLSearchParams({ q: citizenQuery, page: String(citizenPage), pageSize: String(citizenPageSize) })}`,
        );
        if (!active) return;
        setDirectoryCitizens(items(r));
        setDirectoryTotal(r.total ?? items(r).length);
      } finally {
        if (active) setDirectoryLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [session, page, citizenQuery, citizenPage, citizenPageSize, directoryEpoch]);
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
    // WS-D1 / CH-005: the list is loading from here until the refresh
    // settles (cleared in the finally below, epoch-guarded so a stale
    // refresh cannot clear a newer one, and a failed refresh never leaves
    // the skeleton up forever).
    const loadsApplications = !["owner", "finance"].includes(role);
    if (loadsApplications) setAppListLoading(true);
    try {
      const [
        servicesResult,
        citizenResult,
        applicationResult,
        walletResult,
        billingResult,
        tenantResult,
      ] = await Promise.all([
        api("/services"),
        // CH-009: the shared register is NOT paginated — the Citizens
        // directory pages on its own fetch (see the directory effect).
        !["owner", "finance"].includes(role)
          ? api(`/citizens?q=${encodeURIComponent(citizenQuery)}`)
          : Promise.resolve({ items: [] }),
        !["owner", "finance"].includes(role)
          ? api(
              `/applications?${new URLSearchParams({ ...(filter ? { state: filter } : {}), ...(appService ? { serviceNo: appService } : {}), q: appQuery, page: String(appPage), pageSize: String(appPageSize), sort: appSort, ...(appFrom ? { from: appFrom } : {}), ...(appTo ? { to: appTo } : {}), ...(appRenewals ? { renewal: "true" } : {}) })}`,
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
    } finally {
      if (epoch === refreshEpoch.current && loadsApplications)
        setAppListLoading(false);
    }
  }
  useEffect(() => {
    if (session) run(refresh);
  }, [session, filter, appService, appQuery, appPage, appPageSize, appSort, citizenQuery, appFrom, appTo, appRenewals]);
  // WS-D1: if the total shrinks under the current page (a decision moved
  // rows out of this filtered view), step back onto the last real page
  // instead of showing an empty page. Null total means a load is in
  // flight — never clamp on it.
  useEffect(() => {
    if (appTotal === null) return;
    const maxPage = Math.max(1, Math.ceil(appTotal / appPageSize));
    if (appPage > maxPage) setAppPage(maxPage);
  }, [appTotal, appPageSize]);
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
  /* Citizen dashboard + profile (2026-11-26): the citizen home counts now
     come from the citizen-scoped /applications/counts endpoint inside
     CitizenDashboard (one request, not seven). Header state: unread
     notification count (derived from GET /notifications items without
     readAt), the avatar dropdown, and whether the avatar photo failed to
     load (404 = no photo -> initials, never a broken image). */
  const [unreadCount, setUnreadCount] = useState(0);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const [avatarPhotoFailed, setAvatarPhotoFailed] = useState(false);
  const avatarWrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    let active = true;
    api("/notifications")
      .then((r) => {
        if (active)
          setUnreadCount(items(r).filter((n: any) => !n.readAt).length);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [page]);
  useEffect(() => {
    setAvatarMenuOpen(false);
  }, [page]);
  useEffect(() => {
    if (!avatarMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (
        avatarWrapRef.current &&
        !avatarWrapRef.current.contains(e.target as Node)
      )
        setAvatarMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAvatarMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [avatarMenuOpen]);
  /** ONE sign-out for the sidebar item, the avatar dropdown and the mobile
      sheet. Phase 5 (5A) semantics preserved verbatim from the former
      sidebar-bottom button: leaving the workspace must never depend on the
      logout request succeeding — in the broken-session state that request
      is exactly what fails (it is CSRF-protected like every POST), which
      left sign-out clicks doing nothing. The API client first resyncs and
      tries to complete the server logout; whatever the outcome, local
      state is cleared and the user returns to the sign-in portal. A server
      session that could not be ended here expires on its own schedule. */
  function signOut() {
    setAvatarMenuOpen(false);
    setTabSheet(false);
    void run(async () => {
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
    });
  }
  // Phase 1 slice (ii), approved: staff get the UDC sidebar; staff and office admins get the dashboard home.
  // WS-D3: the chairman (approver) gets the dashboard home too — before
  // this the chairman's home was only action cards and an explainer, with
  // no numbers at all, while the same counts fed the pending page and the
  // sidebar badge.
  const udcPreview = usesUdcNavigation(role);
  const dashboardHome = staff || approver;
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
    // WS-D1: clearing the filters clears the address too — the old code
    // left a stale ?state=SUBMITTED / ?state=ISSUED in the hash, so a
    // reload or a shared link re-applied the "cleared" filter.
    writeRoute("#/applications");
  }
  // WS-D1: one place that writes the applications hash from explicit
  // (state, service) values — filter changes, chip removals and clears
  // all go through it so the hash never disagrees with the list.
  function writeApplicationsRoute(state: string, serviceNo: string) {
    const params = new URLSearchParams({
      ...(state ? { state } : {}),
      ...(serviceNo ? { service: serviceNo } : {}),
    });
    const query = params.toString();
    writeRoute(`#/applications${query ? `?${query}` : ""}`);
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
  /** WS-D2 (item 16): the correction dialog's field selector — the
      top-level fields of this application's own schema version.
      The web bundle carries only the CURRENT operational schemas (Phase 4
      B-003), so an application pinned to an older version loads that
      version lazily from @astra/shared-schemas/legacy, as PinnedSchema
      does; until it arrives the picker offers no fields rather than the
      current form's (field sets can differ between versions, e.g. B5). */
  const pickerServiceNo: number | undefined =
    application?.serviceNo || application?.service_no;
  const pickerVersion: number | undefined =
    application?.schemaVersion ?? application?.schema_version;
  const [pickerLegacy, setPickerLegacy] = useState<{
    key: string;
    schema: FormSchema;
  } | null>(null);
  const pickerKey = `${pickerServiceNo}:${pickerVersion}`;
  const pickerNeedsLegacy = (() => {
    if (!pickerServiceNo || pickerVersion == null) return false;
    try {
      return getServiceSchema(pickerServiceNo).version !== pickerVersion;
    } catch {
      return false;
    }
  })();
  useEffect(() => {
    if (!pickerNeedsLegacy || !pickerServiceNo || pickerVersion == null) return;
    let live = true;
    import("@astra/shared-schemas/legacy")
      .then((m) => {
        if (live)
          setPickerLegacy({
            key: pickerKey,
            schema: m.getLegacyServiceSchema(pickerServiceNo, pickerVersion),
          });
      })
      .catch(() => {
        /* picker stays empty; the dialog still accepts a free-text note */
      });
    return () => {
      live = false;
    };
  }, [pickerKey, pickerNeedsLegacy, pickerServiceNo, pickerVersion]);
  const correctionFieldOptions: {
    id: string;
    label: { bn: string; en: string };
  }[] = (() => {
    if (!detail || !application || !pickerServiceNo) return [];
    try {
      const schema = pickerNeedsLegacy
        ? pickerLegacy?.key === pickerKey
          ? pickerLegacy.schema
          : null
        : getServiceSchema(pickerServiceNo);
      if (!schema) return [];
      return (schema.sections ?? []).flatMap((section: any) =>
        (section.fields ?? []).map((field: any) => ({
          id: field.id,
          label: field.label ?? { bn: field.id, en: field.id },
        })),
      );
    } catch {
      return [];
    }
  })();
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
    resetDialog();
    setDetail(null);
    writeRoute(applicationsHash());
  }
  /** WS-D2 (item 16): the decision dialog starts empty every time — a
      stale reason from an earlier decision must never leak into the
      next one. The side reason box, when already filled, seeds the
      dialog's note instead. */
  function resetDialog() {
    setDialogReason("");
    setDialogNote("");
    setDialogField("");
    setDialogDeadline("7");
    setDialogWhen("");
    setDialogWhere("");
    setDialogError(null);
  }
  /** WS-D2 (item 16): the single reason string the server stores and the
      citizen reads, composed from the dialog's preset + note (+ field and
      deadline for corrections, when/where for summons). */
  function composeDialogReason(action: string): string {
    if (action === "reject") {
      const preset = rejectReasons.find((r) => r.value === dialogReason);
      const label = preset ? choose(preset) : "";
      const note = dialogNote.trim();
      if (preset?.value === "other") return note;
      return note ? `${label} — ${note}` : label;
    }
    if (action === "request_correction") {
      const preset = correctionReasons.find((r) => r.value === dialogReason);
      const field =
        correctionFieldOptions.find((f) => f.id === dialogField)?.label ??
        null;
      const fieldLabel = dialogField === "__all__"
        ? choose({ bn: "সব তথ্য", en: "All information" })
        : field
          ? choose(field)
          : "";
      const deadline = correctionDeadlines.find(
        (d) => d.value === dialogDeadline,
      );
      const parts = [
        choose({
          bn: `সংশোধন প্রয়োজন: ${fieldLabel} — ${preset ? choose(preset) : ""}`,
          en: `Correction needed: ${fieldLabel} — ${preset ? choose(preset) : ""}`,
        }),
      ];
      if (dialogNote.trim()) parts.push(dialogNote.trim());
      if (deadline)
        parts.push(
          choose({
            bn: `সময়সীমা: ${choose(deadline)}`,
            en: `Deadline: ${choose(deadline)}`,
          }),
        );
      return parts.join("। ");
    }
    if (action === "summon") {
      const preset = summonReasons.find((r) => r.value === dialogReason);
      const parts = [
        preset ? choose(preset) : "",
        choose({
          bn: `${dialogWhen.trim()} — ${dialogWhere.trim()}`,
          en: `${dialogWhen.trim()} — ${dialogWhere.trim()}`,
        }),
      ];
      if (dialogNote.trim()) parts.push(dialogNote.trim());
      return parts.filter(Boolean).join(" — ");
    }
    return dialogNote.trim();
  }
  /** WS-D2 (item 16): the dialog blocks an empty reason in Bangla,
      before anything reaches the server. */
  function validateDialog(action: string): boolean {
    const err = (bn: string, en: string) => {
      setDialogError({ bn, en });
      return false;
    };
    if (action === "reject") {
      if (!dialogReason)
        return err("প্রত্যাখ্যানের কারণ বেছে নিন।", "Choose a rejection reason.");
      if (dialogReason === "other" && dialogNote.trim().length < 3)
        return err("কারণটি লিখুন।", "Write the reason.");
      return true;
    }
    if (action === "request_correction") {
      if (!dialogField)
        return err(
          "কোন তথ্য সংশোধন করতে হবে তা বেছে নিন।",
          "Choose which information needs correction.",
        );
      if (!dialogReason)
        return err("সংশোধনের কারণ বেছে নিন।", "Choose a correction reason.");
      if (dialogReason === "other" && dialogNote.trim().length < 3)
        return err("কারণটি লিখুন।", "Write the reason.");
      return true;
    }
    if (action === "summon") {
      if (dialogWhen.trim().length < 3)
        return err("কবে আসতে হবে তা লিখুন।", "Write when the applicant should come.");
      if (dialogWhere.trim().length < 3)
        return err("কোথায় আসতে হবে তা লিখুন।", "Write where the applicant should come.");
      if (!dialogReason)
        return err("আসতে বলার কারণ বেছে নিন।", "Choose a reason for asking them to come.");
      if (dialogReason === "other" && dialogNote.trim().length < 3)
        return err("কারণটি লিখুন।", "Write the reason.");
      return true;
    }
    return true;
  }
  async function transition(action: string) {
    // QAFIX-09 (B1): decisions that cannot be undone (QA-13) ask
    // once before they run — in the in-app confirmation modal
    // rendered below, not window.confirm: the native dialog is
    // auto-cancelled by automated browsers, which silently
    // stranded the chairman's approve/reject, and it cannot show
    // the application reference.
    // WS-D2 (item 16): correction and summons ask in the same modal —
    // a reason is required, so the dialog collects it instead of the
    // click failing with the server's English error. Other transitions
    // run at once.
    if (transitionConfirmText[action]) {
      resetDialog();
      if (reason.trim()) setDialogNote(reason.trim());
      if (action === "summon")
        setDialogWhere(recordName(session.tenant) || "");
      setConfirmAction(action);
      return;
    }
    await runTransition(action);
  }
  async function runTransition(action: string, reasonOverride?: string) {
    setActionError("");
    const finalReason = (reasonOverride ?? reason).trim();
    try {
      await api(`/applications/${application.id}/transition`, "POST", {
        action,
        ...(finalReason ? { reason: finalReason } : {}),
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
    resetDialog();
    setMessage(choose(actionDone[action] ?? actionText[action] ?? { bn: "সম্পন্ন হয়েছে।", en: "Done." }));
  }
  // R13-GAPS (B1 limit): revocation runs from the same in-app
  // confirmation modal as approve/reject — the native window.confirm
  // this replaced was the last one in the workspace.
  async function revokeCertificate(cert: any) {
    setActionError("");
    try {
      await api(`/certificates/${cert.id}/revoke`, "POST", {
        reason: reason.trim(),
      });
    } catch (e) {
      setActionError((e as Error).message);
      return;
    }
    await openApplication(application.id);
    setMessage(choose(actionDone.revoke));
  }
  // CHAIRMAN-DASH-01: the Pending applications queue. Counts always come from the
  // API (/applications/counts) — never from counting a fetched page — and the rows
  // come from the same list endpoint the applications page uses, one state at a
  // time. CORRECTION_REQUIRED is excluded from the two office-pending groups on
  // purpose: after a correction request the next move is the citizen's, so it is
  // not office-pending work. It gets its own group below (W-011) so it is visible
  // instead of disappearing from the queue.
  const pendingReviewStates = ["SUBMITTED", "RESUBMITTED", "UNDER_REVIEW"],
    pendingIssuanceStates = ["APPROVED"],
    pendingCitizenStates = ["CORRECTION_REQUIRED"];
  async function loadPendingCounts() {
    const counts = await api("/applications/counts");
    setPendingCounts(counts);
  }
  async function loadPending() {
    const epoch = ++pendingEpoch.current;
    // WS-D1: loading flag + cleared counts first — the groups must show a
    // skeleton, never the previous visit's counts or the false empty
    // state, while the new answers are in flight (live QA defect (b)).
    setPendingLoading(true);
    setPendingCounts(null);
    try {
      await loadPendingCounts();
      const lists: Record<string, { items: any[]; total: number }> = {};
      await Promise.all(
        [...pendingReviewStates, ...pendingIssuanceStates, ...pendingCitizenStates].map(async (state) => {
          const r = await api(
            // WS-D1: the queue triages oldest-first, so the fetched page
            // must BE the oldest rows — with the list default (newest
            // first) a 242-deep queue would show the newest 100 and hide
            // the most urgent work.
            `/applications?${new URLSearchParams({ state, page: "1", pageSize: "100", sort: "oldest" })}`,
          );
          lists[state] = {
            items: items(r),
            total: r.total ?? items(r).length,
          };
        }),
      );
      if (epoch !== pendingEpoch.current) return;
      setPendingLists(lists);
    } finally {
      // Only the latest load may clear the flag — a stale load's return
      // must not hide the newer fetch, and a failed load must not leave
      // the skeleton up forever.
      if (epoch === pendingEpoch.current) setPendingLoading(false);
    }
  }
  useEffect(() => {
    if (!session) return;
    if (page === "pending") void run(loadPending);
    /* The dashboard's pending-applications tile (P1-8) reads pendingCounts,
       which only the pending page loaded — on home it sat at "—" forever.
       Load the counts for the staff dashboard too. */
    else if (page === "home" && dashboardHome) void run(loadPendingCounts);
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
  /** CH-009: the directory's "Identity state" column used to read
      "Registered" on every row — a constant, not a state. Derive it from
      what the row actually carries (masked hints only; the full numbers
      stay behind GET /citizens/:id/identity, which is audited). */
  function citizenIdentityState(c: any): { bn: string; en: string } {
    if (c.identityDocument ?? c.identity_document)
      return { bn: "পরিচয়পত্রের নথি আছে", en: "Identity document on file" };
    if (c.nidHint ?? c.nid_hint ?? c.birthRegHint ?? c.birth_reg_hint)
      return { bn: "পরিচয় নম্বর আছে", en: "Identity number on file" };
    return { bn: "পরিচয়পত্র নেই", en: "No identity on file" };
  }
  function isNewApplication(a: any): boolean {
    return (
      !!lastSubmittedReference &&
      (a.reference === lastSubmittedReference || a.id === lastSubmittedReference)
    );
  }
  // WS-D1: the only reference a row may show is the numeric public
  // reference. Pre-047 rows carry reference NULL, and the old fallback
  // (`reference || id`) printed the raw UUID as the reference (live QA
  // finding 17). Migration 059 backfills those rows; this guard keeps a
  // UUID from ever leaking as a reference on any database, before or
  // after the backfill — an unreferenceable row shows a dash, never a
  // UUID. (The id itself stays the internal key for opening the row.)
  function displayReference(a: any): string {
    const ref = String(a?.reference ?? "").trim();
    if (/^[0-9][0-9\- ]*$/.test(ref) && ref.replace(/[\- ]/g, "").length >= 10)
      return ref;
    return "—";
  }
  function applicationRow(a: any, hideCitizen = false) {
    const serviceNo = a.serviceNo || a.service_no;
    const isNew = isNewApplication(a);
    return (
      <tr key={a.id} className={isNew ? "ax-row-new" : undefined}>
        <td>
          <RefChip value={displayReference(a)} />
          <small>{applicationDate(a.createdAt || a.created_at)}</small>
          {isNew && (
            <span className="ax-new-badge">
              {choose({ bn: "নতুন", en: "New" })}
            </span>
          )}
          {/* W-013: a partial draft is visibly incomplete so nobody mistakes
              it for a ready-to-submit draft. */}
          {(a.partialPayload ?? a.partial_payload) &&
            (a.state || a.status) === "DRAFT" && (
              <span className="ax-new-badge">
                {choose({ bn: "অসম্পূর্ণ খসড়া", en: "Incomplete draft" })}
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
              supplies it); otherwise the chip stays neutral.
              CH-009: the chip reads "N days waiting" only while the
              application is actually waiting on the office — on an
              issued, rejected, cancelled or revoked row it claimed a
              wait that had already ended. */}
          {!hideCitizen &&
            ["SUBMITTED", "RESUBMITTED", "UNDER_REVIEW", "APPROVED"].includes(
              String(a.state || a.status || ""),
            ) &&
            (() => {
              const state = String(a.state || a.status || "");
              // WS-D1: a waiting chip belongs only to a row that is
              // actually waiting. Issued rows used to carry e.g. "২ দিন
              // অপেক্ষমাণ" next to "সনদ ইস্যু হয়েছে" (live QA defect
              // (d)); an issued row shows its issue date instead.
              if (state === "ISSUED") {
                const issuedAt =
                  a.certificateIssuedAt ||
                  a.certificate_issued_at ||
                  a.issuedAt;
                return (
                  <span className="age-chip">
                    {issuedAt
                      ? choose({
                          bn: `সনদ ইস্যু: ${applicationDate(issuedAt)}`,
                          en: `Issued ${applicationDate(issuedAt)}`,
                        })
                      : choose({
                          bn: "সনদ ইস্যু হয়েছে",
                          en: "Certificate issued",
                        })}
                  </span>
                );
              }
              if (
                !["SUBMITTED", "RESUBMITTED", "UNDER_REVIEW", "APPROVED"].includes(
                  state,
                )
              )
                return null;
              const created = new Date(a.createdAt || a.created_at);
              if (Number.isNaN(created.getTime())) return null;
              // W-015: when the office has a charter due date for this
              // application, the chip counts down to it (or flags the
              // overrun) instead of counting up from creation.
              const dueAt = a.dueAt ? new Date(a.dueAt) : null;
              if (dueAt && !Number.isNaN(dueAt.getTime())) {
                const daysLeft = Math.ceil(
                  (dueAt.getTime() - Date.now()) / 86_400_000,
                );
                return (
                  <span
                    className={`age-chip${daysLeft < 0 ? " age-chip-overdue" : daysLeft === 0 ? " age-chip-warn" : ""}`}
                  >
                    {daysLeft < 0
                      ? choose({
                          bn: `${localDigits(String(-daysLeft), language)} দিন বিলম্বিত`,
                          en: `Overdue by ${-daysLeft} day${-daysLeft === 1 ? "" : "s"}`,
                        })
                      : daysLeft === 0
                        ? choose({ bn: "আজ নির্ধারিত সময়", en: "Due today" })
                        : choose({
                            bn: `${localDigits(String(daysLeft), language)} দিন বাকি`,
                            en: `Due in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
                          })}
                  </span>
                );
              }
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
          <RefChip value={displayReference(a)} />
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
        {/* WS-D1: while the queue is loading, a skeleton — never the
            empty state, which used to flash on every visit before the
            rows arrived (live QA defect (b)). The empty state renders
            only once loading has finished with genuinely no rows. */}
        {pendingLoading ? (
          <SkeletonRows rows={4} />
        ) : rows.length ? (
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
              // WS-D1: the rows shown are the OLDEST in the group (the
              // fetch sorts oldest-first); the old "most recent" wording
              // contradicted the section's own "Oldest first" heading.
              bn: "পুরনো আবেদনগুলো দেখানো হচ্ছে — বাকিগুলো আবেদনের তালিকায়:",
              en: "Showing the oldest first — see the rest in the applications list:",
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
                    // QA-13 → R13-GAPS (B1 limit): revocation is
                    // permanent; confirm with the number in the in-app
                    // modal (the same one approve/reject use), not the
                    // native window.confirm.
                    setRevokeTarget(cert);
                    setConfirmAction("revoke");
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
          <>
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
          {!phoneLayout && (
          <button
            type="button"
            className="ax-sidebar-item ws-logout-item"
            data-page="logout"
            onClick={signOut}
          >
            <NavIcon name="logout" />
            <span>{choose({ bn: "লগআউট", en: "Sign out" })}</span>
          </button>
          )}
          </>
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
                  {/* WS-D3: issued certificates get their own sidebar entry
                      — before this they were reachable only through the
                      slow status filter on the applications list. Same
                      filtered-destination pattern as the UDC "renewal"
                      entry; the phone "More" sheet lists pages only, so on
                      phone the issued list stays reachable via Applications. */}
                  {group.title.en === "Account" && !phoneLayout && (
                    <button
                      key="logout"
                      type="button"
                      data-page="logout"
                      className="ws-logout-item"
                      onClick={signOut}
                    >
                      <NavIcon name="logout" />
                      <span>{choose({ bn: "লগআউট", en: "Sign out" })}</span>
                    </button>
                  )}
                  {group.title.en === "Main" &&
                    ["staff", "admin", "reviewer", "approver"].includes(
                      role,
                    ) && (
                      <button
                        key="issued"
                        data-page="issued"
                        aria-current={
                          page === "applications" &&
                          filter === "ISSUED" &&
                          !appService
                            ? "page"
                            : undefined
                        }
                        onClick={() => openTask("applications", "ISSUED")}
                      >
                        <NavIcon name="renewal" />
                        <span>
                          {choose({
                            bn: "ইস্যুকৃত সনদ",
                            en: "Issued certificates",
                          })}
                        </span>
                      </button>
                    )}
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
{/* Citizen dashboard + profile (2026-11-26): sign-out lives in the
            Account menu group, the avatar dropdown and the mobile sheet —
            the sidebar bottom keeps only the identity display. Exception:
            layouts where the sidebar nav itself is CSS-hidden (phone width,
            the owner shell) would leave no visible sign-out at all, so
            there the sidebar bottom keeps the button — it is not a
            duplicate in those layouts. */}
          {(phoneLayout || role === "owner") && (
            <button type="button" className="text-button" onClick={signOut}>
              {choose({ bn: "লগআউট", en: "Sign out" })}
            </button>
          )}
        </div>
      </aside>
      <main id="content" aria-busy={busy || undefined}>
        {/* F-008: the issuance-mode banner — renders only in DEMO mode. */}
        <DemoModeBanner />
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
                  : page === "applications" && filter
                    ? filter === "ISSUED" && appService === "42"
                      ? choose({ bn: "ট্রেড লাইসেন্স নবায়ন", en: "Trade licence renewal" })
                      : // WS-D1: a filtered list is headed by its own
                        // filter — the old code headed EVERY issued view
                        // "সনদ নবায়ন" (Certificate renewal), which is a
                        // staff sidebar entry, not this list (live QA
                        // finding 8). The unfiltered heading stays the
                        // stable "আবেদন" from pageTitles below.
                        choose(
                          applicationStatusMeta(filter) ?? {
                            bn: "আবেদন",
                            en: "Applications",
                          },
                        )
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
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    globalSearchEnter();
                  }
                }}
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
                          {displayReference(a)} ·{" "}
                          {choose(applicationStatusMeta(String(a.state || a.status || "")))}
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
                            // WS-D3: the citizens list is paged — filter it
                            // to this citizen so the details panel finds it.
                            setCitizenSearch(
                              c.nameBn || c.name_bn || c.nameEn || c.name_en || "",
                            );
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
            <button
              type="button"
              className="ws-header-bell"
              aria-label={choose({ bn: "নোটিফিকেশন", en: "Notifications" })}
              onClick={() => nav("notifications")}
            >
              <NavIcon name="notifications" size={22} />
              {unreadCount > 0 && (
                <span className="ws-bell-badge">
                  {localDigits(String(unreadCount), language)}
                </span>
              )}
            </button>
            <div className="ws-avatar-wrap" ref={avatarWrapRef}>
              <button
                type="button"
                className="ws-avatar-btn"
                aria-haspopup="menu"
                aria-expanded={avatarMenuOpen}
                aria-label={choose({ bn: "আমার অ্যাকাউন্ট", en: "My account" })}
                onClick={() => setAvatarMenuOpen(!avatarMenuOpen)}
              >
                {(() => {
                  const me = role === "citizen" ? ownCitizen() : null;
                  const display =
                    session.user.displayName ||
                    session.user.display_name ||
                    session.user.email ||
                    "";
                  if (me?.hasPhoto && !avatarPhotoFailed)
                    return (
                      <img
                        className="ws-avatar"
                        src={`/api/v1/citizens/${me.id}/photo/image`}
                        alt=""
                        onError={() => setAvatarPhotoFailed(true)}
                      />
                    );
                  return (
                    <span className="ws-avatar" aria-hidden="true">
                      {tx(display.trim().charAt(0) || "?")}
                    </span>
                  );
                })()}
                <span aria-hidden="true">▾</span>
              </button>
              {avatarMenuOpen && (
                <div className="ws-avatar-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setAvatarMenuOpen(false);
                      nav("profile");
                    }}
                  >
                    <NavIcon name="profile" />
                    <span>{choose({ bn: "আমার প্রোফাইল", en: "My profile" })}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setAvatarMenuOpen(false);
                      nav("security");
                    }}
                  >
                    <NavIcon name="security" />
                    <span>{choose({ bn: "অ্যাকাউন্ট সেটিংস", en: "Account settings" })}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="ws-logout-item"
                    onClick={signOut}
                  >
                    <NavIcon name="logout" />
                    <span>{choose({ bn: "লগআউট", en: "Sign out" })}</span>
                  </button>
                </div>
              )}
            </div>
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
            // WS-D3: the workload breakdown and the oldest-pending age read
            // the same /applications/counts answer as the pending tile, the
            // pending page and the sidebar badge — one source, one number.
            pendingBreakdown={
              pendingCounts != null
                ? {
                    awaitingReview: pendingCounts.awaitingReview ?? 0,
                    awaitingIssuance: pendingCounts.awaitingIssuance ?? 0,
                    correctionRequired:
                      pendingCounts.counts?.CORRECTION_REQUIRED ?? 0,
                    issued: pendingCounts.counts?.ISSUED ?? 0,
                  }
                : null
            }
            oldestPendingAt={pendingCounts?.oldestPendingAt ?? null}
            creditBalance={wallet?.balance ?? null}
            // CH-001: the per-state partition behind the summary tiles.
            stateCounts={pendingCounts?.counts ?? null}
            onOpenState={(state) => openTask("applications", state)}
            onStartService={(serviceNo) => {
              // WS-D3: an approver cannot start applications — the service
              // cards open the view-only catalog instead of a flow.
              if (!canApply) {
                nav("services");
                return;
              }
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
              <CitizenDashboard
                citizen={ownCitizen()}
                applications={applications}
                catalog={catalog}
                geographyRequired={!!session.tenant?.divisionCode}
                displayName={
                  session.user.displayName ||
                  session.user.display_name ||
                  session.user.email ||
                  ""
                }
                loaded={initialLoaded}
                displayReference={displayReference}
                onNavigate={nav}
                onOpenTask={(state) => openTask("applications", state ?? "")}
                onOpenApplication={(id) => void run(() => openApplication(id))}
              />
            )}
            {role !== "citizen" && (
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
                {/* CH-009: the directory paginates (25 per page) on its own
                    fetch — while a page loads, skeletons replace the
                    rows instead of the previous page's citizens. */}
                {directoryLoading ? (
                  <SkeletonRows rows={5} />
                ) : (
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
                        directoryCitizens.map((c) => (
                            <tr key={c.id}>
                              <td>
                                {c.nameBn || c.name_bn}
                                <small>{c.nameEn || c.name_en}</small>
                              </td>
                              <td>
                                <span className="status">
                                  {choose(citizenIdentityState(c))}
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
                </div>)}
                {phoneLayout && !directoryLoading && (
                  <div className="ax-card-list">
                  {tx(
                    directoryCitizens.map((c) => (
                      <article className="ax-card" key={c.id}>
                        <div className="ax-card-head">
                          <strong>{c.nameBn || c.name_bn}</strong>
                          <span className="status">
                            {choose(citizenIdentityState(c))}
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
                {/* WS-D3 / CH-009: the directory shows its real total and
                    pages (prev/next + per-page), reading the total from its
                    own paginated fetch (never the length of a page). */}
                <div className="pagination">
                  <button
                    className="secondary"
                    disabled={directoryLoading || citizenPage <= 1}
                    onClick={() => setCitizenPage(citizenPage - 1)}
                  >
                    {t("Previous citizens ")}
                  </button>
                  <span>
                    {tx(directoryLoading ? "—" : (directoryTotal ?? "—"))}
                    {t(" results · Page ")}
                    {tx(citizenPage)}
                    {t(" /")}
                    {tx(" ")}
                    {tx(
                      Math.max(1, Math.ceil((directoryTotal ?? 0) / citizenPageSize)),
                    )}
                  </span>
                  <button
                    className="secondary"
                    disabled={
                      directoryLoading ||
                      citizenPage * citizenPageSize >= (directoryTotal ?? 0)
                    }
                    onClick={() => setCitizenPage(citizenPage + 1)}
                  >
                    {t("Next citizens ")}
                  </button>
                  <label htmlFor="citizen-page-size">
                    {choose({
                      bn: "প্রতি পৃষ্ঠায় নাগরিক",
                      en: "Citizens per page",
                    })}
                  </label>
                  <select
                    id="citizen-page-size"
                    value={citizenPageSize}
                    onChange={(e) => {
                      setCitizenPageSize(Number(e.target.value));
                      setCitizenPage(1);
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
              </section>
              {(() => {
                // CH-009: the open record is on the directory's current
                // page; fall back to the shared register if the page
                // changed while the panel was open.
                const open =
                  directoryCitizens.find((c) => c.id === detailsCitizenId) ??
                  citizens.find((c) => c.id === detailsCitizenId);
                return open ? (
                  <CitizenDetailsEditor
                    citizen={open}
                    canEdit={staff || role === "citizen"}
                    geographyRequired={!!session?.tenant?.divisionCode}
                    // S-010: plain staff cannot reveal full identity numbers.
                    canRevealFullNumbers={role !== "staff"}
                    onClose={() => setDetailsCitizenId("")}
                    onSaved={(updated) => {
                      setCitizens((list) =>
                        list.map((c) => (c.id === updated.id ? updated : c)),
                      );
                      setDirectoryCitizens((list) =>
                        list.map((c) => (c.id === updated.id ? updated : c)),
                      );
                    }}
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
                          // CH-009 follow-up: refresh() only refetches the
                          // shared register — the directory renders its own
                          // paginated fetch, so the new citizen would never
                          // appear in it until the page/search changed.
                          // Back to page 1 (newest first) and refetch.
                          setCitizenPage(1);
                          setDirectoryEpoch((epoch) => epoch + 1);
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
                        writeApplicationsRoute(e.target.value, appService);
                      }}
                    >
                      <option value="">{choose({ bn: "সব অবস্থা", en: "All states" })}</option>
                      {tx(
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
                        writeApplicationsRoute(filter, e.target.value);
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
                  {/* WS-D1: real sort controls — date, status, service,
                      reference. They re-query (sort is part of the list
                      request), not decoration. */}
                  <div className="app-toolbar-field">
                    <label htmlFor="sort-applications">
                      {choose({ bn: "সাজান", en: "Sort" })}
                    </label>
                    <select
                      id="sort-applications"
                      value={appSort}
                      onChange={(e) => {
                        setAppSort(e.target.value);
                        setAppPage(1);
                      }}
                    >
                      <option value="newest">
                        {choose({ bn: "নতুন আগে", en: "Newest first" })}
                      </option>
                      <option value="oldest">
                        {choose({ bn: "পুরনো আগে", en: "Oldest first" })}
                      </option>
                      <option value="status">
                        {choose({ bn: "অবস্থা অনুযায়ী", en: "By status" })}
                      </option>
                      <option value="service">
                        {choose({ bn: "সেবা অনুযায়ী", en: "By service" })}
                      </option>
                      <option value="reference">
                        {choose({ bn: "রেফারেন্স অনুযায়ী", en: "By reference" })}
                      </option>
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
                            writeApplicationsRoute("", appService);
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
                            writeApplicationsRoute(filter, "");
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
                  {/* CH-005: while a filter/page/search fetch is in flight the
                      count shows "—", not the previous filter's total — the
                      rows below are skeletoned the same way, so nothing on
                      screen reads as the new filter's answer until it lands. */}
                  <p className="hint" role="status">
                    {appListLoading || appTotal === null
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
              {/* WS-D1 / CH-005: while the list is loading, a skeleton with a
                  loading status — never the stale rows with the stale
                  count, and never the empty state. The empty state renders
                  only after loading finishes with genuinely no rows and no
                  load error. */}
              {appListLoading ? (
                <div role="status" className="app-loading">
                  <p className="hint">
                    {choose({
                      bn: "আবেদন লোড হচ্ছে…",
                      en: "Loading applications…",
                    })}
                  </p>
                  <SkeletonRows rows={5} />
                </div>
              ) : (
                <>
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
                </>
              )}
              <div className="pagination">
                <button
                  className="secondary"
                  disabled={busy || appListLoading || appPage <= 1}
                  onClick={() => setAppPage(appPage - 1)}
                >
                  {t("Previous applications ")}
                </button>
                <span>
                  {tx(appListLoading ? "—" : (appTotal ?? "—"))}
                  {t(" results · Page ")}
                  {tx(appPage)}
                  {t(" /")}
                  {tx(" ")}
                  {tx(Math.max(1, Math.ceil((appTotal ?? 0) / appPageSize)))}
                </span>
                <button
                  className="secondary"
                  disabled={busy || appListLoading || appPage * appPageSize >= (appTotal ?? 0)}
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
              <div className="detail-layout detail-print-scope">
              <div className="detail-main">
              <section className="panel">
                <button className="text-button" onClick={closeDetail}>
                  {choose({ bn: "← সব আবেদন", en: "← All applications" })}
                </button>
                {/* WS-D2 (item 14): print the detail view. */}
                <button
                  type="button"
                  className="secondary no-print"
                  data-testid="print-application"
                  onClick={() => window.print()}
                >
                  {choose({ bn: "প্রিন্ট করুন", en: "Print" })}
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
                    <RefChip value={displayReference(application)} />
                  </div>
                  <ApplicationStatus
                    state={String(application.state || application.status || "")}
                  />
                </div>
                {/* WS-D2 (item 9): the chairman decides from this page —
                    so the citizen's identity is shown here in full (name,
                    birth date, masked NID / birth registration, mobile,
                    permanent address, photo and identity-document image
                    with its scan state) instead of a single name line. The
                    full NID is never printed here — only the masked hint
                    the API returns. */}
                {tx(
                  detail.citizen && (
                    <section
                      className="detail-identity"
                      aria-label={choose({
                        bn: "আবেদনকারীর পরিচয়",
                        en: "Applicant identity",
                      })}
                    >
                      <h3>
                        {choose({
                          bn: "আবেদনকারীর পরিচয়",
                          en: "Applicant identity",
                        })}
                      </h3>
                      <dl>
                        <dt>
                          {choose({ bn: "নাম", en: "Name" })}
                        </dt>
                        <dd>
                          {detail.citizen.nameBn || detail.citizen.name_bn}
                          {detail.citizen.nameEn || detail.citizen.name_en
                            ? ` / ${detail.citizen.nameEn || detail.citizen.name_en}`
                            : ""}
                        </dd>
                        <dt>
                          {choose({ bn: "পিতার নাম", en: "Father's name" })}
                        </dt>
                        <dd>
                          {detail.citizen.fatherNameBn ||
                            detail.citizen.father_name_bn ||
                            "—"}
                          {detail.citizen.fatherNameEn ||
                          detail.citizen.father_name_en
                            ? ` / ${detail.citizen.fatherNameEn || detail.citizen.father_name_en}`
                            : ""}
                        </dd>
                        <dt>
                          {choose({ bn: "মাতার নাম", en: "Mother's name" })}
                        </dt>
                        <dd>
                          {detail.citizen.motherNameBn ||
                            detail.citizen.mother_name_bn ||
                            "—"}
                          {detail.citizen.motherNameEn ||
                          detail.citizen.mother_name_en
                            ? ` / ${detail.citizen.motherNameEn || detail.citizen.mother_name_en}`
                            : ""}
                        </dd>
                        <dt>
                          {choose({ bn: "জন্ম তারিখ", en: "Date of birth" })}
                        </dt>
                        <dd>
                          {formatDate(
                            detail.citizen.dateOfBirth ||
                              detail.citizen.date_of_birth,
                            language,
                          )}
                        </dd>
                        <dt>
                          {choose({
                            bn: "জাতীয় পরিচয়পত্র",
                            en: "National ID",
                          })}
                        </dt>
                        <dd>
                          {detail.citizen.nidHint ||
                            detail.citizen.nid_hint ||
                            "—"}
                        </dd>
                        <dt>
                          {choose({
                            bn: "জন্ম নিবন্ধন",
                            en: "Birth registration",
                          })}
                        </dt>
                        <dd>
                          {detail.citizen.birthRegHint ||
                            detail.citizen.birth_reg_hint ||
                            "—"}
                        </dd>
                        <dt>
                          {choose({ bn: "মোবাইল", en: "Mobile" })}
                        </dt>
                        <dd>
                          {detail.citizen.contactMobile ||
                            detail.citizen.contact_mobile ||
                            "—"}
                        </dd>
                        <dt>
                          {choose({
                            bn: "স্থায়ী ঠিকানা",
                            en: "Permanent address",
                          })}
                        </dt>
                        <dd>
                          {choose({
                            bn:
                              detail.citizen.addressBn ||
                              detail.citizen.address_bn ||
                              "—",
                            en:
                              detail.citizen.addressEn ||
                              detail.citizen.address_en ||
                              detail.citizen.addressBn ||
                              detail.citizen.address_bn ||
                              "—",
                          })}
                        </dd>
                        {detail.citizen.hasPhoto && (
                          <>
                            <dt>
                              {choose({ bn: "ছবি", en: "Photo" })}
                            </dt>
                            <dd>
                              <img
                                className="detail-identity-photo"
                                src={`/api/v1/citizens/${detail.citizen.id}/photo/image`}
                                alt={choose({
                                  bn: "আবেদনকারীর ছবি",
                                  en: "Applicant photo",
                                })}
                              />
                            </dd>
                          </>
                        )}
                      </dl>
                      {detail.citizen.identityDocument?.attachmentId && (
                        <dl>
                          <IdentityDocumentStatus
                            attachmentId={
                              detail.citizen.identityDocument.attachmentId
                            }
                            kind={
                              detail.citizen.identityDocument.kind ?? "nid"
                            }
                          />
                        </dl>
                      )}
                    </section>
                  ),
                )}
                {tx(
                  application.dueAt &&
                    ["SUBMITTED", "RESUBMITTED", "UNDER_REVIEW", "APPROVED"].includes(
                      application.state,
                    ) && (
                      <p className={application.overdue ? "notice message error" : undefined}>
                        {application.overdue
                          ? choose({
                              bn: `নির্ধারিত সময় পেরিয়েছে — চার্টার সময়সীমা ছিল ${applicationDate(application.dueAt)}।`,
                              en: `Overdue — the charter due date was ${applicationDate(application.dueAt)}.`,
                            })
                          : choose({
                              bn: `চার্টার সময়সীমা: ${applicationDate(application.dueAt)}`,
                              en: `Charter due: ${applicationDate(application.dueAt)}`,
                            })}
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
                <PinnedSchema
                  serviceNo={application.serviceNo || application.service_no}
                  schemaVersion={application.schemaVersion}
                  order={!!detail.order}
                >
                  {(detailSchema) => {
                    const canEditPayload =
                      (staff || role === "citizen") &&
                      ["DRAFT", "CORRECTION_REQUIRED"].includes(application.state);
                    // FULL-UIUX-01 (B18/P1-7): a non-editable payload renders
                    // as the shared read-only summary — never a greyed-out
                    // form pretending to be a record.
                    const payloadSection = canEditPayload ? (
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
                    // WS-D2 (item 9, upstream): attached documents with their
                    // scan state and gated download, listed under the payload.
                    // Merged into the Phase 4 PinnedSchema render prop so the
                    // attachment titles come from the application's pinned
                    // schema version (B-003), not the current one.
                    let docs: {
                      title: { bn: string; en: string };
                      handle: AttachmentHandle;
                    }[] = [];
                    try {
                      docs = collectApplicationAttachments(
                        detailSchema,
                        detailPayload,
                      );
                    } catch {
                      docs = [];
                    }
                    return (
                      <>
                        {payloadSection}
                        <section
                          className="detail-attachments"
                          aria-label={choose({
                            bn: "সংযুক্ত নথি",
                            en: "Attached documents",
                          })}
                        >
                          <h3>
                            {choose({
                              bn: "সংযুক্ত নথি",
                              en: "Attached documents",
                            })}
                          </h3>
                          {docs.length ? (
                            docs.map((doc) => (
                              <div
                                key={doc.handle.attachmentId}
                                className="detail-attachment"
                              >
                                <p>
                                  <strong>{choose(doc.title)}</strong>
                                </p>
                                <AttachmentStatus attachment={doc.handle} />
                              </div>
                            ))
                          ) : (
                            <p className="hint">
                              {choose({
                                bn: "এই আবেদনে কোনো নথি সংযুক্ত হয়নি।",
                                en: "No documents are attached to this application.",
                              })}
                            </p>
                          )}
                        </section>
                      </>
                    );
                  }}
                </PinnedSchema>
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
                      ["DRAFT", "SUBMITTED", "CORRECTION_REQUIRED", "RESUBMITTED"].includes(
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
                      application.state === "REJECTED" && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              // W-014: start a new draft reusing this payload;
                              // the new draft opens so the citizen can review
                              // it (and choose delivery options when the
                              // office has a fee policy) before submitting.
                              const created = await api(
                                `/applications/${application.id}/reapply`,
                                "POST",
                                {},
                              );
                              await openApplication(created.id);
                            })
                          }
                        >
                          {choose({ bn: "আবার আবেদন করুন", en: "Re-apply" })}
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
                              // W-004: the renew idempotency key (see the
                              // renewalRequestKeys ref) — one key per source
                              // application, reused across retries.
                              let requestKey = renewalRequestKeys.current.get(application.id);
                              if (!requestKey) {
                                requestKey = randomUUID();
                                renewalRequestKeys.current.set(application.id, requestKey);
                              }
                              const renewal = await api(
                                `/applications/${application.id}/renew`,
                                "POST",
                                {
                                  requestKey,
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
                  <RefChip value={displayReference(application)} />
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
              {/* W-015: the queue-level overdue flag — how many office-waiting
                  applications are past their charter due date. */}
              {pendingCounts && pendingCounts.overdue > 0 && (
                <p className="notice message error" role="status">
                  {choose({
                    bn: `${localDigits(String(pendingCounts.overdue), language)}টি আবেদন নির্ধারিত সময় পেরিয়েছে।`,
                    en: `${pendingCounts.overdue} application${pendingCounts.overdue === 1 ? "" : "s"} past the charter due date.`,
                  })}
                </p>
              )}
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
              {pendingGroupSection(
                { bn: "নাগরিকের সংশোধনের অপেক্ষায়", en: "Awaiting citizen (correction requested)" },
                pendingCounts ? pendingCounts.awaitingCitizen : null,
                pendingCitizenStates,
              )}
              <p className="hint">
                {choose({
                  bn: "সংশোধনের জন্য ফেরত পাঠানো আবেদন নাগরিকের সংশোধনের অপেক্ষায় আছে — পরের পদক্ষেপ নাগরিকের, তবে এখান থেকে দেখা যায়।",
                  en: "Applications sent back for correction are waiting on the citizen — the next step is theirs, but they stay visible here.",
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
          {tx(page === "security" && <AccountSecurity role={role} />)}
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
                          // W-020: platform health (database, scanner,
                          // providers, backup, maintenance, alerts).
                          ["health", "reports", { bn: "প্ল্যাটফর্ম স্বাস্থ্য", en: "Platform health" }],
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
                  {/* W-012: global citizens / applications / certificates
                      totals, by state and by office. */}
                  <OwnerStatistics tenants={tenants} />
                </section>
                )}
                {ownerSection === "health" && (
                <section className="owner-section" id="owner-health">
                  <h2>{choose({ bn: "প্ল্যাটফর্ম স্বাস্থ্য", en: "Platform health" })}</h2>
                  <OwnerPlatformHealth />
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
                  <OwnerSupportContact />
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
            onClick={() => {
              setConfirmAction(null);
              setRevokeTarget(null);
              resetDialog();
            }}
          >
            <div
              className="ws-confirm"
              role="dialog"
              aria-modal="true"
              aria-label={choose(transitionConfirmTitle[confirmAction])}
              onClick={(event) => event.stopPropagation()}
            >
              <h2>{choose(transitionConfirmTitle[confirmAction])}</h2>
              <p>
                {choose({ bn: "আবেদন নম্বর", en: "Application" })}
                {tx(": ")}
                <strong>{tx(application.reference)}</strong>
              </p>
              {/* R13-GAPS (B1 limit): the revoke confirmation names the
                  certificate it will act on (QA-13: confirm with the
                  number), captured when the button was pressed. */}
              {confirmAction === "revoke" && revokeTarget && (
                <p>
                  {choose({ bn: "সনদ নম্বর", en: "Certificate" })}
                  {tx(": ")}
                  <strong>{tx(revokeTarget.number)}</strong>
                </p>
              )}
              <p>{choose(transitionConfirmText[confirmAction])}</p>
              {/* WS-D2 (item 16): reject / correction / summons collect
                  their reason here — a decision is never sent without
                  one. Approve keeps the plain confirmation above. */}
              {confirmAction === "reject" && (
                <>
                  <label htmlFor="dialog-reason">
                    {choose({
                      bn: "প্রত্যাখ্যানের কারণ",
                      en: "Rejection reason",
                    })}
                  </label>
                  <select
                    id="dialog-reason"
                    data-testid="dialog-reason"
                    value={dialogReason}
                    onChange={(e) => {
                      setDialogReason(e.target.value);
                      setDialogError(null);
                    }}
                  >
                    <option value="">
                      {choose({
                        bn: "— কারণ বেছে নিন —",
                        en: "— Choose a reason —",
                      })}
                    </option>
                    {rejectReasons.map((r) => (
                      <option key={r.value} value={r.value}>
                        {choose(r)}
                      </option>
                    ))}
                  </select>
                  <label htmlFor="dialog-note">
                    {choose({
                      bn:
                        dialogReason === "other"
                          ? "কারণটি লিখুন (আবশ্যক)"
                          : "বিস্তারিত (ঐচ্ছিক)",
                      en:
                        dialogReason === "other"
                          ? "Write the reason (required)"
                          : "Details (optional)",
                    })}
                  </label>
                  <textarea
                    id="dialog-note"
                    data-testid="dialog-note"
                    value={dialogNote}
                    maxLength={300}
                    onChange={(e) => {
                      setDialogNote(e.target.value);
                      setDialogError(null);
                    }}
                    placeholder={choose({
                      bn: "নাগরিককে জানানো হবে এমন ভাষায় লিখুন",
                      en: "Write it as the citizen will read it",
                    })}
                  />
                </>
              )}
              {confirmAction === "request_correction" && (
                <>
                  <label htmlFor="dialog-field">
                    {choose({
                      bn: "কোন তথ্য সংশোধন করতে হবে",
                      en: "What needs correction",
                    })}
                  </label>
                  <select
                    id="dialog-field"
                    data-testid="dialog-field"
                    value={dialogField}
                    onChange={(e) => {
                      setDialogField(e.target.value);
                      setDialogError(null);
                    }}
                  >
                    <option value="">
                      {choose({
                        bn: "— তথ্য বেছে নিন —",
                        en: "— Choose the information —",
                      })}
                    </option>
                    <option value="__all__">
                      {choose({ bn: "সব তথ্য", en: "All information" })}
                    </option>
                    {correctionFieldOptions.map((f) => (
                      <option key={f.id} value={f.id}>
                        {choose(f.label)}
                      </option>
                    ))}
                  </select>
                  <label htmlFor="dialog-reason">
                    {choose({
                      bn: "সংশোধনের কারণ",
                      en: "Correction reason",
                    })}
                  </label>
                  <select
                    id="dialog-reason"
                    data-testid="dialog-reason"
                    value={dialogReason}
                    onChange={(e) => {
                      setDialogReason(e.target.value);
                      setDialogError(null);
                    }}
                  >
                    <option value="">
                      {choose({
                        bn: "— কারণ বেছে নিন —",
                        en: "— Choose a reason —",
                      })}
                    </option>
                    {correctionReasons.map((r) => (
                      <option key={r.value} value={r.value}>
                        {choose(r)}
                      </option>
                    ))}
                  </select>
                  <label htmlFor="dialog-deadline">
                    {choose({
                      bn: "সংশোধনের সময়সীমা",
                      en: "Correction deadline",
                    })}
                  </label>
                  <select
                    id="dialog-deadline"
                    data-testid="dialog-deadline"
                    value={dialogDeadline}
                    onChange={(e) => setDialogDeadline(e.target.value)}
                  >
                    {correctionDeadlines.map((d) => (
                      <option key={d.value} value={d.value}>
                        {choose(d)}
                      </option>
                    ))}
                  </select>
                  <label htmlFor="dialog-note">
                    {choose({
                      bn:
                        dialogReason === "other"
                          ? "কারণটি লিখুন (আবশ্যক)"
                          : "বিস্তারিত (ঐচ্ছিক)",
                      en:
                        dialogReason === "other"
                          ? "Write the reason (required)"
                          : "Details (optional)",
                    })}
                  </label>
                  <textarea
                    id="dialog-note"
                    data-testid="dialog-note"
                    value={dialogNote}
                    maxLength={300}
                    onChange={(e) => {
                      setDialogNote(e.target.value);
                      setDialogError(null);
                    }}
                    placeholder={choose({
                      bn: "কী বদলাতে হবে তা পরিষ্কার করে লিখুন",
                      en: "Say clearly what must change",
                    })}
                  />
                </>
              )}
              {confirmAction === "summon" && (
                <>
                  <label htmlFor="dialog-when">
                    {choose({ bn: "কবে আসতে হবে", en: "When to come" })}
                  </label>
                  <input
                    id="dialog-when"
                    data-testid="dialog-when"
                    type="text"
                    value={dialogWhen}
                    maxLength={120}
                    onChange={(e) => {
                      setDialogWhen(e.target.value);
                      setDialogError(null);
                    }}
                    placeholder={choose({
                      bn: "যেমন: আগামী সোমবার, সকাল ১০টা",
                      en: "For example: next Monday, 10 AM",
                    })}
                  />
                  <label htmlFor="dialog-where">
                    {choose({ bn: "কোথায় আসতে হবে", en: "Where to come" })}
                  </label>
                  <input
                    id="dialog-where"
                    data-testid="dialog-where"
                    type="text"
                    value={dialogWhere}
                    maxLength={200}
                    onChange={(e) => {
                      setDialogWhere(e.target.value);
                      setDialogError(null);
                    }}
                    placeholder={choose({
                      bn: "অফিসের নাম ও ঠিকানা",
                      en: "Office name and address",
                    })}
                  />
                  <label htmlFor="dialog-reason">
                    {choose({
                      bn: "আসতে বলার কারণ",
                      en: "Reason for asking them to come",
                    })}
                  </label>
                  <select
                    id="dialog-reason"
                    data-testid="dialog-reason"
                    value={dialogReason}
                    onChange={(e) => {
                      setDialogReason(e.target.value);
                      setDialogError(null);
                    }}
                  >
                    <option value="">
                      {choose({
                        bn: "— কারণ বেছে নিন —",
                        en: "— Choose a reason —",
                      })}
                    </option>
                    {summonReasons.map((r) => (
                      <option key={r.value} value={r.value}>
                        {choose(r)}
                      </option>
                    ))}
                  </select>
                  <label htmlFor="dialog-note">
                    {choose({
                      bn:
                        dialogReason === "other"
                          ? "কারণটি লিখুন (আবশ্যক)"
                          : "বিস্তারিত (ঐচ্ছিক)",
                      en:
                        dialogReason === "other"
                          ? "Write the reason (required)"
                          : "Details (optional)",
                    })}
                  </label>
                  <textarea
                    id="dialog-note"
                    data-testid="dialog-note"
                    value={dialogNote}
                    maxLength={300}
                    onChange={(e) => {
                      setDialogNote(e.target.value);
                      setDialogError(null);
                    }}
                    placeholder={choose({
                      bn: "সঙ্গে কী আনতে হবে তা লিখতে পারেন",
                      en: "You can note what to bring",
                    })}
                  />
                </>
              )}
              {dialogError && (
                <p className="field-error" role="alert">
                  {choose(dialogError)}
                </p>
              )}
              <div className="ws-confirm-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setConfirmAction(null);
                    setRevokeTarget(null);
                    resetDialog();
                  }}
                >
                  {choose({ bn: "বাতিল", en: "Cancel" })}
                </button>
                <button
                  type="button"
                  className={
                    confirmAction === "reject" || confirmAction === "revoke"
                      ? "danger"
                      : undefined
                  }
                  data-testid="confirm-transition"
                  disabled={busy}
                  onClick={() => {
                    const action = confirmAction;
                    // R13-GAPS (B1 limit): revocation is not an
                    // application transition — it posts to the
                    // certificate endpoint for the captured cert.
                    if (action === "revoke") {
                      const target = revokeTarget;
                      setConfirmAction(null);
                      setRevokeTarget(null);
                      if (target) void run(() => revokeCertificate(target));
                      return;
                    }
                    if (
                      ["reject", "request_correction", "summon"].includes(
                        action,
                      ) &&
                      !validateDialog(action)
                    )
                      return;
                    const composed =
                      ["reject", "request_correction", "summon"].includes(
                        action,
                      )
                        ? composeDialogReason(action)
                        : undefined;
                    setConfirmAction(null);
                    void run(() => runTransition(action, composed));
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
              <button
                type="button"
                data-page="logout"
                className="ws-logout-item"
                onClick={signOut}
              >
                <NavIcon name="logout" />
                <span>{choose({ bn: "লগআউট", en: "Sign out" })}</span>
              </button>
            </div>
          )}
          <nav
            className="ws-tabbar"
            aria-label={choose({ bn: "প্রধান পৃষ্ঠা", en: "Main pages" })}
          >
            {(role === "citizen"
              ? ["home", "services", "applications", "profile"]
              : ["home", "pending", "applications", "services", "citizens", "profile"]
            )
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
