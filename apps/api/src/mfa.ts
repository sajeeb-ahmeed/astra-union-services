import express from "express";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import type { Auth } from "./app.js";
import { pool, type DB } from "./db.js";
import { ApiError, camelRow, fail } from "./models.js";
import { checkPassword, digest, hashPassword, randomToken } from "./security.js";
import {
  accountTransaction,
  accountActionLimiter,
  consumeAccountRecoveryLinks,
  lockAccount,
} from "./account-security.js";
import {
  accountScope,
  invalidateMfaChallenges,
  securityAudit,
} from "./security-audit.js";
import {
  decryptMfaSecret,
  encryptMfaSecret,
  matchTotp,
  mfaAvailable,
  newTotpSecret,
} from "./mfa-crypto.js";
import { createRateLimiter } from "./http-hardening.js";

type Request = express.Request & { auth?: Auth };
const wrap =
  (fn: (req: Request, res: express.Response) => Promise<unknown>) =>
  (req: Request, res: express.Response, next: express.NextFunction) =>
    Promise.resolve(fn(req, res)).catch((error) => {
      if (error instanceof ApiError && error.code === "MFA_RATE_LIMIT")
        res.setHeader("Retry-After", "300");
      next(error);
    });
const passwordInput = z.string().min(1).max(200);
const codeInput = z
  .string()
  .min(1)
  .max(40)
  .transform((value) => value.trim());
const invalidCode = () =>
  new ApiError(
    422,
    "MFA_CODE_INVALID",
    "The code is incorrect, expired or already used. Use a fresh authenticator code or an unused recovery code.",
  );
const throttled = () =>
  new ApiError(
    429,
    "MFA_RATE_LIMIT",
    "Too many incorrect codes. Wait five minutes before trying again.",
  );

