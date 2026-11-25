import express from "express";
import { z } from "zod";
import { transaction, audit, type DB } from "./db.js";
import { fail } from "./models.js";
import type { Auth } from "./app.js";
import { applicationPaymentState } from "./payments.js";

// W-024: "bilingual" is a legitimate order language — the form schema
// offers bn / en / bilingual for delivery_language, and issuance always
// renders both language versions under one number (CERTNO-01), so the
// order preference must be able to record "both languages" instead of
// forcing the citizen back to bn or en at the fees step.
const certificateLanguage = z.enum(["bn", "en", "bilingual"]);
const deliveryMode = z.enum(["office_collection", "digital_copy"]);
const urgency = z.enum(["normal", "urgent"]);
const money = z.number().int().min(0).max(100000000);
export const orderPreferencesInput = z
  .object({
    addressBasis: z.literal("registered_profile"),
    certificateLanguage,
    deliveryMode,
    urgency,
  })
  .strict();
// Phase 4b: coupon codes are matched case-insensitively and stored upper-case.
const couponCode = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9-]{2,31}$/));
export const applicationOrderInput = z
  .object({
    policyVersion: z.number().int().min(1).max(2147483647),
    preferences: orderPreferencesInput,
    couponCode: couponCode.optional(),
  })
  .strict();
type Preferences = z.infer<typeof orderPreferencesInput>;
type OrderInput = z.infer<typeof applicationOrderInput>;
const policyInput = z
  .object({
    expectedVersion: z.number().int().min(0).max(2147483646),
    reason: z.string().trim().min(3).max(500),
    statutoryFeeMinor: money,
    processingFeeMinor: money,
    emergencySurchargeMinor: money,
    deliveryFeesMinor: z
      .object({ office_collection: money, digital_copy: money })
      .strict(),
    deliveryModes: z
      .array(deliveryMode)
      .min(1)
      .max(2)
      .refine((items) => new Set(items).size === items.length),
    urgencies: z
      .array(urgency)
      .min(1)
      .max(2)
      .refine((items) => new Set(items).size === items.length),
    // Phase 4a: citizen-charter delivery time in days; null when the office does not state one.
    charterDays: z.number().int().min(1).max(365).nullable().optional(),
    // Phase 6: citizen-facing required documents as bilingual pairs; an empty list states none.
    requiredDocuments: z
      .array(
        z
          .object({
            bn: z.string().trim().min(1).max(200),
            en: z.string().trim().min(1).max(200),
          })
          .strict(),
      )
      .max(20)
      .optional(),
  })
  .strict();

function policyRow(row: any) {
  return {
    version: row.version,
    statutoryFeeMinor: row.statutory_fee_minor,
    processingFeeMinor: row.processing_fee_minor,
    emergencySurchargeMinor: row.emergency_surcharge_minor,
    deliveryFeesMinor: {
      office_collection: row.office_collection_fee_minor,
      digital_copy: row.digital_copy_fee_minor,
    },
    deliveryModes: row.delivery_modes as string[],
    urgencies: row.urgencies as string[],
    charterDays: (row.charter_days ?? null) as number | null,
    requiredDocuments: (row.required_documents ?? []) as Array<{
      bn: string;
      en: string;
    }>,
    currency: "BDT" as const,
  };
}
async function currentPolicy(db: DB, tenantId: string, serviceNo: number) {
  return (
    await db.query(
      "SELECT * FROM service_order_policies WHERE tenant_id=$1 AND service_no=$2 ORDER BY version DESC LIMIT 1",
      [tenantId, serviceNo],
    )
  ).rows[0];
}
/**
 * Phase 4b: the discount a coupon gives on a gross amount, computed by the database function that also checks
 * every stored snapshot. With `lock`, the coupon row is locked so concurrent redemptions respect the limit.
 */
