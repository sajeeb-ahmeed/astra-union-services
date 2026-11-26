import { ShortSignupForm, type ShortSignupResult } from "./ShortSignup.js";
import { t, tx, choose, useLanguage } from "./i18n.js";
import { SiteFooter, SiteHeader } from "./PublicShell.js";
import { GlobalNoticeBanner } from "./GlobalNotices.js";
import { ApplicationStatus, EmptyState, ServiceCard, serviceCardMetaRich } from "./ui/kit.js";
import {
  loadServiceOfficeSummaries,
  type ServiceOfficeSummary,
} from "./service-office-summary.js";
import { formatDateTime, localDigits } from "./ui/fmt.js";
import { categoryLabel } from "./service-categories.js";
import { serviceNoFromSlug, servicePath } from "./service-slugs.js";
import {
  OFFICES_HUB_SEO,
  SERVICES_HUB_SEO,
  VERIFY_SEO,
  faqFor,
  officeDescription,
  officePath,
  officeTitle,
  relatedServices,
  serviceDescription,
  serviceSeo,
  serviceTitle,
} from "./seo/service-seo.js";
import { applyPageHead } from "./seo/head.js";
import { BrandLockup } from "./BrandLockup.js";
import { getServiceSchema } from "@astra/shared-schemas";
import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
// Phase 4c: the witness generator loads only on /witness, keeping the public start-up bundle small.
const UserGuide = lazy(() => import("./UserGuide.js").then((m) => ({ default: m.UserGuide })));
const WitnessGenerator = lazy(() => import("./WitnessGenerator.js").then((m) => ({ default: m.WitnessGenerator })));
import "./public-usability.css";
import "./public-portal.css";
// Public pages need names only; canonical metadata parity is checked by the web tests.
import serviceCatalog from "./public-service-catalog.json" with { type: "json" };
import { api, items } from "./api.js";
import { ServicePriceList, taka } from "./ServicePriceList.js";
import { DesignatedOfficers, OfficeInclusionForm } from "./OfficeInclusion.js";
import {
  GeographyFields,
  geographyPayload,
  emptyGeography,
  readGeography,
} from "./GeographyFields.js";
import { LanguageSwitcher } from "./i18n.js";

/* FULL-UIUX-01 (A1/P0-2): page names ARE the one shell's nav labels —
   PUBLIC_NAV in PublicShell.tsx is the single vocabulary. */
const publicPages: Record<string, [string, string]> = {
  home: ["হোম", "Home"],
  services: ["নাগরিক সেবা", "Services"],
  offices: ["ইউনিয়ন অফিস", "Union offices"],
  notices: ["নোটিশ", "Notices"],
  help: ["সাধারণ জিজ্ঞাসা", "Help & FAQ"],
  witness: ["সাক্ষীর প্রত্যয়ন", "Witness statement"],
  guide: ["ব্যবহার নির্দেশিকা", "User guide"],
  tracking: ["আবেদনের অবস্থা", "Track application"],
  verify: ["সনদ যাচাই", "Verify certificate"],
  "verify-email": ["ইমেইল যাচাই", "Verify email"],
  login: ["লগইন", "Sign in"],
  register: ["নিবন্ধন", "Register"],
  policies: ["নীতি", "Policies"],
  recover: ["অ্যাকাউন্ট পুনরুদ্ধার", "Account recovery"],
};
const value = (o: any, camel: string, snake: string) =>
  o?.[camel] ?? o?.[snake] ?? "";
