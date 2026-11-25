import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { choose, useLanguage } from "./i18n.js";

const kinds = [
  { kind: "mobile", bn: "মোবাইল নম্বর", en: "Mobile number", example: "01XXXXXXXXX" },
  { kind: "nid", bn: "জাতীয় পরিচয়পত্র (NID) নম্বর", en: "National ID (NID) number", example: "10, 13 or 17 digits" },
  { kind: "birth_reg", bn: "জন্ম নিবন্ধন নম্বর", en: "Birth registration number", example: "17 digits" },
] as const;

/** Phase 2b: extra ways to sign in. Numbers are stored only as a keyed digest; the page shows a masked hint. */
export function SignInIdentifiers() {
  useLanguage();
  const [state, setState] = useState<any>(null);
  // Phase X: email verification state (from /auth/me) and whether delivery is configured.
  const [emailState, setEmailState] = useState<{ verified: boolean; available: boolean } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  // S-001: a pending mobile (never OTP-verified) cannot sign in. The verify
  // panel proves the number with a code sent to the handset; adding or
  // changing a mobile needs the same proof before the save.
  const [verifying, setVerifying] = useState(false);
  const [verifyMobile, setVerifyMobile] = useState("");
  const [otpChallenge, setOtpChallenge] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [verifiedOtp, setVerifiedOtp] = useState<{ mobile: string; token: string } | null>(null);
  const load = () =>
    api("/account/identifiers")
      .then(setState)
      .catch((error) => setMessage((error as Error).message));
  const loadEmailState = () =>
    Promise.all([api("/auth/me"), api("/auth/email/status")])
      .then(([me, status]) =>
        setEmailState({ verified: Boolean(me?.user?.emailVerified), available: Boolean(status?.available) }),
      )
      .catch(() => setEmailState(null));
  useEffect(() => {
    void load();
    void loadEmailState();
  }, []);
  async function act(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
      setEditing(null);
      setValue("");
      setCurrentPassword("");
      await load();
      setMessage(done);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel narrow" aria-labelledby="sign-in-identifiers-title">
      <h2 id="sign-in-identifiers-title">
        {choose({ bn: "লগইনের উপায়", en: "Sign-in identifiers" })}
      </h2>
      <p>
        {choose({
          bn: "ইমেইলের পাশাপাশি মোবাইল, NID বা জন্ম নিবন্ধন নম্বর দিয়েও লগইন করা যাবে। নম্বরগুলো সাংকেতিক রূপে রাখা হয়; এখানে শুধু শেষ অংশ দেখানো হয়।",
          en: "Besides your email you can sign in with your mobile, NID or birth registration number. Numbers are kept only in coded form; this page shows just their last digits.",
        })}
      </p>
      {state && !state.available && (
        <p className="notice" role="status">
          {choose({
            bn: "এই সার্ভারে এখনো চালু নেই। ইমেইল দিয়ে লগইন করুন।",
            en: "Not enabled on this server yet. Sign in with your email.",
          })}
        </p>
      )}
      {state && (
        <dl className="identifier-list">
          <dt>{choose({ bn: "ইমেইল", en: "Email" })}</dt>
          <dd>
            <span>{state.email}</span>{" "}
            {emailState?.verified ? (
              <span>{choose({ bn: "· যাচাইকৃত", en: "· Verified" })}</span>
            ) : emailState && !emailState.available ? (
              <span>
                {choose({
                  bn: "· এই সার্ভারে ইমেইল যাচাইকরণ চালু নেই",
                  en: "· Email verification is not enabled on this server",
                })}
              </span>
            ) : emailState ? (
              <>
                <span>{choose({ bn: "· যাচাই হয়নি", en: "· Not verified" })}</span>{" "}
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      async () => {
                        await api("/auth/email/resend", "POST", {});
                        await loadEmailState();
                      },
                      choose({
                        bn: "যাচাইকরণ ইমেইল পাঠানো হয়েছে। ইনবক্সে লিংকটি খুলুন।",
                        en: "Verification email sent. Open the link in your inbox.",
                      }),
                    )
                  }
                >
                  {choose({ bn: "যাচাইকরণ ইমেইল পাঠান", en: "Send verification email" })}
                </button>
              </>
            ) : null}
          </dd>
          {kinds.map((k) => {
            const item = state.items.find((i: any) => i.kind === k.kind);
            return (
              <React.Fragment key={k.kind}>
                <dt>{choose(k)}</dt>
                <dd>
                  <span>{item?.set ? item.hint : choose({ bn: "যোগ করা হয়নি", en: "Not added" })}</span>{" "}
                  {k.kind === "mobile" && item?.set && item.verified === true && (
                    <span>{choose({ bn: "· যাচাইকৃত", en: "· Verified" })}</span>
                  )}
                  {k.kind === "mobile" && item?.set && item.verified === false && (
                    <>
                      <span>{choose({ bn: "· যাচাই হয়নি — এই নম্বর দিয়ে সাইন ইন হবে না", en: "· Not verified — this number cannot sign in yet" })}</span>{" "}
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() => {
                          setVerifying(true);
                          setVerifyMobile("");
                          setOtpChallenge(null);
                          setOtpCode("");
                          setMessage("");
                        }}
                      >
                        {choose({ bn: "যাচাই করুন", en: "Verify" })}
                      </button>
                    </>
                  )}
                  {state.available && (
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() => {
                        setEditing(k.kind);
                        setValue("");
                        setCurrentPassword("");
                        setMessage("");
                        setVerifiedOtp(null);
                        setOtpChallenge(null);
                        setOtpCode("");
                      }}
                    >
                      {item?.set ? choose({ bn: "বদলান", en: "Change" }) : choose({ bn: "যোগ করুন", en: "Add" })}
                    </button>
                  )}
                  {item?.set && editing !== k.kind && (
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() => {
                        setEditing(`remove:${k.kind}`);
                        setCurrentPassword("");
                        setMessage("");
                      }}
                    >
                      {choose({ bn: "সরান", en: "Remove" })}
                    </button>
                  )}
                </dd>
              </React.Fragment>
            );
          })}
        </dl>
      )}
      {verifying && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              async () => {
                await api("/auth/otp/verify-mobile", "POST", {
                  challengeToken: otpChallenge,
                  code: otpCode,
                  mobile: verifyMobile,
                });
                setVerifying(false);
                setVerifyMobile("");
                setOtpChallenge(null);
                setOtpCode("");
              },
              choose({ bn: "মোবাইল নম্বর যাচাই হয়েছে। এখন এটি দিয়ে সাইন ইন করা যাবে।", en: "Mobile number verified. You can now sign in with it." }),
            );
          }}
        >
          <p className="hint">
            {choose({
              bn: "নম্বরটিতে পাঠানো ৬ অঙ্কের কোড দিন। কোডটি যার হাতে আছে, নম্বরটি তারই বলে ধরা হবে।",
              en: "Enter the 6-digit code sent to the number. Whoever holds the code is taken to hold the number.",
            })}
          </p>
          <label htmlFor="identifier-verify-mobile">
            {choose({ bn: "মোবাইল নম্বর", en: "Mobile number" })}
            <input
              id="identifier-verify-mobile"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="01XXXXXXXXX"
              value={verifyMobile}
              onChange={(e) => {
                setVerifyMobile(e.target.value);
                setOtpChallenge(null);
              }}
              required
            />
          </label>
          <div className="actions">
            <button
              type="button"
              className="secondary"
              disabled={busy || !verifyMobile.trim()}
              onClick={async () => {
                setBusy(true);
                setMessage("");
                try {
                  const r: any = await api("/auth/otp/signup", "POST", { mobile: verifyMobile });
                  setOtpChallenge(r.challengeToken);
                  setMessage(choose({ bn: "কোড পাঠানো হয়েছে।", en: "Code sent." }));
                } catch (error) {
                  setMessage((error as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {otpChallenge
                ? choose({ bn: "আবার কোড পাঠান", en: "Resend code" })
                : choose({ bn: "কোড পাঠান", en: "Send code" })}
            </button>
          </div>
          {otpChallenge && (
            <label htmlFor="identifier-verify-code">
              {choose({ bn: "৬ অঙ্কের কোড", en: "6-digit code" })}
              <input
                id="identifier-verify-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                required
              />
            </label>
          )}
          <div className="actions">
            <button disabled={busy || !otpChallenge || otpCode.length !== 6}>
              {choose({ bn: "যাচাই করুন", en: "Verify" })}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setVerifying(false);
                setVerifyMobile("");
                setOtpChallenge(null);
                setOtpCode("");
              }}
            >
              {choose({ bn: "বাতিল", en: "Cancel" })}
            </button>
          </div>
        </form>
      )}
      {editing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const removing = editing.startsWith("remove:");
            const kind = removing ? editing.slice(7) : editing;
            // S-001: a mobile is saved only with a code proven for the new
            // number (verified below, before this submit).
            if (!removing && kind === "mobile" && !(verifiedOtp && verifiedOtp.mobile === value)) {
              setMessage(
                choose({
                  bn: "প্রথমে নম্বরটিতে পাঠানো কোড দিয়ে যাচাই করুন।",
                  en: "Verify the number with the code sent to it first.",
                }),
              );
              return;
            }
            void act(
              () =>
                removing
                  ? api(`/account/identifiers/${kind}`, "DELETE", { currentPassword })
                  : api(`/account/identifiers/${kind}`, "PUT", {
                      value,
                      currentPassword,
                      ...(kind === "mobile" && verifiedOtp ? { otpToken: verifiedOtp.token } : {}),
                    }),
              removing
                ? choose({ bn: "সরানো হয়েছে।", en: "Removed." })
                : choose({ bn: "সংরক্ষিত হয়েছে। এখন এটি দিয়েও লগইন করা যাবে।", en: "Saved. You can now sign in with it." }),
            );
          }}
        >
          {!editing.startsWith("remove:") && (
            <label htmlFor="identifier-value">
              {choose(kinds.find((k) => k.kind === editing)!)}
              <input
                id="identifier-value"
                inputMode="numeric"
                autoComplete="off"
                placeholder={kinds.find((k) => k.kind === editing)!.example}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  if (verifiedOtp && verifiedOtp.mobile !== e.target.value) setVerifiedOtp(null);
                }}
                required
              />
            </label>
          )}
          <label htmlFor="identifier-current-password">
            {choose({ bn: "বর্তমান পাসওয়ার্ড", en: "Current password" })}
            <input
              id="identifier-current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </label>
          {editing === "mobile" && (
            <>
              <p className="hint">
                {choose({
                  bn: "মোবাইল নম্বর যোগ বা বদল করতে প্রথমে নম্বরটিতে পাঠানো কোড দিয়ে যাচাই করুন।",
                  en: "To add or change a mobile number, first verify it with a code sent to that number.",
                })}
              </p>
              {verifiedOtp && verifiedOtp.mobile === value ? (
                <p role="status">
                  {choose({ bn: "যাচাই হয়েছে: ", en: "Verified: " })}
                  <strong>{value}</strong>
                </p>
              ) : (
                <>
                  <div className="actions">
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy || !value.trim()}
                      onClick={async () => {
                        setBusy(true);
                        setMessage("");
                        try {
                          const r: any = await api("/auth/otp/signup", "POST", { mobile: value });
                          setOtpChallenge(r.challengeToken);
                          setMessage(choose({ bn: "কোড পাঠানো হয়েছে।", en: "Code sent." }));
                        } catch (error) {
                          setMessage((error as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {otpChallenge
                        ? choose({ bn: "আবার কোড পাঠান", en: "Resend code" })
                        : choose({ bn: "কোড পাঠান", en: "Send code" })}
                    </button>
                  </div>
                  {otpChallenge && (
                    <>
                      <label htmlFor="identifier-otp-code">
                        {choose({ bn: "৬ অঙ্কের কোড", en: "6-digit code" })}
                        <input
                          id="identifier-otp-code"
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
                          disabled={busy || otpCode.length !== 6}
                          onClick={async () => {
                            setBusy(true);
                            setMessage("");
                            try {
                              await api("/auth/otp/verify", "POST", { challengeToken: otpChallenge, code: otpCode });
                              setVerifiedOtp({ mobile: value, token: otpChallenge });
                              setMessage(choose({ bn: "যাচাই হয়েছে। এখন সংরক্ষণ করুন।", en: "Verified. Now save." }));
                            } catch (error) {
                              setMessage((error as Error).message);
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          {choose({ bn: "যাচাই করুন", en: "Verify code" })}
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}
          <div className="actions">
            <button disabled={busy}>
              {editing.startsWith("remove:")
                ? choose({ bn: "সরিয়ে ফেলুন", en: "Remove identifier" })
                : choose({ bn: "সংরক্ষণ করুন", en: "Save identifier" })}
            </button>
            <button type="button" className="secondary" onClick={() => setEditing(null)}>
              {choose({ bn: "বাতিল", en: "Cancel" })}
            </button>
          </div>
        </form>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
