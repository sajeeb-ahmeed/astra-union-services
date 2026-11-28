import React, { useEffect, useState } from "react";
import { api, ApiError } from "./api.js";
import { choose, useLanguage } from "./i18n.js";

/**
 * CERT-FEE: the Chairman's approval on a per-certificate office. The
 * Chairman picks the certificate language(s) — Bangla, English or both —
 * sees the platform fee for that choice, and pays from the office wallet
 * (approve + pay + issue in one step) or online (the approval is recorded,
 * the fee is paid at the gateway, and the certificate is issued once the
 * payment is verified). Only the paid language versions are issued.
 *
 * Offices on the established submit billing render `fallback` (the plain
 * "Approve and issue" button) unchanged.
 */
type Languages = "bn" | "en" | "bilingual";
type Quote = {
  billingMode: "SUBMIT_CREDIT" | "PER_CERTIFICATE";
  officeVerified: boolean;
  configured: boolean;
  amounts: Record<Languages, number>;
  defaultLanguages: Languages;
  walletBalanceMinor: number;
  online: { bkash: boolean; sslcommerz: boolean };
  fee: null | { languages: Languages; amountMinor: number; method: string; status: string; orderId: string | null };
};

const label = (bn: string, en: string) => choose({ bn, en });
const taka = (minor: number) =>
  `৳${(minor / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const languageName = (l: Languages) =>
  l === "bn" ? label("বাংলা", "Bangla") : l === "en" ? label("ইংরেজি", "English") : label("বাংলা ও ইংরেজি দুটোই", "Both Bangla and English");
const DECISION_STATES = ["SUBMITTED", "RESUBMITTED", "UNDER_REVIEW"];

export function CertificateFeeDecision({
  applicationId,
  state,
  reason,
  disabled,
  onDone,
  fallback,
}: {
  applicationId: string;
  state: string;
  reason?: string;
  disabled?: boolean;
  onDone: () => Promise<void> | void;
  fallback: React.ReactNode;
}) {
  useLanguage();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [languages, setLanguages] = useState<Languages>("bn");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // Approving and paying cannot be undone: every payment asks once, in place.
  const [confirming, setConfirming] = useState<null | { text: string; go: () => void }>(null);

  const load = async () => {
    try {
      const q = await api<Quote>(`/applications/${applicationId}/certificate-fee`);
      setQuote(q);
      setLanguages(q.fee && q.fee.status !== "CANCELLED" ? q.fee.languages : q.defaultLanguages);
      return q;
    } catch {
      setQuote(null);
      return null;
    } finally {
      setLoaded(true);
    }
  };
  useEffect(() => {
    void (async () => {
      const q = await load();
      // Back from the gateway with an unpaid-looking fee: verify it once.
      if (q?.fee?.status === "PENDING" && q.fee.orderId && state === "APPROVED") await checkOnline(q.fee.orderId, true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId, state]);

  if (!loaded) return null;
  if (!quote || quote.billingMode !== "PER_CERTIFICATE") return <>{fallback}</>;

  const decision = DECISION_STATES.includes(state);
  const paid = quote.fee?.status === "PAID";
  const pendingOnline = quote.fee?.status === "PENDING";
  const amount = paid ? quote.fee!.amountMinor : quote.amounts[languages];
  const walletShort = quote.walletBalanceMinor < amount;
  const blocked = !quote.officeVerified || !quote.configured;
  const anyOnline = quote.online.bkash || quote.online.sslcommerz;

  async function issue(body: object) {
    if (decision)
      await api(`/applications/${applicationId}/transition`, "POST", {
        action: "approve",
        ...(reason?.trim() ? { reason: reason.trim() } : {}),
        ...body,
      });
    else await api(`/applications/${applicationId}/issue`, "POST", body);
  }
  async function run(task: () => Promise<void>) {
    setConfirming(null);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
      await load();
    } finally {
      setBusy(false);
    }
  }
  const payFromWallet = () =>
    run(async () => {
      await issue({ certificateLanguages: languages, paymentMethod: "wallet" });
      await onDone();
    });
  const issuePaid = () =>
    run(async () => {
      await issue({ certificateLanguages: quote.fee!.languages });
      await onDone();
    });
  const payOnline = (provider: "BKASH" | "SSLCOMMERZ") =>
    run(async () => {
      if (decision) {
        // Record the decision; the issuance waits for the fee (402 is expected).
        try {
          await issue({ certificateLanguages: languages, paymentMethod: "online" });
        } catch (e) {
          const code = (e as ApiError).details?.error?.code;
          if (code !== "CERTIFICATE_FEE_REQUIRED") throw e;
        }
      }
      const fee = await api<{ orderId: string }>(`/applications/${applicationId}/certificate-fee/order`, "POST", {
        languages,
      });
      const checkout = await api<{ payment: { checkoutUrl?: string | null; status: string } }>(
        `/billing/orders/${fee.orderId}/gateway/checkout`,
        "POST",
        { provider, requestKey: crypto.randomUUID() },
      );
      if (checkout.payment.checkoutUrl) {
        location.assign(checkout.payment.checkoutUrl);
        return;
      }
      setNotice(
        label(
          "অনলাইন পেমেন্ট শুরু করা যায়নি। একটু পরে আবার চেষ্টা করুন বা ওয়ালেট থেকে পরিশোধ করুন।",
          "The online payment could not be started. Try again shortly, or pay from the wallet.",
        ),
      );
      await load();
    });
  async function checkOnline(orderId: string, quiet = false) {
    await run(async () => {
      const r = await api<{ settled: boolean }>(`/billing/orders/${orderId}/gateway/check`, "POST", {
        requestKey: crypto.randomUUID(),
      });
      const q = await load();
      if (r.settled && q?.fee?.status === "PAID") {
        await api(`/applications/${applicationId}/issue`, "POST", { certificateLanguages: q.fee.languages });
        await onDone();
      } else if (!quiet)
        setNotice(label("পেমেন্ট এখনো নিশ্চিত হয়নি।", "The payment is not confirmed yet."));
    });
  }

  return (
    <section className="certificate-fee" aria-labelledby={`cert-fee-${applicationId}`}>
      <h3 id={`cert-fee-${applicationId}`}>{label("সনদের ভাষা ও প্ল্যাটফর্ম ফি", "Certificate language and platform fee")}</h3>
      {!quote.officeVerified && (
        <p className="hint" role="note">
          {label(
            "প্ল্যাটফর্ম কর্তৃপক্ষ এই অফিস যাচাই করার পর সনদ ইস্যু করা যাবে। এখন অনুমোদন করলে তা সংরক্ষিত থাকবে।",
            "Certificates can be issued once the platform owner verifies this office. An approval now is recorded.",
          )}
        </p>
      )}
      {!quote.configured && (
        <p className="hint" role="note">
          {label("প্ল্যাটফর্ম কর্তৃপক্ষ এখনো সনদের ফি নির্ধারণ করেনি।", "The platform owner has not set the certificate fees yet.")}
        </p>
      )}
      <fieldset className="certificate-fee-languages" disabled={busy || paid || pendingOnline}>
        <legend>{label("কোন ভাষায় সনদ ইস্যু হবে?", "Issue the certificate in")}</legend>
        {(["bn", "en", "bilingual"] as Languages[]).map((l) => (
          <label key={l} className="certificate-fee-option">
            <input
              type="radio"
              name={`cert-lang-${applicationId}`}
              value={l}
              checked={languages === l}
              onChange={() => setLanguages(l)}
            />{" "}
            <span>{languageName(l)}</span> <strong>{taka(quote.amounts[l])}</strong>
          </label>
        ))}
      </fieldset>
      <p className="certificate-fee-total" aria-live="polite">
        {label("মোট প্ল্যাটফর্ম ফি", "Platform fee")}: <strong>{taka(amount)}</strong>
        {" · "}
        {label("অফিসের ওয়ালেট", "Office wallet")}: {taka(quote.walletBalanceMinor)}
      </p>
      {paid ? (
        <div className="detail-rail-actions">
          <p className="notice" role="status">
            {label("ফি পরিশোধ হয়েছে", "Fee paid")}: {languageName(quote.fee!.languages)} · {taka(quote.fee!.amountMinor)}
          </p>
          <button disabled={busy || disabled || blocked} onClick={issuePaid}>
            {label("সনদ ইস্যু করুন", "Issue the certificate")}
          </button>
        </div>
      ) : pendingOnline ? (
        <div className="detail-rail-actions">
          <p className="hint" role="note">
            {label("অনলাইন পেমেন্ট অপেক্ষমাণ", "Online payment pending")}: {languageName(quote.fee!.languages)} · {taka(quote.fee!.amountMinor)}
          </p>
          <button disabled={busy} onClick={() => void checkOnline(quote.fee!.orderId!)}>
            {label("পেমেন্ট যাচাই করুন", "Check the payment")}
          </button>
          <button className="secondary" disabled={busy || walletShort || blocked} onClick={payFromWallet}>
            {label("ওয়ালেট থেকে পরিশোধ করে ইস্যু করুন", "Pay from the wallet and issue instead")}
          </button>
        </div>
      ) : (
        <div className="detail-rail-actions">
          <button
            disabled={busy || disabled || walletShort || blocked}
            onClick={() =>
              setConfirming({
                text: label(
                  `${languageName(languages)} সনদের জন্য ওয়ালেট থেকে ${taka(amount)} কাটা হবে এবং সনদ ইস্যু হবে। এটি ফেরানো যাবে না।`,
                  `${taka(amount)} will be taken from the wallet for the ${languageName(languages)} certificate, and it will be issued. This cannot be undone.`,
                ),
                go: payFromWallet,
              })
            }
          >
            {decision
              ? label(`অনুমোদন করে ওয়ালেট থেকে ${taka(amount)} পরিশোধ ও ইস্যু করুন`, `Approve, pay ${taka(amount)} from the wallet and issue`)
              : label(`ওয়ালেট থেকে ${taka(amount)} পরিশোধ করে ইস্যু করুন`, `Pay ${taka(amount)} from the wallet and issue`)}
          </button>
          {quote.online.bkash && (
            <button
              className="secondary"
              disabled={busy || disabled || blocked}
              onClick={() =>
                setConfirming({
                  text: label(
                    `আবেদনটি অনুমোদিত হবে এবং ${languageName(languages)} সনদের ${taka(amount)} ফি bKash-এ পরিশোধের পাতায় যাবেন।`,
                    `The application will be approved and you will go to bKash to pay ${taka(amount)} for the ${languageName(languages)} certificate.`,
                  ),
                  go: () => void payOnline("BKASH"),
                })
              }
            >
              {label(`bKash-এ ${taka(amount)} পরিশোধ`, `Pay ${taka(amount)} with bKash`)}
            </button>
          )}
          {quote.online.sslcommerz && (
            <button
              className="secondary"
              disabled={busy || disabled || blocked}
              onClick={() =>
                setConfirming({
                  text: label(
                    `আবেদনটি অনুমোদিত হবে এবং ${languageName(languages)} সনদের ${taka(amount)} ফি অনলাইনে পরিশোধের পাতায় যাবেন।`,
                    `The application will be approved and you will go to the online payment page to pay ${taka(amount)} for the ${languageName(languages)} certificate.`,
                  ),
                  go: () => void payOnline("SSLCOMMERZ"),
                })
              }
            >
              {label(`কার্ড / অনলাইনে ${taka(amount)} পরিশোধ`, `Pay ${taka(amount)} by card or online`)}
            </button>
          )}
          {walletShort && (
            <p className="hint" role="note">
              {anyOnline
                ? label("ওয়ালেটে যথেষ্ট টাকা নেই — রিচার্জ করুন বা অনলাইনে পরিশোধ করুন।", "The wallet is short — recharge it or pay online.")
                : label("ওয়ালেটে যথেষ্ট টাকা নেই — ওয়ালেট রিচার্জ করুন।", "The wallet is short — recharge the wallet.")}
            </p>
          )}
        </div>
      )}
      {confirming && (
        <div className="certificate-fee-confirm" role="alertdialog" aria-label={label("নিশ্চিত করুন", "Confirm")}>
          <p>{confirming.text}</p>
          <button data-testid="confirm-certificate-fee" disabled={busy} onClick={confirming.go}>
            {label("নিশ্চিত করুন", "Confirm")}
          </button>
          <button className="secondary" disabled={busy} onClick={() => setConfirming(null)}>
            {label("বাতিল", "Cancel")}
          </button>
        </div>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