async function couponDiscount(
  db: DB,
  tenantId: string,
  code: string,
  serviceNo: number,
  gross: number,
  lock = false,
) {
  const coupon = (
    await db.query(
      `SELECT code FROM coupon_codes WHERE tenant_id=$1 AND code=$2${lock ? " FOR UPDATE" : ""}`,
      [tenantId, code],
    )
  ).rows[0];
  const discount = coupon
    ? (
        await db.query("SELECT coupon_discount($1,$2,$3,$4) AS d", [
          tenantId,
          code,
          serviceNo,
          gross,
        ])
      ).rows[0].d
    : null;
  if (discount === null)
    fail(
      422,
      "COUPON_INVALID",
      "This coupon code is not valid for this service now. Check the code, its dates and its limit.",
    );
  return discount as number;
}
function quote(
  policy: any,
  preferences: Preferences,
  coupon?: { code: string; discountMinor: number },
) {
  if (
    !policy.delivery_modes.includes(preferences.deliveryMode) ||
    !policy.urgencies.includes(preferences.urgency)
  )
    fail(
      422,
      "ORDER_OPTION_UNAVAILABLE",
      "Choose delivery and urgency options offered by this office policy.",
    );
  const components = [
    {
      code: "statutory_fee",
      amountMinor: policy.statutory_fee_minor as number,
    },
    {
      code: "processing_fee",
      amountMinor: policy.processing_fee_minor as number,
    },
    {
      code: "emergency_surcharge",
      amountMinor:
        preferences.urgency === "urgent"
          ? (policy.emergency_surcharge_minor as number)
          : 0,
    },
    {
      code: "delivery_fee",
      amountMinor: (preferences.deliveryMode === "office_collection"
        ? policy.office_collection_fee_minor
        : policy.digital_copy_fee_minor) as number,
    },
  ];
  const gross = components.reduce((sum, component) => sum + component.amountMinor, 0);
  const discountMinor = coupon?.discountMinor ?? 0;
  return {
    policyVersion: policy.version as number,
    preferences,
    currency: "BDT" as const,
    components: discountMinor
      ? [...components, { code: "coupon_discount", amountMinor: -discountMinor }]
      : components,
    couponCode: coupon?.code ?? null,
    discountMinor,
    grossMinor: gross,
    totalMinor: gross - discountMinor,
    paymentStatus: "NOT_COLLECTED" as const,
  };
}
const grossOf = (policy: any, preferences: Preferences) =>
  quote(policy, preferences).grossMinor;
type Quote = ReturnType<typeof quote>;
function validateLanguage(
  payload: Record<string, unknown>,
  preferences: Preferences,
) {
  if (
    Object.hasOwn(payload, "delivery_language") &&
    payload.delivery_language !== preferences.certificateLanguage
  )
    fail(
      422,
      "ORDER_LANGUAGE_MISMATCH",
      "The service form language must match the application order language.",
    );
}

