import React, { lazy, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, adoptSession, clearSessionToken } from "./api.js";
import { t, tx, choose, useLanguage } from "./i18n.js";
const PublicPortal = lazy(() =>
  import("./PublicPortal.js").then((module) => ({
    default: module.PublicPortal,
  })),
);
import { VERIFY_SEO } from "./seo/service-seo.js";
import { applyPageHead } from "./seo/head.js";
import { IssuanceModeProvider } from "./mode.js";
import { applicationStatusMeta } from "./ui/kit.js";
import { formatDateTime } from "./ui/fmt.js";
import { SampleCertificate } from "./TrustVisual.js";
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
/** FULL-UIUX-01 (A14/P2-13): a bare /payments/return (no valid application
    reference) used to be silently rewritten to /login, stranding the payer
    with no explanation. It now renders an explanation view in the shell. */
const barePaymentReturn =
  location.pathname === "/payments/return" && !paymentReturnApplication;
if (location.pathname === "/payments/return" && paymentReturnApplication) {
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
  const [language] = useLanguage();
  // SEO D1: the /verify landing is indexable; individual verification
  // result URLs (token / by-number) are utility results — noindex.
  useEffect(() => {
    applyPageHead({
      title: VERIFY_SEO.title[language],
      description: VERIFY_SEO.description[language],
      canonicalPath: "/verify",
      robots: "noindex, follow",
    });
  }, [language]);
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
  /* FULL-UIUX-01 (A8): the result renders inside the one public shell —
     no second brand header, no duplicate language switcher; the status is
     the shared badge language and the date the shared formatter. */
  return (
    <div className="ax-container public-verify-wrap">
      <div className="public-tool-grid">
        <section className="panel">
          <span className="eyebrow">
            {choose({ bn: "সর্বজনীন যাচাই", en: "Public verification" })}
          </span>
          <h1>{choose({ bn: "সনদ যাচাই", en: "Verify certificate" })}</h1>
          {tx(
            verification ? (
              <>
                <p>
                  <span
                    className={`ax-status tone-${applicationStatusMeta(String(verification.status ?? "")).tone}`}
                  >
                    <span className="ax-status-dot" aria-hidden="true" />
                    {choose(applicationStatusMeta(String(verification.status ?? "")))}
                  </span>
                </p>
                <dl>
                  {tx(
                    [
                      [
                        choose({ bn: "অফিস", en: "Office" }),
                        choose({
                          bn: verification.officeBn,
                          en: verification.officeEn,
                        }),
                      ],
                      [
                        choose({ bn: "সেবা", en: "Service" }),
                        choose({
                          bn: verification.serviceBn,
                          en: verification.serviceEn,
                        }),
                      ],
                      [
                        choose({ bn: "ইস্যুর তারিখ", en: "Issued on" }),
                        formatDateTime(verification.issuedAt, language),
                      ],
                    ].map(([label, content]) => (
                      <React.Fragment key={label}>
                        <dt>{label}</dt>
                        <dd>{content}</dd>
                      </React.Fragment>
                    )),
                  )}
                </dl>
                <p className="hint">
                  {choose({
                    bn: "এই ফলাফল প্ল্যাটফর্মের নথির সঙ্গে মিলিয়ে দেখানো হয়েছে। নাম বা আবেদনের বিবরণ সর্বজনীন যাচাইয়ে দেখানো হয় না।",
                    en: "This result was matched against the platform's record. Names and application details are never shown in public verification.",
                  })}
                </p>
              </>
            ) : (
              <p role="alert">
                {tx(
                  publicError ||
                    choose({ bn: "সনদ যাচাই করা হচ্ছে…", en: "Checking certificate…" }),
                )}
              </p>
            ),
          )}
        </section>
        <div className="public-tool-visual">
          <SampleCertificate compact />
          {/* REFINEMENT-02 P1-12: the side column teaches where the two
              inputs live on the real certificate, plus a help row. */}
          <div className="tool-need">
            <h2>{choose({ bn: "কী লাগবে", en: "What you need" })}</h2>
            <ul>
              <li>
                {choose({
                  bn: "সনদ নম্বর — সনদের উপরে থাকা ১৬ সংখ্যার নম্বরটি (উপরে নমুনায় দেখানো)।",
                  en: "The certificate number — the 16 digits at the top of the certificate (shown in the sample above).",
                })}
              </li>
              <li>
                {choose({
                  bn: "অথবা QR কোড — ফোনের ক্যামেরা দিয়ে স্ক্যান করলেই যাচাইয়ের ফলাফল খুলবে।",
                  en: "Or the QR code — scan it with a phone camera and the result opens directly.",
                })}
              </li>
            </ul>
            <p>
              {choose({
                bn: "নম্বর মিলছে না? ",
                en: "Number not matching? ",
              })}
              <a href="/#offices">
                {choose({ bn: "ইস্যুকারী অফিসে যোগাযোগ করুন", en: "Contact the issuing office" })}
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
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
                    className="password-toggle"
                    aria-controls="password"
                    aria-pressed={showPassword}
                    aria-label={
                      showPassword
                        ? choose({ bn: "পাসওয়ার্ড লুকান", en: "Hide password" })
                        : choose({ bn: "পাসওয়ার্ড দেখুন", en: "Show password" })
                    }
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {/* P2-8: a 44px icon-button inside the input's edge. */}
                    <svg
                      viewBox="0 0 24 24"
                      width="20"
                      height="20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
                      <circle cx="12" cy="12" r="3" />
                      {showPassword && <path d="M4 4l16 16" />}
                    </svg>
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
  // BUNDLE06-R5 D3: in-memory record that this page lifetime's last
  // probe came back anonymous. The mount probe is session restore and
  // must stay (a browser can hold a valid cookie with no client-side
  // trace of it — e.g. a copied session, cleared storage, or a fresh
  // profile), so the anonymous 401 on first load cannot be removed
  // client-side without breaking restore. What CAN go is the repeat
  // noise: focus / visibility re-probes for a shell already proven
  // anonymous. A persistent client hint was rejected deliberately:
  // the product stores nothing in localStorage except astra.language
  // (enforced by the MFA browser test), so no storage-based hint may
  // be added. A server-set, JS-readable marker cookie would remove
  // even the first-load 401 — offered as a follow-up, not done here.
  const anonymousRef = useRef(false);
  // Phase 5 (5A): identity is revalidated, not read once at boot. The browser cookie is the
  // only session truth, and another sign-in in the same browser replaces it — so the shell
  // re-reads /auth/me when the tab regains focus, becomes visible again, or the API client
  // reports a session change. When the account (or its office) differs, the workspace is
  // remounted for the account that is actually signed in (see the key below), so a tab can
  // never keep one account's shell over another account's data — the live "identity flip".
  const checkSession = useCallback(
    async (reason: "mount" | "revalidate" = "mount") => {
      // BUNDLE06-R5 D3: a revalidate (focus / visibility) for a shell
      // already proven anonymous in this page lifetime skips the probe
      // — it can only repeat the same 401. Mounts and session-change
      // events always probe, so session restore is unchanged.
      if (
        reason === "revalidate" &&
        !sessionRef.current &&
        anonymousRef.current
      ) {
        if (!loadedRef.current) {
          loadedRef.current = true;
          setLoaded(true);
        }
        return;
      }
      try {
        const response = await fetch("/api/v1/auth/me", {
          credentials: "include",
        });
        // Always consume the body, including on 401: an unread body leaves the request
        // open in the browser's network stack and can stall connection reuse (found by
        // the platform browser test — the portal never reached network idle).
        const result = await response.json().catch(() => null);
        if (!response.ok || !result) {
          if (response.status === 401) clearSessionToken();
          if (!sessionRef.current) anonymousRef.current = true;
          if (sessionRef.current) {
            sessionRef.current = null;
            setSession(null);
          }
          return;
        }
        anonymousRef.current = false;
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
    void checkSession("mount");
    const revalidate = () => void checkSession("revalidate");
    const forceRevalidate = () => void checkSession("mount");
    const onVisibility = () => {
      if (document.visibilityState === "visible")
        void checkSession("revalidate");
    };
    addEventListener("focus", revalidate);
    addEventListener("astra:session-changed", forceRevalidate);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      removeEventListener("focus", revalidate);
      removeEventListener("astra:session-changed", forceRevalidate);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [checkSession]);
  if (!loaded) return <LoadingPanel />;
  if (!session)
    return (
      <SignedOutPortal
        onLogin={(next) => {
          anonymousRef.current = false;
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

// FULL-UIUX-01 (A14): /home-preview no longer silently redirects — an
// unknown address gets the portal's standard not-found view.

// Phase UX: the verify pages live inside the public shell, loaded lazily so
// the shell stays out of the initial bundle (performance budget).
const VerifyShell = lazy(() =>
  import("./PublicShell.js").then((module) => ({
    default: ({ children }: { children: React.ReactNode }) => (
      <module.PublicShell current="/verify">{children}</module.PublicShell>
    ),
  })),
);
const BareShell = lazy(() =>
  import("./PublicShell.js").then((module) => ({
    default: ({ children }: { children: React.ReactNode }) => (
      <module.PublicShell current="">{children}</module.PublicShell>
    ),
  })),
);

/** FULL-UIUX-01 (A14/P2-13): the bare payment-return explanation. */
function PaymentReturnNotice() {
  useLanguage();
  return (
    <div className="ax-container">
      <section className="panel narrow">
        <h1>
          {choose({
            bn: "পেমেন্ট পৃষ্ঠা থেকে ফিরে এসেছেন",
            en: "You have returned from a payment page",
          })}
        </h1>
        <p>
          {choose({
            bn: "শুধু পেমেন্ট পৃষ্ঠা থেকে ফিরে আসা মানেই পেমেন্ট সম্পন্ন হয়েছে — এমনটি নয়। এই লিংকে কোনো নির্দিষ্ট আবেদন চেনা যায়নি, তাই এখানে কোনো অবস্থা দেখানো যাচ্ছে না।",
            en: "Returning from a payment page does not by itself mean a payment was completed. This link did not identify a specific application, so no status can be shown here.",
          })}
        </p>
        <p>
          {choose({
            bn: "আপনার আবেদনের সর্বশেষ অবস্থা দেখতে লগইন করুন, অথবা আবেদনের রেফারেন্স নম্বর দিয়ে অবস্থা পৃষ্ঠায় খুঁজুন। পেমেন্ট সফল হলে তা আবেদনের পেমেন্ট ইতিহাসে দেখা যাবে।",
            en: "Sign in to see your application's latest status, or look it up on the tracking page with the application reference. A successful payment appears in the application's payment history.",
          })}
        </p>
        <p className="payment-return-actions">
          <a className="button" href="/login">
            {choose({ bn: "লগইন করুন", en: "Sign in" })}
          </a>{" "}
          <a className="button secondary" href="/tracking">
            {choose({ bn: "আবেদনের অবস্থা দেখুন", en: "Track an application" })}
          </a>
        </p>
      </section>
    </div>
  );
}

function App() {
  if (barePaymentReturn)
    return (
      <AsyncPanel>
        <BareShell>
          <PaymentReturnNotice />
        </BareShell>
      </AsyncPanel>
    );
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
