import { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { choose, useLanguage } from "./i18n.js";

export type MfaLoginChallenge = {
  mfaRequired: true;
  challengeToken: string;
  expiresAt: string;
};

/** Localised messages never display submitted codes or server diagnostics. */
export function mfaErrorMessage(error: unknown): string {
  const code = (error as any)?.details?.error?.code ?? "";
  const status = (error as any)?.status;
  if (status === 429 || code === "MFA_RATE_LIMIT")
    return choose({
      bn: "অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ অপেক্ষা করে আবার চেষ্টা করুন।",
      en: "Too many attempts. Wait a little before trying again.",
    });
  if (status === 503 || code === "MFA_UNAVAILABLE")
    return choose({
      bn: "দুই ধাপের নিরাপত্তা এখন ব্যবহার করা যাচ্ছে না। কিছুক্ষণ পর চেষ্টা করুন বা সহায়তা নিন।",
      en: "Two-step security is unavailable. Try again later or contact support.",
    });
  if (
    [
      "MFA_CHALLENGE_EXPIRED",
      "MFA_CHALLENGE_INVALID",
      "SESSION_INACTIVE",
    ].includes(code)
  )
    return choose({
      bn: "এই লগইনের মেয়াদ শেষ হয়েছে। ফিরে গিয়ে আবার লগইন করুন।",
      en: "This sign-in has expired. Go back and sign in again.",
    });
  if (["MFA_ENROLLMENT_EXPIRED", "MFA_ENROLLMENT_REQUIRED"].includes(code))
    return choose({
      bn: "সেটআপের মেয়াদ শেষ হয়েছে। ফিরে গিয়ে নতুন সেটআপ শুরু করুন।",
      en: "Setup has expired. Go back and start a new setup.",
    });
  if (
    [
      "CURRENT_PASSWORD_INVALID",
      "INVALID_PASSWORD",
      "PASSWORD_INVALID",
      "PASSWORD_MISMATCH",
    ].includes(code)
  )
    return choose({
      bn: "বর্তমান পাসওয়ার্ডটি সঠিক হয়নি। আবার দিন।",
      en: "The current password is incorrect. Please try again.",
    });
  if (code === "MFA_CODE_INVALID")
    return choose({
      bn: "কোডটি সঠিক নয়, মেয়াদ শেষ হয়েছে বা আগে ব্যবহার হয়েছে। Authenticator-এর পরের ৩০ সেকেন্ডের নতুন কোড অথবা অব্যবহৃত recovery code দিন।",
      en: "This code is incorrect, expired or already used. Wait for the authenticator's next 30-second code, or use an unused recovery code.",
    });
  return choose({
    bn: "যাচাই করা যায়নি। পাসওয়ার্ড ও কোড পরীক্ষা করুন। Authenticator-এর নতুন কোড বা অব্যবহৃত recovery code দিয়ে চেষ্টা করুন।",
    en: "Verification failed. Check the password and code. Try a new authenticator code or an unused recovery code.",
  });
}

export function MfaChallenge({
  challenge,
  onLogin,
  onCancel,
}: {
  challenge: MfaLoginChallenge;
  onLogin: (session: any) => void;
  onCancel: () => void;
}) {
  useLanguage();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [expired, setExpired] = useState(
    () => Date.now() >= Date.parse(challenge.expiresAt),
  );
  const active = useRef(true);
  const requestGeneration = useRef(0);
  const codeInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    active.current = true;
    const hide = () => {
      requestGeneration.current++;
      setCode("");
      setBusy(false);
    };
    addEventListener("pagehide", hide);
    codeInput.current?.focus();
    const timer = setTimeout(
      () => {
        setExpired(true);
        setCode("");
      },
      Math.max(0, Date.parse(challenge.expiresAt) - Date.now()),
    );
    return () => {
      active.current = false;
      requestGeneration.current++;
      removeEventListener("pagehide", hide);
      clearTimeout(timer);
    };
  }, [challenge]);
  return (
    <div className="mfa-challenge" aria-busy={busy}>
      <h2>
        {choose({ bn: "লগইনের দ্বিতীয় ধাপ", en: "One more step to sign in" })}
      </h2>
      <p id="mfa-login-help">
        {choose({
          bn: "আপনার authenticator app-এর ৬ সংখ্যার কোড দিন। ফোন না থাকলে সংরক্ষিত recovery code ব্যবহার করুন।",
          en: "Enter the 6-digit code from your authenticator app. If you cannot use your phone, enter a saved recovery code.",
        })}
      </p>
      {expired ? (
        <p role="alert" className="error">
          {choose({
            bn: "এই লগইনের মেয়াদ শেষ হয়েছে। আবার শুরু করুন।",
            en: "This sign-in has expired. Start again.",
          })}
        </p>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            const generation = ++requestGeneration.current;
            const isCurrent = () =>
              active.current && generation === requestGeneration.current;
            setBusy(true);
            setError(null);
            try {
              const session = await api("/auth/mfa/verify", "POST", {
                challengeToken: challenge.challengeToken,
                code: code.trim(),
              });
              if (isCurrent()) {
                setCode("");
                onLogin(session);
              }
            } catch (reason) {
              if (isCurrent()) {
                setError(reason);
                setCode("");
                codeInput.current?.focus();
              }
            } finally {
              if (isCurrent()) setBusy(false);
            }
          }}
        >
          <label htmlFor="mfa-login-code">
            {choose({
              bn: "Authenticator বা recovery code",
              en: "Authenticator or recovery code",
            })}
          </label>
          <input
            id="mfa-login-code"
            ref={codeInput}
            type="text"
            autoComplete="one-time-code"
            autoCapitalize="off"
            spellCheck={false}
            maxLength={64}
            required
            aria-describedby="mfa-login-help"
            value={code}
            disabled={busy}
            onChange={(event) => setCode(event.target.value)}
          />
          {error !== null && (
            <p className="error" role="alert">
              {mfaErrorMessage(error)}
            </p>
          )}
          <button type="submit" disabled={busy || !code.trim()}>
            {busy
              ? choose({ bn: "যাচাই হচ্ছে…", en: "Verifying…" })
              : choose({ bn: "যাচাই করে লগইন", en: "Verify and sign in" })}
          </button>
        </form>
      )}
      <button
        type="button"
        className="text-button"
        disabled={busy}
        onClick={onCancel}
      >
        {choose({ bn: "← লগইনে ফিরে যান", en: "← Back to sign in" })}
      </button>
    </div>
  );
}