// Shared configuration locks make quote acceptance atomic with policy publication.
export async function prepareApplicationOrder(
  db: DB,
  tenantId: string,
  serviceNo: number,
  order: OrderInput | undefined,
  payload: Record<string, unknown>,
): Promise<Quote | null> {
  const configured = (
    await db.query(
      "SELECT enabled FROM tenant_service_configuration WHERE tenant_id=$1 AND service_no=$2 FOR SHARE",
      [tenantId, serviceNo],
    )
  ).rows[0];
  if (!configured?.enabled)
    fail(422, "SERVICE_DISABLED", "Service is not enabled for this tenant.");
  const policy = await currentPolicy(db, tenantId, serviceNo);
  if (!policy) {
    if (order)
      fail(
        409,
        "ORDER_POLICY_NOT_CONFIGURED",
        "This office has not configured an application order policy for this service.",
      );
    return null;
  }
  if (!order)
    fail(
      409,
      "ORDER_REQUIRED",
      "Review the current office policy and supply application order preferences.",
    );
  if (order.policyVersion !== policy.version)
    fail(
      409,
      "ORDER_POLICY_STALE",
      "The office policy changed. Review a new quote before continuing.",
    );
  validateLanguage(payload, order.preferences);
  if (!order.couponCode) return quote(policy, order.preferences);
  const discountMinor = await couponDiscount(
    db,
    tenantId,
    order.couponCode,
    serviceNo,
    grossOf(policy, order.preferences),
    true,
  );
  return quote(policy, order.preferences, { code: order.couponCode, discountMinor });
}
export async function saveApplicationOrder(
  db: DB,
  tenantId: string,
  applicationId: string,
  serviceNo: number,
  order: Quote | null,
) {
  if (!order) return;
  await db.query(
    `INSERT INTO application_order_snapshots(tenant_id,application_id,service_no,policy_version,address_basis,certificate_language,delivery_mode,urgency,statutory_fee_minor,processing_fee_minor,emergency_surcharge_minor,delivery_fee_minor,total_minor,currency,coupon_code,discount_minor)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      tenantId,
      applicationId,
      serviceNo,
      order.policyVersion,
      order.preferences.addressBasis,
      order.preferences.certificateLanguage,
      order.preferences.deliveryMode,
      order.preferences.urgency,
      ...order.components
        .filter((component) => component.code !== "coupon_discount")
        .map((component) => component.amountMinor),
      order.totalMinor,
      order.currency,
      order.couponCode,
      order.discountMinor,
    ],
  );
  if (order.couponCode)
    await db.query(
      "INSERT INTO coupon_redemptions(tenant_id,code,application_id,discount_minor) VALUES($1,$2,$3,$4)",
      [tenantId, order.couponCode, applicationId, order.discountMinor],
    );
}
export async function getApplicationOrder(db: DB, applicationId: string) {
  const row = (
    await db.query(
      "SELECT * FROM application_order_snapshots WHERE application_id=$1",
      [applicationId],
    )
  ).rows[0];
  if (!row) return null;
  return {
    applicationId: row.application_id,
    serviceNo: row.service_no,
    policyVersion: row.policy_version,
    preferences: {
      addressBasis: row.address_basis,
      certificateLanguage: row.certificate_language,
      deliveryMode: row.delivery_mode,
      urgency: row.urgency,
    },
    currency: row.currency,
    components: [
      { code: "statutory_fee", amountMinor: row.statutory_fee_minor },
      { code: "processing_fee", amountMinor: row.processing_fee_minor },
      {
        code: "emergency_surcharge",
        amountMinor: row.emergency_surcharge_minor,
      },
      { code: "delivery_fee", amountMinor: row.delivery_fee_minor },
      ...(row.discount_minor
        ? [{ code: "coupon_discount", amountMinor: -row.discount_minor }]
        : []),
    ],
    couponCode: row.coupon_code ?? null,
    discountMinor: row.discount_minor ?? 0,
    totalMinor: row.total_minor,
    paymentStatus:
      row.total_minor === 0
        ? row.payment_status
        : await applicationPaymentState(db, applicationId, row.total_minor),
    createdAt: row.created_at,
  };
}
export async function validateApplicationOrder(
  db: DB,
  application: any,
  payload?: Record<string, unknown>,
  issuing = false,
) {
  const order = await getApplicationOrder(db, application.id);
  if (application.order_mode === "POLICY" && !order)
    fail(409, "ORDER_REQUIRED", "The application order snapshot is missing.");
  if (!order) return;
  if (payload) validateLanguage(payload, order.preferences);
  if (issuing && order.totalMinor > 0 && order.paymentStatus !== "COLLECTED")
    fail(
      402,
      "ORDER_PAYMENT_REQUIRED",
      "Application fees require a verified gateway payment and receipt before certificate issuance.",
    );
}

type Req = express.Request & { auth?: Auth };
const wrap =
  (fn: (req: Req, res: express.Response) => Promise<unknown>) =>
  (req: Req, res: express.Response, next: express.NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);
function actor(req: Req, roles: string[]) {
  if (!req.auth) fail(401, "LOGIN_REQUIRED", "Sign in required.");
  if (!roles.includes(req.auth.role))
    fail(403, "ROLE_DENIED", "This role is not permitted.");
  if (!req.auth.tenantId)
    fail(403, "TENANT_REQUIRED", "An active tenant membership is required.");
  return req.auth as Auth & { tenantId: string };
}
const serviceNumber = z.coerce.number().int().min(1).max(47);
export const ordersRouter = express.Router();
ordersRouter.get(
  "/services/:no/order-options",
  wrap(async (req, res) => {
    const a = actor(req, [
      "citizen",
      "staff",
      "admin",
      "reviewer",
      "approver",
      "finance",
    ]);
    const no = serviceNumber.parse(req.params.no);
    const result = await transaction(a.tenantId, async (db) => {
      const policy = await currentPolicy(db, a.tenantId, no);
      return {
        configured: Boolean(policy),
        policy: policy ? policyRow(policy) : null,
      };
    });
    res.json(result);
  }),
);
ordersRouter.post(
  "/services/:no/order-quote",
  wrap(async (req, res) => {
    const a = actor(req, ["citizen", "staff", "admin"]);
    const no = serviceNumber.parse(req.params.no);
    const data = z
      .object({ preferences: orderPreferencesInput, couponCode: couponCode.optional() })
      .strict()
      .parse(req.body);
    const result = await transaction(a.tenantId, async (db) => {
      const configured = (
        await db.query(
          "SELECT enabled FROM tenant_service_configuration WHERE tenant_id=$1 AND service_no=$2",
          [a.tenantId, no],
        )
      ).rows[0];
      if (!configured?.enabled)
        fail(
          422,
          "SERVICE_DISABLED",
          "Service is not enabled for this tenant.",
        );
      const policy = await currentPolicy(db, a.tenantId, no);
      if (!policy)
        fail(
          409,
          "ORDER_POLICY_NOT_CONFIGURED",
          "This office has not configured an application order policy for this service.",
        );
      if (!data.couponCode) return quote(policy, data.preferences);
      const discountMinor = await couponDiscount(
        db,
        a.tenantId,
        data.couponCode,
        no,
        grossOf(policy, data.preferences),
      );
      return quote(policy, data.preferences, { code: data.couponCode, discountMinor });
    });
    res.json(result);
  }),
);
ordersRouter.post(
  "/admin/services/:no/order-policies",
  wrap(async (req, res) => {
    const a = actor(req, ["admin"]);
    const no = serviceNumber.parse(req.params.no);
    const data = policyInput.parse(req.body);
    const result = await transaction(a.tenantId, async (db) => {
      const configured = await db.query(
        "SELECT 1 FROM tenant_service_configuration WHERE tenant_id=$1 AND service_no=$2 FOR UPDATE",
        [a.tenantId, no],
      );
      if (!configured.rowCount)
        fail(404, "NOT_FOUND", "Service configuration not found.");
      const current = await currentPolicy(db, a.tenantId, no);
      if ((current?.version ?? 0) !== data.expectedVersion)
        fail(
          409,
          "ORDER_POLICY_STALE",
          "The office policy changed. Reload its current version before publishing.",
        );
      const row = (
        await db.query(
          `INSERT INTO service_order_policies(tenant_id,service_no,version,statutory_fee_minor,processing_fee_minor,emergency_surcharge_minor,office_collection_fee_minor,digital_copy_fee_minor,delivery_modes,urgencies,reason,created_by,charter_days,required_documents)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
          [
            a.tenantId,
            no,
            data.expectedVersion + 1,
            data.statutoryFeeMinor,
            data.processingFeeMinor,
            data.emergencySurchargeMinor,
            data.deliveryFeesMinor.office_collection,
            data.deliveryFeesMinor.digital_copy,
            data.deliveryModes,
            data.urgencies,
            data.reason,
            a.userId,
            data.charterDays ?? null,
            JSON.stringify(data.requiredDocuments ?? []),
          ],
        )
      ).rows[0];
      await audit(
        db,
        a.tenantId,
        a.userId,
        "ORDER_POLICY_PUBLISHED",
        String(no),
        {
          serviceNo: no,
          version: row.version,
          previousVersion: data.expectedVersion,
        },
      );
      return { configured: true, policy: policyRow(row) };
    });
    res.status(201).json(result);
  }),
);

