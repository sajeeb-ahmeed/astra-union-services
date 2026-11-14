import express from "express";
import { z } from "zod";
import type { Auth } from "./app.js";
import { pool, transaction, audit } from "./db.js";
import { camelRow, fail } from "./models.js";
import { hashPassword } from "./security.js";
import { createRateLimiter } from "./http-hardening.js";
import { consumeSignupOtp } from "./otp.js";
import {
  identifierDigest,
  identifierHint,
  normalizeIdentifier,
} from "./identifiers.js";

/**
 * Phase 2d: office staff register for a post; the platform owner verifies them (owner decision).
 * Until approval the account is inactive and has no membership, so it cannot sign in or see office data.
 */
type Request = express.Request & { auth?: Auth };
const wrap =
  (fn: (req: Request, res: express.Response) => Promise<unknown>) =>
  (req: Request, res: express.Response, next: express.NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);
const uuid = z.string().uuid();
const typeCode = z.string().regex(/^[a-z][a-z0-9_]{2,39}$/);

export const publicOfficeRegistrationRouter = express.Router();
publicOfficeRegistrationRouter.get(
  "/public/offices/:id/account-types",
  wrap(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const office = (
      await pool.query("SELECT office_type FROM tenants WHERE id=$1 AND status='ACTIVE'", [id])
    ).rows[0];
    if (!office) fail(404, "NOT_FOUND", "Active office not found.");
    const items = (
      await pool.query(
        "SELECT code,name_bn,name_en,role,status FROM account_types WHERE $1 = ANY(office_types) ORDER BY sort_order",
        [office.office_type],
      )
    ).rows.map(camelRow);
    res.json({ items });
  }),
);
publicOfficeRegistrationRouter.post(
  "/auth/office-registration",
  createRateLimiter({ limit: 10, windowMs: 60_000 }),
  wrap(async (req, res) => {
    const d = z
      .object({
        tenantId: uuid,
        accountType: typeCode,
        email: z.string().email().max(150),
        password: z.string().min(12).max(200),
        displayName: z.string().min(2).max(120),
        mobile: z.string().min(1).max(40).optional(),
        otpToken: z.string().regex(/^[a-f0-9]{64}$/).optional(),
      })
      .strict()
      .refine((v) => (v.mobile === undefined) === (v.otpToken === undefined), {
        message: "A mobile number needs its verified code.",
      })
      .parse(req.body);
    const mobile = d.mobile ? normalizeIdentifier("mobile", d.mobile) : null;
    if (d.mobile && !mobile)
      fail(422, "IDENTIFIER_INVALID", "Enter an 11-digit Bangladeshi mobile number starting with 01.");
    const request = await transaction(d.tenantId, async (db) => {
      const fit = (
        await db.query(
          `SELECT t.office_type = ANY(a.office_types) AS fits FROM tenants t JOIN account_types a ON a.code=$2
            WHERE t.id=$1 AND t.status='ACTIVE'`,
          [d.tenantId, d.accountType],
        )
      ).rows[0];
      if (!fit) fail(404, "NOT_FOUND", "Active office or post not found.");
      if (!fit.fits) fail(422, "ACCOUNT_TYPE_OFFICE_MISMATCH", "This post does not exist in this kind of office.");
      if ((await db.query("SELECT 1 FROM platform_users WHERE email=$1", [d.email.toLowerCase()])).rowCount)
        fail(409, "EMAIL_TAKEN", "An account with this email already exists.");
      const user = (
        await db.query(
          "INSERT INTO platform_users(email,display_name,password_hash,active) VALUES($1,$2,$3,false) RETURNING id",
          [d.email.toLowerCase(), d.displayName, hashPassword(d.password)],
        )
      ).rows[0];
      if (mobile) {
        const digestValue = identifierDigest("mobile", mobile);
        if ((await db.query("SELECT 1 FROM account_identifiers WHERE kind='mobile' AND digest=$1", [digestValue])).rowCount)
          fail(409, "IDENTIFIER_TAKEN", "This mobile number is already used by another account.");
        await consumeSignupOtp(db, d.otpToken!, mobile);
        await db.query(
          "INSERT INTO account_identifiers(user_id,kind,digest,hint) VALUES($1,'mobile',$2,$3)",
          [user.id, digestValue, identifierHint("mobile", mobile)],
        );
      }
      const row = (
        await db.query(
          "INSERT INTO office_account_requests(tenant_id,user_id,account_type) VALUES($1,$2,$3) RETURNING id,status,created_at",
          [d.tenantId, user.id, d.accountType],
        )
      ).rows[0];
      await audit(db, d.tenantId, user.id, "OFFICE_ACCOUNT_REQUESTED", row.id, { accountType: d.accountType });
      return row;
    });
    res.status(202).json({ id: request.id, status: request.status });
  }),
);

