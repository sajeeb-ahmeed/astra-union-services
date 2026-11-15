import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { choose, useLanguage } from "./i18n.js";

const label = (bn: string, en: string) => choose({ bn, en });
const reasonText = (reason: string) =>
  ({
    CONFIGURED: label("চালু আছে", "Active"),
    MERCHANT_SETUP_REQUIRED: label("সেটআপ করা হয়নি", "Not set up"),
    OFFICE_GATEWAY_DISABLED: label("বন্ধ রাখা হয়েছে", "Switched off"),
    LIVE_ACTIVATION_REQUIRED: label(
      "লাইভ পরিবেশ এই সার্ভারে এখনো চালু করা হয়নি",
      "The live environment is not yet enabled on this server",
    ),
    MERCHANT_SECRETS_UNAVAILABLE: label("সার্ভারে গোপন চাবি সেট করা নেই", "The server's merchant key is not set"),
  })[reason] ?? reason;

/**
 * Phase 5c: the office's own SSLCommerz store (cards and mobile wallets). The store password is sent once and
 * stored encrypted; it is never shown again. Leave it blank to keep the saved one.
 */
export function PaymentMerchantSettings() {
  useLanguage();
  const [state, setState] = useState<any>(null);
  const [environment, setEnvironment] = useState("SANDBOX");
  const [storeId, setStoreId] = useState("");
  const [storePassword, setStorePassword] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const hydrate = (s: any) => {
    setState(s);
    setEnvironment(s.environment && s.environment !== "DISABLED" ? s.environment : "SANDBOX");
    setStoreId(s.storeId ?? "");
    setEnabled(s.storeId ? s.enabled : true);
    setStorePassword("");
  };
  useEffect(() => {
    api("/admin/payment-merchants/sslcommerz")
      .then(hydrate)
      .catch((e) => setError((e as Error).message));
  }, []);
  return (
    <section className="panel payment-merchant">
      <h2>{label("অনলাইন পেমেন্ট (SSLCommerz)", "Online payments (SSLCommerz)")}</h2>
      <p className="hint">
        {label(
          "আপনার অফিসের নিজস্ব SSLCommerz স্টোর দিয়ে নাগরিকেরা কার্ড ও মোবাইল ব্যাংকিংয়ে ফি দিতে পারবেন। স্টোর খোলা ও লাইভ অনুমোদন SSLCommerz-এর সাথে আপনার কাজ।",
          "Citizens can pay fees by card or mobile wallet through your office's own SSLCommerz store. Opening the store and getting live approval is done with SSLCommerz.",
        )}
      </p>
      {state && (
        <p>
          {label("অবস্থা", "Status")}: <strong data-testid="merchant-status">{reasonText(state.reason)}</strong>
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setMessage("");
          api("/admin/payment-merchants/sslcommerz", "PUT", {
            environment,
            storeId: storeId.trim(),
            ...(storePassword ? { storePassword } : {}),
            enabled,
          })
            .then((s) => {
              hydrate(s);
              setMessage(label("সংরক্ষিত হয়েছে।", "Saved."));
            })
            .catch((err) => setError((err as Error).message))
            .finally(() => setBusy(false));
        }}
      >
        <div className="form-grid">
          <div className="field">
            <label htmlFor="merchant-environment">{label("পরিবেশ", "Environment")}</label>
            <select id="merchant-environment" value={environment} onChange={(e) => setEnvironment(e.target.value)}>
              <option value="SANDBOX">{label("পরীক্ষামূলক (স্যান্ডবক্স)", "Sandbox (test)")}</option>
              <option value="LIVE">{label("লাইভ", "Live")}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="merchant-store-id">{label("স্টোর আইডি", "Store ID")}</label>
            <input
              id="merchant-store-id"
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              required
              autoComplete="off"
              maxLength={100}
            />
          </div>
          <div className="field">
            <label htmlFor="merchant-store-password">{label("স্টোর পাসওয়ার্ড", "Store password")}</label>
            <input
              id="merchant-store-password"
              type="password"
              value={storePassword}
              onChange={(e) => setStorePassword(e.target.value)}
              autoComplete="new-password"
              maxLength={200}
              placeholder={state?.storeId ? label("সংরক্ষিত — বদলাতে নতুনটি লিখুন", "Saved — type a new one to change it") : ""}
            />
          </div>
        </div>
        <div className="check-field">
          <label htmlFor="merchant-enabled">
            <input id="merchant-enabled" type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span>{label("অনলাইন পেমেন্ট চালু রাখুন", "Keep online payment switched on")}</span>
          </label>
        </div>
        <button disabled={busy}>{label("সংরক্ষণ করুন", "Save")}</button>
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
    </section>
  );
}
