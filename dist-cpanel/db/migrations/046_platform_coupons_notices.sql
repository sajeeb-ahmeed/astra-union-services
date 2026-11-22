-- Phase 3E: owner coupons (billing plan §3.7), global notices (§3.8) — the platform-level
-- counterparts of the office systems. The office coupon_codes (migration 028) discount a
-- citizen's application fee snapshot inside one office; the coupons here are the OWNER's:
-- they discount a subscription purchase or a credit top-up ORDER (payment_orders), are
-- redeemed at order creation, and the redemption is recorded on the order itself
-- (coupon_code + discount_minor columns), exactly as §3.7 requires ("redemption is recorded
-- on the order — code, discount amount, who, when"). payment_orders.amount_minor stays the
-- payable (net) amount, so the gateway webhook amount check, the owner manual settle and
-- the invoice all keep reading the same column with the same meaning; the gross price is
-- amount_minor + discount_minor.
-- Global notices are likewise platform-wide: the existing notices table (migration 004) is
-- per-office and stays untouched; platform_notices is the owner's portal-wide banner.
-- Platform tables follow the platform_setting_changes / subscription_plan_changes pattern:
-- no tenant RLS (they are global), append-only change histories with a mandatory reason
-- (audit_events is FORCE-RLS tenant-scoped and cannot hold platform-level owner actions).

CREATE TABLE platform_coupons (
 code text PRIMARY KEY CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{2,31}$'),
 discount_kind text NOT NULL CHECK (discount_kind IN ('percent','fixed')),
 discount_value integer NOT NULL CHECK (discount_value > 0 AND (discount_kind <> 'percent' OR discount_value <= 100) AND discount_value <= 100000000),
 applies_to text NOT NULL CHECK (applies_to IN ('subscription','topup','both')),
 plan_id text REFERENCES subscription_plans(id),
 valid_from timestamptz NOT NULL DEFAULT now(),
 valid_until timestamptz,
 max_uses integer CHECK (max_uses IS NULL OR max_uses BETWEEN 1 AND 1000000),
 per_office_limit integer CHECK (per_office_limit IS NULL OR per_office_limit BETWEEN 1 AND 1000000),
 visibility text NOT NULL DEFAULT 'hidden' CHECK (visibility IN ('public','hidden')),
 active boolean NOT NULL DEFAULT true,
 created_by uuid NOT NULL REFERENCES platform_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (valid_until IS NULL OR valid_until > valid_from),
 CHECK (plan_id IS NULL OR applies_to <> 'topup')
);

CREATE TABLE platform_coupon_redemptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 coupon_code text NOT NULL REFERENCES platform_coupons(code),
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 order_id uuid NOT NULL UNIQUE,
 discount_minor integer NOT NULL CHECK (discount_minor >= 0),
 redeemed_by uuid NOT NULL REFERENCES platform_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (tenant_id, order_id) REFERENCES payment_orders(tenant_id, id)
);
CREATE INDEX platform_coupon_redemptions_code ON platform_coupon_redemptions(coupon_code, created_at DESC);
CREATE INDEX platform_coupon_redemptions_tenant ON platform_coupon_redemptions(tenant_id, coupon_code);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON platform_coupon_redemptions FOR EACH ROW EXECUTE FUNCTION immutable_record();

CREATE TABLE platform_coupon_changes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 coupon_code text NOT NULL,
 action text NOT NULL CHECK (action IN ('CREATE','UPDATE','ACTIVE')),
 before_state jsonb,
 after_state jsonb NOT NULL,
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 500),
 changed_by uuid NOT NULL REFERENCES platform_users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_coupon_changes_code ON platform_coupon_changes(coupon_code, created_at DESC);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON platform_coupon_changes FOR EACH ROW EXECUTE FUNCTION immutable_record();

ALTER TABLE payment_orders
 ADD COLUMN coupon_code text REFERENCES platform_coupons(code),
 ADD COLUMN discount_minor integer NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
 ADD CONSTRAINT payment_orders_coupon_discount CHECK (coupon_code IS NOT NULL OR discount_minor = 0);

CREATE TABLE platform_notices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 title_bn text NOT NULL CHECK (length(btrim(title_bn)) BETWEEN 2 AND 200),
 title_en text NOT NULL CHECK (length(btrim(title_en)) BETWEEN 2 AND 200),
 body_bn text NOT NULL CHECK (length(btrim(body_bn)) BETWEEN 1 AND 4000),
 body_en text NOT NULL CHECK (length(btrim(body_en)) BETWEEN 1 AND 4000),
 link_url text CHECK (link_url IS NULL OR (link_url ~ '^https?://' AND length(link_url) <= 500)),
 starts_at timestamptz NOT NULL DEFAULT now(),
 ends_at timestamptz,
 published boolean NOT NULL DEFAULT true,
 created_by uuid NOT NULL REFERENCES platform_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX platform_notices_window ON platform_notices(published, starts_at, ends_at);

CREATE TABLE platform_notice_changes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 notice_id uuid NOT NULL,
 action text NOT NULL CHECK (action IN ('CREATE','UPDATE','PUBLISH')),
 before_state jsonb,
 after_state jsonb NOT NULL,
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 500),
 changed_by uuid NOT NULL REFERENCES platform_users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_notice_changes_notice ON platform_notice_changes(notice_id, created_at DESC);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON platform_notice_changes FOR EACH ROW EXECUTE FUNCTION immutable_record();

REVOKE ALL ON platform_coupons, platform_coupon_redemptions, platform_coupon_changes, platform_notices, platform_notice_changes FROM PUBLIC, astra_app;
GRANT SELECT, INSERT, UPDATE ON platform_coupons TO astra_app;
GRANT SELECT, INSERT ON platform_coupon_redemptions TO astra_app;
GRANT SELECT, INSERT ON platform_coupon_changes TO astra_app;
GRANT SELECT, INSERT, UPDATE ON platform_notices TO astra_app;
GRANT SELECT, INSERT ON platform_notice_changes TO astra_app;
