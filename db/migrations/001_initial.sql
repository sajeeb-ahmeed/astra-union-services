CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE tenants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text UNIQUE NOT NULL,
 name_bn text NOT NULL, name_en text NOT NULL, status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SUSPENDED')),
 demo boolean NOT NULL DEFAULT true CHECK(demo), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE platform_users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL, display_name text NOT NULL,
 password_hash text NOT NULL, active boolean NOT NULL DEFAULT true, platform_role text CHECK(platform_role='owner')
);
CREATE TABLE staff_memberships (
 user_id uuid NOT NULL REFERENCES platform_users(id), tenant_id uuid NOT NULL REFERENCES tenants(id),
 role text NOT NULL CHECK(role IN ('admin','approver','reviewer','staff','finance','citizen')), active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(user_id,tenant_id)
);
CREATE TABLE sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES platform_users(id), tenant_id uuid REFERENCES tenants(id),
 csrf_token text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE approval_authorizations (
 tenant_id uuid NOT NULL REFERENCES tenants(id), user_id uuid NOT NULL REFERENCES platform_users(id), service_no integer NOT NULL,
 active boolean NOT NULL DEFAULT true, authority_note text NOT NULL, PRIMARY KEY(tenant_id,user_id,service_no)
);
CREATE TABLE citizens (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), user_id uuid REFERENCES platform_users(id),
 full_name_bn text NOT NULL, full_name_en text NOT NULL, date_of_birth date NOT NULL,
 address_bn text NOT NULL, address_en text NOT NULL, synthetic_reference text NOT NULL,
 verification_state text NOT NULL DEFAULT 'SYNTHETIC_DEMO' CHECK(verification_state='SYNTHETIC_DEMO'),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,synthetic_reference)
);
CREATE TABLE service_catalog (
 service_no integer PRIMARY KEY CHECK(service_no BETWEEN 1 AND 47), name_bn text NOT NULL, name_en text NOT NULL,
 category text NOT NULL, readiness text NOT NULL CHECK(readiness IN ('operational_demo','catalog_preview')), reference_evidence text NOT NULL
);
CREATE TABLE service_versions (
 service_no integer NOT NULL REFERENCES service_catalog(service_no), version integer NOT NULL, schema_json jsonb NOT NULL,
 schema_hash text NOT NULL, PRIMARY KEY(service_no,version)
);
CREATE TABLE tenant_service_configuration (
 tenant_id uuid NOT NULL REFERENCES tenants(id), service_no integer NOT NULL REFERENCES service_catalog(service_no),
 enabled boolean NOT NULL DEFAULT true, credit_cost integer NOT NULL DEFAULT 1 CHECK(credit_cost>0),
 PRIMARY KEY(tenant_id,service_no)
);
CREATE TABLE applications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), citizen_id uuid NOT NULL,
 service_no integer NOT NULL, schema_version integer NOT NULL, schema_hash text NOT NULL,
 state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','SUBMITTED','UNDER_REVIEW','CORRECTION_REQUIRED','RESUBMITTED','APPROVED','ISSUED','REJECTED','CANCELLED','REVOKED')),
 latest_version integer NOT NULL DEFAULT 1, created_by uuid NOT NULL REFERENCES platform_users(id), approved_by uuid REFERENCES platform_users(id), approved_version integer,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,citizen_id) REFERENCES citizens(tenant_id,id),
 FOREIGN KEY(service_no,schema_version) REFERENCES service_versions(service_no,version)
);
CREATE TABLE application_payload_versions (
 tenant_id uuid NOT NULL, application_id uuid NOT NULL, version integer NOT NULL, payload jsonb NOT NULL, payload_hash text NOT NULL,
 actor_id uuid NOT NULL REFERENCES platform_users(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,application_id,version), FOREIGN KEY(tenant_id,application_id) REFERENCES applications(tenant_id,id)
);
CREATE TABLE application_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, application_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES platform_users(id), action text NOT NULL, from_state text, to_state text NOT NULL, reason text,
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(tenant_id,application_id) REFERENCES applications(tenant_id,id)
);
CREATE TABLE audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid REFERENCES tenants(id), actor_id uuid REFERENCES platform_users(id),
 action text NOT NULL, resource_id text, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE subscription_plans (
 id text PRIMARY KEY, name text NOT NULL, price_minor integer NOT NULL CHECK(price_minor>=0), currency text NOT NULL CHECK(currency='BDT'),
 grant_credits integer NOT NULL CHECK(grant_credits>0), duration_days integer NOT NULL CHECK(duration_days>0), rollover boolean NOT NULL DEFAULT true,
 demo boolean NOT NULL DEFAULT true CHECK(demo)
);
CREATE TABLE tenant_subscriptions (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id), plan_id text NOT NULL REFERENCES subscription_plans(id),
 valid_until timestamptz NOT NULL, status text NOT NULL CHECK(status IN ('ACTIVE','EXPIRED','SUSPENDED'))
);
CREATE TABLE tenant_wallets (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id), balance integer NOT NULL DEFAULT 0 CHECK(balance>=0)
);
CREATE TABLE certificates (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, application_id uuid NOT NULL, number text NOT NULL UNIQUE,
 service_no integer NOT NULL REFERENCES service_catalog(service_no), template_version integer NOT NULL DEFAULT 1,
 verification_token text NOT NULL, token_hash text NOT NULL UNIQUE, pdf bytea NOT NULL,
 status text NOT NULL DEFAULT 'ISSUED' CHECK(status IN ('ISSUED','REVOKED')), issued_by uuid NOT NULL REFERENCES platform_users(id),
 issued_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz, revocation_reason text,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,application_id), FOREIGN KEY(tenant_id,application_id) REFERENCES applications(tenant_id,id)
);
CREATE TABLE credit_ledger (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenant_wallets(tenant_id), delta integer NOT NULL CHECK(delta<>0),
 kind text NOT NULL CHECK(kind IN ('ISSUANCE','PLAN_GRANT','TOPUP','ADJUSTMENT')), idempotency_key text NOT NULL,
 certificate_id uuid, actor_id uuid NOT NULL REFERENCES platform_users(id), reason text NOT NULL, balance_after integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,idempotency_key),
 FOREIGN KEY(tenant_id,certificate_id) REFERENCES certificates(tenant_id,id),
 CHECK((kind='ISSUANCE' AND delta<0 AND certificate_id IS NOT NULL) OR (kind<>'ISSUANCE' AND certificate_id IS NULL))
);
CREATE UNIQUE INDEX one_issuance_charge ON credit_ledger(tenant_id,certificate_id) WHERE kind='ISSUANCE';
CREATE TABLE payment_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), kind text NOT NULL CHECK(kind IN ('topup','subscription')),
 plan_id text REFERENCES subscription_plans(id), credits integer NOT NULL CHECK(credits>0), amount_minor integer NOT NULL CHECK(amount_minor>=0),
 currency text NOT NULL CHECK(currency='BDT'), status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SETTLED')),
 created_by uuid NOT NULL REFERENCES platform_users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id)
);
CREATE TABLE payment_events (
 event_id text PRIMARY KEY, tenant_id uuid NOT NULL, order_id uuid NOT NULL, body_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(tenant_id,order_id) REFERENCES payment_orders(tenant_id,id)
);
CREATE TABLE invoices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, order_id uuid NOT NULL,
 amount_minor integer NOT NULL, currency text NOT NULL, type text NOT NULL DEFAULT 'SAAS_DEMO', issued_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,order_id), FOREIGN KEY(tenant_id,order_id) REFERENCES payment_orders(tenant_id,id)
);
CREATE TABLE government_fee_assessments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, application_id uuid NOT NULL, amount_minor integer NOT NULL CHECK(amount_minor>=0),
 authority_reference text NOT NULL, status text NOT NULL DEFAULT 'NOT_CONFIGURED',
 FOREIGN KEY(tenant_id,application_id) REFERENCES applications(tenant_id,id)
);
CREATE TABLE outbox_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), kind text NOT NULL, resource_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), delivered_at timestamptz
);
CREATE TABLE attachments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), citizen_id uuid NOT NULL, uploaded_by uuid NOT NULL REFERENCES platform_users(id),
 mime_type text NOT NULL, byte_length integer NOT NULL CHECK(byte_length BETWEEN 1 AND 2097152), bytes bytea NOT NULL, scan_state text NOT NULL DEFAULT 'UNSCANNED',
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,citizen_id) REFERENCES citizens(tenant_id,id)
);
CREATE FUNCTION immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Append-only record'; END $$;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['credit_ledger','application_payload_versions','application_events','audit_events','payment_events','invoices','service_versions'] LOOP
 EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION immutable_record()',tab);
 END LOOP;
