import fs from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ApiError } from "./models.js";
import { minorToMoney, moneyToMinor, type CreatedPayment, type Gateway, type PaymentResult, type TransactionResult } from "./bkash.js";

/**
 * Phase 5c: SSLCommerz (cards and mobile wallets through one hosted page), API v4. Checked against the
 * provider's developer documentation on 15 November 2026:
 *  - session: POST {host}/gwprocess/v4/api.php → status SUCCESS, sessionkey, GatewayPageURL
 *  - query by session: GET {host}/validator/api/merchantTransIDvalidationAPI.php?sessionkey=…
 *  - validation: GET {host}/validator/api/validationserverAPI.php?val_id=… (VALID / VALIDATED)
 * A browser return or IPN is only a signal: payment is accepted only after both the session query and the
 * order validation agree on invoice, amount and currency (the same rule as bKash Query + Search).
 * Card numbers and wallet PINs are entered only on SSLCommerz's page.
 */
export type SslcommerzConfig = {
  tenantId: string;
  environment: "SANDBOX" | "LIVE";
  storeId: string;
  storePassword: string;
};
const hosts = { SANDBOX: "sandbox.sslcommerz.com", LIVE: "securepay.sslcommerz.com" } as const;
export const sslcommerzOrigins = Object.values(hosts).map((host) => `https://${host}`);
const problem = (code: string, message: string, status = 502) => new ApiError(status, code, message);
const invalid = (): never => {
  throw problem("GATEWAY_RESPONSE_INVALID", "The gateway response could not be verified. No payment has been confirmed.");
};
const text = (value: unknown, max = 255): string =>
  typeof value === "string" && value.trim() && value.length <= max && !/[\x00-\x1f]/.test(value) ? value : invalid();
/** SSLCommerz statuses mapped to the provider-neutral words payments.ts checks. */
function status(value: unknown) {
  const s = text(value, 40).toUpperCase();
  return s === "VALID" || s === "VALIDATED" ? "Completed" : s === "PENDING" ? "Initiated" : s;
}

// --- Merchant secret encryption (MERCHANT_SECRET_KEY, 64 hex; a dev key file outside production) ---
const keyFile = ".runtime/merchant-secret-key";
function merchantKey(): Buffer | null {
  const configured = process.env.MERCHANT_SECRET_KEY;
  if (configured) return /^[a-f0-9]{64}$/i.test(configured) ? Buffer.from(configured, "hex") : null;
  if (process.env.NODE_ENV === "production") return null;
  if (!fs.existsSync(keyFile)) {
    fs.mkdirSync(".runtime", { recursive: true });
    fs.writeFileSync(keyFile, randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  return Buffer.from(fs.readFileSync(keyFile, "utf8").trim(), "hex");
}
export const merchantSecretsAvailable = () => merchantKey() !== null;
const aad = (tenantId: string, environment: string) => Buffer.from(`astra-merchant-v1:${tenantId}:SSLCOMMERZ:${environment}`);
export function sealMerchantSecret(secret: string, tenantId: string, environment: string) {
  const key = merchantKey();
  if (!key) throw problem("MERCHANT_SECRETS_UNAVAILABLE", "Storing merchant credentials is not enabled on this server.", 503);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad(tenantId, environment));
  const bytes = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", nonce.toString("hex"), cipher.getAuthTag().toString("hex"), bytes.toString("hex")].join(".");
}
export function openMerchantSecret(sealed: string, tenantId: string, environment: string) {
  const key = merchantKey();
  if (!key) throw problem("MERCHANT_SECRETS_UNAVAILABLE", "Merchant credentials cannot be read on this server.", 503);
  try {
    const [, nonce, tag, bytes] = sealed.split(".");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(nonce!, "hex"));
    decipher.setAAD(aad(tenantId, environment));
    decipher.setAuthTag(Buffer.from(tag!, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(bytes!, "hex")), decipher.final()]).toString("utf8");
  } catch {
    throw problem("MERCHANT_SECRETS_UNAVAILABLE", "The stored merchant credentials could not be read.", 503);
  }
}

// --- Transport (replaceable in tests only) ---
export type Transport = (url: string, init: { method: "GET" | "POST"; body?: URLSearchParams }) => Promise<any>;
const httpTransport: Transport = async (url, init) => {
  const response = await fetch(url, {
    method: init.method,
    body: init.body,
    headers: init.body ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
    signal: AbortSignal.timeout(20000),
    redirect: "error",
  });
  if (!response.ok) throw problem("GATEWAY_UNAVAILABLE", "The payment gateway did not respond. No payment has been confirmed.");
  return response.json().catch(invalid);
};
let transport: Transport = httpTransport;
export function setSslcommerzTransportForTests(next: Transport | null) {
  if (process.env.NODE_ENV !== "test") throw new Error("Gateway transports are replaceable only in tests.");
  transport = next ?? httpTransport;
}

