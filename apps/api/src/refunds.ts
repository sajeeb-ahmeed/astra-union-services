import express from "express";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { transaction, audit, type DB } from "./db.js";
import { fail } from "./models.js";
import type { Auth } from "./app.js";
import { resolveGateway } from "./gateways.js";
import { SslcommerzGateway } from "./sslcommerz.js";

/**
 * Phase 5d: refunds of a verified citizen payment (state machine and rules in migration 032).
 * Requested by the applicant or office staff; approved or rejected by office admin/finance; sent once to the
 * provider; settled only when the provider reports the money refunded. The provider says refunds normally
 * reach the payer in 3–5 working days, which Astra shows as the expected date.
 */
type Req = express.Request & { auth?: Auth };
const wrap =
  (fn: (req: Req, res: express.Response) => Promise<unknown>) =>
  (req: Req, res: express.Response, next: express.NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);
function actor(req: Req, roles: string[]) {
  if (!req.auth || !roles.includes(req.auth.role) || !req.auth.tenantId) fail(403, "ROLE_DENIED", "This role is not permitted.");
  return req.auth as Auth & { tenantId: string };
}
const uuid = z.string().uuid();
const refundView = (r: any) => ({
  id: r.id,
  applicationId: r.application_id,
  amountMinor: r.amount_minor,
  reason: r.reason,
  status: r.status,
  requestedAt: r.requested_at,
  decidedAt: r.decided_at,
  decisionNote: r.decision_note,
  sentAt: r.sent_at,
  settledAt: r.settled_at,
  expectedBy: typeof r.expected_by === "string" ? r.expected_by : r.expected_by?.toISOString().slice(0, 10) ?? null,
  lastError: r.last_error,
});
/** Five working days (Sunday–Thursday in Bangladesh) after a date. */
export function workingDaysAfter(from: Date, days = 5) {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const weekday = d.getUTCDay();
    if (weekday !== 5 && weekday !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}
async function applicationFor(db: DB, a: Auth, id: string) {
  const row = (
    await db.query(
      `SELECT ap.* FROM applications ap JOIN citizens c ON c.id=ap.citizen_id AND c.tenant_id=ap.tenant_id
       WHERE ap.tenant_id=$1 AND ap.id=$2 ${a.role === "citizen" ? "AND c.user_id=$3" : ""}`,
      a.role === "citizen" ? [a.tenantId, id, a.userId] : [a.tenantId, id],
    )
  ).rows[0];
  if (!row) fail(404, "NOT_FOUND", "Application not found.");
  return row;
}

export const refundsRouter = express.Router();

/** Applicant or office staff: ask for a refund of the verified payment, before any certificate is issued. */
refundsRouter.post(
  "/applications/:id/refunds",
  wrap(async (req, res) => {
    const a = actor(req, ["citizen", "staff", "admin"]);
    const id = uuid.parse(req.params.id);
    const d = z
      .object({ reason: z.string().trim().min(5).max(255), amountMinor: z.number().int().min(1).optional() })
      .strict()
      .parse(req.body);
    const item = await transaction(a.tenantId, async (db) => {
      await applicationFor(db, a, id);
      if ((await db.query("SELECT 1 FROM certificates WHERE tenant_id=$1 AND application_id=$2", [a.tenantId, id])).rowCount)
        fail(409, "REFUND_AFTER_ISSUANCE", "A certificate has been issued for this application; it cannot be refunded here.");
      const paid = (
        await db.query(
          "SELECT c.*,i.provider FROM gateway_payment_confirmations c JOIN gateway_payment_intents i ON i.tenant_id=c.tenant_id AND i.id=c.intent_id WHERE c.tenant_id=$1 AND c.application_id=$2",
          [a.tenantId, id],
        )
      ).rows[0];
      if (!paid) fail(409, "REFUND_NOT_PAID", "There is no verified online payment to refund.");
      let row;
      await db.query("SAVEPOINT refund_request");
      try {
        row = (
          await db.query(
            "INSERT INTO application_refunds(tenant_id,application_id,intent_id,amount_minor,reason,requested_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
            [a.tenantId, id, paid.intent_id, d.amountMinor ?? paid.amount_minor, d.reason, a.userId],
          )
        ).rows[0];
        await db.query("RELEASE SAVEPOINT refund_request");
      } catch (error: any) {
        await db.query("ROLLBACK TO SAVEPOINT refund_request");
        if (error?.code === "23505") fail(409, "REFUND_ALREADY_OPEN", "A refund for this application is already in progress.");
        if (/cannot exceed/.test(error?.message ?? "")) fail(422, "REFUND_AMOUNT_INVALID", "A refund cannot exceed the amount paid.");
        throw error;
      }
      await audit(db, a.tenantId, a.userId, "REFUND_REQUESTED", row.id, { applicationId: id, amountMinor: row.amount_minor });
      return refundView(row);
    });
    res.status(201).json(item);
  }),
);
refundsRouter.get(
  "/applications/:id/refunds",
  wrap(async (req, res) => {
    const a = actor(req, ["citizen", "staff", "admin", "finance", "reviewer", "approver"]);
    const id = uuid.parse(req.params.id);
    const items = await transaction(a.tenantId, async (db) => {
      await applicationFor(db, a, id);
      return (
        await db.query("SELECT * FROM application_refunds WHERE tenant_id=$1 AND application_id=$2 ORDER BY requested_at DESC", [
          a.tenantId,
          id,
        ])
      ).rows.map(refundView);
    });
    res.json({ items });
  }),
);
/** Office admin/finance: the office's refund requests. */
refundsRouter.get(
  "/refunds",
  wrap(async (req, res) => {
    const a = actor(req, ["admin", "finance"]);
    const status = z.enum(["REQUESTED", "APPROVED", "SENT", "SETTLED", "REJECTED", "FAILED"]).optional().parse(req.query.status);
    const items = await transaction(a.tenantId, async (db) =>
      (
        await db.query(
          `SELECT * FROM application_refunds WHERE tenant_id=$1 ${status ? "AND status=$2" : ""} ORDER BY requested_at DESC LIMIT 200`,
          status ? [a.tenantId, status] : [a.tenantId],
        )
      ).rows.map(refundView),
    );
    res.json({ items });
  }),
);

/** Send an approved refund to the provider, once: the refund id is stored before the call and reused on retry. */
async function send(tenantId: string, refundId: string, actorId: string) {
  const claimed = await transaction(tenantId, async (db) => {
    const r = (
      await db.query(
        `SELECT r.*,c.evidence,c.transaction_id,i.provider FROM application_refunds r
         JOIN gateway_payment_confirmations c ON c.tenant_id=r.tenant_id AND c.intent_id=r.intent_id
         JOIN gateway_payment_intents i ON i.tenant_id=r.tenant_id AND i.id=r.intent_id
         WHERE r.tenant_id=$1 AND r.id=$2 FOR UPDATE OF r`,
        [tenantId, refundId],
      )
    ).rows[0];
    if (!r || !["APPROVED", "SENT"].includes(r.status) || r.provider_reference) return null;
    const providerRefundId = r.provider_refund_id ?? `RF${randomBytes(12).toString("hex").toUpperCase()}`.slice(0, 30);
    if (!r.provider_refund_id)
      await db.query("UPDATE application_refunds SET status='SENT',provider_refund_id=$3,sent_at=now() WHERE tenant_id=$1 AND id=$2", [
        tenantId,
        refundId,
        providerRefundId,
      ]);
    return { ...r, provider_refund_id: providerRefundId };
  });
  if (!claimed) return;
  try {
    const gateway = await resolveGateway(tenantId, claimed.provider);
    if (!(gateway instanceof SslcommerzGateway)) throw Object.assign(new Error(), { code: "REFUND_PROVIDER_UNSUPPORTED" });
    const result = await gateway.refund({
      bankTransactionId: String(claimed.evidence?.providerReference ?? ""),
      refundId: claimed.provider_refund_id,
      amountMinor: claimed.amount_minor,
      remarks: claimed.reason,
    });
    await transaction(tenantId, async (db) => {
      if (result.accepted)
        await db.query("UPDATE application_refunds SET provider_reference=$3,last_error=NULL WHERE tenant_id=$1 AND id=$2", [
          tenantId,
          refundId,
          result.reference,
        ]);
      else
        await db.query("UPDATE application_refunds SET status='FAILED',last_error=$3 WHERE tenant_id=$1 AND id=$2", [
          tenantId,
          refundId,
          result.error ?? "REFUND_NOT_INITIATED",
        ]);
      await audit(db, tenantId, actorId, result.accepted ? "REFUND_SENT" : "REFUND_FAILED", refundId, {
        reference: result.reference ?? null,
        error: result.error ?? null,
      });
    });
  } catch (error: any) {
    // The outcome is unknown: keep it SENT with the same refund id, so a retry repeats the same request.
    await transaction(tenantId, (db) =>
      db.query("UPDATE application_refunds SET last_error=$3 WHERE tenant_id=$1 AND id=$2", [
        tenantId,
        refundId,
        typeof error?.code === "string" ? error.code : "REFUND_OUTCOME_UNKNOWN",
      ]),
    );
  }
}

/** Office admin/finance: approve (and send) or reject a requested refund. */
refundsRouter.post(
  "/refunds/:id/decision",
  wrap(async (req, res) => {
    const a = actor(req, ["admin", "finance"]);
    const id = uuid.parse(req.params.id);
    const d = z
      .object({ decision: z.enum(["APPROVED", "REJECTED"]), note: z.string().trim().min(3).max(500).optional() })
      .strict()
      .refine((v) => v.decision !== "REJECTED" || !!v.note, { message: "Give a reason for rejecting." })
      .parse(req.body);
    await transaction(a.tenantId, async (db) => {
      const r = (
        await db.query(
          "SELECT r.*,i.provider FROM application_refunds r JOIN gateway_payment_intents i ON i.tenant_id=r.tenant_id AND i.id=r.intent_id WHERE r.tenant_id=$1 AND r.id=$2 FOR UPDATE OF r",
          [a.tenantId, id],
        )
      ).rows[0];
      if (!r) fail(404, "NOT_FOUND", "Refund not found.");
      if (r.status !== "REQUESTED") fail(409, "REFUND_ALREADY_DECIDED", "This refund has already been decided.");
      if (d.decision === "APPROVED" && r.provider !== "SSLCOMMERZ")
        fail(409, "REFUND_PROVIDER_UNSUPPORTED", "Online refunds are available only for SSLCommerz payments so far.");
      if (d.decision === "APPROVED" && (await db.query("SELECT 1 FROM certificates WHERE tenant_id=$1 AND application_id=$2", [a.tenantId, r.application_id])).rowCount)
        fail(409, "REFUND_AFTER_ISSUANCE", "A certificate has been issued for this application; it cannot be refunded here.");
      await db.query(
        "UPDATE application_refunds SET status=$3,decided_by=$4,decided_at=now(),decision_note=$5,expected_by=$6 WHERE tenant_id=$1 AND id=$2",
        [a.tenantId, id, d.decision, a.userId, d.note ?? null, d.decision === "APPROVED" ? workingDaysAfter(new Date()) : null],
      );
      await audit(db, a.tenantId, a.userId, d.decision === "APPROVED" ? "REFUND_APPROVED" : "REFUND_REJECTED", id, { note: d.note ?? null });
    });
    if (d.decision === "APPROVED") await send(a.tenantId, id, a.userId);
    const row = await transaction(a.tenantId, async (db) => (await db.query("SELECT * FROM application_refunds WHERE tenant_id=$1 AND id=$2", [a.tenantId, id])).rows[0]);
    res.json(refundView(row));
  }),
);
/** Check a sent refund with the provider (and retry a send whose outcome was unknown). */
refundsRouter.post(
  "/refunds/:id/refresh",
  wrap(async (req, res) => {
    const a = actor(req, ["admin", "finance"]);
    const id = uuid.parse(req.params.id);
    await send(a.tenantId, id, a.userId);
    const r = await transaction(a.tenantId, async (db) =>
      (
        await db.query(
          "SELECT r.*,i.provider FROM application_refunds r JOIN gateway_payment_intents i ON i.tenant_id=r.tenant_id AND i.id=r.intent_id WHERE r.tenant_id=$1 AND r.id=$2",
          [a.tenantId, id],
        )
      ).rows[0],
    );
    if (!r) fail(404, "NOT_FOUND", "Refund not found.");
    if (r.status === "SENT" && r.provider_reference) {
      const gateway = await resolveGateway(a.tenantId, r.provider);
      if (gateway instanceof SslcommerzGateway) {
        const state = await gateway.refundStatus(r.provider_reference);
        if (state === "refunded")
          await transaction(a.tenantId, async (db) => {
            await db.query("UPDATE application_refunds SET status='SETTLED',settled_at=now(),last_error=NULL WHERE tenant_id=$1 AND id=$2 AND status='SENT'", [
              a.tenantId,
              id,
            ]);
            await audit(db, a.tenantId, a.userId, "REFUND_SETTLED", id);
          });
      }
    }
    const row = await transaction(a.tenantId, async (db) => (await db.query("SELECT * FROM application_refunds WHERE tenant_id=$1 AND id=$2", [a.tenantId, id])).rows[0]);
    res.json(refundView(row));
  }),
);