// Phase 4b: office coupon codes. Codes are never deleted (snapshots reference them); they are switched off.
const couponInput = z
  .object({
    code: couponCode,
    discountKind: z.enum(["percent", "fixed"]),
    discountValue: z.number().int().min(1).max(100000000),
    serviceNos: z.array(serviceNumber).min(1).max(47).nullable().optional(),
    validFrom: z.string().datetime({ offset: true }).optional(),
    validUntil: z.string().datetime({ offset: true }).nullable().optional(),
    maxRedemptions: z.number().int().min(1).max(1000000).nullable().optional(),
    note: z.string().trim().max(200).nullable().optional(),
  })
  .strict()
  .refine((v) => v.discountKind !== "percent" || v.discountValue <= 100, {
    message: "A percentage discount is at most 100.",
  })
  .refine((v) => !v.validUntil || !v.validFrom || Date.parse(v.validUntil) > Date.parse(v.validFrom), {
    message: "The end date must be after the start date.",
  });
function couponRow(row: any) {
  return {
    code: row.code,
    discountKind: row.discount_kind,
    discountValue: row.discount_value,
    serviceNos: row.service_nos,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    maxRedemptions: row.max_redemptions,
    redemptions: row.redemptions ?? 0,
    active: row.active,
    note: row.note,
    createdAt: row.created_at,
  };
}
ordersRouter.get(
  "/admin/coupons",
  wrap(async (req, res) => {
    const a = actor(req, ["admin", "finance"]);
    const items = await transaction(a.tenantId, async (db) =>
      (
        await db.query(
          "SELECT k.*,(SELECT count(*)::int FROM coupon_redemptions r WHERE r.tenant_id=k.tenant_id AND r.code=k.code) redemptions FROM coupon_codes k ORDER BY k.created_at DESC LIMIT 200",
        )
      ).rows.map(couponRow),
    );
    res.json({ items });
  }),
);
ordersRouter.post(
  "/admin/coupons",
  wrap(async (req, res) => {
    const a = actor(req, ["admin"]);
    const d = couponInput.parse(req.body);
    const item = await transaction(a.tenantId, async (db) => {
      await db.query("SAVEPOINT coupon_create");
      let row;
      try {
        row = (
          await db.query(
            `INSERT INTO coupon_codes(tenant_id,code,discount_kind,discount_value,service_nos,valid_from,valid_until,max_redemptions,note,created_by)
             VALUES($1,$2,$3,$4,$5,coalesce($6::timestamptz,now()),$7,$8,$9,$10) RETURNING *`,
            [
              a.tenantId,
              d.code,
              d.discountKind,
              d.discountValue,
              d.serviceNos ?? null,
              d.validFrom ?? null,
              d.validUntil ?? null,
              d.maxRedemptions ?? null,
              d.note || null,
              a.userId,
            ],
          )
        ).rows[0];
        await db.query("RELEASE SAVEPOINT coupon_create");
      } catch (error: any) {
        await db.query("ROLLBACK TO SAVEPOINT coupon_create");
        if (error?.code === "23505") fail(409, "COUPON_EXISTS", "This office already has a coupon with this code.");
        throw error;
      }
      await audit(db, a.tenantId, a.userId, "COUPON_CREATED", d.code, d);
      return couponRow(row);
    });
    res.status(201).json(item);
  }),
);
ordersRouter.patch(
  "/admin/coupons/:code",
  wrap(async (req, res) => {
    const a = actor(req, ["admin"]);
    const code = couponCode.parse(req.params.code);
    const d = z.object({ active: z.boolean() }).strict().parse(req.body);
    const item = await transaction(a.tenantId, async (db) => {
      const row = (
        await db.query("UPDATE coupon_codes SET active=$3 WHERE tenant_id=$1 AND code=$2 RETURNING *", [
          a.tenantId,
          code,
          d.active,
        ])
      ).rows[0];
      if (!row) fail(404, "NOT_FOUND", "Coupon not found.");
      await audit(db, a.tenantId, a.userId, d.active ? "COUPON_ENABLED" : "COUPON_DISABLED", code);
      return couponRow(row);
    });
    res.json(item);
  }),
);
