import React, { useEffect, useState } from "react";
import { api, items } from "./api.js";
import { choose, useLanguage } from "./i18n.js";
import "./office-registration.css";

/** Phase 2d: the platform owner verifies office staff who registered for a post. */
export function OwnerAccountRequests() {
  useLanguage();
  const [status, setStatus] = useState<"PENDING" | "APPROVED" | "REJECTED">("PENDING");
  const [rows, setRows] = useState<any[] | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () =>
    api(`/owner/account-requests?status=${status}`)
      .then((r) => setRows(items(r)))
      .catch((e) => setMessage((e as Error).message));
  useEffect(() => {
    setRows(null);
    void load();
  }, [status]);
  async function decide(id: string, decision: "approve" | "reject") {
    setBusy(true);
    setMessage("");
    try {
      await api(`/owner/account-requests/${id}/decision`, "POST", {
        decision,
        ...(decision === "reject" ? { reason } : {}),
      });
      setRejecting(null);
      setReason("");
      await load();
      setMessage(
        decision === "approve"
          ? choose({ bn: "অনুমোদিত। এখন তিনি লগইন করতে পারবেন।", en: "Approved. They can now sign in." })
          : choose({ bn: "প্রত্যাখ্যাত।", en: "Rejected." }),
      );
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel owner-requests" aria-labelledby="owner-requests-title">
      <h2 id="owner-requests-title">
        {choose({ bn: "অফিস অ্যাকাউন্ট যাচাই", en: "Office account verification" })}
      </h2>
      <p>
        {choose({
          bn: "পদ অনুযায়ী নিবন্ধিত কর্মকর্তারা আপনার অনুমোদনের পরেই লগইন করতে পারেন। অনুমোদন পদের ভূমিকা দেয়; চেয়ারম্যান/মেয়রের সেবাভিত্তিক অনুমোদন আলাদাভাবে দিতে হয়।",
          en: "Staff who registered for a post can sign in only after you approve them. Approval grants the post's role; a Chairman or Mayor still needs per-service approval authorizations.",
        })}
      </p>
      <label htmlFor="owner-requests-status">
        {choose({ bn: "অবস্থা", en: "Status" })}{" "}
        <select id="owner-requests-status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="PENDING">{choose({ bn: "অপেক্ষমাণ", en: "Pending" })}</option>
          <option value="APPROVED">{choose({ bn: "অনুমোদিত", en: "Approved" })}</option>
          <option value="REJECTED">{choose({ bn: "প্রত্যাখ্যাত", en: "Rejected" })}</option>
        </select>
      </label>
      {rows === null ? (
        <p>{choose({ bn: "লোড হচ্ছে…", en: "Loading…" })}</p>
      ) : rows.length === 0 ? (
        <p>{choose({ bn: "কোনো আবেদন নেই।", en: "No requests." })}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{choose({ bn: "আবেদনকারী", en: "Applicant" })}</th>
                <th>{choose({ bn: "অফিস", en: "Office" })}</th>
                <th>{choose({ bn: "পদ ও ভূমিকা", en: "Post and role" })}</th>
                <th>{choose({ bn: "সিদ্ধান্ত", en: "Decision" })}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.displayName}
                    <small>{r.email}</small>
                    {r.mobileHint && <small>{r.mobileHint}</small>}
                  </td>
                  <td>{choose({ bn: r.officeBn, en: r.officeEn })}</td>
                  <td>
                    {choose({ bn: r.accountTypeBn, en: r.accountTypeEn })}
                    <small>{r.role}</small>
                  </td>
                  <td>
                    {r.status === "PENDING" ? (
                      <>
                        <button type="button" disabled={busy} onClick={() => decide(r.id, "approve")}>
                          {choose({ bn: "অনুমোদন", en: "Approve" })}
                        </button>{" "}
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy}
                          onClick={() => {
                            setRejecting(r.id);
                            setReason("");
                          }}
                        >
                          {choose({ bn: "প্রত্যাখ্যান", en: "Reject" })}
                        </button>
                        {rejecting === r.id && (
                          <div className="reject-reason">
                            <input
                              aria-label={choose({ bn: "প্রত্যাখ্যানের কারণ", en: "Reason for rejection" })}
                              minLength={8}
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                            />
                            <button
                              type="button"
                              className="danger"
                              disabled={busy || reason.trim().length < 8}
                              onClick={() => decide(r.id, "reject")}
                            >
                              {choose({ bn: "প্রত্যাখ্যান নিশ্চিত", en: "Confirm rejection" })}
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        {r.status}
                        {r.reason && <small>{r.reason}</small>}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
