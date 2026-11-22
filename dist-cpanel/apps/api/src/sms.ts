import fs from "node:fs";
import { identifierHint } from "./identifiers.js";
import { sendSmsViaHttp, smsHttpConfigured } from "./sms-http.js";

/**
 * Phase X: status SMS for application events (certificate issued, application rejected),
 * closing the E2E QA J8 gap "no status SMS exists for application events".
 * SMS in this product shares one channel with the OTP module (otp.ts) — the development
 * "log" provider, or the real gateway under OTP_PROVIDER=http (Phase 7, sms-http.ts) —
 * so this module is gated by the same OTP_PROVIDER setting for OTP codes and status
 * messages alike. With the log provider a message reaches no handset;
 * Security Audit 01, F1: the server log line records only the recipient hint and purpose
 * (status messages carry certificate numbers, which must never land in a server log);
 * outside production the message is also written to the git-ignored
 * .runtime/sms-outbox.log development mailbox, which is never written in production —
 * and the status surfaces say honestly that nothing was sent.
 */
export interface SmsMessage {
  mobile: string;
  message: string;
  purpose: "certificate_issued" | "application_rejected" | "correction_required" | "certificate_revoked";
}
export interface SmsProvider {
  send(message: SmsMessage): Promise<void>;
}

const outbox = ".runtime/sms-outbox.log";
export const logSmsProvider: SmsProvider = {
  async send({ mobile, message, purpose }) {
    const hint = identifierHint("mobile", mobile);
    console.log(`[sms:log] ${purpose} message for ${hint} (body not logged)`);
    if (process.env.NODE_ENV !== "production") {
      fs.mkdirSync(".runtime", { recursive: true });
      fs.appendFileSync(outbox, `${JSON.stringify({ mobile, message, purpose, at: new Date().toISOString() })}\n`);
    }
  },
};

/** Phase 7: the real SMS gateway (OTP_PROVIDER=http, SMS_HTTP_* env) — see sms-http.ts. */
export const httpSmsProvider: SmsProvider = {
  async send({ mobile, message }) {
    await sendSmsViaHttp(mobile, message);
  },
};
function configuredProvider(): SmsProvider | null {
  const name = process.env.OTP_PROVIDER ?? (process.env.NODE_ENV === "production" ? "" : "log");
  if (name === "log") return logSmsProvider;
  if (name === "http") return smsHttpConfigured() ? httpSmsProvider : null;
  return null;
}
let provider = configuredProvider();
/** Tests swap the provider; production configuration comes only from OTP_PROVIDER. */
export function setSmsProvider(next: SmsProvider | null) {
  provider = next;
}
export const smsAvailable = () => provider !== null;
/** Security Audit 01, F1: lets the server boot path warn when the log provider is live in production. */
export const smsProviderIsLog = () => provider === logSmsProvider;

/** Deliver one status message. Never throws; returns whether it was sent. */
export async function sendStatusSms(message: SmsMessage): Promise<boolean> {
  if (!provider) return false;
  try {
    await provider.send(message);
    return true;
  } catch (error) {
    console.error(`[sms] delivery for purpose ${message.purpose} failed:`, error);
    return false;
  }
}
