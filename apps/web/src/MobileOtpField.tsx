import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { choose, useLanguage } from "./i18n.js";

export type VerifiedMobile = { mobile: string; otpToken: string };

/**
 * Phase 2c: add a mobile number to a new account by confirming a one-time code. Lives inside the
 * registration form, so every button here is type="button". Renders nothing when the server has no
 * OTP provider; registration then works without a mobile, as before.
 */
export function MobileOtpField({
  value,
  onChange,
}: {
  value: VerifiedMobile | null;
  onChange: (value: VerifiedMobile | null) => void;
}) {
  useLanguage();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [mobile, setMobile] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [waitUntil, setWaitUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    api("/auth/otp/status")
      .then((r) => setAvailable(!!r.available))
      .catch(() => setAvailable(false));
  }, []);
  useEffect(() => {
    if (waitUntil <= Date.now()) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [waitUntil]);
  if (!available) return null;
  const wait = Math.max(0, Math.ceil((waitUntil - now) / 1000));
  async function step(fn: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset className="mobile-otp">
      <legend>{choose({ bn: "মোবাইল নম্বর যাচাই (ঐচ্ছিক)", en: "Verify a mobile number (optional)" })}</legend>
      <p className="hint">
        {choose({
          bn: "যাচাই করা মোবাইল নম্বর দিয়ে পরে লগইনও করতে পারবেন। কোডটি SMS-এ যাবে।",
          en: "A verified mobile number can also be used to sign in later. The code is sent by SMS.",
        })}
      </p>
      {value ? (
        <p role="status" className="mobile-otp-done">
          {choose({ bn: "যাচাই হয়েছে: ", en: "Verified: " })}
          <strong>{value.mobile}</strong>{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => {
              onChange(null);
              setChallenge(null);
              setCode("");
            }}
          >
            {choose({ bn: "বদলান", en: "Change" })}
          </button>
        </p>
      ) : (
        <div className="form-grid">
          <label htmlFor="signup-mobile">
            {choose({ bn: "মোবাইল নম্বর", en: "Mobile number" })}
            <input
              id="signup-mobile"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="01XXXXXXXXX"
              value={mobile}
              onChange={(e) => {
                setMobile(e.target.value);
                setChallenge(null);
              }}
            />
          </label>
          <div className="mobile-otp-send">
            <button
              type="button"
              className="secondary"
              disabled={busy || !mobile.trim() || wait > 0}
              onClick={() =>
                step(async () => {
                  const r = await api("/auth/otp/signup", "POST", { mobile });
                  setChallenge(r.challengeToken);
                  setWaitUntil(Date.now() + r.resendAfterSeconds * 1000);
                  setNow(Date.now());
                  setMessage(choose({ bn: "কোড পাঠানো হয়েছে।", en: "Code sent." }));
                })
              }
            >
              {wait > 0
                ? choose({ bn: `আবার পাঠান (${wait} সে.)`, en: `Resend (${wait}s)` })
                : challenge
                  ? choose({ bn: "আবার কোড পাঠান", en: "Resend code" })
                  : choose({ bn: "কোড পাঠান", en: "Send code" })}
            </button>
          </div>
          {challenge && (
            <>
              <label htmlFor="signup-otp">
                {choose({ bn: "৬ অঙ্কের কোড", en: "6-digit code" })}
                <input
                  id="signup-otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                />
              </label>
              <div className="mobile-otp-send">
                <button
                  type="button"
                  disabled={busy || code.length !== 6}
                  onClick={() =>
                    step(async () => {
                      await api("/auth/otp/verify", "POST", { challengeToken: challenge, code });
                      onChange({ mobile, otpToken: challenge });
                      setMessage("");
                    })
                  }
                >
                  {choose({ bn: "যাচাই করুন", en: "Verify code" })}
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </fieldset>
  );
}
