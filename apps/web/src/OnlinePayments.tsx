import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api.js";
import { choose, useLanguage } from "./i18n.js";
import { money } from "./ApplicationOrder.js";
import { ApplicationRefunds } from "./Refunds.js";

type Message = { bn: string; en: string };
type Availability = {
  provider: "BKASH";
  environment: "DISABLED" | "SANDBOX" | "LIVE";
  configured: boolean;
  available: boolean;
  reason: string;
  bankSettlement: "NOT_CONNECTED";
  nagad: { configured: false; reason: "NOT_INTEGRATED" };
  // Phase 5c: the office's own SSLCommerz merchant (cards and mobile wallets).
  sslcommerz?: { available: boolean; environment: string; reason: string };
  anyAvailable?: boolean;
};
type Provider = "BKASH" | "SSLCOMMERZ";
const anyAvailable = (a: Availability) => a.anyAvailable ?? a.available;
const availableProviders = (a: Availability): Provider[] => [
  ...(a.available ? (["BKASH"] as const) : []),
  ...(a.sslcommerz?.available ? (["SSLCOMMERZ"] as const) : []),
];
type Attempt = {
  id: string;
  applicationId: string;
  provider: Provider;
  environment: string;
  status: string;
  amountMinor: number;
  currency: string;
  invoice: string;
  checkoutUrl: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  receiptId: string | null;
  paymentStatus?: string;
  lastReconciliation?: {
    result: string;
    reason: string;
    checkedAt: string;
  } | null;
  applicantName?: string;
  serviceNo?: number;
};
type Receipt = {
  id: string;
  receiptNumber: string;
  amountMinor: number;
  environment: string;
  transactionId: string;
  issuedAt: string;
};
type Payment = {
  applicationId: string;
  totalMinor: number;
  currency: string;
  paymentStatus: string;
  eligible: boolean;
  availability: Availability;
  attempt: Attempt | null;
  receipt: Receipt | null;
};
type Reconciliation = {
  businessDate: string;
  totalCount: number;
  paidCount: number;
  pendingCount: number;
  reviewCount: number;
  totalMinor: number;
  paidMinor: number;
  results: {
    matched: number;
    mismatch: number;
    pending: number;
    error: number;
  };
};
const label = (bn: string, en: string) => choose({ bn, en });
function todayDhaka() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function statusLabel(status: string) {
  const names: Record<string, Message> = {
    NOT_COLLECTED: { bn: "ফি পরিশোধ হয়নি", en: "Not paid" },
    PENDING: { bn: "যাচাইয়ের অপেক্ষায়", en: "Verification pending" },
    COLLECTED: { bn: "ফি পরিশোধ যাচাইকৃত", en: "Payment verified" },
    NOT_REQUIRED: { bn: "কোনো ফি প্রযোজ্য নয়", en: "No fee required" },
    LEGACY: { bn: "আগের প্রক্রিয়ার আবেদন", en: "Legacy application" },
    CREATE_PENDING: { bn: "পেমেন্ট লিংক তৈরি হচ্ছে", en: "Creating checkout" },
    CREATE_UNKNOWN: {
      bn: "পেমেন্ট লিংকের অবস্থা নিশ্চিত নয়",
      en: "Checkout status uncertain",
    },
    READY: { bn: "পেমেন্ট লিংক প্রস্তুত", en: "Checkout ready" },
    EXECUTE_PENDING: {
      bn: "গেটওয়ের ফলাফলের অপেক্ষায়",
      en: "Gateway result pending",
    },
    VERIFYING: {
      bn: "গেটওয়ের তথ্য যাচাই হচ্ছে",
      en: "Checking gateway records",
    },
    PAID: { bn: "পরিশোধ যাচাইকৃত", en: "Verified paid" },
    REVIEW_REQUIRED: { bn: "পুনরায় যাচাই প্রয়োজন", en: "Review required" },
    REFUND_PENDING: { bn: "ফি ফেরত প্রক্রিয়াধীন", en: "Refund in progress" },
    REFUNDED: { bn: "ফি ফেরত দেওয়া হয়েছে", en: "Fee refunded" },
    FAILED: { bn: "পেমেন্ট সম্পন্ন হয়নি", en: "Payment not completed" },
    MATCHED: { bn: "গেটওয়ের তথ্য মিলেছে", en: "Gateway records matched" },
    MISMATCH: { bn: "গেটওয়ের তথ্যে অমিল", en: "Gateway record mismatch" },
    ERROR: { bn: "যাচাই সম্পন্ন হয়নি", en: "Verification unavailable" },
  };
  return names[status] ? choose(names[status]) : status;
}
function errorMessage(error: unknown): Message {
  if (
    error instanceof ApiError &&
    error.details?.error?.code === "GATEWAY_NOT_CONFIGURED"
  )
    return {
      bn: "এই অফিসের পেমেন্ট গেটওয়ে প্রস্তুত নয়। অনুমোদিত মার্চেন্ট সংযোগ ও যাচাই সম্পন্ন হলে পেমেন্ট চালু হবে।",
      en: "This office's payment gateway is not ready. Checkout becomes available after an approved merchant connection is configured and verified.",
    };
  if (error instanceof ApiError && error.status === 403)
    return {
      bn: "এই পেমেন্টের তথ্য বা কাজের অনুমতি নেই।",
      en: "You do not have access to this payment or action.",
    };
  if (error instanceof ApiError && error.status === 409)
    return {
      bn: "আবেদন বা পেমেন্টের অবস্থা বদলেছে। বর্তমান অবস্থা হালনাগাদ করুন; একই পেমেন্ট আবার তৈরি করবেন না।",
      en: "The application or payment state changed. Refresh its current status; do not create a duplicate payment.",
    };
  return {
    bn: "পেমেন্টের ফল নিশ্চিত করা যায়নি। অবস্থা হালনাগাদ করুন। পেমেন্ট হয়েছে ধরে নেওয়া হবে না।",
    en: "The payment result could not be confirmed. Refresh the status. Payment will not be assumed successful.",
  };
}
function checkMessage(result: string): Message {
  const messages: Record<string, Message> = {
    MATCHED: {
      bn: "গেটওয়ের লেনদেন যাচাই করে তথ্য মিলেছে।",
      en: "The gateway transaction was independently checked and matched.",
    },
    MISMATCH: {
      bn: "গেটওয়ের তথ্যে অমিল পাওয়া গেছে। মিল নিশ্চিত না হওয়া পর্যন্ত নতুন সনদ ইস্যু বন্ধ থাকবে।",
      en: "Gateway records did not match. New certificate issuance is held until a matching verification.",
    },
    PENDING: {
      bn: "গেটওয়ে যাচাই এখনও অপেক্ষমাণ। এটিকে সফল পরিশোধ ধরে নেওয়া হবে না।",
      en: "Gateway verification is still pending. This does not establish successful payment.",
    },
    ERROR: {
      bn: "গেটওয়ে যাচাই সম্পন্ন করা যায়নি। আগের রেকর্ড অপরিবর্তিত আছে; পরে আবার অবস্থা যাচাই করুন।",
      en: "Gateway verification could not complete. Earlier records remain unchanged; check the status again later.",
    },
  };
  return messages[result] ?? messages.ERROR;
}
function checkReason(reason: string) {
  const reasons: Record<string, Message> = {
    PROVIDER_TRANSACTION_MATCHED: {
      bn: "লেনদেন ও প্রাপকের তথ্য মিলেছে।",
      en: "Transaction and receiving merchant details match.",
    },
    PROVIDER_PAYMENT_NOT_COMPLETED: {
      bn: "গেটওয়েতে পরিশোধ এখনও সম্পন্ন হয়নি।",
      en: "The gateway has not completed the payment.",
    },
    PAYMENT_CHECK_IN_PROGRESS: {
      bn: "আগের যাচাই অনুরোধ এখনও চলছে।",
      en: "The previous verification request is still running.",
    },
    CHECKOUT_CREATION_REQUIRES_RECOVERY: {
      bn: "পেমেন্ট লিংকের অবস্থা গেটওয়ের সহায়তায় পুনরুদ্ধার করতে হবে।",
      en: "The checkout creation outcome requires provider-assisted recovery.",
    },
    GATEWAY_QUERY_MISMATCH: {
      bn: "গেটওয়ের পেমেন্ট তথ্য সংরক্ষিত আবেদনের সাথে মেলেনি।",
      en: "The gateway payment data differs from the saved application.",
    },
    GATEWAY_TRANSACTION_MISMATCH: {
      bn: "লেনদেনের টাকা বা প্রাপকের তথ্যে অমিল আছে।",
      en: "Transaction amount or receiving merchant details differ.",
    },
    GATEWAY_TRANSACTION_MISSING: {
      bn: "গেটওয়ে একটি যাচাইযোগ্য লেনদেন নম্বর দেয়নি।",
      en: "The gateway did not provide a verifiable transaction reference.",
    },
    GATEWAY_TRANSACTION_CHANGED: {
      bn: "গেটওয়ের লেনদেন আগের সংরক্ষিত প্রমাণ থেকে বদলেছে।",
      en: "The gateway transaction differs from the preserved evidence.",
    },
    GATEWAY_TRANSACTION_REUSED: {
      bn: "এই লেনদেন নম্বর অন্য একটি পেমেন্টে যুক্ত আছে।",
      en: "This transaction reference is already linked to another payment.",
    },
    GATEWAY_STATUS_CHANGED: {
      bn: "গেটওয়ের বর্তমান অবস্থা আগের নিশ্চিত পরিশোধের সাথে মেলেনি।",
      en: "The current gateway status differs from the earlier confirmed payment.",
    },
    GATEWAY_NOT_CONFIGURED: {
      bn: "অফিসের মার্চেন্ট সংযোগ চালু নেই।",
      en: "The office merchant connection is not active.",
    },
    GATEWAY_BINDING_CHANGED: {
      bn: "মূল মার্চেন্ট সংযোগ পুনরুদ্ধার করে যাচাই করতে হবে।",
      en: "Restore the original merchant connection before verification.",
    },
  };
  return reasons[reason]
    ? choose(reasons[reason])
    : label(
        "গেটওয়ের ফল নিশ্চিত করা যায়নি; দায়িত্বপ্রাপ্ত কর্মকর্তা যাচাই করবেন।",
        "The gateway result is uncertain; an authorized officer should review it.",
      );
}
function LatestCheck({
  check,
}: {
  check: NonNullable<Attempt["lastReconciliation"]>;
}) {
  return (
    <div className="payment-latest-check">
      <small>
        {label("সর্বশেষ গেটওয়ে যাচাই", "Latest gateway check")}:{" "}
        <strong>{statusLabel(check.result)}</strong>
      </small>
      <small>{checkReason(check.reason)}</small>
      <small>{check.checkedAt}</small>
    </div>
  );
}
function ReceiptLink({ id }: { id: string }) {
  return (
    <a
      className="button secondary"
      href={`/api/v1/receipts/${encodeURIComponent(id)}/pdf`}
      target="_blank"
      rel="noreferrer"
    >
      {label("রসিদের PDF খুলুন", "Open receipt PDF")}
    </a>
  );
}
function GatewayNotice({ availability }: { availability: Availability }) {
  return (
    <div className="payment-gateway-notice">
      {availability.sslcommerz?.available && (
        <p>
          <strong>SSLCommerz</strong> ·{" "}
          {availability.sslcommerz.environment === "SANDBOX"
            ? label("পরীক্ষামূলক গেটওয়ে (কার্ড ও মোবাইল ব্যাংকিং)", "Sandbox gateway (cards and mobile wallets)")
            : label("কার্ড ও মোবাইল ব্যাংকিং গেটওয়ে প্রস্তুত", "Cards and mobile wallets ready")}
        </p>
      )}
      <p>
        <strong>bKash</strong> ·{" "}
        {availability.available
          ? availability.environment === "SANDBOX"
            ? label("পরীক্ষামূলক গেটওয়ে", "Sandbox gateway")
            : label("মার্চেন্ট গেটওয়ে প্রস্তুত", "Merchant gateway ready")
          : label("মার্চেন্ট সেটআপ প্রয়োজন", "Merchant setup required")}
      </p>
      {!anyAvailable(availability) && (
        <p className="hint">
          {label(
            "এই অফিসে অনুমোদিত bKash মার্চেন্ট সংযোগ এখনো চালু হয়নি। এখন কোনো টাকা গ্রহণ করা হচ্ছে না।",
            "An approved bKash merchant connection is not active for this office. No money is being collected now.",
          )}
        </p>
      )}
      {(availability.environment === "SANDBOX" || availability.sslcommerz?.environment === "SANDBOX") && (
        <p className="notice">
          {label(
            "এটি গেটওয়ের পরীক্ষামূলক পরিবেশ। প্রকৃত টাকা পরিশোধের প্রমাণ নয়।",
            "This is the gateway's sandbox environment. It is not evidence of a real-money payment.",
          )}
        </p>
      )}
      <p className="hint">
        {label(
          "Nagad সংযোগ এখনো নেই। ব্যাংকে অর্থ জমার তথ্যও যুক্ত হয়নি।",
          "Nagad is not integrated. Bank payout data is not connected.",
        )}
      </p>
    </div>
  );
}

