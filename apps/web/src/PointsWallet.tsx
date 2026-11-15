import React, { useEffect, useState } from "react";
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
          "প্রতিটি সনদ ইস্যুর সময় সেবার নির্ধারিত পয়েন্ট কাটা হয়। পয়েন্ট কম থাকলে আবেদন অনুমোদিত অবস্থায় থাকবে।",
          "Each certificate deducts its service's point price when issued. With too few points the application stays approved.",
        )}
      </p>
      {children}
      <h3>{label("সাম্প্রতিক লেনদেন", "Recent movements")}</h3>
      {data.ledger.length ? (
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
            </tbody>
          </table>
        </div>
      ) : (
        <p>{label("এখনও কোনো লেনদেন নেই।", "No movements yet.")}</p>
      )}
    </section>
  );
}

/** Phase 5a: the owner's per-service point price list, published as new versions. */
export function OwnerPointPrices() {
  useLanguage();
  const [items, setItems] = useState<any[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const load = async () => {
    const r = await api("/owner/point-prices");
    setItems(r.items);
    setDrafts(Object.fromEntries(r.items.map((i: any) => [i.serviceNo, formatMinorAsTaka(i.priceMinor)])));
  };
  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, []);
  async function publish(item: any) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      let priceMinor: number;
      try {
        priceMinor = parseTakaToMinor(drafts[item.serviceNo] ?? "");
      } catch {
        throw Error(label("পয়েন্ট সঠিকভাবে লিখুন, সর্বোচ্চ দুই দশমিক ঘর।", "Enter points with at most two decimal places."));
      }
      await api(`/owner/point-prices/${item.serviceNo}`, "POST", {
        expectedVersion: item.version,
        priceMinor,
        reason: "Owner price list update",
      });
      await load();
      setMessage(label("মূল্য প্রকাশিত হয়েছে।", "Price published."));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel owner-point-prices">
      <h2>{label("সনদ প্রতি পয়েন্ট মূল্য", "Points per certificate")}</h2>
      <p className="hint">
        {label(
          "সব অফিসের জন্য একই মূল্য। ০ মানে কোনো পয়েন্ট কাটা হবে না। প্রতিটি পরিবর্তন নতুন সংস্করণ হিসেবে সংরক্ষিত হয়।",
          "One price for every office. 0 means no points are deducted. Each change is kept as a new version.",
        )}
      </p>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">{label("সেবা", "Service")}</th>
              <th scope="col">{label("পয়েন্ট", "Points")}</th>
              <th scope="col">
                <span className="sr-only">{label("প্রকাশ", "Publish")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.serviceNo}>
                <th scope="row">
                  {item.serviceNo}. {choose({ bn: item.nameBn, en: item.nameEn })}
                </th>
                <td>
                  <input
                    aria-label={`${label("পয়েন্ট", "Points")}: ${choose({ bn: item.nameBn, en: item.nameEn })}`}
                    inputMode="decimal"
                    value={drafts[item.serviceNo] ?? ""}
                    onChange={(e) => setDrafts({ ...drafts, [item.serviceNo]: e.target.value })}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || drafts[item.serviceNo] === formatMinorAsTaka(item.priceMinor)}
                    onClick={() => void publish(item)}
                  >
                    {label("প্রকাশ করুন", "Publish")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

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
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
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
          setRequestKey(crypto.randomUUID());
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
