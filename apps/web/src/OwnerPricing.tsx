import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { choose, useLanguage } from "./i18n.js";

const label = (bn: string, en: string) => choose({ bn, en });
const bnDigits = (value: string) => value.replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
const num = (value: number) => choose({ bn: bnDigits(String(value)), en: String(value) });

/**
 * Phase 3B: the owner's Pricing screen. One credit price per service, charged once when a
 * citizen's application is first submitted (never at issuance). Prices are published as new
 * versions with a mandatory reason; the full history stays visible. Above the prices sits the
 * billing setting that decides who pays the fee — the office wallet (default) or the citizen
 * (whose payment rail arrives in Phase 7; until then citizen-pays submits stay drafts).
 */
export function OwnerPricing() {
  useLanguage();
  const [items, setItems] = useState<any[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [history, setHistory] = useState<Record<number, any[]>>({});
  const [payer, setPayer] = useState<"office" | "citizen">("office");
  const [payerReason, setPayerReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    const [prices, settings] = await Promise.all([
      api("/owner/credit-prices"),
      api("/owner/billing-settings"),
    ]);
    setItems(prices.items);
    setDrafts(
      Object.fromEntries(
        prices.items.map((i: any) => [i.serviceNo, String(i.priceCredits)]),
      ),
    );
    setPayer(settings.applicationFeePayer);
  };
  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, []);

  async function publish(item: any) {
    const reason = (reasons[item.serviceNo] ?? "").trim();
    if (reason.length < 3) {
      setError(label("প্রকাশের কারণ লিখুন (কমপক্ষে ৩ অক্ষর)।", "Give a reason for publishing (at least 3 characters)."));
      return;
    }
    const priceCredits = Number(drafts[item.serviceNo]);
    if (!Number.isInteger(priceCredits) || priceCredits < 0 || priceCredits > 10000) {
      setError(label("ক্রেডিট মূল্য ০ থেকে ১০০০০-এর মধ্যে পূর্ণসংখ্যা হতে হবে।", "The credit price must be a whole number between 0 and 10000."));
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(`/owner/credit-prices/${item.serviceNo}`, "POST", {
        expectedVersion: item.version,
        priceCredits,
        reason,
      });
      setReasons((r) => ({ ...r, [item.serviceNo]: "" }));
      delete history[item.serviceNo];
      setHistory({ ...history });
      await load();
      setMessage(label("ক্রেডিট মূল্য প্রকাশিত হয়েছে।", "Credit price published."));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleHistory(item: any) {
    if (history[item.serviceNo]) {
      const next = { ...history };
      delete next[item.serviceNo];
      setHistory(next);
      return;
    }
    try {
      const r = await api(`/owner/credit-prices/${item.serviceNo}/versions`);
      setHistory({ ...history, [item.serviceNo]: r.items });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function savePayer() {
    if (payerReason.trim().length < 8) {
      setError(label("সেটিং বদলের কারণ লিখুন (কমপক্ষে ৮ অক্ষর)।", "Give a reason for changing the setting (at least 8 characters)."));
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await api("/owner/billing-settings", "PUT", {
        applicationFeePayer: payer,
        reason: payerReason.trim(),
      });
      setPayer(r.applicationFeePayer);
      setPayerReason("");
      setMessage(label("বিলিং সেটিং সংরক্ষিত হয়েছে।", "Billing setting saved."));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel owner-pricing">
      <h2>{label("আবেদন ফি ও মূল্য", "Application fees & pricing")}</h2>
      <p className="hint">
        {label(
          "প্রতিটি আবেদনের ফি শুধু প্রথমবার জমা দেওয়ার সময় কাটা হয় — সনদ ইস্যুর সময় কোনো চার্জ নেই। সাবস্ক্রিপশন সক্রিয় অফিসের আবেদনে ফি লাগে না।",
          "Each application's fee is charged once, at its first submit — issuance is never charged. Applications to an office with an active subscription are free.",
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

      <h3>{label("ফি কে দেবে", "Who pays the fee")}</h3>
      <div className="field-row">
        <label>
          <input
            type="radio"
            name="fee-payer"
            checked={payer === "office"}
            onChange={() => setPayer("office")}
          />{" "}
          {label("অফিসের ওয়ালেট", "Office wallet")}
        </label>
        <label>
          <input
            type="radio"
            name="fee-payer"
            checked={payer === "citizen"}
            onChange={() => setPayer("citizen")}
          />{" "}
          {label("নাগরিক", "Citizen")}
        </label>
      </div>
      {payer === "citizen" && (
        <p className="hint">
          {label(
            "সতর্কতা: নাগরিকের পরিশোধের মাধ্যম এখনো চালু হয়নি (Phase 7)। এই সেটিং চালু থাকলে নতুন আবেদন খসড়া অবস্থায় আটকে থাকবে।",
            "Note: citizen payment is not available yet (Phase 7). While this setting is on, new applications will stay as drafts.",
          )}
        </p>
      )}
      <div className="field-row">
        <label>
          {label("কারণ", "Reason")}
          <input
            value={payerReason}
            onChange={(e) => setPayerReason(e.target.value)}
            maxLength={500}
          />
        </label>
        <button type="button" disabled={busy} onClick={savePayer}>
          {label("সেটিং সংরক্ষণ", "Save setting")}
        </button>
      </div>

      <h3>{label("সেবা প্রতি ক্রেডিট মূল্য", "Credit price per service")}</h3>
      <p className="hint">
        {label(
          "সব অফিসের জন্য একই মূল্য। যেসব সেবার মূল্য প্রকাশ হয়নি, সেগুলোর ডিফল্ট মূল্য ১ ক্রেডিট। ০ মানে বিনামূল্যে। প্রতিটি পরিবর্তন কারণসহ নতুন সংস্করণ হিসেবে সংরক্ষিত হয়; জমার মুহূর্তে চালু থাকা মূল্যই কাটা হয়।",
          "One price for every office. Services without a published price default to 1 credit. 0 means free. Each change is kept as a new version with its reason; the price in force at submit is the price charged.",
        )}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">{label("সেবা", "Service")}</th>
              <th scope="col">{label("বর্তমান মূল্য", "Current price")}</th>
              <th scope="col">{label("নতুন মূল্য (ক্রেডিট)", "New price (credits)")}</th>
              <th scope="col">{label("কারণ", "Reason")}</th>
              <th scope="col">{label("পদক্ষেপ", "Action")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <React.Fragment key={item.serviceNo}>
                <tr>
                  <th scope="row">
                    {num(item.serviceNo)}. {choose({ bn: item.nameBn, en: item.nameEn })}
                  </th>
                  <td>
                    {num(item.priceCredits)} {label("ক্রেডিট", "credits")}
                    {item.isDefault
                      ? ` (${label("ডিফল্ট", "default")})`
                      : ` · ${label("সংস্করণ", "v")}${num(item.version)}`}
                  </td>
                  <td>
                    <input
                      aria-label={label("নতুন মূল্য", "New price")}
                      inputMode="numeric"
                      value={drafts[item.serviceNo] ?? ""}
                      onChange={(e) =>
                        setDrafts({ ...drafts, [item.serviceNo]: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      aria-label={label("পরিবর্তনের কারণ", "Reason for the change")}
                      value={reasons[item.serviceNo] ?? ""}
                      onChange={(e) =>
                        setReasons({ ...reasons, [item.serviceNo]: e.target.value })
                      }
                      maxLength={500}
                    />
                  </td>
                  <td>
                    <button type="button" disabled={busy} onClick={() => publish(item)}>
                      {label("প্রকাশ", "Publish")}
                    </button>{" "}
                    <button type="button" disabled={busy} onClick={() => toggleHistory(item)}>
                      {label("ইতিহাস", "History")}
                    </button>
                  </td>
                </tr>
                {history[item.serviceNo] && (
                  <tr>
                    <td colSpan={5}>
                      {history[item.serviceNo].length ? (
                        <ul className="price-history">
                          {history[item.serviceNo].map((v) => (
                            <li key={v.version}>
                              {label("সংস্করণ", "v")}
                              {num(v.version)} — {num(v.priceCredits)} {label("ক্রেডিট", "credits")} ·{" "}
                              {v.reason} ·{" "}
                              {new Date(v.createdAt).toLocaleDateString(
                                choose({ bn: "bn-BD", en: "en-GB" }),
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>{label("এখনও কোনো মূল্য প্রকাশ হয়নি — ডিফল্ট ১ ক্রেডিট চালু আছে।", "No price published yet — the default of 1 credit applies.")}</p>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
