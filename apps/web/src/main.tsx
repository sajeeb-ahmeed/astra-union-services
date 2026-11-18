import React, { lazy, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, adoptSession } from "./api.js";
import { t, tx, choose, useLanguage, LanguageSwitcher } from "./i18n.js";
const PublicPortal = lazy(() =>
  import("./PublicPortal.js").then((module) => ({
    default: module.PublicPortal,
  })),
);
import { IssuanceModeProvider } from "./mode.js";
import emblem from "./assets/brand/emblem.webp";
import { AsyncPanel, LoadingPanel } from "./AsyncPanel.js";
import { MfaChallenge, type MfaLoginChallenge } from "./MfaChallenge.js";
import "./fonts.css";
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
function CertificateVerification({
  publicToken,
  certificateNumber,
}: {
  publicToken?: string;
  certificateNumber?: string;
}) {
  useLanguage();
  const [verification, setVerification] = useState<any>(null);
  const [publicError, setPublicError] = useState("");
  useEffect(() => {
    let active = true;
    // Phase Y: official-format documents print /verify?searchText={certificateNo};
    // that resolves through the by-number lookup, the QR link through the token.
    const request = certificateNumber
      ? api(`/verify/by-number/${encodeURIComponent(certificateNumber)}`)
      : api(`/verify/${encodeURIComponent(publicToken ?? "")}`);
    request
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
  }, [publicToken, certificateNumber]);
  return (
    <main className="public-verify">
      <a className="brand" href="/">
        <img src={emblem} alt="" width={44} height={44} />
        <span>DigitalUnion</span>
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
}: {
  onLogin: (session: any) => void;
}) {
  useLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // Phase 2b: sign in with email (default, unchanged) or a mobile/NID/birth-registration number.
  const [identifierType, setIdentifierType] = useState<"email" | "mobile" | "nid" | "birth_reg">("email");
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
      setMessage(humanSignInError(error));
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
                    const nextSession = await api(
                      "/auth/login",
                      "POST",
                      identifierType === "email"
                        ? { email, password }
                        : { identifierType, identifier: email, password },
                    );
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
                <label htmlFor="login-identifier-type">
                  {choose({ bn: "যা দিয়ে লগইন করবেন", en: "Sign in with" })}
                </label>
                <select
                  id="login-identifier-type"
                  value={identifierType}
                  onChange={(e) => {
                    setIdentifierType(e.target.value as typeof identifierType);
                    setEmail("");
                  }}
                >
                  <option value="email">{choose({ bn: "ইমেইল", en: "Email" })}</option>
                  <option value="mobile">{choose({ bn: "মোবাইল নম্বর", en: "Mobile number" })}</option>
                  <option value="nid">{choose({ bn: "জাতীয় পরিচয়পত্র (NID)", en: "National ID (NID)" })}</option>
                  <option value="birth_reg">{choose({ bn: "জন্ম নিবন্ধন নম্বর", en: "Birth registration number" })}</option>
                </select>
                <label htmlFor="email">
                  {identifierType === "email"
                    ? t("Email")
                    : choose(
                        {
                          mobile: { bn: "মোবাইল নম্বর", en: "Mobile number" },
                          nid: { bn: "NID নম্বর", en: "NID number" },
                          birth_reg: { bn: "জন্ম নিবন্ধন নম্বর", en: "Birth registration number" },
                        }[identifierType],
                      )}
                </label>
                <input
                  id="email"
                  type={identifierType === "email" ? "email" : "text"}
                  inputMode={identifierType === "email" ? "email" : "numeric"}
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
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
            </>
          )}
        </section>
  );
  // Phase 1: signed-out visitors get the new public home on "/"; other public pages stay legacy for now.
  if (location.pathname === "/") return <AsyncPanel><PublicHome login={loginForm} /></AsyncPanel>;
  // Phase 2d: office staff ask for an account for their post.
  if (location.pathname === "/register-office")
    return (
      <AsyncPanel>
        <OfficeRegistrationPage />
      </AsyncPanel>
    );
  return (
    <AsyncPanel>
      <PublicPortal onNavigate={clearLoginSecrets} login={loginForm} />
    </AsyncPanel>
  );
}

/**
 * Phase UX: sign-in failures in plain language with the fix, in the reader's
 * language — never a raw server sentence. Unknown errors pass through as-is.
 */