function RecoveryForm() {
  const [token, setToken] = useState(
      new URLSearchParams(location.search).get("token") || "",
    ),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  const [mfaRecoveryBlocked, setMfaRecoveryBlocked] = useState(false);
  useEffect(() => {
    if (location.search) history.replaceState({}, "", "/recover");
  }, []);
  return (
    <section className="panel narrow">
      <h1>{t("অ্যাকাউন্ট পুনরুদ্ধার / Account recovery")}</h1>
      <p>
        {t(
          "Contact your office administrator using your existing trusted contact channel to recover your account. After checking the request, they can provide a one-use recovery link valid for 15 minutes. ",
        )}
      </p>
      {tx(
        done ? (
          <p role="status" className="notice">
            {t("Password reset completed. All earlier sessions have expired.")}
            {tx(" ")}
            <a href="/login">{t("Sign in with your new password")}</a>
            {t(". ")}
          </p>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              if (d.get("password") !== d.get("confirm")) {
                setMessage("Passwords must match.");
                return;
              }
              setBusy(true);
              setMessage("");
              setMfaRecoveryBlocked(false);
              try {
                await api("/auth/recover", "POST", {
                  token,
                  newPassword: d.get("password"),
                });
                setDone(true);
                setToken("");
              } catch (e) {
                if (
                  (e as any)?.details?.error?.code === "MFA_RECOVERY_REQUIRED"
                )
                  setMfaRecoveryBlocked(true);
                else setMessage((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label htmlFor="recovery-token">{t("Recovery token")}</label>
            <input
              id="recovery-token"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
            />
            <label htmlFor="recovery-password">{t("New password")}</label>
            <input
              id="recovery-password"
              type="password"
              name="password"
              minLength={6}
              maxLength={18}
              required
              autoComplete="new-password"
            />
            <label htmlFor="recovery-confirm">
              {t("Confirm new password")}
            </label>
            <input
              id="recovery-confirm"
              type="password"
              name="confirm"
              minLength={6}
              maxLength={18}
              required
              autoComplete="new-password"
            />
            <button disabled={busy}>{t("Reset password")}</button>
          </form>
        ),
      )}
      {tx(
        message && (
          <p className="notice error" role="alert">
            {tx(message)}
          </p>
        ),
      )}
      {mfaRecoveryBlocked && (
        <p className="notice error" role="alert">
          {choose({
            bn: "এই অ্যাকাউন্টে দুই ধাপের নিরাপত্তা চালু আছে। পাসওয়ার্ড জানা থাকলে authenticator বা সংরক্ষিত recovery code দিয়ে লগইন করুন। সহায়তাপ্রাপ্ত MFA reset এখনও চালু হয়নি; এই recovery link দিয়ে নিরাপত্তা এড়ানো যাবে না।",
            en: "This account uses two-step security. If you know your password, sign in with your authenticator or a saved recovery code. Assisted MFA reset is not available yet; this recovery link cannot bypass that protection.",
          })}
        </p>
      )}
    </section>
  );
}
function ApplicationTracking() {
  const [language] = useLanguage();
  const [id, setId] = useState(""),
    [result, setResult] = useState<any>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function lookup(reference: string) {
    setBusy(true);
    setMessage("");
    setResult(null);
    try {
      setResult(await api(`/track/${encodeURIComponent(reference.trim())}`));
    } catch {
      setMessage(
        choose({
          bn: "আবেদনটি পাওয়া যায়নি। সম্পূর্ণ রেফারেন্স নম্বরটি যাচাই করে আবার চেষ্টা করুন।",
          en: "Application not found. Check the full reference and try again.",
        }),
      );
    } finally {
      setBusy(false);
    }
  }
  // FULL-UIUX-01 · THE EXCEPTION (checklist A9/P2-2): /tracking honours
  // ?searchText= exactly as /verify does, so a printed or shared tracking
  // link lands on the result instead of an empty form.
  useEffect(() => {
    const shared = new URLSearchParams(location.search).get("searchText");
    if (shared) {
      setId(shared);
      void lookup(shared);
    }
    // Runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="public-tool-grid">
      <section className="panel">
        <h1>{choose({ bn: "আবেদনের বর্তমান অবস্থা", en: "Application status" })}</h1>
        <p>
          {choose({
            bn: "জমা দেওয়া আবেদনের সম্পূর্ণ রেফারেন্স নম্বরটি লিখুন। খসড়া আবেদন ব্যক্তিগত থাকে। ফলাফলে শুধু অবস্থা ও সেবার তথ্য দেখা যায়।",
            en: "Enter the full reference of a submitted application from your signed-in application page. Drafts stay private. Results contain status and service information only.",
          })}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void lookup(id);
          }}
        >
          <label htmlFor="tracking-id">
            {choose({ bn: "আবেদনের রেফারেন্স নম্বর", en: "Application reference" })}
          </label>
          <input
            id="tracking-id"
            required
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder={choose({
              bn: "সম্পূর্ণ রেফারেন্স নম্বরটি লিখুন",
              en: "Enter the full reference",
            })}
          />
          <button disabled={busy}>
            {choose({ bn: "অবস্থা দেখুন", en: "Track application" })}
          </button>
        </form>
      {tx(
        message && (
          <p role="alert" className="notice">
            {tx(message)}
          </p>
        ),
      )}
      {tx(
        result && (
          <div className="tracking-result">
            <h2>{choose({ bn: result.serviceBn, en: result.serviceEn })}</h2>
            <ApplicationStatus state={String(result.status ?? "")} />
            <p>{choose({ bn: result.officeBn, en: result.officeEn })}</p>
            <small>
              {choose({ bn: "জমার রেকর্ড: ", en: "Submitted record: " })}
              {formatDateTime(result.createdAt, language)}
            </small>
          </div>
        ),
      )}
      </section>
      <div className="public-tool-visual">
        {/* PORTAL-E: no sample-certificate picture ("নমুনা") on a citizen page. */}
        {/* REFINEMENT-02 P1-12: a "what you need" panel instead of bare
            decoration, plus the cross-link to certificate verification. */}
        <div className="tool-need">
          <h2>{choose({ bn: "কী লাগবে", en: "What you need" })}</h2>
          <ul>
            <li>
              {choose({
                bn: "আবেদনের সম্পূর্ণ রেফারেন্স নম্বর — জমা দেওয়ার পর প্রাপ্তি ও আপনার অ্যাকাউন্টের আবেদন তালিকায় থাকে।",
                en: "The full application reference — shown on the submission receipt and in your account's application list.",
              })}
            </li>
            <li>
              {choose({
                bn: "খসড়া আবেদন ট্র্যাক করা যায় না — আগে জমা দিন।",
                en: "Drafts cannot be tracked — submit the application first.",
              })}
            </li>
          </ul>
        </div>
        <p>
          {choose({
            bn: "ইস্যু হওয়া সনদ যাচাই করতে সনদ যাচাই পৃষ্ঠা ব্যবহার করুন।",
            en: "To check an issued certificate, use the Verify page.",
          })}{" "}
          <a href="/verify">{choose({ bn: "সনদ যাচাই →", en: "Verify a certificate →" })}</a>
        </p>
      </div>
    </div>
  );
}
export function CivicIcon({ index = 0 }: { index?: number }) {
  return (
    <svg
      viewBox="0 0 48 48"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {tx(
        index % 3 === 0 ? (
          <>
            <path d="M13 5h17l7 7v31H13zM29 5v9h8M19 21h12M19 27h12M19 33h6" />
            <circle cx="31" cy="35" r="5" />
          </>
        ) : index % 3 === 1 ? (
          <>
            <path d="m5 18 19-12 19 12H5ZM9 41h30M12 22v14M24 22v14M36 22v14M6 36h36v5H6z" />
          </>
        ) : (
          <>
            <circle cx="24" cy="14" r="7" />
            <path d="M10 40v-6a14 14 0 0 1 28 0v6H10ZM16 27l8 7 8-7" />
          </>
        ),
      )}
    </svg>
  );
}
/** Phase X: consume the email-verification link (or a pasted token) from /verify-email. */
function EmailVerificationForm() {
  const [token, setToken] = useState(
      new URLSearchParams(location.search).get("token") || "",
    ),
    [status, setStatus] = useState<"idle" | "verifying" | "verified" | "error">("idle"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function verify(value: string) {
    setBusy(true);
    setStatus("verifying");
    setMessage("");
    try {
      await api("/auth/email/verify", "POST", { token: value });
      setStatus("verified");
      setToken("");
    } catch (e) {
      setStatus("error");
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const initial = new URLSearchParams(location.search).get("token");
    if (location.search) history.replaceState({}, "", "/verify-email");
    if (initial) void verify(initial);
    // Runs once on mount: a token in the link is consumed immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <section className="panel narrow">
      <h1>{t("ইমেইল যাচাই / Verify your email")}</h1>
      <p>
        {t(
          "আপনার ইমেইলে পাঠানো লিংকটি খুললেই যাচাই সম্পন্ন হয়। লিংক কাজ না করলে টোকেনটি নিচে বসিয়ে যাচাই করুন। যাচাই ঐচ্ছিক — এটি ছাড়াও সাইন ইন করা যায়। / Opening the link sent to your email completes verification. If the link does not work, paste the token below. Verification is optional — you can sign in without it. ",
        )}
      </p>
      {tx(
        status === "verified" ? (
          <p role="status" className="notice">
            {t("আপনার ইমেইল ঠিকানা যাচাই হয়েছে। ধন্যবাদ! / Your email address has been verified. Thank you! ")}
            <a href="/login">{t("সাইন ইন / Sign in")}</a>
          </p>
        ) : status === "verifying" ? (
          <p role="status" className="notice">
            {t("যাচাই করা হচ্ছে… / Verifying…")}
          </p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void verify(token.trim());
            }}
          >
            <label htmlFor="email-verification-token">{t("যাচাইকরণ টোকেন / Verification token")}</label>
            <input
              id="email-verification-token"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
            />
            <button disabled={busy}>{t("যাচাই করুন / Verify email")}</button>
          </form>
        ),
      )}
      {tx(
        message && (
          <p className="notice error" role="alert">
            {tx(message)}
          </p>
        ),
      )}
    </section>
  );
}
export function PublicPortal({
  login,
  onNavigate,
}: {
  login: React.ReactNode;
  onNavigate?: () => void;
}) {
  const [language] = useLanguage();
  const officeDetailRef = useRef<HTMLElement>(null);
  const initial = location.pathname.split("/")[1] || "home";
  // FULL-UIUX-01: a service is a real page — /services/<slug> (the numeric
  // /services/<no> stays as an alias, and the legacy ?service=N link is
  // canonicalised to the slug path on mount).
  const linkedService = Number(new URLSearchParams(location.search).get("service"));
  const slugService =
    initial === "services"
      ? serviceNoFromSlug(location.pathname.split("/")[2] ?? "")
      : null;
  // QAFIX-09 (B2): a /services/<segment> URL whose segment resolves
  // to nothing is a missing page, not the catalogue — the soft-404
  // the 2026-11-23 QA flagged (e.g. /services/citizenship, when the
  // real page is /services/citizenship-certificate). The legacy
  // ?service=N alias still counts as a resolution.
  const legacyLinked =
    Number.isInteger(linkedService) && linkedService >= 1 && linkedService <= 47;
  const slugMissed = (pageName: string, segment: string, resolved: number | null) =>
    pageName === "services" && segment !== "" && resolved === null && !legacyLinked;
  const [slugMiss, setSlugMiss] = useState<boolean>(
    slugMissed(initial, location.pathname.split("/")[2] ?? "", slugService),
  );
  // SEO P10: an office is addressable at /offices/<slug>; the slug lives in
  // state (plus a ref for the directory's URL writer) alongside the detail.
  const initialOfficeSlug =
    initial === "offices" && location.pathname.split("/")[2]
      ? decodeURIComponent(location.pathname.split("/")[2])
      : null;
  const officeSlugRef = useRef<string | null>(initialOfficeSlug);
  const [officeSlug, setOfficeSlugState] = useState<string | null>(initialOfficeSlug);
  function setOfficeSlug(next: string | null) {
    officeSlugRef.current = next;
    setOfficeSlugState(next);
  }
  const [page, setPage] = useState(initial),
    [search, setSearch] = useState(""),
    [category, setCategory] = useState(""),
    [serviceNo, setServiceNo] = useState<number | null>(
      slugService ??
        (initial === "services" && Number.isInteger(linkedService) && linkedService >= 1 && linkedService <= 47
          ? linkedService
          : null),
    );
  useEffect(() => {
    if (initial === "services" && slugService === null && serviceNo !== null) {
      history.replaceState({}, "", servicePath(serviceNo));
    }
    // Canonicalise once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Phase 6: per-office fee/time/documents for the selected service, from the public office-info API.
  const [serviceInfo, setServiceInfo] = useState<{
    no: number;
    state: "loading" | "ready" | "error";
    offices: any[];
  } | null>(null);
  // BUNDLE06-R5 C2: published fee/time summaries for the catalog cards.
  const [officeSummaries, setOfficeSummaries] =
    useState<Map<number, ServiceOfficeSummary> | null>(null);
  useEffect(() => {
    let active = true;
    void loadServiceOfficeSummaries().then((map) => {
      if (active) setOfficeSummaries(map);
    });
    return () => {
      active = false;
    };
  }, []);
  const initialFilters = Object.fromEntries(
    new URLSearchParams(location.search),
  );
  const [filters, setFilters] = useState({
    q: initialFilters.q || "",
    type: initialFilters.type || "",
  });
  const [directoryGeography, setDirectoryGeography] = useState(() =>
    readGeography(initialFilters),
  );
  const [officePageSize, setOfficePageSize] = useState(
    Number(initialFilters.pageSize || 6),
  );
  const [directory, setDirectory] = useState<any>({
      items: [],
      total: 0,
      page: Number(initialFilters.page || 1),
      pageSize: 6,
    }),
    [office, setOffice] = useState<any>(null),
    [notices, setNotices] = useState<any[]>([]),
    [error, setError] = useState(""),
    [working, setWorking] = useState(false),
    [token, setToken] = useState("");
  const [supportMessage, setSupportMessage] = useState("");
  const [noticePage, setNoticePage] = useState(1),
    [noticeTotal, setNoticeTotal] = useState(0),
    [noticeSearch, setNoticeSearch] = useState(
      initial === "notices" ? initialFilters.q || "" : "",
    ),
    [faqSearch, setFaqSearch] = useState("");
  const [signupGeography, setSignupGeography] = useState(emptyGeography);
  const [signupOfficeLoading, setSignupOfficeLoading] = useState(false);
  const [signupOfficeError, setSignupOfficeError] = useState("");
  const [signupOfficeRetry, setSignupOfficeRetry] = useState(0);
  const [signupOffices, setSignupOffices] = useState<any[]>([]);
  // REG-UX Phase 1: one-screen signup. The office is preselected as a DEFAULT
  // (K3 — never a hard-code): ?office=<slug>, else the server's configured
  // default (DEFAULT_SIGNUP_OFFICE_SLUG), else the only listed office. The area
  // cascade appears only when the citizen chooses "Change".
  const [registration, setRegistration] = useState({ tenantId: "" });
  const [signupOfficeLabel, setSignupOfficeLabel] = useState("");
  const [signupDefaultLoading, setSignupDefaultLoading] = useState(false);
  const [changingOffice, setChangingOffice] = useState(false);
  const [registeredAs, setRegisteredAs] = useState<ShortSignupResult | null>(null);
  const defaultOfficeTried = useRef(false);
  function rememberLoginPrefill(type: "email" | "mobile", identifier: string) {
    try {
      sessionStorage.setItem("du.loginPrefill", JSON.stringify({ type, identifier }));
      dispatchEvent(new Event("du:login-prefill"));
    } catch {
      /* storage unavailable: the sign-in form simply starts empty */
    }
  }
  function adoptSignupOffice(o: any) {
    setRegistration({ tenantId: o.id });
    setSignupOffices([o]);
    setSignupGeography(readGeography(o.geography));
    setSignupOfficeLabel(
      choose({ bn: value(o, "nameBn", "name_bn"), en: value(o, "nameEn", "name_en") }),
    );
  }
  useEffect(() => {
    if (page !== "register" || registration.tenantId || defaultOfficeTried.current) return;
    defaultOfficeTried.current = true;
    let active = true;
    setSignupDefaultLoading(true);
    const wanted = new URLSearchParams(location.search).get("office") ?? "";
    Promise.all([
      api("/health").catch(() => null),
      api("/offices?pageSize=100"),
    ])
      .then(async ([health, list]) => {
        if (!active) return;
        const offices = items(list);
        const slug = wanted || health?.signup?.defaultOffice || "";
        // PORTAL-E: the requested office is looked up by its slug, not only
        // inside the first 100 listed — beyond 100 offices "?office=" (and
        // the server's default office) silently stopped preselecting.
        let bySlug = slug ? offices.find((o: any) => o.slug === slug) : null;
        if (slug && !bySlug) {
          const found = await api(`/offices?q=${encodeURIComponent(slug)}&pageSize=20`).catch(() => null);
          bySlug = found ? items(found).find((o: any) => o.slug === slug) : null;
        }
        if (!active) return;
        const pick = bySlug || (Number(list?.total ?? offices.length) === 1 ? offices[0] : null);
        if (pick) adoptSignupOffice(pick);
        else setChangingOffice(true);
      })
      .catch(() => {
        if (active) setChangingOffice(true);
      })
      .finally(() => {
        if (active) setSignupDefaultLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);
  // Phase 6b: the FAQ text loads only when the help page opens, keeping the public start-up bundle small.
  const [faq, setFaq] = useState<{ id: string; q: { bn: string; en: string }; a: { bn: string; en: string } }[]>([]);
  useEffect(() => {
    if (page !== "help" || faq.length) return;
    import("./faq.json").then((m) => setFaq(m.default)).catch(() => setFaq([]));
  }, [page]);
  // UIUX-FIX-01: there is exactly one public homepage — the PublicHome
  // composition at "/". The portal no longer renders its own home view;
  // any legacy "home" state redirects there.
  useEffect(() => {
    if (page === "home") location.replace("/");
  }, [page]);
  function nav(next: string) {
    onNavigate?.();
    // Phase 1: "/" is the new public home, outside this legacy component.
    if (next === "home") {
      location.assign("/");
      return;
    }
    setPage(next);
    setOffice(null);
    if (next !== "offices") setOfficeSlug(null);
    setError("");
    history.pushState({}, "", next === "home" ? "/" : `/${next}`);
    window.scrollTo(0, 0);
  }
  useEffect(() => {
    const pop = () => {
      onNavigate?.();
      if (location.pathname === "/") {
        location.reload();
        return;
      }
      const next = location.pathname.split("/")[1] || "home";
      setPage(next);
      const resolved =
        next === "services"
          ? serviceNoFromSlug(location.pathname.split("/")[2] ?? "")
          : null;
      setServiceNo(resolved);
      setSlugMiss(
        slugMissed(next, location.pathname.split("/")[2] ?? "", resolved),
      );
      // SEO P10: back/forward restores an open office from its slug URL.
      if (next === "offices") {
        const slug = location.pathname.split("/")[2] ?? "";
        setOfficeSlug(slug ? decodeURIComponent(slug) : null);
        if (!slug) setOffice(null);
      } else {
        setOffice(null);
      }
    };
    addEventListener("popstate", pop);
    return () => removeEventListener("popstate", pop);
  }, [onNavigate]);
  // SEO P5: per-page head for the client-rendered public routes
  // (prerendered routes carry the same tags statically).
  useEffect(() => {
    if (page === "services" && serviceNo !== null) {
      const seo = serviceSeo(serviceNo);
      applyPageHead({
        title: serviceTitle(seo, language),
        description: serviceDescription(seo, language),
        canonicalPath: servicePath(serviceNo),
      });
    } else if (page === "services" && slugMiss) {
      // QAFIX-09 (B2): a missed slug is not the hub — its head must
      // not claim the hub's title/canonical either.
      applyPageHead({
        title: `${choose({ bn: "সেবাটি পাওয়া যায়নি", en: "Service not found" })} | DigitalUnion`,
        description: choose({
          bn: "এই ঠিকানায় কোনো সেবা নেই।",
          en: "There is no service at this address.",
        }),
        canonicalPath: location.pathname,
        robots: "noindex, follow",
      });
    } else if (page === "services") {
      applyPageHead({
        title: SERVICES_HUB_SEO.title[language],
        description: SERVICES_HUB_SEO.description[language],
        canonicalPath: "/services",
      });
    } else if (page === "offices" && office) {
      const name = {
        bn: value(office.office, "nameBn", "name_bn"),
        en: value(office.office, "nameEn", "name_en"),
      };
      applyPageHead({
        title: officeTitle(name)[language],
        description: officeDescription(name)[language],
        canonicalPath: officePath(office.office.slug),
      });
    } else if (page === "offices") {
      applyPageHead({
        title: OFFICES_HUB_SEO.title[language],
        description: OFFICES_HUB_SEO.description[language],
        canonicalPath: "/offices",
      });
    } else if (page === "verify") {
      applyPageHead({
        title: VERIFY_SEO.title[language],
        description: VERIFY_SEO.description[language],
        canonicalPath: "/verify",
      });
    } else if (page === "tracking") {
      applyPageHead({
        title: `${choose({ bn: "আবেদনের অবস্থা", en: "Track application" })} | DigitalUnion`,
        canonicalPath: "/tracking",
        robots: "noindex, follow",
      });
    } else if (["login", "register", "recover", "verify-email", "witness"].includes(page)) {
      applyPageHead({
        title: `${choose({ bn: publicPages[page]?.[0] ?? "DigitalUnion", en: publicPages[page]?.[1] ?? "DigitalUnion" })} | DigitalUnion`,
        canonicalPath: `/${page}`,
        robots: "noindex, follow",
      });
    } else if (publicPages[page]) {
      applyPageHead({
        title: `${choose({ bn: publicPages[page][0], en: publicPages[page][1] })} | DigitalUnion`,
        canonicalPath: `/${page}`,
      });
    }
  }, [page, serviceNo, office, language, slugMiss]);
  async function loadOffices(p = 1) {
    setWorking(true);
    setError("");
    const query = new URLSearchParams({
      ...filters,
      ...geographyPayload(directoryGeography),
      page: String(p),
      pageSize: String(officePageSize),
    });
    try {
      const result = await api(`/offices?${query}`);
      setDirectory(result);
      // SEO P10: keep an open office's slug URL in the address bar.
      const base = officeSlugRef.current ? officePath(officeSlugRef.current) : "/offices";
      history.replaceState({}, "", `${base}?${query}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  async function loadNotices(p = 1) {
    setWorking(true);
    setError("");
    const query = new URLSearchParams({
      q: noticeSearch,
      page: String(p),
      pageSize: "6",
    });
    try {
      const result = await api(`/notices?${query}`);
      setNotices(items(result));
      setNoticeTotal(result.total);
      setNoticePage(result.page);
      history.replaceState({}, "", `/notices?${query}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  useEffect(() => {
    if (page === "offices")
      void loadOffices(
        Number(new URLSearchParams(location.search).get("page") || 1),
      );
    if (page === "notices")
      void loadNotices(
        Number(new URLSearchParams(location.search).get("page") || 1),
      );
  }, [page]);
  useEffect(() => {
    if (page !== "register" || !signupGeography.unionCode) {
      setSignupOfficeLoading(false);
      return;
    }
    let active = true;
    setSignupOfficeLoading(true);
    setSignupOfficeError("");
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({
        pageSize: "100",
        q: "",
        ...geographyPayload({ ...signupGeography, wardCode: "" }),
      });
      api(`/offices?${query}`)
        .then((response) => {
          if (!active) return;
          const found = items(response);
          setSignupOffices(found);
          setRegistration((previous) => ({
            ...previous,
            tenantId: found.some((o) => o.id === previous.tenantId)
              ? previous.tenantId
              : "",
          }));
        })
        .catch((error) => {
          if (active) {
            setSignupOfficeError(error.message);
            setSignupOffices([]);
          }
        })
        .finally(() => {
          if (active) setSignupOfficeLoading(false);
        });
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [
    page,
    signupGeography.unionCode,
    signupOfficeRetry,
  ]);
  // BUNDLE06-R5 C5: the office detail renders each service exactly once —
  // dedupe the API list by service number for both the chips and the fee
  // table (the API query is also tenant-scoped now; this is the web-side
  // belt-and-braces so a duplicated row can never render twice).
  const officeServices = (() => {
    const seen = new Set<number>();
    return items((office as any)?.services).filter((s: any) => {
      const no = s.serviceNo || s.service_no;
      if (!no || seen.has(no)) return false;
      seen.add(no);
      return true;
    });
  })();
  const normalizedSearch = search
    .trim()
    .replace(/[০-৯]/g, (digit) => String("০১২৩৪৫৬৭৮৯".indexOf(digit)))
    .toLowerCase()
    .normalize("NFC");
  const services = serviceCatalog.filter(
    (s) =>
      `${s.service_no} ${s.name_bn} ${s.name_en}`
        .toLowerCase()
        .normalize("NFC")
        .includes(normalizedSearch) &&
      (!category || s.category_en === category),
  );
  const categories = [...new Set(serviceCatalog.map((s) => s.category_en))];
  const selected = serviceCatalog.find((s) => s.service_no === serviceNo);
  const selectedSeo = selected ? serviceSeo(selected.service_no) : null;
  // FULL-UIUX-01: opening an office loads its detail AND brings it into
  // view — the detail used to render silently below the pagination.
  useEffect(() => {
    if (office) {
      officeDetailRef.current?.scrollIntoView({ block: "start" });
      officeDetailRef.current?.focus({ preventScroll: true });
    }
  }, [office]);
  useEffect(() => {
    if (page !== "services" || serviceNo === null) {
      setServiceInfo(null);
      return;
    }
    let active = true;
    setServiceInfo({ no: serviceNo, state: "loading", offices: [] });
    api(`/services/${serviceNo}/office-info`)
      .then((result) => {
        if (active)
          setServiceInfo({
            no: serviceNo,
            state: "ready",
            offices: Array.isArray(result.offices) ? result.offices : [],
          });
      })
      .catch(() => {
        if (active) setServiceInfo({ no: serviceNo, state: "error", offices: [] });
      });
    return () => {
      active = false;
    };
  }, [page, serviceNo]);
  // CI #236 FAIL-2: returning to the catalog restores focus to the search.
  // The catalog view commits with serviceNo === null; focus the search then.
  // The ref guard keeps the initial page load (previous serviceNo null) from
  // stealing focus — only a return from an open service detail focuses.
  const previousServiceNoRef = useRef<number | null>(null);
  useEffect(() => {
    if (
      page === "services" &&
      serviceNo === null &&
      previousServiceNoRef.current !== null
    ) {
      document.getElementById("public-service-search")?.focus();
    }
    previousServiceNoRef.current = serviceNo;
  }, [page, serviceNo]);
  function clearServiceSearch() {
    setSearch("");
    setCategory("");
    setServiceNo(null);
    document.getElementById("public-service-search")?.focus();
  }
  // Phase 6: what each participating office publishes for the selected service — its own fee policy
  // (BDT service fee, separate from software credits), citizen-charter time and required documents.
  // Offices that have not published show that plainly; nothing is inferred or filled in.
  const serviceOfficeInfo = () => {
    if (!selected) return null;
    const info = serviceInfo?.no === selected.service_no ? serviceInfo : null;
    return (
      <div className="service-office-info">
        <h2>
          {choose({
            bn: "কোন অফিসে পাবেন — ফি, সময় ও প্রয়োজনীয় কাগজপত্র",
            en: "Which offices offer this — fee, time and required documents",
          })}
        </h2>
        {tx(
          !info || info.state === "loading" ? (
            <p role="status">
              {choose({ bn: "তথ্য লোড হচ্ছে…", en: "Loading office information…" })}
            </p>
          ) : info.state === "error" ? (
            <p role="alert" className="notice error">
              {choose({
                bn: "অফিসের তথ্য লোড করা যায়নি। সংযোগ যাচাই করে আবার চেষ্টা করুন।",
                en: "Office information could not be loaded. Check your connection and try again.",
              })}
            </p>
          ) : !info.offices.length ? (
            <p>
              {choose({
                bn: "কোনো অংশগ্রহণকারী অফিস এখনও এই সেবাটি চালু করেনি।",
                en: "No participating office offers this service yet.",
              })}
            </p>
          ) : (
            info.offices.map((o) =>
              o.policyVersion == null ? (
                /* REFINEMENT-02 P1-6: an office that has not published its
                   fee/time/documents collapses to a one-line muted row —
                   not a full empty card. */
                <p className="service-office-unpublished" key={o.slug}>
                  <strong>{choose({ bn: o.nameBn, en: o.nameEn })}</strong>
                  {tx(
                    ` — ${[o.upazila, o.district, o.division].filter(Boolean).join(" · ")} · `,
                  )}
                  {choose({
                    bn: "এখনও ফি, সময় ও কাগজপত্র প্রকাশ করেনি",
                    en: "Has not yet published its fee, time and documents",
                  })}
                </p>
              ) : (
              <article className="service-office-entry" key={o.slug}>
                <h3>
                  <a
                    href={officePath(o.slug)}
                    onClick={(e) => {
                      e.preventDefault();
                      openOffice(o.slug);
                    }}
                  >
                    {choose({ bn: o.nameBn, en: o.nameEn })}
                  </a>
                </h3>
                <p>
                  {tx(
                    [o.upazila, o.district, o.division].filter(Boolean).join(" · "),
                  )}
                </p>
                {tx(
                  (
                    <>
                      <p>
                        <strong>{choose({ bn: "অফিসের সেবা ফি: ", en: "Office service fee: " })}</strong>
                        {taka(o.statutoryFeeMinor + o.processingFeeMinor)}
                        {tx(" · ")}
                        {(o.deliveryModes as string[])
                          .map((mode) =>
                            mode === "office_collection"
                              ? `${choose({ bn: "অফিস থেকে সংগ্রহ", en: "Office collection" })} ${taka(o.officeCollectionFeeMinor)}`
                              : `${choose({ bn: "ডিজিটাল কপি", en: "Digital copy" })} ${taka(o.digitalCopyFeeMinor)}`,
                          )
                          .join(" · ")}
                        {(o.urgencies as string[]).includes("urgent") &&
                          tx(
                            ` · ${choose({ bn: "জরুরি (অতিরিক্ত)", en: "Urgent (extra)" })} ${taka(o.emergencySurchargeMinor)}`,
                          )}
                      </p>
                      <p>
                        <strong>{choose({ bn: "সেবা প্রদানের সময়: ", en: "Service time: " })}</strong>
                        {o.charterDays
                          ? choose({
                              bn: `${localDigits(String(o.charterDays), language)} দিন`,
                              en: `${o.charterDays} days`,
                            })
                          : choose({
                              bn: "অফিস সময় উল্লেখ করেনি",
                              en: "The office has not stated a service time",
                            })}
                      </p>
                      {(o.requiredDocuments?.length ?? 0) > 0 ? (
                        <>
                          <p>
                            <strong>
                              {choose({ bn: "প্রয়োজনীয় কাগজপত্র:", en: "Required documents:" })}
                            </strong>
                          </p>
                          <ul>
                            {tx(
                              (o.requiredDocuments as Array<{ bn: string; en: string }>).map(
                                (doc, i) => <li key={i}>{choose(doc)}</li>,
                              ),
                            )}
                          </ul>
                        </>
                      ) : (
                        <p>
                          {choose({
                            bn: "অফিস আলাদা করে কোনো কাগজপত্রের তালিকা প্রকাশ করেনি।",
                            en: "The office has not published a separate document list.",
                          })}
                        </p>
                      )}
                    </>
                  ),
                )}
              </article>
            ))
          ),
        )}
      </div>
    );
  };
  function openService(no: number) {
    // SEO P10: services are also linked from office pages — opening one
    // always lands on the services view at the service's slug URL.
    onNavigate?.();
    setPage("services");
    setSlugMiss(false);
    setServiceNo(no);
    setOffice(null);
    setOfficeSlug(null);
    setError("");
    history.pushState({}, "", servicePath(no));
    window.scrollTo(0, 0);
  }
  function closeService() {
    setSlugMiss(false);
    setServiceNo(null);
    history.pushState({}, "", "/services");
    window.scrollTo(0, 0);
    // Focus is restored by the catalog-commit effect below, which runs
    // once the services view has committed (no frame-deferred timer).
  }
  // SEO P10: open an office at its own URL, /offices/<slug>; the effect
  // below loads its detail from the public API.
  function openOffice(slug: string) {
    onNavigate?.();
    setPage("offices");
    setError("");
    history.pushState({}, "", officePath(slug));
    setOfficeSlug(slug);
    window.scrollTo(0, 0);
  }
  function closeOffice() {
    setOffice(null);
    setOfficeSlug(null);
    history.pushState({}, "", "/offices");
  }
  async function loadOfficeDetail(slug: string) {
    try {
      setOffice(await api(`/offices/${encodeURIComponent(slug)}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (page === "offices" && officeSlug && office?.office?.slug !== officeSlug)
      void loadOfficeDetail(officeSlug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, officeSlug]);
  // QAFIX-09 (B2): the not-found state for an unresolved
  // /services/<segment> URL — a real missing page with a way back
  // to the catalogue, never the catalogue itself (soft-404).
  const serviceNotFoundView = () => (
    <>
      <div className="public-section-heading">
        <div>
          <span className="eyebrow">
            {choose({ bn: "নাগরিক সেবা", en: "Citizen services" })}
          </span>
          <h1>{choose({ bn: "সেবাটি পাওয়া যায়নি", en: "Service not found" })}</h1>
          <p>
            {choose({
              bn: "এই ঠিকানায় কোনো সেবা নেই। ঠিকানা বদলে গিয়ে থাকতে পারে — সব সেবার তালিকা থেকে খুঁজে নিন।",
              en: "There is no service at this address. The address may have changed — find the service in the full list.",
            })}
          </p>
        </div>
      </div>
      <button type="button" onClick={closeService}>
        {choose({ bn: "সব সেবা দেখুন", en: "Browse all services" })}
      </button>
    </>
  );
  const servicesView = () => (
    <>
      <div className="public-section-heading">
        <div>
          <span className="eyebrow">
            {choose({ bn: "নাগরিক সেবা", en: "Citizen services" })}
          </span>
          <h1>{choose({ bn: "নাগরিক সেবা", en: "Services" })}</h1>
          <p>
            {choose({
              bn: "সনদ, প্রত্যয়ন ও লাইসেন্সের জন্য এক জায়গায় আবেদন।",
              en: "Apply for certificates, attestations and licences in one place.",
            })}
          </p>
        </div>
      </div>
      <label htmlFor="public-service-search">
        {choose({ bn: "সেবা খুঁজুন", en: "Search public services" })}
      </label>
      <input
        id="public-service-search"
        placeholder={choose({
          bn: "সেবার নাম বা নম্বর লিখুন",
          en: "Type a service name or number",
        })}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="public-search-summary">
        <p role="status" aria-live="polite">
          {choose({
            bn: `${localDigits(String(services.length), language)}টি সেবা পাওয়া গেছে`,
            en: `${services.length} services found`,
          })}
        </p>
        {(search || category) && (
          <button
            type="button"
            className="text-button"
            onClick={clearServiceSearch}
          >
            {choose({
              bn: "খোঁজা মুছে সব সেবা দেখুন",
              en: "Clear search",
            })}
          </button>
        )}
      </div>
      <div
        className="service-category-filters"
        role="group"
        aria-label={choose({ bn: "বিভাগ অনুযায়ী সেবা", en: "Services by category" })}
      >
        <button
          type="button"
          className={category ? "secondary" : ""}
          aria-pressed={!category}
          onClick={() => setCategory("")}
        >
          {choose({ bn: "সব বিভাগ", en: "All categories" })}
        </button>
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            className={category === c ? "" : "secondary"}
            aria-pressed={category === c}
            onClick={() => setCategory(c)}
          >
            {choose(categoryLabel(c))}
          </button>
        ))}
      </div>
      <div className="public-service-grid">
        {services.map((s) => (
          <ServiceCard
            key={s.service_no}
            serviceNo={s.service_no}
            name={choose({ bn: s.name_bn, en: s.name_en })}
            category={s.category_en}
            href={servicePath(s.service_no)}
            feeHint={choose(
              serviceCardMetaRich(
                s.document_count,
                officeSummaries?.get(s.service_no),
              ),
            )}
            onNavigate={(e) => {
              e.preventDefault();
              openService(s.service_no);
            }}
          />
        ))}
      </div>
      {tx(
        !services.length && (
          <EmptyState
            title={choose({
              bn: "এই নামে কোনো সেবা পাওয়া যায়নি।",
              en: "No services match.",
            })}
            hint={choose({
              bn: "নামের ছোট অংশ বা সেবার নম্বর দিয়ে আবার খুঁজুন।",
              en: "Try a shorter name or a service number.",
            })}
            action={
              <button
                type="button"
                className="secondary"
                onClick={clearServiceSearch}
              >
                {choose({ bn: "সব সেবা দেখুন", en: "Show all services" })}
              </button>
            }
          />
        ),
      )}
    </>
  );
  /* FULL-UIUX-01: the service page (SEO §D4 structure) — H1 → intro →
     এক নজরে facts → কাগজপত্র/ফি/সময় per office → কী তথ্য লাগবে → steps →
     FAQ → সম্পর্কিত সেবা → sticky apply CTA. Exactly one H1. */
  const serviceDetailView = () => {
    if (!selected) return null;
    // BUNDLE06-R5 C1: citizen-friendly "what you will need" — one plain
    // checklist of the information the form asks for. Schema internals
    // stay out: section titles are form machinery, upload fields are
    // covered by the documents note below, and the declaration checkbox
    // is a confirmation the citizen ticks in the form, not information
    // they bring.
    let infoNeeded: { bn: string; en: string }[] = [];
    try {
      const schema: any = getServiceSchema(selected.service_no);
      const seenLabels = new Set<string>();
      for (const section of schema?.sections ?? []) {
        for (const field of section.fields ?? []) {
          if (
            field.type === "attachment" ||
            field.type === "repeatable" ||
            field.type === "checkbox" ||
            !field.label
          )
            continue;
          const key = field.label.en ?? field.label.bn ?? "";
          if (!key || seenLabels.has(key)) continue;
          seenLabels.add(key);
          infoNeeded.push(field.label);
        }
      }
    } catch {
      infoNeeded = [];
    }
    const attachmentsAsked = (() => {
      try {
        const schema: any = getServiceSchema(selected.service_no);
        return (schema?.sections ?? []).some((section: any) =>
          (section.fields ?? []).some(
            (f: any) => f.type === "attachment" || f.type === "repeatable",
          ),
        );
      } catch {
        return false;
      }
    })();
    // WS-C (§4 item 3): the schema names the required document for 12
    // services in the supporting-documents guidance (minRows 1 set); the
    // detail page never showed it — only the generic "attach a scan"
    // note below. Surface the form's own named evidence here. The
    // per-office published list in serviceOfficeInfo stays the office
    // authority; this is the form's guidance, shown only where it names
    // specific evidence (the other 35 services carry no description).
    const docsGuidance = (() => {
      try {
        const schema: any = getServiceSchema(selected.service_no);
        for (const section of schema?.sections ?? []) {
          for (const field of section.fields ?? []) {
            if (
              field.id === "supporting_documents" &&
              typeof field.description?.bn === "string" &&
              field.description.bn.trim().length > 0
            ) {
              return field.description as { bn: string; en: string };
            }
          }
        }
        return null;
      } catch {
        return null;
      }
    })();
    // SEO P3/D4: the visible FAQ comes from the SEO registry, so the page
    // and the FAQPage JSON-LD in the prerendered copy are the same data.
    const faqItems = selectedSeo ? faqFor(selectedSeo) : null;
    // SEO D6: related services are the registry's editorial clusters;
    // the category siblings remain the fallback.
    const clusterSiblings = selectedSeo
      ? relatedServices(selected.service_no)
          .map((rel) => serviceCatalog.find((s) => s.service_no === rel.no))
          .filter((s): s is NonNullable<typeof s> => !!s)
      : [];
    const siblings = (
      clusterSiblings.length
        ? clusterSiblings
        : serviceCatalog.filter(
            (s) =>
              s.category_en === selected.category_en &&
              s.service_no !== selected.service_no,
          )
    ).slice(0, 4);
    return (
      <article className="service-detail">
        {/* SEO P3/D4: breadcrumb trail — Home / Services / this service. */}
        <nav className="service-breadcrumb" aria-label="breadcrumb">
          <ol>
            <li>
              <a
                href="/"
                onClick={(e) => {
                  e.preventDefault();
                  nav("home");
                }}
              >
                {choose({ bn: "হোম", en: "Home" })}
              </a>
            </li>
            <li>
              <a
                href="/services"
                onClick={(e) => {
                  e.preventDefault();
                  closeService();
                }}
              >
                {choose({ bn: "নাগরিক সেবা", en: "Services" })}
              </a>
            </li>
            <li aria-current="page">
              {choose({ bn: selected.name_bn, en: selected.name_en })}
            </li>
          </ol>
        </nav>
        <button
          type="button"
          className="text-button public-service-back"
          onClick={closeService}
        >
          {choose({ bn: "← সব সেবা", en: "← All services" })}
        </button>
        <span className="eyebrow">
          {choose(categoryLabel(selected.category_en))}
          {choose({ bn: " · সেবা নম্বর ", en: " · Service " })}
          {localDigits(String(selected.service_no), language)}
        </span>
        <h1>{choose({ bn: selected.name_bn, en: selected.name_en })}</h1>
        <p className="service-detail-intro">
          {selectedSeo
            ? choose({ bn: selectedSeo.introBn, en: selectedSeo.introEn })
            : choose({
                bn: `${selected.name_bn} ইউনিয়ন পরিষদের একটি নাগরিক সেবা। অনলাইনে আবেদন করুন — চেয়ারম্যানের যাচাই ও অনুমোদনের পর QR-যাচাইযোগ্য সনদ পাবেন, বাংলা ও ইংরেজি দুই ভাষাতেই।`,
                en: `${selected.name_en} is a Union Parishad citizen service. Apply online — after the chairman's review and approval you receive a QR-verifiable certificate in both Bangla and English.`,
              })}
        </p>
        {selectedSeo?.noteBn && (
          <p className="service-note">
            {choose({
              bn: selectedSeo.noteBn,
              en: selectedSeo.noteEn ?? selectedSeo.noteBn,
            })}
          </p>
        )}
        <section className="service-facts" aria-label={choose({ bn: "এক নজরে", en: "At a glance" })}>
          <h2>{choose({ bn: "এক নজরে", en: "At a glance" })}</h2>
          <dl>
            <div>
              <dt>{choose({ bn: "সেবা নম্বর", en: "Service number" })}</dt>
              <dd>{localDigits(String(selected.service_no), language)}</dd>
            </div>
            <div>
              <dt>{choose({ bn: "বিভাগ", en: "Category" })}</dt>
              <dd>{choose(categoryLabel(selected.category_en))}</dd>
            </div>
            <div>
              <dt>{choose({ bn: "আবেদনের মাধ্যম", en: "How to apply" })}</dt>
              <dd>{choose({ bn: "অনলাইন", en: "Online" })}</dd>
            </div>
            <div>
              <dt>{choose({ bn: "সনদের ভাষা", en: "Certificate languages" })}</dt>
              <dd>{choose({ bn: "বাংলা ও ইংরেজি", en: "Bangla and English" })}</dd>
            </div>
            <div>
              <dt>{choose({ bn: "যাচাই", en: "Verification" })}</dt>
              <dd>{choose({ bn: "QR কোড ও সনদ নম্বর", en: "QR code and certificate number" })}</dd>
            </div>
          </dl>
        </section>
        {tx(serviceOfficeInfo())}
        {infoNeeded.length > 0 && (
          <section className="service-info-needed">
            <h2>{choose({ bn: "কী তথ্য দিতে হবে", en: "What information you will need" })}</h2>
            <p>
              {choose({
                bn: "আবেদনের ফরমে নিচের তথ্যগুলো লিখতে হবে। ফরম শুরু করার আগে এগুলো হাতের কাছে রাখুন — ভুল তথ্য দিলে অফিস সংশোধনের জন্য ফেরত পাঠাতে পারে।",
                en: "You will type the details below into the application form. Keep them at hand before you start — if something is wrong, the office can send the application back for correction.",
              })}
            </p>
            <ul>
              {infoNeeded.map((label, j) => (
                <li key={j}>{choose(label)}</li>
              ))}
            </ul>
            {attachmentsAsked && (
              <p>
                {choose({
                  bn: "ফরমে চাওয়া হলে প্রয়োজনীয় নথির স্ক্যান বা ছবি যুক্ত করতে হবে।",
                  en: "Where the form asks, you will attach a scan or photo of the required document.",
                })}
              </p>
            )}
            {docsGuidance && (
              <p>
                <strong>
                  {choose({ bn: "প্রয়োজনীয় কাগজপত্র: ", en: "Required documents: " })}
                </strong>
                {choose(docsGuidance)}
              </p>
            )}
          </section>
        )}
        <section className="service-steps">
          <h2>{choose({ bn: "কীভাবে আবেদন করবেন", en: "How to apply" })}</h2>
          <ol>
            <li>{choose({ bn: "আপনার অংশগ্রহণকারী অফিস বেছে অ্যাকাউন্ট খুলুন।", en: "Choose your participating office and create your account." })}</li>
            <li>{choose({ bn: "সেবার ফরম পূরণ করুন এবং চাওয়া নথি যুক্ত করুন।", en: "Complete the service form and attach the requested documents." })}</li>
            <li>{choose({ bn: "অফিসের যাচাইয়ের জন্য জমা দিন; সংশোধনের অনুরোধ এলে তা অনুসরণ করুন।", en: "Submit for office review; follow any correction request." })}</li>
            <li>{choose({ bn: "অনুমোদিত হলে সনদ ইস্যু হবে। অ্যাকাউন্টে অবস্থা দেখুন এবং QR লিংক দিয়ে যাচাই করুন।", en: "Once approved, the certificate is issued. View status in your account and verify its QR link." })}</li>
          </ol>
        </section>
        <section className="service-faq">
          <h2>{choose({ bn: "সাধারণ জিজ্ঞাসা", en: "Frequently asked questions" })}</h2>
          {(faqItems ?? [
            {
              q: { bn: "এই সেবার ফি কত?", en: "What is the fee for this service?" },
              a: {
                bn: "ফি প্রতিটি অফিস নিজে নির্ধারণ ও প্রকাশ করে — উপরের অফিসভিত্তিক তালিকায় দেখুন। আবেদন জমা দেওয়ার আগেই ফি দেখানো হয়।",
                en: "Each office sets and publishes its own fee — see the per-office list above. The fee is shown during the application before you submit.",
              },
            },
            {
              q: { bn: "কতদিনে সনদ পাবো?", en: "How long will it take?" },
              a: {
                bn: "চেয়ারম্যানের যাচাই ও অনুমোদনের ওপর নির্ভর করে। অফিস সেবা প্রদানের সময় প্রকাশ করে থাকলে তা উপরের তালিকায় দেখা যাবে।",
                en: "It depends on the chairman's review and approval. Where an office publishes a service time, it appears in the list above.",
              },
            },
            {
              q: { bn: "তথ্যে ভুল হলে কী হবে?", en: "What if something is wrong?" },
              a: {
                bn: "চেয়ারম্যান সংশোধনের অনুরোধ পাঠাতে পারেন — একই আবেদনটি ঠিক করে আবার জমা দেওয়া যায়।",
                en: "The chairman can request a correction — you fix and resubmit the same application.",
              },
            },
          ]).map((item) => (
            <details key={item.q.en} className="home-faq-item">
              <summary>{choose(item.q)}</summary>
              <p>{choose(item.a)}</p>
            </details>
          ))}
        </section>
        {siblings.length > 0 && (
          <section className="service-siblings">
            <h2>{choose({ bn: "সম্পর্কিত সেবা", en: "Related services" })}</h2>
            <div className="public-service-grid">
              {siblings.map((s) => (
                <ServiceCard
                  key={s.service_no}
                  serviceNo={s.service_no}
                  name={choose({ bn: s.name_bn, en: s.name_en })}
                  category={s.category_en}
                  href={servicePath(s.service_no)}
                  feeHint={choose(
                    serviceCardMetaRich(
                      s.document_count,
                      officeSummaries?.get(s.service_no),
                    ),
                  )}
                  onNavigate={(e) => {
                    e.preventDefault();
                    openService(s.service_no);
                  }}
                />
              ))}
            </div>
          </section>
        )}
        {/* REFINEMENT-02 P1-6 kept the bar in-flow so it reserves its own
            space at the end of the article. BUNDLE06-R5 C1: the bar is now
            a direct child of the article (no sentinel wrapper), so its
            sticky range is the whole article — it rides the viewport
            bottom while the citizen reads, and settles into its reserved
            place at the end instead of painting over the fee table. */}
        <div className="service-apply-bar">
          <span>
            {choose({
              bn: "এই সেবার জন্য আবেদন করতে লগইন করুন — নতুন হলে নিবন্ধন ফ্রি।",
              en: "Sign in to apply for this service — registration is free.",
            })}
          </span>
          <span className="service-apply-actions">
            <button onClick={() => nav("login")}>
              {choose({ bn: "লগইন করে আবেদন করুন", en: "Sign in to apply" })}
            </button>
            <button className="secondary" onClick={() => nav("register")}>
              {choose({ bn: "নিবন্ধন", en: "Register" })}
            </button>
          </span>
        </div>
      </article>
    );
  };
  return (
    <div className="public-site">
      <a className="skip" href="#public-content">
        {t("Skip to main content ")}
      </a>
      {/* FULL-UIUX-01 (A1/P0-2): no nav override — the portal renders the
          ONE public shell (PUBLIC_NAV + default footer), identical to the
          home and verify surfaces. PORTAL-A: the default account doors too
          (register · office account · login), so every page offers the same
          three; register/login navigate in-app, the office account loads
          its own page. */}
      <SiteHeader
        current={page === "home" ? "/" : `/${page}`}
        onNavigate={(href) => nav(href === "/" ? "home" : href.slice(1))}
      />
      <main id="public-content">
        <GlobalNoticeBanner />
        {tx(
          page !== "home" && (
            <div className="public-container public-section">
              {/* BUNDLE06-R5 C1: the service detail renders its own
                  breadcrumb trail (.service-breadcrumb) — the generic bar
                  is suppressed there so the page has ONE breadcrumb row. */}
              {tx(
                !(page === "services" && selected) && (
                  <div className="breadcrumbs">
                    <button className="text-button" onClick={() => nav("home")}>
                      {choose({ bn: "হোম", en: "Home" })}
                    </button>
                    {tx(" / ")}
                    {tx(
                      publicPages[page]
                        ? choose({
                            bn: publicPages[page][0],
                            en: publicPages[page][1],
                          })
                        : page,
                    )}
                  </div>
                ),
              )}
              {tx(
                error && (
                  <p role="alert" className="notice error">
                    {tx(error)}
                  </p>
                ),
              )}
              {tx(
                page === "services" &&
                  (selected
                    ? serviceDetailView()
                    : slugMiss
                      ? serviceNotFoundView()
                      : servicesView()),
              )}
              {tx(
                page === "login" && (
                  <div className="login-split">
                    <div className="login-brand-panel" aria-hidden="true">
                      <BrandLockup tone="light" size={46} tagline />
                      <p>
                        {choose({
                          bn: "আবেদন, অবস্থা ও সনদ যাচাই — আপনার ইউনিয়নের সব নাগরিক সেবা এক অ্যাকাউন্টে।",
                          en: "Applications, status and certificate verification — all your union's citizen services in one account.",
                        })}
                      </p>
                      <ul className="login-brand-facts">
                        <li>
                          {choose({
                            bn: "৪৭টি ইউনিয়ন সেবা অনলাইনে",
                            en: "47 union services online",
                          })}
                        </li>
                        <li>
                          {choose({
                            bn: "প্রতিটি সনদ QR দিয়ে যাচাইযোগ্য",
                            en: "Every certificate verifiable by QR",
                          })}
                        </li>
                        <li>
                          {choose({
                            bn: "বাংলা ও ইংরেজি — দুই ভাষায় সনদ",
                            en: "Certificates in Bangla and English",
                          })}
                        </li>
                      </ul>
                    </div>
                    <div className="standalone-login">
                      {/* BUNDLE06-R5 B4: the sign-in page carries a real H1
                          (the shared login form's heading stays an H2 —
                          the home page embeds the same form under its
                          own H1). */}
                      <h1>{choose({ bn: "লগইন", en: "Sign in" })}</h1>
                      {tx(login)}
                      <p>
                        {choose({ bn: "নতুন ব্যবহারকারী?", en: "New user?" })}
                        {tx(" ")}
                        <button
                          className="text-button"
                          onClick={() => nav("register")}
                        >
                          {choose({ bn: "অ্যাকাউন্ট খুলুন", en: "Create account" })}
                        </button>
                      </p>
                    </div>
                  </div>
                ),
              )}
              {tx(page === "recover" && <RecoveryForm />)}
              {tx(page === "verify-email" && <EmailVerificationForm />)}
              {tx(page === "tracking" && <ApplicationTracking />)}
              {tx(
                page === "offices" && (
                  <>
                    <span className="eyebrow">
                      {choose({ bn: "অংশগ্রহণকারী অফিস", en: "Participating offices" })}
                    </span>
                    {/* SEO P10: with an office open, the office name is the
                        page's H1 (in the detail panel below). */}
                    {!office && <h1>{choose({ bn: "ইউনিয়ন অফিস", en: "Union offices" })}</h1>}
                    <p>
                      {t(
                        "Find a participating office. Filters stay in the address and remain active when changing pages. ",
                      )}
                    </p>
                    <form
                      className="panel directory-filters"
                      onSubmit={(e) => {
                        e.preventDefault();
                        setOffice(null);
                        setOfficeSlug(null);
                        void loadOffices(1);
                      }}
                    >
                      <GeographyFields
                        prefix="directory-geo"
                        value={directoryGeography}
                        onChange={setDirectoryGeography}
                        through="union"
                        legend="অফিসের এলাকা / Office area"
                      />
                      <label htmlFor="directory-name">
                        {t("Office name ")}
                        <input
                          id="directory-name"
                          value={filters.q}
                          onChange={(e) =>
                            setFilters({ ...filters, q: e.target.value })
                          }
                        />
                      </label>
                      <label htmlFor="directory-type">
                        {t("Office type ")}
                        <select
                          id="directory-type"
                          value={filters.type}
                          onChange={(e) =>
                            setFilters({ ...filters, type: e.target.value })
                          }
                        >
                          <option value="">{t("All office types")}</option>
                          <option value="UNION">{t("Union Parishad")}</option>
                          <option value="MUNICIPALITY">
                            {t("Municipality")}
                          </option>
                          <option value="CITY_CORPORATION">
                            {t("City corporation")}
                          </option>
                        </select>
                      </label>
                      <label>
                        {t("Offices per page ")}
                        <select
                          aria-label={t("Offices per page")}
                          value={officePageSize}
                          onChange={(e) =>
                            setOfficePageSize(Number(e.target.value))
                          }
                        >
                          {tx(
                            [2, 6, 12, 24].map((n) => (
                              <option key={n} value={n}>
                                {tx(n)}
                              </option>
                            )),
                          )}
                        </select>
                      </label>
                      <button disabled={working}>{t("Search offices")}</button>
                    </form>
                    <p role="status">
                      {choose({
                        bn: `${localDigits(String(directory.total), language)}টি মিল পাওয়া অফিস · পৃষ্ঠা ${localDigits(String(directory.page), language)}`,
                        en: `${directory.total} matching offices · Page ${directory.page}`,
                      })}
                    </p>
                    <div className="office-grid">
                      {tx(
                        items(directory).map((o) => (
                          <article className="panel office-card" key={o.id}>
                            <CivicIcon index={1} />
                            <h2>
                              <a
                                href={officePath(o.slug)}
                                onClick={(e) => {
                                  e.preventDefault();
                                  openOffice(o.slug);
                                }}
                              >
                                {choose({
                                  bn: value(o, "nameBn", "name_bn"),
                                  en: value(o, "nameEn", "name_en"),
                                })}
                              </a>
                            </h2>

                            <p>
                              {tx(
                                [o.upazila, o.district, o.division]
                                  .filter(Boolean)
                                  .join(" · "),
                              )}
                            </p>
                            <button
                              className="secondary"
                              onClick={() => openOffice(o.slug)}
                            >
                              {t("View office ")}
                            </button>
                          </article>
                        )),
                      )}
                    </div>
                    <div className="pagination">
                      <button
                        className="secondary"
                        disabled={working || directory.page <= 1}
                        onClick={() => void loadOffices(directory.page - 1)}
                      >
                        {t("Previous offices ")}
                      </button>
                      <span>
                        {localDigits(String(directory.page), language)}
                        {" / "}
                        {localDigits(
                          String(
                            Math.max(
                              1,
                              Math.ceil(directory.total / directory.pageSize),
                            ),
                          ),
                          language,
                        )}
                      </span>
                      <button
                        className="secondary"
                        disabled={
                          working ||
                          directory.page * directory.pageSize >= directory.total
                        }
                        onClick={() => void loadOffices(directory.page + 1)}
                      >
                        {t("Next offices ")}
                      </button>
                    </div>
                    <OfficeInclusionForm />
                    {tx(
                      office && (
                        <section
                          className="panel"
                          aria-label={t("Office details")}
                          ref={officeDetailRef}
                          tabIndex={-1}
                        >
                          <button
                            type="button"
                            className="text-button public-service-back"
                            onClick={closeOffice}
                          >
                            {choose({
                              bn: "← সব অফিস দেখুন",
                              en: "← All offices",
                            })}
                          </button>
                          <h1>
                            {choose({
                              bn: value(office.office, "nameBn", "name_bn"),
                              en: value(office.office, "nameEn", "name_en"),
                            })}
                          </h1>

                          <h3>{t("Available services")}</h3>
                          <div className="service-chips">
                            {tx(
                              officeServices
                                .filter((s) => s.enabled !== false)
                                .map((s) => {
                                  const no = s.serviceNo || s.service_no;
                                  const label =
                                    choose({
                                      bn: value(s, "nameBn", "name_bn"),
                                      en: value(s, "nameEn", "name_en"),
                                    }) || `Service ${no}`;
                                  return no ? (
                                    <a
                                      key={no}
                                      href={servicePath(no)}
                                      onClick={(e) => {
                                        e.preventDefault();
                                        openService(no);
                                      }}
                                    >
                                      {label}
                                    </a>
                                  ) : (
                                    <span key={label}>{label}</span>
                                  );
                                }),
                            )}
                          </div>
                          <ServicePriceList services={officeServices} />
                          <DesignatedOfficers officers={office.officers ?? []} />
                          <h3>{t("Office notices")}</h3>
                          {tx(
                            (office.notices || []).map((n: any) => (
                              <article key={n.id}>
                                <h3>
                                  {choose({
                                    bn: value(n, "titleBn", "title_bn"),
                                    en: value(n, "titleEn", "title_en"),
                                  })}
                                </h3>
                                <p>
                                  {choose({
                                    bn: value(n, "bodyBn", "body_bn"),
                                    en: value(n, "bodyEn", "body_en"),
                                  })}
                                </p>
                              </article>
                            )),
                          )}
                          <button
                            onClick={() => {
                              defaultOfficeTried.current = true;
                              adoptSignupOffice(office.office);
                              setChangingOffice(false);
                              nav("register");
                            }}
                          >
                            {t("Register with this office ")}
                          </button>
                        </section>
                      ),
                    )}
                  </>
                ),
              )}
              {tx(
                page === "notices" && (
                  <>
                    <h1>{choose({ bn: "নোটিশ", en: "Notices" })}</h1>
                    <form
                      className="panel"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void loadNotices(1);
                      }}
                    >
                      <label htmlFor="notice-search">
                        {t("Search notices")}
                      </label>
                      <input
                        id="notice-search"
                        value={noticeSearch}
                        onChange={(e) => setNoticeSearch(e.target.value)}
                        placeholder={t("Notice title or body")}
                      />
                      <button disabled={working}>{t("Find notices")}</button>
                    </form>
                    <p role="status">
                      {tx(noticeTotal)}
                      {t(" published notices · Page ")}
                      {tx(noticePage)}
                    </p>
                    {tx(
                      notices.length ? (
                        notices.map((n) => (
                          <article className="panel" key={n.id}>
                            <h2>
                              {choose({
                                bn: value(n, "titleBn", "title_bn"),
                                en: value(n, "titleEn", "title_en"),
                              })}
                            </h2>

                            <p>
                              {choose({
                                bn: value(n, "bodyBn", "body_bn"),
                                en: value(n, "bodyEn", "body_en"),
                              })}
                            </p>

                            <small>
                              {choose({
                                bn: value(n, "officeBn", "office_bn"),
                                en: value(n, "officeEn", "office_en"),
                              })}
                            </small>
                          </article>
                        ))
                      ) : (
                        <p>{t("No published notices.")}</p>
                      ),
                    )}
                    <div className="pagination">
                      <button
                        className="secondary"
                        disabled={working || noticePage <= 1}
                        onClick={() => void loadNotices(noticePage - 1)}
                      >
                        {t("Previous notices ")}
                      </button>
                      <span>
                        {tx(noticePage)}
                        {t(" / ")}
                        {tx(Math.max(1, Math.ceil(noticeTotal / 6)))}
                      </span>
                      <button
                        className="secondary"
                        disabled={working || noticePage * 6 >= noticeTotal}
                        onClick={() => void loadNotices(noticePage + 1)}
                      >
                        {t("Next notices ")}
                      </button>
                    </div>
                  </>
                ),
              )}
              {tx(
                page === "register" && (
                  <section className="panel registration-panel du-short-registration">
                    <header className="registration-heading">
                      <span className="eyebrow">{choose({ bn: "নাগরিক অ্যাকাউন্ট", en: "CITIZEN ACCOUNT" })}</span>
                      <h1>{choose({ bn: "নাগরিক নিবন্ধন", en: "Create your account" })}</h1>
                      <p>
                        {choose({
                          bn: "নাম, মোবাইল নম্বর ও একটি পাসওয়ার্ড — এক মিনিটেই অ্যাকাউন্ট।",
                          en: "Your name, mobile number and a password — an account in under a minute.",
                        })}
                      </p>
                    </header>
                    {registeredAs ? (
                      <div role="status" className="registration-success">
                        <h2>{choose({ bn: "নিবন্ধন সম্পন্ন", en: "Account created" })}</h2>
                        <p>
                          {registeredAs.signInWith === "mobile"
                            ? choose({
                                bn: "এখন আপনার মোবাইল নম্বর ও পাসওয়ার্ড দিয়ে সাইন ইন করুন।",
                                en: "Sign in now with your mobile number and password.",
                              })
                            : choose({
                                bn: "এখন আপনার ইমেইল (অথবা মোবাইল নম্বর) ও পাসওয়ার্ড দিয়ে সাইন ইন করুন।",
                                en: "Sign in now with your email (or mobile number) and password.",
                              })}
                        </p>
                        <p className="hint">
                          {choose({
                            bn: "সেবার জন্য আবেদন করার সময় বাকি তথ্য (জন্ম তারিখ, ঠিকানা) চাওয়া হবে — এখন নয়।",
                            en: "The rest of your details (date of birth, address) are asked when you apply for a service — not now.",
                          })}
                        </p>
                        <button
                          onClick={() => {
                            rememberLoginPrefill(registeredAs.signInWith, registeredAs.identifier);
                            nav("login");
                          }}
                        >
                          {choose({ bn: "সাইন ইন করুন", en: "Go to sign in" })}
                        </button>
                      </div>
                    ) : (
                      <ShortSignupForm
                        tenantId={registration.tenantId}
                        officeLabel={signupOfficeLabel}
                        officeLoading={signupDefaultLoading}
                        changingOffice={changingOffice}
                        onChangeOffice={setChangingOffice}
                        choose={choose}
                        onRegistered={setRegisteredAs}
                        onSignIn={(identifier) => {
                          if (identifier)
                            rememberLoginPrefill(identifier.includes("@") ? "email" : "mobile", identifier);
                          nav("login");
                        }}
                        officeSelector={
                          <>
                            <p className="hint">
                              {choose({
                                bn: "ক্রমানুসারে এলাকা বেছে নিন, তারপর অফিস। শুধু তালিকাভুক্ত অফিসেই নিবন্ধন করা যায়।",
                                en: "Select each area in order, then the office. Registration is available only at a listed office.",
                              })}
                            </p>
                            <GeographyFields
                              prefix="signup-geo"
                              value={signupGeography}
                              onChange={(next) => {
                                setSignupGeography(next);
                                if (next.unionCode !== signupGeography.unionCode) {
                                  setSignupOffices([]);
                                  setSignupOfficeError("");
                                  setRegistration((previous) => ({ ...previous, tenantId: "" }));
                                }
                              }}
                              showCoverage
                            />
                            {signupGeography.unionCode ? (
                              <div className="registration-office">
                                {signupOfficeLoading && (
                                  <p role="status" className="hint">
                                    {choose({ bn: "অফিস খোঁজা হচ্ছে…", en: "Finding offices…" })}
                                  </p>
                                )}
                                {signupOfficeError && (
                                  <p role="alert" className="notice error">
                                    {signupOfficeError}{" "}
                                    <button
                                      type="button"
                                      className="text-button"
                                      onClick={() => setSignupOfficeRetry((v) => v + 1)}
                                    >
                                      {choose({ bn: "আবার খুঁজুন", en: "Retry office search" })}
                                    </button>
                                  </p>
                                )}
                                {!signupOfficeLoading && !signupOfficeError && !signupOffices.length && (
                                  <p className="notice" role="status">
                                    {choose({
                                      bn: "এই ইউনিয়ন এখনো DigitalUnion-এ যুক্ত হয়নি।",
                                      en: "This union has not joined DigitalUnion yet.",
                                    })}
                                  </p>
                                )}
                                <label htmlFor="signup-office">
                                  {choose({ bn: "নিবন্ধনের অফিস", en: "Select office" })}
                                </label>
                                <select
                                  id="signup-office"
                                  disabled={signupOfficeLoading || !signupOffices.length}
                                  value={registration.tenantId}
                                  onChange={(e) => {
                                    const chosen = signupOffices.find((o) => o.id === e.target.value);
                                    setRegistration({ ...registration, tenantId: e.target.value });
                                    if (chosen) {
                                      setSignupOfficeLabel(
                                        choose({
                                          bn: value(chosen, "nameBn", "name_bn"),
                                          en: value(chosen, "nameEn", "name_en"),
                                        }),
                                      );
                                      setChangingOffice(false);
                                    }
                                  }}
                                >
                                  <option value="">{choose({ bn: "অফিস বেছে নিন", en: "Choose office" })}</option>
                                  {signupOffices.map((o) => {
                                    const officeName = choose({
                                      bn: value(o, "nameBn", "name_bn"),
                                      en: value(o, "nameEn", "name_en"),
                                    });
                                    const area = [o.upazila, o.district].filter(Boolean).join(", ");
                                    return (
                                      <option key={o.id} value={o.id}>
                                        {area ? `${officeName} — ${area}` : officeName}
                                      </option>
                                    );
                                  })}
                                </select>
                              </div>
                            ) : null}
                          </>
                        }
                      />
                    )}
                  </section>
                ),
              )}
              {tx(
                page === "verify" && (
                  <div className="public-tool-grid">
                    <section className="panel">
                      <h1>{choose({ bn: "সনদ যাচাই করুন", en: "Verify a certificate" })}</h1>
                      <p>
                        {choose({
                          bn: "সনদের QR লিংক, যাচাই কোড অথবা সনদ নম্বরটি লিখুন।",
                          en: "Enter the certificate's QR link, verification code or its certificate number.",
                        })}
                      </p>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const input = token.trim();
                          const fail = () =>
                            setError(
                              choose({
                                bn: "সঠিক QR লিংক, যাচাই কোড বা সনদ নম্বর লিখুন।",
                                en: "Enter a valid verification link, code or certificate number.",
                              }),
                            );
                          // A shared link may carry the number as ?searchText=.
                          const fromSearch = input.match(/[?&]searchText=([^&#\s]+)/)?.[1];
                          if (fromSearch) {
                            location.assign(
                              `/verify?searchText=${encodeURIComponent(decodeURIComponent(fromSearch))}`,
                            );
                            return;
                          }
                          // The printed certificate number — 14 digits since
                          // CERTNO-DDMM, 16 on older certificates (Bangla
                          // digits and spaces/dashes as printed are accepted).
                          const digits = input
                            .replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d)))
                            .replace(/[\s-]/g, "");
                          if (/^(\d{14}|\d{16})$/.test(digits)) {
                            location.assign(`/verify?searchText=${digits}`);
                            return;
                          }
                          let parsed = input;
                          try {
                            if (input.includes("://"))
                              parsed =
                                new URL(input).pathname.split("/verify/")[1] || "";
                          } catch {
                            parsed = "";
                          }
                          if (!/^[A-Za-z0-9_-]{20,200}$/.test(parsed)) {
                            fail();
                            return;
                          }
                          location.assign(
                            `/verify/${encodeURIComponent(parsed)}`,
                          );
                        }}
                      >
                        <label htmlFor="verification-token">
                          {choose({
                            bn: "সনদ নম্বর, QR লিংক বা যাচাই কোড",
                            en: "Certificate number, QR link or verification code",
                          })}
                        </label>
                        <input
                          id="verification-token"
                          required
                          value={token}
                          onChange={(e) => setToken(e.target.value)}
                        />
                        <button>{choose({ bn: "যাচাই করুন", en: "Verify certificate" })}</button>
                      </form>
                      <p className="hint">
                        {choose({
                          bn: "সর্বজনীন ফলাফলে শুধু অফিস, সেবা, ইস্যুর তারিখ ও অবস্থা দেখা যায়।",
                          en: "Public results reveal only office, service, issue date and status.",
                        })}
                      </p>
                    </section>
                    <div className="public-tool-visual">
                      {/* BUNDLE06-R5 B4: same "what you need" remedy the
                          tracking page got in REFINEMENT-02 P1-12 — the
                          visual column carries guidance, not dead space. */}
                      <div className="tool-need">
                        <h2>{choose({ bn: "কী লাগবে", en: "What you need" })}</h2>
                        <ul>
                          <li>
                            {choose({
                              bn: "সনদে ছাপা নম্বরটি, অথবা সনদের QR কোডের লিংকটি।",
                              en: "The number printed on the certificate, or the link from its QR code.",
                            })}
                          </li>
                          <li>
                            {choose({
                              bn: "অ্যাকাউন্ট ছাড়াই যাচাই করা যায় — লগইন লাগে না।",
                              en: "No account is needed — verification works without signing in.",
                            })}
                          </li>
                        </ul>
                      </div>
                      <p>
                        {choose({
                          bn: "আবেদনের অবস্থা দেখতে চাইলে আবেদনের অবস্থা পৃষ্ঠা ব্যবহার করুন।",
                          en: "To follow an application instead, use the Track application page.",
                        })}{" "}
                        <a href="/tracking">
                          {choose({ bn: "আবেদনের অবস্থা →", en: "Track application →" })}
                        </a>
                      </p>
                    </div>
                  </div>
                ),
              )}
              {page === "guide" && (
                <Suspense fallback={<p role="status">{t("Loading…")}</p>}>
                  <UserGuide />
                </Suspense>
              )}
              {page === "witness" && (
                <Suspense fallback={<p role="status">{t("Loading…")}</p>}>
                  <WitnessGenerator />
                </Suspense>
              )}
              {tx(
                page === "help" && (
                  <>
                    <section className="panel prose">
                      <h1>{choose({ bn: "সাধারণ জিজ্ঞাসা", en: "Help & FAQ" })}</h1>
                      <label htmlFor="faq-search">{t("Search help")}</label>
                      <input
                        id="faq-search"
                        value={faqSearch}
                        onChange={(e) => setFaqSearch(e.target.value)}
                        placeholder={t("Application, password, payment…")}
                      />
                      {/* Phase 6b: Astra's own answers about how Astra works (apps/web/src/faq.json). */}
                      {faq
                        .map((item) => ({ id: item.id, q: choose(item.q), a: choose(item.a) }))
                        .filter(({ q, a }) => `${q} ${a}`.toLowerCase().includes(faqSearch.toLowerCase()))
                        .map(({ id, q, a }) => (
                          <details key={id} id={`faq-${id}`}>
                            <summary>{q}</summary>
                            <p>{a}</p>
                          </details>
                        ))}
                    </section>
                    <section className="panel prose">
                      <h2>{t("মতামত ও সহায়তা / Feedback")}</h2>
                      <p>
                        {t(
                          "Submit a message to the local platform support inbox. No email or external message is sent. ",
                        )}
                      </p>
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const form = e.currentTarget,
                            d = new FormData(form);
                          setWorking(true);
                          setSupportMessage("");
                          try {
                            await api("/public/feedback", "POST", {
                              name: d.get("name"),
                              ...(d.get("email")
                                ? { email: d.get("email") }
                                : {}),
                              subject: d.get("subject"),
                              message: d.get("message"),
                            });
                            form.reset();
                            setSupportMessage(
                              "Feedback saved to the support inbox.",
                            );
                          } catch (e) {
                            setSupportMessage((e as Error).message);
                          } finally {
                            setWorking(false);
                          }
                        }}
                      >
                        <div className="form-grid">
                          <label>
                            {t("Your name ")}
                            <input name="name" required minLength={2} />
                          </label>
                          <label>
                            {t("Email (optional) ")}
                            <input name="email" type="email" />
                          </label>
                        </div>
                        <label>
                          {t("Subject ")}
                          <input name="subject" required minLength={3} />
                        </label>
                        <label>
                          {t("Message ")}
                          <textarea name="message" required minLength={10} />
                        </label>
                        <button disabled={working}>
                          {t("Submit feedback")}
                        </button>
                      </form>
                      {tx(
                        supportMessage && (
                          <p className="notice" role="status">
                            {tx(supportMessage)}
                          </p>
                        ),
                      )}
                    </section>
                  </>
                ),
              )}
              {tx(
                page === "policies" && (
                  <section className="panel prose">
                    <h1>{choose({ bn: "ব্যবহারের নীতি", en: "Policies" })}</h1>
                    <h2>{choose({ bn: "সম্পর্কে", en: "About this service" })}</h2>
                    <p>
                      {choose({
                        bn: "DigitalUnion ইউনিয়ন পরিষদের নাগরিক সেবা প্রদানের সফটওয়্যার। এখানে ইস্যু করা সনদ সংশ্লিষ্ট ইউনিয়ন পরিষদের দাপ্তরিক নথি; প্রতিটি সনদের QR কোড বা নম্বর দিয়ে সত্যতা যাচাই করা যায়।",
                        en: "DigitalUnion is the software Union Parishads use to deliver citizen services. Certificates issued here are the issuing Union Parishad's official documents; every certificate can be checked by its QR code or number.",
                      })}
                    </p>
                    <h2>{t("Data and privacy")}</h2>
                    <p>
                      {choose({
                        bn: "আবেদনের তথ্য, ব্যক্তিগত ফাইল ও ওয়ার্কফ্লো ইতিহাস নিরাপদে সংরক্ষিত থাকে। অফিসের ভূমিকা অনুযায়ী প্রবেশাধিকার নিয়ন্ত্রিত হয়। পাবলিক QR যাচাইয়ে নাম, পরিচয় নম্বর বা আবেদনের বিষয়বস্তু দেখানো হয় না।",
                        en: "Application data, private files and workflow history are stored securely. Access is controlled by office roles. Public QR verification never shows names, identity numbers or application contents.",
                      })}
                    </p>
                    <h2>{t("Commercial and official use")}</h2>
                    <p>
                      {choose({
                        bn: "প্রতিটি সেবার ফি সংশ্লিষ্ট অফিসের প্রকাশিত ফি নীতি অনুযায়ী নির্ধারিত হয়। পরিশোধ যাচাইয়ের পরই রসিদ তৈরি হয়; শুধু পেমেন্ট পৃষ্ঠা থেকে ফিরে আসা পরিশোধের প্রমাণ নয়।",
                        en: "Each service's fee follows the office's published fee policy. A receipt is created only after the payment is verified; returning from a payment page alone is not proof of payment.",
                      })}
                    </p>
                    <h2>{t("Security and access")}</h2>
                    <p>
                      {t(
                        "Keep account credentials private, use a unique password and sign out on shared devices. You may change your password from Account settings; doing so expires your other sessions. ",
                      )}
                    </p>
                  </section>
                ),
              )}
              {tx(
                !Object.keys(publicPages).includes(page) && (
                  <section className="panel">
                    <h1>{choose({ bn: "পৃষ্ঠাটি পাওয়া যায়নি", en: "Page not found" })}</h1>
                    <p>
                      {choose({
                        bn: "ঠিকানাটি যাচাই করে আবার চেষ্টা করুন, অথবা হোম পৃষ্ঠা থেকে শুরু করুন।",
                        en: "Check the address and try again, or start from the home page.",
                      })}
                    </p>
                    <button onClick={() => nav("home")}>
                      {choose({ bn: "হোমে ফিরুন", en: "Return home" })}
                    </button>
                  </section>
                ),
              )}
            </div>
          ),
        )}
      </main>
      {/* FULL-UIUX-01 (A1/P0-2): the default footer — same services links,
          same subscribe form, same bottom line as every other surface. */}
      <SiteFooter
        onNavigate={(href) => nav(href === "/" ? "home" : href.slice(1))}
      />
    </div>
  );
}
