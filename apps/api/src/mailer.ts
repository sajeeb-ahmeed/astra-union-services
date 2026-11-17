import fs from "node:fs";
import nodemailer from "nodemailer";

/**
 * Phase X: outbound email, closing the E2E QA gaps "email verification absent" and
 * "email notifications not implemented" (J3/J8). The provider abstraction mirrors the OTP
 * module (otp.ts): configuration comes only from the environment, an unconfigured production
 * server reports email unavailable instead of pretending to send, and the "log" provider —
 * for local development, tests and demo deployments without an SMTP account — writes each
 * message to the server log and, outside production, to .runtime/email-outbox.log.
 * A real deployment sets EMAIL_PROVIDER=smtp with the owner's SMTP_* settings.
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}
export interface MailProvider {
  send(message: MailMessage): Promise<void>;
}

const outbox = ".runtime/email-outbox.log";
export const logMailProvider: MailProvider = {
  async send({ to, subject, text }) {
    console.log(`[email:log] to=${to} subject=${JSON.stringify(subject)} text=${JSON.stringify(text)}`);
    if (process.env.NODE_ENV !== "production") {
      fs.mkdirSync(".runtime", { recursive: true });
      fs.appendFileSync(outbox, `${JSON.stringify({ to, subject, text, at: new Date().toISOString() })}\n`);
    }
  },
};

function smtpProviderFromEnv(): MailProvider | null {
  const host = process.env.SMTP_HOST;
  const from = process.env.SMTP_FROM ?? process.env.SMTP_USER;
  if (!host || !from) {
    console.error(
      "[email] EMAIL_PROVIDER=smtp but SMTP_HOST or SMTP_FROM/SMTP_USER is missing; email is unavailable.",
    );
    return null;
  }
  const port = Number(process.env.SMTP_PORT ?? 587);
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
  });
  return {
    async send({ to, subject, text }) {
      await transporter.sendMail({ from, to, subject, text });
    },
  };
}

type ProviderName = "log" | "smtp";
let provider: MailProvider | null = null;
let providerName: ProviderName | "custom" | null = null;
function configure() {
  const name = process.env.EMAIL_PROVIDER ?? (process.env.NODE_ENV === "production" ? "" : "log");
  if (name === "log") {
    provider = logMailProvider;
    providerName = "log";
  } else if (name === "smtp") {
    provider = smtpProviderFromEnv();
    providerName = provider ? "smtp" : null;
  } else {
    provider = null;
    providerName = null;
  }
}
configure();

/** Tests swap the provider; production configuration comes only from EMAIL_PROVIDER. */
export function setMailProvider(next: MailProvider | null, name: ProviderName | "custom" | null = next ? "custom" : null) {
  provider = next;
  providerName = next ? name : null;
}
export const emailAvailable = () => provider !== null;
export const emailProviderName = () => providerName;

/**
 * Deliver one message. Never throws: a mail failure must not fail the business action that
 * triggered the message (registration, issuance, rejection). Returns whether it was sent.
 */
export async function sendEmail(message: MailMessage): Promise<boolean> {
  if (!provider) return false;
  try {
    await provider.send(message);
    return true;
  } catch (error) {
    console.error(`[email] delivery to ${message.to} failed:`, error);
    return false;
  }
}
