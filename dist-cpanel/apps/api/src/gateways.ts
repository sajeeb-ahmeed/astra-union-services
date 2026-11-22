import express from "express";
import { z } from "zod";
import type { Auth } from "./app.js";
import { audit, transaction, type DB } from "./db.js";
import { ApiError, fail } from "./models.js";
import {
  BkashGateway,
  gatewayAvailability as bkashAvailability,
  getGateway as getBkashGateway,
  hasGatewayOverride,
  officeBkashConfig,
  type Gateway,
} from "./bkash.js";
import { SslcommerzGateway, derivedTokenKey, merchantSecretsAvailable, openMerchantSecret, sealMerchantSecret } from "./sslcommerz.js";

/**
 * Phase 5c: picks the gateway for a payment. bKash keeps its deployment-level configuration; SSLCommerz uses
 * the office's own merchant credentials (office_payment_merchants), so one office never collects through
 * another's account. LIVE needs SSLCOMMERZ_LIVE_ENABLED=true in addition to the office's LIVE credentials.
 */
export type Provider = "BKASH" | "SSLCOMMERZ";
async function sslcommerzRow(tenantId: string, db?: DB) {
  const read = (c: DB) =>
    c.query("SELECT * FROM office_payment_merchants WHERE tenant_id=$1 AND provider='SSLCOMMERZ'", [tenantId]).then((r) => r.rows[0]);
  return db ? read(db) : transaction(tenantId, read);
}
function sslcommerzState(row: any) {
  if (!row) return { configured: false, available: false, environment: "DISABLED", reason: "MERCHANT_SETUP_REQUIRED" };
  if (!row.enabled) return { configured: true, available: false, environment: row.environment, reason: "OFFICE_GATEWAY_DISABLED" };
  if (!merchantSecretsAvailable())
    return { configured: true, available: false, environment: row.environment, reason: "MERCHANT_SECRETS_UNAVAILABLE" };
  if (row.environment === "LIVE" && process.env.SSLCOMMERZ_LIVE_ENABLED !== "true")
    return { configured: true, available: false, environment: row.environment, reason: "LIVE_ACTIVATION_REQUIRED" };
  return { configured: true, available: true, environment: row.environment, reason: "CONFIGURED" };
}
// --- bKash: the office's own merchant first; the deployment-wide BKASH_TENANT_ID only as a legacy fallback ---
async function bkashRow(tenantId: string, db?: DB) {
  const read = (c: DB) =>
    c.query("SELECT * FROM office_payment_merchants WHERE tenant_id=$1 AND provider='BKASH'", [tenantId]).then((r) => r.rows[0]);
  return db ? read(db) : transaction(tenantId, read);
}
function officeBkash(row: any) {
  if (!row) return null;
  if (!row.enabled) return { reason: "OFFICE_GATEWAY_DISABLED" };
  if (!merchantSecretsAvailable()) return { reason: "MERCHANT_SECRETS_UNAVAILABLE" };
  const secrets = JSON.parse(openMerchantSecret(row.secret_cipher, row.tenant_id, row.environment, "BKASH"));
  return officeBkashConfig({
    tenantId: row.tenant_id,
    environment: row.environment,
    merchantAccount: row.store_id,
    ...secrets,
    tokenKey: derivedTokenKey(row.tenant_id),
  });
}
function bkashState(tenantId: string, row: any) {
  if (hasGatewayOverride(tenantId) || !row) return bkashAvailability(tenantId);
  const office = officeBkash(row)!;
  return {
    ...bkashAvailability(tenantId),
    environment: row.environment,
    configured: true,
    available: Boolean("config" in office && office.config),
    reason: office.reason,
    merchantAccount: row.store_id,
  };
}
export async function gatewayAvailability(tenantId: string, db?: DB) {
  const row = await sslcommerzRow(tenantId, db);
  const sslcommerz = { provider: "SSLCOMMERZ" as const, storeId: row?.store_id ?? null, ...sslcommerzState(row) };
  const bkash = bkashState(tenantId, await bkashRow(tenantId, db));
  return { ...bkash, sslcommerz, anyAvailable: bkash.available || sslcommerz.available };
}
export async function resolveGateway(tenantId: string, provider: Provider, db?: DB): Promise<Gateway> {
  if (provider === "BKASH") {
    const row = hasGatewayOverride(tenantId) ? null : await bkashRow(tenantId, db);
    if (!row) return getBkashGateway(tenantId);
    const office = officeBkash(row)!;
    if (!("config" in office) || !office.config)
      throw new ApiError(503, "GATEWAY_NOT_CONFIGURED", "Online payment through bKash is unavailable until this office completes merchant setup.");
    return new BkashGateway(office.config);
  }
  const row = await sslcommerzRow(tenantId, db);
  const state = sslcommerzState(row);
  if (!state.available)
    throw new ApiError(503, "GATEWAY_NOT_CONFIGURED", "Online payment through SSLCommerz is unavailable until this office completes merchant setup.");
  return new SslcommerzGateway({
    tenantId,
    environment: row.environment,
    storeId: row.store_id,
    storePassword: openMerchantSecret(row.secret_cipher, tenantId, row.environment),
  });
}

