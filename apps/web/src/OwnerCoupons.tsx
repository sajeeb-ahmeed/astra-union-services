import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { choose, useLanguage } from "./i18n.js";
import { StatusBadge } from "./OwnerUi.js";

const label = (bn: string, en: string) => choose({ bn, en });
const bnDigits = (v: string) => v.replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
const n = (v: unknown) => choose({ bn: bnDigits(String(v ?? 0)), en: String(v ?? 0) });
const taka = (minor: number) =>
  choose({
    bn: `৳${bnDigits(String(minor / 100))}`,
    en: `BDT ${minor / 100}`,
  });
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => new Date(v).toISOString();

type Draft = {
  code: string;
  discountKind: "percent" | "fixed";
  discountValue: string;
  appliesTo: "subscription" | "topup" | "both";
  planId: string;
  validFrom: string;
  validUntil: string;
  maxUses: string;
  perOfficeLimit: string;
  visibility: "public" | "hidden";
  active: boolean;
};
const emptyDraft: Draft = {
  code: "",
  discountKind: "percent",
  discountValue: "10",
  appliesTo: "both",
  planId: "",
  validFrom: toLocalInput(new Date().toISOString()),
  validUntil: "",
  maxUses: "",
  perOfficeLimit: "",
  visibility: "hidden",
  active: true,
};

/**
 * Phase 3E: the owner's Coupons screen (§3.7). The owner creates platform coupons —
 * a percentage or fixed-BDT discount on subscription purchases and/or credit top-ups,
 * optionally for one plan, with a validity window, a total-use cap, a per-office cap
 * and a visibility choice: public coupons are shown on the portal as offers; hidden
 * coupons work only for an office that knows the code. A coupon is redeemed when an
 * office creates an order; the discount and the redemption are recorded on the order.
 * Every save carries a mandatory reason into the coupon's audit history. This is the
 * platform system — the per-office fee coupons (CouponSettings) are separate.
 */
