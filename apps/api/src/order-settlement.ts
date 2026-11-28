import { audit, type DB } from "./db.js";
import { settleCertificateFeeOrder } from "./certificate-fees.js";

/**
 * Phase 3A: the settlement effects of a payment order, shared verbatim by the
 * gateway webhook path (settle in app.ts), the owner's manual settlement
 * endpoint, and — Phase 7 — the real-gateway order checkout
 * (order-payments.ts), so the three can never diverge: one PLAN_GRANT/TOPUP
 * ledger entry (idempotency key `payment:<order>`), the subscription upsert
 * for subscription orders, the order status flip, the invoice, and the audit
 * event. The ledger actor stays the order's creator in every path; the audit
 * actor/action identify who actually settled.
 */
export async function applyOrderSettlement(
  db: DB,
  order: any,
  actorId: string,
  auditAction: string,
  auditMetadata: object,
) {
  // CERT-FEE: a certificate_fee order grants no credits and no subscription;
  // settling it marks the application's certificate fee PAID, and the
  // Chairman's issuance then consumes it (certificate-fees.ts).
  if (order.kind === "certificate_fee") {
    await settleCertificateFeeOrder(db, order);
    await db.query("UPDATE payment_orders SET status='SETTLED' WHERE id=$1", [order.id]);
    await db.query(
      "INSERT INTO invoices(tenant_id,order_id,amount_minor,currency) VALUES($1,$2,$3,$4)",
      [order.tenant_id, order.id, order.amount_minor, order.currency],
    );
    await audit(db, order.tenant_id, actorId, auditAction, order.id, auditMetadata);
    return;
  }
  await db.query(
    "INSERT INTO credit_ledger(tenant_id,delta,kind,idempotency_key,actor_id,reason,balance_after) VALUES($1,$2,$3,$4,$5,$6,0)",
    [
      order.tenant_id,
      order.credits,
      order.kind === "subscription" ? "PLAN_GRANT" : "TOPUP",
      `payment:${order.id}`,
      order.created_by,
      "Verified payment settlement",
    ],
  );
  if (order.kind === "subscription") {
    const plan = (
      await db.query("SELECT * FROM subscription_plans WHERE id=$1", [
        order.plan_id,
      ])
    ).rows[0];
    await db.query(
      "INSERT INTO tenant_subscriptions(tenant_id,plan_id,valid_until,status,plan_duration_days,plan_grant_credits,plan_allowance_limit) VALUES($1,$2,now()+($3::int*interval '1 day'),'ACTIVE',$4,$5,$6) ON CONFLICT(tenant_id) DO UPDATE SET plan_id=excluded.plan_id,valid_until=greatest(tenant_subscriptions.valid_until,now())+($3::int*interval '1 day'),status='ACTIVE',plan_duration_days=excluded.plan_duration_days,plan_grant_credits=excluded.plan_grant_credits,plan_allowance_limit=excluded.plan_allowance_limit",
      [order.tenant_id, plan.id, plan.duration_days, plan.duration_days, plan.grant_credits, plan.monthly_allowance_limit],
    );
  }
  await db.query("UPDATE payment_orders SET status='SETTLED' WHERE id=$1", [
    order.id,
  ]);
  await db.query(
    "INSERT INTO invoices(tenant_id,order_id,amount_minor,currency) VALUES($1,$2,$3,$4)",
    [order.tenant_id, order.id, order.amount_minor, order.currency],
  );
  await audit(db, order.tenant_id, actorId, auditAction, order.id, auditMetadata);
}