// --- Office admin: the office's own SSLCommerz merchant credentials (the password is write-only). ---

type Req = express.Request & { auth?: Auth };
const wrap =
  (fn: (req: Req, res: express.Response) => Promise<unknown>) =>
  (req: Req, res: express.Response, next: express.NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);
const merchantView = (row: any) =>
  row
    ? { provider: "SSLCOMMERZ", storeId: row.store_id, enabled: row.enabled, updatedAt: row.updated_at, ...sslcommerzState(row) }
    : { provider: "SSLCOMMERZ", storeId: null, enabled: false, ...sslcommerzState(null) };
export const merchantRouter = express.Router();
merchantRouter.get(
  "/admin/payment-merchants/sslcommerz",
  wrap(async (req, res) => {
    if (!req.auth || !["admin", "finance"].includes(req.auth.role)) fail(403, "ROLE_DENIED", "This role is not permitted.");
    res.json(merchantView(await sslcommerzRow(req.auth!.tenantId!)));
  }),
);
merchantRouter.put(
  "/admin/payment-merchants/sslcommerz",
  wrap(async (req, res) => {
    if (!req.auth || req.auth.role !== "admin") fail(403, "ROLE_DENIED", "This role is not permitted.");
    const a = req.auth!;
    const d = z
      .object({
        environment: z.enum(["SANDBOX", "LIVE"]),
        storeId: z.string().trim().regex(/^[A-Za-z0-9_.-]{3,100}$/),
        // Required when first saving or when the environment changes; omit to keep the stored one.
        storePassword: z.string().min(4).max(200).optional(),
        enabled: z.boolean(),
      })
      .strict()
      .parse(req.body);
    const item = await transaction(a.tenantId!, async (db) => {
      const existing = await sslcommerzRow(a.tenantId!, db);
      if (!d.storePassword && (!existing || existing.environment !== d.environment))
        fail(422, "STORE_PASSWORD_REQUIRED", "Enter the store password for this environment.");
      const cipher = d.storePassword ? sealMerchantSecret(d.storePassword, a.tenantId!, d.environment) : existing.secret_cipher;
      const row = (
        await db.query(
          `INSERT INTO office_payment_merchants(tenant_id,provider,environment,store_id,secret_cipher,enabled,updated_by)
           VALUES($1,'SSLCOMMERZ',$2,$3,$4,$5,$6)
           ON CONFLICT(tenant_id,provider) DO UPDATE SET environment=$2,store_id=$3,secret_cipher=$4,enabled=$5,updated_by=$6,updated_at=now() RETURNING *`,
          [a.tenantId, d.environment, d.storeId, cipher, d.enabled, a.userId],
        )
      ).rows[0];
      await audit(db, a.tenantId!, a.userId, "PAYMENT_MERCHANT_UPDATED", "SSLCOMMERZ", {
        environment: d.environment,
        storeId: d.storeId,
        enabled: d.enabled,
        passwordChanged: Boolean(d.storePassword),
      });
      return merchantView(row);
    });
    res.json(item);
  }),
);

