import express from "express";
import { z } from "zod";
import { pool, type DB } from "./db.js";
import { fail } from "./models.js";
import type { Auth } from "./app.js";

/**
 * Phase 3E: the OWNER coupon system (billing plan §3.7). This is the platform-level
 * counterpart of the office coupon codes in orders.ts (migration 028): those discount a
 * citizen's application fee inside one office, while these discount an office's
 * subscription purchase or credit top-up ORDER. Following the plan doc — which names
 * subscription purchase / credit top-up as the application point and requires the
 * redemption to be recorded on the order — the discount is taken at order creation
 * (POST /api/v1/billing/orders): the order's amount_minor becomes the net payable
 * amount, and coupon_code + discount_minor are stored on the order row with an
 * append-only redemption row (code, discount, office, who, when). Every downstream
 * reader (gateway webhook amount check, owner manual settle, invoice) keeps reading
 * amount_minor with the same meaning as before.
 *
 * Visibility is the owner's choice (§3.7): 'public' coupons are listed on the portal
 * (GET /public/coupons); 'hidden' coupons are never listed anywhere public and work
 * only for an office that knows the code.
 */
type Req = express.Request & { auth?: Auth };
const wrap =
  (fn: (req: Req, res: express.Response) => Promise<unknown>) =>
  (req: Req, res: express.Response, next: express.NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);
function role(req: Req, allowed: string[]) {
  if (!req.auth || !allowed.includes(req.auth.role)) fail(403, "ROLE_DENIED", "This role is not permitted.");
  return req.auth!;
}
export const platformCouponCode = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9-]{2,31}$/));

