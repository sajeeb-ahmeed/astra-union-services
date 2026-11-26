import express from "express";
import { z } from "zod";
import { pool, transaction, setActingUser, type DB } from "./db.js";
import { fail } from "./models.js";
import { digest, randomToken } from "./security.js";
import { createRateLimiter } from "./http-hardening.js";
import { accountActionLimiter } from "./account-security.js";
import { emailAvailable, emailProviderName, sendEmail } from "./mailer.js";
import { emailVerificationTemplate } from "./email-templates.js";
import type { Auth } from "./app.js";

/**
 * Phase X: email verification for citizen registration (E2E QA J3 gap — the address was
 * never confirmed). Design mirrors the two existing token flows: the password-recovery
 * link (migration 007: digest-only storage, tenant located from the token, one use) and
 * the mobile OTP (otp.ts: provider-gated delivery, honest availability status, rate limits).
 * Verification is deliberately NOT a sign-in gate: an account works from the moment it is
 * created; platform_users.email_verified_at records whether the address was confirmed and
 * the state is surfaced on the profile (GET /api/v1/auth/me).
 */
export const EMAIL_TOKEN_TTL_HOURS = 24;
const RESEND_SECONDS = 60;
const HOURLY_LIMIT = 5;

type Req = express.Request & { auth?: Auth };

export const emailVerificationLink = (token: string) =>
  `${process.env.PUBLIC_ORIGIN ?? "http://127.0.0.1:5173"}/verify-email?token=${token}`;

/** Inside the caller's transaction: retire earlier links and store only the new token's digest. */
export async function issueEmailVerificationToken(
  db: DB,
  tenantId: string,
  userId: string,
  email: string,
): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken();
  await db.query(
    "UPDATE email_verification_tokens SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL",
    [userId],
  );
  const row = (
    await db.query(
      `INSERT INTO email_verification_tokens(token_hash,tenant_id,user_id,email,expires_at)
       VALUES($1,$2,$3,$4,clock_timestamp() + make_interval(hours => $5)) RETURNING expires_at`,
      [digest(token), tenantId, userId, email, EMAIL_TOKEN_TTL_HOURS],
    )
  ).rows[0];
  return { token, expiresAt: row.expires_at };
}

/** Bilingual verification message (template in email-templates.ts). Returns whether it was sent. */
export async function sendEmailVerificationMessage(email: string, token: string): Promise<boolean> {
  const link = emailVerificationLink(token);
  return sendEmail({
    to: email,
    ...emailVerificationTemplate({ link, ttlHours: EMAIL_TOKEN_TTL_HOURS }),
  });
}

export const publicEmailRouter = express.Router();
const verifyLimiter = createRateLimiter({ limit: 20, windowMs: 60_000 });
publicEmailRouter.get("/auth/email/status", (_req, res) => {
  res.json({ available: emailAvailable(), provider: emailProviderName(), ttlHours: EMAIL_TOKEN_TTL_HOURS });
});
publicEmailRouter.post("/auth/email/verify", verifyLimiter, async (req, res, next) => {
  try {
    const input = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(req.body);
    const hash = digest(input.token);
    const located = (
      await pool.query("SELECT * FROM locate_email_verification($1)", [hash])
    ).rows[0];
    if (!located)
      fail(422, "EMAIL_VERIFICATION_INVALID", "This verification link is invalid or has expired. Ask for a new one.");
    const email = await transaction(located.tenant_id, async (db) => {
      const row = (
        await db.query(
          "SELECT * FROM email_verification_tokens WHERE token_hash=$1 FOR UPDATE",
          [hash],
        )
      ).rows[0];
      if (!row || row.consumed_at || new Date(row.expires_at) <= new Date())
        fail(422, "EMAIL_VERIFICATION_INVALID", "This verification link is invalid or has expired. Ask for a new one.");
      await db.query("UPDATE email_verification_tokens SET consumed_at=now() WHERE token_hash=$1", [hash]);
      // A-013 (migration 083): the link verifies its own account.
      await setActingUser(db, row.user_id);
      await db.query(
        "UPDATE platform_users SET email_verified_at=COALESCE(email_verified_at, now()) WHERE id=$1",
        [row.user_id],
      );
      return row.email as string;
    });
    res.json({ verified: true, email });
  } catch (error) {
    next(error);
  }
});

export const emailRouter = express.Router();
emailRouter.post("/auth/email/resend", accountActionLimiter, async (req: Req, res, next) => {
  try {
    const a = req.auth;
    if (!a) fail(401, "LOGIN_REQUIRED", "Sign in required.");
    if (!emailAvailable())
      fail(503, "EMAIL_UNAVAILABLE", "Email is not enabled on this server.");
    if (!a.tenantId)
      fail(422, "EMAIL_VERIFICATION_INVALID", "Open your office workspace to verify your email.");
    const issued = await transaction(a.tenantId, async (db) => {
      const user = (
        await db.query("SELECT email, email_verified_at FROM platform_users WHERE id=$1", [a.userId])
      ).rows[0];
      if (!user) fail(404, "NOT_FOUND", "Account not found.");
      if (user.email_verified_at)
        fail(409, "EMAIL_ALREADY_VERIFIED", "This email address is already verified.");
      const recent = (
        await db.query(
          `SELECT count(*) FILTER (WHERE created_at > clock_timestamp() - make_interval(secs => $2))::int AS last_minute,
                  count(*)::int AS last_hour
             FROM email_verification_tokens WHERE user_id=$1 AND created_at > clock_timestamp() - interval '1 hour'`,
          [a.userId, RESEND_SECONDS],
        )
      ).rows[0];
      if (recent.last_minute > 0 || recent.last_hour >= HOURLY_LIMIT)
        fail(
          429,
          "EMAIL_RATE_LIMIT",
          recent.last_hour >= HOURLY_LIMIT
            ? "Too many verification emails for this account. Try again in an hour."
            : `Wait ${RESEND_SECONDS} seconds before asking for another verification email.`,
        );
      return issueEmailVerificationToken(db, a.tenantId!, a.userId, user.email);
    });
    const sent = await sendEmailVerificationMessage(a.email, issued.token);
    res.status(202).json({ sent, expiresAt: issued.expiresAt });
  } catch (error) {
    next(error);
  }
});
