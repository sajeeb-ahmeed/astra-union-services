import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { choose, useLanguage } from "./i18n.js";
import { money } from "./ApplicationOrder.js";

const label = (bn: string, en: string) => choose({ bn, en });
export const refundStatusLabel = (status: string) =>
  ({
    REQUESTED: label("অনুরোধ করা হয়েছে", "Requested"),
    APPROVED: label("অনুমোদিত", "Approved"),
    SENT: label("ফেরত পাঠানো হচ্ছে", "Being refunded"),
    SETTLED: label("ফেরত সম্পন্ন", "Refunded"),
    REJECTED: label("বাতিল", "Rejected"),
    FAILED: label("ফেরত ব্যর্থ", "Refund failed"),
  })[status] ?? status;

/** Phase 5d: refund state and request form for one paid application. */
export function ApplicationRefunds({ applicationId, canRequest }: { applicationId: string; canRequest: boolean }) {
  useLanguage();
  const [items, setItems] = useState<any[]>([]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const load = () =>
    api(`/applications/${applicationId}/refunds`)
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  useEffect(() => {
    void load();
  }, [applicationId]);
  const live = items.find((r) => !["REJECTED", "FAILED"].includes(r.status));
  return (
    <div className="application-refunds">
      {items.map((r) => (
        <p key={r.id} className="refund-row">
          {label("ফেরত", "Refund")}: <strong>{refundStatusLabel(r.status)}</strong> · {money(r.amountMinor)} ৳
          {r.expectedBy && r.status === "SENT"
            ? ` · ${label("সাধারণত ৩–৫ কর্মদিবসে; প্রত্যাশিত", "usually 3–5 working days; expected by")} ${r.expectedBy}`
            : ""}
          {r.decisionNote ? ` · ${r.decisionNote}` : ""}
        </p>
      ))}
      {canRequest && !live && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setMessage("");
            api(`/applications/${applicationId}/refunds`, "POST", { reason: reason.trim() })
              .then(() => {
                setReason("");
                setMessage(label("ফেরতের অনুরোধ পাঠানো হয়েছে।", "Refund request sent."));
                return load();
              })
              .catch((err) => setMessage((err as Error).message))
              .finally(() => setBusy(false));
          }}
        >
          <label htmlFor={`refund-reason-${applicationId}`}>{label("ফেরতের কারণ", "Reason for a refund")}</label>
          <input
            id={`refund-reason-${applicationId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            minLength={5}
            maxLength={255}
          />
          <button className="secondary" disabled={busy}>
            {label("ফি ফেরতের অনুরোধ করুন", "Ask for a refund")}
          </button>
        </form>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}

/** Phase 5d: the office's refund requests for admin and finance. */
export function OfficeRefunds() {
  useLanguage();
  const [items, setItems] = useState<any[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [allowed, setAllowed] = useState(true);
  const load = () =>
    api("/refunds")
      .then((r) => setItems(r.items))
      .catch(() => setAllowed(false));
  useEffect(() => {
    void load();
  }, []);
  if (!allowed) return null;
  const act = (path: string, body: any, done: string) => {
    setBusy(true);
    setMessage("");
    api(path, "POST", body)
      .then(() => {
        setMessage(done);
        return load();
      })
      .catch((err) => setMessage((err as Error).message))
      .finally(() => setBusy(false));
  };
  return (
    <section className="panel office-refunds">
      <h2>{label("ফি ফেরত", "Fee refunds")}</h2>
      {message && <p role="status">{message}</p>}
      {items.length === 0 ? (
        <p>{label("কোনো ফেরতের অনুরোধ নেই।", "No refund requests.")}</p>
      ) : (
        items.map((r) => (
          <article key={r.id} className="refund-item">
            <p>
              <strong>{refundStatusLabel(r.status)}</strong> · {money(r.amountMinor)} ৳ · <code>{r.applicationId.slice(0, 8)}</code>
            </p>
            <p>{r.reason}</p>
            {r.status === "REQUESTED" && (
              <>
                <label htmlFor={`refund-note-${r.id}`}>{label("মন্তব্য (বাতিলে বাধ্যতামূলক)", "Note (required to reject)")}</label>
                <input
                  id={`refund-note-${r.id}`}
                  value={notes[r.id] ?? ""}
                  maxLength={500}
                  onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                />
                <div className="actions">
                  <button
                    disabled={busy}
                    onClick={() =>
                      act(`/refunds/${r.id}/decision`, { decision: "APPROVED" }, label("অনুমোদিত ও পাঠানো হয়েছে।", "Approved and sent."))
                    }
                  >
                    {label("অনুমোদন করুন", "Approve")}
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      act(
                        `/refunds/${r.id}/decision`,
                        { decision: "REJECTED", ...(notes[r.id]?.trim() ? { note: notes[r.id].trim() } : {}) },
                        label("বাতিল করা হয়েছে।", "Rejected."),
                      )
                    }
                  >
                    {label("বাতিল করুন", "Reject")}
                  </button>
                </div>
              </>
            )}
            {r.status === "SENT" && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => act(`/refunds/${r.id}/refresh`, {}, label("অবস্থা হালনাগাদ হয়েছে।", "Status updated."))}
              >
                {label("অবস্থা যাচাই করুন", "Check status")}
              </button>
            )}
          </article>
        ))
      )}
    </section>
  );
}
