import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool, transaction, audit, type DB } from "./db.js";
import { ApiError, camelRow, fail } from "./models.js";
import type { Auth } from "./app.js";
import { orderPaymentsAvailability } from "./order-payments.js";
import { logPlatformSecurityEvent, type PlatformSecurityAction } from "./security-audit.js";

/**
 * CERT-FEE (owner order, 28 Nov 2026): per-certificate platform fees and
 * self-service office verification.
 *
 * An office on PER_CERTIFICATE billing uses the platform freely; it pays the
 * platform only when its Chairman approves an application, once per
 * certificate. The owner sets one fixed price for the Bangla version and one
 * for the English version; both versions cost the sum. The Chairman picks the
 * language(s) at approval, sees the amount, and pays from the office points
 * wallet (1 point = 1 BDT, debited in the issuance transaction) or online
 * through the platform order checkout (bKash / SSLCommerz). Only the paid
 * language versions are rendered and issued.
 *
 * An office that opened itself (POST /public/offices/self-register) is
 * PENDING until the owner verifies it here; until then it can set itself up
 * but cannot take a fee or issue a certificate.
 */

type Req = express.Request & { auth?: Auth };
const wrap =
  (fn: (req: Req, res: express.Response) => Promise<unknown>) =>
  (req: Req, res: express.Response, next: express.NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);
