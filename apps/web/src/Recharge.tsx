import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { choose, useLanguage } from "./i18n.js";
import { EmptyState } from "./OwnerUi.js";
import { parseTakaToMinor } from "./OrderPolicySettings.js";
import { points } from "./PointsWallet.js";

const label = (bn: string, en: string) => choose({ bn, en });
const accepted = ["image/jpeg", "image/png", "application/pdf"];
const statusLabel = (status: string) =>
  ({
    PENDING: label("যাচাইয়ের অপেক্ষায়", "Waiting for confirmation"),
    CONFIRMED: label("নিশ্চিত, পয়েন্ট যোগ হয়েছে", "Confirmed, points added"),
    REJECTED: label("বাতিল", "Rejected"),
  })[status] ?? status;
async function toBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 16_384)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
  return btoa(binary);
}

/** Phase 5b: an office asks to recharge points after a bank deposit, attaching the deposit slip. */
export function RechargeRequests() {
  useLanguage();
  const [banks, setBanks] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [bankCode, setBankCode] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [allowed, setAllowed] = useState(true);
  const load = async () => {
    const [b, r] = await Promise.all([api("/recharge-banks"), api("/recharges")]);
    setBanks(b.items);
    setRequests(r.items);
    setBankCode((current) => current || b.items[0]?.code || "");
  };
  useEffect(() => {
    load().catch(() => setAllowed(false));
  }, []);
  if (!allowed) return null;
  const bank = banks.find((b) => b.code === bankCode);
  return (
    <div className="recharge">
      <h3>{label("ব্যাংক জমা দিয়ে রিচার্জ", "Recharge by bank deposit")}</h3>
      {banks.length === 0 ? (
        <p>{label("এখনও কোনো জমার হিসাব যোগ করা হয়নি।", "No deposit account has been added yet.")}</p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            setMessage("");
            (async () => {
              let amountMinor: number;
              try {
                amountMinor = parseTakaToMinor(amount);
              } catch {
                throw Error(label("জমার পরিমাণ টাকায় লিখুন।", "Enter the deposit amount in taka."));
              }
              if (!file) throw Error(label("জমার রসিদ যুক্ত করুন।", "Attach the deposit slip."));
              if (!accepted.includes(file.type) || file.size > 2 * 1024 * 1024)
                throw Error(label("পিডিএফ, পিএনজি বা জেপিইজি, সর্বোচ্চ ২ মেগাবাইট।", "Use a PDF, PNG or JPEG up to 2 MB."));
              await api("/recharges", "POST", {
                amountMinor,
                bankCode,
                depositReference: reference.trim(),
                depositDate: date,
                proof: { mimeType: file.type, base64: await toBase64(file) },
              });
              setAmount("");
              setReference("");
              setFile(null);
              await load();
              setMessage(
                label(
                  "অনুরোধ পাঠানো হয়েছে। রসিদ নিরাপত্তা পরীক্ষা ও যাচাইয়ের পর পয়েন্ট যোগ হবে।",
                  "Request sent. Points are added after the slip's security check and confirmation.",
                ),
              );
            })()
              .catch((err) => setError((err as Error).message))
              .finally(() => setBusy(false));
          }}
        >
          <div className="form-grid">
            <div className="field">
              <label htmlFor="recharge-bank">{label("জমার হিসাব", "Deposit account")}</label>
              <select id="recharge-bank" value={bankCode} onChange={(e) => setBankCode(e.target.value)}>
                {banks.map((b) => (
                  <option key={b.code} value={b.code}>
                    {choose({ bn: b.nameBn, en: b.nameEn })}
                  </option>
                ))}
              </select>
              {bank && (
                <p className="hint">
                  {bank.accountName} · <code>{bank.accountNumber}</code>
                  {bank.branch ? ` · ${bank.branch}` : ""}
                </p>
              )}
            </div>
            <div className="field">
              <label htmlFor="recharge-amount">{label("জমার পরিমাণ (টাকা)", "Amount deposited (BDT)")}</label>
              <input id="recharge-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="recharge-reference">{label("জমার রেফারেন্স নম্বর", "Deposit reference")}</label>
              <input
                id="recharge-reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                required
                minLength={3}
                maxLength={80}
              />
            </div>
            <div className="field">
              <label htmlFor="recharge-date">{label("জমার তারিখ", "Deposit date")}</label>
              <input id="recharge-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="recharge-slip">{label("জমার রসিদ", "Deposit slip")}</label>
              <input
                id="recharge-slip"
                type="file"
                accept={accepted.join(",")}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                required
              />
            </div>
          </div>
          <button disabled={busy}>{label("রিচার্জের অনুরোধ পাঠান", "Send recharge request")}</button>
        </form>
      )}
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