export function OwnerCoupons() {
  useLanguage();
  const [items, setItems] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [redemptions, setRedemptions] = useState<any[]>([]);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [reason, setReason] = useState("");
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = () =>
    Promise.all([
      api("/owner/coupons").then((r) => setItems(r.items ?? [])),
      api("/owner/plans").then((r) => setPlans(r.items ?? [])),
      api("/owner/coupon-redemptions").then((r) => setRedemptions(r.items ?? [])),
    ]).catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
  }, []);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const startCreate = () => {
    setDraft({ ...emptyDraft, validFrom: toLocalInput(new Date().toISOString()) });
    setEditingCode(null);
    setCreating(true);
    setMessage("");
    setError("");
  };
  const startEdit = (coupon: any) => {
    setDraft({
      code: coupon.code,
      discountKind: coupon.discountKind,
      discountValue:
        coupon.discountKind === "percent"
          ? String(coupon.discountValue)
          : String(coupon.discountValue / 100),
      appliesTo: coupon.appliesTo,
      planId: coupon.planId ?? "",
      validFrom: toLocalInput(coupon.validFrom),
      validUntil: coupon.validUntil ? toLocalInput(coupon.validUntil) : "",
      maxUses: coupon.maxUses == null ? "" : String(coupon.maxUses),
      perOfficeLimit: coupon.perOfficeLimit == null ? "" : String(coupon.perOfficeLimit),
      visibility: coupon.visibility,
      active: coupon.active,
    });
    setEditingCode(coupon.code);
    setCreating(false);
    setMessage("");
    setError("");
  };
  const cancelForm = () => {
    setCreating(false);
    setEditingCode(null);
  };
  const validReason = () => {
    if (reason.trim().length < 8) {
      setError(label("কারণ আবশ্যক (কমপক্ষে ৮ অক্ষর)।", "A reason is required (at least 8 characters)."));
      return false;
    }
    return true;
  };
  const draftBody = () => {
    const rawValue = Number(draft.discountValue);
    const discountValue =
      draft.discountKind === "percent" ? rawValue : Math.round(rawValue * 100);
    if (
      !Number.isInteger(discountValue) ||
      discountValue < 1 ||
      (draft.discountKind === "percent" && discountValue > 100)
    )
      throw new Error(
        label(
          "ছাড়ের পরিমাণ সঠিক নয় (শতাংশ হলে ১–১০০)।",
          "The discount amount is not valid (1–100 for a percentage).",
        ),
      );
    const optionalCount = (v: string, what: string) => {
      if (v.trim() === "") return null;
      const count = Number(v);
      if (!Number.isInteger(count) || count < 1)
        throw new Error(label(`${what} কমপক্ষে ১ হতে হবে।`, `${what} must be at least 1.`));
      return count;
    };
    if (!draft.validFrom) throw new Error(label("শুরুর সময় দিন।", "Give the start of the validity window."));
    return {
      discountKind: draft.discountKind,
      discountValue,
      appliesTo: draft.appliesTo,
      planId: draft.appliesTo === "topup" || draft.planId === "" ? null : draft.planId,
      validFrom: fromLocalInput(draft.validFrom),
      validUntil: draft.validUntil ? fromLocalInput(draft.validUntil) : null,
      maxUses: optionalCount(draft.maxUses, label("মোট ব্যবহারের সীমা", "The total usage limit")),
      perOfficeLimit: optionalCount(draft.perOfficeLimit, label("অফিসপ্রতি সীমা", "The per-office limit")),
      visibility: draft.visibility,
      active: draft.active,
      reason: reason.trim(),
    };
  };
  const save = async () => {
    if (!validReason()) return;
    let body: ReturnType<typeof draftBody>;
    try {
      body = draftBody();
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    if (creating && !/^[A-Za-z0-9][A-Za-z0-9-]{2,31}$/.test(draft.code.trim())) {
      setError(label("কোডটি ৩–৩২ অক্ষরের হতে হবে (A–Z, ০–৯, -)।", "The code must be 3–32 characters (A–Z, 0–9, -)."));
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (creating) await api("/owner/coupons", "POST", { code: draft.code.trim().toUpperCase(), ...body });
      else await api(`/owner/coupons/${editingCode}`, "PUT", body);
      setMessage(label("কুপন সংরক্ষিত হয়েছে।", "Coupon saved."));
      setReason("");
      cancelForm();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const toggleActive = async (coupon: any) => {
    if (!validReason()) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(`/owner/coupons/${coupon.code}/active`, "POST", {
        active: !coupon.active,
        reason: reason.trim(),
      });
      setMessage(
        !coupon.active
          ? label("কুপন চালু হয়েছে।", "Coupon switched on.")
          : label("কুপন বন্ধ হয়েছে — আর ব্যবহার করা যাবে না।", "Coupon switched off — it can no longer be used."),
      );
      setReason("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const showHistory = async (coupon: any) => {
    if (historyFor === coupon.code) {
      setHistoryFor(null);
      setHistory([]);
      return;
    }
    try {
      const r = await api(`/owner/coupons/${coupon.code}/changes`);
      setHistory(r.items ?? []);
      setHistoryFor(coupon.code);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const discountText = (c: any) =>
    c.discountKind === "percent" ? `${n(c.discountValue)}%` : taka(c.discountValue);
  const scopeText = (c: any) =>
    c.appliesTo === "subscription"
      ? label("সাবস্ক্রিপশন", "Subscription")
      : c.appliesTo === "topup"
        ? label("টপ-আপ", "Top-up")
        : label("সাবস্ক্রিপশন ও টপ-আপ", "Subscription & top-up");

  return (
    <div className="owner-plans">
      <p className="hint">
        {label(
          "কুপন অফিসের সাবস্ক্রিপশন কেনা বা ক্রেডিট টপ-আপ অর্ডারে ছাড় দেয়। পাবলিক কুপন পোর্টালে অফার হিসেবে দেখায়; হিডেন কুপন শুধু কোড জানা অফিস ব্যবহার করতে পারে।",
          "Coupons discount an office's subscription purchase or credit top-up order. Public coupons show on the portal as offers; hidden coupons work only for an office that knows the code.",
        )}
      </p>
      <label>
        {label("পরিবর্তনের কারণ (আবশ্যক)", "Reason for the change (required)")}
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={label("কমপক্ষে ৮ অক্ষর", "At least 8 characters")}
        />
      </label>
      {message && (
        <p className="notice success" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {!creating && !editingCode && (
        <button type="button" className="secondary" disabled={busy} onClick={startCreate}>
          {label("নতুন কুপন", "New coupon")}
        </button>
      )}
      {(creating || editingCode) && (
        <form
          className="owner-plan-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h4>
            {creating
              ? label("নতুন কুপন", "New coupon")
              : `${label("কুপন সম্পাদনা", "Edit coupon")} · ${editingCode}`}
          </h4>
          {creating && (
            <label>
              {label("কোড", "Code")}
              <input
                value={draft.code}
                onChange={(e) => set({ code: e.target.value })}
                placeholder="EID-2026"
                required
              />
            </label>
          )}
          <label>
            {label("ছাড়ের ধরন", "Discount type")}
            <select
              value={draft.discountKind}
              onChange={(e) => set({ discountKind: e.target.value as Draft["discountKind"] })}
            >
              <option value="percent">{label("শতাংশ (%)", "Percentage (%)")}</option>
              <option value="fixed">{label("নির্দিষ্ট টাকা", "Fixed amount (BDT)")}</option>
            </select>
          </label>
          <label>
            {draft.discountKind === "percent"
              ? label("ছাড় (%)", "Discount (%)")
              : label("ছাড় (টাকা)", "Discount (BDT)")}
            <input
              type="number"
              min={draft.discountKind === "percent" ? 1 : 0}
              max={draft.discountKind === "percent" ? 100 : undefined}
              step={draft.discountKind === "percent" ? 1 : "0.01"}
              value={draft.discountValue}
              onChange={(e) => set({ discountValue: e.target.value })}
              required
            />
          </label>
          <label>
            {label("প্রযোজ্য", "Applies to")}
            <select
              value={draft.appliesTo}
              onChange={(e) => set({ appliesTo: e.target.value as Draft["appliesTo"] })}
            >
              <option value="both">{label("সাবস্ক্রিপশন ও টপ-আপ", "Subscription & top-up")}</option>
              <option value="subscription">{label("শুধু সাবস্ক্রিপশন", "Subscription only")}</option>
              <option value="topup">{label("শুধু টপ-আপ", "Top-up only")}</option>
            </select>
          </label>
          {draft.appliesTo !== "topup" && (
            <label>
              {label("প্ল্যান (ঐচ্ছিক)", "Plan (optional)")}
              <select value={draft.planId} onChange={(e) => set({ planId: e.target.value })}>
                <option value="">{label("সব প্ল্যান", "All plans")}</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            {label("কার্যকর শুরু", "Valid from")}
            <input
              type="datetime-local"
              value={draft.validFrom}
              onChange={(e) => set({ validFrom: e.target.value })}
              required
            />
          </label>
          <label>
            {label("মেয়াদ শেষ (খালি = সীমাহীন)", "Valid until (empty = no end)")}
            <input
              type="datetime-local"
              value={draft.validUntil}
              onChange={(e) => set({ validUntil: e.target.value })}
            />
          </label>
          <label>
            {label("মোট ব্যবহারের সীমা (খালি = সীমাহীন)", "Max total uses (empty = unlimited)")}
            <input
              type="number"
              min={1}
              value={draft.maxUses}
              onChange={(e) => set({ maxUses: e.target.value })}
            />
          </label>
          <label>
            {label("অফিসপ্রতি সীমা (খালি = সীমাহীন)", "Per-office limit (empty = unlimited)")}
            <input
              type="number"
              min={1}
              value={draft.perOfficeLimit}
              onChange={(e) => set({ perOfficeLimit: e.target.value })}
            />
          </label>
          <label>
            {label("দৃশ্যমানতা", "Visibility")}
            <select
              value={draft.visibility}
              onChange={(e) => set({ visibility: e.target.value as Draft["visibility"] })}
            >
              <option value="hidden">{label("হিডেন — শুধু কোড জানলে", "Hidden — code only")}</option>
              <option value="public">{label("পাবলিক — পোর্টালে অফার", "Public — portal offer")}</option>
            </select>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(e) => set({ active: e.target.checked })}
            />
            {label("চালু", "Active")}
          </label>
          <div className="button-row">
            <button type="submit" className="primary" disabled={busy}>
              {label("সংরক্ষণ করুন", "Save coupon")}
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={cancelForm}>
              {label("বাতিল", "Cancel")}
            </button>
          </div>
        </form>
      )}
      <div className="table-scroll">
        <table className="owner-plans-table">
          <thead>
            <tr>
              <th>{label("কোড", "Code")}</th>
              <th>{label("ছাড়", "Discount")}</th>
              <th>{label("প্রযোজ্য", "Applies to")}</th>
              <th>{label("মেয়াদ", "Validity")}</th>
              <th>{label("ব্যবহার", "Uses")}</th>
              <th>{label("দৃশ্যমানতা", "Visibility")}</th>
              <th>{label("অবস্থা", "Status")}</th>
              <th>{label("পদক্ষেপ", "Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.code}>
                <td>
                  <code>{c.code}</code>
                  {c.planId && <div className="hint">{c.planId}</div>}
                </td>
                <td>{discountText(c)}</td>
                <td>{scopeText(c)}</td>
                <td>
                  {new Date(c.validFrom).toLocaleDateString()}
                  {" → "}
                  {c.validUntil
                    ? new Date(c.validUntil).toLocaleDateString()
                    : label("সীমাহীন", "No end")}
                </td>
                <td>
                  {n(c.redemptions)}
                  {c.maxUses != null && ` / ${n(c.maxUses)}`} · {taka(c.discountTotalMinor)}
                </td>
                <td>
                  {c.visibility === "public"
                    ? label("পাবলিক", "Public")
                    : label("হিডেন", "Hidden")}
                </td>
                <td>
                  {c.active ? (
                    <StatusBadge tone="ok">{label("চালু", "Active")}</StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral">{label("বন্ধ", "Off")}</StatusBadge>
                  )}
                </td>
                <td>
                  <div className="button-row">
                    <button type="button" className="secondary" disabled={busy} onClick={() => startEdit(c)}>
                      {label("সম্পাদনা", "Edit")}
                    </button>
                    <button type="button" className="secondary" disabled={busy} onClick={() => void toggleActive(c)}>
                      {c.active ? label("বন্ধ করুন", "Switch off") : label("চালু করুন", "Switch on")}
                    </button>
                    <button type="button" className="secondary" disabled={busy} onClick={() => void showHistory(c)}>
                      {label("ইতিহাস", "History")}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan={8} className="empty-cell">{label("এখনো কোনো কুপন নেই।", "No coupons yet.")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {historyFor && (
        <div className="owner-plan-history">
          <h4>
            {label("কুপনের ইতিহাস", "Coupon history")} · {historyFor}
          </h4>
          {history.map((h, i) => (
            <p key={i} className="hint">
              {h.action} · {new Date(h.createdAt).toLocaleString()} · {h.reason}
            </p>
          ))}
          {!history.length && <p className="hint">{label("কোনো ইতিহাস নেই।", "No history.")}</p>}
        </div>
      )}
      <h4>{label("সাম্প্রতিক ব্যবহার", "Recent redemptions")}</h4>
      <div className="table-scroll">
        <table className="owner-plans-table">
          <thead>
            <tr>
              <th>{label("কুপন", "Coupon")}</th>
              <th>{label("অফিস", "Office")}</th>
              <th>{label("ছাড়", "Discount")}</th>
              <th>{label("সময়", "When")}</th>
            </tr>
          </thead>
          <tbody>
            {redemptions.map((r) => (
              <tr key={r.orderId}>
                <td>
                  <code>{r.couponCode}</code>
                </td>
                <td>{r.officeNameEn ?? r.officeSlug}</td>
                <td>{taka(r.discountMinor)}</td>
                <td>{new Date(r.createdAt).toLocaleString()}</td>
              </tr>
            ))}
            {!redemptions.length && (
              <tr>
                <td colSpan={4} className="empty-cell">{label("এখনো কোনো কুপন ব্যবহৃত হয়নি।", "No coupon has been redeemed yet.")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