export function ApplicationPayment({
  applicationId,
  role,
  revision = "",
}: {
  applicationId: string;
  role: string;
  revision?: string;
}) {
  useLanguage();
  const [payment, setPayment] = useState<Payment | null>(null),
    [error, setError] = useState<Message | null>(null);
  const [message, setMessage] = useState<Message | null>(null),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  const requestKey = useRef(crypto.randomUUID());
  const reconcileKey = useRef(crypto.randomUUID());
  const actionEpoch = useRef(0);
  const mounted = useRef(true);
  const canPay = ["citizen", "staff", "admin"].includes(role);
  const canReconcile = ["citizen", "staff", "admin", "finance"].includes(role);
  useEffect(() => {
    mounted.current = true;
    requestKey.current = crypto.randomUUID();
    reconcileKey.current = crypto.randomUUID();
    return () => {
      mounted.current = false;
      actionEpoch.current++;
    };
  }, [applicationId]);
  useEffect(() => {
    let active = true;
    setPayment(null);
    setError(null);
    setMessage(null);
    api(`/applications/${applicationId}/payment`)
      .then((result) => {
        if (active) setPayment(result);
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [applicationId, revision, refresh]);
  const attempt = payment?.attempt;
  async function run(operation: (current: () => boolean) => Promise<void>) {
    const epoch = ++actionEpoch.current;
    const current = () => mounted.current && epoch === actionEpoch.current;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await operation(current);
    } catch (e) {
      if (current()) setError(errorMessage(e));
    } finally {
      if (current()) setBusy(false);
    }
  }
  return (
    <section
      className="application-payment"
      aria-label={label("অনলাইন ফি পরিশোধ", "Online fee payment")}
    >
      <div className="section-heading">
        <h3>{label("অনলাইন ফি পরিশোধ", "Online fee payment")}</h3>
        <button
          className="text-button"
          disabled={busy}
          onClick={() => setRefresh((v) => v + 1)}
        >
          {label("পেমেন্টের অবস্থা হালনাগাদ করুন", "Refresh payment status")}
        </button>
      </div>
      {error && (
        <p role="alert" className="notice error">
          {choose(error)}
        </p>
      )}
      {message && (
        <p role="status" className="notice">
          {choose(message)}
        </p>
      )}
      {!payment && !error && (
        <p role="status">
          {label("পেমেন্টের তথ্য লোড হচ্ছে…", "Loading payment details…")}
        </p>
      )}
      {payment && (
        <>
          <p>
            <span className="status">{statusLabel(payment.paymentStatus)}</span>{" "}
            · <strong>{money(payment.totalMinor)} ৳</strong>
          </p>
          {payment.totalMinor > 0 && (
            <GatewayNotice availability={payment.availability} />
          )}
          {attempt && (
            <p>
              {label("গেটওয়ে অনুরোধ", "Gateway attempt")}:{" "}
              <span className="status">{statusLabel(attempt.status)}</span>
              <small className="payment-reference">{attempt.invoice}</small>
            </p>
          )}
          {payment.receipt && (
            <div className="payment-receipt">
              <p>
                {label("রসিদ নম্বর", "Receipt number")}:{" "}
                <strong>{payment.receipt.receiptNumber}</strong>
              </p>
              <p>
                {label("গেটওয়ে লেনদেন নম্বর", "Gateway transaction")}:{" "}
                {payment.receipt.transactionId}
              </p>
              <ReceiptLink id={payment.receipt.id} />
            </div>
          )}
          {payment.paymentStatus === "REVIEW_REQUIRED" && (
            <p className="notice" role="status">
              {label(
                "পরবর্তী গেটওয়ে যাচাইয়ে অমিল পাওয়া গেছে। আগের রসিদ সংরক্ষিত আছে, তবে নতুন সনদ ইস্যু বন্ধ। আবার মিল পাওয়া যাচাই সম্পন্ন হলে এই বাধা উঠবে।",
                "A later gateway check found a mismatch. The original receipt is preserved, but new certificate issuance is on hold until another check matches.",
              )}
            </p>
          )}
          {attempt?.lastReconciliation && (
            <LatestCheck check={attempt.lastReconciliation} />
          )}
          {["COLLECTED", "REFUND_PENDING", "REFUNDED"].includes(payment.paymentStatus) && (
            <ApplicationRefunds applicationId={applicationId} canRequest={canPay && payment.paymentStatus === "COLLECTED"} />
          )}
          {payment.totalMinor > 0 && (
            <>
              {!payment.eligible &&
                anyAvailable(payment.availability) &&
                !attempt && (
                  <p className="hint">
                    {label(
                      "আবেদন অনুমোদিত হওয়ার পরে অনলাইন ফি পরিশোধ করা যাবে।",
                      "Online fee payment is available after the application is approved.",
                    )}
                  </p>
                )}
              {canPay && !attempt && !payment.receipt &&
                (availableProviders(payment.availability).length
                  ? availableProviders(payment.availability)
                  : (["BKASH"] as Provider[])
                ).map((provider) => (
                <button
                  key={provider}
                  disabled={
                    busy || !payment.eligible || !availableProviders(payment.availability).includes(provider)
                  }
                  onClick={() =>
                    void run(async (current) => {
                      const result = await api(
                        `/applications/${applicationId}/payments`,
                        "POST",
                        { provider, requestKey: requestKey.current },
                      );
                      if (!current()) return;
                      setPayment((current) =>
                        current
                          ? {
                              ...current,
                              attempt: result.attempt,
                              paymentStatus: "PENDING",
                            }
                          : current,
                      );
                      // The backend validates the provider's checkout URL; no user-controlled return query is used.
                      if (
                        result.attempt.status === "READY" &&
                        result.attempt.checkoutUrl
                      )
                        window.location.assign(result.attempt.checkoutUrl);
                      else
                        setMessage({
                          bn: "গেটওয়ের ফলাফলের অপেক্ষায়। একই আবেদন দিয়ে আবার পেমেন্ট তৈরি করবেন না; অবস্থা যাচাই করুন।",
                          en: "Waiting for the gateway result. Do not start another payment for this application; check its status.",
                        });
                    })
                  }
                >
                  {availableProviders(payment.availability).includes(provider)
                    ? provider === "SSLCOMMERZ"
                      ? label("কার্ড বা মোবাইল ব্যাংকিংয়ে পরিশোধ করুন (SSLCommerz)", "Pay by card or mobile wallet (SSLCommerz)")
                      : label("bKash-এ পরিশোধ করুন", "Pay with bKash")
                    : label("bKash সেটআপ প্রয়োজন", "bKash setup required")}
                </button>
              ))}
              {canPay &&
                attempt?.status === "READY" &&
                attempt.checkoutUrl &&
                availableProviders(payment.availability).includes(attempt.provider) && (
                  <a className="button" href={attempt.checkoutUrl}>
                    {attempt.provider === "SSLCOMMERZ"
                      ? label("SSLCommerz পেমেন্টে ফিরে যান", "Continue to SSLCommerz")
                      : label("bKash পেমেন্টে ফিরে যান", "Continue to bKash")}
                  </a>
                )}
              {canReconcile && attempt && (
                <button
                  className="secondary"
                  disabled={busy || !anyAvailable(payment.availability)}
                  onClick={() =>
                    void run(async (isCurrent) => {
                      const result = await api(
                        `/payments/${attempt.id}/reconcile`,
                        "POST",
                        { requestKey: reconcileKey.current },
                      );
                      if (!isCurrent()) return;
                      const current = await api(
                        `/applications/${applicationId}/payment`,
                      );
                      if (!isCurrent()) return;
                      setPayment(current);
                      if (result.reconciliation.id)
                        reconcileKey.current = crypto.randomUUID();
                      setMessage(checkMessage(result.reconciliation.result));
                    })
                  }
                >
                  {label("গেটওয়ের অবস্থা যাচাই করুন", "Check gateway status")}
                </button>
              )}
              {attempt &&
                ["CREATE_UNKNOWN", "REVIEW_REQUIRED", "FAILED"].includes(
                  attempt.status,
                ) && (
                  <p className="notice">
                    {label(
                      "এই অনুরোধে স্বয়ংক্রিয় নতুন পেমেন্ট বন্ধ আছে। দায়িত্বপ্রাপ্ত কর্মকর্তা গেটওয়ের তথ্য যাচাই করে সমাধান করবেন।",
                      "Automatic replacement checkout is blocked for this attempt. An authorized officer must review the gateway records to resolve it.",
                    )}
                  </p>
                )}
            </>
          )}
          <p className="hint">
            {label(
              "Astra-তে bKash PIN বা OTP লিখবেন না। পেমেন্ট হলে গেটওয়ের নিজস্ব পৃষ্ঠায় তথ্য দিন। গেটওয়ে থেকে ফিরে আসা মাত্রই পরিশোধ নিশ্চিত হয় না।",
              "Do not enter a bKash PIN or OTP in Astra. Use the gateway's own checkout page. Returning from the gateway alone does not confirm payment.",
            )}
          </p>
        </>
      )}
    </section>
  );
}

export function PaymentsWorkspace({ role }: { role: string }) {
  useLanguage();
  const canReconcile = ["admin", "finance"].includes(role);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [section, setSection] = useState("register"),
    [status, setStatus] = useState(""),
    [page, setPage] = useState(1);
  const [businessDate, setBusinessDate] = useState(todayDhaka);
  const [payments, setPayments] = useState<Attempt[]>([]),
    [total, setTotal] = useState(0),
    [loaded, setLoaded] = useState(false);
  const [reconciliation, setReconciliation] = useState<Reconciliation | null>(
    null,
  );
  const [error, setError] = useState<Message | null>(null),
    [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const reconcileKeys = useRef(new Map<string, string>());
  useEffect(() => {
    let active = true;
    api("/payments/configuration")
      .then((result) => {
        if (active) setAvailability(result);
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [revision]);
  useEffect(() => {
    let active = true;
    setLoaded(false);
    setReconciliation(null);
    const query = new URLSearchParams({
      businessDate,
      ...(status ? { status } : {}),
      page: String(page),
      pageSize: "20",
    });
    const operation =
      section === "register"
        ? api(`/payments?${query}`)
        : api(
            `/payments/reconciliation?businessDate=${encodeURIComponent(businessDate)}`,
          );
    operation
      .then((result) => {
        if (!active) return;
        if (section === "register") {
          setPayments(result.items);
          setTotal(result.total);
        } else setReconciliation(result);
        setLoaded(true);
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [section, businessDate, status, page, revision]);
  return (
    <div className="payments-workspace">
      <section className="panel">
        <div className="section-heading">
          <h2>{label("পেমেন্ট ও রসিদ", "Payments and receipts")}</h2>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => {
              setError(null);
              setRevision((v) => v + 1);
            }}
          >
            {label("পেমেন্ট তালিকা হালনাগাদ করুন", "Refresh payment register")}
          </button>
        </div>
        <p>
          {label(
            "অনুমোদিত আবেদনের অনলাইন পেমেন্ট, সংরক্ষিত রসিদ ও গেটওয়ে যাচাই দেখুন।",
            "Review online payments for approved applications, saved receipts and gateway verification.",
          )}
        </p>
        {availability && <GatewayNotice availability={availability} />}
        <div
          className="tabs"
          role="tablist"
          aria-label={label("পেমেন্ট বিভাগের তালিকা", "Payment sections")}
        >
          <button
            role="tab"
            aria-selected={section === "register"}
            className={section === "register" ? "" : "secondary"}
            onClick={() => setSection("register")}
          >
            {label("পেমেন্ট তালিকা", "Payment register")}
          </button>
          {canReconcile && (
            <button
              role="tab"
              aria-selected={section === "reconciliation"}
              className={section === "reconciliation" ? "" : "secondary"}
              onClick={() => setSection("reconciliation")}
            >
              {label("গেটওয়ে হিসাব মিল", "Gateway reconciliation")}
            </button>
          )}
        </div>
        {error && (
          <p role="alert" className="notice error">
            {choose(error)}
          </p>
        )}
        {message && (
          <p role="status" className="notice">
            {choose(message)}
          </p>
        )}
        <div className="form-grid">
          <label htmlFor="payment-business-date">
            {label("হিসাবের তারিখ (ঢাকা)", "Business date (Dhaka)")}
            <input
              id="payment-business-date"
              type="date"
              required
              max={todayDhaka()}
              value={businessDate}
              onChange={(e) => {
                setBusinessDate(e.target.value);
                setPage(1);
              }}
            />
          </label>
          {section === "register" && (
            <label htmlFor="payment-status">
              {label("পেমেন্টের অবস্থা", "Payment status")}
              <select
                id="payment-status"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">{label("সব অবস্থা", "All statuses")}</option>
                {[
                  "READY",
                  "PAID",
                  "VERIFYING",
                  "CREATE_PENDING",
                  "CREATE_UNKNOWN",
                  "EXECUTE_PENDING",
                  "REVIEW_REQUIRED",
                  "FAILED",
                ].map((value) => (
                  <option value={value} key={value}>
                    {statusLabel(value)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </section>
      <section className="panel">
        {!loaded && (
          <p role="status">
            {label("পেমেন্টের তথ্য লোড হচ্ছে…", "Loading payment records…")}
          </p>
        )}
        {loaded && section === "register" && (
          <>
            <h3>{label("পেমেন্ট অনুরোধ", "Payment attempts")}</h3>
            {payments.length === 0 && (
              <p>
                {label(
                  "নির্বাচিত তারিখ ও অবস্থায় কোনো পেমেন্ট অনুরোধ নেই।",
                  "There are no payment attempts for the selected date and status.",
                )}
              </p>
            )}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{label("আবেদন", "Application")}</th>
                    <th>{label("টাকার অঙ্ক", "Amount")}</th>
                    <th>{label("গেটওয়ে ও অবস্থা", "Gateway and status")}</th>
                    <th>{label("রসিদ ও যাচাই", "Receipt and verification")}</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.id}>
                      <td>
                        {payment.applicantName}
                        <small>
                          {label("সেবা", "Service")} #{payment.serviceNo}
                        </small>
                        <small className="payment-reference">
                          {payment.applicationId}
                        </small>
                      </td>
                      <td>{money(payment.amountMinor)} ৳</td>
                      <td>
                        bKash ·{" "}
                        {payment.environment === "LIVE"
                          ? label("লাইভ", "Live")
                          : label("পরীক্ষামূলক", "Sandbox")}
                        <small>{statusLabel(payment.status)}</small>
                        {payment.paymentStatus === "REVIEW_REQUIRED" && (
                          <span className="status">
                            {label(
                              "নতুন সনদ ইস্যু স্থগিত",
                              "New issuance on hold",
                            )}
                          </span>
                        )}
                        {payment.lastReconciliation && (
                          <LatestCheck check={payment.lastReconciliation} />
                        )}
                      </td>
                      <td>
                        {payment.receiptId && (
                          <ReceiptLink id={payment.receiptId} />
                        )}
                        <button
                          className="text-button"
                          disabled={busy || !availability?.available}
                          onClick={async () => {
                            setBusy(true);
                            setError(null);
                            setMessage(null);
                            try {
                              if (!reconcileKeys.current.has(payment.id))
                                reconcileKeys.current.set(
                                  payment.id,
                                  crypto.randomUUID(),
                                );
                              const result = await api(
                                `/payments/${payment.id}/reconcile`,
                                "POST",
                                {
                                  requestKey: reconcileKeys.current.get(
                                    payment.id,
                                  ),
                                },
                              );
                              if (result.reconciliation.id)
                                reconcileKeys.current.delete(payment.id);
                              setMessage(
                                checkMessage(result.reconciliation.result),
                              );
                              setRevision((v) => v + 1);
                            } catch (e) {
                              setError(errorMessage(e));
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          {label(
                            "গেটওয়ের অবস্থা যাচাই করুন",
                            "Check gateway status",
                          )}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="actions">
              <button
                className="secondary"
                disabled={page <= 1 || busy}
                onClick={() => setPage(page - 1)}
              >
                {label("আগের পৃষ্ঠা", "Previous page")}
              </button>
              <span>
                {label("পৃষ্ঠা", "Page")} {page} · {total}{" "}
                {label("রেকর্ড", "records")}
              </span>
              <button
                className="secondary"
                disabled={page * 20 >= total || busy}
                onClick={() => setPage(page + 1)}
              >
                {label("পরের পৃষ্ঠা", "Next page")}
              </button>
            </div>
          </>
        )}
        {loaded && section === "reconciliation" && reconciliation && (
          <>
            <h3>
              {label(
                "গেটওয়ে যাচাইয়ের সারসংক্ষেপ",
                "Gateway verification summary",
              )}
            </h3>
            <p className="notice">
              {label(
                "এই হিসাব গেটওয়ের লেনদেনের সাথে মেলে। ব্যাংকে টাকা জমা হওয়া বা ব্যাংক বিবরণীর সাথে হিসাব মিল এখনও সংযুক্ত হয়নি।",
                "This report compares gateway transactions. Bank payouts and bank statement reconciliation are not connected.",
              )}
            </p>
            <dl className="fee-breakdown">
              <div>
                <dt>{label("মোট পেমেন্ট অনুরোধ", "Total payment attempts")}</dt>
                <dd>{reconciliation.totalCount}</dd>
              </div>
              <div>
                <dt>{label("যাচাইকৃত পেমেন্ট", "Verified payments")}</dt>
                <dd>{reconciliation.paidCount}</dd>
              </div>
              <div>
                <dt>{label("যাচাইকৃত মোট টাকা", "Verified total")}</dt>
                <dd>{money(reconciliation.paidMinor)} ৳</dd>
              </div>
              <div>
                <dt>{label("অপেক্ষমাণ অনুরোধ", "Pending attempts")}</dt>
                <dd>{reconciliation.pendingCount}</dd>
              </div>
              <div>
                <dt>{label("পর্যালোচনা প্রয়োজন", "Needs review")}</dt>
                <dd>{reconciliation.reviewCount}</dd>
              </div>
              <div>
                <dt>{label("মিল পাওয়া যাচাই", "Matched checks")}</dt>
                <dd>{reconciliation.results.matched}</dd>
              </div>
              <div>
                <dt>{label("অমিল পাওয়া যাচাই", "Mismatched checks")}</dt>
                <dd>{reconciliation.results.mismatch}</dd>
              </div>
              <div>
                <dt>{label("অপেক্ষমাণ যাচাই", "Pending checks")}</dt>
                <dd>{reconciliation.results.pending}</dd>
              </div>
              <div>
                <dt>{label("অসম্পূর্ণ যাচাই", "Unavailable checks")}</dt>
                <dd>{reconciliation.results.error}</dd>
              </div>
            </dl>
            <a
              className="button secondary"
              href={`/api/v1/payments/reconciliation/export.csv?businessDate=${encodeURIComponent(businessDate)}`}
              download
            >
              {label("হিসাবের CSV ডাউনলোড", "Download reconciliation CSV")}
            </a>
          </>
        )}
      </section>
    </div>
  );
}
