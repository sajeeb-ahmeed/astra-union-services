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

/** The owner's view of what needs attention across offices: scanner health and pending queues. */
export function OwnerOperations() {
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
      <h2 id="operations-title">{label("পরিচালনার অবস্থা", "Operations")}</h2>
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
      <dl className="operations-grid">
        <dt>{label("স্ক্যানের অপেক্ষায়", "Waiting for scan")}</dt>
        <dd>{n(Number(s.waiting) + Number(s.scanning))}</dd>
        <dt>{label("স্ক্যানারের শেষ সাড়া", "Scanner last check-in")}</dt>
        <dd>{s.lastHeartbeatAt ? new Date(s.lastHeartbeatAt).toLocaleString(choose({ bn: "bn-BD", en: "en-GB" })) : "—"}</dd>
        <dt>{label("রিচার্জের অনুরোধ", "Recharge requests")}</dt>
        <dd>{n(q.rechargesPending)}</dd>
        <dt>{label("অফিস অ্যাকাউন্ট অনুরোধ", "Office account requests")}</dt>
        <dd>{n(q.officeAccountRequestsPending)}</dd>
        <dt>{label("অফিস যুক্ত করার অনুরোধ", "Office inclusion requests")}</dt>
        <dd>{n(q.officeInclusionRequestsOpen)}</dd>
        <dt>{label("ফি ফেরত (সিদ্ধান্তের অপেক্ষায় / চলমান)", "Refunds (to decide / in progress)")}</dt>
        <dd>
          {n(q.refundsAwaitingDecision)} / {n(q.refundsInProgress)}
        </dd>
      </dl>
    </section>
  );
}
