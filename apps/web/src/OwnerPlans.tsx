import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { choose, useLanguage } from "./i18n.js";

const label = (bn: string, en: string) => choose({ bn, en });
const bnDigits = (v: string) => v.replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
const n = (v: unknown) => choose({ bn: bnDigits(String(v ?? 0)), en: String(v ?? 0) });
const taka = (minor: number) =>
  choose({
    bn: `৳${bnDigits(String(minor / 100))}`,
    en: `BDT ${minor / 100}`,
  });
const durationText = (days: number) => {
  if (days === 365) return `${n(12)} ${label("মাস", "months")}`;
  if (days % 30 === 0 && days <= 360)
    return `${n(days / 30)} ${label("মাস", "months")} · ${n(days)} ${label("দিন", "days")}`;
  return `${n(days)} ${label("দিন", "days")}`;
};
const DURATION_PRESETS = [
  { days: 30, bn: "১ মাস", en: "1 month" },
  { days: 90, bn: "৩ মাস", en: "3 months" },
  { days: 180, bn: "৬ মাস", en: "6 months" },
  { days: 365, bn: "১২ মাস", en: "12 months" },
];

type Draft = {
  name: string;
  days: string;
  priceBdt: string;
  allowanceUnlimited: boolean;
  allowance: string;
  grant: string;
  sortOrder: string;
  onSale: boolean;
  rollover: boolean;
};
const emptyDraft: Draft = {
  name: "",
  days: "30",
  priceBdt: "0",
  allowanceUnlimited: true,
  allowance: "100",
  grant: "20",
  sortOrder: "0",
  onSale: true,
  rollover: true,
};

/**
 * Phase 3C: the owner's Plans screen — the subscription catalogue itself. The owner
 * creates and edits plans (duration, price, monthly submitted-application allowance,
 * activation grant, on-sale) with no code change; every save carries a mandatory
 * reason into the plan's audit history. Editing a plan never rewrites a running
 * subscription: its terms were snapshotted at activation and are enforced from there.
 */
