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
    nameBn: "নমুনা নাগরিক",
    nameEn: "Sample Citizen",
    dateOfBirth: "1990-01-01",
    syntheticReference: "DEMO-CITIZEN-NEW",
    addressBn: "নমুনা গ্রাম",
    addressEn: "Sample Village",
  });
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
          <span className="eyebrow">DEMO CERTIFICATE</span>
          <h3>
            {cert.number ||
              cert.certificateNumber ||
              cert.certificate_number ||
              cert.id}
          </h3>
          <p>Public verification reveals office, service, date and status.</p>
        </div>
        <div className="actions">
          <a
            className="button"
            href={`/api/v1/certificates/${cert.id}/pdf`}
            target="_blank"
            rel="noreferrer"
          >
            Download PDF
          </a>
          <a
            className="button secondary"
            href={cert.verificationUrl || cert.verification_url}
            target="_blank"
            rel="noreferrer"
          >
            QR verification
          </a>
          {approver && cert.status !== "REVOKED" && (
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
              Revoke certificate
            </button>
          )}
        </div>
      </div>
    );
  }
  if (!loaded) return <main className="loading">Loading Astra…</main>;
  if (publicToken)
    return (
      <main className="public-verify">
        <a className="brand" href="/">
          A<span>ASTRA UNION SERVICES</span>
        </a>
        <section className="panel">
          <span className="eyebrow">PUBLIC VERIFICATION</span>
          <h1>সনদ যাচাই</h1>
          {verification ? (
            <>
              <span
                className={`status ${String(verification.status).toLowerCase()}`}
              >
                {verification.status}
              </span>
              <dl>
                {Object.entries(verification)
                  .filter(([k]) => !["status", "demo", "isDemo"].includes(k))
                  .map(([k, v]) => (
                    <React.Fragment key={k}>
                      <dt>{k}</dt>
                      <dd>
                        {typeof v === "object" ? JSON.stringify(v) : String(v)}
                      </dd>
                    </React.Fragment>
                  ))}
              </dl>
              <p className="notice">
                DEMO / NOT OFFICIAL — synthetic certificate for software
                verification.
              </p>
            </>
          ) : (
            <p role="alert">{publicError || "Checking certificate…"}</p>
          )}
        </section>
      </main>
    );
  if (!session)
    return (
      <PublicPortal
        login={
          <section className="login-form">
            <h2>স্বাগতম</h2>
            <p>Sign in to your workspace</p>
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
              <label htmlFor="email">Email</label>
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
                {(localDemo ? accounts : []).map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              {message && (
                <p role="alert" className="error">
                  {message}
                </p>
              )}
              <button disabled={busy} type="submit">
                {busy ? "Signing in…" : "Sign in"}
              </button>
            </form>
            <a className="login-recovery" href="/recover">
              Forgot password? Recover your account
            </a>
            {localDemo && (
              <details>
                <summary>Local demo accounts</summary>
                <p>
                  Password: <code>Demo-Phase1!</code>
                </p>
                <div className="demo-accounts">
                  {(localDemo ? accounts : []).map((a) => (
                    <button
                      className="text-button"
                      key={a}
                      onClick={() => setEmail(a)}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </details>
            )}
          </section>
        }
      />
    );
  return (
    <div className="shell">
      <a className="skip" href="#content">
        Skip to main content
      </a>
      <aside>
        <a className="brand" href="/">
          A<span>ASTRA UNION SERVICES</span>
        </a>
        <p className="office">
          {session.tenant?.nameBn ||
            session.tenant?.name_bn ||
            session.tenant?.name ||
            "Platform owner"}
          <small>
            {session.tenant?.nameEn ||
              session.tenant?.name_en ||
              "Independent SaaS platform"}
          </small>
        </p>
        <nav aria-label="Workspace navigation">
          {Object.keys(labels)
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
                <span>{localized[p]}</span>
                <small>{labels[p]}</small>
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="status">DEMO WORKSPACE</span>
          <p>
            {session.user.displayName ||
              session.user.display_name ||
              session.user.email}
            <small>{role}</small>
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
            Sign out
          </button>
        </div>
      </aside>
      <main id="content">
        <header>
          <div>
            <span className="eyebrow">ASTRA · DIGITAL UNION SERVICES</span>
            <h1>{localized[page]}</h1>
            <p>{labels[page]}</p>
          </div>
          <span className="demo-pill">DEMO / NOT OFFICIAL</span>
        </header>
        {message && (
          <div role="status" className="notice message">
            {message}
          </div>
        )}
        {busy && (
          <p role="status" className="working">
            Working…
          </p>
        )}
        {page === "home" && (
          <>
            <div className="stats">
              <div className="stat">
                <span>REFERENCE CATALOG</span>
                <strong>47</strong>
                <small>48 observed entry forms</small>
              </div>
              <div className="stat">
                <span>VALIDATED DEMO FORMS</span>
                <strong>{operationalServiceNumbers.length}</strong>
                <small>Independent service workflows</small>
              </div>
              <div className="stat">
                <span>{role === "owner" ? "TENANTS" : "APPLICATIONS"}</span>
                <strong>{role === "owner" ? tenants.length : appTotal}</strong>
                <small>Persisted in PostgreSQL</small>
              </div>
              {wallet && (
                <div className="stat">
                  <span>AVAILABLE CREDITS</span>
                  <strong>
                    {wallet.balance ?? wallet.wallet?.balance ?? 0}
                  </strong>
                  <small>Append-only tenant ledger</small>
                </div>
              )}
            </div>
            <section className="panel">
              <span className="eyebrow">WORKSPACE</span>
              <h2>নাগরিক থেকে যাচাইযোগ্য সনদ</h2>
              <p>
                Start with a synthetic citizen and a resident-certificate
                application. Staff submit, reviewers check, and an expressly
                authorized approver approves and issues. Issuance commits the
                PDF and one credit debit together.
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
                  {role === "owner"
                    ? "Manage offices"
                    : role === "finance"
                      ? "Manage subscription"
                      : "View applications"}
                </button>
                <button className="secondary" onClick={() => nav("services")}>
                  Explore services
                </button>
              </div>
            </section>
            <section className="panel">
              <h2>Evidence and readiness</h2>
              <p>
                All 47 services have independently authored operational demo
                forms. Original initial-field captures are separately available
                as read-only evidence previews. Original submission, payment and
                official issuance behavior remains unverified.
              </p>
              <p>
                Identity verification and payment settlement use explicitly
                marked local demonstrations. No official authority, government
                seal or live gateway is represented.
              </p>
            </section>
          </>
        )}
        {page === "services" && (
          <>
            <section className="panel">
              <label htmlFor="service-search">Search services</label>
              <input
                id="service-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name or service number"
              />
              <div className="catalog">
                {catalog
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
                        {String(s.service_no).padStart(2, "0")}
                      </span>
                      <span>
                        <strong>{s.name_bn}</strong>
                        <small>{s.name_en}</small>
                        <em>
                          {operationalServiceNumbers.includes(s.service_no)
                            ? "Working demo"
                            : "Reference preview"}
                        </em>
                      </span>
                    </button>
                  ))}
              </div>
            </section>
            <section className="panel">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">
                    SERVICE {selectedService} · SCHEMA V{schema.version}
                  </span>
                  <h2>{schema.title.bn}</h2>
                  <p>{schema.title.en}</p>
                </div>
                <span className="status">
                  {operational ? "DEMO ENABLED" : "READ-ONLY EVIDENCE"}
                </span>
              </div>
              <p className="hint">{schema.evidence.limitation}</p>
              {operationalServiceNumbers.includes(selectedService) && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setPreview(!preview)}
                >
                  {preview
                    ? "Use independent demo form"
                    : "View observed reference fields"}
                </button>
              )}
              {issues.length > 0 && (
                <div role="alert" className="error-summary" tabIndex={-1}>
                  <strong>
                    Correct these fields / নিচের ঘরগুলো সংশোধন করুন
                  </strong>
                  <ul>
                    {issues.map((i) => (
                      <li key={i.path}>
                        {i.path}: {i.message.bn} / {i.message.en}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <DynamicForm
                schema={schema}
                citizenId={citizenId}
                value={payload}
                onChange={setPayload}
                issues={issues}
                disabled={!operational}
              />
              {operational && (staff || role === "citizen") && (
                <>
                  <label htmlFor="applicant-search">Find applicant</label>
                  <input
                    id="applicant-search"
                    placeholder="Name or unique demo reference"
                    value={citizenSearch}
                    onChange={(e) => setCitizenSearch(e.target.value)}
                  />
                  <p className="hint">
                    Searches your office records. Up to 100 matching citizens
                    are shown.
                  </p>
                  <label htmlFor="applicant">Citizen / নাগরিক</label>
                  <select
                    id="applicant"
                    value={citizenId}
                    onChange={(e) => setCitizenId(e.target.value)}
                  >
                    <option value="">Choose citizen</option>
                    {citizens.map((c) => (
                      <option value={c.id} key={c.id}>
                        {c.nameBn || c.name_bn || c.nameEn || c.name_en}
                      </option>
                    ))}
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
                          const resultApi = await api("/applications", "POST", {
                            citizenId,
                            serviceNo: selectedService,
                            payload,
                          });
                          await refresh();
                          await openApplication(
                            (resultApi.application || resultApi).id,
                          );
                          setMessage("Draft saved to PostgreSQL.");
                        })
                      }
                    >
                      Save draft application
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
                      Fill synthetic example
                    </button>
                  </div>
                </>
              )}
            </section>
          </>
        )}
        {page === "citizens" && (
          <>
            <section className="panel">
              <h2>নাগরিক তালিকা</h2>
              <label htmlFor="citizen-search">Search within your tenant</label>
              <input
                id="citizen-search"
                value={citizenSearch}
                onChange={(e) => setCitizenSearch(e.target.value)}
              />
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Citizen</th>
                      <th>Identity state</th>
                      <th>Record</th>
                    </tr>
                  </thead>
                  <tbody>
                    {citizens
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
                            <span className="status">SYNTHETIC DEMO</span>
                          </td>
                          <td>
                            <code>{c.id.slice(0, 8)}</code>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
            {staff && (
              <section className="panel">
                <h2>Register a synthetic citizen</h2>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(async () => {
                      await api("/citizens", "POST", citizenForm);
                      await refresh();
                      setMessage(
                        "Citizen registered. Duplicate identity keys are rejected.",
                      );
                    });
                  }}
                >
                  <div className="form-grid">
                    {Object.entries(citizenForm).map(([key, val]) => (
                      <div className="field" key={key}>
                        <label htmlFor={`citizen-${key}`}>
                          {
                            {
                              nameBn: "নাম (বাংলা) / Name (Bangla)",
                              nameEn: "নাম (ইংরেজি) / Name (English)",
                              dateOfBirth: "জন্ম তারিখ / Date of birth",
                              syntheticReference: "Demo reference",
                              addressBn: "ঠিকানা (বাংলা) / Address (Bangla)",
                              addressEn: "ঠিকানা (ইংরেজি) / Address (English)",
                            }[key]
                          }
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
                    ))}
                  </div>
                  <button disabled={busy}>Register citizen</button>
                </form>
              </section>
            )}
          </>
        )}
        {page === "applications" && !detail && (
          <section className="panel">
            <div className="section-heading">
              <h2>আবেদনসমূহ</h2>
              {(staff || role === "citizen") && (
                <button
                  onClick={() => {
                    setSelectedService(45);
                    nav("services");
                  }}
                >
                  + New application
                </button>
              )}
            </div>
            <label htmlFor="application-search">Search applications</label>
            <input
              id="application-search"
              placeholder="Application ID, citizen name or demo reference"
              value={appSearch}
              onChange={(e) => setAppSearch(e.target.value)}
            />
            <label htmlFor="state-filter">Status filter</label>
            <select
              id="state-filter"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setAppPage(1);
              }}
            >
              <option value="">All states</option>
              {[
                "DRAFT",
                "SUBMITTED",
                "UNDER_REVIEW",
                "CORRECTION_REQUIRED",
                "RESUBMITTED",
                "APPROVED",
                "ISSUED",
                "REJECTED",
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Application</th>
                    <th>Service</th>
                    <th>Status</th>
                    <th>Open</th>
                  </tr>
                </thead>
                <tbody>
                  {applications.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <code>{a.id.slice(0, 8)}</code>
                        <small>{a.createdAt || a.created_at}</small>
                      </td>
                      <td>
                        #{a.serviceNo || a.service_no}{" "}
                        {
                          catalog.find(
                            (s) =>
                              s.service_no === (a.serviceNo || a.service_no),
                          )?.name_bn
                        }
                      </td>
                      <td>
                        <span className="status">{a.state || a.status}</span>
                      </td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => run(() => openApplication(a.id))}
                        >
                          Open application
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!applications.length && (
                <p>No applications match this filter.</p>
              )}
            </div>
            <div className="pagination">
              <button
                className="secondary"
                disabled={busy || appPage <= 1}
                onClick={() => setAppPage(appPage - 1)}
              >
                Previous applications
              </button>
              <span>
                {appTotal} results · Page {appPage} /{" "}
                {Math.max(1, Math.ceil(appTotal / appPageSize))}
              </span>
              <button
                className="secondary"
                disabled={busy || appPage * appPageSize >= appTotal}
                onClick={() => setAppPage(appPage + 1)}
              >
                Next applications
              </button>
            </div>
            <label htmlFor="application-page-size">Applications per page</label>
            <select
              id="application-page-size"
              value={appPageSize}
              onChange={(e) => {
                setAppPageSize(Number(e.target.value));
                setAppPage(1);
              }}
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </section>
        )}
        {page === "applications" && detail && (
          <>
            <section className="panel">
              <button className="text-button" onClick={() => setDetail(null)}>
                ← All applications
              </button>
              <div className="section-heading">
                <div>
                  <span className="eyebrow">
                    APPLICATION {application.id?.slice(0, 8)}
                  </span>
                  <h2>
                    {catalog.find(
                      (s) =>
                        s.service_no ===
                        (application.serviceNo || application.service_no),
                    )?.name_bn || "Application details"}
                  </h2>
                </div>
                <span className="status">
                  {application.state || application.status}
                </span>
              </div>
              {detail.citizen && (
                <p>
                  Citizen: {detail.citizen.nameBn || detail.citizen.name_bn} /{" "}
                  {detail.citizen.nameEn || detail.citizen.name_en}
                </p>
              )}
              <label htmlFor="application-reference">
                Full application reference
              </label>
              <input
                id="application-reference"
                readOnly
                value={application.id}
                onFocus={(e) => e.target.select()}
              />
              <p className="hint">
                Use this reference on the public application tracking page. Only
                status and service information are returned.
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
                    ["DRAFT", "CORRECTION_REQUIRED"].includes(application.state)
                  )
                }
              />
              {(staff || role === "citizen") &&
                ["DRAFT", "CORRECTION_REQUIRED"].includes(
                  application.state,
                ) && (
                  <button
                    className="secondary"
                    onClick={() =>
                      run(async () => {
                        await api(`/applications/${application.id}`, "PATCH", {
                          payload: detailPayload,
                        });
                        await openApplication(application.id);
                        setMessage("New immutable payload version saved.");
                      })
                    }
                  >
                    Save changes
                  </button>
                )}
              <label htmlFor="reason">
                Review, approval or revocation reason
              </label>
              <textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Explain this decision"
              />
              <div className="actions">
                {(staff || role === "citizen") &&
                  ["DRAFT", "SUBMITTED", "CORRECTION_REQUIRED"].includes(
                    application.state,
                  ) && (
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={() => run(() => transition("cancel"))}
                    >
                      Cancel application
                    </button>
                  )}
                {(staff || role === "citizen") &&
                  application.state === "DRAFT" && (
                    <button
                      disabled={busy}
                      onClick={() => run(() => transition("submit"))}
                    >
                      {actionText.submit}
                    </button>
                  )}
                {reviewer &&
                  ["SUBMITTED", "RESUBMITTED"].includes(application.state) && (
                    <button
                      disabled={busy}
                      onClick={() => run(() => transition("review"))}
                    >
                      {actionText.review}
                    </button>
                  )}
                {reviewer && application.state === "UNDER_REVIEW" && (
                  <button
                    disabled={busy}
                    className="secondary"
                    onClick={() => run(() => transition("request_correction"))}
                  >
                    {actionText.request_correction}
                  </button>
                )}
                {(staff || role === "citizen") &&
                  application.state === "CORRECTION_REQUIRED" && (
                    <button
                      disabled={busy}
                      onClick={() => run(() => transition("resubmit"))}
                    >
                      {actionText.resubmit}
                    </button>
                  )}
                {approver && application.state === "UNDER_REVIEW" && (
                  <button
                    disabled={busy}
                    onClick={() => run(() => transition("approve"))}
                  >
                    {actionText.approve}
                  </button>
                )}
                {(reviewer || approver) &&
                  ["SUBMITTED", "UNDER_REVIEW", "RESUBMITTED"].includes(
                    application.state,
                  ) && (
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={() => run(() => transition("reject"))}
                    >
                      {actionText.reject}
                    </button>
                  )}
                {approver &&
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
                      {application.state === "ISSUED"
                        ? "Retry issuance safely"
                        : `Issue demo certificate · ${issueCost} credit${issueCost === 1 ? "" : "s"}`}
                    </button>
                  )}
              </div>
              {certificatePanel(detail.certificate || application.certificate)}
              {detail.renewal && (
                <p className="notice">
                  Renewal lineage: {JSON.stringify(detail.renewal)}
                </p>
              )}
              {(staff || role === "citizen") &&
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
                    {(application.serviceNo || application.service_no) === 42
                      ? "Start trade license renewal"
                      : "Start renewal application"}
                  </button>
                )}
            </section>
            <section className="panel">
              <h2>Immutable audit timeline</h2>
              <ol className="timeline">
                {(detail.events || []).map((event: any, i: number) => (
                  <li key={event.id || i}>
                    <strong>
                      {event.action ||
                        event.toState ||
                        event.to_state ||
                        event.event_type}
                    </strong>
                    <p>{event.reason || "Recorded action"}</p>
                    <small>
                      {event.createdAt || event.created_at} ·{" "}
                      {event.actorId || event.actor_id}
                    </small>
                  </li>
                ))}
              </ol>
              <p className="hint">
                Payload versions:{" "}
                {detail.versions?.length ?? "preserved by server"}
              </p>
            </section>
          </>
        )}
        {page === "billing" && (
          <>
            <div className="stats">
              <div className="stat">
                <span>PREPAID BALANCE</span>
                <strong>
                  {wallet?.balance ?? wallet?.wallet?.balance ?? 0}
                </strong>
                <small>Cost follows your office service settings</small>
              </div>
              <div className="stat">
                <span>PAYMENT ENVIRONMENT</span>
                <strong>Sandbox</strong>
                <small>Engineering fixture prices only</small>
              </div>
            </div>
            <section className="panel">
              <h2>Subscription and top-up</h2>
              <p>
                Local sandbox settlement persists invoices, subscription grants
                and payment events. Demo prices are configuration fixtures
                awaiting commercial approval.
              </p>
              <pre className="compact-json">
                {JSON.stringify(billing?.subscription, null, 2)}
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
                  Create 10-credit top-up
                </button>
                {(billing?.plans || []).map((plan: any) => (
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
                    Renew {plan.name} plan
                  </button>
                ))}
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Kind</th>
                      <th>Amount (minor BDT)</th>
                      <th>Status / action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(billing?.orders || []).map((o: any) => (
                      <tr key={o.id}>
                        <td>{o.id.slice(0, 8)}</td>
                        <td>{o.kind}</td>
                        <td>{o.amountMinor ?? o.amount_minor}</td>
                        <td>
                          {o.status}{" "}
                          {o.status !== "SETTLED" && (
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
                              Settle in local sandbox
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="panel">
              <h2>Credit ledger</h2>
              <p>
                Government fees have separate accounting and are not charged to
                this wallet.
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Kind</th>
                      <th>Credits</th>
                      <th>Reason</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(wallet?.ledger || []).map((l: any) => (
                      <tr key={l.id}>
                        <td>{l.kind}</td>
                        <td>{l.delta}</td>
                        <td>{l.reason}</td>
                        <td>{l.createdAt || l.created_at}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="panel">
              <h2>Invoices</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Amount (minor BDT)</th>
                      <th>Payment type</th>
                      <th>Invoice copy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(billing?.invoices || []).map((i: any) => (
                      <tr key={i.id}>
                        <td>{i.number || i.id}</td>
                        <td>{i.amountMinor ?? i.amount_minor}</td>
                        <td>SaaS subscription / credits</td>
                        <td>
                          <a
                            className="button secondary"
                            target="_blank"
                            rel="noreferrer"
                            href={`/api/v1/invoices/${i.id}/pdf`}
                          >
                            Download invoice PDF
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
        <Suspense fallback={<p role="status">Loading workspace…</p>}>
          {page === "admin" && role === "admin" && <AdminWorkspace />}
          {page === "security" && <AccountSecurity />}
          {[
            "profile",
            "prints",
            "notifications",
            "reports",
            "support",
          ].includes(page) && (
            <AdditionalWorkspace page={page} session={session} />
          )}
          {page === "owner" && <OwnerOnboarding onSaved={refresh} />}
        </Suspense>
        {page === "owner" && (
          <section className="panel">
            <h2>Tenant credit management</h2>
            <p>
              Owner adjustments require a reason and append a compensating
              ledger entry. Official approval authority belongs to assigned
              tenant officials.
            </p>
            {tenants.map((t) => (
              <div className="tenant-card" key={t.id}>
                <h3>{t.nameEn || t.name_en || t.name}</h3>
                <p>
                  {t.status} · Credits:{" "}
                  {t.balance ?? t.walletBalance ?? "see ledger"}
                </p>
                <button
                  className={t.status === "ACTIVE" ? "danger" : "secondary"}
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api(`/owner/tenants/${t.id}`, "PATCH", {
                        status: t.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE",
                      });
                      await refresh();
                      setMessage("Tenant status updated.");
                    })
                  }
                >
                  {t.status === "ACTIVE" ? "Suspend office" : "Activate office"}
                </button>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const data = new FormData(e.currentTarget);
                    run(async () => {
                      await api(`/owner/tenants/${t.id}/adjust`, "POST", {
                        delta: Number(data.get("delta")),
                        reason: data.get("reason"),
                      });
                      await refresh();
                      setMessage("Audited compensating entry added.");
                    });
                  }}
                >
                  <label htmlFor={`delta-${t.id}`}>Credit adjustment</label>
                  <input
                    id={`delta-${t.id}`}
                    name="delta"
                    type="number"
                    defaultValue={5}
                    required
                  />
                  <label htmlFor={`adjust-reason-${t.id}`}>Reason</label>
                  <input
                    id={`adjust-reason-${t.id}`}
                    name="reason"
                    required
                    minLength={5}
                    defaultValue="Demo support adjustment"
                  />
                  <button>Record adjustment</button>
                </form>
              </div>
            ))}
          </section>
        )}
        <footer>
          Astra · Independently authored software · Independent demonstration ·
          Reference evidence is limited to initial forms.
        </footer>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
