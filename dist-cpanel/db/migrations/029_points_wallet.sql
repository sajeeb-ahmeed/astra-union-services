-- Phase 5a: a points wallet beside the existing credit wallet (owner decision "keep both").
-- 1 BDT = 1 point, kept in poisha (integer minor units, so ৳15.75 is 1575). The platform owner prices each
-- service in points; issuing a certificate deducts that price once, inside the issuance transaction.
-- Same discipline as the credit ledger: the append-only ledger is the source of truth, the wallet balance is a
-- cache maintained only by an owner-trusted trigger, and the application role cannot update it directly.
-- Effect on existing data: every office gets an empty points wallet; no service has a point price yet, so
-- nothing is deducted until the owner publishes prices.

CREATE TABLE point_wallets (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
 balance_minor bigint NOT NULL DEFAULT 0 CHECK (balance_minor >= 0)
);
INSERT INTO point_wallets(tenant_id) SELECT id FROM tenants;

CREATE TABLE point_ledger (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES point_wallets(tenant_id),
 delta_minor bigint NOT NULL CHECK (delta_minor <> 0 AND abs(delta_minor) <= 100000000000),
 kind text NOT NULL CHECK (kind IN ('RECHARGE','ISSUANCE','ADJUSTMENT','REVERSAL')),
 idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 3 AND 200),
 certificate_id uuid,
 actor_id uuid NOT NULL REFERENCES platform_users(id),
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
 balance_after bigint NOT NULL CHECK (balance_after >= 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id, idempotency_key),
 FOREIGN KEY (tenant_id, certificate_id) REFERENCES certificates(tenant_id, id),
 CHECK ((kind = 'ISSUANCE' AND delta_minor < 0 AND certificate_id IS NOT NULL) OR (kind <> 'ISSUANCE' AND certificate_id IS NULL)),
 CHECK (kind <> 'RECHARGE' OR delta_minor > 0)
);
CREATE UNIQUE INDEX one_point_issuance ON point_ledger(tenant_id, certificate_id) WHERE kind = 'ISSUANCE';
CREATE INDEX point_ledger_recent ON point_ledger(tenant_id, created_at DESC, id);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON point_ledger FOR EACH ROW EXECUTE FUNCTION immutable_record();

CREATE FUNCTION apply_point_ledger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE current_balance bigint; BEGIN
 SELECT balance_minor INTO current_balance FROM point_wallets WHERE tenant_id=NEW.tenant_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM point_ledger WHERE tenant_id=NEW.tenant_id AND idempotency_key=NEW.idempotency_key) THEN RETURN NULL; END IF;
 IF current_balance IS NULL OR current_balance + NEW.delta_minor < 0 THEN
  RAISE EXCEPTION 'Insufficient points' USING ERRCODE='P0001', HINT='POINTS_INSUFFICIENT';
 END IF;
 NEW.balance_after := current_balance + NEW.delta_minor;
 UPDATE point_wallets SET balance_minor=NEW.balance_after WHERE tenant_id=NEW.tenant_id;
 RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION apply_point_ledger() FROM PUBLIC;
CREATE TRIGGER point_ledger_balance BEFORE INSERT ON point_ledger FOR EACH ROW EXECUTE FUNCTION apply_point_ledger();

-- New offices get their points wallet with the office row.
CREATE FUNCTION create_point_wallet() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN INSERT INTO point_wallets(tenant_id) VALUES (NEW.id) ON CONFLICT DO NOTHING; RETURN NEW; END $$;
REVOKE EXECUTE ON FUNCTION create_point_wallet() FROM PUBLIC;
CREATE TRIGGER tenant_point_wallet AFTER INSERT ON tenants FOR EACH ROW EXECUTE FUNCTION create_point_wallet();

-- Owner-set price of one certificate per service, versioned; the latest version is current. 0 = free.
CREATE TABLE service_point_prices (
 service_no integer NOT NULL REFERENCES service_catalog(service_no),
 version integer NOT NULL CHECK (version > 0),
 price_minor integer NOT NULL CHECK (price_minor BETWEEN 0 AND 10000000),
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
 created_by uuid NOT NULL REFERENCES platform_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (service_no, version)
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON service_point_prices FOR EACH ROW EXECUTE FUNCTION immutable_record();

ALTER TABLE point_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE point_wallets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON point_wallets USING (tenant_id=nullif(current_setting('astra.tenant_id',true),'')::uuid);
ALTER TABLE point_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE point_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON point_ledger USING (tenant_id=nullif(current_setting('astra.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('astra.tenant_id',true),'')::uuid);
REVOKE ALL ON point_wallets, point_ledger, service_point_prices FROM PUBLIC, astra_app;
GRANT SELECT ON point_wallets TO astra_app;
GRANT SELECT, INSERT ON point_ledger TO astra_app;
GRANT SELECT, INSERT ON service_point_prices TO astra_app;

-- The wallet triggers run as the migration owner. FORCE ROW LEVEL SECURITY applies to that owner as well,
-- and on managed PostgreSQL it is not a superuser, so it gets explicit policies (as in migration 009). The
-- request role (astra_app) keeps tenant_scope only and must never inherit the owner.
DO $$ BEGIN
 IF current_user = 'astra_app' OR pg_has_role('astra_app', current_user, 'MEMBER') THEN
  RAISE EXCEPTION 'The application role must not be or inherit the migration owner';
 END IF;
 EXECUTE format('CREATE POLICY definer_wallet_maintenance ON point_wallets FOR ALL TO %I USING (true) WITH CHECK (true)', current_user);
 EXECUTE format('CREATE POLICY definer_ledger_read ON point_ledger FOR SELECT TO %I USING (true)', current_user);
END $$;
