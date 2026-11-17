import { MobileOtpField, type VerifiedMobile } from "./MobileOtpField.js";
import { t, tx, choose } from "./i18n.js";
import { SiteFooter, SiteHeader } from "./PublicShell.js";
import { EmptyState } from "./ui/kit.js";
import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
// Phase 4c: the witness generator loads only on /witness, keeping the public start-up bundle small.
const UserGuide = lazy(() => import("./UserGuide.js").then((m) => ({ default: m.UserGuide })));
const WitnessGenerator = lazy(() => import("./WitnessGenerator.js").then((m) => ({ default: m.WitnessGenerator })));
import "./public-usability.css";
import "./public-portal.css";
// Public pages need names only; canonical metadata parity is checked by the web tests.
import serviceCatalog from "./public-service-catalog.json" with { type: "json" };
import { api, items } from "./api.js";
import { ServicePriceList } from "./ServicePriceList.js";
import { DesignatedOfficers, OfficeInclusionForm } from "./OfficeInclusion.js";
import {
  GeographyFields,
  geographyPayload,
  emptyGeography,
  readGeography,
} from "./GeographyFields.js";
import { LanguageSwitcher } from "./i18n.js";
import {
  PresentAddressFields,
  emptyPresentAddress,
  presentAddressPayload,
} from "./PresentAddressFields.js";

