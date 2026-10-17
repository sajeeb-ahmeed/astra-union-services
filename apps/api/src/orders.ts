import express from "express";
import { z } from "zod";
import { transaction, audit, type DB } from "./db.js";
import { fail } from "./models.js";
import type { Auth } from "./app.js";

const deliveryMode = z.enum(["office_collection", "digital_copy"]);
const urgency = z.enum(["normal", "urgent"]);
const money = z.number().int().min(0).max(100000000);
export const orderPreferencesInput = z
  .object({
    addressBasis: z.literal("registered_profile"),
    certificateLanguage: z.enum(["bn", "en"]),
    deliveryMode,
    urgency,
  })
  .strict();
export const applicationOrderInput = z
  .object({
    policyVersion: z.number().int().min(1).max(2147483647),
    preferences: orderPreferencesInput,
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
function quote(policy: any, preferences: Preferences) {
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
  return {
    policyVersion: policy.version as number,
    preferences,
    currency: "BDT" as const,
    components,
    totalMinor: components.reduce(
      (sum, component) => sum + component.amountMinor,
      0,
    ),
    paymentStatus: "NOT_COLLECTED" as const,
  };
}
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
  return quote(policy, order.preferences);
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
    `INSERT INTO application_order_snapshots(tenant_id,application_id,service_no,policy_version,address_basis,certificate_language,delivery_mode,urgency,statutory_fee_minor,processing_fee_minor,emergency_surcharge_minor,delivery_fee_minor,total_minor,currency)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      tenantId,
      applicationId,
      serviceNo,
      order.policyVersion,
      order.preferences.addressBasis,
      order.preferences.certificateLanguage,
      order.preferences.deliveryMode,
      order.preferences.urgency,
      ...order.components.map((component) => component.amountMinor),
      order.totalMinor,
      order.currency,
    ],
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
    ],
    totalMinor: row.total_minor,
    paymentStatus: row.payment_status,
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
  if (issuing && order.totalMinor > 0)
    fail(
      402,
      "ORDER_PAYMENT_REQUIRED",
      "Application fees have not been collected. Fee collection is not yet configured; certificate issuance is blocked.",
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
      .object({ preferences: orderPreferencesInput })
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
      return quote(policy, data.preferences);
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
          `INSERT INTO service_order_policies(tenant_id,service_no,version,statutory_fee_minor,processing_fee_minor,emergency_surcharge_minor,office_collection_fee_minor,digital_copy_fee_minor,delivery_modes,urgencies,reason,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
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
