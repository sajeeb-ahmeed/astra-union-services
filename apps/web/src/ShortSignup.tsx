/**
 * REG-UX Phase 1 — one-screen citizen signup (design note §2.1, guide §6).
 *
 * Three required typed fields (name, mobile, password) + optional email + optional
 * photo (ঐচ্ছিক). The office is preselected as a DEFAULT (K3), shown as plain text
 * with a "Change" affordance that reveals the area/office selector only for those
 * who need it. Everything else (second-script name, date of birth, address, ward)
 * is asked at the first application — never here.
 *
 * Errors are shown at the field they belong to (EMAIL_TAKEN / IDENTIFIER_TAKEN carry
 * `error.field`; zod issues carry a path), with a sign-in affordance for a taken
 * email or mobile. Nothing the citizen typed is cleared on an error except the
 * password field when the account was not created.
 */
import React, { useEffect, useId, useRef, useState } from "react";
import { adoptSession, api, errorCode, fieldErrors } from "./api.js";
import "./short-signup.css";

type Photo = { mimeType: "image/png" | "image/jpeg"; base64: string; preview: string };
export type ShortSignupResult = { signInWith: "email" | "mobile"; identifier: string };
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const asciiDigits = (value: string) =>
  value.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6));

function readPhoto(file: File) {
  return new Promise<Photo>((resolve, reject) => {
    if (!["image/png", "image/jpeg"].includes(file.type))
      return reject(new Error("শুধু JPG বা PNG ছবি দিন। / Use a JPG or PNG photo."));
    if (file.size > MAX_PHOTO_BYTES)
      return reject(new Error("ছবির আকার ২ MB-এর কম হতে হবে। / The photo must be under 2 MB."));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("ছবিটি পড়া যায়নি। / The photo could not be read."));
    reader.onload = () => {
      const url = String(reader.result);
      const match = /^data:([^;,]+);base64,(.+)$/.exec(url);
      if (!match) return reject(new Error("ছবিটি পড়া যায়নি। / The photo could not be read."));
      resolve({ mimeType: match[1] as Photo["mimeType"], base64: match[2], preview: url });
    };
    reader.readAsDataURL(file);
  });
}