// --- Office admin: the office's own bKash merchant (API credentials are write-only). ---
const bkashView = (tenantId: string, row: any) => ({
  provider: "BKASH",
  merchantAccount: row?.store_id ?? null,
  enabled: row ? row.enabled : false,
  updatedAt: row?.updated_at ?? null,
  ...(() => {
    const s = bkashState(tenantId, row);
    return { environment: row ? s.environment : "DISABLED", available: row ? s.available : false, reason: row ? s.reason : "MERCHANT_SETUP_REQUIRED" };
  })(),
});
merchantRouter.get(
  "/admin/payment-merchants/bkash",
  wrap(async (req, res) => {
    if (!req.auth || !["admin", "finance"].includes(req.auth.role)) fail(403, "ROLE_DENIED", "This role is not permitted.");
    res.json(bkashView(req.auth!.tenantId!, await bkashRow(req.auth!.tenantId!)));
  }),
);
merchantRouter.put(
  "/admin/payment-merchants/bkash",
  wrap(async (req, res) => {
    if (!req.auth || req.auth.role !== "admin") fail(403, "ROLE_DENIED", "This role is not permitted.");
    const a = req.auth!;
    const secret = z.string().min(1).max(500);
    const d = z
      .object({
        environment: z.enum(["SANDBOX", "LIVE"]),
        merchantAccount: z.string().trim().regex(/^01[3-9][0-9]{8}$/),
        // All four are required when first saving or when the environment changes; omit them to keep the stored ones.
        appKey: secret.optional(),
        appSecret: secret.optional(),
        username: secret.optional(),
        password: secret.optional(),
        enabled: z.boolean(),
      })
      .strict()
      .refine((v) => [v.appKey, v.appSecret, v.username, v.password].every((x) => x === undefined) || [v.appKey, v.appSecret, v.username, v.password].every((x) => x !== undefined), {
        message: "Enter all four bKash API credentials together.",
      })
      .parse(req.body);
    const item = await transaction(a.tenantId!, async (db) => {
      const existing = await bkashRow(a.tenantId!, db);
      const changing = d.appKey !== undefined;
      if (!changing && (!existing || existing.environment !== d.environment))
        fail(422, "MERCHANT_CREDENTIALS_REQUIRED", "Enter the bKash app key, app secret, username and password for this environment.");
      const cipher = changing
        ? sealMerchantSecret(
            JSON.stringify({ appKey: d.appKey, appSecret: d.appSecret, username: d.username, password: d.password }),
            a.tenantId!,
            d.environment,
            "BKASH",
          )
        : existing.secret_cipher;
      const row = (
        await db.query(
          `INSERT INTO office_payment_merchants(tenant_id,provider,environment,store_id,secret_cipher,enabled,updated_by)
           VALUES($1,'BKASH',$2,$3,$4,$5,$6)
           ON CONFLICT(tenant_id,provider) DO UPDATE SET environment=$2,store_id=$3,secret_cipher=$4,enabled=$5,updated_by=$6,updated_at=now() RETURNING *`,
          [a.tenantId, d.environment, d.merchantAccount, cipher, d.enabled, a.userId],
        )
      ).rows[0];
      await audit(db, a.tenantId!, a.userId, "PAYMENT_MERCHANT_UPDATED", "BKASH", {
        environment: d.environment,
        merchantAccount: d.merchantAccount,
        enabled: d.enabled,
        credentialsChanged: changing,
      });
      return bkashView(a.tenantId!, row);
    });
    res.json(item);
  }),
);
