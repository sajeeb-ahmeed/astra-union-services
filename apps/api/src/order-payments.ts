import express from "express";
import { z } from "zod";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { pool, transaction, audit, type DB } from "./db.js";
import { fail } from "./models.js";
import { digest, randomToken } from "./security.js";
import { createRateLimiter } from "./http-hardening.js";
import type { Gateway, PaymentResult, TransactionResult } from "./bkash.js";
import {
  gatewayAvailability,
  resolveGateway,
  type Provider,
} from "./gateways.js";
import { SslcommerzGateway } from "./sslcommerz.js";
import { applyOrderSettlement } from "./order-settlement.js";
import { workingDaysAfter } from "./refunds.js";
import type { Auth } from "./app.js";

/**
 * Phase 7: real-gateway checkout for subscription / credit payment orders.
 *
 * Until now a payment_order could only be settled by the demo HMAC webhook or by the
 * platform owner by hand. This module adds the online path beside them, with the same
 * discipline as the citizen-fee flow (payments.ts): a browser return or an SSLCommerz
 * IPN is only a signal — an order settles only after the provider's payment query AND
 * transaction search agree on invoice, amount, currency and merchant, and settlement
 * itself is the shared applyOrderSettlement, so credits, subscription, invoice and
 * audit land exactly once whichever path paid.
 *
 * The receiving merchant is the PLATFORM's, not the paying office's: order checkouts
 * resolve the gateway of the tenant named by PLATFORM_GATEWAY_TENANT_ID, whose own
 * merchant setup (office merchant rows, or the deployment BKASH_* config when that
 * tenant is BKASH_TENANT_ID) collects subscription money. Sandbox vs live is purely
 * that merchant's configured environment — no credential lives in code.
 */
type Req = express.Request & { auth?: Auth };
type Actor = Auth & { tenantId: string };
const uuid = z.string().uuid();
const wrap =
  (fn: (req: Req, res: express.Response) => Promise<unknown>) =>
  (req: Req, res: express.Response, next: express.NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);
