-- Citizen service fees are independent from subscription invoices and SaaS credits.
CREATE TABLE gateway_token_cache (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id), credential_fingerprint text NOT NULL,
 encrypted_tokens text, expires_at timestamptz, refresh_after timestamptz,
 auth_attempts timestamptz[] NOT NULL DEFAULT '{}'
);
CREATE TABLE gateway_payment_intents (
 tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL DEFAULT gen_random_uuid(), application_id uuid NOT NULL,
 provider text NOT NULL CHECK(provider='BKASH'), environment text NOT NULL CHECK(environment IN ('SANDBOX','LIVE')),
 merchant_account text NOT NULL CHECK(length(merchant_account) BETWEEN 1 AND 100), invoice text NOT NULL,
 amount_minor integer NOT NULL CHECK(amount_minor BETWEEN 1 AND 400000000), currency text NOT NULL CHECK(currency='BDT'),
 created_by uuid NOT NULL REFERENCES platform_users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 request_key uuid NOT NULL, request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 callback_hash text NOT NULL CHECK(callback_hash ~ '^[a-f0-9]{64}$'), callback_signature text,
 status text NOT NULL CHECK(status IN ('CREATE_PENDING','CREATE_UNKNOWN','READY','EXECUTE_PENDING','VERIFYING','PAID','REVIEW_REQUIRED','FAILED')),
 payment_id text, checkout_url text, create_started_at timestamptz NOT NULL DEFAULT now(), execute_started_at timestamptz, last_error text,
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,application_id), UNIQUE(tenant_id,request_key), UNIQUE(callback_hash),
 UNIQUE(provider,environment,merchant_account,invoice), UNIQUE(provider,environment,merchant_account,payment_id),
 FOREIGN KEY(tenant_id,application_id) REFERENCES application_order_snapshots(tenant_id,application_id),
 CHECK((payment_id IS NULL AND checkout_url IS NULL AND callback_signature IS NULL) OR
       (payment_id IS NOT NULL AND checkout_url IS NOT NULL AND callback_signature IS NOT NULL)),
 CHECK(status NOT IN ('READY','EXECUTE_PENDING','VERIFYING','PAID') OR payment_id IS NOT NULL)
);
CREATE INDEX gateway_payment_intents_created ON gateway_payment_intents(tenant_id,created_at,id);
CREATE TABLE gateway_payment_events (
 tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), intent_id uuid NOT NULL,
 event_key text NOT NULL, event_type text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(metadata)='object'),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,intent_id,event_key),
 FOREIGN KEY(tenant_id,intent_id) REFERENCES gateway_payment_intents(tenant_id,id)
);
CREATE TABLE gateway_payment_confirmations (
 tenant_id uuid NOT NULL, intent_id uuid NOT NULL, application_id uuid NOT NULL,
 provider text NOT NULL CHECK(provider='BKASH'), environment text NOT NULL CHECK(environment IN ('SANDBOX','LIVE')),
 merchant_account text NOT NULL, payment_id text NOT NULL, transaction_id text NOT NULL,
 invoice text NOT NULL, amount_minor integer NOT NULL CHECK(amount_minor>0), currency text NOT NULL CHECK(currency='BDT'),
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object'), confirmed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,intent_id), UNIQUE(tenant_id,application_id), UNIQUE(provider,environment,merchant_account,transaction_id),
 FOREIGN KEY(tenant_id,intent_id) REFERENCES gateway_payment_intents(tenant_id,id),
 FOREIGN KEY(tenant_id,application_id) REFERENCES application_order_snapshots(tenant_id,application_id)
);
CREATE TABLE gateway_payment_receipts (
 tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), intent_id uuid NOT NULL, application_id uuid NOT NULL,
 receipt_number text NOT NULL UNIQUE, snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 pdf_bytes bytea NOT NULL CHECK(octet_length(pdf_bytes)>100), pdf_sha256 text NOT NULL CHECK(pdf_sha256 ~ '^[a-f0-9]{64}$'),
 issued_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,intent_id), UNIQUE(tenant_id,application_id),
 FOREIGN KEY(tenant_id,intent_id) REFERENCES gateway_payment_confirmations(tenant_id,intent_id),
 FOREIGN KEY(tenant_id,application_id) REFERENCES applications(tenant_id,id)
);
CREATE TABLE gateway_payment_reconciliations (
 tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), intent_id uuid NOT NULL,
 request_key uuid NOT NULL, actor_id uuid REFERENCES platform_users(id),
 result text NOT NULL CHECK(result IN ('MATCHED','MISMATCH','PENDING','ERROR')), reason text NOT NULL,
 metadata jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(metadata)='object'), checked_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,request_key), FOREIGN KEY(tenant_id,intent_id) REFERENCES gateway_payment_intents(tenant_id,id)
);

