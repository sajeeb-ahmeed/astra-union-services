import { randomUUID } from "node:crypto";
import { audit, type DB } from "./db.js";
import { fail } from "./models.js";

/**
 * Phase 3A: owner-driven subscription control.
 *
 * One place owns the maths and the audit trail for every manual subscription
 * change, so the owner endpoint (POST /owner/tenants/:id/subscription) and the
 * office-creation flow (POST /owner/tenants with `activateSubscription`) can
 * never drift apart. The effects mirror the payment settlement path in app.ts:
 * activation extends from `greatest(valid_until, now())` by the plan duration
 * and plan credits arrive as a PLAN_GRANT credit-ledger entry. Phase 3C:
 * activation and plan changes also snapshot the plan's terms (duration, grant,
 * monthly allowance limit) onto the subscription, so later catalogue edits
 * never rewrite a running period.
 */
export type SubscriptionAction =
  | "activate"
  | "extend"
  | "set_expiry"
  | "suspend"
  | "change_plan";
export type SubscriptionActionInput = {
  action: SubscriptionAction;
  planId?: string;
  days?: number;
  validUntil?: string;
  status?: "ACTIVE" | "EXPIRED" | "SUSPENDED";
  grantCredits?: boolean;
  reason: string;
};
const AUDIT_ACTIONS: Record<SubscriptionAction, string> = {
  activate: "SUBSCRIPTION_ACTIVATED",
  extend: "SUBSCRIPTION_EXTENDED",
  set_expiry: "SUBSCRIPTION_EXPIRY_SET",
  suspend: "SUBSCRIPTION_SUSPENDED",
  change_plan: "SUBSCRIPTION_PLAN_CHANGED",
};
async function loadPlan(db: DB, planId: string) {
  const plan = (
    await db.query("SELECT * FROM subscription_plans WHERE id=$1", [planId])
  ).rows[0];
  if (!plan) fail(422, "PLAN_INVALID", "Plan not found.");
  return plan;
}
async function grantPlanCredits(
  db: DB,
  tenantId: string,
  actorId: string,
  plan: any,
  reason: string,
): Promise<number> {
  if (!plan.grant_credits) return 0;
  await db.query(
    "INSERT INTO credit_ledger(tenant_id,delta,kind,idempotency_key,actor_id,reason,balance_after) VALUES($1,$2,'PLAN_GRANT',$3,$4,$5,0)",
    [tenantId, plan.grant_credits, `subscription-action:${randomUUID()}`, actorId, reason],
  );
  return plan.grant_credits;
}
const snapshot = (r: any) =>
  r
    ? {
        planId: r.plan_id,
        status: r.status,
        validUntil: r.valid_until,
        planDurationDays: r.plan_duration_days ?? null,
        planGrantCredits: r.plan_grant_credits ?? null,
        planAllowanceLimit: r.plan_allowance_limit ?? null,
      }
    : null;
/**
 * Applies one owner subscription action inside the caller's tenant
 * transaction and writes the audit event with before/after state. Returns the
 * raw subscription rows (snake_case) plus how many credits were granted.
 */
