import fs from "node:fs";
import express from "express";
import { z } from "zod";
import { randomInt } from "node:crypto";
import { pool, type DB } from "./db.js";
import { fail } from "./models.js";
import { digest, randomToken } from "./security.js";
import { createRateLimiter } from "./http-hardening.js";
import {
  identifierDigest,
  identifierHint,
  identifiersAvailable,
  normalizeIdentifier,
} from "./identifiers.js";
import { sendSmsViaHttp, smsHttpConfigured } from "./sms-http.js";

/**
 * Phase 2c: one-time codes for mobile verification at citizen registration.
 * A code is never returned by the API. Phase 7 adds the real SMS gateway beside
 * the development provider: OTP_PROVIDER=http sends through sms-http.ts.
 * Security Audit 01, F1: the "log" provider previously wrote the plaintext code to
 * the server log — anyone with log access held a working code. The server log line
 * now records only the recipient hint and purpose, in every environment. Outside
 * production the code is also written to the git-ignored .runtime/otp-outbox.log —
 * the local development mailbox the black-box browser suite reads to complete the
 * signup flow; that file is never written when NODE_ENV=production, and API-level
 * flows inject a capturing provider instead (setOtpProvider).
 *
 * S-001 (Phase 4 Stage 1): a mobile number is a trusted sign-in identifier only
 * after a code sent to that handset is proven. Short signup without a code
 * creates the account with the mobile PENDING (account_identifiers.verified_at
 * NULL, self_declared true) — mobile sign-in stays blocked until the holder
 * completes POST /auth/otp/verify-mobile with a fresh code. Registration
 * itself never depends on the SMS provider: when the provider is unavailable
 * /auth/otp/signup answers 503 OTP_UNAVAILABLE, the account is still created,
 * and the mobile simply stays pending — an outage can never mark a mobile
 * verified, and no code path here ever writes verified_at without a proven code.
 */
export interface OtpProvider {
  send(input: { mobile: string; code: string; purpose: "signup_mobile" }): Promise<void>;
}
const outbox = ".runtime/otp-outbox.log";
export const logOtpProvider: OtpProvider = {
  async send({ mobile, code, purpose }) {
    const hint = identifierHint("mobile", mobile);
    console.log(`[otp:log] ${purpose} code sent to ${hint} (code not logged)`);
    if (process.env.NODE_ENV !== "production") {
      fs.mkdirSync(".runtime", { recursive: true });
      fs.appendFileSync(outbox, `${JSON.stringify({ mobile, code, purpose, at: new Date().toISOString() })}\n`);
    }
  },
};
/** Phase 7: the real SMS gateway (OTP_PROVIDER=http, SMS_HTTP_* env) — see sms-http.ts. */
export const httpOtpProvider: OtpProvider = {
  async send({ mobile, code, purpose }) {
    await sendSmsViaHttp(
      mobile,
      `DigitalUnion: আপনার যাচাই কোড ${code} / Your verification code is ${code}. It expires in ${CODE_TTL_MINUTES} minutes.`,
    );
    void purpose;
  },
};
function configuredProvider(): OtpProvider | null {
  const name = process.env.OTP_PROVIDER ?? (process.env.NODE_ENV === "production" ? "" : "log");
  if (name === "log") return logOtpProvider;
  if (name === "http") return smsHttpConfigured() ? httpOtpProvider : null;
  return null;
}
let provider = configuredProvider();
/** Tests swap the provider; production configuration comes only from OTP_PROVIDER. */
export function setOtpProvider(next: OtpProvider | null) {
  provider = next;
}
export const otpAvailable = () => provider !== null && identifiersAvailable();
/** W-010: the configured provider name for the health endpoint (never a secret or a value). */
export const otpProviderName = () =>
  provider === null ? null : provider === logOtpProvider ? "log" : "http";
/** Security Audit 01, F1: lets the server boot path warn when the log provider is live in production. */
export const otpProviderIsLog = () => provider === logOtpProvider;

const CODE_TTL_MINUTES = 10;
const VERIFIED_USE_MINUTES = 15;
const RESEND_SECONDS = 60;
const HOURLY_LIMIT = 5;
const codeHash = (token: string, code: string) => digest(`${token}:${code}`);
const mobileInput = z.string().min(1).max(40);

