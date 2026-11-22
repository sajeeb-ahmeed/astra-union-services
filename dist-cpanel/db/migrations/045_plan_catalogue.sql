-- Phase 3C: the owner-managed plan catalogue + monthly allowance limits (billing model §3.1, §3.3, Q4).
-- Until now subscription_plans was seed data with exactly one row in use ('standard-monthly'), and
-- 3B's allowance counter (subscription_allowance_consumptions) had no limit to enforce. This migration:
--   * subscription_plans gains the catalogue fields: monthly_allowance_limit (NULL = unlimited; the
--     allowance counts SUBMITTED applications, consumed once per application ID — Q4),
--     on_sale (hidden plans are not offered for new orders; existing subscriptions are unaffected),
--     and sort_order for the storefront/dashboard ordering. Existing plans keep working unchanged:
--     the new columns default to unlimited / on sale, so 'standard-monthly' behaves exactly as before.
--   * tenant_subscriptions gains the TERMS SNAPSHOT (plan_duration_days, plan_grant_credits,
--     plan_allowance_limit). Duration and grant were already materialised at activation (into
--     valid_until and the credit ledger), but the allowance is consulted at every submit, so without
--     a snapshot an owner editing a plan would silently rewrite the terms of subscriptions already
--     in their current period. Every activation path (payment settlement, owner action, office
--     creation) writes the snapshot from the plan in force at that moment; existing subscriptions
--     are backfilled from their current plan rows — the best record of the terms they were sold.
--     (grant_credits deliberately keeps its original CHECK > 0: payment_orders.credits and
--     credit_ledger.delta both forbid zero, so a 0-grant plan could never be ordered or settled.)
--   * subscription_plan_changes: the append-only audit history for catalogue changes. audit_events
--     is tenant-scoped by FORCE RLS, so platform-level owner actions keep their own history here —
--     the same pattern as platform_setting_changes (migration 044). Every catalogue mutation records
--     who, when, why (reason mandatory) and the before/after plan state.

ALTER TABLE subscription_plans
 ADD COLUMN monthly_allowance_limit integer CHECK (monthly_allowance_limit IS NULL OR monthly_allowance_limit >= 1),
 ADD COLUMN on_sale boolean NOT NULL DEFAULT true,
 ADD COLUMN sort_order integer NOT NULL DEFAULT 0;

ALTER TABLE tenant_subscriptions
 ADD COLUMN plan_duration_days integer CHECK (plan_duration_days IS NULL OR plan_duration_days > 0),
 ADD COLUMN plan_grant_credits integer CHECK (plan_grant_credits IS NULL OR plan_grant_credits >= 0),
 ADD COLUMN plan_allowance_limit integer CHECK (plan_allowance_limit IS NULL OR plan_allowance_limit >= 1);

UPDATE tenant_subscriptions ts
   SET plan_duration_days = p.duration_days,
       plan_grant_credits = p.grant_credits,
       plan_allowance_limit = p.monthly_allowance_limit
  FROM subscription_plans p
 WHERE p.id = ts.plan_id;

CREATE TABLE subscription_plan_changes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 plan_id text NOT NULL,
 action text NOT NULL CHECK (action IN ('CREATE','UPDATE','ON_SALE')),
 before_state jsonb,
 after_state jsonb NOT NULL,
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 500),
 changed_by uuid NOT NULL REFERENCES platform_users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscription_plan_changes_plan ON subscription_plan_changes(plan_id, created_at DESC);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON subscription_plan_changes FOR EACH ROW EXECUTE FUNCTION immutable_record();
REVOKE ALL ON subscription_plan_changes FROM PUBLIC, astra_app;
GRANT SELECT, INSERT ON subscription_plan_changes TO astra_app;