END $$;
CREATE FUNCTION apply_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_balance integer; BEGIN
 SELECT balance INTO current_balance FROM tenant_wallets WHERE tenant_id=NEW.tenant_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM credit_ledger WHERE tenant_id=NEW.tenant_id AND idempotency_key=NEW.idempotency_key) THEN RETURN NULL; END IF;
 IF current_balance IS NULL OR current_balance+NEW.delta<0 THEN RAISE EXCEPTION 'Insufficient credits'; END IF;
 NEW.balance_after := current_balance+NEW.delta;
 UPDATE tenant_wallets SET balance=NEW.balance_after WHERE tenant_id=NEW.tenant_id;
 RETURN NEW;
END $$;
CREATE TRIGGER ledger_balance BEFORE INSERT ON credit_ledger FOR EACH ROW EXECUTE FUNCTION apply_ledger();
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['approval_authorizations','citizens','tenant_service_configuration','applications','application_payload_versions','application_events','audit_events','tenant_subscriptions','tenant_wallets','certificates','credit_ledger','payment_orders','payment_events','invoices','government_fee_assessments','outbox_events','attachments'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
 EXECUTE format('CREATE POLICY tenant_scope ON %I USING (tenant_id = nullif(current_setting(''astra.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''astra.tenant_id'',true),'''')::uuid)',tab);
 END LOOP;
END $$;
CREATE FUNCTION public_verify(token_digest text) RETURNS TABLE(status text,office_bn text,office_en text,service_no integer,service_bn text,service_en text,issued_at timestamptz,demo boolean)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT c.status,t.name_bn,t.name_en,c.service_no,s.name_bn,s.name_en,c.issued_at,t.demo
 FROM certificates c JOIN tenants t ON t.id=c.tenant_id JOIN service_catalog s ON s.service_no=c.service_no WHERE c.token_hash=token_digest;
$$;
REVOKE ALL ON FUNCTION public_verify(text) FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO astra_app;
GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO astra_app;
REVOKE ALL ON schema_migrations FROM astra_app;
GRANT EXECUTE ON FUNCTION public_verify(text) TO astra_app;
