import { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { choose, useLanguage } from "./i18n.js";

export type OrderPreferences = {
  addressBasis: "registered_profile";
  certificateLanguage: "bn" | "en";
  deliveryMode: "office_collection" | "digital_copy";
  urgency: "normal" | "urgent";
};
export type OrderInput = {
  policyVersion: number;
  preferences: OrderPreferences;
};
export type OrderQuote = OrderInput & {
  currency: "BDT";
  components: { code: string; amountMinor: number }[];
  totalMinor: number;
  paymentStatus: string;
};
export type IntakeOrderState = {
  context: string;
  ready: boolean;
  configured: boolean;
  order?: OrderInput;
};
const label = (bn: string, en: string) => choose({ bn, en });
export function money(minor: number) {
  return (minor / 100).toLocaleString(choose({ bn: "bn-BD", en: "en-BD" }), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function componentLabel(code: string) {
  return (
    (
      {
        statutory_fee: label("সরকারি সেবার ফি", "Statutory service fee"),
        processing_fee: label("প্রসেসিং ফি", "Processing fee"),
        emergency_surcharge: label(
          "জরুরি সেবার অতিরিক্ত ফি",
          "Urgent service surcharge",
        ),
        delivery_fee: label("সনদ সরবরাহের ফি", "Delivery fee"),
      } as Record<string, string>
    )[code] ?? code
  );
}
export function OrderSummary({ order }: { order: OrderQuote }) {
  useLanguage();
  return (
    <section
      className="order-summary"
      aria-label={label("আবেদনের ফি বিবরণ", "Application fee breakdown")}
    >
      <h3>{label("আবেদনের ফি বিবরণ", "Application fee breakdown")}</h3>
      <p>
        {label("ফি নীতির সংস্করণ", "Fee policy version")} {order.policyVersion}{" "}
        ·{" "}
        {order.preferences.certificateLanguage === "bn"
          ? label("বাংলা সনদ", "Bangla certificate")
          : label("ইংরেজি সনদ", "English certificate")}
      </p>
      <p>
        {order.preferences.deliveryMode === "office_collection"
          ? label("অফিস থেকে সংগ্রহ", "Office collection")
          : label("ডিজিটাল কপি", "Digital copy")}{" "}
        ·{" "}
        {order.preferences.urgency === "urgent"
          ? label("জরুরি", "Urgent")
          : label("সাধারণ", "Normal")}
      </p>
      <dl className="fee-breakdown">
        {order.components.map((part) => (
          <div key={part.code}>
            <dt>{componentLabel(part.code)}</dt>
            <dd>{money(part.amountMinor)} ৳</dd>
          </div>
        ))}
        <div className="fee-total">
          <dt>{label("মোট নির্ধারিত ফি", "Total assessed fee")}</dt>
          <dd>{money(order.totalMinor)} ৳</dd>
        </div>
      </dl>
      <p className="hint">
        {label(
          "এটি ফি নির্ধারণের হিসাব; পরিশোধের রসিদ নয়।",
          "This is a fee assessment, not a payment receipt.",
        )}
      </p>
      {order.totalMinor > 0 && (
        <p className="notice">
          {label(
            "পেমেন্ট গ্রহণ ও যাচাই এখনো সংযুক্ত হয়নি। ফি পরিশোধ যাচাইয়ের ব্যবস্থা চালু না হওয়া পর্যন্ত এই আবেদনের সনদ ইস্যু করা যাবে না।",
            "Payment collection and verification are not connected yet. This application's certificate cannot be issued until verified fee settlement is supported.",
          )}
        </p>
      )}
    </section>
  );
}

export function ApplicationOrder({
  serviceNo,
  context,
  certificateLanguage,
  officeName,
  address,
  onLanguageChange,
  onChange,
}: {
  serviceNo: number;
  context: string;
  certificateLanguage?: string;
  officeName: string;
  address: string;
  onLanguageChange: (language: "bn" | "en") => void;
  onChange: (state: IntakeOrderState) => void;
}) {
  useLanguage();
  const [policy, setPolicy] = useState<any>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [deliveryMode, setDeliveryMode] =
    useState<OrderPreferences["deliveryMode"]>("office_collection");
  const [urgency, setUrgency] = useState<OrderPreferences["urgency"]>("normal");
  const [quote, setQuote] = useState<OrderQuote | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const requestEpoch = useRef(0);
  const currentPreferences = JSON.stringify({
    certificateLanguage,
    deliveryMode,
    urgency,
  });
  const latestPreferences = useRef(currentPreferences);
  latestPreferences.current = currentPreferences;
  useEffect(() => {
    let active = true;
    setLoaded(false);
    setError("");
    setQuote(null);
    setAccepted(false);
    api(`/services/${serviceNo}/order-options`)
      .then((result) => {
        if (!active) return;
        setPolicy(result.configured ? result.policy : null);
        if (result.configured) {
          setDeliveryMode(result.policy.deliveryModes[0]);
          setUrgency(result.policy.urgencies[0]);
        }
        setLoaded(true);
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      });
    return () => {
      active = false;
      requestEpoch.current++;
    };
  }, [serviceNo, context, retry]);
  useEffect(() => {
    requestEpoch.current++;
    setQuote(null);
    setAccepted(false);
    setBusy(false);
  }, [currentPreferences]);
  useEffect(() => {
    onChange({
      context,
      configured: !!policy,
      ready: loaded && (!policy || (!!quote && accepted)),
      ...(quote && accepted
        ? {
            order: {
              policyVersion: quote.policyVersion,
              preferences: quote.preferences,
            },
          }
        : {}),
    });
  }, [context, loaded, policy, quote, accepted, onChange]);

  if (!loaded)
    return (
      <section
        className="order-panel"
        aria-label={label("সনদের পছন্দ ও ফি", "Certificate options and fees")}
      >
        <p role={error ? "alert" : "status"}>
          {error ||
            label(
              "অফিসের ফি সেটিংস লোড হচ্ছে…",
              "Loading office fee settings…",
            )}
        </p>
        {error && (
          <button
            type="button"
            className="secondary"
            onClick={() => setRetry(retry + 1)}
          >
            {label("আবার চেষ্টা করুন", "Retry fee settings")}
          </button>
        )}
      </section>
    );
  if (!policy)
    return (
      <p className="hint">
        {label(
          "এই অফিসে এই সেবার ফি নীতি প্রকাশ করা হয়নি। বর্তমান ডেমো আবেদন প্রক্রিয়ায় কোনো ফি পরিশোধের দাবি করা হবে না।",
          "This office has not published a fee policy for this service. The existing demo workflow does not record a fee payment.",
        )}
      </p>
    );

  return (
    <section
      className="order-panel"
      aria-label={label("সনদের পছন্দ ও ফি", "Certificate options and fees")}
    >
      <h3>{label("সনদের পছন্দ ও ফি", "Certificate options and fees")}</h3>
      <p>
        <strong>{label("নির্ধারিত অফিস", "Issuing office")}: </strong>
        {officeName}
      </p>
      <p>
        <strong>{label("নিবন্ধিত ঠিকানা", "Registered address")}: </strong>
        {address}
      </p>
      <p className="hint">
        {label(
          "এই আবেদন নির্বাচিত নাগরিকের নিবন্ধিত ঠিকানা ও বর্তমান অফিসের জন্য।",
          "This application uses the selected citizen's registered address and current office.",
        )}
      </p>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="order-language">
            {label("সনদের ভাষা", "Certificate language")}
          </label>
          <select
            id="order-language"
            value={certificateLanguage || ""}
            onChange={(e) => onLanguageChange(e.target.value as "bn" | "en")}
          >
            <option value="" disabled>
              {label("ভাষা নির্বাচন করুন", "Choose language")}
            </option>
            <option value="bn">{label("বাংলা", "Bangla")}</option>
            <option value="en">{label("ইংরেজি", "English")}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="order-delivery">
            {label("সনদ সংগ্রহের মাধ্যম", "Certificate delivery")}
          </label>
          <select
            id="order-delivery"
            value={deliveryMode}
            onChange={(e) =>
              setDeliveryMode(
                e.target.value as OrderPreferences["deliveryMode"],
              )
            }
          >
            {policy.deliveryModes.map((mode: string) => (
              <option key={mode} value={mode}>
                {mode === "office_collection"
                  ? label("অফিস থেকে সংগ্রহ", "Office collection")
                  : label("ডিজিটাল কপি", "Digital copy")}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="order-urgency">
            {label("প্রয়োজনীয়তার মাত্রা", "Service urgency")}
          </label>
          <select
            id="order-urgency"
            value={urgency}
            onChange={(e) =>
              setUrgency(e.target.value as OrderPreferences["urgency"])
            }
          >
            {policy.urgencies.map((mode: string) => (
              <option key={mode} value={mode}>
                {mode === "normal"
                  ? label("সাধারণ", "Normal")
                  : label("জরুরি", "Urgent")}
              </option>
            ))}
          </select>
        </div>
      </div>
      <button
        type="button"
        className="secondary"
        disabled={busy || !["bn", "en"].includes(certificateLanguage || "")}
        onClick={async () => {
          const epoch = ++requestEpoch.current;
          const expectedPreferences = currentPreferences;
          setBusy(true);
          setError("");
          setQuote(null);
          setAccepted(false);
          try {
            const next = await api(
              `/services/${serviceNo}/order-quote`,
              "POST",
              {
                preferences: {
                  addressBasis: "registered_profile",
                  certificateLanguage,
                  deliveryMode,
                  urgency,
                },
              },
            );
            if (
              epoch === requestEpoch.current &&
              latestPreferences.current === expectedPreferences
            )
              setQuote(next);
          } catch (e) {
            if (epoch === requestEpoch.current) setError((e as Error).message);
          } finally {
            if (epoch === requestEpoch.current) setBusy(false);
          }
        }}
      >
        {busy
          ? label("হিসাব করা হচ্ছে…", "Calculating…")
          : label("ফি দেখুন", "Review fees")}
      </button>
      {error && (
        <p role="alert" className="error-summary">
          {error}
        </p>
      )}
      {quote && (
        <>
          <OrderSummary order={quote} />
          <label className="checkbox">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            {label(
              "আমি সনদের পছন্দ ও ফি বিবরণ যাচাই করেছি।",
              "I have reviewed the certificate options and fee breakdown.",
            )}
          </label>
        </>
      )}
    </section>
  );
}
