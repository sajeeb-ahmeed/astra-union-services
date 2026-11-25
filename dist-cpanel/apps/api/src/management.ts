import express from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { pool, transaction, audit } from "./db.js";
import {
  hashPassword,
  checkPassword,
  isCommonPassword,
  randomToken,
  digest,
} from "./security.js";
import { ApiError, camelRow, fail, fieldFail } from "./models.js";
import { applySubscriptionAction } from "./subscriptions.js";
import { consumeSignupOtp } from "./otp.js";
import { emailAvailable, placeholderEmail } from "./mailer.js";
import { decodeUpload } from "./attachments.js";
import {
  issueEmailVerificationToken,
  sendEmailVerificationMessage,
} from "./email-verification.js";
import {
  identifierDigest,
  identifierHint,
  identifiersAvailable,
  normalizeIdentifier,
} from "./identifiers.js";
import { citizenReferenceExists, mintReference } from "./references.js";
import { recordRegistrationDemand } from "./demand.js";
import type { Auth } from "./app.js";
import {
  lockAccount,
  accountTransaction,
  consumeAccountRecoveryLinks,
  accountAudit,
  logOwnerAccountAction,
  accountActionLimiter,
} from "./account-security.js";
import {
  accountScope,
  invalidateMfaChallenges,
  securityAudit,
} from "./security-audit.js";
import {
  geographyInput,
  geographyRow,
  geographyValues,
  validateGeography,
  validateOfficeJurisdiction,
  presentAddressInput,
  presentAddressValues,
} from "./geography.js";
const officeRow = (row: any) =>
  row ? { ...camelRow(row), geography: geographyRow(row) } : null;

type Req = express.Request & { auth?: Auth };
const uuid = z.string().uuid();
const wrap =
  (fn: (req: Req, res: express.Response) => Promise<unknown>) =>
  (req: Req, res: express.Response, next: express.NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);
function role(req: Req, allowed: string[]) {
  if (!req.auth || !allowed.includes(req.auth.role))
    fail(403, "ROLE_DENIED", "This role is not permitted.");
  return req.auth!;
}
const pageInput = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(12),
});
const roleInput = z.enum([
  "admin",
  "approver",
  "reviewer",
  "staff",
  "finance",
  "citizen",
]);
// Security Audit 01, F5: every password set/change point in this module (signup,
// staff create, tenant create, recovery consume, password change) shares this
// schema, so the common-password blocklist refine covers all of them at once.
// FORM-UX (owner directive 19 Nov): every password a user sets is 6–18
// characters — one rule everywhere, so no form can disagree with the API.
const password = z
  .string()
  .min(6, "Password must be at least 6 characters.")
  // QAFIX-01 (live QA §1): the owner's standing rule is ONE password rule
  // everywhere — 6–18 characters. QA-09's 64-character allowance made the
  // API disagree with the change-password form; the 6–18 rule wins.
  .max(18, "Password must be at most 18 characters.")
  .refine((value) => !isCommonPassword(value), {
    message: "This password is too common. Choose a less predictable password.",
  });
const email = z
  .string()
  .email()
  .max(150)
  .transform((s) => s.toLowerCase());
