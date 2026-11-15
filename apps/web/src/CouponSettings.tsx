import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { choose, useLanguage } from "./i18n.js";
import { parseTakaToMinor, formatMinorAsTaka } from "./OrderPolicySettings.js";

const label = (bn: string, en: string) => choose({ bn, en });

/**
 * Phase 4b: the office's coupon codes. A coupon gives a percentage or a fixed taka discount on the assessed
 * fee, optionally for some services only, inside dates and up to a number of uses. Coupons are switched off,
 * never deleted, because stored application fees refer to them.
 */
export function CouponSettings({ services }: { services: any[] }) {
  useLanguage();
  const [coupons, setCoupons] = useState<any[]>([]);
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<"percent" | "fixed">("percent");
  const [amount, setAmount] = useState("");
  const [serviceNo, setServiceNo] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const load = async () => setCoupons((await api("/admin/coupons")).items);
  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, []);
  async function run(fn: () => Promise<void>, done: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      await load();
      setMessage(done);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel coupon-settings">
      <h2>{label("কুপন কোড", "Coupon codes")}</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            let discountValue: number;
            if (kind === "percent") {
              discountValue = Number(amount);
              if (!Number.isInteger(discountValue) || discountValue < 1 || discountValue > 100)
                throw Error(label("শতাংশ ১ থেকে ১০০ এর মধ্যে লিখুন।", "Enter a percentage from 1 to 100."));
            } else {
              try {
                discountValue = parseTakaToMinor(amount);
              } catch {
                throw Error(label("ছাড়ের টাকার পরিমাণ সঠিকভাবে লিখুন।", "Enter the discount in taka."));
              }
              if (discountValue < 1) throw Error(label("ছাড় শূন্যের বেশি হতে হবে।", "The discount must be above zero."));
            }
            await api("/admin/coupons", "POST", {
              code: code.trim(),
              discountKind: kind,
              discountValue,
              serviceNos: serviceNo ? [Number(serviceNo)] : null,
              validUntil: validUntil ? new Date(`${validUntil}T23:59:59+06:00`).toISOString() : null,
              maxRedemptions: maxRedemptions ? Number(maxRedemptions) : null,
            });
            setCode("");
            setAmount("");
            setMaxRedemptions("");
            setValidUntil("");
          }, label("কুপন তৈরি হয়েছে।", "Coupon created."));
        }}
      >
        <div className="form-grid">
          <div className="field">
            <label htmlFor="coupon-code">{label("কোড", "Code")}</label>
            <input
              id="coupon-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              required
              minLength={3}
              maxLength={32}
              pattern="[A-Za-z0-9][A-Za-z0-9-]{2,31}"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="coupon-kind">{label("ছাড়ের ধরন", "Discount type")}</label>
            <select id="coupon-kind" value={kind} onChange={(e) => setKind(e.target.value as "percent" | "fixed")}>
              <option value="percent">{label("শতাংশ", "Percentage")}</option>
              <option value="fixed">{label("নির্দিষ্ট টাকা", "Fixed taka")}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="coupon-amount">
              {kind === "percent" ? label("ছাড় (%)", "Discount (%)") : label("ছাড় (টাকা)", "Discount (BDT)")}
            </label>
            <input id="coupon-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="coupon-service">{label("সেবা", "Service")}</label>
            <select id="coupon-service" value={serviceNo} onChange={(e) => setServiceNo(e.target.value)}>
              <option value="">{label("সব সেবা", "All services")}</option>
              {services.map((s) => (
                <option key={s.serviceNo ?? s.service_no} value={s.serviceNo ?? s.service_no}>
                  {choose({ bn: s.nameBn ?? s.name_bn, en: s.nameEn ?? s.name_en })}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="coupon-until">{label("শেষ তারিখ (ঐচ্ছিক)", "Last day (optional)")}</label>
            <input id="coupon-until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="coupon-limit">{label("সর্বোচ্চ ব্যবহার (ঐচ্ছিক)", "Maximum uses (optional)")}</label>
            <input
              id="coupon-limit"
              inputMode="numeric"
              value={maxRedemptions}
              onChange={(e) => setMaxRedemptions(e.target.value.replace(/\D/g, ""))}
            />
          </div>
        </div>
        <button disabled={busy}>{label("কুপন তৈরি করুন", "Create coupon")}</button>
      </form>
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
              <th scope="col">{label("কোড", "Code")}</th>
              <th scope="col">{label("ছাড়", "Discount")}</th>
              <th scope="col">{label("ব্যবহার", "Uses")}</th>
              <th scope="col">{label("অবস্থা", "Status")}</th>
            </tr>
          </thead>
          <tbody>
            {coupons.map((c) => (
              <tr key={c.code}>
                <th scope="row">
                  <code>{c.code}</code>
                </th>
                <td>{c.discountKind === "percent" ? `${c.discountValue}%` : `৳${formatMinorAsTaka(c.discountValue)}`}</td>
                <td>
                  {c.redemptions}
                  {c.maxRedemptions ? ` / ${c.maxRedemptions}` : ""}
                </td>
                <td>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    aria-label={`${c.active ? label("বন্ধ করুন", "Switch off") : label("চালু করুন", "Switch on")}: ${c.code}`}
                    onClick={() =>
                      run(
                        () => api(`/admin/coupons/${c.code}`, "PATCH", { active: !c.active }),
                        c.active ? label("কুপন বন্ধ হয়েছে।", "Coupon switched off.") : label("কুপন চালু হয়েছে।", "Coupon switched on."),
                      )
                    }
                  >
                    {c.active ? label("চালু · বন্ধ করুন", "On · switch off") : label("বন্ধ · চালু করুন", "Off · switch on")}
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
