import express from "express";
import { z } from "zod";
import type { Auth } from "./app.js";
import { ApiError, fail } from "./models.js";
import { checkPassword } from "./security.js";
import { accountActionLimiter, accountTransaction } from "./account-security.js";
import { securityAudit } from "./security-audit.js";
import {
  identifierDigest,
  identifierHint,
  identifierKinds,
  identifiersAvailable,
  normalizeIdentifier,
  type IdentifierKind,
} from "./identifiers.js";
import { consumeSignupOtp } from "./otp.js";

type Request = express.Request & { auth?: Auth };
const wrap =
  (fn: (req: Request, res: express.Response) => Promise<unknown>) =>
  (req: Request, res: express.Response, next: express.NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);
const kindParam = z.enum(["mobile", "nid", "birth_reg"]);
const passwordInput = z.string().min(1).max(200);
function requireAvailable() {
  if (!identifiersAvailable())
    fail(
      503,
      "IDENTIFIERS_UNAVAILABLE",
      "Sign-in with mobile, NID or birth registration is not configured on this server.",
    );
}

/** Phase 2b: an account holder manages their own extra sign-in identifiers (current password required). */
export const identifierRouter = express.Router();
identifierRouter.get(
  "/account/identifiers",
  wrap(async (req, res) => {
    const actor = req.auth!;
    const rows = await accountTransaction(actor, async (db) =>
      (
        await db.query(
          "SELECT kind,hint,created_at,verified_at FROM account_identifiers WHERE user_id=$1 ORDER BY kind",
          [actor.userId],
        )
      ).rows,
    );
    res.json({
      available: identifiersAvailable(),
      email: actor.email,
      items: identifierKinds.map((kind) => {
        const row = rows.find((r: any) => r.kind === kind);
        return {
          kind,
          set: !!row,
          hint: row?.hint ?? null,
          setAt: row?.created_at ?? null,
          // S-001: only a verified mobile signs in. NID / birth
          // registration carry no verification state (verified null).
          verified: kind === "mobile" ? !!row?.verified_at : null,
          verifiedAt: row?.verified_at ?? null,
        };
      }),
    });
  }),
);
identifierRouter.put(
  "/account/identifiers/:kind",
  accountActionLimiter,
  wrap(async (req, res) => {
    requireAvailable();
    const kind = kindParam.parse(req.params.kind) as IdentifierKind;
    const input = z
      .object({
        value: z.string().min(1).max(40),
        currentPassword: passwordInput,
        // S-001: changing the mobile needs a code proven for the NEW number
        // (POST /auth/otp/signup + /auth/otp/verify first). A password alone
        // never binds a mobile — otherwise anyone holding a session could
        // squat someone else's number as their sign-in identifier.
        otpToken: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      })
      .strict()
      .parse(req.body);
    const normalized = normalizeIdentifier(kind, input.value);
    if (!normalized)
      fail(422, "IDENTIFIER_INVALID", {
        mobile: "Enter an 11-digit Bangladeshi mobile number starting with 01.",
        nid: "Enter a 10, 13 or 17 digit NID number.",
        birth_reg: "Enter a 17-digit birth registration number.",
      }[kind]);
    const actor = req.auth!;
    const hint = identifierHint(kind, normalized);
    await accountTransaction(actor, async (db, user) => {
      if (!checkPassword(input.currentPassword, user.password_hash))
        fail(422, "PASSWORD_MISMATCH", "Current password is incorrect.");
      if (kind === "mobile" && !input.otpToken)
        fail(
          422,
          "OTP_REQUIRED",
          "Verify this mobile number with a fresh code before adding it. / এই মোবাইল নম্বরটি যোগ করার আগে একটি নতুন কোড দিয়ে যাচাই করুন।",
        );
      if (kind === "mobile") {
        // The duplicate check runs BEFORE the code is consumed, so a taken
        // number never spends the caller's fresh code.
        if (
          (
            await db.query(
              "SELECT 1 FROM account_identifiers WHERE kind='mobile' AND digest=$1 AND user_id<>$2",
              [identifierDigest(kind, normalized), actor.userId],
            )
          ).rowCount
        )
          fail(409, "IDENTIFIER_TAKEN", "This number is already used by another account.");
        await consumeSignupOtp(db, input.otpToken!, normalized);
      }
      try {
        await db.query("SAVEPOINT identifier");
        await db.query(
          kind === "mobile"
            ? `INSERT INTO account_identifiers(user_id,kind,digest,hint,self_declared,verified_at) VALUES($1,$2,$3,$4,false,clock_timestamp())
               ON CONFLICT (user_id,kind) DO UPDATE SET digest=excluded.digest,hint=excluded.hint,self_declared=false,verified_at=clock_timestamp(),created_at=clock_timestamp()`
            : `INSERT INTO account_identifiers(user_id,kind,digest,hint) VALUES($1,$2,$3,$4)
               ON CONFLICT (user_id,kind) DO UPDATE SET digest=excluded.digest,hint=excluded.hint,created_at=clock_timestamp()`,
          [actor.userId, kind, identifierDigest(kind, normalized), hint],
        );
      } catch (error: any) {
        if (error?.code !== "23505") throw error;
        await db.query("ROLLBACK TO SAVEPOINT identifier");
        fail(409, "IDENTIFIER_TAKEN", "This number is already used by another account.");
      }
      await securityAudit(db, actor.userId, "SIGN_IN_IDENTIFIER_SET");
    });
    res.json({ kind, set: true, hint, verified: kind === "mobile" ? true : null });
  }),
);
identifierRouter.delete(
  "/account/identifiers/:kind",
  accountActionLimiter,
  wrap(async (req, res) => {
    const kind = kindParam.parse(req.params.kind);
    const input = z.object({ currentPassword: passwordInput }).strict().parse(req.body ?? {});
    const actor = req.auth!;
    const removed = await accountTransaction(actor, async (db, user) => {
      if (!checkPassword(input.currentPassword, user.password_hash))
        fail(422, "PASSWORD_MISMATCH", "Current password is incorrect.");
      const result = await db.query(
        "DELETE FROM account_identifiers WHERE user_id=$1 AND kind=$2",
        [actor.userId, kind],
      );
      if (result.rowCount) await securityAudit(db, actor.userId, "SIGN_IN_IDENTIFIER_REMOVED");
      return result.rowCount ?? 0;
    });
    if (!removed) throw new ApiError(404, "NOT_FOUND", "This identifier is not set.");
    res.json({ kind, set: false });
  }),
);