export async function applySubscriptionAction(
  db: DB,
  tenantId: string,
  actorId: string,
  input: SubscriptionActionInput,
): Promise<{ before: any; after: any; creditsGranted: number }> {
  const before =
    (
      await db.query(
        "SELECT * FROM tenant_subscriptions WHERE tenant_id=$1 FOR UPDATE",
        [tenantId],
      )
    ).rows[0] ?? null;
  let after: any;
  let creditsGranted = 0;
  switch (input.action) {
    case "activate": {
      const plan = await loadPlan(
        db,
        input.planId ?? before?.plan_id ?? "standard-monthly",
      );
      const days = input.days ?? plan.duration_days;
      // Phase 3C: snapshot the plan terms in force at activation, so a later
      // catalogue edit never rewrites this subscription's current period.
      after = before
        ? (
            await db.query(
              "UPDATE tenant_subscriptions SET plan_id=$2, valid_until=greatest(valid_until, now()) + ($3::int * interval '1 day'), status='ACTIVE', plan_duration_days=$4, plan_grant_credits=$5, plan_allowance_limit=$6 WHERE tenant_id=$1 RETURNING *",
              [tenantId, plan.id, days, plan.duration_days, plan.grant_credits, plan.monthly_allowance_limit],
            )
          ).rows[0]
        : (
            await db.query(
              "INSERT INTO tenant_subscriptions(tenant_id,plan_id,valid_until,status,plan_duration_days,plan_grant_credits,plan_allowance_limit) VALUES($1,$2,now() + ($3::int * interval '1 day'),'ACTIVE',$4,$5,$6) RETURNING *",
              [tenantId, plan.id, days, plan.duration_days, plan.grant_credits, plan.monthly_allowance_limit],
            )
          ).rows[0];
      if (input.grantCredits ?? true)
        creditsGranted = await grantPlanCredits(
          db,
          tenantId,
          actorId,
          plan,
          input.reason,
        );
      break;
    }
    case "extend": {
      if (!before)
        fail(
          404,
          "SUBSCRIPTION_NOT_FOUND",
          "This office has no subscription to extend.",
        );
      const days = input.days ?? 30;
      after = (
        await db.query(
          "UPDATE tenant_subscriptions SET valid_until=greatest(valid_until, now()) + ($2::int * interval '1 day'), status=CASE WHEN status='EXPIRED' THEN 'ACTIVE' ELSE status END WHERE tenant_id=$1 RETURNING *",
          [tenantId, days],
        )
      ).rows[0];
      break;
    }
    case "set_expiry": {
      if (!before)
        fail(
          404,
          "SUBSCRIPTION_NOT_FOUND",
          "This office has no subscription to correct.",
        );
      const status =
        input.status ??
        (new Date(input.validUntil!) > new Date() ? "ACTIVE" : "EXPIRED");
      after = (
        await db.query(
          "UPDATE tenant_subscriptions SET valid_until=$2, status=$3 WHERE tenant_id=$1 RETURNING *",
          [tenantId, input.validUntil, status],
        )
      ).rows[0];
      break;
    }
    case "suspend": {
      if (!before)
        fail(
          404,
          "SUBSCRIPTION_NOT_FOUND",
          "This office has no subscription to suspend.",
        );
      after = (
        await db.query(
          "UPDATE tenant_subscriptions SET status='SUSPENDED' WHERE tenant_id=$1 RETURNING *",
          [tenantId],
        )
      ).rows[0];
      break;
    }
    case "change_plan": {
      const plan = await loadPlan(db, input.planId!);
      after = before
        ? (
            await db.query(
              "UPDATE tenant_subscriptions SET plan_id=$2, plan_duration_days=$3, plan_grant_credits=$4, plan_allowance_limit=$5 WHERE tenant_id=$1 RETURNING *",
              [tenantId, plan.id, plan.duration_days, plan.grant_credits, plan.monthly_allowance_limit],
            )
          ).rows[0]
        : (
            await db.query(
              "INSERT INTO tenant_subscriptions(tenant_id,plan_id,valid_until,status,plan_duration_days,plan_grant_credits,plan_allowance_limit) VALUES($1,$2,now(),'EXPIRED',$3,$4,$5) RETURNING *",
              [tenantId, plan.id, plan.duration_days, plan.grant_credits, plan.monthly_allowance_limit],
            )
          ).rows[0];
      if (input.grantCredits ?? false)
        creditsGranted = await grantPlanCredits(
          db,
          tenantId,
          actorId,
          plan,
          input.reason,
        );
      break;
    }
  }
  await audit(db, tenantId, actorId, AUDIT_ACTIONS[input.action], tenantId, {
    before: snapshot(before),
    after: snapshot(after),
    reason: input.reason,
    creditsGranted,
  });
  return { before, after, creditsGranted };
}
