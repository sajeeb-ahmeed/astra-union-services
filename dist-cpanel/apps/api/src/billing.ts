import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool, type DB } from "./db.js";
import { fail } from "./models.js";
import type { Auth } from "./app.js";

/**
 * Phase 3B: per-service credit pricing + the charge at final submit.
 *
 * Credit is the platform's single currency (the points wallet's issuance spend path is retired;
 * point balances stay readable in points.ts). The only chargeable moment is an application's
 * FIRST successful submit, settled inside the submit transaction by settleApplicationFee():
 *   1. an ACTIVE subscription covers the submit — one monthly allowance unit is consumed
 *      (Phase 3C: the limit is the one snapshotted on the subscription at activation, so a
 *      later plan edit never rewrites a running period; once the month's allowance is used
 *      up, the submit falls back to the per-service charge below);
 *   2. otherwise the service's current credit price is debited from the payer the owner chose
 *      in the billing settings (office wallet by default; citizen-pays has no payment rail
 *      until Phase 7, so it leaves the application a draft with a bilingual reason);
 *   3. an insufficient office balance likewise leaves the application a draft — the submit
 *      transaction rolls back, nothing is charged and no work is lost.
 * The settlement is recorded on the application itself (fee_*), so a rejection followed by an
 * edit and a resubmit of the SAME application never charges or consumes again.
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
const serviceNumber = z.coerce.number().int().min(1).max(47);

/** The price of a service with no owner-published price yet (billing plan §3.2: default 1). */
export const DEFAULT_CREDIT_PRICE = 1;

/** The service's current owner-set credit price; version 0 means the default is in force. */
export async function currentCreditPrice(db: DB, serviceNo: number) {
  const row = (
    await db.query(
      "SELECT version, price_credits FROM service_credit_prices WHERE service_no=$1 ORDER BY version DESC LIMIT 1",
      [serviceNo],
    )
  ).rows[0];
  return {
    price: (row?.price_credits ?? DEFAULT_CREDIT_PRICE) as number,
    version: (row?.version ?? 0) as number,
  };
}

/** Who pays the application fee — an owner dashboard setting, switchable at any time. */
export async function applicationFeePayer(db: DB): Promise<"office" | "citizen"> {
  const row = (
    await db.query("SELECT value FROM platform_settings WHERE key='application_fee_payer'")
  ).rows[0];
  return row?.value === "citizen" ? "citizen" : "office";
}

/** Allowance units the office has consumed in the current (UTC) month. */
export async function allowanceUsedThisMonth(db: DB, tenantId: string) {
  const row = (
    await db.query(
      "SELECT count(*)::int AS n FROM subscription_allowance_consumptions WHERE tenant_id=$1 AND period_month=(date_trunc('month', now()))::date",
      [tenantId],
    )
  ).rows[0];
  return row.n as number;
}

export type FeeSettlement = {
  method: "CREDIT" | "ALLOWANCE" | "FREE";
  credits: number;
  priceVersion: number;
};

async function markSettled(
  db: DB,
  applicationId: string,
  settlement: FeeSettlement,
) {
  await db.query(
    "UPDATE applications SET fee_settled_at=now(), fee_method=$2, fee_credits=$3, fee_price_version=$4 WHERE id=$1",
    [applicationId, settlement.method, settlement.credits, settlement.priceVersion],
  );
  return settlement;
}

/**
 * Settles the fee for an application's first successful submit, inside the caller's
 * transaction. `application` is the locked application row. Throws 402 (rolling the submit
 * back to a draft) when the fee cannot be taken; otherwise records the settlement on the
 * application and returns it. Calling it for an already-settled application is a no-op
 * that returns the recorded settlement — the once-per-application rule.
 */