CREATE FUNCTION enforce_gateway_intent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ord application_order_snapshots%ROWTYPE; app applications%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['status','payment_id','checkout_url','callback_signature','execute_started_at','updated_at','last_error'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','payment_id','checkout_url','callback_signature','execute_started_at','updated_at','last_error']) THEN
   RAISE EXCEPTION 'Gateway intent financial request is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.payment_id IS NOT NULL AND (NEW.payment_id,NEW.checkout_url,NEW.callback_signature) IS DISTINCT FROM (OLD.payment_id,OLD.checkout_url,OLD.callback_signature) THEN
   RAISE EXCEPTION 'Gateway checkout identity is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.execute_started_at IS NOT NULL AND NEW.execute_started_at IS DISTINCT FROM OLD.execute_started_at THEN
   RAISE EXCEPTION 'Gateway execution may be claimed only once' USING ERRCODE='23514';
  END IF;
  IF OLD.status='PAID' AND NEW.status<>'PAID' THEN RAISE EXCEPTION 'Confirmed payment cannot be downgraded' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 PERFORM 1 FROM tenants WHERE id=NEW.tenant_id AND status='ACTIVE' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active office required' USING ERRCODE='23514'; END IF;
 SELECT * INTO app FROM applications WHERE tenant_id=NEW.tenant_id AND id=NEW.application_id FOR SHARE;
 SELECT * INTO ord FROM application_order_snapshots WHERE tenant_id=NEW.tenant_id AND application_id=NEW.application_id;
 IF app.state IS DISTINCT FROM 'APPROVED' OR ord.total_minor IS DISTINCT FROM NEW.amount_minor OR ord.currency IS DISTINCT FROM NEW.currency THEN
  RAISE EXCEPTION 'Checkout must match an approved application order' USING ERRCODE='23514';
 END IF;
 IF NEW.status<>'CREATE_PENDING' OR NEW.payment_id IS NOT NULL OR NEW.execute_started_at IS NOT NULL THEN
  RAISE EXCEPTION 'New checkout requires a fresh execution claim' USING ERRCODE='23514';
 END IF;
 IF NEW.created_by IS DISTINCT FROM nullif(current_setting('astra.actor_id',true),'')::uuid THEN
  RAISE EXCEPTION 'Authenticated checkout actor required' USING ERRCODE='23514';
 END IF;
 PERFORM 1 FROM staff_memberships m JOIN platform_users u ON u.id=m.user_id
 WHERE m.tenant_id=NEW.tenant_id AND m.user_id=NEW.created_by AND m.active AND u.active
 AND (m.role IN ('staff','admin') OR (m.role='citizen' AND EXISTS(SELECT 1 FROM citizens c WHERE c.id=app.citizen_id AND c.tenant_id=app.tenant_id AND c.user_id=m.user_id)))
 FOR SHARE OF m,u;
 IF NOT FOUND THEN RAISE EXCEPTION 'Checkout role or ownership required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER gateway_intent_validate BEFORE INSERT OR UPDATE ON gateway_payment_intents FOR EACH ROW EXECUTE FUNCTION enforce_gateway_intent();
CREATE FUNCTION enforce_gateway_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p gateway_payment_intents%ROWTYPE;
BEGIN
 SELECT * INTO p FROM gateway_payment_intents WHERE tenant_id=NEW.tenant_id AND id=NEW.intent_id FOR UPDATE;
 IF (NEW.application_id,NEW.provider,NEW.environment,NEW.merchant_account,NEW.payment_id,NEW.invoice,NEW.amount_minor,NEW.currency)
 IS DISTINCT FROM (p.application_id,p.provider,p.environment,p.merchant_account,p.payment_id,p.invoice,p.amount_minor,p.currency)
 OR NEW.evidence->>'queryStatus' IS DISTINCT FROM 'Completed' OR NEW.evidence->>'searchStatus' IS DISTINCT FROM 'Completed' THEN
  RAISE EXCEPTION 'Payment confirmation must match verified checkout' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER gateway_confirmation_validate BEFORE INSERT ON gateway_payment_confirmations FOR EACH ROW EXECUTE FUNCTION enforce_gateway_confirmation();
CREATE FUNCTION enforce_gateway_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p gateway_payment_confirmations%ROWTYPE;
BEGIN
 SELECT * INTO p FROM gateway_payment_confirmations WHERE tenant_id=NEW.tenant_id AND intent_id=NEW.intent_id;
 IF p.application_id IS DISTINCT FROM NEW.application_id OR NEW.pdf_sha256<>encode(digest(NEW.pdf_bytes,'sha256'),'hex')
 OR NEW.snapshot->>'verification' IS DISTINCT FROM 'BKASH_QUERY_AND_SEARCH'
 OR NEW.snapshot->>'environment' IS DISTINCT FROM p.environment OR NEW.snapshot->>'transactionId' IS DISTINCT FROM p.transaction_id
 OR NEW.snapshot->>'amountMinor' IS DISTINCT FROM p.amount_minor::text THEN
  RAISE EXCEPTION 'Receipt must match immutable gateway confirmation' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER gateway_receipt_validate BEFORE INSERT ON gateway_payment_receipts FOR EACH ROW EXECUTE FUNCTION enforce_gateway_receipt();
CREATE FUNCTION require_gateway_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM gateway_payment_receipts WHERE tenant_id=NEW.tenant_id AND intent_id=NEW.intent_id) THEN
  RAISE EXCEPTION 'Gateway confirmation and receipt must commit together' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER gateway_confirmation_receipt AFTER INSERT ON gateway_payment_confirmations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_gateway_receipt();
