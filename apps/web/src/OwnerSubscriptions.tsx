import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { choose, recordName, useLanguage } from "./i18n.js";
import { EmptyState, StatusBadge, statusTone } from "./OwnerUi.js";

const label = (bn: string, en: string) => choose({ bn, en });
const bnDigits = (v: string) => v.replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
const n = (v: unknown) => choose({ bn: bnDigits(String(v ?? 0)), en: String(v ?? 0) });
const dayMs = 86_400_000;
export function subscriptionDaysLeft(validUntil: unknown): number | null {
  if (!validUntil) return null;
  const time = new Date(String(validUntil)).getTime();
  if (Number.isNaN(time)) return null;
  return Math.ceil((time - Date.now()) / dayMs);
}
const statusText = (status: string) =>
  status === "ACTIVE"
    ? label("সক্রিয়", "Active")
    : status === "SUSPENDED"
      ? label("স্থগিত", "Suspended")
      : label("মেয়াদোত্তীর্ণ", "Expired");
const dateText = (value: unknown) =>
  value ? new Date(String(value)).toLocaleDateString(choose({ bn: "bn-BD", en: "en-GB" })) : "—";

/** Plan · status · valid-until · days left for one office, red when expired/suspended or within a week of expiry. */
export function SubscriptionBadge({ subscription }: { subscription: any }) {
  useLanguage();
  if (!subscription) return null;
  const days = subscriptionDaysLeft(subscription.validUntil);
  const urgent = subscription.status !== "ACTIVE" || (days !== null && days <= 7);
  // OWNER-REDESIGN-01: labelled fields + a status badge, never concatenated text.
  return (
    <div className="subscription-badge" data-urgent={urgent || undefined}>
      <div className="labelled-fields">
        <div className="labelled-field">
          <span className="field-label">{label("প্ল্যান", "Plan")}</span>
          <span className="field-value">{subscription.planId}</span>
        </div>
        <div className="labelled-field">
          <span className="field-label">{label("সাবস্ক্রিপশনের অবস্থা", "Subscription status")}</span>
          <span className="field-value">
            <StatusBadge tone={statusTone(subscription.status)}>
              {statusText(subscription.status)}
            </StatusBadge>
          </span>
        </div>
        <div className="labelled-field">
          <span className="field-label">{label("মেয়াদ", "Valid until")}</span>
          <span className="field-value">{dateText(subscription.validUntil)}</span>
        </div>
        {days !== null && (
          <div className="labelled-field">
            <span className="field-label">{label("বাকি সময়", "Time left")}</span>
            <span className="field-value">
              {days >= 0
                ? `${n(days)} ${label("দিন বাকি", "days left")}`
                : `${n(-days)} ${label("দিন আগে শেষ", "days past expiry")}`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

type Action = "activate" | "extend" | "set_expiry" | "suspend" | "change_plan";
const ACTION_LABELS: Record<Action, () => string> = {
  activate: () => label("সক্রিয় করুন", "Activate"),
  extend: () => label("মেয়াদ বাড়ান", "Extend"),
  set_expiry: () => label("মেয়াদ নির্ধারণ করুন", "Set expiry"),
  suspend: () => label("স্থগিত করুন", "Suspend"),
  change_plan: () => label("প্ল্যান বদলান", "Change plan"),
};

/**
 * Phase 3A: the per-office subscription panel beside the credit adjust form.
 * Every action posts to POST /owner/tenants/:id/subscription with the
 * mandatory reason; the server writes the audit event with before/after.
 */
export function OwnerSubscriptionPanel({
  tenantId,
  subscription,
  plans,
  onChanged,
}: {
  tenantId: string;
  subscription: any;
  plans: any[];
  onChanged: () => Promise<void> | void;
}) {
  useLanguage();
  const [action, setAction] = useState<Action>("activate");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const planOptions = plans.length
    ? plans
    : [{ id: subscription?.planId ?? "standard-monthly", name: subscription?.planId ?? "standard-monthly" }];
  return (
    <div className="subscription-panel">
      <h4>{label("সাবস্ক্রিপশন ব্যবস্থাপনা", "Subscription management")}</h4>
      <SubscriptionBadge subscription={subscription} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget,
            data = new FormData(form);
          const body: Record<string, unknown> = {
            action,
            reason: data.get("reason"),
          };
          if (action === "activate" || action === "change_plan")
            body.planId = data.get("planId");
          if (action === "activate" || action === "extend") {
            const days = Number(data.get("days"));
            if (days) body.days = days;
          }
          if (action === "set_expiry") {
            const until = data.get("validUntil");
            if (until) body.validUntil = new Date(String(until)).toISOString();
            const status = data.get("status");
            if (status) body.status = status;
          }
          if (action === "activate" || action === "change_plan")
            body.grantCredits = data.get("grantCredits") === "on";
          setBusy(true);
          setMessage("");
          setError("");
          api(`/owner/tenants/${tenantId}/subscription`, "POST", body)
            .then(async () => {
              form.reset();
              setMessage(label("সাবস্ক্রিপশন হালনাগাদ হয়েছে।", "Subscription updated."));
              await onChanged();
            })
            .catch((err) => setError((err as Error).message))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          {label("পদক্ষেপ", "Action")}
          <select
            name="action"
            value={action}
            onChange={(e) => setAction(e.target.value as Action)}
          >
            {(Object.keys(ACTION_LABELS) as Action[]).map((a) => (
              <option key={a} value={a}>
                {ACTION_LABELS[a]()}
              </option>
            ))}
          </select>
        </label>
        {(action === "activate" || action === "change_plan") && (
          <label>
            {label("প্ল্যান", "Plan")}
            <select name="planId" defaultValue={subscription?.planId ?? "standard-monthly"}>
              {planOptions.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.name ?? p.id}
                </option>
              ))}
            </select>
          </label>
        )}
        {(action === "activate" || action === "extend") && (
          <label>
            {label("দিন (ঐচ্ছিক)", "Days (optional)")}
            <input name="days" type="number" min={1} max={3650} placeholder={action === "extend" ? "30" : ""} />
          </label>
        )}
        {action === "set_expiry" && (
          <>
            <label>
              {label("মেয়াদ শেষের তারিখ", "Valid until")}
              <input name="validUntil" type="datetime-local" required />
            </label>
            <label>
              {label("অবস্থা", "Status")}
              <select name="status" defaultValue="">
                <option value="">{label("তারিখ অনুযায়ী স্বয়ংক্রিয়", "Automatic from the date")}</option>
                <option value="ACTIVE">{label("সক্রিয়", "Active")}</option>
                <option value="EXPIRED">{label("মেয়াদোত্তীর্ণ", "Expired")}</option>
                <option value="SUSPENDED">{label("স্থগিত", "Suspended")}</option>
              </select>
            </label>
          </>
        )}
        {(action === "activate" || action === "change_plan") && (
          <label className="checkbox-label">
            <input
              name="grantCredits"
              type="checkbox"
              defaultChecked={action === "activate"}
            />{" "}
            {label("প্ল্যানের ক্রেডিট দিন", "Grant the plan credits")}
          </label>
        )}
        <label>
          {label("সাবস্ক্রিপশনের কারণ", "Subscription reason")}
          <input name="reason" required minLength={8} maxLength={500} />
        </label>
        <button disabled={busy}>{ACTION_LABELS[action]()}</button>
        {message && (
          <p role="status" className="working">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}

/**
 * Phase 3A: every payment order waiting on the owner, across offices, with
 * manual settle/cancel. Settle runs the same settlement effects as the
 * gateway webhook; both actions demand a reason and are audited.
 */
export function OwnerPendingOrders() {
  useLanguage();
  const [status, setStatus] = useState("PENDING");
  const [orders, setOrders] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const load = () =>
    api(`/owner/payment-orders?status=${status}`)
      .then((r) => setOrders(r.items ?? []))
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);
  const decide = (order: any, decision: "settle" | "cancel", reason: string) => {
    setBusyId(order.id);
    setError("");
    api(`/owner/payment-orders/${order.id}/${decision}`, "POST", { reason })
      .then(() => load())
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusyId(""));
  };
  return (
    <section className="panel">
      <h3>{label("পেমেন্ট অর্ডার", "Payment orders")}</h3>
      <p>
        {label(
          "অপেক্ষমাণ অর্ডার ম্যানুয়ালি নিষ্পত্তি বা বাতিল করুন — নিষ্পত্তি গেটওয়ে ওয়েবহুকের মতোই ক্রেডিট ও সাবস্ক্রিপশন কার্যকর করে। প্রতিটি সিদ্ধান্তে কারণ আবশ্যক এবং অডিট লগে থাকে।",
          "Settle or cancel waiting orders manually — settling applies credits and subscription exactly like the gateway webhook. Every decision needs a reason and is audit-logged.",
        )}
      </p>
      <label>
        {label("অবস্থা", "Status")}
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="PENDING">{label("অপেক্ষমাণ", "Pending")}</option>
          <option value="SETTLED">{label("নিষ্পত্তি হয়েছে", "Settled")}</option>
          <option value="CANCELLED">{label("বাতিল", "Cancelled")}</option>
          <option value="ALL">{label("সব", "All")}</option>
        </select>
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {orders.length === 0 ? (
        <EmptyState
          title={label("এই অবস্থায় কোনো অর্ডার নেই।", "No orders in this state.")}
          hint={label(
            "নতুন অর্ডার এলে এখানে দেখা যাবে।",
            "New orders will appear here.",
          )}
        />
      ) : (
        orders.map((order) => (
          <div className="tenant-card" key={order.id}>
            <h3>
              {recordName({ nameBn: order.tenantNameBn, nameEn: order.tenantNameEn }) ||
                order.tenantSlug}
            </h3>
            <div className="labelled-fields">
              <div className="labelled-field">
                <span className="field-label">{label("ধরন", "Type")}</span>
                <span className="field-value">
                  {order.kind === "subscription"
                    ? `${label("সাবস্ক্রিপশন", "Subscription")} · ${order.planId ?? ""}`
                    : label("ক্রেডিট টপ-আপ", "Credit top-up")}
                </span>
              </div>
              <div className="labelled-field">
                <span className="field-label">{label("ক্রেডিট", "Credits")}</span>
                <span className="field-value">{n(order.credits)}</span>
              </div>
              <div className="labelled-field">
                <span className="field-label">{label("পরিমাণ", "Amount")}</span>
                <span className="field-value">
                  {n(order.amountMinor)} {label("পয়সা", "poisha")}
                </span>
              </div>
              <div className="labelled-field">
                <span className="field-label">{label("তারিখ", "Date")}</span>
                <span className="field-value">{dateText(order.createdAt)}</span>
              </div>
              <div className="labelled-field">
                <span className="field-label">{label("অবস্থা", "Status")}</span>
                <span className="field-value">
                  <StatusBadge tone={statusTone(order.status)}>
                    {order.status === "PENDING"
                      ? label("অপেক্ষমাণ", "Pending")
                      : order.status === "SETTLED"
                        ? label("নিষ্পত্তি হয়েছে", "Settled")
                        : order.status === "CANCELLED"
                          ? label("বাতিল", "Cancelled")
                          : order.status}
                  </StatusBadge>
                </span>
              </div>
            </div>
            {order.status === "PENDING" && (
              <form onSubmit={(e) => e.preventDefault()}>
                <label>
                  {label("অর্ডারের কারণ", "Order reason")}
                  <input name="reason" required minLength={8} maxLength={500} />
                </label>
                <button
                  type="button"
                  disabled={busyId === order.id}
                  onClick={(e) => {
                    const form = e.currentTarget.form;
                    if (form && !form.reportValidity()) return;
                    decide(order, "settle", String(new FormData(form!).get("reason")));
                  }}
                >
                  {label("নিষ্পত্তি করুন", "Settle")}
                </button>{" "}
                <button
                  type="button"
                  className="danger"
                  disabled={busyId === order.id}
                  onClick={(e) => {
                    const form = e.currentTarget.form;
                    if (form && !form.reportValidity()) return;
                    decide(order, "cancel", String(new FormData(form!).get("reason")));
                  }}
                >
                  {label("বাতিল করুন", "Cancel")}
                </button>
              </form>
            )}
          </div>
        ))
      )}
    </section>
  );
}
