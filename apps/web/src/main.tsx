import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, adoptSession, clearSessionToken } from "./api.js";
import { t, tx, choose, useLanguage } from "./i18n.js";
const PublicPortal = lazyWithRetry(() => import("./PublicPortal.js"), (module) => module.PublicPortal);
import { VERIFY_SEO } from "./seo/service-seo.js";
import { applyPageHead } from "./seo/head.js";
import { IssuanceModeProvider } from "./mode.js";
import { applicationStatusMeta } from "./ui/kit.js";
import { formatDateTime } from "./ui/fmt.js";
import { AsyncPanel, LoadingPanel, lazyWithRetry } from "./AsyncPanel.js";
import { MfaChallenge, type MfaLoginChallenge } from "./MfaChallenge.js";
import "./fonts.css";
import "./style.css";

// Authenticated workflows and form history are downloaded only after a valid session.
const WorkspaceApp = lazyWithRetry(() => import("./WorkspaceApp.js"), (module) => module.WorkspaceApp);
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
                {/* HOME-REDESIGN-01: the answer first, in one sentence a bank
                    clerk can act on — valid, revoked or demo — with colour,
                    icon and words all saying the same thing. */}
                {(() => {
                  const status = String(verification.status ?? "");
                  const verdict = verification.demo
                    ? "demo"
                    : status === "ISSUED"
                      ? "valid"
                      : status === "REVOKED"
                        ? "revoked"
                        : "other";
                  const head =
                    verdict === "valid"
                      ? { bn: "সনদটি বৈধ", en: "This certificate is valid" }
                      : verdict === "revoked"
                        ? { bn: "এই সনদ প্রত্যাহার করা হয়েছে", en: "This certificate has been revoked" }
                        : verdict === "demo"
                          ? { bn: "এই সনদটি সরকারি নয়", en: "This is not an official certificate" }
                          : applicationStatusMeta(status);
                  const sub =
                    verdict === "valid"
                      ? { bn: "ইস্যুকারী অফিসের নথির সঙ্গে মিলেছে। নিচের তথ্য কাগজের সনদের সঙ্গে মিলিয়ে নিন।", en: "It matches the issuing office's record. Compare the details below with the paper." }
                      : verdict === "revoked"
                        ? { bn: "ইস্যুকারী অফিস সনদটি বাতিল করেছে। দাপ্তরিক কাজে এটি গ্রহণ করবেন না।", en: "The issuing office withdrew it. Do not accept it for official use." }
                        : verdict === "demo"
                          ? { bn: "পরীক্ষার জন্য তৈরি। দাপ্তরিক কাজে এটি বৈধ নয়।", en: "Made for testing. It is not valid for official use." }
                          : { bn: "বিস্তারিত জানতে ইস্যুকারী অফিসে যোগাযোগ করুন।", en: "Contact the issuing office for details." };
                  return (
                    <div className={`verify-verdict is-${verdict}`} role="status">
                      <span className="verify-verdict-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                          {verdict === "valid" ? (
                            <path d="m5 12.5 4.5 4.5L19 7.5" />
                          ) : verdict === "revoked" ? (
                            <path d="M7 7l10 10M17 7 7 17" />
                          ) : (
                            <path d="M12 7v6M12 16.5v.5" />
                          )}
                        </svg>
                      </span>
                      <div>
                        <strong>{choose(head)}</strong>
                        <p>{choose(sub)}</p>
                      </div>
                    </div>
                  );
                })()}
                <dl className="verify-facts">
                  {certificateNumber && (
                    <>
                      <dt>{choose({ bn: "সনদ নম্বর", en: "Certificate number" })}</dt>
                      <dd className="verify-facts-number">{certificateNumber}</dd>
                    </>
                  )}
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
                      // QA-06: a partly masked holder name to compare with the
                      // paper, and a clear warning for demo-mode documents.
                      ...(verification.holderMaskedBn
                        ? [
                            [
                              choose({ bn: "সনদধারী (আংশিক)", en: "Holder (partial)" }),
                              choose({
                                bn: verification.holderMaskedBn,
                                en: verification.holderMaskedEn ?? verification.holderMaskedBn,
                              }),
                            ],
                          ]
                        : []),
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
                    bn: "এই ফলাফল প্ল্যাটফর্মের নথির সঙ্গে মিলিয়ে দেখানো হয়েছে। সনদধারীর নাম আংশিক দেখানো হয় — কাগজের সনদের নামের সঙ্গে মিলিয়ে নিন। পুরো নাম বা আবেদনের বিবরণ দেখানো হয় না।",
                    en: "This result was matched against the platform's record. The holder name is partly masked — compare it with the name on the paper. Full names and application details are never shown.",
                  })}
                </p>
                <a className="button secondary" href="/verify">
                  {choose({ bn: "আরেকটি সনদ যাচাই করুন", en: "Check another certificate" })}
                </a>
              </>
            ) : publicError ? (
              /* DESIGN-PHASE-C: a failed lookup is an error panel with a
                 retry action — it was one plain line of body text with no
                 way back to the form. */
              <div className="verify-result-error" role="alert">
                <svg
                  viewBox="0 0 24 24"
                  width="22"
                  height="22"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 3 2.5 20h19L12 3Z" />
                  <path d="M12 10v4" />
                  <circle cx="12" cy="17" r="0.5" fill="currentColor" />
                </svg>
                <div>
                  <p>{tx(publicError)}</p>
                  <a className="button secondary" href="/verify">
                    {choose({ bn: "আরেকটি সনদ যাচাই করুন", en: "Check another certificate" })}
                  </a>
                </div>
              </div>
            ) : (
              <p role="status" className="verify-checking">
                {choose({ bn: "সনদ যাচাই করা হচ্ছে…", en: "Checking certificate…" })}
              </p>
            ),
          )}
        </section>
        <div className="public-tool-visual">
          {/* REFINEMENT-02 P1-12: the side column teaches where the two
              inputs live on the real certificate, plus a help row. */}
          <div className="tool-need">
            <h2>{choose({ bn: "কী লাগবে", en: "What you need" })}</h2>
            <ul>
              <li>
                {choose({
                  bn: "সনদ নম্বর — সনদের উপরে থাকা ১৬ সংখ্যার নম্বরটি।",
                  en: "The certificate number — the 16 digits at the top of the certificate.",
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

function takeLoginPrefill(): { type: "email" | "mobile"; identifier: string } | null {
  try {
    const raw = sessionStorage.getItem("du.loginPrefill");
    sessionStorage.removeItem("du.loginPrefill");
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && (parsed.type === "email" || parsed.type === "mobile") && typeof parsed.identifier === "string"
      ? parsed
      : null;
  } catch {
    return null;
  }
}
function SignedOutPortal({
  onLogin,
}: {
  onLogin: (session: any) => void;
}) {
  useLanguage();
  // REG-UX Phase 1: the signup screen hands over how the new account signs in
  // (mobile or email), so the citizen lands on a prefilled sign-in form.
  // The form may already be mounted when signup finishes, so the handoff is also
  // delivered as a "du:login-prefill" event (see rememberLoginPrefill).
  const [loginPrefill] = useState(takeLoginPrefill);
  const [email, setEmail] = useState(loginPrefill?.identifier ?? "");
  useEffect(() => {
    const apply = () => {
      const next = takeLoginPrefill();
      if (!next) return;
      setIdentifierType(next.type);
      setEmail(next.identifier);
    };
    addEventListener("du:login-prefill", apply);
    return () => removeEventListener("du:login-prefill", apply);
  }, []);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // Phase 2b: sign in with email (default, unchanged) or a mobile/NID/birth-registration number.
  const [identifierType, setIdentifierType] = useState<"email" | "mobile" | "nid" | "birth_reg">(
    loginPrefill?.type ?? "email",
  );
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
                    // PORTAL-B: the default field takes an email OR a mobile
                    // number — most citizens register with a mobile only.
                    const mobile = identifierType === "email" ? bdMobile(email) : null;
                    const nextSession = await api(
                      "/auth/login",
                      "POST",
                      mobile
                        ? { identifierType: "mobile", identifier: mobile, password }
                        : identifierType === "email"
                          ? { email: email.trim(), password }
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
                  <option value="email">{choose({ bn: "ইমেইল বা মোবাইল", en: "Email or mobile" })}</option>
                  <option value="mobile">{choose({ bn: "মোবাইল নম্বর", en: "Mobile number" })}</option>
                  <option value="nid">{choose({ bn: "জাতীয় পরিচয়পত্র (NID)", en: "National ID (NID)" })}</option>
                  <option value="birth_reg">{choose({ bn: "জন্ম নিবন্ধন নম্বর", en: "Birth registration number" })}</option>
                </select>
                <label htmlFor="email">
                  {identifierType === "email"
                    ? choose({ bn: "ইমেইল বা মোবাইল নম্বর", en: "Email or mobile number" })
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
                  type="text"
                  inputMode={identifierType === "email" ? "text" : "numeric"}
                  autoCapitalize="none"
                  spellCheck={false}
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
 * PORTAL-B: a Bangladeshi mobile number typed into the email-or-mobile
 * field, as the 11-digit local form (01XXXXXXXXX) the account stores, or
 * null. Accepts Bengali digits, spaces, dashes and a +88 / 88 prefix.
 */
function bdMobile(value: string): string | null {
  const digits = value
    .trim()
    .replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d)))
    .replace(/[\s-]/g, "");
  const match = /^(?:\+?88)?(01\d{9})$/.exec(digits);
  return match ? match[1] : null;
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

/**
 * PORTAL-C: the signed-in workspace lives at "/" (see onLogin). When that
 * session ends — sign-out here or elsewhere — the same place shows the
 * sign-in form again, in place and without navigation, as it did when the
 * workspace sat on /login. Public pages (/verify, /tracking …) stay put.
 */
function showSignInAfterSession() {
  if (location.pathname === "/") history.replaceState(history.state, "", "/login");
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
        if (response.ok && result && !result.user) {
          // QAFIX-09 (B3): the server answers a cookie-less probe
          // with an anonymous 200 (user: null) — there is no
          // session to restore and no error to surface. A tab that
          // still holds a session drops to sign-in exactly as it
          // did on the old 401 (the cookie vanished elsewhere).
          if (!sessionRef.current) anonymousRef.current = true;
          if (sessionRef.current) {
            showSignInAfterSession();
            sessionRef.current = null;
            setSession(null);
          }
          return;
        }
        if (!response.ok || !result) {
          if (response.status === 401) clearSessionToken();
          if (!sessionRef.current) anonymousRef.current = true;
          if (sessionRef.current) {
            showSignInAfterSession();
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
  // QA-04: public tools stay public for signed-in users too. Officers verify
  // certificates and track applications while signed in; before this, every
  // path rendered the workspace (e.g. /verify became /verify#/pending).
  if (!session || PUBLIC_WHILE_SIGNED_IN.test(location.pathname))
    return (
      <SignedOutPortal
        onLogin={(next) => {
          // PORTAL-C: the workspace routes by hash; after signing in on
          // /login (or /register) the address no longer says "login".
          if (/^\/(login|register)\/?$/.test(location.pathname))
            history.replaceState(history.state, "", `/${location.hash}`);
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
          showSignInAfterSession();
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
const PublicHome = lazyWithRetry(() => import("./PublicHome.js"), (module) => module.PublicHome);
const OfficeRegistrationPage = lazyWithRetry(
  () => Promise.all([import("./PublicShell.js"), import("./OfficeRegistration.js")]),
  ([shell, page]) => () => (
    <shell.PublicShell current="/register-office">
      <page.OfficeRegistration />
    </shell.PublicShell>
  ),
  // M-003: no cache-busting retry — a two-module load cannot be busted
  // from the single failed URL in the import error, so this degrades to
  // the boundary panel + Reload, as before.
  { bust: false },
);

// FULL-UIUX-01 (A14): /home-preview no longer silently redirects — an
// unknown address gets the portal's standard not-found view.

// Phase UX: the verify pages live inside the public shell, loaded lazily so
// the shell stays out of the initial bundle (performance budget).
const VerifyShell = lazyWithRetry(
  () => import("./PublicShell.js"),
  (module) => ({ children }: { children: React.ReactNode }) => (
    <module.PublicShell current="/verify">{children}</module.PublicShell>
  ),
);
const BareShell = lazyWithRetry(
  () => import("./PublicShell.js"),
  (module) => ({ children }: { children: React.ReactNode }) => (
    <module.PublicShell current="">{children}</module.PublicShell>
  ),
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

/** QA-04: pages that render the public portal even when a session exists. */
const PUBLIC_WHILE_SIGNED_IN =
  /^\/(verify|tracking|services|offices|notices|help|guide|policies)(\/|$)/;

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
