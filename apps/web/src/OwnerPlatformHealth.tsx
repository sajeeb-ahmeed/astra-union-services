import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { choose, useLanguage } from "./i18n.js";
import { localDigits, formatDateTime } from "./ui/fmt.js";
import { alertText } from "./OwnerOperations.js";

/**
 * W-020: platform health for the System Owner — read-only indicators.
 * Database latency + migration status, scanner heartbeat + queue,
 * SMS/email/OTP/payment provider status, backup and maintenance state,
 * and system alerts. Nothing here changes configuration: backup and
 * maintenance are reported as absent because no mechanism exists in
 * the product (see the API response notes), never shown as healthy.
 */
function providerLine(p: any, label: { bn: string; en: string }) {
  if (!p) return null;
  const state = !p.available
    ? choose({ bn: "কনফিগার করা হয়নি", en: "Not configured" })
    : p.logOnly
      ? choose({ bn: "শুধু লগ — কিছু পাঠানো হচ্ছে না", en: "Log only — sends nothing" })
      : choose({ bn: "চালু", en: "Live" });
  return (
    <li>
      <strong>{choose(label)}</strong>: {p.provider ?? "—"} · {state}
    </li>
  );
}

export function OwnerPlatformHealth() {
  const [language] = useLanguage();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const load = () =>
    api("/owner/platform-health")
      .then(setData)
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, []);
  if (error)
    return (
      <p className="notice error" role="alert">
        {error}
      </p>
    );
  if (!data) return null;
  const d = data;
  const scannerTone =
    d.scanner.status === "ok" ? "ok" : d.scanner.status === "stale" ? "warn" : "bad";
  return (
    <section className="panel owner-platform-health" aria-labelledby="platform-health-title">
      <h3 id="platform-health-title">
        {choose({ bn: "প্ল্যাটফর্মের স্বাস্থ্য", en: "Platform health" })}
      </h3>
      <p className="hint">
        {choose({
          bn: "শুধু দেখার জন্য — এই পৃষ্ঠা থেকে কোনো সেটিং বদলানো যায় না।",
          en: "Read-only — no setting can be changed from this page.",
        })}
      </p>
      {d.alerts.length === 0 ? (
        <p className="notice" role="status" data-testid="platform-health-ok">
          {choose({ bn: "সব ঠিক আছে — কোনো সতর্কতা নেই।", en: "All clear — no alerts." })}
        </p>
      ) : (
        <ul className="operations-alerts">
          {d.alerts.map((a: any) => (
            <li
              key={a.code}
              className={a.severity === "critical" ? "error" : "notice"}
              role={a.severity === "critical" ? "alert" : "status"}
            >
              {alertText(a)}
            </li>
          ))}
        </ul>
      )}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">{choose({ bn: "ডাটাবেস", en: "Database" })}</div>
          <div className="kpi-value">
            {localDigits(String(d.database.latencyMs), language)} ms
          </div>
          <div className="kpi-caption">
            {choose({
              bn: `${localDigits(String(d.database.migrationsApplied), language)}টি মাইগ্রেশন · সর্বশেষ ${d.database.latestMigration ?? "—"}`,
              en: `${d.database.migrationsApplied} migrations · latest ${d.database.latestMigration ?? "—"}`,
            })}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">{choose({ bn: "স্ক্যানার", en: "Scanner" })}</div>
          <div className="kpi-value">
            {scannerTone === "ok"
              ? choose({ bn: "চালু", en: "Running" })
              : scannerTone === "warn"
                ? choose({ bn: "সাড়া মিলছে না", en: "No recent heartbeat" })
                : choose({ bn: "বন্ধ", en: "Offline" })}
          </div>
          <div className="kpi-caption">
            {choose({
              bn: `অপেক্ষায় ${localDigits(String(d.scanner.waiting + d.scanner.scanning), language)} · ত্রুটি ${localDigits(String(d.scanner.errors), language)} · শেষ সাড়া ${d.scanner.heartbeatMinutesAgo == null ? "—" : `${localDigits(String(d.scanner.heartbeatMinutesAgo), language)} মিনিট আগে`}`,
              en: `Waiting ${d.scanner.waiting + d.scanner.scanning} · errors ${d.scanner.errors} · last heartbeat ${d.scanner.heartbeatMinutesAgo == null ? "—" : `${d.scanner.heartbeatMinutesAgo} min ago`}`,
            })}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">{choose({ bn: "অ্যাপ সংস্করণ", en: "App version" })}</div>
          <div className="kpi-value">{d.app.version}</div>
          <div className="kpi-caption">
            {choose({ bn: `Node ${d.app.node} · ${d.app.environment}`, en: `Node ${d.app.node} · ${d.app.environment}` })}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">{choose({ bn: "ব্যাকআপ", en: "Backup" })}</div>
          <div className="kpi-value">
            {choose({ bn: "পণ্যে নেই", en: "Not in the product" })}
          </div>
          <div className="kpi-caption">{choose({ bn: "অপারেটরের ডাম্প; এখানে কোনো অবস্থা দেখানো হয় না।", en: "Operator-run dumps; no status is shown here." })}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">{choose({ bn: "রক্ষণাবেক্ষণ মোড", en: "Maintenance mode" })}</div>
          <div className="kpi-value">
            {choose({ bn: "পণ্যে নেই", en: "Not in the product" })}
          </div>
          <div className="kpi-caption">{choose({ bn: "চালু/বন্ধ করার মতো কোনো মোড নেই।", en: "There is no mode to toggle." })}</div>
        </div>
      </div>
      <h4>{choose({ bn: "প্রোভাইডার", en: "Providers" })}</h4>
      <ul>
        {providerLine(d.providers.email, { bn: "ইমেইল", en: "Email" })}
        {providerLine(d.providers.sms, { bn: "এসএমএস", en: "SMS" })}
        {providerLine(d.providers.otp, { bn: "মোবাইল ওটিপি", en: "Mobile OTP" })}
        <li>
          <strong>{choose({ bn: "পেমেন্ট", en: "Payment" })}</strong>:{" "}
          {choose({
            bn: `${localDigits(String(d.providers.payment.officesConfigured), language)}টি অফিসে মার্চেন্ট কনফিগার করা · মোট ${localDigits(String(d.providers.payment.merchantsTotal), language)}টি · bKash এনভায়রনমেন্ট ${d.providers.payment.bkashEnvConfigured ? "চালু" : "বন্ধ"}`,
            en: `${d.providers.payment.officesConfigured} office(s) with a merchant configured · ${d.providers.payment.merchantsTotal} total · bKash env ${d.providers.payment.bkashEnvConfigured ? "on" : "off"}`,
          })}
        </li>
      </ul>
      <h4>{choose({ bn: "অপেক্ষমাণ সারি", en: "Pending queues" })}</h4>
      <ul>
        <li>
          {choose({ bn: "রিচার্জ", en: "Recharges" })}: {localDigits(String(d.queues.rechargesPending), language)}
        </li>
        <li>
          {choose({ bn: "অফিস অ্যাকাউন্ট অনুরোধ", en: "Office account requests" })}:{" "}
          {localDigits(String(d.queues.officeAccountRequestsPending), language)}
        </li>
        <li>
          {choose({ bn: "অফিস অন্তর্ভুক্তির অনুরোধ", en: "Office inclusion requests" })}:{" "}
          {localDigits(String(d.queues.officeInclusionRequestsOpen), language)}
        </li>
        <li>
          {choose({ bn: "ফেরতের সিদ্ধান্তের অপেক্ষায়", en: "Refunds awaiting decision" })}:{" "}
          {localDigits(String(d.queues.refundsAwaitingDecision), language)}
        </li>
        <li>
          {choose({ bn: "চলমান ফেরত", en: "Refunds in progress" })}:{" "}
          {localDigits(String(d.queues.refundsInProgress), language)}
        </li>
      </ul>
      <p className="hint">
        {choose({
          bn: "যাচাই করা হয়েছে",
          en: "Checked at",
        })}{" "}
        {formatDateTime(d.checkedAt, language)}
      </p>
    </section>
  );
}