function role(req: Req, allowed: string[]) {
  if (!req.auth || !allowed.includes(req.auth.role))
    fail(403, "ROLE_DENIED", "This role is not permitted.");
  return req.auth!;
}
function office(req: Req, allowed: string[]) {
  const a = role(req, allowed);
  if (!a.tenantId)
    fail(403, "TENANT_REQUIRED", "An active office membership is required.");
  return a as Auth & { tenantId: string };
}
const uuid = z.string().uuid();
/** S-014: owner actions also go to the durable platform stream (best effort after commit). */
async function platformEvent(a: Auth, action: PlatformSecurityAction, metadata: Record<string, unknown>) {
  try {
    await logPlatformSecurityEvent(pool, { actorId: a.userId, actorRole: a.role, action, metadata });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "PLATFORM_AUDIT_FAILED",
        action,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

export type CertificateLanguages = "bn" | "en" | "bilingual";
export const certificateLanguagesInput = z.enum(["bn", "en", "bilingual"]);
export const certificatePaymentMethodInput = z.enum(["wallet", "online"]);
const FEE_KEYS = {
  bn: "certificate_fee_bn_minor",
  en: "certificate_fee_en_minor",
} as const;
/** Upper bound of one language's price: 100,000 BDT in poisha. */
const MAX_FEE_MINOR = 10_000_000;

export function normalizeLanguages(value: unknown): CertificateLanguages | null {
  const v = String(value ?? "").toLowerCase();
  if (v === "bn" || v === "en" || v === "bilingual") return v;
  if (v === "both") return "bilingual";
  return null;
}

/** The owner's current prices. A missing key means "not set yet". */
export async function certificateFeeSettings(db: Pick<DB, "query">) {
  const rows = (
    await db.query(
      "SELECT key, value, updated_at FROM platform_settings WHERE key = ANY($1)",
      [[FEE_KEYS.bn, FEE_KEYS.en]],
    )
  ).rows as { key: string; value: string; updated_at: string }[];
  const read = (key: string) => {
    const row = rows.find((r) => r.key === key);
    const n = row ? Number(row.value) : NaN;
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
  };
  const bn = read(FEE_KEYS.bn),
    en = read(FEE_KEYS.en);
  return {
    feeBnMinor: bn ?? 0,
    feeEnMinor: en ?? 0,
    configured: bn !== null && en !== null,
    updatedAt:
      rows
        .map((r) => r.updated_at)
        .sort()
        .at(-1) ?? null,
  };
}

export function feeAmount(
  s: { feeBnMinor: number; feeEnMinor: number },
  languages: CertificateLanguages,
) {
  return languages === "bn"
    ? s.feeBnMinor
    : languages === "en"
      ? s.feeEnMinor
      : s.feeBnMinor + s.feeEnMinor;
}

const taka = (minor: number) =>
  (minor / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });

export const CERTIFICATE_FEE_GATE_CODES = [
  "OFFICE_NOT_VERIFIED",
  "CERTIFICATE_FEE_REQUIRED",
  "CERTIFICATE_FEE_NOT_CONFIGURED",
  "WALLET_INSUFFICIENT",
] as const;

/** The issuance gate for self-registered offices awaiting the owner. */
export function assertOfficeVerified(tenant: { verification_status?: string }) {
  if (tenant.verification_status && tenant.verification_status !== "VERIFIED")
    throw new ApiError(
      409,
      "OFFICE_NOT_VERIFIED",
      "প্ল্যাটফর্ম কর্তৃপক্ষ এখনো এই অফিস যাচাই করেনি, তাই সনদ ইস্যু করা যাবে না। যাচাই হলে ইস্যু সম্পন্ন করুন। / The platform owner has not verified this office yet, so certificates cannot be issued. Complete the issuance once the office is verified.",
    );
}

async function liveFee(db: DB, tenantId: string, applicationId: string, lock: boolean) {
  return (
    await db.query(
      `SELECT * FROM certificate_fees WHERE tenant_id=$1 AND application_id=$2 AND status<>'CANCELLED'${lock ? " FOR UPDATE" : ""}`,
      [tenantId, applicationId],
    )
  ).rows[0] as any;
}

/** Cancel a not-yet-paid online fee (and its unpaid order). */
async function cancelPendingFee(db: DB, fee: any) {
  const inFlight = (
    await db.query(
      // A checkout that was only opened (READY) or failed can be abandoned; one
      // the payer already confirmed, or whose outcome is unknown, cannot.
      "SELECT status FROM order_gateway_payments WHERE tenant_id=$1 AND order_id=$2 AND status IN ('CREATE_UNKNOWN','EXECUTE_PENDING','VERIFYING','PAID','REVIEW_REQUIRED','REFUNDED')",
      [fee.tenant_id, fee.order_id],
    )
  ).rows[0];
  if (inFlight)
    fail(
      409,
      "CERTIFICATE_FEE_PAYMENT_IN_PROGRESS",
      "এই সনদের অনলাইন পেমেন্ট চলছে। পেমেন্টের ফলাফল দেখে আবার চেষ্টা করুন। / An online payment for this certificate is in progress. Check its result before changing the languages or the payment method.",
    );
  await db.query(
    "UPDATE certificate_fees SET status='CANCELLED' WHERE tenant_id=$1 AND id=$2 AND status='PENDING'",
    [fee.tenant_id, fee.id],
  );
  await db.query(
    "UPDATE payment_orders SET status='CANCELLED' WHERE tenant_id=$1 AND id=$2 AND status='PENDING'",
    [fee.tenant_id, fee.order_id],
  );
}

/**
 * Inside the issuance transaction of a PER_CERTIFICATE office: consume the
 * paid online fee for exactly these languages, or debit the wallet now. Any
 * failure throws a gate code, rolling the issuance back (the approval itself
 * is then recorded by the caller, as for every issuance gate).
 */
export async function chargeCertificateFee(
  db: DB,
  input: {
    tenantId: string;
    applicationId: string;
    certificateId: string;
    languages: CertificateLanguages;
    method: "wallet" | "online" | null;
    actorId: string;
  },
) {
  const plan = await planFee(db, input, true);
  if (plan.kind === "PAID") {
    await db.query(
      "UPDATE certificate_fees SET status='CONSUMED', certificate_id=$3, consumed_at=now() WHERE tenant_id=$1 AND id=$2",
      [input.tenantId, plan.fee.id, input.certificateId],
    );
    return { method: "GATEWAY" as const, amountMinor: Number(plan.fee.amount_minor) };
  }
  // A wallet (or free) issuance supersedes an online fee that was never paid.
  if (plan.pending) await cancelPendingFee(db, plan.pending);
  if (plan.kind === "FREE") return { method: "FREE" as const, amountMinor: 0 };
  try {
    await db.query(
      "INSERT INTO point_ledger(tenant_id,delta_minor,kind,idempotency_key,certificate_id,actor_id,reason,balance_after) VALUES($1,$2,'ISSUANCE',$3,$4,$5,$6,0)",
      [
        input.tenantId,
        -plan.amount,
        `certfee:${input.applicationId}`,
        input.certificateId,
        input.actorId,
        `Certificate fee (${input.languages})`,
      ],
    );
  } catch (error: any) {
    // A concurrent debit emptied the wallet between the plan and the debit.
    if (error?.code === "P0001" && error?.hint === "POINTS_INSUFFICIENT")
      throw new ApiError(
        402,
        "WALLET_INSUFFICIENT",
        `অফিসের ওয়ালেটে যথেষ্ট টাকা নেই: প্রয়োজন ৳${taka(plan.amount)}। / The office wallet no longer covers ৳${taka(plan.amount)}. Recharge it or pay online.`,
      );
    throw error;
  }
  await db.query(
    "INSERT INTO certificate_fees(tenant_id,application_id,languages,fee_bn_minor,fee_en_minor,amount_minor,method,status,certificate_id,created_by,paid_at,consumed_at) VALUES($1,$2,$3,$4,$5,$6,'WALLET','CONSUMED',$7,$8,now(),now())",
    [
      input.tenantId,
      input.applicationId,
      input.languages,
      plan.settings.feeBnMinor,
      plan.settings.feeEnMinor,
      plan.amount,
      input.certificateId,
      input.actorId,
    ],
  );
  return { method: "WALLET" as const, amountMinor: plan.amount };
}

/**
 * Cheap pre-check before the certificate is rendered, so an unpayable
 * issuance fails fast. The issuance transaction re-plans under lock.
 */
export async function precheckCertificateFee(
  db: DB,
  input: {
    tenantId: string;
    applicationId: string;
    languages: CertificateLanguages;
    method: "wallet" | "online" | null;
  },
) {
  await planFee(db, input, false);
}

/**
 * How this certificate gets paid, or the gate that stops it: an online fee
 * already PAID for exactly these languages; nothing to pay (price 0); or a
 * wallet debit the balance covers.
 */
async function planFee(
  db: DB,
  input: {
    tenantId: string;
    applicationId: string;
    languages: CertificateLanguages;
    method: "wallet" | "online" | null;
  },
  lock: boolean,
): Promise<
  | { kind: "PAID"; fee: any }
  | { kind: "FREE"; pending: any }
  | { kind: "WALLET"; pending: any; amount: number; settings: { feeBnMinor: number; feeEnMinor: number } }
> {
  const fee = await liveFee(db, input.tenantId, input.applicationId, lock);
  if (fee?.status === "PAID") {
    if (fee.languages !== input.languages)
      throw new ApiError(
        409,
        "CERTIFICATE_FEE_LANGUAGE_MISMATCH",
        `পরিশোধিত ফি "${fee.languages}" সংস্করণের জন্য; সেটিই ইস্যু করুন। / The fee paid covers the "${fee.languages}" version(s); issue those, or ask the platform owner about a change.`,
      );
    return { kind: "PAID", fee };
  }
  if (fee?.status === "CONSUMED")
    fail(409, "CERTIFICATE_FEE_CONSUMED", "This application's fee was already used.");
  const pending = fee?.status === "PENDING" ? fee : null;
  const settings = await certificateFeeSettings(db);
  if (!settings.configured)
    throw new ApiError(
      422,
      "CERTIFICATE_FEE_NOT_CONFIGURED",
      "প্ল্যাটফর্ম কর্তৃপক্ষ এখনো সনদের ফি নির্ধারণ করেনি। / The platform owner has not set the certificate fees yet.",
    );
  const amount = feeAmount(settings, input.languages);
  if (amount <= 0) return { kind: "FREE", pending };
  if (input.method !== "wallet")
    throw new ApiError(
      402,
      "CERTIFICATE_FEE_REQUIRED",
      "সনদ ইস্যুর আগে প্ল্যাটফর্ম ফি পরিশোধ করুন। / Pay the platform fee for this certificate before it is issued.",
    );
  const balance = Number(
    (
      await db.query(
        // Read only: the point_ledger trigger (migration 029) locks the wallet
        // and refuses an overdraft at the debit itself.
        "SELECT balance_minor FROM point_wallets WHERE tenant_id=$1",
        [input.tenantId],
      )
    ).rows[0]?.balance_minor ?? 0,
  );
  if (balance < amount)
    throw new ApiError(
      402,
      "WALLET_INSUFFICIENT",
      `অফিসের ওয়ালেটে যথেষ্ট টাকা নেই: প্রয়োজন ৳${taka(amount)}, আছে ৳${taka(balance)}। রিচার্জ করুন বা অনলাইনে পরিশোধ করুন। / The office wallet is short: ৳${taka(amount)} needed, ৳${taka(balance)} available. Recharge it or pay online.`,
    );
  return { kind: "WALLET", pending, amount, settings };
}

/** The application's ordered language, the default choice at approval. */
async function orderedLanguages(db: DB, applicationId: string, latestVersion: number) {
  const snapshot = (
    await db.query(
      "SELECT certificate_language FROM application_order_snapshots WHERE application_id=$1",
      [applicationId],
    )
  ).rows[0];
  const payload = (
    await db.query(
      "SELECT payload FROM application_payload_versions WHERE application_id=$1 AND version=$2",
      [applicationId, latestVersion],
    )
  ).rows[0]?.payload;
  return (
    normalizeLanguages(payload?.delivery_language) ??
    normalizeLanguages(snapshot?.certificate_language) ??
    "bn"
  );
}

const feeView = (r: any) =>
  r
    ? {
        id: r.id,
        languages: r.languages,
        amountMinor: Number(r.amount_minor),
        method: r.method,
        status: r.status,
        orderId: r.order_id,
        paidAt: r.paid_at,
      }
    : null;

// --- Office endpoints ------------------------------------------------------------

export const certificateFeesRouter = express.Router();

/** The approval quote: prices per language choice, wallet balance, any fee already started. */
certificateFeesRouter.get(
  "/applications/:id/certificate-fee",
  wrap(async (req, res) => {
    const a = office(req, ["approver", "admin", "finance"]);
    const id = uuid.parse(req.params.id);
    const availability = await orderPaymentsAvailability().catch(() => null);
    const online = {
      bkash: !!availability?.bkash?.available,
      sslcommerz: !!availability?.sslcommerz?.available,
    };
    res.json(
      await transaction(a.tenantId, async (db) => {
        const app = (
          await db.query("SELECT id,state,latest_version FROM applications WHERE id=$1 AND tenant_id=$2", [
            id,
            a.tenantId,
          ])
        ).rows[0];
        if (!app) fail(404, "NOT_FOUND", "Application not found.");
        const tenant = (
          await db.query("SELECT billing_mode,verification_status FROM tenants WHERE id=$1", [a.tenantId])
        ).rows[0];
        const settings = await certificateFeeSettings(db);
        const wallet = (
          await db.query("SELECT balance_minor FROM point_wallets WHERE tenant_id=$1", [a.tenantId])
        ).rows[0];
        return {
          billingMode: tenant.billing_mode,
          officeVerified: tenant.verification_status === "VERIFIED",
          verificationStatus: tenant.verification_status,
          configured: settings.configured,
          feeBnMinor: settings.feeBnMinor,
          feeEnMinor: settings.feeEnMinor,
          amounts: {
            bn: feeAmount(settings, "bn"),
            en: feeAmount(settings, "en"),
            bilingual: feeAmount(settings, "bilingual"),
          },
          defaultLanguages: await orderedLanguages(db, id, app.latest_version),
          walletBalanceMinor: Number(wallet?.balance_minor ?? 0),
          online,
          fee: feeView(await liveFee(db, a.tenantId, id, false)),
        };
      }),
    );
  }),
);

/**
 * Start (or resume) an online fee for an approved application: a
 * certificate_fee payment order the Chairman then pays through the existing
 * order checkout (POST /billing/orders/:orderId/gateway/checkout). Changing
 * the languages before paying cancels the earlier unpaid order.
 */
certificateFeesRouter.post(
  "/applications/:id/certificate-fee/order",
  wrap(async (req, res) => {
    const a = office(req, ["approver"]);
    const id = uuid.parse(req.params.id);
    const d = z.object({ languages: certificateLanguagesInput }).strict().parse(req.body);
    const result = await transaction(a.tenantId, async (db) => {
      const app = (
        await db.query("SELECT id,state FROM applications WHERE id=$1 AND tenant_id=$2 FOR UPDATE", [
          id,
          a.tenantId,
        ])
      ).rows[0];
      if (!app) fail(404, "NOT_FOUND", "Application not found.");
      if (app.state !== "APPROVED")
        fail(
          409,
          "APPROVAL_REQUIRED",
          "আগে আবেদনটি অনুমোদন করুন। / Approve the application first; the fee is paid for an approved application.",
        );
      const tenant = (
        await db.query("SELECT billing_mode,verification_status FROM tenants WHERE id=$1", [a.tenantId])
      ).rows[0];
      if (tenant.billing_mode !== "PER_CERTIFICATE")
        fail(409, "BILLING_MODE_MISMATCH", "This office is not on per-certificate billing.");
      assertOfficeVerified(tenant);
      const existing = await liveFee(db, a.tenantId, id, true);
      if (existing?.status === "PAID" || existing?.status === "CONSUMED")
        return { fee: feeView(existing), created: false };
      if (existing?.status === "PENDING") {
        const orderStatus = (
          await db.query("SELECT status FROM payment_orders WHERE tenant_id=$1 AND id=$2", [
            a.tenantId,
            existing.order_id,
          ])
        ).rows[0]?.status;
        // Resume the same unpaid order; an order the owner cancelled is replaced.
        if (existing.languages === d.languages && orderStatus === "PENDING")
          return { fee: feeView(existing), created: false };
        await cancelPendingFee(db, existing);
      }
      const settings = await certificateFeeSettings(db);
      if (!settings.configured)
        fail(
          422,
          "CERTIFICATE_FEE_NOT_CONFIGURED",
          "প্ল্যাটফর্ম কর্তৃপক্ষ এখনো সনদের ফি নির্ধারণ করেনি। / The platform owner has not set the certificate fees yet.",
        );
      const amount = feeAmount(settings, d.languages);
      if (amount <= 0)
        fail(409, "PAYMENT_NOT_REQUIRED", "This certificate has no fee; approve and issue it directly.");
      const orderId = randomUUID();
      await db.query(
        "INSERT INTO payment_orders(id,tenant_id,kind,credits,amount_minor,currency,created_by) VALUES($1,$2,'certificate_fee',0,$3,'BDT',$4)",
        [orderId, a.tenantId, amount, a.userId],
      );
      const fee = (
        await db.query(
          "INSERT INTO certificate_fees(tenant_id,application_id,languages,fee_bn_minor,fee_en_minor,amount_minor,method,status,order_id,created_by) VALUES($1,$2,$3,$4,$5,$6,'GATEWAY','PENDING',$7,$8) RETURNING *",
          [a.tenantId, id, d.languages, settings.feeBnMinor, settings.feeEnMinor, amount, orderId, a.userId],
        )
      ).rows[0];
      await audit(db, a.tenantId, a.userId, "CERTIFICATE_FEE_ORDERED", id, {
        languages: d.languages,
        amountMinor: amount,
        orderId,
      });
      return { fee: feeView(fee), created: true };
    });
    res.status(result.created ? 201 : 200).json(result.fee);
  }),
);

/** Settlement hook (order-settlement.ts): a settled certificate_fee order marks its fee PAID. */
export async function settleCertificateFeeOrder(db: DB, order: { tenant_id: string; id: string }) {
  await db.query(
    "UPDATE certificate_fees SET status='PAID', paid_at=now() WHERE tenant_id=$1 AND order_id=$2 AND status='PENDING'",
    [order.tenant_id, order.id],
  );
}

// --- Owner endpoints -------------------------------------------------------------

export const ownerCertificateFeesRouter = express.Router();

ownerCertificateFeesRouter.get(
  "/owner/certificate-fees",
  wrap(async (req, res) => {
    role(req, ["owner"]);
    res.json(await certificateFeeSettings(pool));
  }),
);

ownerCertificateFeesRouter.put(
  "/owner/certificate-fees",
  wrap(async (req, res) => {
    const a = role(req, ["owner"]);
    const d = z
      .object({
        feeBnMinor: z.number().int().min(0).max(MAX_FEE_MINOR),
        feeEnMinor: z.number().int().min(0).max(MAX_FEE_MINOR),
        reason: z.string().trim().min(8).max(500),
      })
      .strict()
      .parse(req.body);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const [key, value] of [
        [FEE_KEYS.bn, d.feeBnMinor],
        [FEE_KEYS.en, d.feeEnMinor],
      ] as const) {
        await client.query(
          `INSERT INTO platform_settings(key, value, updated_by, updated_at) VALUES($1,$2,$3,now())
           ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()`,
          [key, String(value), a.userId],
        );
        await client.query(
          "INSERT INTO platform_setting_changes(key, value, reason, changed_by) VALUES($1,$2,$3,$4)",
          [key, String(value), d.reason, a.userId],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await platformEvent(a, "CERTIFICATE_FEES_CHANGED", {
      feeBnMinor: d.feeBnMinor,
      feeEnMinor: d.feeEnMinor,
    });
    res.json(await certificateFeeSettings(pool));
  }),
);

const officeVerificationView = (r: any) => ({
  ...camelRow(r),
  adminEmail: r.admin_email ?? null,
  adminName: r.admin_name ?? null,
});

/** Offices awaiting (or refused) verification, newest first. */
ownerCertificateFeesRouter.get(
  "/owner/office-verifications",
  wrap(async (req, res) => {
    role(req, ["owner"]);
    const status = z.enum(["PENDING", "VERIFIED", "REJECTED"]).default("PENDING").parse(req.query.status ?? undefined);
    const rows = (
      await pool.query(
        `SELECT t.id,t.slug,t.name_bn,t.name_en,t.office_type,t.division,t.district,t.upazila,t.status,
                t.verification_status,t.verification_note,t.verified_at,t.self_registered,t.billing_mode,t.created_at
           FROM tenants t
          WHERE t.verification_status=$1
          ORDER BY t.created_at DESC LIMIT 200`,
        [status],
      )
    ).rows;
    // The first admin of each office, read inside that office's own scope.
    const items = [];
    for (const r of rows) {
      const admin = await transaction(r.id, async (db) =>
        (
          await db.query(
            "SELECT u.email AS admin_email, u.display_name AS admin_name FROM staff_memberships m JOIN platform_users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.role='admin' ORDER BY u.email LIMIT 1",
            [r.id],
          )
        ).rows[0],
      ).catch(() => undefined);
      items.push(officeVerificationView({ ...r, ...(admin ?? {}) }));
    }
    res.json({ items });
  }),
);

ownerCertificateFeesRouter.post(
  "/owner/tenants/:id/verification",
  wrap(async (req, res) => {
    const a = role(req, ["owner"]);
    const id = uuid.parse(req.params.id);
    const d = z
      .object({
        decision: z.enum(["VERIFIED", "REJECTED"]),
        note: z.string().trim().min(3).max(500).optional(),
      })
      .strict()
      .refine((v) => v.decision !== "REJECTED" || !!v.note, {
        message: "Give a reason for refusing the office.",
        path: ["note"],
      })
      .parse(req.body);
    const row = await transaction(id, async (db) => {
      const t = (
        await db.query(
          "UPDATE tenants SET verification_status=$2, verification_note=$3, verified_by=$4, verified_at=CASE WHEN $2='VERIFIED' THEN now() ELSE NULL END WHERE id=$1 RETURNING *",
          [id, d.decision, d.note ?? null, a.userId],
        )
      ).rows[0];
      if (!t) fail(404, "NOT_FOUND", "Office not found.");
      await audit(db, id, a.userId, d.decision === "VERIFIED" ? "TENANT_VERIFIED" : "TENANT_VERIFICATION_REFUSED", id, {
        note: d.note ?? null,
      });
      return t;
    });
    await platformEvent(a, d.decision === "VERIFIED" ? "TENANT_VERIFIED" : "TENANT_VERIFICATION_REFUSED", {
      tenantId: id,
    });
    res.json(officeVerificationView(row));
  }),
);

ownerCertificateFeesRouter.put(
  "/owner/tenants/:id/billing-mode",
  wrap(async (req, res) => {
    const a = role(req, ["owner"]);
    const id = uuid.parse(req.params.id);
    const d = z
      .object({
        billingMode: z.enum(["SUBMIT_CREDIT", "PER_CERTIFICATE"]),
        reason: z.string().trim().min(8).max(500),
      })
      .strict()
      .parse(req.body);
    const row = await transaction(id, async (db) => {
      const t = (
        await db.query("UPDATE tenants SET billing_mode=$2 WHERE id=$1 RETURNING id,billing_mode", [id, d.billingMode])
      ).rows[0];
      if (!t) fail(404, "NOT_FOUND", "Office not found.");
      await audit(db, id, a.userId, "TENANT_BILLING_MODE_CHANGED", id, {
        billingMode: d.billingMode,
        reason: d.reason,
      });
      return t;
    });
    await platformEvent(a, "TENANT_BILLING_MODE_CHANGED", { tenantId: id, billingMode: d.billingMode });
    res.json({ id: row.id, billingMode: row.billing_mode });
  }),
);
