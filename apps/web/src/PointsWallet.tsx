import React, { useEffect, useState } from "react";
import { randomUUID } from "./uuid.js";
import { api } from "./api.js";
import { choose, useLanguage } from "./i18n.js";
import { formatMinorAsTaka, parseTakaToMinor } from "./OrderPolicySettings.js";

const label = (bn: string, en: string) => choose({ bn, en });
const bnDigits = (value: string) => value.replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
export const points = (minor: number) => {
  const text = `${minor < 0 ? "−" : ""}${formatMinorAsTaka(Math.abs(minor))}`;
  return choose({ bn: bnDigits(text), en: text });
};
const kindLabel = (kind: string) =>
  ({
    RECHARGE: label("রিচার্জ", "Recharge"),
    ISSUANCE: label("সনদ ইস্যু", "Certificate issued"),
    ADJUSTMENT: label("সমন্বয়", "Adjustment"),
    REVERSAL: label("ফেরত", "Reversal"),
  })[kind] ?? kind;

/**
 * Phase 5a: the office's points wallet (1 point = ৳1). Issuing a certificate deducts the service's point price,
 * set by the platform owner. Balances change only through ledger entries, listed here.
 */
export function PointsWallet({ children }: { children?: React.ReactNode }) {
  useLanguage();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const load = () =>
    api("/wallet/points")
      .then(setData)
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
  }, []);
  if (error) return null;
  if (!data) return null;
  return (
    <section className="panel points-wallet" aria-labelledby="points-wallet-title">
      <h2 id="points-wallet-title">{label("পয়েন্ট ওয়ালেট", "Points wallet")}</h2>
      <p className="points-balance">
        <span>{label("বর্তমান ব্যালান্স", "Current balance")}</span>{" "}
        <strong data-testid="points-balance">{points(data.balanceMinor)}</strong>{" "}
        <span>{label("পয়েন্ট (১ পয়েন্ট = ৳১)", "points (1 point = ৳1)")}</span>
      </p>
      <p className="hint">
        {label(
          "পয়েন্ট আর কোনো কাজে কাটা হয় না — আবেদনের ফি এখন ক্রেডিটে, জমার সময় কাটা হয়। আগের ব্যালান্স এখানে দেখা যাবে।",
          "Points are no longer deducted anywhere — the application fee is in credits, charged at submit. Earlier balances remain visible here.",
        )}
      </p>
      {children}
      <h3>{label("সাম্প্রতিক লেনদেন", "Recent movements")}</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">{label("তারিখ", "Date")}</th>
              <th scope="col">{label("ধরন", "Type")}</th>
              <th scope="col">{label("পরিমাণ", "Amount")}</th>
              <th scope="col">{label("ব্যালান্স", "Balance")}</th>
            </tr>
          </thead>
          <tbody>
            {data.ledger.map((e: any) => (
              <tr key={e.id}>
                <td>{new Date(e.createdAt).toLocaleDateString(choose({ bn: "bn-BD", en: "en-GB" }))}</td>
                <td>{kindLabel(e.kind)}</td>
                <td>{points(e.deltaMinor)}</td>
                <td>{points(e.balanceAfterMinor)}</td>
              </tr>
            ))}
            {/* P2-6: the empty state lives inside the table body. */}
            {!data.ledger.length && (
              <tr>
                <td colSpan={4} className="empty-cell">
                  {label("এখনও কোনো লেনদেন নেই।", "No movements yet.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Phase 3B: the owner point-price editor was retired with the points spend path;
 * per-service prices are credits now and live in OwnerPricing.tsx. The point-price
 * endpoints remain for the historical record. */

/** Phase 5a: owner adjustment of one office's points through the ledger. */
export function OwnerPointsAdjust({ tenantId }: { tenantId: string }) {
  useLanguage();
  const [balance, setBalance] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<"credit" | "debit">("credit");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // One key per intended adjustment: a retried submit after a lost response applies once.
  const [requestKey, setRequestKey] = useState(() => randomUUID());
  const load = () =>
    api(`/owner/tenants/${tenantId}/points`)
      .then((r) => setBalance(r.balanceMinor))
      .catch((e) => setMessage((e as Error).message));
  useEffect(() => {
    void load();
  }, [tenantId]);
  return (
    <form
      className="points-adjust"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setMessage("");
        (async () => {
          let minor: number;
          try {
            minor = parseTakaToMinor(amount);
          } catch {
            throw Error(label("পয়েন্ট সঠিকভাবে লিখুন।", "Enter the points correctly."));
          }
          if (!minor) throw Error(label("শূন্যের বেশি লিখুন।", "Enter more than zero."));
          await api(`/owner/tenants/${tenantId}/points/adjust`, "POST", {
            deltaMinor: direction === "credit" ? minor : -minor,
            reason,
            requestKey,
          });
          setRequestKey(randomUUID());
          setAmount("");
          setReason("");
          await load();
          setMessage(label("পয়েন্ট সমন্বয় হয়েছে।", "Points adjusted."));
        })()
          .catch((err) => setMessage((err as Error).message))
          .finally(() => setBusy(false));
      }}
    >
      <h3>{label("পয়েন্ট সমন্বয়", "Adjust points")}</h3>
      <p>
        {label("বর্তমান ব্যালান্স", "Current balance")}: <strong>{balance === null ? "…" : points(balance)}</strong>
      </p>
      <div className="form-grid">
        <div className="field">
          <label htmlFor={`points-direction-${tenantId}`}>{label("ধরন", "Direction")}</label>
          <select
            id={`points-direction-${tenantId}`}
            value={direction}
            onChange={(e) => setDirection(e.target.value as "credit" | "debit")}
          >
            <option value="credit">{label("যোগ", "Add")}</option>
            <option value="debit">{label("বিয়োগ", "Subtract")}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor={`points-amount-${tenantId}`}>{label("পয়েন্ট", "Points")}</label>
          <input id={`points-amount-${tenantId}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor={`points-reason-${tenantId}`}>{label("কারণ", "Reason")}</label>
          <input
            id={`points-reason-${tenantId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            minLength={8}
            maxLength={500}
          />
        </div>
      </div>
      <button disabled={busy}>{label("সমন্বয় করুন", "Adjust")}</button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}

/** Collapsed per-office points controls for the owner; loads only when opened. */
export function OwnerPointsPanel({ tenantId }: { tenantId: string }) {
  useLanguage();
  const [open, setOpen] = useState(false);
  return (
    <details className="owner-points" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>{label("পয়েন্ট ওয়ালেট", "Points wallet")}</summary>
      {open && <OwnerPointsAdjust tenantId={tenantId} />}
    </details>
  );
}