const publicPages: Record<string, [string, string]> = {
  home: ["হোম", "Home"],
  services: ["নাগরিক সেবা", "Services"],
  offices: ["সেবার আওতাভুক্ত অফিস", "Office directory"],
  notices: ["বিজ্ঞপ্তি", "Notices"],
  help: ["সহায়িকা", "Help"],
  witness: ["সাক্ষীর প্রত্যয়ন", "Witness statement"],
  guide: ["ব্যবহার নির্দেশিকা", "User guide"],
  tracking: ["আবেদনের অবস্থা", "Track application"],
  verify: ["সনদ যাচাই", "Verify certificate"],
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
              minLength={12}
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
              minLength={12}
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
  const [id, setId] = useState(""),
    [result, setResult] = useState<any>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="panel narrow">
      <h1>{t("আবেদনের বর্তমান অবস্থা")}</h1>
      <p>
        {t(
          "Enter the full reference of a submitted application from your signed-in application page. Drafts stay private. Results contain status and service information only. ",
        )}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMessage("");
          setResult(null);
          try {
            setResult(await api(`/track/${encodeURIComponent(id.trim())}`));
          } catch {
            setMessage(
              "Application not found. Check the full reference and try again.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor="tracking-id">{t("Application reference")}</label>
        <input
          id="tracking-id"
          required
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder={t("Full application UUID")}
        />
        <button disabled={busy}>{t("Track application")}</button>
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
            <span className="status">{tx(result.status)}</span>
            <p>{choose({ bn: result.officeBn, en: result.officeEn })}</p>
            <small>
              {t("Submitted record: ")}
              {tx(String(result.createdAt))}
            </small>
          </div>
        ),
      )}
    </section>
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
  const serviceInformationRef = useRef<HTMLElement>(null);
  const initial = location.pathname.split("/")[1] || "home";
  // Phase 1: new public pages deep-link to one service as /services?service=N.
  const linkedService = Number(new URLSearchParams(location.search).get("service"));
  const [page, setPage] = useState(initial),
    [search, setSearch] = useState(""),
    [serviceNo, setServiceNo] = useState<number | null>(
      initial === "services" && Number.isInteger(linkedService) && linkedService >= 1 && linkedService <= 47
        ? linkedService
        : null,
    );
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
  const [signupSearch, setSignupSearch] = useState("");
  const [signupGeography, setSignupGeography] = useState(emptyGeography);
  const [signupOfficeMode, setSignupOfficeMode] = useState<"local" | "preview">(
    "local",
  );
  const [signupOfficeLoading, setSignupOfficeLoading] = useState(false);
  const [signupOfficeError, setSignupOfficeError] = useState("");
  const [signupOfficeRetry, setSignupOfficeRetry] = useState(0);
  const [signupOffices, setSignupOffices] = useState<any[]>([]),
    [registered, setRegistered] = useState(false);
  // Phase X: what happened to the registration verification email ("sent" | "failed" | "unavailable").
  const [signupEmailVerification, setSignupEmailVerification] = useState<string | null>(null);
  const [registration, setRegistration] = useState({
    email: "",
    password: "",
    displayName: "",
    tenantId: "",
    nameBn: "",
    nameEn: "",
    dateOfBirth: "",
    addressBn: "",
    addressEn: "",
  });
  const [signupPresentAddress, setSignupPresentAddress] = useState(
    emptyPresentAddress(),
  );
  // Phase 2c: an optional mobile number, accepted only after its one-time code is confirmed.
  const [signupMobile, setSignupMobile] = useState<VerifiedMobile | null>(null);
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
      setPage(location.pathname.split("/")[1] || "home");
      setOffice(null);
    };
    addEventListener("popstate", pop);
    return () => removeEventListener("popstate", pop);
  }, [onNavigate]);
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
      history.replaceState({}, "", `/offices?${query}`);
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
        q: signupSearch,
        ...(signupOfficeMode === "local"
          ? geographyPayload({ ...signupGeography, wardCode: "" })
          : {}),
      });
      api(`/offices?${query}`)
        .then((response) => {
          if (!active) return;
          const found = items(response).filter(
            (o) => signupOfficeMode === "local" || !o.geography?.divisionCode,
          );
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
    signupOfficeMode,
    signupSearch,
    signupOfficeRetry,
  ]);
  const normalizedSearch = search
    .trim()
    .replace(/[০-৯]/g, (digit) => String("০১২৩৪৫৬৭৮৯".indexOf(digit)))
    .toLowerCase();
  const services = serviceCatalog.filter((s) =>
    `${s.service_no} ${s.name_bn} ${s.name_en}`
      .toLowerCase()
      .includes(normalizedSearch),
  );
  const selected = serviceCatalog.find((s) => s.service_no === serviceNo);
  useEffect(() => {
    if (page === "services" && serviceNo !== null) {
      serviceInformationRef.current?.focus({ preventScroll: true });
      serviceInformationRef.current?.scrollIntoView({ block: "start" });
    }
  }, [page, serviceNo]);
  function clearServiceSearch() {
    setSearch("");
    setServiceNo(null);
    document.getElementById("public-service-search")?.focus();
  }
  const servicesView = (compact = false) => (
    <>
      <div className="public-section-heading">
        <div>
          <span className="eyebrow">{t("CITIZEN SERVICES")}</span>
          <h2>{t("আপনার প্রয়োজনীয় সেবাটি বেছে নিন")}</h2>
          <p>{t("সনদ, প্রত্যয়ন ও লাইসেন্সের জন্য এক জায়গায় আবেদন।")}</p>
        </div>
        {tx(
          compact && (
            <button className="secondary" onClick={() => nav("services")}>
              {t("সব ৪৭টি সেবা দেখুন → ")}
            </button>
          ),
        )}
      </div>
      {tx(
        !compact && (
          <>
            <label htmlFor="public-service-search">
              {t("সেবা খুঁজুন / Search public services ")}
            </label>
            <input
              id="public-service-search"
              placeholder={t("সেবার নাম বা নম্বর লিখুন")}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setServiceNo(null);
              }}
            />
            <div className="public-search-summary">
              <p role="status" aria-live="polite">
                {choose({
                  bn: `${services.length.toLocaleString("bn-BD")}টি সেবা পাওয়া গেছে`,
                  en: `${services.length} services found`,
                })}
              </p>
              {search && (
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
          </>
        ),
      )}
      {(!selected || compact) && (
        <div className="public-service-grid">
          {tx(
            (compact
              ? services.filter((s) =>
                  [1, 2, 3, 8, 42, 45, 46, 47].includes(s.service_no),
                )
              : services
            ).map((s) => (
              <button
                className="public-service"
                key={s.service_no}
                onClick={() => {
                  setServiceNo(s.service_no);
                  if (compact) nav("services");
                }}
              >
                <CivicIcon index={s.service_no} />
                <strong>{choose({ bn: s.name_bn, en: s.name_en })}</strong>
                <span>
                  {t("আবেদনের তথ্য দেখুন ")}
                  <b>{t("→")}</b>
                </span>
              </button>
            )),
          )}
        </div>
      )}
      {tx(
        !services.length && (
          <EmptyState
            title={t("এই নামে কোনো সেবা পাওয়া যায়নি। No services match. ")}
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
      {tx(
        selected && !compact && (
          <section
            className="panel service-information"
            aria-label={t("Service information")}
            ref={serviceInformationRef}
            tabIndex={-1}
          >
            <button
              type="button"
              className="text-button public-service-back"
              onClick={() => {
                setServiceNo(null);
                document.getElementById("public-service-search")?.focus();
              }}
            >
              {choose({
                bn: "← অন্য সেবা বেছে নিন",
                en: "← Choose another service",
              })}
            </button>
            <span className="eyebrow">
              {t("SERVICE ")}
              {tx(selected.service_no)}
            </span>
            <h2>{choose({ bn: selected.name_bn, en: selected.name_en })}</h2>
            <ol>
              <li>
                {t("Choose your participating office and create your account.")}
              </li>
              <li>
                {t(
                  "Complete the service form and attach the requested documents. ",
                )}
              </li>
              <li>
                {t("Submit for office review; follow any correction request.")}
              </li>
              <li>
                {t(
                  "An authorized approver can issue the certificate. View status in your account and verify its QR link. ",
                )}
              </li>
            </ol>
            <button onClick={() => nav("login")}>
              {t("Sign in to apply")}
            </button>
            {tx(" ")}
            <button className="secondary" onClick={() => nav("register")}>
              {t("Create account ")}
            </button>
          </section>
        ),
      )}
    </>
  );
  return (
    <div className="public-site">
      <a className="skip" href="#public-content">
        {t("Skip to main content ")}
      </a>
      <SiteHeader
        current={page === "home" ? "/" : `/${page}`}
        onNavigate={(href) => nav(href === "/" ? "home" : href.slice(1))}
        navItems={[
          { href: "/", bn: "হোম", en: "Home" },
          { href: "/services", bn: "নাগরিক সেবা", en: "Services" },
          { href: "/offices", bn: "সেবার আওতাভুক্ত অফিস", en: "Office directory" },
          { href: "/notices", bn: "বিজ্ঞপ্তি", en: "Notices" },
          { href: "/help", bn: "সহায়িকা", en: "Help" },
          { href: "/witness", bn: "সাক্ষীর প্রত্যয়ন", en: "Witness statement" },
          { href: "/guide", bn: "ব্যবহার নির্দেশিকা", en: "User guide" },
          { href: "/tracking", bn: "আবেদনের অবস্থা", en: "Track application" },
          { href: "/verify", bn: "সনদ যাচাই", en: "Verify certificate" },
        ]}
        account={
          <>
            <button
              className="du-btn du-btn-ghost"
              onClick={() => nav("register")}
            >
              {t("নিবন্ধন ")}
            </button>
            <button
              className="du-btn du-btn-primary"
              onClick={() => nav("login")}
            >
              {t("লগইন")}
            </button>
          </>
        }
      />
      <main id="public-content">
        {tx(
          page !== "home" && (
            <div className="public-container public-section">
              <div className="breadcrumbs">
                <button className="text-button" onClick={() => nav("home")}>
                  {t("হোম ")}
                </button>
                {tx(" ")}
                {t("/")}
                {tx(" ")}
                {tx(
                  publicPages[page]?.[0] ||
                    (
                      {
                        login: "লগইন",
                        register: "নিবন্ধন",
                        policies: "ব্যবহারের নীতি",
                        recover: "অ্যাকাউন্ট পুনরুদ্ধার",
                      } as any
                    )[page],
                )}
              </div>
              {tx(
                error && (
                  <p role="alert" className="notice error">
                    {tx(error)}
                  </p>
                ),
              )}
              {tx(page === "services" && servicesView())}
              {tx(
                page === "login" && (
                  <div className="standalone-login">
                    {tx(login)}
                    <p>
                      {t("নতুন ব্যবহারকারী?")}
                      {tx(" ")}
                      <button
                        className="text-button"
                        onClick={() => nav("register")}
                      >
                        {t("Create account ")}
                      </button>
                    </p>
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
                      {t("PARTICIPATING OFFICES")}
                    </span>
                    <h1>{t("সেবার আওতাভুক্ত অফিসসমূহ")}</h1>
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
                      {tx(directory.total)}
                      {t(" matching offices · Page ")}
                      {tx(directory.page)}
                    </p>
                    <div className="office-grid">
                      {tx(
                        items(directory).map((o) => (
                          <article className="panel office-card" key={o.id}>
                            <CivicIcon index={1} />
                            <h2>
                              {choose({
                                bn: value(o, "nameBn", "name_bn"),
                                en: value(o, "nameEn", "name_en"),
                              })}
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
                              onClick={async () => {
                                try {
                                  setOffice(
                                    await api(
                                      `/offices/${encodeURIComponent(o.slug)}`,
                                    ),
                                  );
                                } catch (e) {
                                  setError((e as Error).message);
                                }
                              }}
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
                        {tx(directory.page)}
                        {t(" /")}
                        {tx(" ")}
                        {tx(
                          Math.max(
                            1,
                            Math.ceil(directory.total / directory.pageSize),
                          ),
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
                        >
                          <h2>
                            {choose({
                              bn: value(office.office, "nameBn", "name_bn"),
                              en: value(office.office, "nameEn", "name_en"),
                            })}
                          </h2>

                          <h3>{t("Available services")}</h3>
                          <div className="service-chips">
                            {tx(
                              items(office.services)
                                .filter((s) => s.enabled !== false)
                                .map((s) => (
                                  <span key={s.serviceNo || s.service_no}>
                                    {tx(
                                      choose({
                                        bn: value(s, "nameBn", "name_bn"),
                                        en: value(s, "nameEn", "name_en"),
                                      }) ||
                                        `Service ${s.serviceNo || s.service_no}`,
                                    )}
                                  </span>
                                )),
                            )}
                          </div>
                          <ServicePriceList services={items(office.services)} />
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
                              setRegistration({
                                ...registration,
                                tenantId: office.office.id,
                              });
                              setSignupOffices([office.office]);
                              setSignupGeography(
                                readGeography(office.office.geography),
                              );
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
                    <h1>{t("প্রকাশিত বিজ্ঞপ্তি")}</h1>
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
                  <section className="panel registration-panel">
                    <header className="registration-heading">
                      <span className="eyebrow">{t("CITIZEN ACCOUNT")}</span>
                      <h1>{t("নাগরিক নিবন্ধন / Create your account")}</h1>
                      <p>
                        {t(
                          "আপনার এলাকা ও সেবাদানকারী অফিস নির্বাচন করে শুরু করুন। Choose your area and participating office to get started. ",
                        )}
                      </p>
                    </header>
                    {tx(
                      registered ? (
                        <div role="status" className="registration-success">
                          <h2>{t("নিবন্ধন সম্পন্ন / Account created")}</h2>
                          <p>
                            {t(
                              "You can now sign in with your email and password.",
                            )}
                          </p>
                          {tx(
                            signupEmailVerification === "sent" ? (
                              <p>
                                {t(
                                  "আপনার ইমেইলে একটি যাচাইকরণ লিংক পাঠানো হয়েছে। লিংকটি খুলে ইমেইল যাচাই করুন — যাচাই ঐচ্ছিক, এখনই সাইন ইন করা যাবে। / A verification link has been sent to your email. Open it to verify your address — verification is optional and you can sign in right away.",
                                )}
                              </p>
                            ) : signupEmailVerification === "unavailable" ? (
                              <p>
                                {t(
                                  "এই সার্ভারে ইমেইল যাচাইকরণ চালু নেই, তাই কোনো যাচাইকরণ বার্তা পাঠানো হয়নি। / Email verification is not enabled on this server, so no verification message was sent.",
                                )}
                              </p>
                            ) : signupEmailVerification === "failed" ? (
                              <p>
                                {t(
                                  "যাচাইকরণ ইমেইলটি পাঠানো যায়নি। সাইন ইন করে আবার পাঠানোর চেষ্টা করা যাবে। / The verification email could not be sent. You can ask for a new one after signing in.",
                                )}
                              </p>
                            ) : null,
                          )}
                          <button onClick={() => nav("login")}>
                            {t("Go to sign in")}
                          </button>
                        </div>
                      ) : (
                        <form
                          onSubmit={async (e) => {
                            e.preventDefault();
                            if (
                              !signupGeography.wardCode ||
                              !registration.tenantId
                            ) {
                              setError(
                                "Choose your complete administrative area and registration office.",
                              );
                              return;
                            }
                            setWorking(true);
                            setError("");
                            try {
                              const result = await api("/auth/signup", "POST", {
                                ...registration,
                                geography: geographyPayload(signupGeography),
                                presentAddress:
                                  presentAddressPayload(signupPresentAddress),
                                ...(signupMobile ?? {}),
                              });
                              setSignupEmailVerification(
                                typeof result?.emailVerification === "string"
                                  ? result.emailVerification
                                  : null,
                              );
                              setRegistration((previous) => ({
                                ...previous,
                                password: "",
                              }));
                              setRegistered(true);
                            } catch (e) {
                              setError((e as Error).message);
                            } finally {
                              setWorking(false);
                            }
                          }}
                        >
                          <ol
                            className="du-reg-progress"
                            aria-label={choose({
                              bn: "নিবন্ধনের অগ্রগতি",
                              en: "Registration progress",
                            })}
                          >
                            {[
                              {
                                done: !!signupGeography.wardCode,
                                bn: "এলাকা",
                                en: "Area",
                              },
                              {
                                done: !!registration.tenantId,
                                bn: "অফিস",
                                en: "Office",
                              },
                              {
                                done: !!(
                                  registration.nameBn &&
                                  registration.nameEn &&
                                  registration.dateOfBirth &&
                                  registration.email &&
                                  registration.password
                                ),
                                bn: "অ্যাকাউন্টের তথ্য",
                                en: "Account details",
                              },
                              {
                                done: !!signupMobile,
                                optional: true,
                                bn: "মোবাইল যাচাই (ঐচ্ছিক)",
                                en: "Mobile check (optional)",
                              },
                            ].map((step) => (
                              <li
                                key={step.en}
                                className={step.done ? "done" : undefined}
                                aria-current={step.done ? undefined : "step"}
                              >
                                {step.done ? "✓ " : ""}
                                {choose({ bn: step.bn, en: step.en })}
                              </li>
                            ))}
                          </ol>
                          <div className="registration-step">
                            <span className="step-number">{t("1")}</span>
                            <div>
                              <h2>{t("আপনার এলাকা / Your area")}</h2>
                              <p>
                                {t(
                                  "Select each area in order. Changing an area clears the selections below it. ",
                                )}
                              </p>
                            </div>
                          </div>
                          <GeographyFields
                            prefix="signup-geo"
                            value={signupGeography}
                            onChange={(next) => {
                              setSignupGeography(next);
                              if (
                                next.unionCode !== signupGeography.unionCode
                              ) {
                                setSignupOfficeMode("local");
                                setSignupOffices([]);
                                setSignupOfficeError("");
                                setRegistration((previous) => ({
                                  ...previous,
                                  tenantId: "",
                                }));
                              }
                            }}
                            required
                            showCoverage
                          />
                          <div className="registration-step">
                            <span className="step-number">{t("2")}</span>
                            <div>
                              <h2>{t("সেবাদানকারী অফিস / Your office")}</h2>
                              <p>
                                {t(
                                  "Geographic locations and participating offices are separate. Registration is available only at an office listed here. ",
                                )}
                              </p>
                            </div>
                          </div>
                          <div className="registration-office">
                            {tx(
                              signupGeography.unionCode ? (
                                <>
                                  <label htmlFor="signup-office-search">
                                    {t("অফিস খুঁজুন / Search office name ")}
                                  </label>
                                  <input
                                    id="signup-office-search"
                                    value={signupSearch}
                                    onChange={(e) => {
                                      setSignupSearch(e.target.value);
                                      setRegistration((previous) => ({
                                        ...previous,
                                        tenantId: "",
                                      }));
                                    }}
                                    placeholder={t("Office name (optional)")}
                                  />
                                  {tx(
                                    signupOfficeLoading && (
                                      <p role="status" className="hint">
                                        {t(
                                          "অফিস খোঁজা হচ্ছে / Finding offices… ",
                                        )}
                                      </p>
                                    ),
                                  )}
                                  {tx(
                                    signupOfficeError && (
                                      <p role="alert" className="notice error">
                                        {tx(signupOfficeError)}
                                        {tx(" ")}
                                        <button
                                          type="button"
                                          className="text-button"
                                          onClick={() =>
                                            setSignupOfficeRetry((v) => v + 1)
                                          }
                                        >
                                          {t("Retry office search ")}
                                        </button>
                                      </p>
                                    ),
                                  )}
                                  {tx(
                                    !signupOfficeLoading &&
                                      !signupOfficeError &&
                                      !signupOffices.length && (
                                        <p className="notice" role="status">
                                          {tx(
                                            signupOfficeMode === "local"
                                              ? "No participating office was found for this area. You can try a preview office below; it does not represent your local authority."
                                              : "No preview office matches this search. Clear the office name or contact the administrator.",
                                          )}
                                        </p>
                                      ),
                                  )}
                                  {tx(
                                    signupOfficeMode === "local" &&
                                      !signupOfficeLoading &&
                                      !signupOfficeError &&
                                      !signupOffices.length && (
                                        <button
                                          type="button"
                                          className="secondary"
                                          onClick={() => {
                                            setSignupOfficeMode("preview");
                                            setSignupSearch("");
                                            setRegistration((previous) => ({
                                              ...previous,
                                              tenantId: "",
                                            }));
                                          }}
                                        >
                                          {t("Register with this office")}
                                        </button>
                                      ),
                                  )}
                                  {tx(
                                    signupOfficeMode === "preview" && (
                                      <div className="preview-office-note">
                                        <p>
                                          {t(
                                            "You can complete your registration with this office from any area.",
                                          )}
                                        </p>
                                        <button
                                          type="button"
                                          className="text-button"
                                          onClick={() => {
                                            setSignupOfficeMode("local");
                                            setSignupOffices([]);
                                            setSignupSearch("");
                                            setRegistration((previous) => ({
                                              ...previous,
                                              tenantId: "",
                                            }));
                                          }}
                                        >
                                          {t("Back to offices in my area ")}
                                        </button>
                                      </div>
                                    ),
                                  )}
                                  <label htmlFor="signup-office">
                                    {t("নিবন্ধনের অফিস / Select office ")}
                                  </label>
                                  <select
                                    id="signup-office"
                                    required
                                    disabled={
                                      signupOfficeLoading ||
                                      !signupOffices.length
                                    }
                                    value={registration.tenantId}
                                    onChange={(e) =>
                                      setRegistration({
                                        ...registration,
                                        tenantId: e.target.value,
                                      })
                                    }
                                  >
                                    <option value="">
                                      {t("Choose office")}
                                    </option>
                                    {tx(
                                      signupOffices.map((o) => (
                                        <option key={o.id} value={o.id}>
                                          {choose({
                                            bn: value(o, "nameBn", "name_bn"),
                                            en: value(o, "nameEn", "name_en"),
                                          })}
                                          {t(" —")}
                                          {tx(" ")}

                                          {tx(
                                            signupOfficeMode === "preview"
                                              ? " (Preview)"
                                              : "",
                                          )}
                                        </option>
                                      )),
                                    )}
                                  </select>
                                  {tx(
                                    signupOffices.length >= 100 && (
                                      <p className="hint">
                                        {t(
                                          "Showing the first 100 matches. Search by office name to narrow the list. ",
                                        )}
                                      </p>
                                    ),
                                  )}
                                </>
                              ) : (
                                <EmptyState
                                  title={t(
                                    "আগে আপনার ইউনিয়ন নির্বাচন করুন / Select your union above to find participating offices. ",
                                  )}
                                />
                              ),
                            )}
                          </div>
                          <div className="registration-step">
                            <span className="step-number">{t("3")}</span>
                            <div>
                              <h2>
                                {t("অ্যাকাউন্টের তথ্য / Account details")}
                              </h2>
                              <p>
                                {t(
                                  "Your account reference is generated automatically. Use at least 12 characters for your password. ",
                                )}
                              </p>
                            </div>
                          </div>
                          <div className="form-grid">
                            {tx(
                              Object.entries(registration)
                                .filter(([key]) => key !== "tenantId")
                                .map(([key, val]) => (
                                  <label key={key} htmlFor={`signup-${key}`}>
                                    {tx(
                                      (
                                        {
                                          email: "ইমেইল / Email address",
                                          password:
                                            "পাসওয়ার্ড / Choose password",
                                          displayName:
                                            "প্রদর্শিত নাম / Display name",
                                          nameBn: "নাম (বাংলা) / Name (Bangla)",
                                          nameEn:
                                            "নাম (ইংরেজি) / Name (English)",
                                          dateOfBirth:
                                            "জন্ম তারিখ / Date of birth",
                                          addressBn:
                                            "গ্রাম, বাড়ি ও রাস্তা (বাংলা) / Address (Bangla)",
                                          addressEn:
                                            "গ্রাম, বাড়ি ও রাস্তা (ইংরেজি) / Address (English)",
                                        } as Record<string, string>
                                      )[key],
                                    )}
                                    <input
                                      id={`signup-${key}`}
                                      required
                                      type={
                                        key === "password"
                                          ? "password"
                                          : key === "email"
                                            ? "email"
                                            : key === "dateOfBirth"
                                              ? "date"
                                              : "text"
                                      }
                                      minLength={
                                        key === "password" ? 12 : undefined
                                      }
                                      maxLength={
                                        key === "password"
                                          ? 200
                                          : key.startsWith("address")
                                            ? 1000
                                            : key === "email"
                                              ? 254
                                              : 150
                                      }
                                      max={
                                        key === "dateOfBirth"
                                          ? new Date()
                                              .toISOString()
                                              .slice(0, 10)
                                          : undefined
                                      }
                                      autoComplete={
                                        key === "password"
                                          ? "new-password"
                                          : key === "email"
                                            ? "email"
                                            : "off"
                                      }
                                      value={val}
                                      onChange={(e) =>
                                        setRegistration({
                                          ...registration,
                                          [key]: e.target.value,
                                        })
                                      }
                                    />
                                  </label>
                                )),
                            )}
                          </div>
                          <MobileOtpField
                            value={signupMobile}
                            onChange={setSignupMobile}
                          />
                          <PresentAddressFields
                            prefix="signup-present"
                            value={signupPresentAddress}
                            onChange={setSignupPresentAddress}
                          />
                          <div className="registration-actions">
                            <button
                              disabled={
                                working ||
                                signupOfficeLoading ||
                                !signupGeography.wardCode ||
                                !registration.tenantId
                              }
                            >
                              {tx(
                                working
                                  ? "Creating account…"
                                  : "Create account",
                              )}
                            </button>
                            <span>
                              {t("Already registered?")}
                              {tx(" ")}
                              <button
                                type="button"
                                className="text-button"
                                onClick={() => nav("login")}
                              >
                                {t("Sign in ")}
                              </button>
                            </span>
                          </div>
                        </form>
                      ),
                    )}
                  </section>
                ),
              )}
              {tx(
                page === "verify" && (
                  <section className="panel narrow">
                    <h1>{t("সনদ যাচাই করুন")}</h1>
                    <p>
                      {t(
                        "Enter the complete QR verification link or verification token from your DigitalUnion certificate. ",
                      )}
                    </p>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const input = token.trim();
                        let parsed = input;
                        try {
                          if (input.includes("://"))
                            parsed =
                              new URL(input).pathname.split("/verify/")[1] ||
                              "";
                        } catch {
                          parsed = "";
                        }
                        if (!/^[A-Za-z0-9_-]{20,200}$/.test(parsed)) {
                          setError(
                            "Enter a valid DigitalUnion verification token or link.",
                          );
                          return;
                        }
                        location.assign(
                          `/verify/${encodeURIComponent(parsed)}`,
                        );
                      }}
                    >
                      <label htmlFor="verification-token">
                        {t("Verification token or link ")}
                      </label>
                      <input
                        id="verification-token"
                        required
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                      />
                      <button>{t("Verify certificate")}</button>
                    </form>
                    <p className="hint">
                      {t(
                        "Public results reveal only office, service, issue date and status. ",
                      )}
                    </p>
                  </section>
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
                      <h1>{t("সেবার সহায়িকা")}</h1>
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
                        "Keep account credentials private, use a unique password and sign out on shared devices. You may change your password from Account security; doing so expires your other sessions. ",
                      )}
                    </p>
                  </section>
                ),
              )}
              {tx(
                !Object.keys(publicPages)
                  .concat(["login", "register", "policies", "recover"])
                  .includes(page) && (
                  <section className="panel">
                    <h1>{t("Page not found")}</h1>
                    <button onClick={() => nav("home")}>
                      {t("Return home")}
                    </button>
                  </section>
                ),
              )}
            </div>
          ),
        )}
      </main>
      <SiteFooter
        onNavigate={(href) => nav(href === "/" ? "home" : href.slice(1))}
        servicesSlot={
          <ul>
            <li>
              <button className="du-footlink" onClick={() => nav("services")}>
                {t("Service catalog")}
              </button>
            </li>
            <li>
              <button className="du-footlink" onClick={() => nav("offices")}>
                {t("Participating offices ")}
              </button>
            </li>
            <li>
              <button className="du-footlink" onClick={() => nav("verify")}>
                {t("Certificate verification ")}
              </button>
            </li>
          </ul>
        }
        subscribeSlot={
          <>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget,
                  d = new FormData(form);
                setWorking(true);
                setSupportMessage("");
                try {
                  await api("/public/subscribe", "POST", {
                    email: d.get("email"),
                  });
                  form.reset();
                  setSupportMessage(
                    "Subscription preference saved locally. Email delivery is not connected.",
                  );
                } catch (e) {
                  setSupportMessage((e as Error).message);
                } finally {
                  setWorking(false);
                }
              }}
            >
              <label htmlFor="newsletter-email">
                {t("সেবার আপডেটের জন্য নিবন্ধন / Update preferences ")}
              </label>
              <div className="inline-form">
                <input
                  id="newsletter-email"
                  name="email"
                  type="email"
                  placeholder={t("you@example.test")}
                  required
                />
                <button disabled={working}>{t("Save subscription")}</button>
              </div>
              <small>
                {t("Preference saved locally; outgoing email is not connected. ")}
              </small>
            </form>
            {tx(
              supportMessage && page !== "help" && (
                <p role="status">{tx(supportMessage)}</p>
              ),
            )}
          </>
        }
        bottomLine={
          <>
            {t("© ")}
            {tx(new Date().getFullYear())}{" "}
            {choose({
              bn: "DigitalUnion · স্মার্ট ইউনিয়ন, স্মার্ট বাংলাদেশ",
              en: "DigitalUnion · Smart Union, Smart Bangladesh",
            })}
          </>
        }
      />
    </div>
  );
}