export async function settleApplicationFee(
  db: DB,
  tenantId: string,
  application: {
    id: string;
    service_no: number;
    fee_settled_at: Date | string | null;
    fee_method: string | null;
    fee_credits: number | null;
    fee_price_version: number | null;
  },
  actorId: string,
): Promise<FeeSettlement> {
  if (application.fee_settled_at)
    return {
      method: application.fee_method as FeeSettlement["method"],
      credits: application.fee_credits ?? 0,
      priceVersion: application.fee_price_version ?? 0,
    };
  const { price, version } = await currentCreditPrice(db, application.service_no);
  const subscription = (
    await db.query(
      "SELECT tenant_id, plan_allowance_limit FROM tenant_subscriptions WHERE tenant_id=$1 AND status='ACTIVE' AND valid_until>now() FOR UPDATE",
      [tenantId],
    )
  ).rows[0];
  if (subscription) {
    // The plan covers this submit while the month's allowance lasts. The limit is the one
    // snapshotted on the subscription at activation/settlement (Phase 3C) — never the plan
    // row's current value — and the subscription row is locked FOR UPDATE above, so the
    // count-then-consume sequence cannot race a concurrent submit. The allowance counts
    // submitted applications in the current calendar month (the period_month bucket).
    const limit = subscription.plan_allowance_limit as number | null;
    const withinAllowance =
      limit == null || (await allowanceUsedThisMonth(db, tenantId)) < limit;
    if (withinAllowance) {
      await db.query(
        "INSERT INTO subscription_allowance_consumptions(tenant_id, application_id, period_month) VALUES($1,$2,(date_trunc('month', now()))::date) ON CONFLICT (tenant_id, application_id) DO NOTHING",
        [tenantId, application.id],
      );
      return markSettled(db, application.id, { method: "ALLOWANCE", credits: 0, priceVersion: version });
    }
    // Allowance exhausted for this month: fall through to the per-service credit charge,
    // exactly as if the office had no subscription (and to a draft if the payer cannot pay).
  }
  if (price === 0)
    return markSettled(db, application.id, { method: "FREE", credits: 0, priceVersion: version });
  if ((await applicationFeePayer(db)) === "citizen")
    fail(
      402,
      "CITIZEN_PAYMENT_UNAVAILABLE",
      "Citizen payment is not available yet, so this application stays a draft. / নাগরিকের মাধ্যমে ফি পরিশোধের সুবিধা এখনো চালু হয়নি, তাই আবেদনটি খসড়া হিসেবেই থাকবে।",
    );
  const wallet = (
    await db.query("SELECT balance FROM lock_tenant_wallet()")
  ).rows[0];
  if (!wallet || wallet.balance < price)
    fail(
      402,
      "APPLICATION_FEE_INSUFFICIENT",
      `Insufficient office credit for this application fee: ${price} credit${price === 1 ? "" : "s"} needed, ${wallet?.balance ?? 0} available. The application stays a draft. / এই আবেদনের ফি দেওয়ার জন্য অফিসের ক্রেডিট যথেষ্ট নয়: প্রয়োজন ${price} ক্রেডিট, আছে ${wallet?.balance ?? 0}। আবেদনটি খসড়া হিসেবেই থাকবে।`,
    );
  await db.query(
    "INSERT INTO credit_ledger(tenant_id, delta, kind, idempotency_key, application_id, actor_id, reason, balance_after) VALUES($1,$2,'APPLICATION_FEE',$3,$4,$5,'Application submission fee',0)",
    [tenantId, -price, `application-fee:${application.id}`, application.id, actorId],
  );
  return markSettled(db, application.id, { method: "CREDIT", credits: price, priceVersion: version });
}

export const billingRouter = express.Router();

const priceRow = (r: any) => ({
  serviceNo: r.service_no,
  nameBn: r.name_bn,
  nameEn: r.name_en,
  version: r.version ?? 0,
  priceCredits: r.price_credits ?? DEFAULT_CREDIT_PRICE,
  isDefault: r.version == null,
  updatedAt: r.created_at ?? null,
});

