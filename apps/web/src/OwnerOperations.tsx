import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { choose, useLanguage } from "./i18n.js";

const label = (bn: string, en: string) => choose({ bn, en });
const bnDigits = (v: string) => v.replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
const n = (v: unknown) => choose({ bn: bnDigits(String(v ?? 0)), en: String(v ?? 0) });
function alertText(a: any) {
  switch (a.code) {
    case "SCANNER_OFFLINE":
      return label(
        `ম্যালওয়্যার স্ক্যানার বন্ধ মনে হচ্ছে: ${n(a.count)}টি ফাইল অপেক্ষায়${a.minutes != null ? `, শেষ সাড়া ${n(a.minutes)} মিনিট আগে` : ""}। পিসি ও স্ক্যানার চালু করুন।`,
        `The malware scanner looks stopped: ${a.count} file(s) waiting${a.minutes != null ? `, last check-in ${a.minutes} min ago` : ""}. Start the PC and the scanner.`,
      );
    case "SCAN_QUEUE_SLOW":
      return label(`স্ক্যান সারি ধীর: সবচেয়ে পুরনো ফাইল ${n(a.minutes)} মিনিট ধরে অপেক্ষায়।`, `Scan queue is slow: the oldest file has waited ${a.minutes} min.`);
    case "SCAN_ERRORS":
      return label(`${n(a.count)}টি ফাইলের স্ক্যান শেষ হয়নি।`, `${a.count} file scan(s) did not finish.`);
    case "RECHARGES_PENDING":
      return label(`${n(a.count)}টি রিচার্জ নিশ্চিত করার অপেক্ষায়।`, `${a.count} recharge request(s) waiting for confirmation.`);
    case "ACCOUNT_REQUESTS_PENDING":
      return label(`${n(a.count)}টি অফিস অ্যাকাউন্ট অনুরোধ যাচাইয়ের অপেক্ষায়।`, `${a.count} office account request(s) waiting for verification.`);
    default:
      return a.code;
  }
}

/** PORTAL-D: a waiting-queue figure that opens the screen where it is handled. */
function QueueTile({
  label: title,
  value,
  caption,
  onOpen,
}: {
  label: string;
  value: React.ReactNode;
  caption: string;
  onOpen?: () => void;
}) {
  const body = (
    <>
      <div className="kpi-label">{title}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-caption">
        {caption}
        {onOpen && <span className="kpi-open"> · {choose({ bn: "খুলুন →", en: "Open →" })}</span>}
      </div>
    </>
  );
  return onOpen ? (
    <button type="button" className="kpi-card kpi-link" onClick={onOpen}>
      {body}
    </button>
  ) : (
    <div className="kpi-card">{body}</div>
  );
}

/** The owner's view of what needs attention across offices: scanner health and pending queues. */
export function OwnerOperations({
  onOpen,
}: {
  /** PORTAL-D: open the owner section that handles a queue and scroll to its panel. */
  onOpen?: (section: string, panelSelector: string) => void;
} = {}) {
  useLanguage();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const load = () =>
    api("/owner/operations")
      .then(setData)
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, []);
  if (error) return null;
  if (!data) return null;
  const s = data.scanner,
    q = data.queues;
  return (
    <section className="panel owner-operations" aria-labelledby="operations-title">
      <h3 id="operations-title">{label("পরিচালনার অবস্থা", "Operations")}</h3>
      {data.alerts.length === 0 ? (
        <p className="notice" role="status" data-testid="operations-ok">
          {label("সব ঠিক আছে — কোনো সতর্কতা নেই।", "All clear — no alerts.")}
        </p>
      ) : (
        <ul className="operations-alerts">
          {data.alerts.map((a: any) => (
            <li key={a.code} className={a.severity === "critical" ? "error" : "notice"} role={a.severity === "critical" ? "alert" : "status"}>
              {alertText(a)}
            </li>
          ))}
        </ul>
      )}
      {/* REFINEMENT-02 P1-11: when every queue is empty the six zero
          tiles collapse into one calm "all clear" panel — a wall of ০s
          reads as broken, not as healthy. */}
      {Number(s.waiting) + Number(s.scanning) === 0 &&
      Number(q.rechargesPending) === 0 &&
      Number(q.officeAccountRequestsPending) === 0 &&
      Number(q.officeInclusionRequestsOpen) === 0 &&
      Number(q.refundsAwaitingDecision) === 0 &&
      Number(q.refundsInProgress) === 0 ? (
        <p className="notice" role="status">
          {label(
            "সব ঠিক আছে — কোনো সারি অপেক্ষমাণ নেই।",
            "All clear — every queue is empty.",
          )}
        </p>
      ) : (
      <>
      {/* OWNER-REDESIGN-01: the six operational figures as KPI stat cards
          (label, big value, small caption) — same values, same labels. */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">{label("স্ক্যানের অপেক্ষায়", "Waiting for scan")}</div>
          <div className="kpi-value">{n(Number(s.waiting) + Number(s.scanning))}</div>
          <div className="kpi-caption">{label("ফাইল স্ক্যান বাকি", "Files awaiting a scan")}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">{label("স্ক্যানারের শেষ সাড়া", "Scanner last check-in")}</div>
          <div className="kpi-value small">
            {s.lastHeartbeatAt ? new Date(s.lastHeartbeatAt).toLocaleString(choose({ bn: "bn-BD", en: "en-GB" })) : "—"}
          </div>
          <div className="kpi-caption">{label("সর্বশেষ হার্টবিটের সময়", "Time of the latest heartbeat")}</div>
        </div>
        <QueueTile
          label={label("রিচার্জের অনুরোধ", "Recharge requests")}
          value={n(q.rechargesPending)}
          caption={label("নিশ্চিত করার অপেক্ষায়", "Waiting for confirmation")}
          onOpen={onOpen && (() => onOpen("offices", ".owner-recharges"))}
        />
        <QueueTile
          label={label("অফিস অ্যাকাউন্ট অনুরোধ", "Office account requests")}
          value={n(q.officeAccountRequestsPending)}
          caption={label("যাচাইয়ের অপেক্ষায়", "Waiting for verification")}
          onOpen={onOpen && (() => onOpen("permissions", ".owner-requests"))}
        />
        <QueueTile
          label={label("অফিস যুক্ত করার অনুরোধ", "Office inclusion requests")}
          value={n(q.officeInclusionRequestsOpen)}
          caption={label("খোলা অনুরোধ", "Open requests")}
          onOpen={onOpen && (() => onOpen("offices", ".owner-inclusion"))}
        />
        <div className="kpi-card">
          <div className="kpi-label">{label("ফি ফেরত (সিদ্ধান্তের অপেক্ষায় / চলমান)", "Refunds (to decide / in progress)")}</div>
          <div className="kpi-value">
            {n(q.refundsAwaitingDecision)} / {n(q.refundsInProgress)}
          </div>
          <div className="kpi-caption">{label("সিদ্ধান্তের অপেক্ষায় / চলমান", "To decide / in progress")}</div>
        </div>
      </div>
      </>
      )}
    </section>
  );
}
