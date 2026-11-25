import { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { choose, useLanguage } from "./i18n.js";
import { mfaErrorMessage } from "./MfaChallenge.js";
import "./account-mfa.css";

type MfaStatus = {
  enabled: boolean;
  available: boolean;
  pendingExpiresAt: string | null;
  recoveryCodesRemaining: number;
};
type Enrollment = {
  secret: string;
  otpauthUri: string;
  qrDataUrl: string;
  expiresAt: string;
};
type SecurityEvent = { id: string; action: string; createdAt: string };

export function securityEventLabel(action: string): string {
  const labels: Record<string, { bn: string; en: string }> = {
    MFA_ENROLLMENT_STARTED: {
      bn: "Authenticator সেটআপ শুরু",
      en: "Authenticator setup started",
    },
    MFA_ENABLED: {
      bn: "দুই ধাপের নিরাপত্তা চালু",
      en: "Two-step security enabled",
    },
    MFA_DISABLED: {
      bn: "দুই ধাপের নিরাপত্তা বন্ধ",
      en: "Two-step security disabled",
    },
    MFA_LOGIN_SUCCEEDED: {
      bn: "দুই ধাপে লগইন সম্পন্ন",
      en: "Two-step sign-in completed",
    },
    MFA_LOGIN_FAILED: {
      bn: "দুই ধাপের যাচাই ব্যর্থ",
      en: "Two-step verification failed",
    },
    MFA_CODE_REJECTED: {
      bn: "নিরাপত্তার কোড গ্রহণ করা হয়নি",
      en: "Security code rejected",
    },
    MFA_CHALLENGE_CREATED: {
      bn: "দুই ধাপে লগইনের চেষ্টা",
      en: "Two-step sign-in started",
    },
    MFA_RECOVERY_CODE_USED: {
      bn: "Recovery code ব্যবহার হয়েছে",
      en: "Recovery code used",
    },
    MFA_RECOVERY_CODES_ROTATED: {
      bn: "নতুন recovery code তৈরি",
      en: "Recovery codes replaced",
    },
    PASSWORD_CHANGED: { bn: "পাসওয়ার্ড পরিবর্তন", en: "Password changed" },
    PASSWORD_RECOVERED: {
      bn: "পাসওয়ার্ড পুনরুদ্ধার",
      en: "Password recovered",
    },
    PASSWORD_RECOVERY_COMPLETED: {
      bn: "পাসওয়ার্ড পুনরুদ্ধার",
      en: "Password recovered",
    },
    OTHER_SESSIONS_REVOKED: {
      bn: "অন্য লগইনগুলো বন্ধ",
      en: "Other sign-ins ended",
    },
  };
  return choose(
    labels[action] ?? {
      bn: "অ্যাকাউন্ট নিরাপত্তার কার্যক্রম",
      en: "Account security activity",
    },
  );
}

/** Setup secrets and recovery codes exist only in this mounted component's memory. */
export function AccountMfa({
  revision = 0,
  isApprover = false,
  onChange,
}: {
  revision?: number;
  /** WS-D3: an approver account without 2FA is called out explicitly —
      it can issue certificates, so the gap matters more than for other
      roles. Enabling 2FA itself stays the owner's action (OWNER-GATED). */
  isApprover?: boolean;
  onChange?: () => void;
}) {
  const [language] = useLanguage();
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<
    "enabled" | "disabled" | "rotated" | null
  >(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [action, setAction] = useState<"rotate" | "disable" | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const active = useRef(true);
  const requestGeneration = useRef(0);
  const noticeRef = useRef<HTMLDivElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    active.current = true;
    const clearPrivateState = () => {
      requestGeneration.current++;
      setEnrollment(null);
      setCodes(null);
      setPassword("");
      setCode("");
      setAction(null);
      setBusy(false);
    };
    const refreshAfterReturn = () => setRefresh((value) => value + 1);
    addEventListener("pagehide", clearPrivateState);
    addEventListener("pageshow", refreshAfterReturn);
    return () => {
      active.current = false;
      requestGeneration.current++;
      removeEventListener("pagehide", clearPrivateState);
      removeEventListener("pageshow", refreshAfterReturn);
    };
  }, []);
  useEffect(() => {
    let current = true;
    setEnrollment(null);
    setPassword("");
    setCode("");
    setLoadFailed(false);
    Promise.all([
      api<MfaStatus>("/auth/mfa"),
      api<{ items: SecurityEvent[] }>("/auth/security-events"),
    ])
      .then(([nextStatus, nextEvents]) => {
        if (current) {
          setStatus(nextStatus);
          setEvents(nextEvents.items);
        }
      })
      .catch(() => {
        if (current) setLoadFailed(true);
      });
    return () => {
      current = false;
    };
  }, [revision, refresh]);
  useEffect(() => {
    if (codes) noticeRef.current?.focus();
  }, [codes]);
  useEffect(() => {
    if (enrollment || action) codeInput.current?.focus();
  }, [enrollment, action]);
  const date = (value: string) =>
    new Intl.DateTimeFormat(language === "bn" ? "bn-BD" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  async function run(task: (isCurrent: () => boolean) => Promise<void>) {
    if (busy) return;
    const generation = ++requestGeneration.current;
    const isCurrent = () =>
      active.current && requestGeneration.current === generation;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await task(isCurrent);
    } catch (reason) {
      if (isCurrent()) setError(reason);
    } finally {
      if (isCurrent()) {
        setBusy(false);
        setPassword("");
        setCode("");
      }
    }
  }
  function changed() {
    setRefresh((value) => value + 1);
    onChange?.();
  }
  return (
    <section
      className="panel account-mfa"
      aria-labelledby="account-mfa-title"
      aria-busy={busy}
    >
      <div className="mfa-heading">
        <div>
          <h2 id="account-mfa-title">
            {choose({ bn: "দুই ধাপের নিরাপত্তা", en: "Two-step security" })}
          </h2>
          <p>
            {choose({
              bn: "চাইলে পাসওয়ার্ডের পরে authenticator app-এর কোড দিয়ে আপনার লগইন সুরক্ষিত করতে পারেন। SMS বা payment account প্রয়োজন নেই।",
              en: "You can add an authenticator code after your password for extra sign-in protection. No SMS or payment account is needed.",
            })}
          </p>
        </div>
        {status && (
          <span
            className={`status ${status.enabled ? "active" : "draft"}`}
            data-testid="mfa-status"
          >
            {status.enabled
              ? choose({ bn: "চালু আছে", en: "Enabled" })
              : choose({ bn: "চালু হয়নি", en: "Not enabled" })}
          </span>
        )}
      </div>
      {isApprover && status && !status.enabled && (
        <p className="notice" role="alert">
          {choose({
            bn: "এই অ্যাকাউন্ট দিয়ে সনদ অনুমোদন করা হয়। দুই ধাপের নিরাপত্তা চালু না থাকলে অনুমোদনকারীর অ্যাকাউন্ট ঝুঁকিতে থাকে — নিচে authenticator সেটআপ করুন।",
            en: "This account approves certificates. Without two-step security, an approver account is at risk — set up your authenticator below.",
          })}
        </p>
      )}
      {loadFailed && (
        <div className="notice error" role="alert">
          <p>
            {choose({
              bn: "নিরাপত্তার তথ্য লোড হয়নি। আবার চেষ্টা করুন।",
              en: "Security information could not load. Try again.",
            })}
          </p>
          <button
            type="button"
            className="secondary"
            onClick={() => setRefresh((value) => value + 1)}
          >
            {choose({ bn: "আবার দেখুন", en: "Retry security information" })}
          </button>
        </div>
      )}
      {!status && !loadFailed && (
        <p role="status">{choose({ bn: "লোড হচ্ছে…", en: "Loading…" })}</p>
      )}
      {error !== null && (
        <p className="notice error" role="alert">
          {mfaErrorMessage(error)}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {choose({
            bn:
              notice === "disabled"
                ? "দুই ধাপের নিরাপত্তা বন্ধ করা হয়েছে।"
                : notice === "rotated"
                  ? "নতুন recovery code তৈরি হয়েছে। আগেরগুলো আর কাজ করবে না।"
                  : "দুই ধাপের নিরাপত্তা চালু হয়েছে। অন্য ডিভাইসের লগইন বন্ধ করা হয়েছে।",
            en:
              notice === "disabled"
                ? "Two-step security is now disabled."
                : notice === "rotated"
                  ? "New recovery codes are ready. The previous codes no longer work."
                  : "Two-step security is enabled. Other devices have been signed out.",
          })}
        </p>
      )}
      {codes && (
        <div
          className="mfa-private-codes"
          ref={noticeRef}
          tabIndex={-1}
          aria-labelledby="mfa-codes-title"
        >
          <h3 id="mfa-codes-title">
            {choose({
              bn: "Recovery code এখনই সংরক্ষণ করুন",
              en: "Save your recovery codes now",
            })}
          </h3>
          <p>
            {choose({
              bn: "এই কোডগুলো একবারই দেখানো হবে। নিরাপদ password manager বা অফলাইনে রাখুন। প্রতিটি কোড একবার ব্যবহার করা যায়। কাউকে পাঠাবেন না। এই পেজ ছাড়লে তালিকাটি আর দেখা যাবে না।",
              en: "These codes are shown once. Keep them in a secure password manager or offline. Each code works once. Do not share them. Leaving this page hides this list permanently.",
            })}
          </p>
          <ul className="mfa-code-list">
            {codes.map((value) => (
              <li key={value}>
                <code>{value}</code>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setCodes(null)}>
            {choose({
              bn: "সংরক্ষণ করেছি — কোড লুকান",
              en: "I saved them — hide codes",
            })}
          </button>
        </div>
      )}
      {status && !status.available && (
        <p className="notice">
          {choose({
            bn: "এই সাইটে authenticator setup এখন ব্যবহার করা যাচ্ছে না। পরে আবার দেখুন বা সহায়তা নিন।",
            en: "Authenticator setup is unavailable on this site. Check again later or contact support.",
          })}
        </p>
      )}
      {status?.available && !status.enabled && !enrollment && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async (isCurrent) => {
              const result = await api<Enrollment>(
                "/auth/mfa/enrollment",
                "POST",
                { currentPassword: password },
              );
              if (isCurrent()) setEnrollment(result);
            });
          }}
        >
          <p>
            {choose({
              bn: "১. পাসওয়ার্ড নিশ্চিত করুন → ২. QR স্ক্যান করুন → ৩. কোড দিয়ে চালু করুন",
              en: "1. Confirm your password → 2. Scan the QR → 3. Enter a code to enable",
            })}
          </p>
          <label htmlFor="mfa-setup-password">
            {choose({
              bn: "সেটআপের জন্য বর্তমান পাসওয়ার্ড",
              en: "Current password for setup",
            })}
          </label>
          <input
            id="mfa-setup-password"
            type="password"
            autoComplete="current-password"
            value={password}
            maxLength={200}
            required
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button type="submit" disabled={busy || !password}>
            {choose({
              bn: "Authenticator সেটআপ করুন",
              en: "Set up authenticator",
            })}
          </button>
        </form>
      )}
      {enrollment && !status?.enabled && (
        <div className="mfa-enrollment">
          <h3>
            {choose({
              bn: "Authenticator app-এ QR স্ক্যান করুন",
              en: "Scan this QR in your authenticator app",
            })}
          </h3>
          <p>
            {choose({
              bn: "কোড যাচাই না হওয়া পর্যন্ত দুই ধাপের নিরাপত্তা চালু হবে না। QR বা setup key অন্য কাউকে দেবেন না।",
              en: "Two-step security stays off until you verify a code. Do not share the QR or setup key.",
            })}
          </p>
          <img
            src={enrollment.qrDataUrl}
            width={220}
            height={220}
            alt={choose({
              bn: "ব্যক্তিগত authenticator setup QR",
              en: "Private authenticator setup QR",
            })}
          />
          <details>
            <summary>
              {choose({
                bn: "QR স্ক্যান করতে পারছেন না? Setup key দেখুন",
                en: "Cannot scan? Show the setup key",
              })}
            </summary>
            <p>
              {choose({
                bn: "Time-based (TOTP), ৬ সংখ্যা, ৩০ সেকেন্ড বেছে নিন।",
                en: "Use time-based (TOTP), 6 digits, 30 seconds.",
              })}
            </p>
            <code className="mfa-setup-key" data-testid="mfa-setup-key">
              {enrollment.secret}
            </code>
          </details>
          <p>
            {choose({ bn: "সেটআপের মেয়াদ: ", en: "Setup expires: " })}
            <time dateTime={enrollment.expiresAt}>
              {date(enrollment.expiresAt)}
            </time>
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(async (isCurrent) => {
                const result = await api<{ recoveryCodes: string[] }>(
                  "/auth/mfa/activate",
                  "POST",
                  { code: code.trim() },
                );
                if (isCurrent()) {
                  setEnrollment(null);
                  setCodes(result.recoveryCodes);
                  setNotice("enabled");
                  setStatus(
                    (value) =>
                      value && {
                        ...value,
                        enabled: true,
                        recoveryCodesRemaining: result.recoveryCodes.length,
                      },
                  );
                  changed();
                }
              });
            }}
          >
            <label htmlFor="mfa-setup-code">
              {choose({
                bn: "Authenticator-এর ৬ সংখ্যার কোড",
                en: "6-digit authenticator code",
              })}
            </label>
            <input
              id="mfa-setup-code"
              ref={codeInput}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="[0-9]{6}"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              required
              disabled={busy}
            />
            <div className="actions">
              <button type="submit" disabled={busy || !code.trim()}>
                {choose({ bn: "যাচাই করে চালু করুন", en: "Verify and enable" })}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => {
                  setEnrollment(null);
                  setCode("");
                  setError(null);
                }}
              >
                {choose({ bn: "এখন নয়", en: "Not now" })}
              </button>
            </div>
          </form>
        </div>
      )}
      {status?.enabled && (
        <>
          <p>
            {choose({
              bn: "অব্যবহৃত recovery code: ",
              en: "Unused recovery codes: ",
            })}
            <strong data-testid="mfa-code-count">
              {new Intl.NumberFormat(
                language === "bn" ? "bn-BD" : "en-GB",
              ).format(status.recoveryCodesRemaining)}
            </strong>
          </p>
          <p>
            {choose({
              bn: "ফোন হারালে recovery code দিয়ে লগইন করুন। পাসওয়ার্ড reset করে এই নিরাপত্তা এড়ানো যাবে না।",
              en: "If you lose your phone, sign in with a recovery code. A password reset cannot bypass this protection.",
            })}
          </p>
          {!action && !codes && status.available && (
            <div className="actions">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setAction("rotate");
                  setError(null);
                  setNotice(null);
                }}
              >
                {choose({
                  bn: "নতুন recovery code তৈরি করুন",
                  en: "Replace recovery codes",
                })}
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setAction("disable");
                  setError(null);
                  setNotice(null);
                }}
              >
                {choose({
                  bn: "দুই ধাপের নিরাপত্তা বন্ধ করুন",
                  en: "Turn off two-step security",
                })}
              </button>
            </div>
          )}
          {action && (
            <form
              className="mfa-confirm-action"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async (isCurrent) => {
                  const result = await api<{ recoveryCodes?: string[] }>(
                    action === "rotate"
                      ? "/auth/mfa/recovery-codes"
                      : "/auth/mfa/disable",
                    "POST",
                    {
                      currentPassword: password,
                      code: code.trim(),
                    },
                  );
                  if (isCurrent()) {
                    if (action === "rotate")
                      setCodes(result.recoveryCodes ?? null);
                    setNotice(action === "rotate" ? "rotated" : "disabled");
                    setAction(null);
                    changed();
                  }
                });
              }}
            >
              <h3>
                {action === "rotate"
                  ? choose({
                      bn: "আগের recovery code বদলান",
                      en: "Replace the previous recovery codes",
                    })
                  : choose({
                      bn: "দুই ধাপের নিরাপত্তা বন্ধ করার নিশ্চয়তা",
                      en: "Confirm turning off two-step security",
                    })}
              </h3>
              <p>
                {action === "rotate"
                  ? choose({
                      bn: "আগের সব recovery code বাতিল হবে। নতুনগুলো নিরাপদে রাখুন।",
                      en: "All previous recovery codes will stop working. Save the new codes securely.",
                    })
                  : choose({
                      bn: "এরপর শুধু পাসওয়ার্ড দিয়েই লগইন করা যাবে। আপনার অ্যাকাউন্টের সুরক্ষা কমে যাবে।",
                      en: "Future sign-ins will only require a password. Your account will have less protection.",
                    })}
              </p>
              <label htmlFor="mfa-action-password">
                {choose({
                  bn: "বর্তমান পাসওয়ার্ড নিশ্চিত করুন",
                  en: "Confirm current password",
                })}
              </label>
              <input
                id="mfa-action-password"
                type="password"
                autoComplete="current-password"
                value={password}
                maxLength={200}
                onChange={(event) => setPassword(event.target.value)}
                required
                disabled={busy}
              />
              <label htmlFor="mfa-action-code">
                {choose({
                  bn: "Authenticator বা recovery code",
                  en: "Authenticator or recovery code",
                })}
              </label>
              <input
                id="mfa-action-code"
                ref={codeInput}
                autoComplete="one-time-code"
                spellCheck={false}
                value={code}
                maxLength={64}
                onChange={(event) => setCode(event.target.value)}
                required
                disabled={busy}
              />
              <div className="actions">
                <button
                  type="submit"
                  disabled={busy || !password || !code.trim()}
                >
                  {action === "rotate"
                    ? choose({
                        bn: "নিশ্চিত করে নতুন কোড তৈরি",
                        en: "Confirm replacement",
                      })
                    : choose({
                        bn: "নিশ্চিত করে বন্ধ করুন",
                        en: "Confirm turn off",
                      })}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    setAction(null);
                    setPassword("");
                    setCode("");
                    setError(null);
                  }}
                >
                  {choose({ bn: "বাতিল", en: "Cancel" })}
                </button>
              </div>
            </form>
          )}
        </>
      )}
      <details className="mfa-history">
        <summary>
          {choose({
            bn: "সাম্প্রতিক নিরাপত্তার কার্যক্রম",
            en: "Recent security activity",
          })}
        </summary>
        <p>
          {choose({
            bn: "আপনার নিজের অ্যাকাউন্টের সাম্প্রতিক কার্যক্রম। সন্দেহ হলে পাসওয়ার্ড বদলান ও অন্য লগইনগুলো বন্ধ করুন।",
            en: "Recent activity for your account. If something looks unfamiliar, change your password and sign out other sessions.",
          })}
        </p>
        {events.length ? (
          <ul>
            {events.map((event) => (
              <li key={event.id}>
                <span>{securityEventLabel(event.action)}</span>
                <time dateTime={event.createdAt}>{date(event.createdAt)}</time>
              </li>
            ))}
          </ul>
        ) : (
          !loadFailed && (
            <p>
              {choose({
                bn: "এখনও কোনো কার্যক্রম পাওয়া যায়নি।",
                en: "No recorded activity yet.",
              })}
            </p>
          )
        )}
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => setRefresh((value) => value + 1)}
        >
          {choose({ bn: "কার্যক্রম আবার দেখুন", en: "Refresh activity" })}
        </button>
      </details>
    </section>
  );
}