/** Owner: the current credit price of every service (default 1 where unpublished). */
billingRouter.get(
  "/owner/credit-prices",
  wrap(async (req, res) => {
    role(req, ["owner"]);
    const rows = (
      await pool.query(
        `SELECT s.service_no, s.name_bn, s.name_en, p.version, p.price_credits, p.created_at
         FROM service_catalog s LEFT JOIN LATERAL (SELECT * FROM service_credit_prices x WHERE x.service_no=s.service_no ORDER BY x.version DESC LIMIT 1) p ON true
         ORDER BY s.service_no`,
      )
    ).rows;
    res.json({ items: rows.map(priceRow) });
  }),
);
/**
 * Owner: publish a new credit-price version for one service. Versions are never edited, and
 * each records who set it, when and why — the price table is its own audit trail (the
 * point-price pattern, carried onto the single currency).
 */
billingRouter.post(
  "/owner/credit-prices/:no",
  wrap(async (req, res) => {
    const a = role(req, ["owner"]);
    const serviceNo = serviceNumber.parse(req.params.no);
    const d = z
      .object({
        expectedVersion: z.number().int().min(0).max(2147483646),
        priceCredits: z.number().int().min(0).max(10000),
        reason: z.string().trim().min(3).max(500),
      })
      .strict()
      .parse(req.body);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('service_credit_prices'), $1)", [serviceNo]);
      const current = (
        await client.query("SELECT coalesce(max(version),0)::int v FROM service_credit_prices WHERE service_no=$1", [serviceNo])
      ).rows[0].v;
      if (current !== d.expectedVersion)
        fail(409, "CREDIT_PRICE_STALE", "The price changed. Reload the current version before publishing.");
      const row = (
        await client.query(
          "INSERT INTO service_credit_prices(service_no, version, price_credits, reason, created_by) VALUES($1,$2,$3,$4,$5) RETURNING *",
          [serviceNo, current + 1, d.priceCredits, d.reason, a.userId],
        )
      ).rows[0];
      await client.query("COMMIT");
      res.status(201).json({ serviceNo, version: row.version, priceCredits: row.price_credits });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);
/** Owner: the full published price history of one service, newest first. */
billingRouter.get(
  "/owner/credit-prices/:no/versions",
  wrap(async (req, res) => {
    role(req, ["owner"]);
    const serviceNo = serviceNumber.parse(req.params.no);
    const rows = (
      await pool.query(
        "SELECT version, price_credits, reason, created_by, created_at FROM service_credit_prices WHERE service_no=$1 ORDER BY version DESC",
        [serviceNo],
      )
    ).rows;
    res.json({
      serviceNo,
      items: rows.map((r) => ({
        version: r.version,
        priceCredits: r.price_credits,
        reason: r.reason,
        createdBy: r.created_by,
        createdAt: r.created_at,
      })),
    });
  }),
);
/** Owner: the platform billing settings (who pays the application fee). */
billingRouter.get(
  "/owner/billing-settings",
  wrap(async (req, res) => {
    role(req, ["owner"]);
    const row = (
      await pool.query("SELECT value, updated_by, updated_at FROM platform_settings WHERE key='application_fee_payer'")
    ).rows[0];
    res.json({
      applicationFeePayer: row?.value === "citizen" ? "citizen" : "office",
      updatedBy: row?.updated_by ?? null,
      updatedAt: row?.updated_at ?? null,
    });
  }),
);
billingRouter.put(
  "/owner/billing-settings",
  wrap(async (req, res) => {
    const a = role(req, ["owner"]);
    const d = z
      .object({
        applicationFeePayer: z.enum(["office", "citizen"]),
        reason: z.string().trim().min(8).max(500),
      })
      .strict()
      .parse(req.body);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO platform_settings(key, value, updated_by, updated_at) VALUES('application_fee_payer',$1,$2,now())
         ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()`,
        [d.applicationFeePayer, a.userId],
      );
      // audit_events is tenant-scoped by RLS, so platform changes keep their own history.
      await client.query(
        "INSERT INTO platform_setting_changes(key, value, reason, changed_by) VALUES('application_fee_payer',$1,$2,$3)",
        [d.applicationFeePayer, d.reason, a.userId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    res.json({ applicationFeePayer: d.applicationFeePayer });
  }),
);

/**
 * Phase 3C: the owner-managed subscription plan catalogue. Plans were seed data in 3A/3B;
 * now the owner creates, edits and retires them from the dashboard with no code change.
 * Every mutation demands a reason and lands in subscription_plan_changes with the
 * before/after state (audit_events is tenant-scoped by RLS, so platform-level owner
 * actions keep their own history — the platform_setting_changes pattern). Editing a plan
 * never rewrites a running subscription: activation snapshots the terms onto
 * tenant_subscriptions, and the allowance limit is enforced from that snapshot.
 */
const planRow = (r: any) => ({
  id: r.id,
  name: r.name,
  priceMinor: r.price_minor,
  currency: r.currency,
  grantCredits: r.grant_credits,
  durationDays: r.duration_days,
  rollover: r.rollover,
  monthlyAllowanceLimit: r.monthly_allowance_limit ?? null,
  onSale: r.on_sale,
  sortOrder: r.sort_order,
});
const planState = (r: any) => ({
  name: r.name,
  priceMinor: r.price_minor,
  grantCredits: r.grant_credits,
  durationDays: r.duration_days,
  rollover: r.rollover,
  monthlyAllowanceLimit: r.monthly_allowance_limit ?? null,
  onSale: r.on_sale,
  sortOrder: r.sort_order,
});
const planFields = {
  name: z.string().trim().min(1).max(120),
  durationDays: z.number().int().min(1).max(3650),
  priceMinor: z.number().int().min(0).max(100_000_000),
  grantCredits: z.number().int().min(1).max(100_000),
  monthlyAllowanceLimit: z.number().int().min(1).max(100_000).nullable(),
  onSale: z.boolean(),
  sortOrder: z.number().int().min(-10_000).max(10_000),
  rollover: z.boolean(),
  reason: z.string().trim().min(8).max(500),
};
async function recordPlanChange(
  db: DB,
  planId: string,
  action: "CREATE" | "UPDATE" | "ON_SALE",
  before: any,
  after: any,
  reason: string,
  actorId: string,
) {
  await db.query(
    "INSERT INTO subscription_plan_changes(plan_id, action, before_state, after_state, reason, changed_by) VALUES($1,$2,$3,$4,$5,$6)",
    [
      planId,
      action,
      before ? JSON.stringify(planState(before)) : null,
      JSON.stringify(planState(after)),
      reason,
      actorId,
    ],
  );
}
async function withPlanTx<T>(fn: (db: DB) => Promise<T>): Promise<T> {
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
/** Owner: the whole plan catalogue, hidden plans included, in display order. */
billingRouter.get(
  "/owner/plans",
  wrap(async (req, res) => {
    role(req, ["owner"]);
    const rows = (
      await pool.query("SELECT * FROM subscription_plans ORDER BY sort_order, id")
    ).rows;
    res.json({ items: rows.map(planRow) });
  }),
);
/** Owner: create a plan. The id is an optional slug; when omitted it is derived from the name. */
billingRouter.post(
  "/owner/plans",
  wrap(async (req, res) => {
    const a = role(req, ["owner"]);
    const d = z
      .object({
        id: z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]{1,49}$/, "Plan id must be a lowercase slug.")
          .optional(),
        ...planFields,
        onSale: planFields.onSale.default(true),
        sortOrder: planFields.sortOrder.default(0),
        rollover: planFields.rollover.default(true),
      })
      .strict()
      .parse(req.body);
    const plan = await withPlanTx(async (db) => {
      let id = d.id;
      if (!id) {
        const base =
          d.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 44) || "plan";
        id = base;
        for (
          let attempt = 0;
          (await db.query("SELECT 1 FROM subscription_plans WHERE id=$1", [id])).rows.length &&
          attempt < 5;
          attempt++
        )
          id = `${base}-${randomUUID().slice(0, 4)}`;
      }
      if ((await db.query("SELECT 1 FROM subscription_plans WHERE id=$1", [id])).rows.length)
        fail(409, "PLAN_ID_TAKEN", "A plan with this id already exists.");
      const row = (
        await db.query(
          "INSERT INTO subscription_plans(id, name, price_minor, currency, grant_credits, duration_days, rollover, monthly_allowance_limit, on_sale, sort_order) VALUES($1,$2,$3,'BDT',$4,$5,$6,$7,$8,$9) RETURNING *",
          [id, d.name, d.priceMinor, d.grantCredits, d.durationDays, d.rollover, d.monthlyAllowanceLimit, d.onSale, d.sortOrder],
        )
      ).rows[0];
      await recordPlanChange(db, row.id, "CREATE", null, row, d.reason, a.userId);
      return row;
    });
    res.status(201).json({ plan: planRow(plan) });
  }),
);
/** Owner: edit a plan's catalogue fields. Running subscriptions keep their snapshotted terms. */
billingRouter.put(
  "/owner/plans/:id",
  wrap(async (req, res) => {
    const a = role(req, ["owner"]);
    const d = z.object({ ...planFields }).strict().parse(req.body);
    const plan = await withPlanTx(async (db) => {
      const before = (
        await db.query("SELECT * FROM subscription_plans WHERE id=$1 FOR UPDATE", [req.params.id])
      ).rows[0];
      if (!before) fail(404, "PLAN_NOT_FOUND", "Plan not found.");
      const row = (
        await db.query(
          "UPDATE subscription_plans SET name=$2, price_minor=$3, grant_credits=$4, duration_days=$5, rollover=$6, monthly_allowance_limit=$7, on_sale=$8, sort_order=$9 WHERE id=$1 RETURNING *",
          [req.params.id, d.name, d.priceMinor, d.grantCredits, d.durationDays, d.rollover, d.monthlyAllowanceLimit, d.onSale, d.sortOrder],
        )
      ).rows[0];
      await recordPlanChange(db, row.id, "UPDATE", before, row, d.reason, a.userId);
      return row;
    });
    res.json({ plan: planRow(plan) });
  }),
);
/** Owner: put a plan on sale or hide it. Hidden plans reject new orders; existing subscriptions are unaffected. */
billingRouter.post(
  "/owner/plans/:id/on-sale",
  wrap(async (req, res) => {
    const a = role(req, ["owner"]);
    const d = z
      .object({ onSale: z.boolean(), reason: planFields.reason })
      .strict()
      .parse(req.body);
    const plan = await withPlanTx(async (db) => {
      const before = (
        await db.query("SELECT * FROM subscription_plans WHERE id=$1 FOR UPDATE", [req.params.id])
      ).rows[0];
      if (!before) fail(404, "PLAN_NOT_FOUND", "Plan not found.");
      const row = (
        await db.query("UPDATE subscription_plans SET on_sale=$2 WHERE id=$1 RETURNING *", [
          req.params.id,
          d.onSale,
        ])
      ).rows[0];
      await recordPlanChange(db, row.id, "ON_SALE", before, row, d.reason, a.userId);
      return row;
    });
    res.json({ plan: planRow(plan) });
  }),
);
/**
 * Phase 3D: platform branding (billing plan §3.9 "branding basics") + the platform
 * settings change history that backs the owner dashboard's Audit section.
 *
 * The display name and taglines live in platform_settings — the same store as the
 * application-fee payer — so they follow the same rules: owner-only writes, a
 * mandatory reason, and one append-only platform_setting_changes row per changed
 * key. Nothing is seeded: a key that was never set falls back to the built-in
 * default below, which is exactly the wording the shells hard-coded before 3D,
 * so an untouched platform renders identically.
 */
export const BRANDING_DEFAULTS = {
  name: "DigitalUnion",
  taglineBn: "স্মার্ট ইউনিয়ন, স্মার্ট বাংলাদেশ",
  taglineEn: "Smart Union, Smart Bangladesh",
} as const;
const BRANDING_FIELDS = [
  ["name", "platform_name"],
  ["taglineBn", "platform_tagline_bn"],
  ["taglineEn", "platform_tagline_en"],
] as const;
export type PlatformBranding = { name: string; taglineBn: string; taglineEn: string };

/** The platform's current branding: stored values where the owner set them, defaults elsewhere. */
export async function platformBranding(db: DB): Promise<PlatformBranding> {
  const rows = (
    await db.query("SELECT key, value FROM platform_settings WHERE key = ANY($1)", [
      BRANDING_FIELDS.map(([, key]) => key),
    ])
  ).rows;
  const stored = new Map(rows.map((r) => [r.key as string, r.value as string]));
  return {
    name: stored.get("platform_name") ?? BRANDING_DEFAULTS.name,
    taglineBn: stored.get("platform_tagline_bn") ?? BRANDING_DEFAULTS.taglineBn,
    taglineEn: stored.get("platform_tagline_en") ?? BRANDING_DEFAULTS.taglineEn,
  };
}

/** Public: the branding the shells render. Mounted before the session gate (see app.ts). */
export const brandingRouter = express.Router();
brandingRouter.get(
  "/branding",
  wrap(async (_req, res) => {
    res.json(await platformBranding(pool as unknown as DB));
  }),
);

/** Owner: the current branding (stored values with defaults applied). */
billingRouter.get(
  "/owner/branding",
  wrap(async (req, res) => {
    role(req, ["owner"]);
    res.json(await platformBranding(pool as unknown as DB));
  }),
);
/** Owner: replace the branding. Only keys whose value actually changes are written, and each changed key gets its own history row. */
billingRouter.put(
  "/owner/branding",
  wrap(async (req, res) => {
    const a = role(req, ["owner"]);
    const d = z
      .object({
        name: z.string().trim().min(1).max(80),
        taglineBn: z.string().trim().min(1).max(200),
        taglineEn: z.string().trim().min(1).max(200),
        reason: z.string().trim().min(8).max(500),
      })
      .strict()
      .parse(req.body);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('platform_branding'))");
      const db = client as unknown as DB;
      const current = await platformBranding(db);
      for (const [field, key] of BRANDING_FIELDS) {
        if (d[field] === current[field]) continue;
        await client.query(
          `INSERT INTO platform_settings(key, value, updated_by, updated_at) VALUES($1,$2,$3,now())
           ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()`,
          [key, d[field], a.userId],
        );
        await client.query(
          "INSERT INTO platform_setting_changes(key, value, reason, changed_by) VALUES($1,$2,$3,$4)",
          [key, d[field], d.reason, a.userId],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    res.json(await platformBranding(pool as unknown as DB));
  }),
);
/** Owner: the platform settings change history (payer + branding), newest first — the Audit section's data. */
billingRouter.get(
  "/owner/setting-changes",
  wrap(async (req, res) => {
    role(req, ["owner"]);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const rows = (
      await pool.query(
        "SELECT key, value, reason, changed_by, created_at FROM platform_setting_changes ORDER BY created_at DESC, id DESC LIMIT $1",
        [limit],
      )
    ).rows;
    res.json({
      items: rows.map((r) => ({
        key: r.key,
        value: r.value,
        reason: r.reason,
        changedBy: r.changed_by,
        createdAt: r.created_at,
      })),
    });
  }),
);

/** Owner: the audit history of one plan, newest first. */
billingRouter.get(
  "/owner/plans/:id/changes",
  wrap(async (req, res) => {
    role(req, ["owner"]);
    const plan = (
      await pool.query("SELECT id FROM subscription_plans WHERE id=$1", [req.params.id])
    ).rows[0];
    if (!plan) fail(404, "PLAN_NOT_FOUND", "Plan not found.");
    const rows = (
      await pool.query(
        "SELECT action, before_state, after_state, reason, changed_by, created_at FROM subscription_plan_changes WHERE plan_id=$1 ORDER BY created_at DESC, id DESC",
        [req.params.id],
      )
    ).rows;
    res.json({
      planId: req.params.id,
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
