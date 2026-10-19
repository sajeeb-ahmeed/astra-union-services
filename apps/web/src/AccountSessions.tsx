import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { t, useLanguage } from "./i18n.js";

type SessionSummary = {
  activeSessions: number;
  otherSessions: number;
  currentSessionExpiresAt: string;
};

export function AccountSessions({ revision = 0 }: { revision?: number }) {
  const [language] = useLanguage();
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    api("/auth/sessions")
      .then((result: SessionSummary) => {
        if (active) setSummary(result);
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [revision, refresh]);
  const locale = language === "bn" ? "bn-BD" : "en-GB";
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  return (
    <section
      className="panel"
      aria-labelledby="account-sessions-title"
      aria-busy={busy}
    >
      <h2 id="account-sessions-title">{t("সক্রিয় লগইন / Active sign-ins")}</h2>
      <p>
        {t(
          "অন্য ব্রাউজার বা ডিভাইসের লগইন বন্ধ করুন। এই লগইনটি চালু থাকবে। / Sign out other browsers or devices. This sign-in stays active.",
        )}
      </p>
      {error && (
        <p className="notice error" role="alert">
          {t(error)}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {t(notice)}
        </p>
      )}
      {summary ? (
        <dl>
          <dt>{t("মোট সক্রিয় লগইন / Total active sign-ins")}</dt>
          <dd data-testid="active-session-count">
            {number(summary.activeSessions)}
          </dd>
          <dt>{t("অন্য সক্রিয় লগইন / Other active sign-ins")}</dt>
          <dd data-testid="other-session-count">
            {number(summary.otherSessions)}
          </dd>
          <dt>{t("বর্তমান লগইনের মেয়াদ / Current sign-in expires")}</dt>
          <dd>
            <time dateTime={summary.currentSessionExpiresAt}>
              {new Intl.DateTimeFormat(locale, {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(summary.currentSessionExpiresAt))}
            </time>
          </dd>
        </dl>
      ) : (
        busy && <p role="status">{t("লোড হচ্ছে… / Loading…")}</p>
      )}
      {summary?.otherSessions === 0 && (
        <p>{t("অন্য কোনো সক্রিয় লগইন নেই। / No other active sign-ins.")}</p>
      )}
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || !summary?.otherSessions) return;
          setBusy(true);
          setError("");
          setNotice("");
          try {
            await api("/auth/sessions/revoke-others", "POST", {
              currentPassword: password,
            });
            setNotice(
              "অন্য সব লগইন বন্ধ করা হয়েছে। / All other sign-ins have been signed out.",
            );
            setRefresh((value) => value + 1);
          } catch (reason) {
            setError((reason as Error).message);
          } finally {
            setPassword("");
            setBusy(false);
          }
        }}
      >
        <label htmlFor="sessions-current-password">
          {t(
            "লগইন বন্ধ করতে বর্তমান পাসওয়ার্ড / Current password to sign out others",
          )}
        </label>
        <input
          id="sessions-current-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          maxLength={200}
          required
          disabled={busy || !summary?.otherSessions}
        />
        <div className="actions">
          <button disabled={busy || !summary?.otherSessions || !password}>
            {t("অন্য লগইন বন্ধ করুন / Sign out other sessions")}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => setRefresh((value) => value + 1)}
          >
            {t("আবার দেখুন / Refresh sign-ins")}
          </button>
        </div>
      </form>
    </section>
  );
}