export const otpRouter = express.Router();
const otpLimiter = createRateLimiter({ limit: 20, windowMs: 60_000 });
otpRouter.get("/auth/otp/status", (_req, res) => {
  res.json({ available: otpAvailable(), resendSeconds: RESEND_SECONDS, ttlMinutes: CODE_TTL_MINUTES });
});
otpRouter.post(
  "/auth/otp/signup",
  otpLimiter,
  async (req, res, next) => {
    try {
      if (!otpAvailable())
        fail(503, "OTP_UNAVAILABLE", "Mobile verification is not enabled on this server.");
      const input = z.object({ mobile: mobileInput }).strict().parse(req.body);
      const mobile = normalizeIdentifier("mobile", input.mobile);
      if (!mobile)
        fail(422, "IDENTIFIER_INVALID", "Enter an 11-digit Bangladeshi mobile number starting with 01.");
      const identifier = identifierDigest("mobile", mobile);
      const recent = (
        await pool.query(
          `SELECT count(*) FILTER (WHERE created_at > clock_timestamp() - make_interval(secs => $2))::int AS last_minute,
                  count(*)::int AS last_hour
             FROM otp_challenges WHERE identifier_digest=$1 AND created_at > clock_timestamp() - interval '1 hour'`,
          [identifier, RESEND_SECONDS],
        )
      ).rows[0];
      if (recent.last_minute > 0 || recent.last_hour >= HOURLY_LIMIT)
        fail(
          429,
          "OTP_RATE_LIMIT",
          recent.last_hour >= HOURLY_LIMIT
            ? "Too many codes for this number. Try again in an hour."
            : `Wait ${RESEND_SECONDS} seconds before asking for another code.`,
        );
      const token = randomToken();
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      const row = (
        await pool.query(
          `INSERT INTO otp_challenges(token_hash,purpose,identifier_digest,code_hash,expires_at)
           VALUES($1,'signup_mobile',$2,$3,clock_timestamp() + make_interval(mins => $4)) RETURNING expires_at`,
          [digest(token), identifier, codeHash(token, code), CODE_TTL_MINUTES],
        )
      ).rows[0];
      await provider!.send({ mobile, code, purpose: "signup_mobile" });
      res.status(202).json({ challengeToken: token, expiresAt: row.expires_at, resendAfterSeconds: RESEND_SECONDS });
    } catch (error) {
      next(error);
    }
  },
);
otpRouter.post(
  "/auth/otp/verify",
  otpLimiter,
  async (req, res, next) => {
    try {
      const input = z
        .object({ challengeToken: z.string().regex(/^[a-f0-9]{64}$/), code: z.string().regex(/^\d{6}$/) })
        .strict()
        .parse(req.body);
      const outcome = await checkOtpCode(input.challengeToken, input.code);
      if (outcome.ok) {
        res.json({ verified: true });
        return;
      }
      if (outcome.expired)
        fail(410, "OTP_EXPIRED", "This code has expired or was used. Ask for a new code.");
      fail(
        422,
        "OTP_INVALID",
        outcome.remaining > 0
          ? `The code is not correct. ${outcome.remaining} tries left.`
          : "The code is not correct. Ask for a new code.",
      );
    } catch (error) {
      next(error);
    }
  },
);

/**
 * S-001: verify a mobile number on an EXISTING account. The caller proves the
 * handset with a fresh code (sent via POST /auth/otp/signup — the code is
 * checked here, so this is a single code entry, not a second one), and the
 * pending identifier for that exact number becomes a trusted sign-in
 * identifier. Unauthenticated by necessity: an email-less account whose only
 * sign-in was its pending mobile has no session to verify with — the code
 * delivered to the handset IS the proof, and only the holder of the number
 * can reach the success branch. A code verifies at most one identifier; a
 * number with no pending identifier answers 404; an already-verified number
 * answers success idempotently.
 */