async function mfaState(db: DB, userId: string) {
  await accountScope(db, userId);
  return (
    await db.query(
      "SELECT *,clock_timestamp() AS checked_at FROM account_mfa WHERE user_id=$1",
      [userId],
    )
  ).rows[0];
}
function budgetError(state: any) {
  return state?.attempt_window_at &&
    state.failed_attempts >= 5 &&
    state.checked_at.getTime() - state.attempt_window_at.getTime() < 300_000
    ? throttled()
    : null;
}
async function rejectCode(db: DB, userId: string, state: any) {
  const withinWindow =
    state.attempt_window_at &&
    state.checked_at.getTime() - state.attempt_window_at.getTime() < 300_000;
  const attempts = withinWindow ? state.failed_attempts + 1 : 1;
  await db.query(
    "UPDATE account_mfa SET failed_attempts=$2,attempt_window_at=CASE WHEN $3 THEN attempt_window_at ELSE clock_timestamp() END WHERE user_id=$1",
    [userId, attempts, Boolean(withinWindow)],
  );
  await securityAudit(db, userId, "MFA_CODE_REJECTED");
  return attempts >= 5 ? throttled() : invalidCode();
}
/** Caller holds the platform_users row lock. Failure is returned so the budget commits. */
async function verifyFactor(
  db: DB,
  userId: string,
  state: any,
  code: string,
  pending = false,
): Promise<ApiError | null> {
  const limited = budgetError(state);
  if (limited) return limited;
  if (!pending && !/^\d{6}$/.test(code)) {
    const normalized = code.replace(/-/g, "").toLowerCase();
    const hash = digest(`astra-recovery:${userId}:${normalized}`);
    if (
      /^[a-f0-9]{24}$/.test(normalized) &&
      state.recovery_hashes.includes(hash)
    ) {
      const remaining = state.recovery_hashes.filter(
        (entry: string) => entry !== hash,
      );
      await db.query(
        "UPDATE account_mfa SET recovery_hashes=$2,failed_attempts=0,attempt_window_at=NULL WHERE user_id=$1",
        [userId, remaining],
      );
      await securityAudit(db, userId, "MFA_RECOVERY_CODE_USED", {
        remainingCodes: remaining.length,
      });
      return null;
    }
  } else if (/^\d{6}$/.test(code)) {
    const secret = decryptMfaSecret(
      pending ? state.pending_secret : state.encrypted_secret,
      userId,
    );
    const counter = matchTotp(
      secret,
      code,
      state.checked_at.getTime(),
      pending ? -1 : Number(state.last_counter),
    );
    if (counter !== null) {
      await db.query(
        "UPDATE account_mfa SET last_counter=$2,failed_attempts=0,attempt_window_at=NULL WHERE user_id=$1",
        [userId, counter],
      );
      return null;
    }
  }
  return rejectCode(db, userId, state);
}
function recoveryCodes(userId: string) {
  const codes = Array.from({ length: 10 }, () =>
    randomBytes(12)
      .toString("hex")
      .match(/.{1,4}/g)!
      .join("-"),
  );
  return {
    codes,
    hashes: codes.map((code) =>
      digest(`astra-recovery:${userId}:${code.replace(/-/g, "")}`),
    ),
  };
}
async function revokeOtherSessions(db: DB, actor: Auth) {
  const result = await db.query(
    "UPDATE sessions SET expires_at=clock_timestamp() WHERE user_id=$1 AND csrf_token<>$2 AND expires_at>clock_timestamp()",
    [actor.userId, actor.csrfToken],
  );
  await invalidateMfaChallenges(db, actor.userId);
  return result.rowCount ?? 0;
}
async function membershipFor(db: DB, user: any, tenantId?: string | null) {
  if (tenantId === null) {
    if (user.platform_role !== "owner")
      fail(403, "MEMBERSHIP_INACTIVE", "No active tenant membership.");
    return null;
  }
  const membership = (
    await db.query(
      `SELECT m.*,t.status FROM staff_memberships m JOIN tenants t ON t.id=m.tenant_id
     WHERE m.user_id=$1 AND m.active AND t.status='ACTIVE' ${tenantId ? "AND m.tenant_id=$2" : ""}
     ORDER BY t.slug LIMIT 1 FOR SHARE OF m,t`,
      tenantId ? [user.id, tenantId] : [user.id],
    )
  ).rows[0];
  if (!membership && (tenantId || user.platform_role !== "owner"))
    fail(403, "MEMBERSHIP_INACTIVE", "No active tenant membership.");
  return membership;
}
async function createSession(db: DB, user: any, membership: any) {
  const token = randomToken(),
    csrfToken = randomToken();
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,tenant_id,csrf_token,expires_at) VALUES($1,$2,$3,$4,clock_timestamp()+interval '8 hours')",
    [digest(token), user.id, membership?.tenant_id ?? null, csrfToken],
  );
  const tenant = membership
    ? (
        await db.query("SELECT * FROM tenants WHERE id=$1", [
          membership.tenant_id,
        ])
      ).rows[0]
    : null;
  return {
    token,
    body: {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: membership?.role ?? "owner",
        tenantId: membership?.tenant_id ?? null,
      },
      tenant: camelRow(tenant),
      csrfToken,
    },
  };
}
export function sendLogin(
  res: express.Response,
  session: Awaited<ReturnType<typeof createSession>>,
) {
  res.setHeader(
    "Set-Cookie",
    `astra_session=${session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
  );
  res.json(session.body);
}
const unknownAccountHash = hashPassword(randomToken());
export async function passwordLogin(email: string, password: string) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const user = (
      await db.query("SELECT * FROM platform_users WHERE email=$1 FOR UPDATE", [
        email.toLowerCase(),
      ])
    ).rows[0];
    // Phase 2b: an unknown account costs the same password check as a wrong password, so response
    // time does not reveal which emails or numbers are registered.
    if (!user) {
      checkPassword(password, unknownAccountHash);
      fail(401, "INVALID_LOGIN", "Invalid sign-in credentials.");
    }
    if (!user.active || !checkPassword(password, user.password_hash))
      fail(401, "INVALID_LOGIN", "Invalid sign-in credentials.");
    const membership = await membershipFor(db, user);
    const state = await mfaState(db, user.id);
    if (state?.enabled_at) {
      if (!mfaAvailable())
        fail(
          503,
          "MFA_UNAVAILABLE",
          "Authenticator protection is temporarily unavailable. Contact the operator.",
        );
      const limited = budgetError(state);
      if (limited) throw limited;
      const challenge = randomToken();
      // One pending challenge per account bounds usable capabilities and supersedes
      // old logins. Consumed rows remain for operational retention review.
      await invalidateMfaChallenges(db, user.id);
      const row = (
        await db.query(
          "INSERT INTO mfa_login_challenges(token_hash,user_id,tenant_id,credential_digest,mfa_revision,expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '5 minutes') RETURNING expires_at",
          [
            digest(challenge),
            user.id,
            membership?.tenant_id ?? null,
            digest(user.password_hash),
            state.revision,
          ],
        )
      ).rows[0];
      await securityAudit(db, user.id, "MFA_CHALLENGE_CREATED");
      await db.query("COMMIT");
      return {
        challenge: {
          mfaRequired: true as const,
          challengeToken: challenge,
          expiresAt: row.expires_at,
        },
      };
    }
    const session = await createSession(db, user, membership);
    await db.query("COMMIT");
    return { session };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

export const publicMfaRouter = express.Router();
export const mfaRouter = express.Router();
publicMfaRouter.post(
  "/auth/mfa/verify",
  createRateLimiter({ limit: 60, windowMs: 60_000 }),
  wrap(async (req, res) => {
    const input = z
      .object({
        challengeToken: z.string().regex(/^[a-f0-9]{64}$/),
        code: codeInput,
      })
      .strict()
      .parse(req.body);
    const db = await pool.connect();
    let session: Awaited<ReturnType<typeof createSession>> | undefined,
      rejection: ApiError | null = null;
    try {
      await db.query("BEGIN");
      const candidate = (
        await db.query(
          "SELECT user_id FROM mfa_login_challenges WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp()",
          [digest(input.challengeToken)],
        )
      ).rows[0];
      if (!candidate)
        fail(
          422,
          "MFA_CHALLENGE_INVALID",
          "The sign-in request expired. Sign in again.",
        );
      const user = await lockAccount(db, candidate.user_id);
      const challenge = (
        await db.query(
          "SELECT * FROM mfa_login_challenges WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE",
          [digest(input.challengeToken)],
        )
      ).rows[0];
      const state = await mfaState(db, user.id);
      if (
        !challenge ||
        !state?.enabled_at ||
        challenge.mfa_revision !== state.revision ||
        challenge.credential_digest !== digest(user.password_hash)
      )
        fail(
          422,
          "MFA_CHALLENGE_INVALID",
          "The sign-in request expired. Sign in again.",
        );
      const membership = await membershipFor(db, user, challenge.tenant_id);
      rejection = await verifyFactor(db, user.id, state, input.code);
      if (!rejection) {
        await db.query(
          "UPDATE mfa_login_challenges SET consumed_at=clock_timestamp() WHERE token_hash=$1",
          [digest(input.challengeToken)],
        );
        session = await createSession(db, user, membership);
        await securityAudit(db, user.id, "MFA_LOGIN_SUCCEEDED");
      }
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
    if (rejection) {
      if (rejection.status === 429) res.setHeader("Retry-After", "300");
      throw rejection;
    }
    sendLogin(res, session!);
  }),
);

mfaRouter.get(
  "/auth/mfa",
  wrap(async (req, res) => {
    const result = await accountTransaction(req.auth!, async (db) => {
      const state = await mfaState(db, req.auth!.userId);
      return {
        enabled: Boolean(state?.enabled_at),
        available: mfaAvailable(),
        pendingExpiresAt:
          state?.pending_expires_at > state?.checked_at
            ? state.pending_expires_at
            : null,
        recoveryCodesRemaining: state?.enabled_at
          ? state.recovery_hashes.length
          : 0,
      };
    });
    res.json(result);
  }),
);
mfaRouter.get(
  "/auth/security-events",
  wrap(async (req, res) => {
    const result = await accountTransaction(req.auth!, async (db) => {
      await accountScope(db, req.auth!.userId);
      return (
        await db.query(
          "SELECT id,action,metadata,created_at FROM account_security_events WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50",
          [req.auth!.userId],
        )
      ).rows.map(camelRow);
    });
    res.json({ items: result });
  }),
);
mfaRouter.post(
  "/auth/mfa/enrollment",
  accountActionLimiter,
  wrap(async (req, res) => {
    const input = z
      .object({ currentPassword: passwordInput })
      .strict()
      .parse(req.body);
    const actor = req.auth!;
    const result = await accountTransaction(actor, async (db, user) => {
      if (!checkPassword(input.currentPassword, user.password_hash))
        fail(422, "PASSWORD_MISMATCH", "Current password is incorrect.");
      const state = await mfaState(db, actor.userId);
      if (state?.enabled_at)
        fail(
          409,
          "MFA_ALREADY_ENABLED",
          "Authenticator protection is already enabled.",
        );
      if (budgetError(state)) throw throttled();
      const secret = newTotpSecret(),
        encrypted = encryptMfaSecret(secret, actor.userId);
      const row = (
        await db.query(
          "INSERT INTO account_mfa(user_id,pending_secret,pending_expires_at) VALUES($1,$2,clock_timestamp()+interval '10 minutes') ON CONFLICT(user_id) DO UPDATE SET pending_secret=EXCLUDED.pending_secret,pending_expires_at=EXCLUDED.pending_expires_at RETURNING pending_expires_at",
          [actor.userId, encrypted],
        )
      ).rows[0];
      const otpauthUri = `otpauth://totp/${encodeURIComponent(`Astra:${user.email}`)}?secret=${secret}&issuer=Astra&algorithm=SHA1&digits=6&period=30`;
      const qrDataUrl = await QRCode.toDataURL(otpauthUri, {
        width: 220,
        margin: 2,
      });
      await securityAudit(db, actor.userId, "MFA_ENROLLMENT_STARTED");
      return {
        secret,
        otpauthUri,
        qrDataUrl,
        expiresAt: row.pending_expires_at,
      };
    });
    res.status(201).json(result);
  }),
);
mfaRouter.post(
  "/auth/mfa/activate",
  wrap(async (req, res) => {
    const { code } = z.object({ code: codeInput }).strict().parse(req.body),
      actor = req.auth!;
    const result = await accountTransaction(actor, async (db) => {
      const state = await mfaState(db, actor.userId);
      if (state?.enabled_at)
        fail(
          409,
          "MFA_ALREADY_ENABLED",
          "Authenticator protection is already enabled.",
        );
      if (
        !state?.pending_secret ||
        state.pending_expires_at <= state.checked_at
      )
        fail(422, "MFA_ENROLLMENT_EXPIRED", "Start authenticator setup again.");
      const rejection = await verifyFactor(db, actor.userId, state, code, true);
      if (rejection) return { rejection };
      const codes = recoveryCodes(actor.userId);
      await consumeAccountRecoveryLinks(db, actor.userId);
      const revokedSessions = await revokeOtherSessions(db, actor);
      await db.query(
        "UPDATE account_mfa SET encrypted_secret=$2,enabled_at=clock_timestamp(),pending_secret=NULL,pending_expires_at=NULL,recovery_hashes=$3,revision=revision+1 WHERE user_id=$1",
        [actor.userId, state.pending_secret, codes.hashes],
      );
      await securityAudit(db, actor.userId, "MFA_ENABLED", { revokedSessions });
      return { recoveryCodes: codes.codes };
    });
    if (result.rejection) throw result.rejection;
    res.json({ enabled: true, recoveryCodes: result.recoveryCodes });
  }),
);
for (const operation of ["disable", "recovery-codes"] as const) {
  mfaRouter.post(
    `/auth/mfa/${operation}`,
    accountActionLimiter,
    wrap(async (req, res) => {
      const input = z
          .object({ currentPassword: passwordInput, code: codeInput })
          .strict()
          .parse(req.body),
        actor = req.auth!;
      const result = await accountTransaction(actor, async (db, user) => {
        if (!checkPassword(input.currentPassword, user.password_hash))
          fail(422, "PASSWORD_MISMATCH", "Current password is incorrect.");
        const state = await mfaState(db, actor.userId);
        if (!state?.enabled_at)
          fail(
            409,
            "MFA_NOT_ENABLED",
            "Authenticator protection is not enabled.",
          );
        const rejection = await verifyFactor(
          db,
          actor.userId,
          state,
          input.code,
        );
        if (rejection) return { rejection };
        const revokedSessions = await revokeOtherSessions(db, actor);
        await consumeAccountRecoveryLinks(db, actor.userId);
        if (operation === "disable") {
          await db.query(
            "UPDATE account_mfa SET encrypted_secret=NULL,enabled_at=NULL,pending_secret=NULL,pending_expires_at=NULL,recovery_hashes='{}',last_counter=-1,revision=revision+1 WHERE user_id=$1",
            [actor.userId],
          );
          await securityAudit(db, actor.userId, "MFA_DISABLED", {
            revokedSessions,
          });
          return { enabled: false };
        }
        const codes = recoveryCodes(actor.userId);
        await db.query(
          "UPDATE account_mfa SET recovery_hashes=$2,revision=revision+1 WHERE user_id=$1",
          [actor.userId, codes.hashes],
        );
        await securityAudit(db, actor.userId, "MFA_RECOVERY_CODES_ROTATED", {
          revokedSessions,
        });
        return { enabled: true, recoveryCodes: codes.codes };
      });
      if (result.rejection) throw result.rejection;
      res.json(result);
    }),
  );
}