export function ShortSignupForm({
  tenantId,
  officeLabel,
  officeLoading,
  changingOffice,
  onChangeOffice,
  officeSelector,
  onRegistered,
  onSignIn,
  choose,
}: {
  tenantId: string;
  officeLabel: string;
  officeLoading: boolean;
  changingOffice: boolean;
  onChangeOffice: (open: boolean) => void;
  /** The existing area cascade + office select, rendered only while changing. */
  officeSelector: React.ReactNode;
  onRegistered: (result: ShortSignupResult) => void;
  onSignIn: (identifier?: string) => void;
  choose: (text: { bn: string; en: string }) => string;
}) {
  const id = useId();
  const [form, setForm] = useState({ name: "", mobile: "", password: "", email: "" });
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pageError, setPageError] = useState("");
  const [taken, setTaken] = useState<"email" | "mobile" | null>(null);
  const [working, setWorking] = useState(false);
  // S-001: a short signup without a verified code creates the account with the
  // mobile PENDING — mobile sign-in stays blocked until the holder proves the
  // number with a code. The panel below completes that proof, then signs the
  // citizen straight in with the mobile they just verified.
  const [pending, setPending] = useState<{ mobile: string; password: string; result: ShortSignupResult } | null>(null);
  const [otpChallenge, setOtpChallenge] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [otpMessage, setOtpMessage] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpWaitUntil, setOtpWaitUntil] = useState(0);
  const [otpNow, setOtpNow] = useState(Date.now());
  useEffect(() => {
    if (!pending || otpWaitUntil <= Date.now()) return;
    const timer = setInterval(() => setOtpNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pending, otpWaitUntil]);
  const refs = {
    name: useRef<HTMLInputElement>(null),
    mobile: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
    photo: useRef<HTMLInputElement>(null),
  };
  const fieldOrder = ["name", "mobile", "password", "email", "photo"] as const;
  // Focus the first field the server (or the browser) found wrong.
  const [focusNext, setFocusNext] = useState(false);
  useEffect(() => {
    if (!focusNext) return;
    setFocusNext(false);
    const first = fieldOrder.find((key) => errors[key]);
    if (first) refs[first].current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNext, errors]);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((previous) => ({ ...previous, [key]: e.target.value }));
    if (errors[key]) setErrors(({ [key]: _drop, ...rest }) => rest);
    if (taken === key) setTaken(null);
  };
  const describe = (key: string, hint?: string) =>
    [errors[key] ? `signup-${key}-error` : "", hint ? `signup-${key}-hint` : ""].filter(Boolean).join(" ") ||
    undefined;
  const fieldError = (key: string) =>
    errors[key] ? (
      <p className="du-field-error" id={`signup-${key}-error`} role="alert">
        {errors[key]}
        {taken === key && (
          <>
            {" "}
            <button
              type="button"
              className="text-button"
              onClick={() => onSignIn(key === "email" ? form.email.trim() : asciiDigits(form.mobile.trim()))}
            >
              {choose({ bn: "সাইন ইন করুন", en: "Sign in" })}
            </button>
          </>
        )}
      </p>
    ) : null;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!tenantId) {
      setPageError(
        choose({
          bn: "নিবন্ধনের জন্য একটি অফিস বেছে নিন।",
          en: "Choose the office you are registering with.",
        }),
      );
      onChangeOffice(true);
      return;
    }
    setWorking(true);
    setPageError("");
    setErrors({});
    setTaken(null);
    const mobile = asciiDigits(form.mobile.trim());
    try {
      const created: any = await api("/auth/signup", "POST", {
        tenantId,
        name: form.name.trim(),
        mobile,
        password: form.password,
        ...(form.email.trim() ? { email: form.email.trim() } : {}),
        ...(photo ? { photo: { mimeType: photo.mimeType, base64: photo.base64 } } : {}),
      });
      const result: ShortSignupResult = form.email.trim()
        ? { signInWith: "email", identifier: form.email.trim().toLowerCase() }
        : { signInWith: "mobile", identifier: mobile };
      // S-001: the mobile is pending until a code proves it. Email sign-in
      // still works, so an account WITH an email signs straight in below;
      // a mobile-only account stops here for the one-code proof instead of
      // failing a sign-in it cannot pass yet.
      if (result.signInWith === "mobile" && created?.mobileVerification === "pending") {
        setPending({ mobile, password: form.password, result });
        return;
      }
      // PORTAL-B: no second form — sign the new citizen in with the
      // password they just typed and open their workspace. Anything
      // unexpected (rate limit, a second factor) falls back to the
      // "Account created → sign in" screen, so the account is never lost.
      try {
        const session: any = await api(
          "/auth/login",
          "POST",
          result.signInWith === "email"
            ? { email: result.identifier, password: form.password }
            : { identifierType: "mobile", identifier: result.identifier, password: form.password },
        );
        if (session?.user?.id && !session.mfaRequired) {
          adoptSession(session);
          history.replaceState({}, "", "/");
          window.dispatchEvent(new CustomEvent("astra:session-changed"));
          return;
        }
      } catch {
        // Fall through to the manual sign-in hand-over below.
      }
      onRegistered(result);
    } catch (error) {
      const mapped = fieldErrors(error);
      const code = errorCode(error);
      if (code === "EMAIL_TAKEN") setTaken("email");
      if (code === "IDENTIFIER_TAKEN") setTaken("mobile");
      if (Object.keys(mapped).length) {
        setErrors(mapped);
        setFocusNext(true);
      } else setPageError((error as Error).message);
      setForm((previous) => ({ ...previous, password: "" }));
    } finally {
      setWorking(false);
    }
  }

  // S-001: pending-mobile verification — one code sent to the handset, then
  // the mobile becomes a trusted sign-in identifier and the citizen is signed
  // straight in. "Verify later" hands over to the normal sign-in screen; the
  // account already exists and the number can be verified from settings.
  if (pending) {
    const otpWait = Math.max(0, Math.ceil((otpWaitUntil - otpNow) / 1000));
    return (
      <section className="du-short-signup" aria-labelledby="signup-verify-title">
        <h2 id="signup-verify-title">{choose({ bn: "মোবাইল নম্বর যাচাই করুন", en: "Verify your mobile number" })}</h2>
        <p>
          {choose({
            bn: "আপনার অ্যাকাউন্ট তৈরি হয়েছে। মোবাইল দিয়ে সাইন ইন করার আগে নম্বরটি যাচাই করতে হবে — কোডটি SMS-এ যাবে।",
            en: "Your account is created. Before you can sign in with your mobile, the number needs verifying — the code is sent by SMS.",
          })}
        </p>
        <p className="hint">
          {choose({ bn: "মোবাইল: ", en: "Mobile: " })}
          <strong>{pending.mobile}</strong>
        </p>
        <div className="mobile-otp-send">
          <button
            type="button"
            className="secondary"
            disabled={otpBusy || otpWait > 0}
            onClick={async () => {
              setOtpBusy(true);
              setOtpMessage("");
              try {
                const r: any = await api("/auth/otp/signup", "POST", { mobile: pending.mobile });
                setOtpChallenge(r.challengeToken);
                setOtpWaitUntil(Date.now() + (r.resendAfterSeconds ?? 60) * 1000);
                setOtpNow(Date.now());
                setOtpMessage(choose({ bn: "কোড পাঠানো হয়েছে।", en: "Code sent." }));
              } catch (error) {
                setOtpMessage((error as Error).message);
              } finally {
                setOtpBusy(false);
              }
            }}
          >
            {otpWait > 0
              ? choose({ bn: `আবার পাঠান (${otpWait} সে.)`, en: `Resend (${otpWait}s)` })
              : otpChallenge
                ? choose({ bn: "আবার কোড পাঠান", en: "Resend code" })
                : choose({ bn: "কোড পাঠান", en: "Send code" })}
          </button>
        </div>
        {otpChallenge && (
          <>
            <label htmlFor="signup-verify-code">
              {choose({ bn: "৬ অঙ্কের কোড", en: "6-digit code" })}
              <input
                id="signup-verify-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
            </label>
            <div className="actions">
              <button
                type="button"
                className="du-btn-primary"
                disabled={otpBusy || otpCode.length !== 6}
                onClick={async () => {
                  setOtpBusy(true);
                  setOtpMessage("");
                  try {
                    await api("/auth/otp/verify-mobile", "POST", {
                      challengeToken: otpChallenge,
                      code: otpCode,
                      mobile: pending.mobile,
                    });
                    try {
                      const session: any = await api("/auth/login", "POST", {
                        identifierType: "mobile",
                        identifier: pending.mobile,
                        password: pending.password,
                      });
                      if (session?.user?.id && !session.mfaRequired) {
                        adoptSession(session);
                        history.replaceState({}, "", "/");
                        window.dispatchEvent(new CustomEvent("astra:session-changed"));
                        return;
                      }
                    } catch {
                      // Fall through to the manual sign-in hand-over below.
                    }
                    onRegistered(pending.result);
                  } catch (error) {
                    setOtpMessage((error as Error).message);
                  } finally {
                    setOtpBusy(false);
                  }
                }}
              >
                {choose({ bn: "যাচাই করুন ও সাইন ইন করুন", en: "Verify and sign in" })}
              </button>
            </div>
          </>
        )}
        {otpMessage && <p role="status">{otpMessage}</p>}
        <p>
          <button type="button" className="text-button" onClick={() => onRegistered(pending.result)}>
            {choose({ bn: "পরে যাচাই করব — সাইন ইন পাতায় যান", en: "Verify later — go to the sign-in page" })}
          </button>
        </p>
      </section>
    );
  }

  return (
    <form className="du-short-signup" onSubmit={submit} noValidate={false}>
      <div className="du-signup-office" aria-live="polite">
        <span className="du-signup-office-label">{choose({ bn: "আপনার অফিস", en: "Your office" })}</span>
        <strong className="du-signup-office-name">
          {officeLoading
            ? choose({ bn: "অফিস খোঁজা হচ্ছে…", en: "Finding your office…" })
            : officeLabel || choose({ bn: "অফিস বেছে নিন", en: "Choose an office" })}
        </strong>
        <button
          type="button"
          className="text-button"
          aria-expanded={changingOffice}
          onClick={() => onChangeOffice(!changingOffice)}
        >
          {changingOffice
            ? choose({ bn: "বন্ধ করুন", en: "Close" })
            : choose({ bn: "অন্য ইউনিয়নের হলে বদলান", en: "Change" })}
        </button>
      </div>
      {changingOffice && <div className="du-signup-office-picker">{officeSelector}</div>}

      <div className="du-signup-fields">
        <label htmlFor={"signup-name"}>
          <span className="du-label-text">
            {choose({ bn: "আপনার নাম", en: "Your name" })} <span className="du-required" aria-hidden="true">*</span>
          </span>
          <input
            ref={refs.name}
            id={"signup-name"}
            name="name"
            required
            minLength={2}
            maxLength={120}
            autoComplete="name"
            value={form.name}
            onChange={set("name")}
            aria-invalid={!!errors.name}
            aria-describedby={describe("name", "hint")}
          />
          <small id={"signup-name-hint"} className="hint">
            {choose({
              bn: "বাংলা বা ইংরেজি — যেকোনো একটিতে লিখুন।",
              en: "In Bangla or English — either is fine.",
            })}
          </small>
          {fieldError("name")}
        </label>

        <label htmlFor={"signup-mobile"}>
          <span className="du-label-text">
            {choose({ bn: "মোবাইল নম্বর", en: "Mobile number" })} <span className="du-required" aria-hidden="true">*</span>
          </span>
          <input
            ref={refs.mobile}
            id={"signup-mobile"}
            name="mobile"
            type="tel"
            inputMode="numeric"
            required
            maxLength={14}
            placeholder="01XXXXXXXXX"
            autoComplete="tel-national"
            value={form.mobile}
            onChange={set("mobile")}
            aria-invalid={!!errors.mobile}
            aria-describedby={describe("mobile", "hint")}
          />
          <small id={"signup-mobile-hint"} className="hint">
            {choose({
              bn: "এই মোবাইল নম্বর ও পাসওয়ার্ড দিয়ে সাইন ইন করবেন — নম্বরটিতে একটি কোড পাঠিয়ে যাচাই করা হবে।",
              en: "You will sign in with this mobile number and your password — the number is verified with a code first.",
            })}
          </small>
          {fieldError("mobile")}
        </label>

        <label htmlFor={"signup-password"}>
          <span className="du-label-text">
            {choose({ bn: "পাসওয়ার্ড", en: "Password" })} <span className="du-required" aria-hidden="true">*</span>
          </span>
          <span className="du-password-row">
            <input
              ref={refs.password}
              id={"signup-password"}
              name="password"
              type={showPassword ? "text" : "password"}
              required
              minLength={6}
              maxLength={18}
              autoComplete="new-password"
              value={form.password}
              onChange={set("password")}
              aria-invalid={!!errors.password}
              aria-describedby={describe("password", "hint")}
            />
            <button
              type="button"
              className="secondary du-password-toggle"
              aria-pressed={showPassword}
              aria-controls={"signup-password"}
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? choose({ bn: "লুকান", en: "Hide" }) : choose({ bn: "দেখুন", en: "Show" })}
            </button>
          </span>
          <small id={"signup-password-hint"} className="hint">
            {choose({ bn: "৬–১৮ অক্ষর।", en: "6 to 18 characters." })}
          </small>
          {fieldError("password")}
        </label>

        <label htmlFor={"signup-email"}>
          <span className="du-label-text">
            {choose({ bn: "ইমেইল", en: "Email" })}{" "}
            <span className="du-optional">({choose({ bn: "ঐচ্ছিক", en: "optional" })})</span>
          </span>
          <input
            ref={refs.email}
            id={"signup-email"}
            name="email"
            type="email"
            maxLength={150}
            autoComplete="email"
            value={form.email}
            onChange={set("email")}
            aria-invalid={!!errors.email}
            aria-describedby={describe("email", "hint")}
          />
          <small id={"signup-email-hint"} className="hint">
            {choose({
              bn: "থাকলে দিন — পাসওয়ার্ড ভুলে গেলে কাজে লাগবে।",
              en: "If you have one — it helps if you forget your password.",
            })}
          </small>
          {fieldError("email")}
        </label>

        <div className="du-signup-photo">
          <label htmlFor={"signup-photo"}>
            {choose({ bn: "আপনার ছবি", en: "Your photo" })}{" "}
            <span className="du-optional">({choose({ bn: "ঐচ্ছিক", en: "optional" })})</span>
          </label>
          <div className="du-signup-photo-row">
            {photo ? (
              <img src={photo.preview} alt={choose({ bn: "নির্বাচিত ছবি", en: "Selected photo" })} />
            ) : (
              <span className="du-signup-photo-empty" aria-hidden="true" />
            )}
            <div>
              <input
                ref={refs.photo}
                id={"signup-photo"}
                type="file"
                accept="image/png,image/jpeg"
                aria-invalid={!!errors.photo}
                aria-describedby={describe("photo", "hint")}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  setErrors(({ photo: _drop, ...rest }) => rest);
                  if (!file) return setPhoto(null);
                  try {
                    setPhoto(await readPhoto(file));
                  } catch (error) {
                    setPhoto(null);
                    e.target.value = "";
                    setErrors((previous) => ({ ...previous, photo: (error as Error).message }));
                  }
                }}
              />
              {photo && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setPhoto(null);
                    if (refs.photo.current) refs.photo.current.value = "";
                  }}
                >
                  {choose({ bn: "ছবি সরান", en: "Remove photo" })}
                </button>
              )}
              <small id={"signup-photo-hint"} className="hint">
                {choose({
                  bn: "JPG বা PNG, ২ MB পর্যন্ত। না দিলেও অ্যাকাউন্ট খুলবে; পরে বদলানো যাবে।",
                  en: "JPG or PNG up to 2 MB. Skipping it never blocks your account; you can change it later.",
                })}
              </small>
              {fieldError("photo")}
            </div>
          </div>
        </div>
      </div>

      {pageError && (
        <p className="notice error" role="alert">
          {pageError}
        </p>
      )}
      <p className="du-signup-later hint">
        {choose({
          bn: "জন্ম তারিখ ও ঠিকানা এখন লাগবে না — প্রথম আবেদনের সময় চাওয়া হবে।",
          en: "Date of birth and address are not needed now — they are asked at your first application.",
        })}
      </p>
      <div className="registration-actions">
        <button type="submit" className="du-btn-primary" disabled={working || officeLoading}>
          {working
            ? choose({ bn: "অ্যাকাউন্ট খোলা হচ্ছে…", en: "Creating account…" })
            : choose({ bn: "অ্যাকাউন্ট খুলুন", en: "Create account" })}
        </button>
        <span>
          {choose({ bn: "আগে নিবন্ধন করেছেন?", en: "Already registered?" })}{" "}
          <button type="button" className="text-button" onClick={() => onSignIn()}>
            {choose({ bn: "সাইন ইন করুন", en: "Sign in" })}
          </button>
        </span>
      </div>
    </form>
  );
}