export const ownerOfficeRegistrationRouter = express.Router();
function owner(req: Request) {
  if (req.auth?.role !== "owner") fail(403, "FORBIDDEN", "Only the platform owner verifies office accounts.");
  return req.auth!;
}
ownerOfficeRegistrationRouter.get(
  "/owner/account-requests",
  wrap(async (req, res) => {
    owner(req);
    const status = z.enum(["PENDING", "APPROVED", "REJECTED"]).default("PENDING").parse(req.query.status ?? undefined);
    const items = (
      await pool.query(
        `SELECT r.id,r.status,r.reason,r.created_at,r.decided_at,r.account_type,
                a.name_bn account_type_bn,a.name_en account_type_en,a.role,
                u.email,u.display_name,t.name_bn office_bn,t.name_en office_en,t.office_type,
                (SELECT hint FROM account_identifiers i WHERE i.user_id=u.id AND i.kind='mobile') mobile_hint
           FROM office_account_requests r
           JOIN platform_users u ON u.id=r.user_id
           JOIN account_types a ON a.code=r.account_type
           JOIN tenants t ON t.id=r.tenant_id
          WHERE r.status=$1 ORDER BY r.created_at LIMIT 200`,
        [status],
      )
    ).rows.map(camelRow);
    res.json({ items });
  }),
);
ownerOfficeRegistrationRouter.post(
  "/owner/account-requests/:id/decision",
  wrap(async (req, res) => {
    const actor = owner(req);
    const id = uuid.parse(req.params.id);
    const d = z
      .object({ decision: z.enum(["approve", "reject"]), reason: z.string().trim().min(8).max(500).optional() })
      .strict()
      .refine((v) => v.decision === "approve" || v.reason, { message: "A rejection needs a reason." })
      .parse(req.body);
    const tenantId = (await pool.query("SELECT tenant_id FROM office_account_requests WHERE id=$1", [id])).rows[0]
      ?.tenant_id;
    if (!tenantId) fail(404, "NOT_FOUND", "Request not found.");
    const result = await transaction(tenantId, async (db) => {
      const r = (
        await db.query("SELECT * FROM office_account_requests WHERE id=$1 FOR UPDATE", [id])
      ).rows[0];
      if (r.status !== "PENDING") fail(409, "ALREADY_DECIDED", "This request has already been decided.");
      if (d.decision === "approve") {
        const type = (await db.query("SELECT role FROM account_types WHERE code=$1", [r.account_type])).rows[0];
        await db.query(
          "INSERT INTO staff_memberships(user_id,tenant_id,role,account_type) VALUES($1,$2,$3,$4)",
          [r.user_id, r.tenant_id, type.role, r.account_type],
        );
        await db.query("UPDATE platform_users SET active=true WHERE id=$1", [r.user_id]);
      }
      const updated = (
        await db.query(
          `UPDATE office_account_requests SET status=$2,reason=$3,decided_by=$4,decided_at=clock_timestamp()
            WHERE id=$1 RETURNING id,status,reason,decided_at`,
          [id, d.decision === "approve" ? "APPROVED" : "REJECTED", d.reason ?? null, actor.userId],
        )
      ).rows[0];
      await audit(
        db,
        r.tenant_id,
        actor.userId,
        d.decision === "approve" ? "OFFICE_ACCOUNT_APPROVED" : "OFFICE_ACCOUNT_REJECTED",
        id,
        { accountType: r.account_type, ...(d.reason ? { reason: d.reason } : {}) },
      );
      return camelRow(updated);
    });
    res.json(result);
  }),
);

/** Sign-in for a correct password on an inactive account: tell the applicant their request is pending. */
export async function pendingReviewStatus(userId: string): Promise<"PENDING" | "REJECTED" | null> {
  const row = (
    await pool.query("SELECT status FROM office_account_requests WHERE user_id=$1", [userId])
  ).rows[0];
  return row && row.status !== "APPROVED" ? row.status : null;
}
