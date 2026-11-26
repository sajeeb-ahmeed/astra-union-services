import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { choose, useLanguage } from "./i18n.js";
import { localDigits } from "./ui/fmt.js";
import { StatCard, applicationStatusMeta } from "./ui/kit.js";
import { NavIcon } from "./ui/nav-icons.js";

/**
 * W-012: global platform statistics for the System Owner — total
 * citizens, applications and certificates, the applications by current
 * state, and a per-office breakdown, with a UTC date range and an
 * office scope. Counts only; the endpoint returns no personal data.
 * The office rows add up to the totals (same range, same rules).
 */
const STATE_ORDER = [
  "DRAFT",
  "SUBMITTED",
  "RESUBMITTED",
  "UNDER_REVIEW",
  "CORRECTION_REQUIRED",
  "APPROVED",
  "ISSUED",
  "REJECTED",
  "CANCELLED",
  "REVOKED",
];

export function OwnerStatistics({ tenants }: { tenants: any[] }) {
  const [language] = useLanguage();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(tenantId ? { tenantId } : {}),
      });
      setData(await api(`/owner/statistics?${params}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, tenantId]);
  const exportHref = `/api/v1/owner/statistics/export?${new URLSearchParams({
    format: "csv",
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(tenantId ? { tenantId } : {}),
  })}`;
  return (
    <section className="panel owner-statistics" aria-labelledby="owner-statistics-title">
      <h3 id="owner-statistics-title">
        {choose({ bn: "প্ল্যাটফর্মের পরিসংখ্যান", en: "Platform statistics" })}
      </h3>
      <p className="hint">
        {choose({
          bn: "মোট নাগরিক, আবেদন ও সনদ — শুধু সংখ্যা, কোনো ব্যক্তিগত তথ্য নয়। তারিখ UTC দিন অনুযায়ী।",
          en: "Total citizens, applications and certificates — counts only, no personal data. Dates are UTC calendar days.",
        })}
      </p>
      <div className="form-grid">
        <label>
          {choose({ bn: "শুরুর তারিখ (UTC)", en: "From (UTC)" })}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          {choose({ bn: "শেষ তারিখ (UTC)", en: "To (UTC)" })}
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label>
          {choose({ bn: "অফিস", en: "Office" })}
          <select value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
            <option value="">
              {choose({ bn: "সব অফিস", en: "All offices" })}
            </option>
            {tenants.map((t: any) => (
              <option key={t.id} value={t.id}>
                {t.nameEn || t.name_en || t.slug}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {loading && !data ? (
        <p className="hint" role="status">
          {choose({ bn: "লোড হচ্ছে…", en: "Loading…" })}
        </p>
      ) : data ? (
        <>
          <div className="kpi-grid">
            <StatCard
              value={localDigits(String(data.totals.citizens), language)}
              label={choose({ bn: "মোট নাগরিক", en: "Total citizens" })}
              icon={<NavIcon name="citizens" />}
              context={choose({ bn: "নিবন্ধিত নাগরিক", en: "Registered citizens" })}
            />
            <StatCard
              value={localDigits(String(data.totals.applications), language)}
              label={choose({ bn: "মোট আবেদন", en: "Total applications" })}
              icon={<NavIcon name="applications" />}
              context={choose({ bn: "সব অফিস মিলিয়ে", en: "Across all offices" })}
            />
            <StatCard
              value={localDigits(String(data.totals.certificates), language)}
              label={choose({ bn: "মোট সনদ", en: "Total certificates" })}
              icon={<NavIcon name="prints" />}
              context={choose({
                bn: `ইস্যুকৃত ${localDigits(String(data.certificatesByState.ISSUED), language)} · প্রত্যাহৃত ${localDigits(String(data.certificatesByState.REVOKED), language)}`,
                en: `Issued ${data.certificatesByState.ISSUED} · Revoked ${data.certificatesByState.REVOKED}`,
              })}
            />
          </div>
          <h4>{choose({ bn: "অবস্থা অনুযায়ী আবেদন", en: "Applications by state" })}</h4>
          <div className="ax-dashboard-states-row">
            {STATE_ORDER.map((state) => (
              <span key={state} className="ax-state-tile">
                <strong>{localDigits(String(data.applicationsByState[state] ?? 0), language)}</strong>
                <span>{choose(applicationStatusMeta(state) ?? { bn: state, en: state })}</span>
              </span>
            ))}
          </div>
          <p className="hint">
            {choose({
              bn: "অবস্থাগুলো মিলে মোট আবেদনের সমান — কোনো আবেদন দুইবার গোনা হয় না।",
              en: "The states add up to the total applications — no application is counted twice.",
            })}
          </p>
          <h4>{choose({ bn: "অফিস অনুযায়ী", en: "By office" })}</h4>
          {data.offices.length === 0 ? (
            <p className="hint">
              {choose({ bn: "এই পরিসরে কোনো অফিসের তথ্য নেই।", en: "No offices in this range." })}
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{choose({ bn: "অফিস", en: "Office" })}</th>
                    <th className="num">{choose({ bn: "নাগরিক", en: "Citizens" })}</th>
                    <th className="num">{choose({ bn: "আবেদন", en: "Applications" })}</th>
                    <th className="num">{choose({ bn: "সনদ", en: "Certificates" })}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.offices.map((o: any) => (
                    <tr key={o.tenantId}>
                      <td>
                        {o.nameEn || o.nameBn || o.slug}
                        <small> {o.slug}</small>
                      </td>
                      <td className="num">{localDigits(String(o.citizens), language)}</td>
                      <td className="num">{localDigits(String(o.applications), language)}</td>
                      <td className="num">{localDigits(String(o.certificates), language)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p>
            <a className="button" href={exportHref}>
              {choose({ bn: "CSV ডাউনলোড করুন", en: "Download CSV" })}
            </a>{" "}
            <button type="button" className="secondary" disabled={loading} onClick={() => void load()}>
              {choose({ bn: "আবার লোড করুন", en: "Reload" })}
            </button>
          </p>
        </>
      ) : null}
    </section>
  );
}