function actor(req: Req, roles: string[]): Actor {
  if (!req.auth) fail(401, "LOGIN_REQUIRED", "Sign in required.");
  if (!roles.includes(req.auth.role))
    fail(403, "ROLE_DENIED", "This role is not permitted.");
  if (!req.auth.tenantId)
    fail(403, "TENANT_REQUIRED", "An active office membership is required.");
  return req.auth as Actor;
}
function ownerActor(req: Req): Auth {
  if (!req.auth) fail(401, "LOGIN_REQUIRED", "Sign in required.");
  if (req.auth.role !== "owner")
    fail(403, "ROLE_DENIED", "This role is not permitted.");
  return req.auth;
}
const origin = () => process.env.PUBLIC_ORIGIN ?? "http://127.0.0.1:5173";
function equalSecret(actual: string, expected: string) {
  const a = Buffer.from(actual),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function errorCode(error: unknown) {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{2,70}$/.test(code)
    ? code
    : "GATEWAY_REQUEST_FAILED";
}

// --- Platform gateway resolution -------------------------------------------------

export function platformGatewayTenantId(): string | null {
  const id = process.env.PLATFORM_GATEWAY_TENANT_ID;
  return id && uuid.safeParse(id).success ? id : null;
}
export async function orderPaymentsAvailability() {
  const tenantId = platformGatewayTenantId();
  if (!tenantId)
    return {
      configured: false,
      available: false,
      reason: "PLATFORM_GATEWAY_NOT_CONFIGURED",
      bkash: null,
      sslcommerz: null,
      anyAvailable: false,
    };
  const availability = await gatewayAvailability(tenantId);
  return {
    configured: true,
    available: availability.anyAvailable,
    reason: availability.anyAvailable ? "CONFIGURED" : availability.reason,
    bkash: {
      provider: availability.provider,
      environment: availability.environment,
      configured: availability.configured,
      available: availability.available,
      reason: availability.reason,
    },
    sslcommerz: availability.sslcommerz,
    anyAvailable: availability.anyAvailable,
  };
}
/** Health-surface helper: true only when a platform gateway can actually take an order payment. */
export async function orderPaymentsEnabled(): Promise<boolean> {
  try {
    return (await orderPaymentsAvailability()).anyAvailable;
  } catch {
    return false;
  }
}
async function platformGateway(
  provider: Provider,
  db?: DB,
): Promise<Gateway> {
  const tenantId = platformGatewayTenantId();
  if (!tenantId)
    fail(
      503,
      "GATEWAY_NOT_CONFIGURED",
      "Online order payment is unavailable until the platform gateway is configured.",
    );
  return resolveGateway(tenantId!, provider, db);
}

// --- Views -----------------------------------------------------------------------

const paymentView = (row: any) =>
  row
    ? {
        id: row.id,
        orderId: row.order_id,
        provider: row.provider,
        environment: row.environment,
        status: row.status,
        amountMinor: row.amount_minor,
        currency: row.currency,
        invoice: row.invoice,
        checkoutUrl: row.checkout_url,
        transactionId: row.transaction_id,
        lastError: row.last_error,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    : null;
const reconciliationView = (row: any) =>
  row
    ? {
        id: row.id,
        result: row.result,
        reason: row.reason,
        checkedAt: row.checked_at,
      }
    : null;
const refundView = (r: any) => ({
  id: r.id,
  orderId: r.order_id,
  amountMinor: r.amount_minor,
  reason: r.reason,
  status: r.status,
  requestedAt: r.requested_at,
  decidedAt: r.decided_at,
  decisionNote: r.decision_note,
  sentAt: r.sent_at,
  settledAt: r.settled_at,
  expectedBy:
    typeof r.expected_by === "string"
      ? r.expected_by
      : (r.expected_by?.toISOString().slice(0, 10) ?? null),
  lastError: r.last_error,
});

async function event(
  db: DB,
  row: any,
  kind: string,
  metadata: object = {},
  key: string = randomUUID(),
) {
  await db.query(
    "INSERT INTO order_gateway_events(tenant_id,order_payment_id,event_key,event_type,metadata) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,order_payment_id,event_key) DO NOTHING",
    [row.tenant_id, row.id, key, kind, JSON.stringify(metadata)],
  );
}
/** Callers hold the payment lock so concurrent workers share one durable check budget. */
async function reserveCheck(db: DB, row: any, key: string) {
  const recent = (
    await db.query(
      "SELECT count(*)::int count FROM order_gateway_events WHERE tenant_id=$1 AND order_payment_id=$2 AND event_type='PAYMENT_CHECK_CLAIMED' AND created_at>now()-interval '5 minutes'",
      [row.tenant_id, row.id],
    )
  ).rows[0].count;
  if (recent >= 20)
    fail(
      429,
      "PAYMENT_CHECK_LIMIT",
      "Wait a few minutes before querying this payment again.",
    );
  await event(db, row, "PAYMENT_CHECK_CLAIMED", {}, key);
}
async function orderForUpdate(db: DB, tenantId: string, orderId: string) {
  const order = (
    await db.query(
      "SELECT * FROM payment_orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
      [tenantId, orderId],
    )
  ).rows[0];
  if (!order) fail(404, "ORDER_NOT_FOUND", "Payment order not found.");
  return order;
}
async function paymentForOrder(db: DB, tenantId: string, orderId: string) {
  return (
    await db.query(
      "SELECT * FROM order_gateway_payments WHERE tenant_id=$1 AND order_id=$2",
      [tenantId, orderId],
    )
  ).rows[0];
}

// --- Verification: query + search must agree before anything settles --------------

function queryMatches(row: any, query: PaymentResult) {
  return (
    query.paymentId === row.payment_id &&
    query.invoice === row.invoice &&
    query.amountMinor === row.amount_minor &&
    query.currency === row.currency &&
    query.intent === "sale"
  );
}
function searchMatches(
  row: any,
  query: PaymentResult,
  search: TransactionResult,
) {
  return (
    search.transactionId === query.transactionId &&
    search.amountMinor === row.amount_minor &&
    search.currency === row.currency &&
    search.merchantAccount === row.merchant_account
  );
}
type Probe = {
  result: "MATCHED" | "MISMATCH" | "PENDING" | "ERROR";
  reason: string;
  metadata: Record<string, unknown>;
  query?: PaymentResult;
  search?: TransactionResult;
};
async function probeGateway(row: any): Promise<Probe> {
  const metadata: Record<string, unknown> = {
    expected: {
      provider: row.provider,
      environment: row.environment,
      paymentId: row.payment_id,
      invoice: row.invoice,
      amountMinor: row.amount_minor,
      currency: row.currency,
    },
    checkedAt: new Date().toISOString(),
  };
  if (!row.payment_id)
    return {
      result: "PENDING",
      reason: "CHECKOUT_CREATION_REQUIRES_RECOVERY",
      metadata,
    };
  try {
    const gateway = await platformGateway(row.provider);
    const query = await gateway.query(row.payment_id);
    metadata.query = {
      paymentId: query.paymentId,
      status: query.status,
      transactionId: query.transactionId ?? null,
      invoice: query.invoice,
      amountMinor: query.amountMinor,
      currency: query.currency,
      intent: query.intent,
    };
    if (!queryMatches(row, query))
      return { result: "MISMATCH", reason: "GATEWAY_QUERY_MISMATCH", metadata };
    if (query.status !== "Completed")
      return {
        result: row.status === "PAID" ? "MISMATCH" : "PENDING",
        reason:
          row.status === "PAID"
            ? "GATEWAY_STATUS_CHANGED"
            : "PROVIDER_PAYMENT_NOT_COMPLETED",
        metadata,
      };
    if (!query.transactionId)
      return {
        result: "MISMATCH",
        reason: "GATEWAY_TRANSACTION_MISSING",
        metadata,
      };
    const search = await gateway.search(query.transactionId);
    metadata.search = {
      transactionId: search.transactionId,
      status: search.status,
      amountMinor: search.amountMinor,
      currency: search.currency,
      merchantMatched: search.merchantAccount === row.merchant_account,
    };
    if (!searchMatches(row, query, search) || search.status !== "Completed")
      return {
        result: "MISMATCH",
        reason: "GATEWAY_TRANSACTION_MISMATCH",
        metadata,
      };
    return {
      result: "MATCHED",
      reason: "PROVIDER_TRANSACTION_MATCHED",
      metadata,
      query,
      search,
    };
  } catch (error) {
    const code = errorCode(error);
    return {
      result:
        code === "GATEWAY_TRANSACTION_CHANGED" ||
        code === "GATEWAY_TRANSACTION_REUSED"
          ? "MISMATCH"
          : "ERROR",
      reason: code,
      metadata,
    };
  }
}

/**
 * Record one verification check; on MATCHED, settle the order in the same transaction —
 * payment PAID + evidence, the payment_events idempotency row, and the shared settlement
 * effects commit together or not at all.
 */
async function runOrderCheck(
  row: any,
  requestKey: string,
  actorId: string | null,
) {
  const probe = await probeGateway(row);
  return transaction(row.tenant_id, async (db) => {
    const current = (
      await db.query(
        "SELECT * FROM order_gateway_payments WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [row.tenant_id, row.id],
      )
    ).rows[0];
    const previous = (
      await db.query(
        "SELECT * FROM order_gateway_reconciliations WHERE tenant_id=$1 AND request_key=$2",
        [row.tenant_id, requestKey],
      )
    ).rows[0];
    if (previous && previous.order_payment_id !== row.id)
      fail(
        409,
        "IDEMPOTENCY_CONFLICT",
        "This request key belongs to another payment.",
      );
    if (previous) {
      return {
        payment: paymentView(current),
        reconciliation: reconciliationView(previous),
        settled: current.status === "PAID",
      };
    }
    let result = probe.result,
      reason = probe.reason;
    if (probe.result === "MATCHED" && current.status !== "PAID") {
      const order = await orderForUpdate(db, row.tenant_id, current.order_id);
      if (order.status === "CANCELLED" || order.status === "REFUNDED") {
        // Money arrived for an order that can no longer be settled: hold for review
        // instead of granting credits nobody should have.
        result = "MISMATCH";
        reason = "ORDER_NOT_PAYABLE";
      } else {
        const eventId = `gateway:${current.id}`;
        const bodyHash = digest(
          JSON.stringify({
            payment: current.id,
            transactionId: probe.query!.transactionId,
            amountMinor: current.amount_minor,
          }),
        );
        const priorEvent = (
          await db.query("SELECT * FROM payment_events WHERE event_id=$1", [
            eventId,
          ])
        ).rows[0];
        if (priorEvent && priorEvent.body_hash !== bodyHash)
          fail(
            409,
            "EVENT_REUSE",
            "Payment event was already used with different content.",
          );
        if (!priorEvent)
          await db.query(
            "INSERT INTO payment_events(event_id,tenant_id,order_id,body_hash) VALUES($1,$2,$3,$4)",
            [eventId, row.tenant_id, order.id, bodyHash],
          );
        if (order.status === "PENDING")
          await applyOrderSettlement(
            db,
            order,
            order.created_by,
            "GATEWAY_PAYMENT_SETTLED",
            {
              provider: current.provider,
              orderPaymentId: current.id,
              transactionId: probe.query!.transactionId,
            },
          );
        await db.query(
          "UPDATE order_gateway_payments SET status='PAID',transaction_id=$3,evidence=$4,last_error=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [
            row.tenant_id,
            row.id,
            probe.query!.transactionId,
            JSON.stringify({
              queryStatus: probe.query!.status,
              searchStatus: probe.search!.status,
              transactionId: probe.query!.transactionId,
              ...(probe.search!.providerReference
                ? { providerReference: probe.search!.providerReference }
                : {}),
            }),
          ],
        );
        await event(db, current, "PAID", {
          transactionId: probe.query!.transactionId,
        });
      }
    }
    const recorded = (
      await db.query(
        `INSERT INTO order_gateway_reconciliations(tenant_id,order_payment_id,request_key,actor_id,result,reason,metadata) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          row.tenant_id,
          row.id,
          requestKey,
          actorId,
          result,
          reason,
          JSON.stringify(probe.metadata),
        ],
      )
    ).rows[0];
    if (current.status !== "PAID" && result === "MISMATCH")
      await db.query(
        "UPDATE order_gateway_payments SET status='REVIEW_REQUIRED',last_error=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2",
        [row.tenant_id, row.id, reason],
      );
    else if (current.status !== "PAID" && result === "ERROR")
      await db.query(
        "UPDATE order_gateway_payments SET last_error=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2",
        [row.tenant_id, row.id, reason],
      );
    const refreshed = (
      await db.query(
        "SELECT * FROM order_gateway_payments WHERE tenant_id=$1 AND id=$2",
        [row.tenant_id, row.id],
      )
    ).rows[0];
    return {
      payment: paymentView(refreshed),
      reconciliation: reconciliationView(recorded),
      settled: refreshed.status === "PAID",
    };
  });
}

// --- Office endpoints: checkout, state, check --------------------------------------

export const orderPaymentsRouter = express.Router();

orderPaymentsRouter.post(
  "/billing/orders/:orderId/gateway/checkout",
  wrap(async (req, res) => {
    const a = actor(req, ["admin", "finance"]);
    const orderId = uuid.parse(req.params.orderId);
    const data = z
      .object({
        provider: z.enum(["BKASH", "SSLCOMMERZ"]),
        requestKey: uuid,
      })
      .strict()
      .parse(req.body);
    const token = randomToken();
    const requestHash = digest(
      JSON.stringify({
        orderId,
        provider: data.provider,
        actor: a.userId,
      }),
    );
    const prepared = await transaction(a.tenantId, async (db) => {
      const order = await orderForUpdate(db, a.tenantId, orderId);
      if (order.status === "SETTLED")
        fail(409, "ORDER_ALREADY_SETTLED", "This order is already settled.");
      if (order.status !== "PENDING")
        fail(
          409,
          "ORDER_NOT_PAYABLE",
          "This order can no longer be paid online.",
        );
      if (order.amount_minor <= 0)
        fail(
          409,
          "PAYMENT_NOT_REQUIRED",
          "This order has no amount to collect online; the platform owner can settle it directly.",
        );
      const previous = (
        await db.query(
          "SELECT * FROM order_gateway_payments WHERE tenant_id=$1 AND request_key=$2",
          [a.tenantId, data.requestKey],
        )
      ).rows[0];
      if (previous) {
        if (
          previous.order_id !== orderId ||
          previous.request_hash !== requestHash
        )
          fail(
            409,
            "IDEMPOTENCY_CONFLICT",
            "This request key belongs to another checkout request.",
          );
        return { row: previous, replayed: true };
      }
      const existing = await paymentForOrder(db, a.tenantId, orderId);
      if (existing) return { row: existing, replayed: true };
      const gateway = await platformGateway(data.provider, db);
      const id = randomUUID(),
        invoice = `ORD-${id.replaceAll("-", "")}`;
      const row = (
        await db.query(
          `INSERT INTO order_gateway_payments(tenant_id,id,order_id,provider,environment,merchant_account,invoice,amount_minor,currency,created_by,request_key,request_hash,callback_hash,status)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,'BDT',$9,$10,$11,$12,'CREATE_PENDING') RETURNING *`,
          [
            a.tenantId,
            id,
            orderId,
            gateway.provider,
            gateway.environment,
            gateway.merchantAccount,
            invoice,
            order.amount_minor,
            a.userId,
            data.requestKey,
            requestHash,
            digest(token),
          ],
        )
      ).rows[0];
      await event(db, row, "CREATE_CLAIMED", {}, "create-claimed");
      return { row, replayed: false };
    });
    if (!prepared.replayed) {
      try {
        const gateway = await platformGateway(prepared.row.provider);
        const created = await gateway.create({
          invoice: prepared.row.invoice,
          amountMinor: prepared.row.amount_minor,
          callbackURL:
            gateway.provider === "SSLCOMMERZ"
              ? `${origin()}/api/v1/payments/sslcommerz/callback/order/${token}`
              : `${origin()}/api/v1/payments/bkash/callback/order/${token}`,
          payerReference: prepared.row.id,
        });
        if (
          created.amountMinor !== prepared.row.amount_minor ||
          created.currency !== prepared.row.currency ||
          created.invoice !== prepared.row.invoice ||
          !created.signature
        )
          fail(
            409,
            "GATEWAY_CREATE_MISMATCH",
            "The created gateway checkout does not match the payment order.",
          );
        await transaction(a.tenantId, async (db) => {
          await db.query(
            "UPDATE order_gateway_payments SET payment_id=$3,checkout_url=$4,callback_signature=$5,status='READY',updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status='CREATE_PENDING'",
            [
              a.tenantId,
              prepared.row.id,
              created.paymentId,
              created.checkoutUrl,
              created.signature,
            ],
          );
          await event(db, prepared.row, "CHECKOUT_READY", {}, "checkout-ready");
        });
      } catch (error) {
        await transaction(a.tenantId, async (db) => {
          await db.query(
            "UPDATE order_gateway_payments SET status='CREATE_UNKNOWN',last_error=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status='CREATE_PENDING'",
            [a.tenantId, prepared.row.id, errorCode(error)],
          );
          await event(db, prepared.row, "CREATE_OUTCOME_UNKNOWN", {
            code: errorCode(error),
          });
        });
      }
    }
    const fresh = await transaction(a.tenantId, async (db) =>
      (
        await db.query(
          "SELECT * FROM order_gateway_payments WHERE tenant_id=$1 AND id=$2",
          [a.tenantId, prepared.row.id],
        )
      ).rows[0],
    );
    res
      .status(prepared.replayed ? 200 : 201)
      .json({ payment: paymentView(fresh), replayed: prepared.replayed });
  }),
);

orderPaymentsRouter.get(
  "/billing/orders/:orderId/gateway",
  wrap(async (req, res) => {
    const a = actor(req, ["admin", "finance"]);
    const orderId = uuid.parse(req.params.orderId);
    const state = await transaction(a.tenantId, async (db) => {
      const order = (
        await db.query(
          "SELECT * FROM payment_orders WHERE tenant_id=$1 AND id=$2",
          [a.tenantId, orderId],
        )
      ).rows[0];
      if (!order) fail(404, "ORDER_NOT_FOUND", "Payment order not found.");
      const payment = await paymentForOrder(db, a.tenantId, orderId);
      const invoice = (
        await db.query(
          "SELECT id,issued_at FROM invoices WHERE tenant_id=$1 AND order_id=$2",
          [a.tenantId, orderId],
        )
      ).rows[0];
      const refund = (
        await db.query(
          "SELECT * FROM order_gateway_refunds WHERE tenant_id=$1 AND order_id=$2 ORDER BY requested_at DESC LIMIT 1",
          [a.tenantId, orderId],
        )
      ).rows[0];
      return {
        order: {
          id: order.id,
          kind: order.kind,
          status: order.status,
          amountMinor: order.amount_minor,
          currency: order.currency,
          credits: order.credits,
        },
        payment: paymentView(payment),
        // Settlement issues the order's invoice; it is the receipt of an order payment.
        invoice: invoice
          ? { id: invoice.id, issuedAt: invoice.issued_at }
          : null,
        refund: refund ? refundView(refund) : null,
      };
    });
    res.json({ availability: await orderPaymentsAvailability(), ...state });
  }),
);

/** Manual re-check (also the recovery path when a callback was missed). */
orderPaymentsRouter.post(
  "/billing/orders/:orderId/gateway/check",
  wrap(async (req, res) => {
    const a = actor(req, ["admin", "finance"]);
    const orderId = uuid.parse(req.params.orderId);
    const data = z.object({ requestKey: uuid }).strict().parse(req.body);
    const row = await transaction(a.tenantId, async (db) => {
      const payment = await paymentForOrder(db, a.tenantId, orderId);
      if (!payment)
        fail(404, "NOT_FOUND", "No online payment exists for this order.");
      if (payment.status !== "PAID")
        await reserveCheck(db, payment, `check:${data.requestKey}`);
      return payment;
    });
    if (row.status === "PAID") {
      const latest = await transaction(a.tenantId, async (db) =>
        (
          await db.query(
            "SELECT * FROM order_gateway_reconciliations WHERE tenant_id=$1 AND order_payment_id=$2 ORDER BY checked_at DESC,id DESC LIMIT 1",
            [a.tenantId, row.id],
          )
        ).rows[0],
      );
      return res.json({
        payment: paymentView(row),
        reconciliation: reconciliationView(latest),
        settled: true,
      });
    }
    res.json(await runOrderCheck(row, data.requestKey, a.userId));
  }),
);

// --- Public callbacks: a return/IPN is a signal, never proof ------------------------

export const publicOrderPaymentsRouter = express.Router();
const callbackLimiter = createRateLimiter({ limit: 60, windowMs: 60_000 });

async function locateOrderPayment(token: string) {
  const located = (
    await pool.query("SELECT * FROM resolve_order_gateway_callback($1)", [
      digest(token),
    ])
  ).rows[0];
  if (!located) fail(404, "NOT_FOUND", "Payment callback not found.");
  return located as { tenant_id: string; order_payment_id: string };
}

publicOrderPaymentsRouter.get(
  "/payments/bkash/callback/order/:token",
  callbackLimiter,
  wrap(async (req, res) => {
    const token = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(req.params.token);
    const data = z
      .object({
        paymentID: z.string().min(1).max(200),
        status: z.enum(["success", "failure", "cancel"]),
        signature: z.string().min(1).max(500),
      })
      .strict()
      .parse(req.query);
    const located = await locateOrderPayment(token);
    const claimed = await transaction(located.tenant_id, async (db) => {
      const row = (
        await db.query(
          "SELECT * FROM order_gateway_payments WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [located.tenant_id, located.order_payment_id],
        )
      ).rows[0];
      if (
        !row ||
        !row.callback_signature ||
        row.payment_id !== data.paymentID ||
        !equalSecret(data.signature, row.callback_signature)
      )
        fail(403, "CALLBACK_INVALID", "Gateway callback verification failed.");
      if (
        row.status === "PAID" ||
        (row.execute_started_at &&
          row.status === "EXECUTE_PENDING" &&
          Date.now() - new Date(row.execute_started_at).getTime() < 60000)
      )
        return { row, execute: false, check: false };
      await reserveCheck(db, row, `callback-check:${randomUUID()}`);
      await event(
        db,
        row,
        "GATEWAY_CALLBACK",
        { status: data.status },
        `callback:${digest(JSON.stringify(data))}`,
      );
      if (
        data.status === "success" &&
        !row.execute_started_at &&
        row.status === "READY"
      ) {
        await db.query(
          "UPDATE order_gateway_payments SET execute_started_at=now(),status='EXECUTE_PENDING',updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [row.tenant_id, row.id],
        );
        await event(db, row, "EXECUTE_CLAIMED", {}, "execute-claimed");
        return { row, execute: true, check: true };
      }
      return { row, execute: false, check: true };
    });
    if (claimed.execute) {
      try {
        // The durable claim commits BEFORE this call. Never call execute again,
        // even when this process crashes or the provider response times out.
        await (await platformGateway(claimed.row.provider)).execute(
          claimed.row.payment_id,
        );
        await transaction(claimed.row.tenant_id, async (db) => {
          await db.query(
            "UPDATE order_gateway_payments SET status=CASE WHEN status='PAID' THEN status ELSE 'VERIFYING' END,updated_at=now() WHERE tenant_id=$1 AND id=$2",
            [claimed.row.tenant_id, claimed.row.id],
          );
          await event(db, claimed.row, "EXECUTE_RETURNED");
        });
      } catch (error) {
        await transaction(claimed.row.tenant_id, async (db) => {
          await event(db, claimed.row, "EXECUTE_OUTCOME_UNKNOWN", {
            code: errorCode(error),
          });
        });
      }
    }
    if (claimed.check) await runOrderCheck(claimed.row, randomUUID(), null);
    res.redirect(
      303,
      `${origin()}/payments/return?orderId=${claimed.row.order_id}&attemptId=${claimed.row.id}`,
    );
  }),
);

/**
 * SSLCommerz returns the browser (success, fail or cancel) and sends its IPN as form
 * POSTs to this one URL. Neither is proof: the opaque token finds the attempt, the
 * returned tran_id must be its invoice, and only the session query plus order
 * validation in the check can mark it paid.
 */
publicOrderPaymentsRouter.post(
  "/payments/sslcommerz/callback/order/:token",
  callbackLimiter,
  express.urlencoded({ extended: false, limit: "20kb" }),
  wrap(async (req, res) => {
    const token = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(req.params.token);
    const data = z
      .object({
        tran_id: z.string().min(1).max(100),
        status: z.string().min(1).max(40).optional(),
      })
      .passthrough()
      .parse(req.body ?? {});
    const located = await locateOrderPayment(token);
    const claimed = await transaction(located.tenant_id, async (db) => {
      const row = (
        await db.query(
          "SELECT * FROM order_gateway_payments WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [located.tenant_id, located.order_payment_id],
        )
      ).rows[0];
      if (
        !row ||
        row.provider !== "SSLCOMMERZ" ||
        !row.payment_id ||
        !equalSecret(data.tran_id, row.invoice)
      )
        fail(403, "CALLBACK_INVALID", "Gateway callback verification failed.");
      if (row.status === "PAID") return { row, check: false };
      await reserveCheck(db, row, `callback-check:${randomUUID()}`);
      const reported = String(data.status ?? "").toUpperCase().slice(0, 40);
      await event(
        db,
        row,
        "GATEWAY_CALLBACK",
        { status: reported || "UNKNOWN" },
        `callback:${digest(JSON.stringify({ tran_id: data.tran_id, status: reported, val_id: req.body?.val_id ?? null }))}`,
      );
      if (row.status === "READY" && !row.execute_started_at) {
        // SSLCommerz has no execute step; the claim keeps the shared state machine.
        await db.query(
          "UPDATE order_gateway_payments SET execute_started_at=now(),status='VERIFYING',updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [row.tenant_id, row.id],
        );
        await event(db, row, "EXECUTE_CLAIMED", {}, "execute-claimed");
      }
      return { row, check: true };
    });
    if (claimed.check) await runOrderCheck(claimed.row, randomUUID(), null);
    res.redirect(
      303,
      `${origin()}/payments/return?orderId=${claimed.row.order_id}&attemptId=${claimed.row.id}`,
    );
  }),
);

// --- Refunds ---------------------------------------------------------------------
// Order refunds are full-amount only: an order is one indivisible purchase, so a
// settled refund reverses exactly what settlement granted (the order's credits) and
// flips the order to REFUNDED. The subscription *period* an order bought is not
// auto-reversed — time may already have been consumed; the owner corrects it with
// the existing subscription actions, and the refund audit records that this is so.

export const orderRefundsRouter = express.Router();

orderRefundsRouter.post(
  "/billing/orders/:orderId/gateway-refund",
  wrap(async (req, res) => {
    const a = actor(req, ["admin", "finance"]);
    const orderId = uuid.parse(req.params.orderId);
    const data = z
      .object({
        reason: z.string().trim().min(5).max(255),
        amountMinor: z.number().int().min(1).optional(),
      })
      .strict()
      .parse(req.body);
    const item = await transaction(a.tenantId, async (db) => {
      const order = await orderForUpdate(db, a.tenantId, orderId);
      const payment = await paymentForOrder(db, a.tenantId, orderId);
      if (!payment || payment.status !== "PAID" || order.status !== "SETTLED")
        fail(
          409,
          "ORDER_NOT_PAID",
          "There is no verified online payment to refund for this order.",
        );
      if (
        data.amountMinor !== undefined &&
        data.amountMinor !== payment.amount_minor
      )
        fail(
          422,
          "REFUND_PARTIAL_UNSUPPORTED",
          "Order refunds are full-amount only.",
        );
      const row = (
        await db.query(
          "INSERT INTO order_gateway_refunds(tenant_id,order_id,order_payment_id,amount_minor,reason,requested_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
          [
            a.tenantId,
            orderId,
            payment.id,
            payment.amount_minor,
            data.reason,
            a.userId,
          ],
        )
      ).rows[0];
      await audit(db, a.tenantId, a.userId, "ORDER_REFUND_REQUESTED", row.id, {
        orderId,
        amountMinor: row.amount_minor,
      });
      return refundView(row);
    });
    res.status(201).json(item);
  }),
);
orderRefundsRouter.get(
  "/billing/orders/:orderId/gateway-refunds",
  wrap(async (req, res) => {
    const a = actor(req, ["admin", "finance"]);
    const orderId = uuid.parse(req.params.orderId);
    const items = await transaction(a.tenantId, async (db) =>
      (
        await db.query(
          "SELECT * FROM order_gateway_refunds WHERE tenant_id=$1 AND order_id=$2 ORDER BY requested_at DESC",
          [a.tenantId, orderId],
        )
      ).rows.map(refundView),
    );
    res.json({ items });
  }),
);

/** Owner endpoints act across offices; find a refund's office with the
 * SECURITY DEFINER function from migration 072 (A-012) instead of one
 * tenant transaction per tenant. */
async function locateRefundTenant(refundId: string): Promise<string | null> {
  const row = (
    await pool.query(
      "SELECT locate_order_refund_tenant($1) AS tenant_id",
      [refundId],
    )
  ).rows[0];
  return row?.tenant_id ?? null;
}

/** Reverse a settled refund's effects exactly once, in the settlement transaction. */
async function settleOrderRefund(
  tenantId: string,
  refundId: string,
  actorId: string,
) {
  await transaction(tenantId, async (db) => {
    const refund = (
      await db.query(
        "SELECT * FROM order_gateway_refunds WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [tenantId, refundId],
      )
    ).rows[0];
    if (!refund || refund.status !== "SENT") return;
    const payment = (
      await db.query(
        "SELECT * FROM order_gateway_payments WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [tenantId, refund.order_payment_id],
      )
    ).rows[0];
    const order = await orderForUpdate(db, tenantId, refund.order_id);
    if (order.status === "SETTLED") {
      await db.query(
        "INSERT INTO credit_ledger(tenant_id,delta,kind,idempotency_key,actor_id,reason,balance_after) VALUES($1,$2,'ADJUSTMENT',$3,$4,$5,0)",
        [
          tenantId,
          -order.credits,
          `refund:${refund.id}`,
          actorId,
          "Gateway refund reversal",
        ],
      );
      await db.query(
        "UPDATE payment_orders SET status='REFUNDED' WHERE id=$1",
        [order.id],
      );
    }
    if (payment && payment.status === "PAID")
      await db.query(
        "UPDATE order_gateway_payments SET status='REFUNDED',updated_at=now() WHERE tenant_id=$1 AND id=$2",
        [tenantId, payment.id],
      );
    await db.query(
      "UPDATE order_gateway_refunds SET status='SETTLED',settled_at=now(),last_error=NULL WHERE tenant_id=$1 AND id=$2",
      [tenantId, refundId],
    );
    await audit(db, tenantId, actorId, "ORDER_REFUND_SETTLED", refundId, {
      orderId: refund.order_id,
      amountMinor: refund.amount_minor,
      subscriptionPeriodReversed: false,
    });
  });
}

/** Send an approved refund to the provider, once: the refund id is stored before the call. */
async function sendOrderRefund(
  tenantId: string,
  refundId: string,
  actorId: string,
) {
  const claimed = await transaction(tenantId, async (db) => {
    const r = (
      await db.query(
        `SELECT r.*,p.provider,p.payment_id,p.transaction_id,p.evidence FROM order_gateway_refunds r
         JOIN order_gateway_payments p ON p.tenant_id=r.tenant_id AND p.id=r.order_payment_id
         WHERE r.tenant_id=$1 AND r.id=$2 FOR UPDATE OF r`,
        [tenantId, refundId],
      )
    ).rows[0];
    if (!r || !["APPROVED", "SENT"].includes(r.status) || r.provider_reference)
      return null;
    const providerRefundId =
      r.provider_refund_id ??
      `RF${randomBytes(12).toString("hex").toUpperCase()}`.slice(0, 30);
    if (!r.provider_refund_id)
      await db.query(
        "UPDATE order_gateway_refunds SET status='SENT',provider_refund_id=$3,sent_at=now() WHERE tenant_id=$1 AND id=$2",
        [tenantId, refundId, providerRefundId],
      );
    return { ...r, provider_refund_id: providerRefundId };
  });
  if (!claimed) return;
  try {
    const gateway: any = await platformGateway(claimed.provider);
    let result: {
      accepted: boolean;
      settled?: boolean;
      reference?: string;
      error?: string;
    };
    if (gateway instanceof SslcommerzGateway)
      result = await gateway.refund({
        bankTransactionId: String(claimed.evidence?.providerReference ?? ""),
        refundId: claimed.provider_refund_id,
        amountMinor: claimed.amount_minor,
        remarks: claimed.reason,
      });
    else if (typeof gateway.refundPayment === "function")
      result = await gateway.refundPayment({
        paymentId: claimed.payment_id,
        trxId: claimed.transaction_id,
        amountMinor: claimed.amount_minor,
        reason: claimed.reason,
        sku: `ORD-${claimed.order_id.slice(0, 8)}`,
      });
    else
      throw Object.assign(new Error(), {
        code: "REFUND_PROVIDER_UNSUPPORTED",
      });
    await transaction(tenantId, async (db) => {
      if (result.accepted)
        await db.query(
          "UPDATE order_gateway_refunds SET provider_reference=$3,last_error=NULL WHERE tenant_id=$1 AND id=$2",
          [tenantId, refundId, result.reference],
        );
      if (!result.accepted)
        await db.query(
          "UPDATE order_gateway_refunds SET status='FAILED',last_error=$3 WHERE tenant_id=$1 AND id=$2",
          [tenantId, refundId, result.error ?? "REFUND_NOT_INITIATED"],
        );
      await audit(
        db,
        tenantId,
        actorId,
        result.accepted ? "ORDER_REFUND_SENT" : "ORDER_REFUND_FAILED",
        refundId,
        { reference: result.reference ?? null, error: result.error ?? null },
      );
    });
    if (result.accepted && result.settled)
      await settleOrderRefund(tenantId, refundId, actorId);
  } catch (error: any) {
    // The outcome is unknown: keep it SENT with the same refund id, so a retry
    // repeats the same request.
    await transaction(tenantId, (db) =>
      db.query(
        "UPDATE order_gateway_refunds SET last_error=$3 WHERE tenant_id=$1 AND id=$2",
        [
          tenantId,
          refundId,
          typeof error?.code === "string"
            ? error.code
            : "REFUND_OUTCOME_UNKNOWN",
        ],
      ),
    );
  }
}

export const ownerOrderRefundsRouter = express.Router();

ownerOrderRefundsRouter.post(
  "/owner/payment-orders/:orderId/gateway-refund/decision",
  wrap(async (req, res) => {
    const a = ownerActor(req);
    const data = z
      .object({
        refundId: uuid,
        decision: z.enum(["APPROVED", "REJECTED"]),
        note: z.string().trim().min(3).max(500).optional(),
      })
      .strict()
      .refine((v) => v.decision !== "REJECTED" || !!v.note, {
        message: "Give a reason for rejecting.",
      })
      .parse(req.body);
    const tenantId = await locateRefundTenant(data.refundId);
    if (!tenantId) fail(404, "NOT_FOUND", "Refund not found.");
    await transaction(tenantId!, async (db) => {
      const r = (
        await db.query(
          "SELECT * FROM order_gateway_refunds WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [tenantId, data.refundId],
        )
      ).rows[0];
      if (!r) fail(404, "NOT_FOUND", "Refund not found.");
      if (r.order_id !== req.params.orderId)
        fail(404, "NOT_FOUND", "Refund not found.");
      if (r.status !== "REQUESTED")
        fail(409, "REFUND_ALREADY_DECIDED", "This refund has already been decided.");
      await db.query(
        "UPDATE order_gateway_refunds SET status=$3,decided_by=$4,decided_at=now(),decision_note=$5,expected_by=$6 WHERE tenant_id=$1 AND id=$2",
        [
          tenantId,
          data.refundId,
          data.decision,
          a.userId,
          data.note ?? null,
          data.decision === "APPROVED" ? workingDaysAfter(new Date()) : null,
        ],
      );
      await audit(
        db,
        tenantId!,
        a.userId,
        data.decision === "APPROVED"
          ? "ORDER_REFUND_APPROVED"
          : "ORDER_REFUND_REJECTED",
        data.refundId,
        { note: data.note ?? null },
      );
    });
    if (data.decision === "APPROVED")
      await sendOrderRefund(tenantId!, data.refundId, a.userId);
    const row = await transaction(tenantId!, async (db) =>
      (
        await db.query(
          "SELECT * FROM order_gateway_refunds WHERE tenant_id=$1 AND id=$2",
          [tenantId, data.refundId],
        )
      ).rows[0],
    );
    res.json(refundView(row));
  }),
);

/** Check a sent refund with the provider (and retry a send whose outcome was unknown). */
ownerOrderRefundsRouter.post(
  "/owner/payment-orders/:orderId/gateway-refund/refresh",
  wrap(async (req, res) => {
    const a = ownerActor(req);
    const data = z.object({ refundId: uuid }).strict().parse(req.body);
    const tenantId = await locateRefundTenant(data.refundId);
    if (!tenantId) fail(404, "NOT_FOUND", "Refund not found.");
    await sendOrderRefund(tenantId!, data.refundId, a.userId);
    const r = await transaction(tenantId!, async (db) =>
      (
        await db.query(
          `SELECT r.*,p.provider,p.payment_id,p.transaction_id FROM order_gateway_refunds r
           JOIN order_gateway_payments p ON p.tenant_id=r.tenant_id AND p.id=r.order_payment_id
           WHERE r.tenant_id=$1 AND r.id=$2`,
          [tenantId, data.refundId],
        )
      ).rows[0],
    );
    if (!r) fail(404, "NOT_FOUND", "Refund not found.");
    if (r.status === "SENT" && r.provider_reference) {
      const gateway: any = await platformGateway(r.provider);
      if (
        gateway instanceof SslcommerzGateway ||
        typeof gateway.refundStatusOf === "function"
      ) {
        const state =
          gateway instanceof SslcommerzGateway
            ? await gateway.refundStatus(r.provider_reference)
            : (await gateway.refundStatusOf(r.payment_id, r.transaction_id))
                  ?.status === "Completed"
              ? "refunded"
              : "processing";
        if (state === "refunded")
          await settleOrderRefund(tenantId!, data.refundId, a.userId);
      }
    }
    const row = await transaction(tenantId!, async (db) =>
      (
        await db.query(
          "SELECT * FROM order_gateway_refunds WHERE tenant_id=$1 AND id=$2",
          [tenantId, data.refundId],
        )
      ).rows[0],
    );
    res.json(refundView(row));
  }),
);
