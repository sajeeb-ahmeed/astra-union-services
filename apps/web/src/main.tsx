import React, { lazy, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./api.js";
import { t, tx, choose, useLanguage, LanguageSwitcher } from "./i18n.js";
import { PublicPortal } from "./PublicPortal.js";
import { AsyncPanel, LoadingPanel } from "./AsyncPanel.js";
import { MfaChallenge, type MfaLoginChallenge } from "./MfaChallenge.js";
import "./style.css";

// Authenticated workflows and form history are downloaded only after a valid session.
const WorkspaceApp = lazy(() =>
  import("./WorkspaceApp.js").then((module) => ({
    default: module.WorkspaceApp,
  })),
);
const returnedApplication =
  location.pathname === "/payments/return"
    ? new URLSearchParams(location.search).get("applicationId")
    : null;
const paymentReturnApplication =
  returnedApplication &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    returnedApplication,
  )
    ? returnedApplication
    : null;
if (location.pathname === "/payments/return") {
  // A callback only selects an authenticated record. Query parameters never prove payment.
  history.replaceState({}, "", "/login");
}
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

function CertificateVerification({ publicToken }: { publicToken: string }) {
  useLanguage();
  const [verification, setVerification] = useState<any>(null);
  const [publicError, setPublicError] = useState("");
  useEffect(() => {
    let active = true;
    api(`/verify/${encodeURIComponent(publicToken)}`)
      .then((result) => {
        if (active) setVerification(result);
      })
      .catch(() => {
        if (active)
          setPublicError(
            "Certificate not found. The verification link may be invalid.",
          );
      });
    return () => {
      active = false;
    };
  }, [publicToken]);
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
}

function SignedOutPortal({
  onLogin,
  prefillDemo,
}: {
  onLogin: (session: any) => void;
  prefillDemo: boolean;
}) {
  useLanguage();
  const [email, setEmail] = useState(
    localDemo && prefillDemo ? accounts[1] : "",
  );
  const [password, setPassword] = useState(
    localDemo && prefillDemo ? "Demo-Phase1!" : "",
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [challenge, setChallenge] = useState<MfaLoginChallenge | null>(null);
  const loginAttempt = useRef(0);
  const clearLoginSecrets = useCallback(() => {
    loginAttempt.current++;
    setPassword("");
    setChallenge(null);
    setShowPassword(false);
    setMessage("");
  }, []);
  useEffect(() => {
    addEventListener("pagehide", clearLoginSecrets);
    return () => {
      loginAttempt.current++;
      removeEventListener("pagehide", clearLoginSecrets);
    };
  }, [clearLoginSecrets]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const loginForm = (
        <section className="login-form">
          {challenge ? (
            <MfaChallenge
              challenge={challenge}
              onCancel={clearLoginSecrets}
              onLogin={(nextSession) => {
                clearLoginSecrets();
                onLogin(nextSession);
              }}
            />
          ) : (
            <>
              <h2>{t("স্বাগতম")}</h2>
              <p>{t("Sign in to your workspace")}</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setShowPassword(false);
                  const attempt = ++loginAttempt.current;
                  run(async () => {
                    const nextSession = await api("/auth/login", "POST", {
                      email,
                      password,
                    });
                    setPassword("");
                    if (attempt !== loginAttempt.current) return;
                    if (nextSession.mfaRequired === true) {
                      if (
                        typeof nextSession.challengeToken !== "string" ||
                        !nextSession.challengeToken ||
                        !Number.isFinite(Date.parse(nextSession.expiresAt))
                      )
                        throw new Error(
                          choose({
                            bn: "লগইন যাচাই শুরু হয়নি। আবার চেষ্টা করুন।",
                            en: "Sign-in verification could not start. Try again.",
                          }),
                        );
                      setChallenge(nextSession);
                    } else {
                      onLogin(nextSession);
                    }
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
                <div className="password-control">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="secondary"
                    aria-controls="password"
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword
                      ? choose({ bn: "লুকান", en: "Hide password" })
                      : choose({ bn: "দেখুন", en: "Show password" })}
                  </button>
                </div>
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
            </>
          )}
        </section>
  );
  // Phase 1: signed-out visitors get the new public home on "/"; other public pages stay legacy for now.
  if (location.pathname === "/") return <AsyncPanel><PublicHome login={loginForm} /></AsyncPanel>;
  return <PublicPortal onNavigate={clearLoginSecrets} login={loginForm} />;
}

function SessionApp() {
  const [session, setSession] = useState<any>(null);
  const [loaded, setLoaded] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [pendingPaymentReturn, setPendingPaymentReturn] = useState(
    paymentReturnApplication,
  );
  useEffect(() => {
    let active = true;
    api("/auth/me")
      .then((result) => {
        if (active) setSession(result);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);
  if (!loaded) return <LoadingPanel />;
  if (!session)
    return <SignedOutPortal onLogin={setSession} prefillDemo={!signedOut} />;
  return (
    <AsyncPanel>
      <WorkspaceApp
        session={session}
        onSignOut={() => {
          setSignedOut(true);
          setSession(null);
        }}
        paymentReturnApplication={pendingPaymentReturn}
        onPaymentReturnHandled={() => setPendingPaymentReturn(null)}
      />
    </AsyncPanel>
  );
}

// Phase 1 slice (i), approved: the new public home (loaded on demand).
const PublicHome = lazy(() =>
  import("./PublicHome.js").then((module) => ({ default: module.PublicHome })),
);

if (location.pathname === "/home-preview") history.replaceState({}, "", "/");

function App() {
  const publicToken = location.pathname.startsWith("/verify/")
    ? location.pathname.split("/")[2]
    : null;
  return publicToken ? (
    <CertificateVerification publicToken={publicToken} />
  ) : (
    <SessionApp />
  );
}

createRoot(document.getElementById("root")!).render(
  <AsyncPanel>
    <App />
  </AsyncPanel>,
);
