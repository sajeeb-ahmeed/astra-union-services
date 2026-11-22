-- Phase 4b (G11): office coupon codes applied to an application's fee snapshot.
-- A coupon gives a percentage or fixed discount on the assessed total, optionally only for some services,
-- inside a validity window and up to a redemption limit. The discount is stored on the immutable order
-- snapshot, and the database recomputes it from the coupon, so a snapshot can never carry an invented
-- discount. Redemptions are append-only rows; their count enforces the limit.
-- Effect on existing data: none. Existing snapshots get no coupon and a zero discount, so totals are unchanged.

CREATE TABLE coupon_codes (
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{2,31}$'),
 discount_kind text NOT NULL CHECK (discount_kind IN ('percent','fixed')),
 discount_value integer NOT NULL CHECK (discount_value > 0 AND (discount_kind <> 'percent' OR discount_value <= 100) AND discount_value <= 100000000),
 service_nos integer[] CHECK (service_nos IS NULL OR (cardinality(service_nos) BETWEEN 1 AND 47 AND 1 <= ALL(service_nos) AND 47 >= ALL(service_nos))),
 valid_from timestamptz NOT NULL DEFAULT now(),
 valid_until timestamptz,
 max_redemptions integer CHECK (max_redemptions IS NULL OR max_redemptions BETWEEN 1 AND 1000000),
 active boolean NOT NULL DEFAULT true,
 note text CHECK (note IS NULL OR length(note) <= 200),
 created_by uuid NOT NULL REFERENCES platform_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id, code),
 CHECK (valid_until IS NULL OR valid_until > valid_from)
);

ALTER TABLE application_order_snapshots
 ADD COLUMN coupon_code text,
 ADD COLUMN discount_minor integer NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
 ADD CONSTRAINT application_order_snapshots_coupon FOREIGN KEY (tenant_id, coupon_code) REFERENCES coupon_codes(tenant_id, code),
 ADD CONSTRAINT application_order_snapshots_discount CHECK (coupon_code IS NOT NULL OR discount_minor = 0);
ALTER TABLE application_order_snapshots DROP CONSTRAINT application_order_snapshots_check;
ALTER TABLE application_order_snapshots ADD CONSTRAINT application_order_snapshots_total
 CHECK (total_minor = statutory_fee_minor + processing_fee_minor + emergency_surcharge_minor + delivery_fee_minor - discount_minor AND total_minor >= 0);

CREATE TABLE coupon_redemptions (
 tenant_id uuid NOT NULL, code text NOT NULL, application_id uuid NOT NULL,
 discount_minor integer NOT NULL CHECK (discount_minor >= 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id, application_id),
 FOREIGN KEY (tenant_id, code) REFERENCES coupon_codes(tenant_id, code),
 FOREIGN KEY (tenant_id, application_id) REFERENCES application_order_snapshots(tenant_id, application_id)
);
CREATE INDEX coupon_redemptions_code ON coupon_redemptions(tenant_id, code);

-- The discount a coupon gives on a base amount, or NULL when it cannot be used for this service right now.
CREATE FUNCTION coupon_discount(t uuid, c text, service integer, base integer) RETURNS integer LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN k.discount_kind = 'percent' THEN (base::bigint * k.discount_value / 100)::integer
             ELSE least(k.discount_value, base) END
 FROM coupon_codes k
 WHERE k.tenant_id = t AND k.code = c AND k.active
   AND k.valid_from <= now() AND (k.valid_until IS NULL OR now() < k.valid_until)
   AND (k.service_nos IS NULL OR service = ANY(k.service_nos))
   AND (k.max_redemptions IS NULL OR (SELECT count(*) FROM coupon_redemptions r WHERE r.tenant_id = t AND r.code = c) < k.max_redemptions)
$$;

CREATE OR REPLACE FUNCTION enforce_order_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p service_order_policies%ROWTYPE; gross integer;
BEGIN
 SELECT * INTO p FROM service_order_policies WHERE tenant_id=NEW.tenant_id AND service_no=NEW.service_no AND version=NEW.policy_version;
 IF p.version IS NULL OR NOT (NEW.delivery_mode=ANY(p.delivery_modes)) OR NOT (NEW.urgency=ANY(p.urgencies))
  OR NEW.statutory_fee_minor<>p.statutory_fee_minor OR NEW.processing_fee_minor<>p.processing_fee_minor
  OR NEW.emergency_surcharge_minor<>(CASE WHEN NEW.urgency='urgent' THEN p.emergency_surcharge_minor ELSE 0 END)
  OR NEW.delivery_fee_minor<>(CASE WHEN NEW.delivery_mode='office_collection' THEN p.office_collection_fee_minor ELSE p.digital_copy_fee_minor END)
  OR NOT EXISTS(SELECT 1 FROM applications WHERE tenant_id=NEW.tenant_id AND id=NEW.application_id AND order_mode='POLICY') THEN
  RAISE EXCEPTION 'Invalid application order snapshot' USING ERRCODE='23514';
 END IF;
 gross := NEW.statutory_fee_minor + NEW.processing_fee_minor + NEW.emergency_surcharge_minor + NEW.delivery_fee_minor;
 IF NEW.coupon_code IS NULL AND NEW.discount_minor <> 0 THEN
  RAISE EXCEPTION 'A discount needs a coupon' USING ERRCODE='23514';
 END IF;
 IF NEW.coupon_code IS NOT NULL AND NEW.discount_minor IS DISTINCT FROM coupon_discount(NEW.tenant_id, NEW.coupon_code, NEW.service_no, gross) THEN
  RAISE EXCEPTION 'Coupon discount does not match the coupon' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

ALTER TABLE coupon_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON coupon_codes USING (tenant_id=nullif(current_setting('astra.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('astra.tenant_id',true),'')::uuid);
ALTER TABLE coupon_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon_redemptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON coupon_redemptions USING (tenant_id=nullif(current_setting('astra.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('astra.tenant_id',true),'')::uuid);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON coupon_redemptions FOR EACH ROW EXECUTE FUNCTION immutable_record();
REVOKE ALL ON coupon_codes, coupon_redemptions FROM PUBLIC, astra_app;
GRANT SELECT, INSERT ON coupon_codes TO astra_app;
GRANT UPDATE(active) ON coupon_codes TO astra_app;
GRANT SELECT, INSERT ON coupon_redemptions TO astra_app;
