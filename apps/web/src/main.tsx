import {
  t,
  tx,
  choose,
  recordName,
  useLanguage,
  LanguageSwitcher,
} from "./i18n.js";
import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  demoPayloads,
  operationalServiceNumbers,
  getServiceSchema,
  getCatalogPreviewSchema,
  validateForm,
  type ValidationIssue,
} from "@astra/shared-schemas";
import { api, items } from "./api.js";
import { DynamicForm } from "./DynamicForm.js";
import "./style.css";
import { PublicPortal } from "./PublicPortal.js";
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
const localDemo = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(
  location.hostname,
);
const accounts = [
  "citizen",
  "staff",
  "reviewer",
  "approver",
  "admin",
  "finance",
]
  .map((r) => `${r}@alpha.demo.test`)
  .concat([
    "staff@beta.demo.test",
    "approver@beta.demo.test",
    "owner@astra.demo.test",
  ]);
const labels: Record<string, string> = {
  home: "Overview",
  services: "Service catalog",
  citizens: "Citizens",
  applications: "Applications",
  billing: "Subscription & credits",
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
function App() {
  useLanguage();
  const [session, setSession] = useState<any>(null),
    [loaded, setLoaded] = useState(false),
    [page, setPage] = useState("home"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [email, setEmail] = useState(localDemo ? accounts[1] : ""),
    [password, setPassword] = useState(localDemo ? "Demo-Phase1!" : "");
  const [catalog, setCatalog] = useState<any[]>([]),
    [citizens, setCitizens] = useState<any[]>([]),
    [applications, setApplications] = useState<any[]>([]),
    [wallet, setWallet] = useState<any>(null),
    [billing, setBilling] = useState<any>(null),
    [tenants, setTenants] = useState<any[]>([]);
  const [selectedService, setSelectedService] = useState(45),
    [preview, setPreview] = useState(false),
    [payload, setPayload] = useState<Record<string, any>>({
      ...demoPayloads[45],
    }),
    [citizenId, setCitizenId] = useState(""),
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
  useEffect(() => {
    setCitizenGeography(readGeography(session?.tenant));
  }, [session?.tenant?.id]);
  const [verification, setVerification] = useState<any>(null),
    [publicError, setPublicError] = useState("");
  const publicToken = location.pathname.startsWith("/verify/")
    ? location.pathname.split("/")[2]
    : null;
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
    if (publicToken) {
      api(`/verify/${encodeURIComponent(publicToken)}`)
        .then(setVerification)
        .catch(() =>
          setPublicError(
            "Certificate not found. The verification link may be invalid.",
          ),
        );
      setLoaded(true);
      return;
    }
    api("/auth/me")
      .then(setSession)
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);
  useEffect(() => {
    if (session) run(refresh);
  }, [session, filter, appQuery, appPage, appPageSize, citizenQuery]);
  useEffect(() => {
    setPayload({ ...demoPayloads[selectedService] });
    setPreview(false);
    setIssues([]);
  }, [selectedService]);
  const role = session?.user?.role || "",
    staff = ["staff", "admin"].includes(role),
    reviewer = role === "reviewer",
    approver = role === "approver",
    finance = ["finance", "admin"].includes(role);
  const operational =
      operationalServiceNumbers.includes(selectedService) && !preview,
    schema = operational
      ? getServiceSchema(selectedService)
      : getCatalogPreviewSchema(selectedService);
  const issueCost = detail?.serviceConfiguration?.creditCost ?? 1;
  const application = detail?.application || detail,
    detailPayload = detail?.payload || application?.payload || {};
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
    setPage(next);
    setDetail(null);
    setMessage("");
    setSearch("");
  }
  function certificatePanel(cert: any) {
    if (!cert) return null;
    return (
      <div className="certificate-card">
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
  if (!loaded) return <main className="loading">{t("Loading Astra…")}</main>;
  if (publicToken)
    return (
      <main className="public-verify">
        <a className="brand" href="/">
          {t("A")}
          <span>{t("ASTRA UNION SERVICES")}</span>
        </a>
        <LanguageSwitcher />
        <section className="panel">
          <span className="eyebrow">{t("PUBLIC VERIFICATION")}</span>
          <h1>{t("সনদ যাচাই")}</h1>
          {tx(
            verification ? (
              <>
                <span
                  className={`status ${String(verification.status).toLowerCase()}`}
                >
                  {tx(verification.status)}
                </span>
                <dl>
                  {tx(
                    [
                      [
                        t("Office"),
                        choose({
                          bn: verification.officeBn,
                          en: verification.officeEn,
                        }),
                      ],
                      [
                        t("Service"),
                        choose({
                          bn: verification.serviceBn,
                          en: verification.serviceEn,
                        }),
                      ],
                      [
                        t("Issued on"),
                        new Date(verification.issuedAt).toLocaleString(
                          document.documentElement.lang === "bn"
                            ? "bn-BD"
                            : "en-GB",
                        ),
                      ],
                    ].map(([label, content]) => (
                      <React.Fragment key={label}>
                        <dt>{label}</dt>
                        <dd>{content}</dd>
                      </React.Fragment>
                    )),
                  )}
                </dl>
                <p className="notice">
                  {t(
                    "DEMO / NOT OFFICIAL — synthetic certificate for software verification. ",
                  )}
                </p>
              </>
            ) : (
              <p role="alert">{tx(publicError || "Checking certificate…")}</p>
            ),
          )}
        </section>
      </main>
    );
  if (!session)
    return (
      <PublicPortal
        login={
          <section className="login-form">
            <h2>{t("স্বাগতম")}</h2>
            <p>{t("Sign in to your workspace")}</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  const nextSession = await api("/auth/login", "POST", {
                    email,
                    password,
                  });
                  setPassword("");
                  setSession(nextSession);
                });
              }}
            >
              <label htmlFor="email">{t("Email")}</label>
              <input
                id="email"
                type="email"
                list="accounts"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <datalist id="accounts">
                {tx(
                  (localDemo ? accounts : []).map((a) => (
                    <option key={a} value={a} />
                  )),
                )}
              </datalist>
              <label htmlFor="password">{t("Password")}</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              {tx(
                message && (
                  <p role="alert" className="error">
                    {tx(message)}
                  </p>
                ),
              )}
              <button disabled={busy} type="submit">
                {tx(busy ? "Signing in…" : "Sign in")}
              </button>
            </form>
            <a className="login-recovery" href="/recover">
              {t("Forgot password? Recover your account ")}
            </a>
            {tx(
              localDemo && (
                <details>
                  <summary>{t("Local demo accounts")}</summary>
                  <p>
                    {t("Password: ")}
                    <code>{t("Demo-Phase1!")}</code>
                  </p>
                  <div className="demo-accounts">
                    {tx(
                      (localDemo ? accounts : []).map((a) => (
                        <button
                          className="text-button"
                          key={a}
                          onClick={() => setEmail(a)}
                        >
                          {tx(a)}
                        </button>
                      )),
                    )}
                  </div>
                </details>
              ),
            )}
          </section>
        }
      />
    );
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
          {tx(
            session.tenant?.nameBn ||
              session.tenant?.name_bn ||
              session.tenant?.name ||
              "Platform owner",
          )}
          <small>
            {tx(
              session.tenant?.nameEn ||
                session.tenant?.name_en ||
                "Independent SaaS platform",
            )}
          </small>
        </p>
        <nav aria-label={t("Workspace navigation")}>
          {tx(
            Object.keys(labels)
              .filter((p) =>
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
                    (role !== "finance" ||
                      [
                        "home",
                        "services",
                        "billing",
                        "security",
                        "profile",
                        "notifications",
                        "reports",
                      ].includes(p)),
              )
              .map((p) => (
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
                setEmail("");
                setPassword("");
                setSession(null);
                setCitizens([]);
                setApplications([]);
                setWallet(null);
                setBilling(null);
                setTenants([]);
                setCitizenId("");
                setCitizenSearch("");
                setAppSearch("");
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
        {tx(
          page === "home" && (
            <>
              <div className="stats">
                <div className="stat">
                  <span>{t("REFERENCE CATALOG")}</span>
                  <strong>{t("47")}</strong>
                  <small>{t("48 observed entry forms")}</small>
                </div>
                <div className="stat">
                  <span>{t("VALIDATED DEMO FORMS")}</span>
                  <strong>{tx(operationalServiceNumbers.length)}</strong>
                  <small>{t("Independent service workflows")}</small>
                </div>
                <div className="stat">
                  <span>
                    {tx(role === "owner" ? "TENANTS" : "APPLICATIONS")}
                  </span>
                  <strong>
                    {tx(role === "owner" ? tenants.length : appTotal)}
                  </strong>
                  <small>{t("Persisted in PostgreSQL")}</small>
                </div>
                {tx(
                  wallet && (
                    <div className="stat">
                      <span>{t("AVAILABLE CREDITS")}</span>
                      <strong>
                        {tx(wallet.balance ?? wallet.wallet?.balance ?? 0)}
                      </strong>
                      <small>{t("Append-only tenant ledger")}</small>
                    </div>
                  ),
                )}
              </div>
              <section className="panel">
                <span className="eyebrow">{t("WORKSPACE")}</span>
                <h2>{t("নাগরিক থেকে যাচাইযোগ্য সনদ")}</h2>
                <p>
                  {t(
                    "Start with a synthetic citizen and a resident-certificate application. Staff submit, reviewers check, and an expressly authorized approver approves and issues. Issuance commits the PDF and one credit debit together. ",
                  )}
                </p>
                <div className="actions">
                  <button
                    onClick={() =>
                      nav(
                        role === "owner"
                          ? "owner"
                          : role === "finance"
                            ? "billing"
                            : "applications",
                      )
                    }
                  >
                    {tx(
                      role === "owner"
                        ? "Manage offices"
                        : role === "finance"
                          ? "Manage subscription"
                          : "View applications",
                    )}
                  </button>
                  <button className="secondary" onClick={() => nav("services")}>
                    {t("Explore services ")}
                  </button>
                </div>
              </section>
              <section className="panel">
                <h2>{t("Evidence and readiness")}</h2>
                <p>
                  {t(
                    "All 47 services have independently authored operational demo forms. Original initial-field captures are separately available as read-only evidence previews. Original submission, payment and official issuance behavior remains unverified. ",
                  )}
                </p>
                <p>
                  {t(
                    "Identity verification and payment settlement use explicitly marked local demonstrations. No official authority, government seal or live gateway is represented. ",
                  )}
                </p>
              </section>
            </>
          ),
        )}
        {tx(
          page === "services" && (
            <>
              <section className="panel">
                <label htmlFor="service-search">{t("Search services")}</label>
                <input
                  id="service-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("Name or service number")}
                />
                <div className="catalog">
                  {tx(
                    catalog
                      .filter((s) =>
                        `${s.service_no} ${s.name_bn} ${s.name_en}`
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                      )
                      .map((s) => (
                        <button
                          className={`service ${selectedService === s.service_no ? "selected" : ""}`}
                          key={s.service_no}
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
              </section>
              <section className="panel">
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
                    <div role="alert" className="error-summary" tabIndex={-1}>
                      <strong>
                        {t("Correct these fields / নিচের ঘরগুলো সংশোধন করুন ")}
                      </strong>
                      <ul>
                        {tx(
                          issues.map((i) => (
                            <li key={i.path}>
                              {tx(i.path)}
                              {t(": ")}
                              {choose(i.message)}
                            </li>
                          )),
                        )}
                      </ul>
                    </div>
                  ),
                )}
                <DynamicForm
                  schema={schema}
                  citizenId={citizenId}
                  value={payload}
                  onChange={setPayload}
                  issues={issues}
                  disabled={!operational}
                />
                {tx(
                  operational && (staff || role === "citizen") && (
                    <>
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
                          "Searches your office records. Up to 100 matching citizens are shown. ",
                        )}
                      </p>
                      <label htmlFor="applicant">{t("Citizen / নাগরিক")}</label>
                      <select
                        id="applicant"
                        value={citizenId}
                        onChange={(e) => setCitizenId(e.target.value)}
                      >
                        <option value="">{t("Choose citizen")}</option>
                        {tx(
                          citizens.map((c) => (
                            <option value={c.id} key={c.id}>
                              {c.nameBn || c.name_bn || c.nameEn || c.name_en}
                            </option>
                          )),
                        )}
                      </select>
                      <div className="actions">
                        <button
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              const result = validateForm(schema, payload);
                              setIssues(result.issues);
                              if (!result.valid) {
                                document
                                  .querySelector<HTMLElement>(
                                    '[aria-invalid="true"]',
                                  )
                                  ?.focus();
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
                                },
                              );
                              await refresh();
                              await openApplication(
                                (resultApi.application || resultApi).id,
                              );
                              setMessage("Draft saved to PostgreSQL.");
                            })
                          }
                        >
                          {t("Save draft application ")}
                        </button>
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
                          await api("/citizens", "POST", {
                            ...citizenForm,
                            geography: geographyPayload(citizenGeography),
                          });
                          await refresh();
                          setCitizenForm({
                            nameBn: "",
                            nameEn: "",
                            dateOfBirth: "",
                            addressBn: "",
                            addressEn: "",
                          });
                          setMessage(
                            "Citizen registered. Duplicate identity keys are rejected.",
                          );
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
                        nav("services");
                      }}
                    >
                      {t("+ New application ")}
                    </button>
                  ),
                )}
              </div>
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
                  ].map((s) => (
                    <option key={s} value={s}>
                      {tx(s)}
                    </option>
                  )),
                )}
              </select>
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
                            <small>{tx(a.createdAt || a.created_at)}</small>
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
                    <p>{t("No applications match this filter.")}</p>
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
                <DynamicForm
                  schema={getServiceSchema(
                    application.serviceNo || application.service_no,
                    application.schemaVersion || 1,
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
                            setMessage("New immutable payload version saved.");
                          })
                        }
                      >
                        {t("Save changes ")}
                      </button>
                    ),
                )}
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
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            const renewal = await api(
                              `/applications/${application.id}/renew`,
                              "POST",
                              {},
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
                          (application.serviceNo || application.service_no) ===
                            42
                            ? "Start trade license renewal"
                            : "Start renewal application",
                        )}
                      </button>
                    ),
                )}
              </section>
              <section className="panel">
                <h2>{t("Immutable audit timeline")}</h2>
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
        <Suspense fallback={<p role="status">{t("Loading workspace…")}</p>}>
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
        </Suspense>
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
                    <h3>
                      {tx(
                        officeTenant.nameEn ||
                          officeTenant.name_en ||
                          officeTenant.name,
                      )}
                    </h3>
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
createRoot(document.getElementById("root")!).render(<App />);
