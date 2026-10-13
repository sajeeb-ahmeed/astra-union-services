import { t, tx, choose } from "./i18n.js";
import React, { useEffect, useState } from "react";
import { serviceCatalog } from "@astra/shared-schemas";
import { api, items } from "./api.js";
import {
  GeographyFields,
  geographyPayload,
  emptyGeography,
  readGeography,
} from "./GeographyFields.js";
import { LanguageSwitcher } from "./i18n.js";

const publicPages: Record<string, [string, string]> = {
  home: ["হোম", "Home"],
  services: ["নাগরিক সেবা", "Services"],
  offices: ["সেবার আওতাভুক্ত অফিস", "Office directory"],
  notices: ["বিজ্ঞপ্তি", "Notices"],
  help: ["সহায়িকা", "Help"],
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
  useEffect(() => {
    if (location.search) history.replaceState({}, "", "/recover");
  }, []);
  return (
    <section className="panel narrow">
      <h1>{t("অ্যাকাউন্ট পুনরুদ্ধার / Account recovery")}</h1>
      <p>
        {t(
          "Contact your office administrator using your existing trusted contact channel. After checking the request, they can provide a one-use recovery link valid for 15 minutes. This demonstration does not send OTP, email or SMS. ",
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
              try {
                await api("/auth/recover", "POST", {
                  token,
                  newPassword: d.get("password"),
                });
                setDone(true);
                setToken("");
              } catch (e) {
                setMessage((e as Error).message);
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
            <p className="notice">{t("DEMO / NOT OFFICIAL")}</p>
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
export function PublicPortal({ login }: { login: React.ReactNode }) {
  const initial = location.pathname.split("/")[1] || "home";
  const [page, setPage] = useState(initial),
    [search, setSearch] = useState(""),
    [serviceNo, setServiceNo] = useState<number | null>(null);
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
  function nav(next: string) {
    setPage(next);
    setOffice(null);
    setError("");
    history.pushState({}, "", next === "home" ? "/" : `/${next}`);
    window.scrollTo(0, 0);
  }
  useEffect(() => {
    const pop = () => {
      setPage(location.pathname.split("/")[1] || "home");
      setOffice(null);
    };
    addEventListener("popstate", pop);
    return () => removeEventListener("popstate", pop);
  }, []);
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
    if (page === "home")
      api("/notices?pageSize=6")
        .then((d) => setNotices(items(d)))
        .catch(() => setNotices([]));
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
  const services = serviceCatalog.filter((s) =>
    `${s.service_no} ${s.name_bn} ${s.name_en}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const selected = serviceCatalog.find((s) => s.service_no === serviceNo);
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
              onChange={(e) => setSearch(e.target.value)}
            />
          </>
        ),
      )}
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
      {tx(
        !services.length && (
          <p role="status" className="empty-state">
            {t("এই নামে কোনো সেবা পাওয়া যায়নি। No services match. ")}
          </p>
        ),
      )}
      {tx(
        selected && !compact && (
          <section
            className="panel service-information"
            aria-label={t("Service information")}
          >
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
                  "Complete the service form and attach requested sample evidence. ",
                )}
              </li>
              <li>
                {t("Submit for office review; follow any correction request.")}
              </li>
              <li>
                {t(
                  "An authorized approver can issue a clearly marked demo document. View status in your account and verify its QR link. ",
                )}
              </li>
            </ol>
            <p className="notice">
              {t(
                "These independently authored workflows are demonstrations. Original government requirements, fees, identity checks and official certificate authority are not established by the reference audit. ",
              )}
            </p>
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
      <div className="public-top">
        <div className="public-container">
          <span>{t("ডিজিটাল নাগরিক সেবায় স্বাগতম")}</span>
          <span>{t("নাগরিক সেবা পোর্টাল · Public preview")}</span>
        </div>
      </div>
      <header className="public-header public-container">
        <a
          className="public-brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            nav("home");
          }}
        >
          <span className="brand-symbol">{t("A")}</span>
          <span>
            <strong>{t("অ্যাস্ট্রা")}</strong>
            <small>{t("ASTRA · UNION SERVICES")}</small>
          </span>
        </a>
        <div className="header-promise">
          {t("নাগরিক সেবা এখন ")}
          <br />
          <strong>{t("আরও সহজ, আরও কাছে")}</strong>
        </div>
        <div className="actions">
          <LanguageSwitcher />
          <button className="secondary" onClick={() => nav("register")}>
            {t("নিবন্ধন ")}
          </button>
          <button onClick={() => nav("login")}>{t("লগইন")}</button>
        </div>
      </header>
      <nav className="public-nav" aria-label={t("Public navigation")}>
        <div className="public-container">
          {tx(
            Object.entries(publicPages).map(([key, label]) => (
              <button
                key={key}
                aria-current={page === key ? "page" : undefined}
                onClick={() => nav(key)}
              >
                {choose({ bn: label[0], en: label[1] })}
              </button>
            )),
          )}
        </div>
      </nav>
      <main id="public-content">
        {tx(
          page === "home" && (
            <>
              <section className="public-hero">
                <div className="public-container hero-grid">
                  <div className="hero-copy">
                    <span className="eyebrow">
                      {t("YOUR OFFICE. YOUR SERVICES. ONLINE. ")}
                    </span>
                    <h1>
                      {t("ঘরে বসেই নাগরিক সেবা, ")}
                      <br />
                      <em>{t("সহজ ও স্বচ্ছ প্রক্রিয়ায়।")}</em>
                    </h1>
                    <p>
                      {t(
                        "আবেদন থেকে সনদ যাচাই — ইউনিয়ন পরিষদের ডিজিটাল সেবার প্রতিটি ধাপে আপনার পাশে। ",
                      )}
                    </p>
                    <div className="actions">
                      <button onClick={() => nav("services")}>
                        {t("সেবার জন্য আবেদন করুন → ")}
                      </button>
                      <button
                        className="secondary"
                        onClick={() => nav("offices")}
                      >
                        {t("আপনার অফিস খুঁজুন ")}
                      </button>
                    </div>
                    <div className="hero-metrics">
                      <span>
                        <strong>{t("৪৭")}</strong>
                        {t("সেবার ধরন ")}
                      </span>
                      <span>
                        <strong>{t("১")}</strong>
                        {t("সমন্বিত প্ল্যাটফর্ম ")}
                      </span>
                      <span>
                        <strong>{t("QR")}</strong>
                        {t("সনদ যাচাই ")}
                      </span>
                    </div>
                  </div>
                  <div className="hero-login">{tx(login)}</div>
                </div>
              </section>
              <section className="public-container public-section">
                {tx(servicesView(true))}
              </section>
              <section className="process-band">
                <div className="public-container">
                  <span className="eyebrow">{t("HOW IT WORKS")}</span>
                  <h2>{t("চার ধাপেই সেবার আবেদন")}</h2>
                  <div className="process-grid">
                    {tx(
                      [
                        [
                          "১",
                          "নিবন্ধন করুন",
                          "আপনার অফিস নির্বাচন করে ডেমো অ্যাকাউন্ট তৈরি করুন।",
                        ],
                        [
                          "২",
                          "আবেদন জমা দিন",
                          "সেবার তথ্য পূরণ করে প্রয়োজনীয় নথি সংযুক্ত করুন।",
                        ],
                        [
                          "৩",
                          "অগ্রগতি দেখুন",
                          "পর্যালোচনা, সংশোধন ও অনুমোদনের অবস্থা জানুন।",
                        ],
                        [
                          "৪",
                          "সনদ সংগ্রহ করুন",
                          "অনুমোদিত ডেমো সনদ ডাউনলোড ও QR যাচাই করুন।",
                        ],
                      ].map(([n, title, text]) => (
                        <div key={n}>
                          <b>{tx(n)}</b>
                          <h3>{tx(title)}</h3>
                          <p>{tx(text)}</p>
                        </div>
                      )),
                    )}
                  </div>
                </div>
              </section>
              <section className="public-container public-section">
                <div className="public-section-heading">
                  <div>
                    <span className="eyebrow">{t("OFFICE UPDATES")}</span>
                    <h2>{t("সর্বশেষ বিজ্ঞপ্তি")}</h2>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => nav("notices")}
                  >
                    {t("সব বিজ্ঞপ্তি → ")}
                  </button>
                </div>
                {tx(
                  notices.length ? (
                    <div className="notice-grid">
                      {tx(
                        notices.slice(0, 3).map((n) => (
                          <article className="panel" key={n.id}>
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
                            <small>
                              {choose({
                                bn: value(n, "officeBn", "office_bn"),
                                en: value(n, "officeEn", "office_en"),
                              })}
                            </small>
                          </article>
                        )),
                      )}
                    </div>
                  ) : (
                    <p className="empty-state">
                      {t(
                        "অফিসের প্রকাশিত বিজ্ঞপ্তি এখানে দেখানো হবে। No published notices at this time. ",
                      )}
                    </p>
                  ),
                )}
              </section>
            </>
          ),
        )}
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
                    <p className="notice preview-disclosure">
                      {t(
                        "Public preview: use sample personal information. Identity verification and official certificate authority are not connected; issued documents remain marked DEMO / NOT OFFICIAL. ",
                      )}
                    </p>
                    {tx(
                      registered ? (
                        <div role="status" className="registration-success">
                          <h2>{t("নিবন্ধন সম্পন্ন / Account created")}</h2>
                          <p>
                            {t(
                              "You can now sign in with your email and password.",
                            )}
                          </p>
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
                              await api("/auth/signup", "POST", {
                                ...registration,
                                geography: geographyPayload(signupGeography),
                              });
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
                                          {t("Use a preview office ")}
                                        </button>
                                      ),
                                  )}
                                  {tx(
                                    signupOfficeMode === "preview" && (
                                      <div className="preview-office-note">
                                        <p>
                                          {t(
                                            "Preview offices accept sample registrations from any area. They are not verified government offices for your selected location. ",
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
                                <p className="empty-state">
                                  {t(
                                    "আগে আপনার ইউনিয়ন নির্বাচন করুন / Select your union above to find participating offices. ",
                                  )}
                                </p>
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
                        "Enter the complete QR verification link or verification token from an Astra demo certificate. ",
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
                            "Enter a valid Astra verification token or link.",
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
                      {tx(
                        [
                          [
                            "কীভাবে আবেদন করব? / How do I apply?",
                            "Register with a participating office, sign in, choose a service and citizen, complete its form, then save and submit. Your Applications page shows the current state.",
                          ],
                          [
                            "সংশোধনের অনুরোধ এলে? / What if changes are requested?",
                            "Open the application, read the review reason, edit the requested fields, save changes and resubmit. Earlier submitted versions remain in the audit history.",
                          ],
                          [
                            "সনদ কীভাবে পাব? / How do I get my certificate?",
                            "After authorized approval and issuance, open the application and use Download PDF. The QR verification link shows current issued or revoked status.",
                          ],
                          [
                            "পেমেন্ট কি বাস্তব? / Are payments live?",
                            "No. The current installation uses a local billing sandbox with engineering fixture prices. No real money is collected and statutory government fees are not configured.",
                          ],
                          [
                            "পরিচয় যাচাই হয় কি? / Is identity verified?",
                            "Accounts and records are synthetic demo data. Government NID/BRN, OTP and official identity verification are not connected.",
                          ],
                          [
                            "সমস্যা হলে? / What if I need help?",
                            "Contact your participating office through your existing trusted contact channel. This demo has no live call centre, email or SMS delivery provider.",
                          ],
                        ]
                          .filter(([q, a]) =>
                            `${q} ${a}`
                              .toLowerCase()
                              .includes(faqSearch.toLowerCase()),
                          )
                          .map(([q, a]) => (
                            <details key={q}>
                              <summary>{tx(q)}</summary>
                              <p>{tx(a)}</p>
                            </details>
                          )),
                      )}
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
                    <h1>{t("ব্যবহারের নীতি / Demo policies")}</h1>
                    <h2>{t("Independent demonstration")}</h2>
                    <p>
                      {t(
                        "Astra is independently authored software. It is not the reference operator or a government authority. All generated documents are visibly marked DEMO / NOT OFFICIAL. ",
                      )}
                    </p>
                    <h2>{t("Data and privacy")}</h2>
                    <p>
                      {t(
                        "Use synthetic identities and sample attachments. Application data, private files, document bytes and workflow history are stored in PostgreSQL. Tenant roles control access. Public QR verification excludes names, identity references and application contents. Operational logs and immutable audit entries may persist; do not enter sensitive personal information into this demonstration. ",
                      )}
                    </p>
                    <h2>{t("Commercial and official use")}</h2>
                    <p>
                      {t(
                        "Subscription and prepaid credits are software accounting demonstrations. Live pricing, payment providers, statutory fees, retention periods, legal privacy terms and official signatory authority require approved configuration and policies before deployment with real citizen data. ",
                      )}
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
      <footer className="public-footer">
        <div className="public-container footer-grid">
          <div>
            <a className="public-brand" href="/">
              <span className="brand-symbol">{t("A")}</span>
              <span>
                <strong>{t("অ্যাস্ট্রা")}</strong>
                <small>{t("ASTRA · UNION SERVICES")}</small>
              </span>
            </a>
            <p>{t("নাগরিক সেবা, একটি নির্ভরযোগ্য পথে।")}</p>
            <p>{t("Independent software · Synthetic demo only")}</p>
          </div>
          <div>
            <h3>{t("সেবার তথ্য")}</h3>
            <button onClick={() => nav("services")}>
              {t("Service catalog")}
            </button>
            <button onClick={() => nav("offices")}>
              {t("Participating offices ")}
            </button>
            <button onClick={() => nav("verify")}>
              {t("Certificate verification ")}
            </button>
          </div>
          <div>
            <h3>{t("সহায়তা ও নীতি")}</h3>
            <button onClick={() => nav("help")}>
              {t("Help & frequently asked questions ")}
            </button>
            <button onClick={() => nav("policies")}>
              {t("Privacy & demo use policies ")}
            </button>
            <button onClick={() => nav("login")}>
              {t("Office workspace")}
            </button>
          </div>
        </div>
        <div className="public-container newsletter">
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
        </div>
        <div className="public-container footer-bottom">
          {t("© ")}
          {tx(new Date().getFullYear())}
          {t(" Astra · All certificate output is DEMO / NOT OFFICIAL. ")}
        </div>
      </footer>
    </div>
  );
}