const couponRow = (r: any) => ({
  code: r.code,
  discountKind: r.discount_kind,
  discountValue: r.discount_value,
  appliesTo: r.applies_to,
  planId: r.plan_id ?? null,
  validFrom: r.valid_from,
  validUntil: r.valid_until ?? null,
  maxUses: r.max_uses ?? null,
  perOfficeLimit: r.per_office_limit ?? null,
  visibility: r.visibility,
  active: r.active,
  redemptions: r.redemptions ?? 0,
  discountTotalMinor: r.discount_total_minor ?? 0,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const couponState = (r: any) => ({
  discountKind: r.discount_kind,
  discountValue: r.discount_value,
  appliesTo: r.applies_to,
  planId: r.plan_id ?? null,
  validFrom: r.valid_from instanceof Date ? r.valid_from.toISOString() : r.valid_from,
  validUntil:
    r.valid_until == null ? null : r.valid_until instanceof Date ? r.valid_until.toISOString() : r.valid_until,
  maxUses: r.max_uses ?? null,
  perOfficeLimit: r.per_office_limit ?? null,
  visibility: r.visibility,
  active: r.active,
});
const couponFields = {
  discountKind: z.enum(["percent", "fixed"]),
  discountValue: z.number().int().min(1).max(100_000_000),
  appliesTo: z.enum(["subscription", "topup", "both"]),
  planId: z.string().min(1).max(50).nullable(),
  validFrom: z.string().datetime({ offset: true }),
  validUntil: z.string().datetime({ offset: true }).nullable(),
  maxUses: z.number().int().min(1).max(1_000_000).nullable(),
  perOfficeLimit: z.number().int().min(1).max(1_000_000).nullable(),
  visibility: z.enum(["public", "hidden"]),
  active: z.boolean(),
  reason: z.string().trim().min(8).max(500),
};
function withCouponRefines<T extends z.ZodRawShape>(shape: T) {
  return z
    .object(shape)
    .strict()
    .refine((v: any) => v.discountKind !== "percent" || v.discountValue <= 100, {
      message: "A percentage discount is at most 100.",
    })
    .refine((v: any) => !v.validUntil || Date.parse(v.validUntil) > Date.parse(v.validFrom), {
      message: "The end of the validity window must be after its start.",
    })
    .refine((v: any) => v.planId === null || v.appliesTo !== "topup", {
      message: "A plan-specific coupon cannot apply to top-ups only.",
    });
}
const couponBody = withCouponRefines(couponFields);

async function recordCouponChange(
  db: DB,
  code: string,
  action: "CREATE" | "UPDATE" | "ACTIVE",
  before: any,
  after: any,
  reason: string,
  actorId: string,
) {
  await db.query(
    "INSERT INTO platform_coupon_changes(coupon_code, action, before_state, after_state, reason, changed_by) VALUES($1,$2,$3,$4,$5,$6)",
    [code, action, before ? JSON.stringify(couponState(before)) : null, JSON.stringify(couponState(after)), reason, actorId],
  );
}
async function withCouponTx<T>(fn: (db: DB) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client as unknown as DB);
    await client.query("COMMIT");
    return out;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
async function loadCoupon(db: DB, code: string, lock = false) {
  const row = (
    await db.query(`SELECT * FROM platform_coupons WHERE code=$1${lock ? " FOR UPDATE" : ""}`, [code])
  ).rows[0];
  if (!row) fail(404, "COUPON_NOT_FOUND", "Coupon not found. / কুপনটি পাওয়া যায়নি।");
  return row;
}
async function assertPlanExists(db: DB, planId: string | null) {
  if (planId === null) return;
  const found = (await db.query("SELECT 1 FROM subscription_plans WHERE id=$1", [planId])).rowCount;
  if (!found) fail(422, "PLAN_NOT_FOUND", "The named plan does not exist.");
}

/**
 * Validates a coupon for one order and returns the discount in poisha. Called with the
 * order's gross amount inside the order-creation transaction; the caller records the
 * redemption (recordCouponRedemption) once the order row exists. Every rejection is a
 * bilingual 422 so the office sees why the code did not apply.
 */
export async function platformCouponDiscount(
  db: DB,
  input: { code: string; tenantId: string; kind: "topup" | "subscription"; planId: string | null; amountMinor: number },
): Promise<number> {
  const coupon = (
    await db.query("SELECT * FROM platform_coupons WHERE code=$1 FOR UPDATE", [input.code])
  ).rows[0];
  if (!coupon) fail(422, "COUPON_INVALID", "This coupon code is not valid. / এই কুপন কোডটি বৈধ নয়।");
  if (!coupon.active)
    fail(422, "COUPON_INACTIVE", "This coupon is switched off. / এই কুপনটি বন্ধ রাখা হয়েছে।");
  const now = new Date();
  if (coupon.valid_from > now)
    fail(422, "COUPON_NOT_YET_VALID", "This coupon is not valid yet. / এই কুপনটি এখনো কার্যকর হয়নি।");
  if (coupon.valid_until && coupon.valid_until <= now)
    fail(422, "COUPON_EXPIRED", "This coupon has expired. / এই কুপনটির মেয়াদ শেষ হয়ে গেছে।");
  if (coupon.applies_to !== "both" && coupon.applies_to !== input.kind)
    fail(
      422,
      "COUPON_NOT_APPLICABLE",
      "This coupon does not apply to this kind of order. / এই কুপনটি এই ধরনের অর্ডারের জন্য প্রযোজ্য নয়।",
    );
  if (coupon.plan_id && coupon.plan_id !== input.planId)
    fail(
      422,
      "COUPON_NOT_APPLICABLE",
      "This coupon applies to a different plan. / এই কুপনটি অন্য একটি প্ল্যানের জন্য প্রযোজ্য।",
    );
  if (coupon.max_uses !== null) {
    const total = (
      await db.query("SELECT count(*)::int AS n FROM platform_coupon_redemptions WHERE coupon_code=$1", [input.code])
    ).rows[0].n;
    if (total >= coupon.max_uses)
      fail(422, "COUPON_LIMIT_REACHED", "This coupon has reached its total usage limit. / এই কুপনটির মোট ব্যবহারের সীমা শেষ হয়ে গেছে।");
  }
  if (coupon.per_office_limit !== null) {
    const mine = (
      await db.query(
        "SELECT count(*)::int AS n FROM platform_coupon_redemptions WHERE coupon_code=$1 AND tenant_id=$2",
        [input.code, input.tenantId],
      )
    ).rows[0].n;
    if (mine >= coupon.per_office_limit)
      fail(
        422,
        "COUPON_OFFICE_LIMIT_REACHED",
        "Your office has reached this coupon's per-office limit. / আপনার অফিস এই কুপনের অফিসপ্রতি সীমায় পৌঁছে গেছে।",
      );
  }
  const discount =
    coupon.discount_kind === "percent"
      ? Math.floor((input.amountMinor * coupon.discount_value) / 100)
      : Math.min(coupon.discount_value, input.amountMinor);
  // A coupon never pushes a price below 0 (the maths above cannot), and a code that
  // would discount nothing — a top-up order carries no payable amount in this system,
  // or a percentage that rounds to zero — is refused rather than silently burning a use.
  if (discount <= 0)
    fail(
      422,
      "COUPON_NOT_APPLICABLE",
      "This coupon gives no discount on this order. / এই অর্ডারে এই কুপনে কোনো ছাড় পাওয়া যাবে না।",
    );
  return discount;
}

/** Records the redemption of a coupon on its order (append-only; §3.7 audit data). */
export async function recordCouponRedemption(
  db: DB,
  input: { code: string; tenantId: string; orderId: string; discountMinor: number; actorId: string },
) {
  await db.query(
    "INSERT INTO platform_coupon_redemptions(coupon_code, tenant_id, order_id, discount_minor, redeemed_by) VALUES($1,$2,$3,$4,$5)",
    [input.code, input.tenantId, input.orderId, input.discountMinor, input.actorId],
  );
}

export const couponsRouter = express.Router();

/** Owner: every platform coupon with its redemption totals. */
couponsRouter.get(
  "/owner/coupons",
  wrap(async (req, res) => {
    role(req, ["owner"]);
    const rows = (
      await pool.query(
        `SELECT c.*, (SELECT count(*)::int FROM platform_coupon_redemptions r WHERE r.coupon_code=c.code) AS redemptions,
                (SELECT coalesce(sum(discount_minor),0)::int FROM platform_coupon_redemptions r WHERE r.coupon_code=c.code) AS discount_total_minor
         FROM platform_coupons c ORDER BY c.created_at DESC, c.code`,
      )
    ).rows;
    res.json({ items: rows.map(couponRow) });
  }),
);
/** Owner: create a coupon. The code is stored upper-case and matched case-insensitively. */
couponsRouter.post(
  "/owner/coupons",
  wrap(async (req, res) => {
    const a = role(req, ["owner"]);
    const d = withCouponRefines({ code: platformCouponCode, ...couponFields }).parse(req.body);
    const coupon = await withCouponTx(async (db) => {
      await assertPlanExists(db, d.planId);
      if ((await db.query("SELECT 1 FROM platform_coupons WHERE code=$1", [d.code])).rowCount)
        fail(409, "COUPON_EXISTS", "A coupon with this code already exists.");
      const row = (
        await db.query(
          `INSERT INTO platform_coupons(code, discount_kind, discount_value, applies_to, plan_id, valid_from, valid_until, max_uses, per_office_limit, visibility, active, created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
          [d.code, d.discountKind, d.discountValue, d.appliesTo, d.planId, d.validFrom, d.validUntil, d.maxUses, d.perOfficeLimit, d.visibility, d.active, a.userId],
        )
      ).rows[0];
      await recordCouponChange(db, row.code, "CREATE", null, row, d.reason, a.userId);
      return row;
    });
    res.status(201).json({ coupon: couponRow(coupon) });
  }),
);
/** Owner: edit a coupon's terms. Past redemptions keep the discount they were given. */
couponsRouter.put(
  "/owner/coupons/:code",
  wrap(async (req, res) => {
    const a = role(req, ["owner"]);
    const code = platformCouponCode.parse(req.params.code);
    const d = couponBody.parse(req.body);
    const coupon = await withCouponTx(async (db) => {
      const before = await loadCoupon(db, code, true);
      await assertPlanExists(db, d.planId);
      const row = (
        await db.query(
          `UPDATE platform_coupons SET discount_kind=$2, discount_value=$3, applies_to=$4, plan_id=$5, valid_from=$6, valid_until=$7,
                  max_uses=$8, per_office_limit=$9, visibility=$10, active=$11, updated_at=now()
           WHERE code=$1 RETURNING *`,
          [code, d.discountKind, d.discountValue, d.appliesTo, d.planId, d.validFrom, d.validUntil, d.maxUses, d.perOfficeLimit, d.visibility, d.active],
        )
      ).rows[0];
      await recordCouponChange(db, code, "UPDATE", before, row, d.reason, a.userId);
      return row;
    });
    res.json({ coupon: couponRow(coupon) });
  }),
);
/** Owner: switch a coupon on or off without touching its terms. */
couponsRouter.post(
  "/owner/coupons/:code/active",
  wrap(async (req, res) => {
    const a = role(req, ["owner"]);
    const code = platformCouponCode.parse(req.params.code);
    const d = z
      .object({ active: z.boolean(), reason: couponFields.reason })
      .strict()
      .parse(req.body);
    const coupon = await withCouponTx(async (db) => {
      const before = await loadCoupon(db, code, true);
      const row = (
        await db.query("UPDATE platform_coupons SET active=$2, updated_at=now() WHERE code=$1 RETURNING *", [code, d.active])
      ).rows[0];
      await recordCouponChange(db, code, "ACTIVE", before, row, d.reason, a.userId);
      return row;
    });
    res.json({ coupon: couponRow(coupon) });
  }),
);
/** Owner: the audit history of one coupon, newest first. */
couponsRouter.get(
  "/owner/coupons/:code/changes",
  wrap(async (req, res) => {
    role(req, ["owner"]);
    const code = platformCouponCode.parse(req.params.code);
    await loadCoupon(pool as unknown as DB, code);
    const rows = (
      await pool.query(
        "SELECT action, before_state, after_state, reason, changed_by, created_at FROM platform_coupon_changes WHERE coupon_code=$1 ORDER BY created_at DESC, id DESC",
        [code],
      )
    ).rows;
    res.json({
      code,
      items: rows.map((r) => ({
        action: r.action,
        before: r.before_state,
        after: r.after_state,
        reason: r.reason,
        changedBy: r.changed_by,
        createdAt: r.created_at,
      })),
    });
  }),
);
/** Owner: recent redemptions across offices — the §3.7 audit/revenue view of coupon use. */
couponsRouter.get(
  "/owner/coupon-redemptions",
  wrap(async (req, res) => {
    role(req, ["owner"]);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const rows = (
      await pool.query(
        `SELECT r.coupon_code, r.tenant_id, t.slug AS office_slug, t.name_en AS office_name_en, r.order_id,
                r.discount_minor, r.redeemed_by, r.created_at
         FROM platform_coupon_redemptions r JOIN tenants t ON t.id=r.tenant_id
         ORDER BY r.created_at DESC, r.id DESC LIMIT $1`,
        [limit],
      )
    ).rows;
    res.json({
      items: rows.map((r) => ({
        couponCode: r.coupon_code,
        tenantId: r.tenant_id,
        officeSlug: r.office_slug,
        officeNameEn: r.office_name_en,
        orderId: r.order_id,
        discountMinor: r.discount_minor,
        redeemedBy: r.redeemed_by,
        createdAt: r.created_at,
      })),
    });
  }),
);

/** Public: the coupons the owner chose to show on the portal (active and in their window). */
export const publicCouponsRouter = express.Router();
publicCouponsRouter.get(
  "/public/coupons",
  wrap(async (_req, res) => {
    const rows = (
      await pool.query(
        `SELECT code, discount_kind, discount_value, applies_to, plan_id, valid_from, valid_until
         FROM platform_coupons
         WHERE visibility='public' AND active AND valid_from <= now() AND (valid_until IS NULL OR valid_until > now())
         ORDER BY valid_from DESC, code`,
      )
    ).rows;
    res.json({
      items: rows.map((r) => ({
        code: r.code,
        discountKind: r.discount_kind,
        discountValue: r.discount_value,
        appliesTo: r.applies_to,
        planId: r.plan_id ?? null,
        validFrom: r.valid_from,
        validUntil: r.valid_until ?? null,
      })),
    });
  }),
);
