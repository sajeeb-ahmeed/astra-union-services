import express from "express";
import { z } from "zod";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { pool, transaction, audit, type DB } from "./db.js";
import { fail } from "./models.js";
import { digest, randomToken } from "./security.js";
import { renderHtmlPdf } from "./pdf.js";
import { createRateLimiter } from "./http-hardening.js";
import {
  type Gateway,
  type PaymentResult,
  type TransactionResult,
} from "./bkash.js";
import { gatewayAvailability, resolveGateway, type Provider } from "./gateways.js";
import type { Auth } from "./app.js";

type Req = express.Request & { auth?: Auth };
type Actor = Auth & { tenantId: string };
const uuid = z.string().uuid();
const requestInput = z.object({ requestKey: uuid }).strict();
const readRoles = [
  "citizen",
  "staff",
  "admin",
  "reviewer",
  "approver",
  "finance",
];
const wrap =
  (fn: (req: Req, res: express.Response) => Promise<unknown>) =>
  (req: Req, res: express.Response, next: express.NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);
function actor(req: Req, roles = readRoles): Actor {
  if (!req.auth) fail(401, "LOGIN_REQUIRED", "Sign in required.");
  if (!roles.includes(req.auth.role))
    fail(403, "ROLE_DENIED", "This role is not permitted.");
  if (!req.auth.tenantId)
    fail(403, "TENANT_REQUIRED", "An active office membership is required.");
  return req.auth as Actor;
}
const origin = () => process.env.PUBLIC_ORIGIN ?? "http://127.0.0.1:5173";
const safeNumber = (value: unknown) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number))
    fail(
      422,
      "AMOUNT_OUT_OF_RANGE",
      "Amount exceeds the supported integer range.",
    );
  return number;
};
function calendarDate(value: unknown) {
  const day = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .parse(value);
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== day)
    fail(422, "DATE_INVALID", "Enter a valid calendar date.");
  return day;
}
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
async function event(
  db: DB,
  row: any,
  kind: string,
  metadata: object = {},
  key: string = randomUUID(),
) {
  await db.query(
    "INSERT INTO gateway_payment_events(tenant_id,intent_id,event_key,event_type,metadata) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,intent_id,event_key) DO NOTHING",
    [row.tenant_id, row.id, key, kind, JSON.stringify(metadata)],
  );
}
/** Callers hold the intent lock so concurrent workers share one durable budget. */
async function reserveCheck(db: DB, row: any, key: string) {
  const recent = (
    await db.query(
      "SELECT count(*)::int count FROM gateway_payment_events WHERE tenant_id=$1 AND intent_id=$2 AND event_type='PAYMENT_CHECK_CLAIMED' AND created_at>now()-interval '5 minutes'",
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
async function application(db: DB, id: string, a: Actor, lock = false) {
  const row = (
    await db.query(
      `SELECT a.*,c.full_name_en,c.full_name_bn FROM applications a JOIN citizens c ON c.tenant_id=a.tenant_id AND c.id=a.citizen_id WHERE a.tenant_id=$1 AND a.id=$2 ${a.role === "citizen" ? "AND c.user_id=$3" : ""} ${lock ? "FOR SHARE OF a" : ""}`,
      a.role === "citizen" ? [a.tenantId, id, a.userId] : [a.tenantId, id],
    )
  ).rows[0];
  if (!row) fail(404, "NOT_FOUND", "Application not found.");
  return row;
}
async function authorizedIntent(db: DB, id: string, a: Actor) {
  const row = (
    await db.query(
      "SELECT * FROM gateway_payment_intents WHERE tenant_id=$1 AND id=$2",
      [a.tenantId, id],
    )
  ).rows[0];
  if (!row) fail(404, "NOT_FOUND", "Payment not found.");
  await application(db, row.application_id, a);
  return row;
}
async function intentView(db: DB, row: any) {
  const receipt = (
    await db.query(
      "SELECT id FROM gateway_payment_receipts WHERE tenant_id=$1 AND intent_id=$2",
      [row.tenant_id, row.id],
    )
  ).rows[0];
  const lastCheck = (
    await db.query(
      "SELECT result,reason,checked_at,metadata FROM gateway_payment_reconciliations WHERE tenant_id=$1 AND intent_id=$2 ORDER BY checked_at DESC,id DESC LIMIT 1",
      [row.tenant_id, row.id],
    )
  ).rows[0];
  return {
    id: row.id,
    applicationId: row.application_id,
    provider: row.provider,
    environment: row.environment,
    status: row.status,
    paymentStatus: await applicationPaymentState(
      db,
      row.application_id,
      row.amount_minor,
    ),
    lastReconciliation: lastCheck
      ? {
          result: lastCheck.result,
          reason: lastCheck.reason,
          checkedAt: lastCheck.checked_at,
          details: lastCheck.metadata,
        }
      : null,
    amountMinor: row.amount_minor,
    currency: row.currency,
    invoice: row.invoice,
    checkoutUrl: row.status === "READY" ? row.checkout_url : null,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    receiptId: receipt?.id ?? null,
  };
}
function receiptView(row: any) {
  return {
    id: row.id,
    receiptNumber: row.receipt_number,
    applicationId: row.application_id,
    paymentId: row.intent_id,
    amountMinor: row.snapshot.amountMinor,
    currency: row.snapshot.currency,
    environment: row.snapshot.environment,
    transactionId: row.snapshot.transactionId,
    issuedAt: row.issued_at,
    snapshot: row.snapshot,
    pdfSha256: row.pdf_sha256,
    pdfUrl: `/api/v1/receipts/${row.id}/pdf`,
  };
}
async function findReceipt(db: DB, intentId: string) {
  const row = (
    await db.query(
      "SELECT id,tenant_id,intent_id,application_id,receipt_number,snapshot,pdf_sha256,issued_at FROM gateway_payment_receipts WHERE intent_id=$1",
      [intentId],
    )
  ).rows[0];
  return row ? receiptView(row) : null;
}
/** Financial state comes from immutable evidence, never a browser return flag. */
export async function applicationPaymentState(
  db: DB,
  applicationId: string,
  totalMinor: number,
) {
  if (totalMinor === 0) return "NOT_REQUIRED" as const;
  const confirmed = (
    await db.query(
      `SELECT 1 FROM gateway_payment_confirmations p JOIN gateway_payment_receipts r ON r.tenant_id=p.tenant_id AND r.intent_id=p.intent_id AND r.application_id=p.application_id
    JOIN application_order_snapshots o ON o.tenant_id=p.tenant_id AND o.application_id=p.application_id
    WHERE p.application_id=$1 AND p.amount_minor=o.total_minor AND p.currency=o.currency`,
      [applicationId],
    )
  ).rowCount;
  if (confirmed) {
    // Phase 5d: an approved, sent or settled refund means the fee no longer counts as paid.
    const refund = (
      await db.query(
        "SELECT status FROM application_refunds WHERE application_id=$1 AND status IN ('APPROVED','SENT','SETTLED') LIMIT 1",
        [applicationId],
      )
    ).rows[0];
    if (refund) return refund.status === "SETTLED" ? ("REFUNDED" as const) : ("REFUND_PENDING" as const);
    const decisive = (
      await db.query(
        `SELECT r.result FROM gateway_payment_reconciliations r JOIN gateway_payment_confirmations p ON p.tenant_id=r.tenant_id AND p.intent_id=r.intent_id
      WHERE p.application_id=$1 AND r.result IN ('MATCHED','MISMATCH') ORDER BY r.checked_at DESC,r.id DESC LIMIT 1`,
        [applicationId],
      )
    ).rows[0];
    return decisive?.result === "MISMATCH"
      ? ("REVIEW_REQUIRED" as const)
      : ("COLLECTED" as const);
  }
  const pending = (
    await db.query(
      "SELECT 1 FROM gateway_payment_intents WHERE application_id=$1",
      [applicationId],
    )
  ).rowCount;
  return pending ? ("PENDING" as const) : ("NOT_COLLECTED" as const);
}
async function gatewayFor(row: any): Promise<Gateway> {
  const gateway = await resolveGateway(row.tenant_id, row.provider as Provider);
  if (
    gateway.provider !== row.provider ||
    gateway.environment !== row.environment ||
    gateway.merchantAccount !== row.merchant_account
  )
    fail(
      409,
      "GATEWAY_BINDING_CHANGED",
      "The configured gateway no longer matches this payment. Restore its original merchant configuration for recovery.",
    );
  return gateway;
}
function queryMatches(row: any, result: PaymentResult) {
  return (
    result.paymentId === row.payment_id &&
    result.amountMinor === row.amount_minor &&
    result.currency === row.currency &&
    result.invoice === row.invoice &&
    result.intent.toLowerCase() === "sale"
  );
}
function searchMatches(
  row: any,
  query: PaymentResult,
  result: TransactionResult,
) {
  return (
    result.transactionId === query.transactionId &&
    result.amountMinor === row.amount_minor &&
    result.currency === row.currency &&
    result.merchantAccount === row.merchant_account
  );
}
const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const money = (minor: number) =>
  `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
function receiptHtml(number: string, snapshot: any) {
  const labels: Record<string, string> = {
    statutory_fee: "Government fee / সরকারি ফি",
    processing_fee: "Processing fee / প্রক্রিয়াকরণ ফি",
    emergency_surcharge: "Urgency surcharge / জরুরি ফি",
    delivery_fee: "Delivery fee / বিতরণ ফি",
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(number)}</title><style>@page{size:A4;margin:22mm}body{font:14px 'Nirmala UI','Noto Sans Bengali',sans-serif;line-height:1.65;color:#153c38}h1{font-size:24px}h2{font-size:18px}.notice{border:2px solid #9b2828;padding:10px;color:#9b2828}table{border-collapse:collapse;width:100%;margin:22px 0}td,th{text-align:left;padding:8px;border-bottom:1px solid #b7ccc5}.value{text-align:right}small{font-size:11px}.ref{overflow-wrap:anywhere}</style></head><body>
    <p class="notice">${snapshot.environment === "SANDBOX" ? "SANDBOX / TEST PAYMENT — NO REAL MONEY COLLECTED / পরীক্ষামূলক পেমেন্ট" : "ONLINE PAYMENT RECEIPT / অনলাইন পেমেন্ট রসিদ"}</p>
    <h1>Payment receipt / পেমেন্ট রসিদ</h1><h2>${escapeHtml(snapshot.officeName)}<br>${escapeHtml(snapshot.officeNameBn)}</h2>
    <p class="ref">Receipt: ${escapeHtml(number)}<br>Applicant / আবেদনকারী: ${escapeHtml(snapshot.applicantName)} / ${escapeHtml(snapshot.applicantNameBn)}<br>Service: ${escapeHtml(snapshot.serviceNo)} — ${escapeHtml(snapshot.serviceName)}<br>Application: ${escapeHtml(snapshot.applicationId)}<br>${snapshot.provider === "SSLCOMMERZ" ? "SSLCommerz validation" : "bKash transaction"}: ${escapeHtml(snapshot.transactionId)}<br>Merchant invoice: ${escapeHtml(snapshot.invoice)}<br>Verified at: ${escapeHtml(snapshot.verifiedAt)}</p>
    <table><thead><tr><th>Fee component / ফি</th><th class="value">BDT / টাকা</th></tr></thead><tbody>${snapshot.components.map((component: any) => `<tr><td>${escapeHtml(labels[component.code] ?? component.code)}</td><td class="value">${money(component.amountMinor)}</td></tr>`).join("")}<tr><th>Total / মোট</th><th class="value">${money(snapshot.amountMinor)}</th></tr></tbody></table>
    ${snapshot.provider === "SSLCOMMERZ" ? "<p>Verified through the SSLCommerz session query and order validation APIs. This receipt records the application fee payment. It does not grant certificate approval.</p><p>এসএসএলকমার্জের সার্ভার যাচাইয়ের ভিত্তিতে আবেদন ফি পরিশোধের রসিদ। সনদের অনুমোদন আলাদা প্রক্রিয়া।</p>" : "<p>Verified through the bKash payment query and transaction search APIs. This receipt records the application fee payment. It does not grant certificate approval.</p><p>বিকাশের সার্ভার যাচাইয়ের ভিত্তিতে আবেদন ফি পরিশোধের রসিদ। সনদের অনুমোদন আলাদা প্রক্রিয়া।</p>"}
    <small>Bank payout reconciliation is not connected. Certificate documents remain DEMO / NOT OFFICIAL until official signing is configured. No wallet PIN or OTP is stored by DigitalUnion.</small></body></html>`;
}
async function finalize(
  row: any,
  query: PaymentResult,
  search: TransactionResult,
  testFailure = false,
) {
  const prepared = await transaction(row.tenant_id, async (db) => {
    const existing = await findReceipt(db, row.id);
    if (existing) {
      if (existing.transactionId !== query.transactionId)
        fail(
          409,
          "GATEWAY_TRANSACTION_CHANGED",
          "Gateway transaction identity differs from the immutable receipt.",
        );
      return { existing };
    }
    const data = (
      await db.query(
        `SELECT t.name_en office_name,t.name_bn office_name_bn,c.full_name_en,c.full_name_bn,a.service_no,s.name_en service_name,o.*
      FROM applications a JOIN citizens c ON c.tenant_id=a.tenant_id AND c.id=a.citizen_id JOIN tenants t ON t.id=a.tenant_id
      JOIN service_catalog s ON s.service_no=a.service_no JOIN application_order_snapshots o ON o.tenant_id=a.tenant_id AND o.application_id=a.id WHERE a.tenant_id=$1 AND a.id=$2`,
        [row.tenant_id, row.application_id],
      )
    ).rows[0];
    if (!data || data.total_minor !== row.amount_minor)
      fail(
        409,
        "PAYMENT_ORDER_MISMATCH",
        "The stored application fee does not match the gateway intent.",
      );
    const snapshot = {
      verification:
        row.provider === "SSLCOMMERZ"
          ? "SSLCOMMERZ_SESSION_QUERY_AND_VALIDATION"
          : "BKASH_QUERY_AND_SEARCH",
      environment: row.environment,
      provider: row.provider,
      bankSettlement: "NOT_CONNECTED",
      officeName: data.office_name,
      officeNameBn: data.office_name_bn,
      applicantName: data.full_name_en,
      applicantNameBn: data.full_name_bn,
      applicationId: row.application_id,
      serviceNo: data.service_no,
      serviceName: data.service_name,
      transactionId: query.transactionId!,
      invoice: row.invoice,
      amountMinor: row.amount_minor,
      currency: row.currency,
      verifiedAt: new Date().toISOString(),
      components: [
        { code: "statutory_fee", amountMinor: data.statutory_fee_minor },
        { code: "processing_fee", amountMinor: data.processing_fee_minor },
        {
          code: "emergency_surcharge",
          amountMinor: data.emergency_surcharge_minor,
        },
        { code: "delivery_fee", amountMinor: data.delivery_fee_minor },
      ],
    };
    return { snapshot };
  });
  if (prepared.existing) return prepared.existing;
  const receiptId = randomUUID(),
    receiptNumber = `${row.environment === "SANDBOX" ? "TEST-" : ""}${row.provider === "SSLCOMMERZ" ? "SSLC" : "BKASH"}-${receiptId.toUpperCase()}`;
  const pdf = await renderHtmlPdf(
    receiptHtml(receiptNumber, prepared.snapshot),
  );
  return transaction(row.tenant_id, async (db) => {
    const current = (
      await db.query(
        "SELECT * FROM gateway_payment_intents WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [row.tenant_id, row.id],
      )
    ).rows[0];
    const existing = await findReceipt(db, row.id);
    if (existing) {
      if (existing.transactionId !== query.transactionId)
        fail(
          409,
          "GATEWAY_TRANSACTION_CHANGED",
          "Gateway transaction identity differs from the immutable receipt.",
        );
      return existing;
    }
    if (
      !queryMatches(current, query) ||
      !searchMatches(current, query, search) ||
      query.status !== "Completed" ||
      search.status !== "Completed" ||
      !query.transactionId
    )
      fail(
        409,
        "GATEWAY_EVIDENCE_MISMATCH",
        "Gateway evidence does not match the payment request.",
      );
    const duplicate = (
      await db.query(
        "SELECT intent_id FROM gateway_payment_confirmations WHERE provider=$1 AND environment=$2 AND merchant_account=$3 AND transaction_id=$4",
        [
          row.provider,
          row.environment,
          row.merchant_account,
          query.transactionId,
        ],
      )
    ).rows[0];
    if (duplicate && duplicate.intent_id !== row.id)
      fail(
        409,
        "GATEWAY_TRANSACTION_REUSED",
        "This provider transaction is already bound to another payment.",
      );
    const evidence = {
      queryStatus: query.status,
      searchStatus: search.status,
      merchantMatched: true,
      invoiceMatched: true,
      amountMatched: true,
      currencyMatched: true,
      ...(search.serviceFeeMinor === undefined
        ? {}
        : { serviceFeeMinor: search.serviceFeeMinor }),
      ...(search.creditedAmountMinor === undefined
        ? {}
        : { creditedAmountMinor: search.creditedAmountMinor }),
      ...(search.providerReference ? { providerReference: search.providerReference } : {}),
    };
    await db.query(
      `INSERT INTO gateway_payment_confirmations(tenant_id,intent_id,application_id,provider,environment,merchant_account,payment_id,transaction_id,invoice,amount_minor,currency,evidence)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        row.tenant_id,
        row.id,
        row.application_id,
        row.provider,
        row.environment,
        row.merchant_account,
        row.payment_id,
        query.transactionId,
        row.invoice,
        row.amount_minor,
        row.currency,
        JSON.stringify(evidence),
      ],
    );
    if (testFailure && process.env.NODE_ENV === "test")
      fail(
        500,
        "TEST_PAYMENT_FAILURE",
        "Injected failure before receipt commit.",
      );
    const receipt = (
      await db.query(
        `INSERT INTO gateway_payment_receipts(tenant_id,id,intent_id,application_id,receipt_number,snapshot,pdf_bytes,pdf_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          row.tenant_id,
          receiptId,
          row.id,
          row.application_id,
          receiptNumber,
          JSON.stringify(prepared.snapshot),
          pdf,
          digest(pdf),
        ],
      )
    ).rows[0];
    await db.query(
      "UPDATE gateway_payment_intents SET status='PAID',last_error=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2",
      [row.tenant_id, row.id],
    );
    await event(
      db,
      row,
      "PAYMENT_VERIFIED",
      {
        receiptId,
        transactionId: query.transactionId,
        environment: row.environment,
      },
      "payment-verified",
    );
    await audit(
      db,
      row.tenant_id,
      row.created_by,
      "CITIZEN_GATEWAY_PAYMENT_VERIFIED",
      row.id,
      {
        receiptId,
        environment: row.environment,
        amountMinor: row.amount_minor,
      },
    );
    return receiptView(receipt);
  });
}
type CheckResult = {
  result: "MATCHED" | "MISMATCH" | "PENDING" | "ERROR";
  reason: string;
  receipt: ReturnType<typeof receiptView> | null;
  metadata?: object;
};
async function checkPayment(
  row: any,
  testFailure = false,
): Promise<CheckResult> {
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
      receipt: null,
      metadata,
    };
  try {
    const gateway = await gatewayFor(row);
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
      return {
        result: "MISMATCH",
        reason: "GATEWAY_QUERY_MISMATCH",
        receipt: null,
        metadata,
      };
    if (query.status !== "Completed")
      return {
        result: row.status === "PAID" ? "MISMATCH" : "PENDING",
        reason:
          row.status === "PAID"
            ? "GATEWAY_STATUS_CHANGED"
            : "PROVIDER_PAYMENT_NOT_COMPLETED",
        receipt: null,
        metadata,
      };
    if (!query.transactionId)
      return {
        result: "MISMATCH",
        reason: "GATEWAY_TRANSACTION_MISSING",
        receipt: null,
        metadata,
      };
    const search = await gateway.search(query.transactionId);
    metadata.search = {
      transactionId: search.transactionId,
      status: search.status,
      amountMinor: search.amountMinor,
      currency: search.currency,
      merchantMatched: search.merchantAccount === row.merchant_account,
      ...(search.serviceFeeMinor === undefined
        ? {}
        : { serviceFeeMinor: search.serviceFeeMinor }),
      ...(search.creditedAmountMinor === undefined
        ? {}
        : { creditedAmountMinor: search.creditedAmountMinor }),
    };
    if (!searchMatches(row, query, search) || search.status !== "Completed")
      return {
        result: "MISMATCH",
        reason: "GATEWAY_TRANSACTION_MISMATCH",
        receipt: null,
        metadata,
      };
    return {
      result: "MATCHED",
      reason: "PROVIDER_TRANSACTION_MATCHED",
      receipt: await finalize(row, query, search, testFailure),
      metadata,
    };
  } catch (error) {
    if (
      process.env.NODE_ENV === "test" &&
      (error as any).code === "TEST_PAYMENT_FAILURE"
    )
      throw error;
    const code = errorCode(error);
    return {
      result:
        code === "GATEWAY_TRANSACTION_CHANGED" ||
        code === "GATEWAY_TRANSACTION_REUSED"
          ? "MISMATCH"
          : "ERROR",
      reason: code,
      receipt: null,
      metadata,
    };
  }
}
async function recordCheck(
  row: any,
  check: CheckResult,
  key: string,
  actorId: string | null,
) {
  return transaction(row.tenant_id, async (db) => {
    const current = (
      await db.query(
        "SELECT * FROM gateway_payment_intents WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [row.tenant_id, row.id],
      )
    ).rows[0];
    const previous = (
      await db.query(
        "SELECT * FROM gateway_payment_reconciliations WHERE tenant_id=$1 AND request_key=$2",
        [row.tenant_id, key],
      )
    ).rows[0];
    if (previous && previous.intent_id !== row.id)
      fail(
        409,
        "IDEMPOTENCY_CONFLICT",
        "This request key belongs to another payment.",
      );
    const result =
      previous ??
      (
        await db.query(
          `INSERT INTO gateway_payment_reconciliations(tenant_id,intent_id,request_key,actor_id,result,reason,metadata) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [
            row.tenant_id,
            row.id,
            key,
            actorId,
            check.result,
            check.reason,
            JSON.stringify(check.metadata ?? {}),
          ],
        )
      ).rows[0];
    if (current.status !== "PAID" && check.result === "MISMATCH")
      await db.query(
        "UPDATE gateway_payment_intents SET status='REVIEW_REQUIRED',last_error=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2",
        [row.tenant_id, row.id, check.reason],
      );
    else if (current.status !== "PAID" && check.result === "ERROR")
      await db.query(
        "UPDATE gateway_payment_intents SET last_error=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2",
        [row.tenant_id, row.id, check.reason],
      );
    const refreshed = (
      await db.query(
        "SELECT * FROM gateway_payment_intents WHERE tenant_id=$1 AND id=$2",
        [row.tenant_id, row.id],
      )
    ).rows[0];
    return {
      attempt: await intentView(db, refreshed),
      reconciliation: {
        id: result.id,
        result: result.result,
        reason: result.reason,
        checkedAt: result.checked_at,
        bankSettlement: "NOT_CONNECTED",
      },
      receipt: await findReceipt(db, row.id),
    };
  });
}

export const publicPaymentsRouter = express.Router();
const callbackLimiter = createRateLimiter({ limit: 60, windowMs: 60_000 });
publicPaymentsRouter.get(
  "/payments/bkash/callback/:token",
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
    const located = (
      await pool.query("SELECT * FROM resolve_gateway_callback($1)", [
        digest(token),
      ])
    ).rows[0];
    if (!located) fail(404, "NOT_FOUND", "Payment callback not found.");
    const claimed = await transaction(located.tenant_id, async (db) => {
      const row = (
        await db.query(
          "SELECT * FROM gateway_payment_intents WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [located.tenant_id, located.intent_id],
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
          "UPDATE gateway_payment_intents SET execute_started_at=now(),status='EXECUTE_PENDING',updated_at=now() WHERE tenant_id=$1 AND id=$2",
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
        await (await gatewayFor(claimed.row)).execute(claimed.row.payment_id);
        await transaction(claimed.row.tenant_id, async (db) => {
          await db.query(
            "UPDATE gateway_payment_intents SET status=CASE WHEN status='PAID' THEN status ELSE 'VERIFYING' END,updated_at=now() WHERE tenant_id=$1 AND id=$2",
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
    if (claimed.check) {
      const check = await checkPayment(claimed.row);
      await recordCheck(claimed.row, check, randomUUID(), null);
    }
    res.redirect(
      303,
      `${origin()}/payments/return?applicationId=${claimed.row.application_id}&attemptId=${claimed.row.id}`,
    );
  }),
);

/**
 * Phase 5c: SSLCommerz returns the browser (success, fail or cancel) and sends its IPN as form POSTs to this
 * one URL. Neither is proof of payment: the opaque token finds the attempt, the returned tran_id must be its
 * invoice, and only the session query plus order validation in checkPayment can mark it paid.
 */
publicPaymentsRouter.post(
  "/payments/sslcommerz/callback/:token",
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
    const located = (
      await pool.query("SELECT * FROM resolve_gateway_callback($1)", [
        digest(token),
      ])
    ).rows[0];
    if (!located) fail(404, "NOT_FOUND", "Payment callback not found.");
    const claimed = await transaction(located.tenant_id, async (db) => {
      const row = (
        await db.query(
          "SELECT * FROM gateway_payment_intents WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [located.tenant_id, located.intent_id],
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
        // SSLCommerz has no execute step; the claim keeps the shared state machine and its events.
        await db.query(
          "UPDATE gateway_payment_intents SET execute_started_at=now(),status='VERIFYING',updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [row.tenant_id, row.id],
        );
        await event(db, row, "EXECUTE_CLAIMED", {}, "execute-claimed");
      }
      return { row, check: true };
    });
    if (claimed.check) {
      const check = await checkPayment(claimed.row);
      await recordCheck(claimed.row, check, randomUUID(), null);
    }
    res.redirect(
      303,
      `${origin()}/payments/return?applicationId=${claimed.row.application_id}&attemptId=${claimed.row.id}`,
    );
  }),
);

export const paymentsRouter = express.Router();
paymentsRouter.get(
  "/payments/configuration",
  wrap(async (req, res) => {
    const a = actor(req);
    res.json(await gatewayAvailability(a.tenantId));
  }),
);
paymentsRouter.get(
  "/applications/:id/payment",
  wrap(async (req, res) => {
    const a = actor(req),
      id = uuid.parse(req.params.id);
    const result = await transaction(a.tenantId, async (db) => {
      const app = await application(db, id, a);
      const order = (
        await db.query(
          "SELECT * FROM application_order_snapshots WHERE application_id=$1",
          [id],
        )
      ).rows[0];
      const intent = (
        await db.query(
          "SELECT * FROM gateway_payment_intents WHERE application_id=$1",
          [id],
        )
      ).rows[0];
      const availability = await gatewayAvailability(a.tenantId, db);
      return {
        applicationId: id,
        totalMinor: order?.total_minor ?? 0,
        currency: "BDT",
        paymentStatus: order
          ? await applicationPaymentState(db, id, order.total_minor)
          : "LEGACY",
        eligible: Boolean(
          order?.total_minor > 0 &&
            app.state === "APPROVED" &&
            availability.anyAvailable,
        ),
        availability,
        attempt: intent ? await intentView(db, intent) : null,
        receipt: intent ? await findReceipt(db, intent.id) : null,
      };
    });
    res.json(result);
  }),
);
paymentsRouter.post(
  "/applications/:id/payments",
  wrap(async (req, res) => {
    const a = actor(req, ["citizen", "staff", "admin"]),
      id = uuid.parse(req.params.id);
    const data = z
      .object({ provider: z.enum(["BKASH", "SSLCOMMERZ"]), requestKey: uuid })
      .strict()
      .parse(req.body);
    const requestHash = digest(
      JSON.stringify({ applicationId: id, provider: data.provider }),
    );
    const token = randomToken();
    const prepared = await transaction(a.tenantId, async (db) => {
      await db.query("SELECT set_config('astra.actor_id',$1,true)", [a.userId]);
      await db.query("SELECT id FROM tenants WHERE id=$1 FOR UPDATE", [
        a.tenantId,
      ]);
      const previous = (
        await db.query(
          "SELECT * FROM gateway_payment_intents WHERE tenant_id=$1 AND request_key=$2",
          [a.tenantId, data.requestKey],
        )
      ).rows[0];
      if (previous) {
        if (
          previous.request_hash !== requestHash ||
          previous.created_by !== a.userId
        )
          fail(
            409,
            "IDEMPOTENCY_CONFLICT",
            "This request key belongs to another checkout request.",
          );
        await application(db, id, a);
        return { row: previous, replayed: true };
      }
      const app = await application(db, id, a, true);
      const existing = (
        await db.query(
          "SELECT * FROM gateway_payment_intents WHERE tenant_id=$1 AND application_id=$2",
          [a.tenantId, id],
        )
      ).rows[0];
      if (existing) return { row: existing, replayed: true };
      if (
        app.state !== "APPROVED" ||
        app.approved_version !== app.latest_version
      )
        fail(
          409,
          "APPROVAL_REQUIRED",
          "Application approval is required before online payment.",
        );
      const order = (
        await db.query(
          "SELECT * FROM application_order_snapshots WHERE application_id=$1",
          [id],
        )
      ).rows[0];
      if (!order || order.total_minor <= 0)
        fail(
          409,
          "PAYMENT_NOT_REQUIRED",
          "This application has no positive configured fee to collect.",
        );
      const gateway = await resolveGateway(a.tenantId, data.provider, db);
      const intentId = randomUUID(),
        invoice = `DU-${intentId.replaceAll("-", "")}`;
      const row = (
        await db.query(
          `INSERT INTO gateway_payment_intents(tenant_id,id,application_id,provider,environment,merchant_account,invoice,amount_minor,currency,created_by,request_key,request_hash,callback_hash,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'BDT',$9,$10,$11,$12,'CREATE_PENDING') RETURNING *`,
          [
            a.tenantId,
            intentId,
            id,
            gateway.provider,
            gateway.environment,
            gateway.merchantAccount,
            invoice,
            order.total_minor,
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
        const gateway = await gatewayFor(prepared.row);
        const created = await gateway.create({
          invoice: prepared.row.invoice,
          amountMinor: prepared.row.amount_minor,
          callbackURL:
            gateway.provider === "SSLCOMMERZ"
              ? `${origin()}/api/v1/payments/sslcommerz/callback/${token}`
              : `${origin()}/api/v1/payments/bkash/callback/${token}`,
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
            "The created gateway checkout does not match the application fee.",
          );
        await transaction(a.tenantId, async (db) => {
          await db.query(
            "UPDATE gateway_payment_intents SET payment_id=$3,checkout_url=$4,callback_signature=$5,status='READY',updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status='CREATE_PENDING'",
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
            "UPDATE gateway_payment_intents SET status='CREATE_UNKNOWN',last_error=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status='CREATE_PENDING'",
            [a.tenantId, prepared.row.id, errorCode(error)],
          );
          await event(db, prepared.row, "CREATE_OUTCOME_UNKNOWN", {
            code: errorCode(error),
          });
        });
      }
    }
    const result = await transaction(a.tenantId, async (db) =>
      intentView(
        db,
        (
          await db.query(
            "SELECT * FROM gateway_payment_intents WHERE tenant_id=$1 AND id=$2",
            [a.tenantId, prepared.row.id],
          )
        ).rows[0],
      ),
    );
    res
      .status(prepared.replayed ? 200 : 201)
      .json({ attempt: result, replayed: prepared.replayed });
  }),
);

const pagination = (req: Req) => ({
  page: z.coerce
    .number()
    .int()
    .min(1)
    .max(100000)
    .default(1)
    .parse(req.query.page),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .parse(req.query.pageSize),
});
// This correlated expression uses the fixed alias p, never caller-provided SQL.
const lastDecisiveResult = `(SELECT r.result FROM gateway_payment_reconciliations r WHERE r.tenant_id=p.tenant_id AND r.intent_id=p.id AND r.result IN ('MATCHED','MISMATCH') ORDER BY r.checked_at DESC,r.id DESC LIMIT 1)`;
paymentsRouter.get(
  "/payments",
  wrap(async (req, res) => {
    const a = actor(req, ["admin", "finance", "staff"]),
      { page, pageSize } = pagination(req);
    const status = z
      .enum([
        "CREATE_PENDING",
        "CREATE_UNKNOWN",
        "READY",
        "EXECUTE_PENDING",
        "VERIFYING",
        "PAID",
        "REVIEW_REQUIRED",
        "FAILED",
      ])
      .optional()
      .parse(req.query.status);
    const day =
      req.query.businessDate === undefined
        ? null
        : calendarDate(req.query.businessDate);
    const result = await transaction(a.tenantId, async (db) => {
      const where = `FROM gateway_payment_intents p JOIN applications a ON a.tenant_id=p.tenant_id AND a.id=p.application_id JOIN citizens c ON c.tenant_id=a.tenant_id AND c.id=a.citizen_id WHERE p.tenant_id=$1 AND ($2::text IS NULL OR p.status=$2 OR ($2='REVIEW_REQUIRED' AND p.status='PAID' AND ${lastDecisiveResult}='MISMATCH')) AND ($3::date IS NULL OR (p.created_at AT TIME ZONE 'Asia/Dhaka')::date=$3)`;
      const parameters = [a.tenantId, status ?? null, day];
      const total = safeNumber(
        (await db.query(`SELECT count(*) ${where}`, parameters)).rows[0].count,
      );
      const rows = (
        await db.query(
          `SELECT p.*,a.service_no,c.full_name_en ${where} ORDER BY p.created_at DESC,p.id LIMIT $4 OFFSET $5`,
          [...parameters, pageSize, (page - 1) * pageSize],
        )
      ).rows;
      const items = [];
      for (const row of rows)
        items.push({
          ...(await intentView(db, row)),
          serviceNo: row.service_no,
          applicantName: row.full_name_en,
        });
      return {
        items,
        page,
        pageSize,
        total,
      };
    });
    res.json(result);
  }),
);
async function dailySummary(db: DB, tenantId: string, day: string) {
  const row = (
    await db.query(
      `SELECT count(*) total_count,count(*) FILTER(WHERE status='PAID') paid_count,
    count(*) FILTER(WHERE status IN ('CREATE_PENDING','READY','EXECUTE_PENDING','VERIFYING')) pending_count,
    count(*) FILTER(WHERE status IN ('CREATE_UNKNOWN','REVIEW_REQUIRED','FAILED') OR (status='PAID' AND ${lastDecisiveResult}='MISMATCH')) review_count,
    coalesce(sum(amount_minor),0) total_minor,coalesce(sum(amount_minor) FILTER(WHERE status='PAID'),0) paid_minor
    FROM gateway_payment_intents p WHERE tenant_id=$1 AND (created_at AT TIME ZONE 'Asia/Dhaka')::date=$2`,
      [tenantId, day],
    )
  ).rows[0];
  const checks = (
    await db.query(
      `SELECT result,count(*) FROM gateway_payment_reconciliations WHERE tenant_id=$1 AND (checked_at AT TIME ZONE 'Asia/Dhaka')::date=$2 GROUP BY result`,
      [tenantId, day],
    )
  ).rows;
  const results = { matched: 0, mismatch: 0, pending: 0, error: 0 };
  for (const check of checks)
    results[check.result.toLowerCase() as keyof typeof results] = safeNumber(
      check.count,
    );
  return {
    businessDate: day,
    currency: "BDT",
    bankSettlement: "NOT_CONNECTED",
    totalCount: safeNumber(row.total_count),
    paidCount: safeNumber(row.paid_count),
    pendingCount: safeNumber(row.pending_count),
    reviewCount: safeNumber(row.review_count),
    totalMinor: safeNumber(row.total_minor),
    paidMinor: safeNumber(row.paid_minor),
    results,
  };
}
paymentsRouter.get(
  "/payments/reconciliation",
  wrap(async (req, res) => {
    const a = actor(req, ["admin", "finance"]),
      day = calendarDate(req.query.businessDate);
    res.json(
      await transaction(a.tenantId, (db) => dailySummary(db, a.tenantId, day)),
    );
  }),
);
function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
paymentsRouter.get(
  "/payments/reconciliation/export.csv",
  wrap(async (req, res) => {
    const a = actor(req, ["admin", "finance"]),
      day = calendarDate(req.query.businessDate);
    const rows = await transaction(
      a.tenantId,
      async (db) =>
        (
          await db.query(
            `SELECT p.id,p.application_id,p.invoice,p.environment,p.status,p.amount_minor,p.currency,c.transaction_id,r.receipt_number,p.created_at,
              CASE WHEN c.intent_id IS NOT NULL THEN CASE WHEN ${lastDecisiveResult}='MISMATCH' THEN 'REVIEW_REQUIRED' ELSE 'COLLECTED' END ELSE 'PENDING' END payment_status,
              (SELECT x.result FROM gateway_payment_reconciliations x WHERE x.tenant_id=p.tenant_id AND x.intent_id=p.id ORDER BY x.checked_at DESC,x.id DESC LIMIT 1) last_check_result
              FROM gateway_payment_intents p LEFT JOIN gateway_payment_confirmations c ON c.tenant_id=p.tenant_id AND c.intent_id=p.id LEFT JOIN gateway_payment_receipts r ON r.tenant_id=p.tenant_id AND r.intent_id=p.id WHERE p.tenant_id=$1 AND (p.created_at AT TIME ZONE 'Asia/Dhaka')::date=$2 ORDER BY p.created_at,p.id`,
            [a.tenantId, day],
          )
        ).rows,
    );
    const header = [
      "payment_id",
      "application_id",
      "merchant_invoice",
      "environment",
      "status",
      "payment_status",
      "last_check_result",
      "amount_minor",
      "currency",
      "transaction_id",
      "receipt_number",
      "created_at",
      "bank_settlement",
    ];
    const body = [
      header,
      ...rows.map((r) => [
        r.id,
        r.application_id,
        r.invoice,
        r.environment,
        r.status,
        r.payment_status,
        r.last_check_result,
        r.amount_minor,
        r.currency,
        r.transaction_id,
        r.receipt_number,
        r.created_at.toISOString(),
        "NOT_CONNECTED",
      ]),
    ]
      .map((r) => r.map(csvCell).join(","))
      .join("\r\n");
    res
      .type("text/csv; charset=utf-8")
      .setHeader(
        "Content-Disposition",
        `attachment; filename="gateway-reconciliation-${day}.csv"`,
      )
      .send(`\uFEFF${body}\r\n`);
  }),
);
paymentsRouter.get(
  "/payments/:id",
  wrap(async (req, res) => {
    const a = actor(req),
      id = uuid.parse(req.params.id);
    res.json(
      await transaction(a.tenantId, async (db) =>
        intentView(db, await authorizedIntent(db, id, a)),
      ),
    );
  }),
);
paymentsRouter.post(
  "/payments/:id/reconcile",
  wrap(async (req, res) => {
    const a = actor(req, ["citizen", "staff", "admin", "finance"]),
      id = uuid.parse(req.params.id),
      data = requestInput.parse(req.body);
    const prepared = await transaction(a.tenantId, async (db) => {
      const row = await authorizedIntent(db, id, a);
      await db.query(
        "SELECT id FROM gateway_payment_intents WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [a.tenantId, id],
      );
      const previous = (
        await db.query(
          "SELECT * FROM gateway_payment_reconciliations WHERE tenant_id=$1 AND request_key=$2",
          [a.tenantId, data.requestKey],
        )
      ).rows[0];
      if (previous && previous.intent_id !== id)
        fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "This request key belongs to another payment.",
        );
      if (!previous) {
        const reservation = (
          await db.query(
            "SELECT created_at FROM gateway_payment_events WHERE tenant_id=$1 AND intent_id=$2 AND event_key=$3",
            [a.tenantId, id, `reconcile:${data.requestKey}`],
          )
        ).rows[0];
        if (
          reservation &&
          Date.now() - new Date(reservation.created_at).getTime() < 60000
        )
          return { row, previous, pending: true };
        await reserveCheck(
          db,
          row,
          reservation
            ? `reconcile-recovery:${randomUUID()}`
            : `reconcile:${data.requestKey}`,
        );
      }
      return { row, previous };
    });
    if (prepared.pending) {
      const pending = await transaction(a.tenantId, async (db) => ({
        attempt: await intentView(
          db,
          (
            await db.query(
              "SELECT * FROM gateway_payment_intents WHERE tenant_id=$1 AND id=$2",
              [a.tenantId, id],
            )
          ).rows[0],
        ),
        reconciliation: {
          id: null,
          result: "PENDING",
          reason: "PAYMENT_CHECK_IN_PROGRESS",
          checkedAt: null,
          bankSettlement: "NOT_CONNECTED",
        },
        receipt: await findReceipt(db, id),
      }));
      res.status(202).json(pending);
      return;
    }
    const check: CheckResult = prepared.previous
      ? {
          result: prepared.previous.result,
          reason: prepared.previous.reason,
          receipt: null,
        }
      : await checkPayment(
          prepared.row,
          process.env.NODE_ENV === "test" &&
            req.header("X-Test-Failure") === "after-payment-confirmation",
        );
    res.json(await recordCheck(prepared.row, check, data.requestKey, a.userId));
  }),
);
paymentsRouter.get(
  "/receipts/:id",
  wrap(async (req, res) => {
    const a = actor(req),
      id = uuid.parse(req.params.id);
    res.json(
      await transaction(a.tenantId, async (db) => {
        const row = (
          await db.query(
            "SELECT * FROM gateway_payment_receipts WHERE tenant_id=$1 AND id=$2",
            [a.tenantId, id],
          )
        ).rows[0];
        if (!row) fail(404, "NOT_FOUND", "Receipt not found.");
        await application(db, row.application_id, a);
        return receiptView(row);
      }),
    );
  }),
);
paymentsRouter.get(
  "/receipts/:id/pdf",
  wrap(async (req, res) => {
    const a = actor(req),
      id = uuid.parse(req.params.id);
    const row = await transaction(a.tenantId, async (db) => {
      const receipt = (
        await db.query(
          "SELECT * FROM gateway_payment_receipts WHERE tenant_id=$1 AND id=$2",
          [a.tenantId, id],
        )
      ).rows[0];
      if (!receipt) fail(404, "NOT_FOUND", "Receipt not found.");
      await application(db, receipt.application_id, a);
      return receipt;
    });
    res
      .type("application/pdf")
      .setHeader(
        "Content-Disposition",
        `attachment; filename="${row.receipt_number}.pdf"`,
      )
      .send(row.pdf_bytes);
  }),
);
