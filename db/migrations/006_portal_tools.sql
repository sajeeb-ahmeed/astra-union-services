-- Independent portal utilities; captured reference values are never fixtures.
ALTER TABLE platform_users ADD COLUMN name_bn text NOT NULL DEFAULT '';
ALTER TABLE platform_users ADD COLUMN phone text NOT NULL DEFAULT '';
ALTER TABLE platform_users ADD COLUMN address text NOT NULL DEFAULT '';
CREATE TABLE support_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, email text,
 subject text NOT NULL, message text NOT NULL, status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','RESOLVED')),
 created_at timestamptz NOT NULL DEFAULT now(), resolved_by uuid REFERENCES platform_users(id), resolved_at timestamptz
);
CREATE TABLE subscriptions_interest (
 email text PRIMARY KEY, consent_at timestamptz NOT NULL DEFAULT now(), status text NOT NULL DEFAULT 'REQUESTED' CHECK(status='REQUESTED')
);
CREATE TABLE print_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), citizen_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('biodata','holding','witness')), language text NOT NULL CHECK(language IN ('bn','en','bilingual')),
 request_key uuid NOT NULL, input_hash text NOT NULL, snapshot jsonb NOT NULL, pdf bytea NOT NULL,
 created_by uuid NOT NULL REFERENCES platform_users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,created_by,request_key), FOREIGN KEY(tenant_id,citizen_id) REFERENCES citizens(tenant_id,id)
);
ALTER TABLE outbox_events ADD CONSTRAINT outbox_tenant_id_unique UNIQUE(tenant_id,id);
CREATE TABLE notification_receipts (
 tenant_id uuid NOT NULL, event_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES platform_users(id), read_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,event_id,user_id), FOREIGN KEY(tenant_id,event_id) REFERENCES outbox_events(tenant_id,id)
);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['print_requests','notification_receipts'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
 EXECUTE format('CREATE POLICY tenant_scope ON %I USING (tenant_id = nullif(current_setting(''astra.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''astra.tenant_id'',true),'''')::uuid)',tab);
 END LOOP;
END $$;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON print_requests FOR EACH ROW EXECUTE FUNCTION immutable_record();
GRANT SELECT,INSERT,UPDATE ON support_requests,subscriptions_interest,notification_receipts TO astra_app;
GRANT SELECT,INSERT ON print_requests TO astra_app;
CREATE INDEX print_requests_tenant_time ON print_requests(tenant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS applications_tenant_state_time ON applications(tenant_id,state,created_at DESC);
CREATE INDEX citizens_tenant_created ON citizens(tenant_id,created_at DESC);
CREATE INDEX ledger_tenant_time ON credit_ledger(tenant_id,created_at DESC);