const officeInput = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9-]{2,49}$/),
  nameBn: z.string().min(2).max(150),
  nameEn: z.string().min(2).max(150),
  division: z.string().min(2).max(100).optional(),
  district: z.string().min(2).max(100).optional(),
  upazila: z.string().min(2).max(100).optional(),
  geography: geographyInput.optional(),
  officeType: z.enum(["UNION", "MUNICIPALITY", "CITY_CORPORATION"]),
});
/** REG-UX Phase 1: the one-screen signup shape (design note §2.1, §3.1). */
const BENGALI_SCRIPT = /[ঀ-৿]/;
const shortSignupInput = z
  .object({
    tenantId: uuid,
    name: z
      .string()
      .trim()
      .min(2, "নাম কমপক্ষে ২ অক্ষরের হতে হবে। / Name must be at least 2 characters.")
      .max(120, "নাম ১২০ অক্ষরের বেশি হতে পারবে না। / Name must be at most 120 characters."),
    mobile: z
      .string()
      .trim()
      .min(1, "মোবাইল নম্বর দিন। / Enter your mobile number.")
      .max(40),
    password,
    // K2 lean: optional. An empty string from the form means "not given".
    email: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      email.optional(),
    ),
    // Optional profile photo (ঐচ্ছিক) — the same PNG/JPEG rule as PUT /citizens/:id/photo.
    photo: z
      .object({
        mimeType: z.enum(["image/png", "image/jpeg"]),
        base64: z.string().min(1).max(3_000_000),
      })
      .strict()
      .optional(),
    // S-001: an OTP-verified code for this mobile, when the citizen verified
    // the number before submitting. Without it the account is still created
    // — registration never depends on the SMS provider — but the mobile is
    // stored PENDING (verified_at NULL) and cannot sign in until verified.
    otpToken: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
type SignupRecord = {
  email?: string;
  password: string;
  displayName: string;
  tenantId: string;
  nameBn: string | null;
  nameEn: string | null;
  dateOfBirth: string | null;
  addressBn: string | null;
  addressEn: string | null;
  syntheticReference?: string;
  geography?: z.infer<typeof geographyInput>;
  presentAddress?: z.infer<typeof presentAddressInput>;
  mobile?: string;
  otpToken?: string;
  photo?: { mimeType: "image/png" | "image/jpeg"; base64: string };
};
const emailTaken = () =>
  fieldFail(
    409,
    "EMAIL_TAKEN",
    "এই ইমেইল দিয়ে আগেই একটি অ্যাকাউন্ট খোলা হয়েছে। আপনি কি সাইন ইন করতে চান? / This email already has an account. Would you like to sign in instead?",
    "email",
  );
const mobileTaken = () =>
  fieldFail(
    409,
    "IDENTIFIER_TAKEN",
    "এই মোবাইল নম্বর দিয়ে আগেই একটি অ্যাকাউন্ট আছে। নম্বরটি আপনার হলে সাইন ইন করুন। / This mobile number already has an account. If it is yours, sign in.",
    "mobile",
  );
export const publicManagementRouter = express.Router();
export const managementRouter = express.Router();
async function recoveryEligible(
  db: import("./db.js").DB,
  tenantId: string,
  userId: string,
  lock = true,
) {
  const u = (
    await db.query(
      `SELECT u.id FROM platform_users u JOIN staff_memberships m ON m.user_id=u.id WHERE u.id=$1 AND m.tenant_id=$2 AND u.active AND m.active AND u.platform_role IS NULL AND m.role<>'admin' AND NOT EXISTS(SELECT 1 FROM staff_memberships other WHERE other.user_id=u.id AND other.tenant_id<>$2) ${lock ? "FOR SHARE OF u,m" : ""}`,
      [userId, tenantId],
    )
  ).rows[0];
  if (!u)
    fail(
      404,
      "RECOVERY_UNAVAILABLE",
      "Recovery is unavailable for this account.",
    );
  await accountScope(db, userId);
  if (
    (
      await db.query(
        "SELECT 1 FROM account_mfa WHERE user_id=$1 AND enabled_at IS NOT NULL",
        [userId],
      )
    ).rowCount
  )
    fail(
      409,
      "MFA_RECOVERY_REQUIRED",
      "Password reset is unavailable for authenticator-protected accounts. Assisted recovery requires an approved recovery policy, which is not yet configured.",
    );
}
managementRouter.post(
  "/admin/users/:id/recovery",
  wrap(async (req, res) => {
    const a = role(req, ["admin"]),
      id = uuid.parse(req.params.id);
    z.object({})
      .strict()
      .parse(req.body ?? {});
    const token = randomToken();
    const result = await transaction(a.tenantId!, async (db) => {
      // Same ordering as login and password changes: account, then recovery token.
      // An office admin cannot inspect another office's account via this check.
      await recoveryEligible(db, a.tenantId!, id, false);
      await lockAccount(db, id);
      await recoveryEligible(db, a.tenantId!, id);
      await db.query(
        "UPDATE password_recovery_tokens SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL",
        [id],
      );
      const row = (
        await db.query(
          "INSERT INTO password_recovery_tokens(token_hash,tenant_id,user_id,created_by,expires_at) VALUES($1,$2,$3,$4,now()+interval '15 minutes') RETURNING expires_at",
          [digest(token), a.tenantId, id, a.userId],
        )
      ).rows[0];
      await audit(db, a.tenantId!, a.userId, "PASSWORD_RECOVERY_CREATED", id, {
        delivery: "MANUAL_TRUSTED_CHANNEL",
      });
      return {
        token,
        recoveryUrl: `${process.env.PUBLIC_ORIGIN ?? "http://127.0.0.1:5173"}/recover?token=${token}`,
        expiresAt: row.expires_at,
      };
    });
    res.status(201).json(result);
  }),
);
publicManagementRouter.post(
  "/auth/recover",
  wrap(async (req, res) => {
    const d = z
        .object({
          token: z.string().regex(/^[a-f0-9]{64}$/),
          newPassword: password,
        })
        .strict()
        .parse(req.body),
      hash = digest(d.token);
    const found = (
      await pool.query("SELECT * FROM locate_password_recovery($1)", [hash])
    ).rows[0];
    if (!found)
      fail(422, "RECOVERY_INVALID", "Recovery link is invalid or expired.");
    await transaction(
      found.tenant_id,
      async (db) => {
        const candidate = (
          await db.query(
            "SELECT user_id FROM password_recovery_tokens WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp()",
            [hash],
          )
        ).rows[0];
        if (!candidate)
          fail(422, "RECOVERY_INVALID", "Recovery link is invalid or expired.");
        await lockAccount(db, candidate.user_id);
        const r = (
          await db.query(
            "SELECT * FROM password_recovery_tokens WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE",
            [hash],
          )
        ).rows[0];
        if (!r)
          fail(422, "RECOVERY_INVALID", "Recovery link is invalid or expired.");
        await recoveryEligible(db, found.tenant_id, r.user_id);
        if (
          !(
            await db.query(
              "SELECT 1 FROM tenants WHERE id=$1 AND status='ACTIVE' FOR SHARE",
              [found.tenant_id],
            )
          ).rowCount
        )
          fail(422, "RECOVERY_INVALID", "Recovery link is invalid or expired.");
        await db.query(
          "UPDATE platform_users SET password_hash=$2 WHERE id=$1",
          [r.user_id, hashPassword(d.newPassword)],
        );
        await db.query(
          "UPDATE sessions SET expires_at=now() WHERE user_id=$1",
          [r.user_id],
        );
        await db.query(
          "UPDATE password_recovery_tokens SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL",
          [r.user_id],
        );
        await consumeAccountRecoveryLinks(db, r.user_id);
        await securityAudit(db, r.user_id, "PASSWORD_RECOVERY_COMPLETED");
        await audit(
          db,
          found.tenant_id,
          r.user_id,
          "PASSWORD_RECOVERY_COMPLETED",
          r.user_id,
        );
      },
      true,
    );
    res.json({ recovered: true });
  }),
);
managementRouter.get(
  "/admin/office",
  wrap(async (req, res) => {
    const a = role(req, ["admin"]);
    res.json(
      officeRow(
        (await pool.query("SELECT * FROM tenants WHERE id=$1", [a.tenantId]))
          .rows[0],
      ),
    );
  }),
);
managementRouter.patch(
  "/admin/office",
  wrap(async (req, res) => {
    const a = role(req, ["admin"]),
      d = officeInput
        .omit({ slug: true })
        .partial()
        .strict()
        .refine((v) => Object.keys(v).length > 0)
        .parse(req.body);
    const item = await transaction(a.tenantId!, async (db) => {
      const existing = (
        await db.query("SELECT * FROM tenants WHERE id=$1 FOR UPDATE", [
          a.tenantId,
        ])
      ).rows[0];
      if (
        !d.geography &&
        existing.division_code &&
        (d.division || d.district || d.upazila || d.officeType)
      )
        fail(
          400,
          "GEOGRAPHY_REQUIRED",
          "Select structured geography to change an office location or type.",
        );
      if (d.officeType && d.officeType !== existing.office_type) {
        // Phase 2a: posts such as "UP Secretary" only exist in some office types.
        const misfit = (
          await db.query(
            "SELECT count(*)::int n FROM staff_memberships m JOIN account_types t ON t.code=m.account_type WHERE m.tenant_id=$1 AND NOT ($2 = ANY(t.office_types))",
            [a.tenantId, d.officeType],
          )
        ).rows[0].n;
        if (misfit)
          fail(
            409,
            "ACCOUNT_TYPES_CONFLICT",
            "Some office accounts have posts that do not exist in the new office type. Change their account types first.",
          );
      }
      const names = d.geography
        ? await validateGeography(
            db,
            d.geography,
            d.officeType ?? existing.office_type,
          )
        : d;
      const r = (
        await db.query(
          "UPDATE tenants SET name_bn=coalesce($2,name_bn),name_en=coalesce($3,name_en),division=coalesce($4,division),district=coalesce($5,district),upazila=coalesce($6,upazila),office_type=coalesce($7,office_type),division_code=$8,district_code=$9,upazila_code=$10,union_code=$11,ward_code=$12 WHERE id=$1 RETURNING *",
          [
            a.tenantId,
            d.nameBn,
            d.nameEn,
            names.division,
            names.district,
            names.upazila,
            d.officeType,
            ...geographyValues(d.geography ?? geographyRow(existing)),
          ],
        )
      ).rows[0];
      await audit(db, a.tenantId!, a.userId, "OFFICE_UPDATED", a.tenantId, d);
      return officeRow(r);
    });
    res.json(item);
  }),
);
// PROFILE-DYNAMIC (owner requirement, 20 Nov 2026): the office name printed on
// certificates is part of the chairman's own office identity. The full office
// editor above stays admin-only (it also moves geography and office type),
// but the NAME must be fixable by the chairman (approver) from his own
// profile — he is the one whose certificates carry it. This name-only path
// mirrors the certificate-assets actor rule (admin + approver, own tenant)
// and lands in the same OFFICE_UPDATED audit stream.
managementRouter.get(
  "/office/name",
  wrap(async (req, res) => {
    const a = role(req, ["admin", "approver"]);
    const t = (
      await pool.query(
        "SELECT slug,name_bn,name_en FROM tenants WHERE id=$1",
        [a.tenantId],
      )
    ).rows[0];
    if (!t) fail(404, "NOT_FOUND", "Office not found.");
    res.json({ slug: t.slug, nameBn: t.name_bn, nameEn: t.name_en });
  }),
);
managementRouter.patch(
  "/office/name",
  wrap(async (req, res) => {
    const a = role(req, ["admin", "approver"]);
    const d = z
      .object({
        nameBn: z.string().trim().min(2).max(150).optional(),
        nameEn: z.string().trim().min(2).max(150).optional(),
      })
      .strict()
      .refine((v) => v.nameBn !== undefined || v.nameEn !== undefined, {
        message: "Provide at least one office name.",
      })
      .parse(req.body);
    const item = await transaction(a.tenantId!, async (db) => {
      const r = (
        await db.query(
          "UPDATE tenants SET name_bn=coalesce($2,name_bn),name_en=coalesce($3,name_en) WHERE id=$1 RETURNING *",
          [a.tenantId, d.nameBn ?? null, d.nameEn ?? null],
        )
      ).rows[0];
      if (!r) fail(404, "NOT_FOUND", "Office not found.");
      await audit(db, a.tenantId!, a.userId, "OFFICE_UPDATED", a.tenantId, {
        ...d,
        via: "office-profile",
      });
      return officeRow(r);
    });
    res.json(item);
  }),
);
// Phase 3b: the office admin turns the citizen profile completeness gate on or off for certificate issuance.
managementRouter.put(
  "/admin/office/profile-completeness",
  wrap(async (req, res) => {
    const a = role(req, ["admin"]),
      d = z.object({ requireCompleteProfile: z.boolean() }).strict().parse(req.body);
    const item = await transaction(a.tenantId!, async (db) => {
      const r = (
        await db.query("UPDATE tenants SET require_complete_profile=$2 WHERE id=$1 RETURNING *", [
          a.tenantId,
          d.requireCompleteProfile,
        ])
      ).rows[0];
      await audit(db, a.tenantId!, a.userId, "PROFILE_COMPLETENESS_ENFORCEMENT_CHANGED", a.tenantId, d);
      return officeRow(r);
    });
    res.json(item);
  }),
);

publicManagementRouter.get(
  "/offices",
  wrap(async (req, res) => {
    const p = pageInput.parse(req.query),
      q = z
        .string()
        .max(100)
        .parse(req.query.q ?? "");
    const filters = ["division", "district", "upazila", "type"].map((k) =>
      z
        .string()
        .max(100)
        .parse(req.query[k] ?? ""),
    );
    const codes = [
      "divisionCode",
      "districtCode",
      "upazilaCode",
      "unionCode",
    ].map((k) => {
      const result = z
        .string()
        .regex(/^(?:[a-z0-9-]{3,30})?$/)
        .safeParse(req.query[k] ?? "");
      if (!result.success)
        fail(
          400,
          "GEOGRAPHY_QUERY_INVALID",
          "Office geography filters must be dataset codes.",
        );
      return result.data;
    });
    const values = [`%${q}%`, ...filters, ...codes];
    const where =
      "status='ACTIVE' AND (name_bn ILIKE $1 OR name_en ILIKE $1 OR slug ILIKE $1) AND ($2='' OR division=$2) AND ($3='' OR district=$3) AND ($4='' OR upazila=$4) AND ($5='' OR office_type=$5) AND ($6='' OR division_code=$6) AND ($7='' OR district_code=$7) AND ($8='' OR upazila_code=$8) AND ($9='' OR union_code=$9)";
    const [items, count] = await Promise.all([
      pool.query(
        `SELECT id,slug,name_bn,name_en,division,district,upazila,office_type,demo,division_code,district_code,upazila_code,union_code,ward_code FROM tenants WHERE ${where} ORDER BY name_en,id LIMIT $10 OFFSET $11`,
        [...values, p.pageSize, (p.page - 1) * p.pageSize],
      ),
      pool.query(
        `SELECT count(*)::int total FROM tenants WHERE ${where}`,
        values,
      ),
    ]);
    res.json({
      items: items.rows.map(officeRow),
      total: count.rows[0].total,
      ...p,
    });
  }),
);
publicManagementRouter.get(
  "/offices/:slug",
  wrap(async (req, res) => {
    const office = (
      await pool.query(
        "SELECT id,slug,name_bn,name_en,division,district,upazila,office_type,demo,division_code,district_code,upazila_code,union_code,ward_code FROM tenants WHERE slug=$1 AND status='ACTIVE'",
        [req.params.slug],
      )
    ).rows[0];
    if (!office) fail(404, "NOT_FOUND", "Office not found.");
    const services = await transaction(office.id, async (db) =>
      (
        await db.query(
          // Phase 4a: each enabled service with the office's current published price list entry, if any.
          `SELECT s.service_no,s.name_bn,s.name_en,s.readiness,c.credit_cost,
             p.version AS policy_version,p.statutory_fee_minor,p.processing_fee_minor,p.emergency_surcharge_minor,
             p.office_collection_fee_minor,p.digital_copy_fee_minor,p.delivery_modes,p.urgencies,p.charter_days,
             p.required_documents
           FROM service_catalog s JOIN tenant_service_configuration c USING(service_no)
           LEFT JOIN LATERAL (SELECT * FROM service_order_policies o WHERE o.tenant_id=c.tenant_id AND o.service_no=c.service_no ORDER BY o.version DESC LIMIT 1) p ON true
           WHERE c.enabled AND c.tenant_id=$1 ORDER BY s.service_no`,
          [office.id],
        )
      ).rows.map(camelRow),
    );
    const notices = (
      await pool.query(
        "SELECT * FROM public_notices() WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50",
        [office.id],
      )
    ).rows.map(camelRow);
    // Phase 6b: designated issuing officers — approvers with active authority, by name and post only.
    const officers = await transaction(office.id, async (db) =>
      (
        await db.query(
          `SELECT u.display_name, at.name_bn AS post_bn, at.name_en AS post_en, array_agg(aa.service_no ORDER BY aa.service_no) AS services
           FROM approval_authorizations aa
           JOIN staff_memberships m ON m.tenant_id=aa.tenant_id AND m.user_id=aa.user_id AND m.active AND m.role='approver'
           JOIN platform_users u ON u.id=m.user_id AND u.active
           LEFT JOIN account_types at ON at.code=m.account_type
           WHERE aa.tenant_id=$1 AND aa.active
           GROUP BY u.id, u.display_name, at.name_bn, at.name_en ORDER BY u.display_name`,
          [office.id],
        )
      ).rows.map((r) => ({ name: r.display_name, postBn: r.post_bn, postEn: r.post_en, services: r.services })),
    );
    res.json({ office: officeRow(office), services, notices, officers });
  }),
);
// Phase 6: public per-service view across participating offices — for each ACTIVE office that offers
// the service, its current published fee policy (fees, citizen-charter time, required documents).
// Offices without a published policy are returned with policyVersion null; no values are inferred.
publicManagementRouter.get(
  "/services/:no/office-info",
  wrap(async (req, res) => {
    const no = z.coerce.number().int().min(1).max(47).parse(req.params.no);
    const service = (
      await pool.query(
        "SELECT service_no,name_bn,name_en,category FROM service_catalog WHERE service_no=$1",
        [no],
      )
    ).rows[0];
    if (!service) fail(404, "NOT_FOUND", "Service not found.");
    const offices = (
      await pool.query("SELECT * FROM public_service_office_info($1)", [no])
    ).rows.map(camelRow);
    res.json({ service: camelRow(service), offices });
  }),
);
publicManagementRouter.get(
  "/notices",
  wrap(async (req, res) => {
    const p = pageInput.parse(req.query),
      office = z
        .string()
        .max(50)
        .parse(req.query.office ?? "");
    const search = `%${z
      .string()
      .max(100)
      .parse(req.query.q ?? "")}%`;
    const [rows, count] = await Promise.all([
      pool.query(
        "SELECT * FROM public_notices() WHERE ($1='' OR office_slug=$1) AND (title_bn ILIKE $4 OR title_en ILIKE $4 OR body_bn ILIKE $4 OR body_en ILIKE $4) ORDER BY created_at DESC,id LIMIT $2 OFFSET $3",
        [office, p.pageSize, (p.page - 1) * p.pageSize, search],
      ),
      pool.query(
        "SELECT count(*)::int total FROM public_notices() WHERE ($1='' OR office_slug=$1) AND (title_bn ILIKE $2 OR title_en ILIKE $2 OR body_bn ILIKE $2 OR body_en ILIKE $2)",
        [office, search],
      ),
    ]);
    res.json({
      items: rows.rows.map(camelRow),
      total: count.rows[0].total,
      ...p,
    });
  }),
);
publicManagementRouter.post(
  "/auth/signup",
  wrap(async (req, res) => {
    const full = () => z
      .object({
        email,
        password,
        displayName: z.string().min(2).max(120),
        tenantId: uuid,
        nameBn: z.string().min(2).max(120),
        nameEn: z.string().min(2).max(120),
        dateOfBirth: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .refine(
            (v) =>
              Number.isFinite(Date.parse(v)) &&
              new Date(v).toISOString().slice(0, 10) === v,
          )
          // QA-16: the browser blocked future dates but the API accepted them.
          .refine(
            (v) =>
              v <= new Date().toISOString().slice(0, 10) && v >= "1900-01-01",
            "জন্ম তারিখ আজকের বা তার আগের হতে হবে। / Date of birth must be today or earlier.",
          ),
        addressBn: z.string().min(4).max(500),
        addressEn: z.string().min(4).max(500),
        syntheticReference: z
          .string()
          .regex(/^REF-[A-Za-z0-9-]{3,50}$/)
          .optional(),
        geography: geographyInput.optional(),
        presentAddress: presentAddressInput.optional(),
        // Phase 2c: a mobile number is accepted only with a verified one-time code.
        mobile: z.string().min(1).max(40).optional(),
        otpToken: z.string().regex(/^[a-f0-9]{64}$/).optional(),
      })
      .strict()
      .refine((v) => (v.mobile === undefined) === (v.otpToken === undefined), {
        message: "A mobile number needs its verified code.",
      })
      .parse(req.body);
    // REG-UX Phase 1: the one-screen form sends { tenantId, name, mobile, password,
    // email?, photo? }. It is normalised into the same internal record the full
    // payload builds — one transaction, one audit event, one reference path.
    const isShort =
      !!req.body && typeof req.body === "object" && "name" in req.body && !("nameBn" in req.body);
    const short = isShort ? shortSignupInput.parse(req.body) : null;
    const d: SignupRecord = short
      ? {
          email: short.email,
          password: short.password,
          displayName: short.name,
          tenantId: short.tenantId,
          // The name lands in the column of the script it is written in; the other
          // script is collected at profile completion (never guessed here).
          nameBn: BENGALI_SCRIPT.test(short.name) ? short.name : null,
          nameEn: BENGALI_SCRIPT.test(short.name) ? null : short.name,
          dateOfBirth: null,
          addressBn: null,
          addressEn: null,
          mobile: short.mobile,
          otpToken: short.otpToken,
          photo: short.photo,
        }
      : full();
    const mobile = d.mobile ? normalizeIdentifier("mobile", d.mobile) : null;
    if (d.mobile && !mobile)
      fieldFail(
        422,
        "IDENTIFIER_INVALID",
        "০১ দিয়ে শুরু ১১ সংখ্যার মোবাইল নম্বর দিন। / Enter an 11-digit Bangladeshi mobile number starting with 01.",
        "mobile",
      );
    // K2 (owner decision open; lean built: email optional). An account without an
    // email signs in with its mobile number, so that path needs the identifier secret.
    if (short && !short.email && !identifiersAvailable())
      fieldFail(
        422,
        "EMAIL_REQUIRED",
        "এই সার্ভারে শুধু মোবাইল দিয়ে সাইন ইন চালু নেই — একটি ইমেইল দিন। / Mobile sign-in is not configured on this server — please add an email.",
        "email",
      );
    const photoBytes = d.photo ? decodeUpload(d.photo) : null;
    // platform_users.email is UNIQUE NOT NULL: an email-less account gets an
    // internal address on the reserved .invalid domain — machine-only, never shown,
    // never mailed (sendEmail refuses it), replaced when the citizen adds an email.
    const accountEmail = d.email ?? placeholderEmail(randomUUID());
    // Phase X: when email delivery is configured, a verification token is created inside the
    // registration transaction and the message is sent only after it commits.
    const verification: { current: { token: string; email: string } | null } = { current: null };
    // S-001: whether the mobile bound by this registration was OTP-verified.
    const mobileVerification: { current: boolean } = { current: false };
    try {
      await transaction(d.tenantId, async (db) => {
      const office = (
        await db.query(
          "SELECT * FROM tenants WHERE id=$1 AND status='ACTIVE' FOR SHARE",
          [d.tenantId],
        )
      ).rows[0];
      if (!office) fail(404, "NOT_FOUND", "Active office not found.");
      // REG-UX §2.2/§3.5: the short form makes no area claim — the citizen's area is
      // the chosen office's own (division…union; the ward is a deferred profile item).
      // Jurisdiction holds by construction and UNION_NOT_LISTED cannot arise.
      if (short && office.division_code)
        d.geography = {
          divisionCode: office.division_code,
          districtCode: office.district_code,
          upazilaCode: office.upazila_code,
          ...(office.union_code ? { unionCode: office.union_code } : {}),
        };
      else if (office.division_code && !d.geography)
        fail(
          400,
          "GEOGRAPHY_REQUIRED",
          "Select an address hierarchy for this participating office.",
        );
      if (d.geography && !short) {
        await validateGeography(db, d.geography, "citizen");
        validateOfficeJurisdiction(office, d.geography);
        // Phase 3E (§3.6): the citizen's union must be listed on the platform — an
        // ACTIVE office serves it (a union office for that union, or an upazila-wide
        // office with no union of its own) — otherwise registration cannot proceed.
        // Signups without geography (legacy callers) make no union claim and are
        // unchanged; the office-jurisdiction check above still binds mapped offices.
        if (d.geography.unionCode) {
          const listed = (
            await db.query(
              `SELECT 1 FROM tenants WHERE status='ACTIVE' AND division_code=$1 AND district_code=$2 AND upazila_code=$3
               AND (union_code=$4 OR union_code IS NULL) LIMIT 1`,
              [
                d.geography.divisionCode,
                d.geography.districtCode,
                d.geography.upazilaCode,
                d.geography.unionCode,
              ],
            )
          ).rowCount;
          if (!listed)
            fail(
              422,
              "UNION_NOT_LISTED",
              "এই ইউনিয়ন এখনো DigitalUnion-এ যুক্ত হয়নি। / This union has not joined DigitalUnion yet, so registration is not available for it.",
            );
        }
      }
      // REG-UX §4.1: a taken email is named, with the remedy, at the email field
      // (the generic DUPLICATE message named neither the field nor a way out).
      if (
        d.email &&
        (await db.query("SELECT 1 FROM platform_users WHERE lower(email)=$1", [d.email])).rowCount
      )
        emailTaken();
      const shortMobileDigest = short && mobile ? identifierDigest("mobile", mobile) : null;
      if (
        shortMobileDigest &&
        (await db.query("SELECT 1 FROM account_identifiers WHERE kind='mobile' AND digest=$1", [shortMobileDigest])).rowCount
      )
        mobileTaken();
      const user = (
        await db.query(
          "INSERT INTO platform_users(email,display_name,password_hash) VALUES($1,$2,$3) RETURNING id",
          [accountEmail, d.displayName, hashPassword(d.password)],
        )
      ).rows[0];
      await db.query(
        "INSERT INTO staff_memberships(user_id,tenant_id,role) VALUES($1,$2,'citizen')",
        [user.id, d.tenantId],
      );
      // CERTNO-01: self-registration mints the new 16-digit public reference when the
      // caller did not supply one (Asia/Dhaka registration date + 8 random digits,
      // uniqueness-checked). Caller-supplied REF-… references and previously issued
      // references are unchanged.
      const citizenId = randomUUID();
      const syntheticReference =
        d.syntheticReference ??
        (await mintReference(citizenReferenceExists(db, d.tenantId)));
      await db.query(
        "INSERT INTO citizens(id,tenant_id,user_id,full_name_bn,full_name_en,date_of_birth,address_bn,address_en,synthetic_reference,division_code,district_code,upazila_code,union_code,ward_code,present_same_as_permanent,present_address_bn,present_address_en,present_division_code,present_district_code,present_upazila_code,present_union_code,present_ward_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)",
        [
          citizenId,
          d.tenantId,
          user.id,
          d.nameBn,
          d.nameEn,
          d.dateOfBirth,
          d.addressBn,
          d.addressEn,
          syntheticReference,
          ...geographyValues(d.geography),
          ...(await presentAddressValues(db, d.presentAddress)),
        ],
      );
      if (short) {
        // S-001: the short form's mobile is the citizen's contact number and
        // the sign-in identifier — but it becomes TRUSTED only when a
        // one-time code proved it. With an otpToken the code is consumed
        // here and the identifier is verified at once; without one the
        // account is still created (registration never waits on SMS) and
        // the mobile stays PENDING (verified_at NULL, self_declared true)
        // until the holder proves it via POST /auth/otp/verify-mobile.
        // A provider outage can therefore never mark a mobile verified.
        await db.query(
          "UPDATE citizens SET contact_mobile=$3, photo=$4, photo_mime=$5, photo_updated_at=CASE WHEN $4::bytea IS NULL THEN NULL ELSE now() END WHERE tenant_id=$1 AND id=$2",
          [d.tenantId, citizenId, mobile, photoBytes, photoBytes ? d.photo!.mimeType : null],
        );
        if (shortMobileDigest) {
          if (d.otpToken) {
            await consumeSignupOtp(db, d.otpToken, mobile!);
            await db.query(
              "INSERT INTO account_identifiers(user_id,kind,digest,hint,self_declared,verified_at) VALUES($1,'mobile',$2,$3,false,clock_timestamp())",
              [user.id, shortMobileDigest, identifierHint("mobile", mobile!)],
            );
            mobileVerification.current = true;
          } else {
            await db.query(
              "INSERT INTO account_identifiers(user_id,kind,digest,hint,self_declared) VALUES($1,'mobile',$2,$3,true)",
              [user.id, shortMobileDigest, identifierHint("mobile", mobile!)],
            );
          }
        }
      } else if (mobile) {
        const digestValue = identifierDigest("mobile", mobile);
        if ((await db.query("SELECT 1 FROM account_identifiers WHERE kind='mobile' AND digest=$1", [digestValue])).rowCount)
          mobileTaken();
        await consumeSignupOtp(db, d.otpToken!, mobile);
        await db.query(
          "INSERT INTO account_identifiers(user_id,kind,digest,hint,verified_at) VALUES($1,'mobile',$2,$3,clock_timestamp())",
          [user.id, digestValue, identifierHint("mobile", mobile)],
        );
        mobileVerification.current = true;
      }
      if (emailAvailable() && d.email) {
        const issued = await issueEmailVerificationToken(db, d.tenantId, user.id, d.email);
        verification.current = { token: issued.token, email: d.email };
      }
      await audit(db, d.tenantId, user.id, "DEMO_SELF_REGISTRATION", user.id);
      });
    } catch (error: any) {
      // Backstop for a concurrent signup with the same email (the pre-check runs
      // first; this keeps the race from surfacing as the generic DUPLICATE).
      if (error?.code === "23505" && error?.constraint === "platform_users_email_key")
        emailTaken();
      // Demand list (§3.6, owner-approved 18 Nov 08:01): a signup refused only because
      // its union is not listed is captured for the owner — after the transaction has
      // rolled back, in the failure-isolated write of demand.ts, so the response the
      // gate produced is exactly the one returned, capture or no capture.
      if (
        error instanceof ApiError &&
        error.code === "UNION_NOT_LISTED" &&
        d.geography?.unionCode
      )
        await recordRegistrationDemand({
          nameBn: d.nameBn ?? d.displayName,
          nameEn: d.nameEn ?? d.displayName,
          phone: mobile,
          geography: d.geography,
        });
      throw error;
    }
    // Verification never gates the account: it is reported honestly as sent, failed or
    // unavailable (no mail provider configured), and sign-in works in every case.
    let emailVerification: "sent" | "failed" | "unavailable" = "unavailable";
    if (verification.current)
      emailVerification = (await sendEmailVerificationMessage(verification.current.email, verification.current.token))
        ? "sent"
        : "failed";
    res.status(201).json({
      registered: true,
      // S-001: the caller must know whether mobile sign-in works yet. A
      // pending mobile cannot sign in until the holder proves it with a
      // code (POST /auth/otp/verify-mobile); email sign-in is unaffected.
      mobileVerified: mobile ? mobileVerification.current : null,
      mobileVerification: mobile
        ? mobileVerification.current
          ? "verified"
          : "pending"
        : null,
      // BUNDLE06-R5 D1: demo wording is internal vocabulary — in OFFICIAL
      // mode citizens must never see "SYNTHETIC_DEMO" in an API response.
      // The citizens.verification_state column keeps its stored value; only
      // this citizen-facing response label changes with the issuance mode.
      verificationState:
        process.env.ISSUANCE_MODE === "official"
          ? "UNVERIFIED"
          : "SYNTHETIC_DEMO",
      geography: d.geography ?? null,
      emailVerification,
    });
  }),
);
managementRouter.post(
  "/auth/password",
  accountActionLimiter,
  wrap(async (req, res) => {
    const a = role(req, [
      "owner",
      "admin",
      "staff",
      "reviewer",
      "approver",
      "finance",
      "citizen",
    ]);
    const d = z
      .object({
        currentPassword: z.string().min(1).max(200),
        newPassword: password,
      })
      .strict()
      .parse(req.body);
    const revoked = await accountTransaction(a, async (db, user) => {
      if (!checkPassword(d.currentPassword, user.password_hash))
        fail(422, "PASSWORD_MISMATCH", "Current password is incorrect.");
      await db.query("UPDATE platform_users SET password_hash=$2 WHERE id=$1", [
        a.userId,
        hashPassword(d.newPassword),
      ]);
      const expired = await db.query(
        "UPDATE sessions SET expires_at=clock_timestamp() WHERE user_id=$1 AND csrf_token<>$2 AND expires_at>clock_timestamp()",
        [a.userId, a.csrfToken],
      );
      await consumeAccountRecoveryLinks(db, a.userId);
      await accountAudit(db, a, "PASSWORD_CHANGED", expired.rowCount ?? 0);
      return expired.rowCount ?? 0;
    });
    logOwnerAccountAction(a, "PASSWORD_CHANGED", revoked);
    res.json({ changed: true });
  }),
);
managementRouter.get(
  "/auth/sessions",
  wrap(async (req, res) => {
    const a = req.auth!;
    const summary = await accountTransaction(a, async (db, user) => {
      const rows = (
        await db.query(
          `SELECT s.csrf_token=$2 AS current,s.expires_at FROM sessions s
         WHERE s.user_id=$1 AND s.expires_at>clock_timestamp() AND (
           (s.tenant_id IS NULL AND $3::text='owner') OR EXISTS (
             SELECT 1 FROM staff_memberships m JOIN tenants t ON t.id=m.tenant_id
             WHERE m.user_id=s.user_id AND m.tenant_id=s.tenant_id AND m.active AND t.status='ACTIVE'))`,
          [a.userId, a.csrfToken, user.platform_role],
        )
      ).rows;
      const current = rows.find((row) => row.current);
      if (!current)
        fail(
          401,
          "SESSION_INACTIVE",
          "This session or tenant membership is inactive.",
        );
      return {
        activeSessions: rows.length,
        otherSessions: rows.filter((row) => !row.current).length,
        currentSessionExpiresAt: current.expires_at,
      };
    });
    res.json(summary);
  }),
);
managementRouter.post(
  "/auth/sessions/revoke-others",
  accountActionLimiter,
  wrap(async (req, res) => {
    const a = req.auth!;
    const d = z
      .object({ currentPassword: z.string().min(1).max(200) })
      .strict()
      .parse(req.body);
    const revoked = await accountTransaction(a, async (db, user) => {
      if (!checkPassword(d.currentPassword, user.password_hash))
        fail(422, "PASSWORD_MISMATCH", "Current password is incorrect.");
      const result = await db.query(
        "UPDATE sessions SET expires_at=clock_timestamp() WHERE user_id=$1 AND csrf_token<>$2 AND expires_at>clock_timestamp()",
        [a.userId, a.csrfToken],
      );
      await invalidateMfaChallenges(db, a.userId);
      await accountAudit(db, a, "OTHER_SESSIONS_REVOKED", result.rowCount ?? 0);
      return result.rowCount ?? 0;
    });
    logOwnerAccountAction(a, "OTHER_SESSIONS_REVOKED", revoked);
    res.json({ revoked, remainingSessions: 1 });
  }),
);
/** Phase 2a: office posts this office may assign, with the role each one grants. */
managementRouter.get(
  "/admin/account-types",
  wrap(async (req, res) => {
    const a = role(req, ["admin"]);
    const items = await transaction(a.tenantId!, async (db) =>
      (
        await db.query(
          `SELECT t.code,t.name_bn,t.name_en,t.role,t.status,t.office_types,
                  (o.office_type = ANY(t.office_types)) AS available
             FROM account_types t CROSS JOIN (SELECT office_type FROM tenants WHERE id=$1) o
            ORDER BY t.sort_order`,
          [a.tenantId],
        )
      ).rows.map(camelRow),
    );
    res.json({ items });
  }),
);
async function accountTypeFor(
  db: { query: (q: string, v?: unknown[]) => Promise<any> },
  code: string,
  tenantId: string,
) {
  const t = (
    await db.query(
      "SELECT t.*, (SELECT office_type FROM tenants WHERE id=$2) AS office_type FROM account_types t WHERE t.code=$1",
      [code, tenantId],
    )
  ).rows[0];
  if (!t) fail(422, "ACCOUNT_TYPE_UNKNOWN", "Choose a listed account type.");
  if (!t.office_types.includes(t.office_type))
    fail(
      422,
      "ACCOUNT_TYPE_OFFICE_MISMATCH",
      "This post does not exist in this kind of office.",
    );
  return t as { code: string; role: string };
}
const accountTypeCode = z.string().regex(/^[a-z][a-z0-9_]{2,39}$/);
managementRouter.get(
  "/admin/users",
  wrap(async (req, res) => {
    const a = role(req, ["admin"]);
    const rows = await transaction(a.tenantId!, async (db) =>
      (
        await db.query(
          "SELECT u.id,u.email,u.display_name,m.role,m.active,m.account_type,t.name_bn account_type_bn,t.name_en account_type_en FROM staff_memberships m JOIN platform_users u ON u.id=m.user_id LEFT JOIN account_types t ON t.code=m.account_type WHERE m.tenant_id=$1 ORDER BY u.display_name",
          [a.tenantId],
        )
      ).rows.map(camelRow),
    );
    res.json({ items: rows });
  }),
);
managementRouter.post(
  "/admin/users",
  wrap(async (req, res) => {
    const a = role(req, ["admin"]),
      d = z
        .object({
          email,
          displayName: z.string().min(2).max(120),
          password,
          role: roleInput.optional(),
          accountType: accountTypeCode.optional(),
        })
        .strict()
        // Either an office post (which fixes the role) or a role chosen directly, as before.
        .refine((v) => (v.role === undefined) !== (v.accountType === undefined), {
          message: "Provide either accountType or role.",
        })
        .parse(req.body);
    const item = await transaction(a.tenantId!, async (db) => {
      const type = d.accountType
        ? await accountTypeFor(db, d.accountType, a.tenantId!)
        : null;
      const membershipRole = type ? type.role : d.role!;
      const u = (
        await db.query(
          "INSERT INTO platform_users(email,display_name,password_hash) VALUES($1,$2,$3) RETURNING id,email,display_name",
          [d.email, d.displayName, hashPassword(d.password)],
        )
      ).rows[0];
      await db.query(
        "INSERT INTO staff_memberships(user_id,tenant_id,role,account_type) VALUES($1,$2,$3,$4)",
        [u.id, a.tenantId, membershipRole, type?.code ?? null],
      );
      await audit(db, a.tenantId!, a.userId, "MEMBERSHIP_CREATED", u.id, {
        role: membershipRole,
        ...(type ? { accountType: type.code } : {}),
      });
      return {
        ...camelRow(u),
        role: membershipRole,
        accountType: type?.code ?? null,
        active: true,
      };
    });
    res.status(201).json(item);
  }),
);
managementRouter.patch(
  "/admin/users/:id",
  wrap(async (req, res) => {
    const a = role(req, ["admin"]),
      id = uuid.parse(req.params.id),
      d = z
        .object({
          role: roleInput.optional(),
          accountType: accountTypeCode.optional(),
          active: z.boolean().optional(),
        })
        .strict()
        .refine((v) => Object.keys(v).length > 0)
        .refine((v) => !(v.role && v.accountType), {
          message: "Provide either accountType or role, not both.",
        })
        .parse(req.body);
    const effectiveRole = d.accountType
      ? (
          await transaction(a.tenantId!, (db) =>
            accountTypeFor(db, d.accountType!, a.tenantId!),
          )
        ).role
      : d.role;
    if (
      id === a.userId &&
      ((effectiveRole && effectiveRole !== "admin") || d.active === false)
    )
      fail(
        422,
        "SELF_ADMIN_CHANGE",
        "Another administrator must change your administrative membership.",
      );
    const item = await transaction(a.tenantId!, async (db) => {
      const r = (
        await db.query(
          // A direct role change drops the post; choosing a post sets its role.
          `UPDATE staff_memberships SET role=coalesce($3,role),active=coalesce($4,active),
             account_type=CASE WHEN $5::text IS NOT NULL THEN $5 WHEN $3::text IS NOT NULL THEN NULL ELSE account_type END
           WHERE tenant_id=$1 AND user_id=$2 RETURNING user_id,role,active,account_type`,
          [a.tenantId, id, effectiveRole, d.active, d.accountType ?? null],
        )
      ).rows[0];
      if (!r) fail(404, "NOT_FOUND", "Membership not found.");
      await audit(db, a.tenantId!, a.userId, "MEMBERSHIP_UPDATED", id, d);
      return camelRow(r);
    });
    res.json(item);
  }),
);
managementRouter.get(
  "/admin/authorizations",
  wrap(async (req, res) => {
    const a = role(req, ["admin"]);
    res.json({
      items: await transaction(a.tenantId!, async (db) =>
        (
          await db.query(
            "SELECT * FROM approval_authorizations ORDER BY user_id,service_no",
          )
        ).rows.map(camelRow),
      ),
    });
  }),
);
managementRouter.put(
  "/admin/authorizations/:userId/:serviceNo",
  wrap(async (req, res) => {
    const a = role(req, ["admin"]),
      id = uuid.parse(req.params.userId),
      no = z.coerce.number().int().min(1).max(47).parse(req.params.serviceNo),
      d = z
        .object({
          active: z.boolean(),
          authorityNote: z.string().trim().min(12).max(500),
        })
        .strict()
        .parse(req.body);
    const item = await transaction(a.tenantId!, async (db) => {
      if (
        !(
          await db.query(
            "SELECT 1 FROM staff_memberships WHERE tenant_id=$1 AND user_id=$2 AND active AND role='approver'",
            [a.tenantId, id],
          )
        ).rowCount
      )
        fail(
          422,
          "APPROVER_REQUIRED",
          "Select an active approver in this office.",
        );
      const r = (
        await db.query(
          "INSERT INTO approval_authorizations(tenant_id,user_id,service_no,active,authority_note) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,user_id,service_no) DO UPDATE SET active=excluded.active,authority_note=excluded.authority_note RETURNING *",
          [a.tenantId, id, no, d.active, d.authorityNote],
        )
      ).rows[0];
      await audit(
        db,
        a.tenantId!,
        a.userId,
        "DEMO_APPROVAL_GRANT_UPDATED",
        id,
        { serviceNo: no, active: d.active },
      );
      return camelRow(r);
    });
    res.json(item);
  }),
);
managementRouter.get(
  "/admin/services",
  wrap(async (req, res) => {
    const a = role(req, ["admin"]);
    res.json({
      items: await transaction(a.tenantId!, async (db) =>
        (
          await db.query(
            "SELECT c.*,s.name_bn,s.name_en FROM tenant_service_configuration c JOIN service_catalog s USING(service_no) ORDER BY service_no",
          )
        ).rows.map(camelRow),
      ),
    });
  }),
);
managementRouter.patch(
  "/admin/services/:no",
  wrap(async (req, res) => {
    const a = role(req, ["admin"]),
      no = z.coerce.number().int().min(1).max(47).parse(req.params.no),
      d = z
        .object({
          enabled: z.boolean().optional(),
          creditCost: z.number().int().min(1).max(10000).optional(),
        })
        .strict()
        .refine((v) => Object.keys(v).length > 0)
        .parse(req.body);
    const r = await transaction(a.tenantId!, async (db) => {
      const r = (
        await db.query(
          "UPDATE tenant_service_configuration SET enabled=coalesce($3,enabled),credit_cost=coalesce($4,credit_cost) WHERE tenant_id=$1 AND service_no=$2 RETURNING *",
          [a.tenantId, no, d.enabled, d.creditCost],
        )
      ).rows[0];
      if (!r) fail(404, "NOT_FOUND", "Service setting not found.");
      await audit(
        db,
        a.tenantId!,
        a.userId,
        "SERVICE_CONFIGURATION_UPDATED",
        String(no),
        d,
      );
      return camelRow(r);
    });
    res.json(r);
  }),
);
const noticeInput = z.object({
  titleBn: z.string().min(2).max(180),
  titleEn: z.string().min(2).max(180),
  bodyBn: z.string().min(2).max(5000),
  bodyEn: z.string().min(2).max(5000),
  published: z.boolean(),
});
managementRouter.get(
  "/admin/notices",
  wrap(async (req, res) => {
    const a = role(req, ["admin"]);
    res.json({
      items: await transaction(a.tenantId!, async (db) =>
        (
          await db.query("SELECT * FROM notices ORDER BY created_at DESC")
        ).rows.map(camelRow),
      ),
    });
  }),
);
managementRouter.post(
  "/admin/notices",
  wrap(async (req, res) => {
    const a = role(req, ["admin"]),
      d = noticeInput.strict().parse(req.body);
    const item = await transaction(a.tenantId!, async (db) => {
      const r = (
        await db.query(
          "INSERT INTO notices(tenant_id,title_bn,title_en,body_bn,body_en,published,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
          [
            a.tenantId,
            d.titleBn,
            d.titleEn,
            d.bodyBn,
            d.bodyEn,
            d.published,
            a.userId,
          ],
        )
      ).rows[0];
      await audit(db, a.tenantId!, a.userId, "NOTICE_CREATED", r.id);
      return camelRow(r);
    });
    res.status(201).json(item);
  }),
);
managementRouter.patch(
  "/admin/notices/:id",
  wrap(async (req, res) => {
    const a = role(req, ["admin"]),
      id = uuid.parse(req.params.id),
      d = noticeInput
        .partial()
        .strict()
        .refine((v) => Object.keys(v).length > 0)
        .parse(req.body);
    const item = await transaction(a.tenantId!, async (db) => {
      const r = (
        await db.query(
          "UPDATE notices SET title_bn=coalesce($2,title_bn),title_en=coalesce($3,title_en),body_bn=coalesce($4,body_bn),body_en=coalesce($5,body_en),published=coalesce($6,published),updated_at=now() WHERE id=$1 RETURNING *",
          [id, d.titleBn, d.titleEn, d.bodyBn, d.bodyEn, d.published],
        )
      ).rows[0];
      if (!r) fail(404, "NOT_FOUND", "Notice not found.");
      await audit(db, a.tenantId!, a.userId, "NOTICE_UPDATED", id);
      return camelRow(r);
    });
    res.json(item);
  }),
);
managementRouter.post(
  "/owner/tenants",
  wrap(async (req, res) => {
    const a = role(req, ["owner"]),
      d = officeInput
        .extend({
          adminEmail: email,
          adminName: z.string().min(2).max(120),
          adminPassword: password,
          // Phase 3A: office creation is the owner's approval moment (there is
          // no pending-office queue), so the owner may activate the new
          // office's subscription in the same step instead of leaving it
          // EXPIRED for a second action.
          activateSubscription: z
            .object({
              planId: z.string().min(1).max(50).optional(),
              days: z.number().int().min(1).max(3650).optional(),
              grantCredits: z.boolean().optional(),
            })
            .strict()
            .optional(),
        })
        .strict()
        .parse(req.body),
      id = randomUUID();
    const item = await transaction(id, async (db) => {
      const names = d.geography
        ? await validateGeography(db, d.geography, d.officeType)
        : d;
      if (!names.division || !names.district || !names.upazila)
        fail(
          400,
          "GEOGRAPHY_REQUIRED",
          "Select office geography or provide all legacy location names.",
        );
      const t = (
        await db.query(
          "INSERT INTO tenants(id,slug,name_bn,name_en,division,district,upazila,office_type,division_code,district_code,upazila_code,union_code,ward_code,demo) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,false) RETURNING *",
          [
            id,
            d.slug,
            d.nameBn,
            d.nameEn,
            names.division,
            names.district,
            names.upazila,
            d.officeType,
            ...geographyValues(d.geography),
          ],
        )
      ).rows[0];
      const u = (
        await db.query(
          "INSERT INTO platform_users(email,display_name,password_hash) VALUES($1,$2,$3) RETURNING id",
          [d.adminEmail, d.adminName, hashPassword(d.adminPassword)],
        )
      ).rows[0];
      await db.query(
        "INSERT INTO staff_memberships(user_id,tenant_id,role) VALUES($1,$2,'admin')",
        [u.id, id],
      );
      await db.query("INSERT INTO tenant_wallets(tenant_id) VALUES($1)", [id]);
      await db.query(
        "INSERT INTO tenant_subscriptions(tenant_id,plan_id,valid_until,status,plan_duration_days,plan_grant_credits,plan_allowance_limit) SELECT $1,id,now(),'EXPIRED',duration_days,grant_credits,monthly_allowance_limit FROM subscription_plans WHERE id='standard-monthly'",
        [id],
      );
      if (d.activateSubscription)
        await applySubscriptionAction(db, id, a.userId, {
          action: "activate",
          planId: d.activateSubscription.planId,
          days: d.activateSubscription.days,
          grantCredits: d.activateSubscription.grantCredits,
          reason: "Subscription activated on office approval",
        });
      await db.query(
        "INSERT INTO tenant_service_configuration(tenant_id,service_no) SELECT $1,service_no FROM service_catalog",
        [id],
      );
      await audit(db, id, a.userId, "TENANT_CREATED", id, { demo: false });
      return officeRow(t);
    });
    res.status(201).json(item);
  }),
);
managementRouter.patch(
  "/owner/tenants/:id",
  wrap(async (req, res) => {
    const a = role(req, ["owner"]),
      id = uuid.parse(req.params.id),
      d = z
        .object({ status: z.enum(["ACTIVE", "SUSPENDED"]) })
        .strict()
        .parse(req.body);
    const item = await transaction(id, async (db) => {
      const t = (
        await db.query("UPDATE tenants SET status=$2 WHERE id=$1 RETURNING *", [
          id,
          d.status,
        ])
      ).rows[0];
      if (!t) fail(404, "NOT_FOUND", "Tenant not found.");
      await audit(db, id, a.userId, "TENANT_STATUS_UPDATED", id, d);
      return camelRow(t);
    });
    res.json(item);
  }),
);