function humanSignInError(error: unknown): string {
  const err = error as any;
  const code = String(err?.details?.error?.code ?? "");
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (code === "INVALID_LOGIN" || /invalid sign-in credentials/i.test(message))
    return choose({
      bn: "ইমেইল/নম্বর বা পাসওয়ার্ড মিলছে না। ঠিকভাবে লিখে আবার চেষ্টা করুন।",
      en: "Your email/number or password does not match. Check it and try again.",
    });
  if (code === "RATE_LIMIT" || err?.status === 429)
    return choose({
      bn: "অনেকবার ভুল চেষ্টা করা হয়েছে। পাঁচ মিনিট অপেক্ষা করে আবার চেষ্টা করুন।",
      en: "Too many attempts. Wait five minutes, then try again.",
    });
  return message;
}

function SessionApp() {
  const [session, setSession] = useState<any>(null);
  const [loaded, setLoaded] = useState(false);
  const [pendingPaymentReturn, setPendingPaymentReturn] = useState(
    paymentReturnApplication,
  );
  const sessionRef = useRef<any>(null);
  const loadedRef = useRef(false);
  // Phase 5 (5A): identity is revalidated, not read once at boot. The browser cookie is the
  // only session truth, and another sign-in in the same browser replaces it — so the shell
  // re-reads /auth/me when the tab regains focus, becomes visible again, or the API client
  // reports a session change. When the account (or its office) differs, the workspace is
  // remounted for the account that is actually signed in (see the key below), so a tab can
  // never keep one account's shell over another account's data — the live "identity flip".
  const checkSession = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/auth/me", {
        credentials: "include",
      });
      // Always consume the body, including on 401: an unread body leaves the request
      // open in the browser's network stack and can stall connection reuse (found by
      // the platform browser test — the portal never reached network idle).
      const result = await response.json().catch(() => null);
      if (!response.ok || !result) {
        if (sessionRef.current) {
          sessionRef.current = null;
          setSession(null);
        }
        return;
      }
      adoptSession(result);
      const current = sessionRef.current;
      if (
        !current ||
        current.user?.id !== result.user?.id ||
        current.user?.tenantId !== result.user?.tenantId
      ) {
        sessionRef.current = result;
        setSession(result);
      }
    } catch {
      // A network failure proves nothing about the session; keep the current state.
    } finally {
      if (!loadedRef.current) {
        loadedRef.current = true;
        setLoaded(true);
      }
    }
  }, []);
  useEffect(() => {
    void checkSession();
    const revalidate = () => void checkSession();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void checkSession();
    };
    addEventListener("focus", revalidate);
    addEventListener("astra:session-changed", revalidate);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      removeEventListener("focus", revalidate);
      removeEventListener("astra:session-changed", revalidate);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [checkSession]);
  if (!loaded) return <LoadingPanel />;
  if (!session)
    return (
      <SignedOutPortal
        onLogin={(next) => {
          sessionRef.current = next;
          setSession(next);
        }}
      />
    );
  return (
    <AsyncPanel>
      <WorkspaceApp
        key={`${session.user.id}:${session.user.tenantId ?? ""}`}
        session={session}
        onSignOut={() => {
          sessionRef.current = null;
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
const OfficeRegistrationPage = lazy(() =>
  Promise.all([import("./PublicShell.js"), import("./OfficeRegistration.js")]).then(([shell, page]) => ({
    default: () => (
      <shell.PublicShell current="/register-office">
        <page.OfficeRegistration />
      </shell.PublicShell>
    ),
  })),
);

if (location.pathname === "/home-preview") history.replaceState({}, "", "/");

// Phase UX: the verify pages live inside the public shell, loaded lazily so
// the shell stays out of the initial bundle (performance budget).
const VerifyShell = lazy(() =>
  import("./PublicShell.js").then((module) => ({
    default: ({ children }: { children: React.ReactNode }) => (
      <module.PublicShell current="/verify">{children}</module.PublicShell>
    ),
  })),
);

function App() {
  const publicToken = location.pathname.startsWith("/verify/")
    ? location.pathname.split("/")[2]
    : null;
  const certificateNumber =
    location.pathname === "/verify"
      ? new URLSearchParams(location.search).get("searchText")
      : null;
  return publicToken ? (
    <AsyncPanel>
      <VerifyShell>
        <CertificateVerification publicToken={publicToken} />
      </VerifyShell>
    </AsyncPanel>
  ) : certificateNumber ? (
    <AsyncPanel>
      <VerifyShell>
        <CertificateVerification certificateNumber={certificateNumber} />
      </VerifyShell>
    </AsyncPanel>
  ) : (
    <SessionApp />
  );
}

createRoot(document.getElementById("root")!).render(
  <AsyncPanel>
    <IssuanceModeProvider>
      <App />
    </IssuanceModeProvider>
  </AsyncPanel>,
);
