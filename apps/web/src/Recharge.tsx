import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { choose, useLanguage } from "./i18n.js";
import { EmptyState } from "./OwnerUi.js";
import { points } from "./PointsWallet.js";

const label = (bn: string, en: string) => choose({ bn, en });
const statusLabel = (status: string) =>
  ({
    PENDING: label("যাচাইয়ের অপেক্ষায়", "Waiting for confirmation"),
    CONFIRMED: label("নিশ্চিত, পয়েন্ট যোগ হয়েছে", "Confirmed, points added"),
    REJECTED: label("বাতিল", "Rejected"),
  })[status] ?? status;

/** Phase 5b (W-016): points recharge is PAUSED — the request form is gone
 * and only the request history remains. New deposits are refused by the API
 * (410 POINTS_RECHARGE_DISABLED) because points have no spend path. */
export function RechargeRequests() {
  useLanguage();
  const [requests, setRequests] = useState<any[]>([]);
  const [allowed, setAllowed] = useState(true);
  const load = async () => {
    const r = await api("/recharges");
    setRequests(r.items);
  };
  useEffect(() => {
    load().catch(() => setAllowed(false));
  }, []);
  if (!allowed) return null;
  return (
    <div className="recharge">
      <h3>{label("ব্যাংক জমা দিয়ে রিচার্জ", "Recharge by bank deposit")}</h3>
      <p className="notice message error" role="status">
        {label(
          "পয়েন্ট রিচার্জ আপাতত বন্ধ আছে — পয়েন্ট খরচের কোনো পথ এখন নেই, তাই নতুন জমা নেওয়া হচ্ছে না। আগের অনুরোধগুলোর অবস্থা নিচে দেখা যাবে।",
          "Points recharge is paused — points currently have no spend path, so no new deposits are accepted. Earlier requests are listed below.",
        )}
      </p>
      {requests.length > 0 && (
        <div className="table-wrap">
          <table className="recharge-requests">
            <thead>
              <tr>
                <th scope="col">{label("রেফারেন্স", "Reference")}</th>
                <th scope="col">{label("পরিমাণ", "Amount")}</th>
                <th scope="col">{label("অবস্থা", "Status")}</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <th scope="row">{r.depositReference}</th>
                  <td>{points(r.amountMinor)}</td>
                  <td>
                    {statusLabel(r.status)}
                    {r.decisionNote ? ` · ${r.decisionNote}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


/** Phase 5b: the owner's recharge queue — view the clean slip, then confirm or reject. */
export function OwnerRecharges() {
  useLanguage();
  const [items, setItems] = useState<any[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const load = async () => setItems((await api("/owner/recharges")).items);
  useEffect(() => {
    load().catch((e) => setMessage((e as Error).message));
  }, []);
  async function decide(item: any, decision: "CONFIRMED" | "REJECTED") {
    setBusy(true);
    setMessage("");
    try {
      await api(`/owner/recharges/${item.id}/decision`, "POST", {
        tenantId: item.tenantId,
        decision,
        ...(notes[item.id]?.trim() ? { note: notes[item.id].trim() } : {}),
      });
      await load();
      setMessage(decision === "CONFIRMED" ? label("নিশ্চিত করা হয়েছে; পয়েন্ট যোগ হয়েছে।", "Confirmed; points added.") : label("বাতিল করা হয়েছে।", "Rejected."));
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel owner-recharges">
      <h3>{label("রিচার্জের অনুরোধ", "Recharge requests")}</h3>
      {/* W-016: new requests are paused (no points spend path). The queue
          below holds only pre-pause requests — decide them here; their
          deposits were already made. */}
      <p className="notice message error" role="status">
        {label(
          "নতুন রিচার্জ অনুরোধ বন্ধ আছে — পয়েন্ট খরচের পথ না থাকায় অফিস আর নতুন জমা পাঠাতে পারে না। বিরতির আগের অনুরোধগুলো এখানেই নিষ্পত্তি করুন।",
          "New recharge requests are paused — with no points spend path, offices cannot send new deposits. Decide the pre-pause requests still waiting here.",
        )}
      </p>
      {message && <p role="status">{message}</p>}
      {items.length === 0 ? (
        <EmptyState
          title={label("অপেক্ষমাণ কোনো অনুরোধ নেই।", "No pending requests.")}
          hint={label(
            "অফিসের রিচার্জ অনুরোধ এলে এখানে দেখা যাবে।",
            "Office recharge requests will appear here.",
          )}
        />
      ) : (
        items.map((item) => (
          <article key={item.id} className="recharge-item">
            <h3>
              {choose({ bn: item.officeNameBn, en: item.officeNameEn })} · {points(item.amountMinor)}
            </h3>
            <p>
              {item.bankCode} · <code>{item.depositReference}</code> · {item.depositDate}
            </p>
            <a href={`/api/v1/owner/recharges/${item.id}/proof?tenantId=${item.tenantId}`} target="_blank" rel="noopener">
              {label("রসিদ দেখুন (নিরাপত্তা পরীক্ষার পরে)", "Open slip (after its security check)")}
            </a>
            <div className="field">
              <label htmlFor={`recharge-note-${item.id}`}>{label("মন্তব্য (বাতিলে বাধ্যতামূলক)", "Note (required to reject)")}</label>
              <input
                id={`recharge-note-${item.id}`}
                value={notes[item.id] ?? ""}
                maxLength={500}
                onChange={(e) => setNotes({ ...notes, [item.id]: e.target.value })}
              />
            </div>
            <div className="actions">
              <button disabled={busy} onClick={() => void decide(item, "CONFIRMED")}>
                {label("নিশ্চিত করুন", "Confirm")}
              </button>
              <button className="secondary" disabled={busy} onClick={() => void decide(item, "REJECTED")}>
                {label("বাতিল করুন", "Reject")}
              </button>
            </div>
          </article>
        ))
      )}
      <OwnerBanks />
    </section>
  );
}

/** Phase 5b: the deposit accounts offices may pay into. */
function OwnerBanks() {
  useLanguage();
  const [banks, setBanks] = useState<any[]>([]);
  const [form, setForm] = useState({ code: "", nameBn: "", nameEn: "", accountName: "", accountNumber: "", branch: "" });
  const [message, setMessage] = useState("");
  const load = async () => setBanks((await api("/recharge-banks")).items);
  useEffect(() => {
    load().catch(() => undefined);
  }, []);
  const save = async (code: string, body: any) => {
    await api(`/owner/recharge-banks/${code}`, "PUT", body);
    await load();
  };
  return (
    <div className="owner-banks">
      <h3>{label("জমার হিসাব", "Deposit accounts")}</h3>
      <ul>
        {banks.map((b) => (
          <li key={b.code}>
            {choose({ bn: b.nameBn, en: b.nameEn })} · <code>{b.accountNumber}</code> ·{" "}
            <button
              type="button"
              className="secondary"
              onClick={() =>
                save(b.code, {
                  nameBn: b.nameBn,
                  nameEn: b.nameEn,
                  accountName: b.accountName,
                  accountNumber: b.accountNumber,
                  branch: b.branch,
                  active: !b.active,
                }).catch((e) => setMessage((e as Error).message))
              }
            >
              {b.active ? label("চালু · বন্ধ করুন", "On · switch off") : label("বন্ধ · চালু করুন", "Off · switch on")}
            </button>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const { code, ...rest } = form;
          save(code.trim().toLowerCase(), { ...rest, branch: rest.branch || null, active: true })
            .then(() => {
              setForm({ code: "", nameBn: "", nameEn: "", accountName: "", accountNumber: "", branch: "" });
              setMessage(label("হিসাব যোগ হয়েছে।", "Account added."));
            })
            .catch((err) => setMessage((err as Error).message));
        }}
      >
        <div className="form-grid">
          {(
            [
              ["code", label("সংক্ষিপ্ত কোড (ইংরেজি ছোট হাতের)", "Short code (lower-case)")],
              ["nameBn", label("ব্যাংকের নাম (বাংলা)", "Bank name (Bangla)")],
              ["nameEn", label("ব্যাংকের নাম (ইংরেজি)", "Bank name (English)")],
              ["accountName", label("হিসাবের নাম", "Account name")],
              ["accountNumber", label("হিসাব নম্বর", "Account number")],
              ["branch", label("শাখা (ঐচ্ছিক)", "Branch (optional)")],
            ] as const
          ).map(([key, text]) => (
            <div className="field" key={key}>
              <label htmlFor={`bank-${key}`}>{text}</label>
              <input
                id={`bank-${key}`}
                value={form[key]}
                required={key !== "branch"}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            </div>
          ))}
        </div>
        <button>{label("হিসাব যোগ করুন", "Add account")}</button>
      </form>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