export function OwnerPlans() {
  useLanguage();
  const [items, setItems] = useState<any[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [reason, setReason] = useState("");
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = () =>
    api("/owner/plans")
      .then((r) => setItems(r.items ?? []))
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
  }, []);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const startCreate = () => {
    setDraft(emptyDraft);
    setEditingId(null);
    setCreating(true);
    setMessage("");
    setError("");
  };
  const startEdit = (plan: any) => {
    setDraft({
      name: plan.name,
      days: String(plan.durationDays),
      priceBdt: String(plan.priceMinor / 100),
      allowanceUnlimited: plan.monthlyAllowanceLimit == null,
      allowance: String(plan.monthlyAllowanceLimit ?? 100),
      grant: String(plan.grantCredits),
      sortOrder: String(plan.sortOrder),
      onSale: plan.onSale,
      rollover: plan.rollover,
    });
    setEditingId(plan.id);
    setCreating(false);
    setMessage("");
    setError("");
  };
  const cancelForm = () => {
    setCreating(false);
    setEditingId(null);
  };
  const validReason = () => {
    if (reason.trim().length < 8) {
      setError(label("কারণ আবশ্যক (কমপক্ষে ৮ অক্ষর)।", "A reason is required (at least 8 characters)."));
      return false;
    }
    return true;
  };
  const draftBody = () => {
    const days = Number(draft.days);
    const priceMinor = Math.round(Number(draft.priceBdt) * 100);
    const allowance = draft.allowanceUnlimited ? null : Number(draft.allowance);
    const grant = Number(draft.grant);
    const sortOrder = Number(draft.sortOrder);
    if (!draft.name.trim()) throw new Error(label("প্ল্যানের নাম দিন।", "Give the plan a name."));
    if (!Number.isInteger(days) || days < 1 || days > 3650)
      throw new Error(label("মেয়াদ ১ থেকে ৩৬৫০ দিনের মধ্যে হতে হবে।", "Duration must be a whole number of days between 1 and 3650."));
    if (!Number.isInteger(priceMinor) || priceMinor < 0)
      throw new Error(label("মূল্য ০ বা তার বেশি হতে হবে।", "The price must be 0 or more."));
    if (allowance !== null && (!Number.isInteger(allowance) || allowance < 1))
      throw new Error(label("মাসিক সীমা কমপক্ষে ১ হতে হবে, অথবা সীমাহীন রাখুন।", "The monthly limit must be at least 1, or keep it unlimited."));
    if (!Number.isInteger(grant) || grant < 1)
      throw new Error(label("গ্রান্ট ক্রেডিট কমপক্ষে ১ হতে হবে।", "Grant credits must be at least 1."));
    if (!Number.isInteger(sortOrder))
      throw new Error(label("ক্রম একটি পূর্ণসংখ্যা হতে হবে।", "Sort order must be a whole number."));
    return {
      name: draft.name.trim(),
      durationDays: days,
      priceMinor,
      grantCredits: grant,
      monthlyAllowanceLimit: allowance,
      onSale: draft.onSale,
      sortOrder,
      rollover: draft.rollover,
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
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (creating) await api("/owner/plans", "POST", body);
      else await api(`/owner/plans/${editingId}`, "PUT", body);
      setMessage(label("প্ল্যান সংরক্ষিত হয়েছে।", "Plan saved."));
      setReason("");
      cancelForm();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const toggleSale = async (plan: any) => {
    if (!validReason()) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(`/owner/plans/${plan.id}/on-sale`, "POST", {
        onSale: !plan.onSale,
        reason: reason.trim(),
      });
      setMessage(
        !plan.onSale
          ? label("প্ল্যান বিক্রয়ের জন্য চালু হয়েছে।", "Plan is now on sale.")
          : label("প্ল্যান লুকানো হয়েছে — নতুন অর্ডার নেওয়া হবে না।", "Plan hidden — no new orders will be taken."),
      );
      setReason("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const showHistory = async (plan: any) => {
    if (historyFor === plan.id) {
      setHistoryFor(null);
      setHistory([]);
      return;
    }
    try {
      const r = await api(`/owner/plans/${plan.id}/changes`);
      setHistory(r.items ?? []);
      setHistoryFor(plan.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const formOpen = creating || editingId !== null;
  return (
    <section className="panel">
      <h2>{label("সাবস্ক্রিপশন প্ল্যান", "Subscription plans")}</h2>
      <p>
        {label(
          "প্ল্যান তৈরি, মূল্য, মেয়াদ ও মাসিক সীমা এখান থেকেই বদলান — কোড বদলাতে হয় না। চলমান সাবস্ক্রিপশনের শর্ত সক্রিয়করণের সময়ই সংরক্ষিত থাকে, তাই প্ল্যান বদলালে চলমান মেয়াদের শর্ত বদলায় না। লুকানো প্ল্যানে নতুন অর্ডার হয় না, তবে চলমান সাবস্ক্রিপশন আগের মতোই চলে।",
          "Create plans and change price, duration and the monthly limit here — no code change needed. A running subscription keeps the terms snapshotted at its activation, so editing a plan never rewrites a current period. A hidden plan takes no new orders, while existing subscriptions carry on unchanged.",
        )}
      </p>
      <label>
        {label("পরিবর্তনের কারণ (সব পরিবর্তনের জন্য আবশ্যক)", "Reason for the change (required for every change)")}
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          minLength={8}
          maxLength={500}
          placeholder={label("যেমন: নতুন বার্ষিক অফার চালু", "e.g. Launching the new yearly offer")}
        />
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="working">
          {message}
        </p>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{label("প্ল্যান", "Plan")}</th>
              <th>{label("মেয়াদ", "Duration")}</th>
              <th>{label("মূল্য", "Price")}</th>
              <th>{label("মাসিক সীমা", "Monthly limit")}</th>
              <th>{label("গ্রান্ট ক্রেডিট", "Grant credits")}</th>
              <th>{label("অবস্থা", "Status")}</th>
              <th>{label("পদক্ষেপ", "Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((plan) => (
              <tr key={plan.id}>
                <td>
                  {plan.name}
                  <br />
                  <small>{plan.id}</small>
                </td>
                <td>{durationText(plan.durationDays)}</td>
                <td>{taka(plan.priceMinor)}</td>
                <td>
                  {plan.monthlyAllowanceLimit == null
                    ? label("সীমাহীন", "Unlimited")
                    : `${n(plan.monthlyAllowanceLimit)} ${label("টি আবেদন", "applications")}`}
                </td>
                <td>{n(plan.grantCredits)}</td>
                <td>
                  {plan.onSale ? label("বিক্রয় চলছে", "On sale") : label("লুকানো", "Hidden")}
                </td>
                <td>
                  <button type="button" className="secondary" disabled={busy} onClick={() => startEdit(plan)}>
                    {label("সম্পাদনা", "Edit")}
                  </button>{" "}
                  <button type="button" className="secondary" disabled={busy} onClick={() => void toggleSale(plan)}>
                    {plan.onSale ? label("লুকান", "Hide") : label("বিক্রয়ে দিন", "Put on sale")}
                  </button>{" "}
                  <button type="button" className="secondary" disabled={busy} onClick={() => void showHistory(plan)}>
                    {label("ইতিহাস", "History")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {historyFor && (
        <div className="plan-history">
          <h3>
            {label("পরিবর্তনের ইতিহাস", "Change history")} · {historyFor}
          </h3>
          {history.length === 0 ? (
            <p>{label("কোনো পরিবর্তন রেকর্ড হয়নি।", "No changes recorded.")}</p>
          ) : (
            <ul>
              {history.map((h, i) => (
                <li key={i}>
                  {h.action} · {new Date(h.createdAt).toLocaleString(choose({ bn: "bn-BD", en: "en-GB" }))} ·{" "}
                  {h.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {!formOpen && (
        <button type="button" disabled={busy} onClick={startCreate}>
          {label("নতুন প্ল্যান তৈরি করুন", "Create a new plan")}
        </button>
      )}
      {formOpen && (
        <form
          className="plan-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h3>
            {creating
              ? label("নতুন প্ল্যান", "New plan")
              : `${label("প্ল্যান সম্পাদনা", "Edit plan")} · ${editingId}`}
          </h3>
          <label>
            {label("প্ল্যানের নাম", "Plan name")}
            <input value={draft.name} onChange={(e) => set({ name: e.target.value })} required maxLength={120} />
          </label>
          <label>
            {label("মেয়াদ (দিন)", "Duration (days)")}
            <input
              type="number"
              min={1}
              max={3650}
              value={draft.days}
              onChange={(e) => set({ days: e.target.value })}
              required
            />
          </label>
          <div className="actions">
            {DURATION_PRESETS.map((p) => (
              <button
                key={p.days}
                type="button"
                className="secondary"
                onClick={() => set({ days: String(p.days) })}
              >
                {label(p.bn, p.en)}
              </button>
            ))}
          </div>
          <label>
            {label("মূল্য (টাকা)", "Price (BDT)")}
            <input
              type="number"
              min={0}
              step="0.01"
              value={draft.priceBdt}
              onChange={(e) => set({ priceBdt: e.target.value })}
              required
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.allowanceUnlimited}
              onChange={(e) => set({ allowanceUnlimited: e.target.checked })}
            />{" "}
            {label("মাসিক সীমা সীমাহীন", "Monthly limit unlimited")}
          </label>
          {!draft.allowanceUnlimited && (
            <label>
              {label("মাসে সর্বোচ্চ জমা দেওয়া আবেদন", "Maximum submitted applications per month")}
              <input
                type="number"
                min={1}
                max={100000}
                value={draft.allowance}
                onChange={(e) => set({ allowance: e.target.value })}
                required
              />
            </label>
          )}
          <label>
            {label("সক্রিয়করণে গ্রান্ট ক্রেডিট", "Grant credits on activation")}
            <input
              type="number"
              min={1}
              max={100000}
              value={draft.grant}
              onChange={(e) => set({ grant: e.target.value })}
              required
            />
          </label>
          <label>
            {label("প্রদর্শনের ক্রম", "Display order")}
            <input
              type="number"
              value={draft.sortOrder}
              onChange={(e) => set({ sortOrder: e.target.value })}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.onSale}
              onChange={(e) => set({ onSale: e.target.checked })}
            />{" "}
            {label("বিক্রয়ের জন্য চালু", "On sale")}
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.rollover}
              onChange={(e) => set({ rollover: e.target.checked })}
            />{" "}
            {label("অব্যবহৃত ক্রেডিট পরের মেয়াদে যাবে", "Unused credits roll over")}
          </label>
          <div className="actions">
            <button type="submit" disabled={busy}>
              {label("সংরক্ষণ করুন", "Save plan")}
            </button>{" "}
            <button type="button" className="secondary" disabled={busy} onClick={cancelForm}>
              {label("বাতিল", "Cancel")}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