export class SslcommerzGateway implements Gateway {
  readonly provider = "SSLCOMMERZ" as const;
  readonly environment: "SANDBOX" | "LIVE";
  readonly merchantAccount: string;
  constructor(private config: SslcommerzConfig) {
    this.environment = config.environment;
    this.merchantAccount = config.storeId;
  }
  private url(path: string, params?: Record<string, string>) {
    const url = new URL(`https://${hosts[this.environment]}${path}`);
    if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return url.toString();
  }
  private credentials() {
    return { store_id: this.config.storeId, store_passwd: this.config.storePassword };
  }
  async create(input: { invoice: string; amountMinor: number; callbackURL: string; payerReference: string }): Promise<CreatedPayment> {
    // Only what the provider requires. Customer fields are mandatory there; Astra sends neutral values
    // instead of the citizen's personal data, which the hosted page collects itself when it needs it.
    const body = new URLSearchParams({
      ...this.credentials(),
      total_amount: minorToMoney(input.amountMinor),
      currency: "BDT",
      tran_id: input.invoice,
      success_url: input.callbackURL,
      fail_url: input.callbackURL,
      cancel_url: input.callbackURL,
      ipn_url: input.callbackURL,
      shipping_method: "NO",
      product_name: "Union certificate application fee",
      product_category: "government-service",
      product_profile: "non-physical-goods",
      cus_name: "Astra applicant",
      cus_email: "applicant@astra.invalid",
      cus_phone: "01000000000",
      cus_city: "Dhaka",
      cus_postcode: "1000",
      cus_country: "Bangladesh",
      cus_add1: "Not provided",
      value_a: input.payerReference,
    });
    const data = await transport(this.url("/gwprocess/v4/api.php"), { method: "POST", body });
    if (data?.status !== "SUCCESS") throw problem("GATEWAY_CREATE_FAILED", "The payment gateway did not open a checkout. Try again later.");
    const checkoutUrl = text(data.GatewayPageURL, 2000);
    let page: URL;
    try {
      page = new URL(checkoutUrl);
    } catch {
      return invalid();
    }
    if (page.protocol !== "https:" || page.hostname !== hosts[this.environment] || page.username || page.password || page.port)
      return invalid();
    return {
      paymentId: text(data.sessionkey, 200),
      checkoutUrl,
      // SSLCommerz does not sign the browser return; Astra's own random value is carried in the return URL
      // and compared on arrival, beside the opaque callback token.
      signature: randomBytes(24).toString("hex"),
      amountMinor: input.amountMinor,
      currency: "BDT",
      invoice: input.invoice,
    };
  }
  /** SSLCommerz completes payment on its own page; "execute" only reads the outcome, so it is safe to repeat. */
  async execute(paymentId: string): Promise<PaymentResult> {
    return this.query(paymentId);
  }
  async query(paymentId: string): Promise<PaymentResult> {
    const data = await transport(
      this.url("/validator/api/merchantTransIDvalidationAPI.php", { sessionkey: paymentId, ...this.credentials(), format: "json" }),
      { method: "GET" },
    );
    if (data?.APIConnect !== undefined && data.APIConnect !== "DONE") invalid();
    const s = status(data.status);
    const result: PaymentResult = {
      paymentId: text(data.sessionkey ?? paymentId, 200),
      status: s,
      amountMinor: moneyToMinor(data.amount),
      currency: text(data.currency, 10),
      invoice: text(data.tran_id, 100),
      intent: "sale",
    };
    if (data.val_id !== undefined && data.val_id !== null && data.val_id !== "") result.transactionId = text(data.val_id, 200);
    if (s === "Completed" && !result.transactionId) invalid();
    if (result.paymentId !== paymentId) invalid();
    return result;
  }
  /** Order validation by val_id: the provider's authoritative check of one completed payment. */
  async search(transactionId: string): Promise<TransactionResult> {
    const data = await transport(
      this.url("/validator/api/validationserverAPI.php", { val_id: transactionId, ...this.credentials(), format: "json" }),
      { method: "GET" },
    );
    const s = status(data?.status);
    // A payment the provider flags as risky is held for review rather than accepted.
    const risky = String(data?.risk_level ?? "0") !== "0";
    if (s !== "Completed")
      return { transactionId, status: s, amountMinor: 0, currency: "BDT", merchantAccount: this.merchantAccount };
    if (text(data.val_id, 200) !== transactionId) invalid();
    return {
      transactionId,
      status: risky ? "RISK_REVIEW" : s,
      amountMinor: moneyToMinor(data.amount),
      currency: text(data.currency, 10),
      // The validation call is authenticated with this office's store credentials, so a VALID answer
      // belongs to this store.
      merchantAccount: this.merchantAccount,
      ...(data.store_amount !== undefined ? { creditedAmountMinor: moneyToMinor(data.store_amount) } : {}),
    };
  }
}