otpRouter.post(
  "/auth/otp/verify-mobile",
  otpLimiter,
  async (req, res, next) => {
    try {
      const input = z
        .object({
          challengeToken: z.string().regex(/^[a-f0-9]{64}$/),
          code: z.string().regex(/^\d{6}$/),
          mobile: mobileInput,
        })
        .strict()
        .parse(req.body);
      const mobile = normalizeIdentifier("mobile", input.mobile);
      if (!mobile)
        fail(422, "IDENTIFIER_INVALID", "Enter an 11-digit Bangladeshi mobile number starting with 01.");
      const outcome = await checkOtpCode(input.challengeToken, input.code, mobile);
      if (!outcome.ok) {
        if (outcome.expired)
          fail(410, "OTP_EXPIRED", "This code has expired or was used. Ask for a new code.");
        fail(
          422,
          "OTP_INVALID",
          outcome.remaining > 0
            ? `The code is not correct. ${outcome.remaining} tries left.`
            : "The code is not correct. Ask for a new code.",
        );
      }
      const updated = (
        await pool.query(
          `UPDATE account_identifiers SET verified_at=clock_timestamp(), self_declared=false
            WHERE kind='mobile' AND digest=$1 AND verified_at IS NULL`,
          [identifierDigest("mobile", mobile)],
        )
      ).rowCount;
      if (!updated) {
        const exists = (
          await pool.query(
            "SELECT 1 FROM account_identifiers WHERE kind='mobile' AND digest=$1",
            [identifierDigest("mobile", mobile)],
          )
        ).rowCount;
        if (!exists)
          fail(
            404,
            "IDENTIFIER_NOT_FOUND",
            "No account uses this mobile number. Register with this number first, then verify it.",
          );
      }
      // The code is spent: one code verifies one identifier.
      await pool.query(
        "UPDATE otp_challenges SET consumed_at=clock_timestamp() WHERE token_hash=$1 AND consumed_at IS NULL",
        [digest(input.challengeToken)],
      );
      res.json({ verified: true });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Check one code against its challenge: expiry, five-attempt budget and the
 * code hash, inside a single transaction. A correct code marks the challenge
 * verified (verified_at); consumption is the caller's job — registration
 * consumes it with the account (consumeSignupOtp), verify-mobile consumes it
 * with the identifier — so one code makes one account / verifies one number.
 * When `mobile` is given, the challenge must belong to that exact number.
 */
async function checkOtpCode(
  challengeToken: string,
  code: string,
  mobile?: string,
): Promise<{ ok: true } | { ok: false; remaining: number; expired: boolean }> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const challenge = (
      await db.query(
        "SELECT *, expires_at <= clock_timestamp() AS expired FROM otp_challenges WHERE token_hash=$1 FOR UPDATE",
        [digest(challengeToken)],
      )
    ).rows[0];
    let outcome: { ok: true } | { ok: false; remaining: number; expired: boolean };
    if (
      !challenge ||
      challenge.expired ||
      challenge.consumed_at ||
      challenge.attempts >= 5 ||
      (mobile && challenge.identifier_digest !== identifierDigest("mobile", mobile))
    ) {
      outcome = { ok: false, remaining: 0, expired: true };
    } else if (challenge.code_hash === codeHash(challengeToken, code)) {
      await db.query("UPDATE otp_challenges SET verified_at=coalesce(verified_at,clock_timestamp()) WHERE token_hash=$1", [challenge.token_hash]);
      outcome = { ok: true };
    } else {
      await db.query("UPDATE otp_challenges SET attempts=attempts+1 WHERE token_hash=$1", [challenge.token_hash]);
      outcome = { ok: false, remaining: 4 - challenge.attempts, expired: false };
    }
    await db.query("COMMIT");
    return outcome;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

/**
 * Inside the registration transaction: the challenge must be verified for this exact number, recently,
 * and not used before. It is consumed with the account, so one code makes one account.
 */
export async function consumeSignupOtp(db: DB, challengeToken: string, mobile: string) {
  const row = (
    await db.query(
      `UPDATE otp_challenges SET consumed_at=clock_timestamp()
        WHERE token_hash=$1 AND purpose='signup_mobile' AND identifier_digest=$2
          AND verified_at IS NOT NULL AND consumed_at IS NULL
          AND verified_at > clock_timestamp() - make_interval(mins => $3)
        RETURNING token_hash`,
      [digest(challengeToken), identifierDigest("mobile", mobile), VERIFIED_USE_MINUTES],
    )
  ).rows[0];
  if (!row)
    fail(422, "OTP_REQUIRED", "Verify this mobile number with a fresh code before registering.");
}