CREATE FUNCTION require_gateway_paid_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='PAID' AND NOT EXISTS(SELECT 1 FROM gateway_payment_confirmations WHERE tenant_id=NEW.tenant_id AND intent_id=NEW.id) THEN
  RAISE EXCEPTION 'Verified confirmation required for paid state' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER gateway_paid_confirmation AFTER INSERT OR UPDATE ON gateway_payment_intents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_gateway_paid_confirmation();

DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['gateway_token_cache','gateway_payment_intents','gateway_payment_events','gateway_payment_confirmations','gateway_payment_receipts','gateway_payment_reconciliations'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY tenant_scope ON %I USING (tenant_id=nullif(current_setting(''astra.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=nullif(current_setting(''astra.tenant_id'',true),'''')::uuid)',tab);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,astra_app',tab);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO astra_app',tab);
  IF tab NOT IN ('gateway_token_cache','gateway_payment_intents') THEN
   EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION immutable_record()',tab);
  END IF;
 END LOOP;
 IF current_user='astra_app' OR pg_has_role('astra_app',current_user,'MEMBER') THEN RAISE EXCEPTION 'Migration owner must be separate from runtime role'; END IF;
 EXECUTE format('CREATE POLICY callback_owner_read ON gateway_payment_intents FOR SELECT TO %I USING(true)',current_user);
END $$;
GRANT UPDATE ON gateway_token_cache TO astra_app;
GRANT UPDATE(status,payment_id,checkout_url,callback_signature,execute_started_at,updated_at,last_error) ON gateway_payment_intents TO astra_app;
CREATE FUNCTION resolve_gateway_callback(token_digest text) RETURNS TABLE(tenant_id uuid,intent_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT p.tenant_id,p.id FROM gateway_payment_intents p WHERE length(token_digest)=64 AND p.callback_hash=token_digest LIMIT 1;
$$;
REVOKE ALL ON FUNCTION resolve_gateway_callback(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_gateway_callback(text) TO astra_app;
