-- Phase 7: real-gateway checkout for subscription / credit payment orders.
-- Until now a payment_order could only be settled by the demo HMAC webhook or by the
-- platform owner by hand. This migration adds the online path beside them, mirroring the
-- citizen-fee gateway discipline of migration 012 without touching its tables (those are
-- bound by trigger to approved applications): one checkout attempt per order, an opaque
-- callback token, execute claimed exactly once, and settlement only after the provider's
-- query + transaction search agree. A browser return or an IPN is only a signal.
-- It also gives payment_orders a terminal REFUNDED state for the order refund path
-- (migration 043 set the current constraint), and an order-refund state machine in the
-- shape of migration 032. Effect on existing data: none (new tables, one widened CHECK).

CREATE TABLE order_gateway_payments (
 tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL DEFAULT gen_random_uuid(), order_id uuid NOT NULL,
 provider text NOT NULL CHECK(provider IN ('BKASH','SSLCOMMERZ')), environment text NOT NULL CHECK(environment IN ('SANDBOX','LIVE')),
 merchant_account text NOT NULL CHECK(length(merchant_account) BETWEEN 1 AND 100), invoice text NOT NULL,
 amount_minor integer NOT NULL CHECK(amount_minor BETWEEN 1 AND 400000000), currency text NOT NULL CHECK(currency='BDT'),
 created_by uuid NOT NULL REFERENCES platform_users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 request_key uuid NOT NULL, request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 callback_hash text NOT NULL CHECK(callback_hash ~ '^[a-f0-9]{64}$'), callback_signature text,
 status text NOT NULL CHECK(status IN ('CREATE_PENDING','CREATE_UNKNOWN','READY','EXECUTE_PENDING','VERIFYING','PAID','REVIEW_REQUIRED','FAILED','REFUNDED')),
 payment_id text, checkout_url text, transaction_id text,
 evidence jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(evidence)='object'),
 create_started_at timestamptz NOT NULL DEFAULT now(), execute_started_at timestamptz, last_error text,
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,order_id), UNIQUE(tenant_id,request_key), UNIQUE(callback_hash),
 UNIQUE(provider,environment,merchant_account,invoice), UNIQUE(provider,environment,merchant_account,payment_id),
 FOREIGN KEY(tenant_id,order_id) REFERENCES payment_orders(tenant_id,id),
 CHECK((payment_id IS NULL AND checkout_url IS NULL AND callback_signature IS NULL) OR
       (payment_id IS NOT NULL AND checkout_url IS NOT NULL AND callback_signature IS NOT NULL)),
 CHECK(status NOT IN ('READY','EXECUTE_PENDING','VERIFYING','PAID','REFUNDED') OR payment_id IS NOT NULL)
);
CREATE INDEX order_gateway_payments_created ON order_gateway_payments(tenant_id,created_at,id);
CREATE TABLE order_gateway_events (
 tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), order_payment_id uuid NOT NULL,
 event_key text NOT NULL, event_type text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(metadata)='object'),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,order_payment_id,event_key),
 FOREIGN KEY(tenant_id,order_payment_id) REFERENCES order_gateway_payments(tenant_id,id)
);
CREATE TABLE order_gateway_reconciliations (
 tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), order_payment_id uuid NOT NULL,
 request_key uuid NOT NULL, actor_id uuid REFERENCES platform_users(id),
 result text NOT NULL CHECK(result IN ('MATCHED','MISMATCH','PENDING','ERROR')), reason text NOT NULL,
 metadata jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(metadata)='object'), checked_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,request_key), FOREIGN KEY(tenant_id,order_payment_id) REFERENCES order_gateway_payments(tenant_id,id)
);

CREATE FUNCTION enforce_order_gateway_payment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-ARRAY['status','payment_id','checkout_url','callback_signature','transaction_id','evidence','execute_started_at','updated_at','last_error'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','payment_id','checkout_url','callback_signature','transaction_id','evidence','execute_started_at','updated_at','last_error']) THEN
  RAISE EXCEPTION 'Order gateway payment financial request is immutable' USING ERRCODE='23514';
 END IF;
 IF OLD.payment_id IS NOT NULL AND (NEW.payment_id,NEW.checkout_url,NEW.callback_signature) IS DISTINCT FROM (OLD.payment_id,OLD.checkout_url,OLD.callback_signature) THEN
  RAISE EXCEPTION 'Order gateway checkout identity is immutable' USING ERRCODE='23514';
 END IF;
 IF OLD.execute_started_at IS NOT NULL AND NEW.execute_started_at IS DISTINCT FROM OLD.execute_started_at THEN
  RAISE EXCEPTION 'Order gateway execution may be claimed only once' USING ERRCODE='23514';
 END IF;
 IF OLD.status='PAID' AND NEW.status NOT IN ('PAID','REFUNDED') THEN RAISE EXCEPTION 'Confirmed order payment cannot be downgraded' USING ERRCODE='23514'; END IF;
 IF OLD.status='REFUNDED' AND NEW.status<>'REFUNDED' THEN RAISE EXCEPTION 'Refunded order payment is terminal' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER order_gateway_payment_guard BEFORE UPDATE ON order_gateway_payments FOR EACH ROW EXECUTE FUNCTION enforce_order_gateway_payment();

-- Order refunds: REQUESTED → APPROVED → SENT → SETTLED, or REQUESTED → REJECTED, or SENT → FAILED.
CREATE TABLE order_gateway_refunds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 order_id uuid NOT NULL,
 order_payment_id uuid NOT NULL,
 amount_minor integer NOT NULL CHECK (amount_minor > 0),
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 5 AND 255),
 status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','REJECTED','APPROVED','SENT','SETTLED','FAILED')),
 requested_by uuid NOT NULL REFERENCES platform_users(id),
 requested_at timestamptz NOT NULL DEFAULT now(),
 decided_by uuid REFERENCES platform_users(id),
 decided_at timestamptz,
 decision_note text CHECK (decision_note IS NULL OR length(decision_note) BETWEEN 3 AND 500),
 provider_refund_id text UNIQUE CHECK (provider_refund_id IS NULL OR provider_refund_id ~ '^[A-Za-z0-9]{8,30}$'),
 provider_reference text,
 sent_at timestamptz,
 settled_at timestamptz,
 last_error text,
 expected_by date,
 FOREIGN KEY (tenant_id, order_id) REFERENCES payment_orders(tenant_id, id),
 FOREIGN KEY (tenant_id, order_payment_id) REFERENCES order_gateway_payments(tenant_id, id),
 CHECK ((status IN ('REQUESTED')) = (decided_at IS NULL)),
 CHECK (status <> 'REJECTED' OR decision_note IS NOT NULL),
 CHECK (status NOT IN ('SENT','SETTLED','FAILED') OR provider_refund_id IS NOT NULL),
 CHECK ((status = 'SETTLED') = (settled_at IS NOT NULL))
);
-- At most one live refund per order.
CREATE UNIQUE INDEX order_gateway_refunds_live ON order_gateway_refunds(tenant_id, order_id) WHERE status NOT IN ('REJECTED','FAILED');
CREATE INDEX order_gateway_refunds_office ON order_gateway_refunds(tenant_id, requested_at DESC);

CREATE FUNCTION order_gateway_refund_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE paid integer;
BEGIN
 IF TG_OP = 'INSERT' THEN
  SELECT amount_minor INTO paid FROM order_gateway_payments
   WHERE tenant_id=NEW.tenant_id AND id=NEW.order_payment_id AND order_id=NEW.order_id AND status='PAID';
  IF paid IS NULL OR NEW.amount_minor > paid THEN RAISE EXCEPTION 'A refund cannot exceed the verified order payment'; END IF;
  IF NEW.status <> 'REQUESTED' THEN RAISE EXCEPTION 'A refund starts as requested'; END IF;
  RETURN NEW;
 END IF;
 IF (NEW.tenant_id, NEW.order_id, NEW.order_payment_id, NEW.amount_minor, NEW.reason, NEW.requested_by, NEW.requested_at)
    IS DISTINCT FROM (OLD.tenant_id, OLD.order_id, OLD.order_payment_id, OLD.amount_minor, OLD.reason, OLD.requested_by, OLD.requested_at)
 THEN RAISE EXCEPTION 'Only the progress of a refund can change'; END IF;
 IF OLD.provider_refund_id IS NOT NULL AND NEW.provider_refund_id IS DISTINCT FROM OLD.provider_refund_id
 THEN RAISE EXCEPTION 'A refund keeps its provider refund id'; END IF;
 IF NOT (
   (OLD.status = NEW.status AND OLD.status IN ('APPROVED','SENT'))
   OR (OLD.status = 'REQUESTED' AND NEW.status IN ('APPROVED','REJECTED'))
   OR (OLD.status = 'APPROVED' AND NEW.status = 'SENT')
   OR (OLD.status = 'SENT' AND NEW.status IN ('SETTLED','FAILED'))
 ) THEN RAISE EXCEPTION 'Refund cannot move from % to %', OLD.status, NEW.status; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER order_gateway_refund_rules BEFORE INSERT OR UPDATE ON order_gateway_refunds FOR EACH ROW EXECUTE FUNCTION order_gateway_refund_rules();
CREATE TRIGGER order_gateway_refund_no_delete BEFORE DELETE ON order_gateway_refunds FOR EACH ROW EXECUTE FUNCTION immutable_record();

ALTER TABLE payment_orders DROP CONSTRAINT payment_orders_status_check;
ALTER TABLE payment_orders ADD CONSTRAINT payment_orders_status_check CHECK(status IN ('PENDING','SETTLED','CANCELLED','REFUNDED'));

DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['order_gateway_payments','order_gateway_events','order_gateway_reconciliations','order_gateway_refunds'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY tenant_scope ON %I USING (tenant_id=nullif(current_setting(''astra.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=nullif(current_setting(''astra.tenant_id'',true),'''')::uuid)',tab);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,astra_app',tab);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO astra_app',tab);
 END LOOP;
 EXECUTE format('CREATE POLICY callback_owner_read ON order_gateway_payments FOR SELECT TO %I USING(true)',current_user);
END $$;
GRANT UPDATE(status,payment_id,checkout_url,callback_signature,transaction_id,evidence,execute_started_at,updated_at,last_error) ON order_gateway_payments TO astra_app;
GRANT UPDATE(status, decided_by, decided_at, decision_note, provider_refund_id, provider_reference, sent_at, settled_at, last_error, expected_by) ON order_gateway_refunds TO astra_app;
CREATE TRIGGER order_gateway_events_immutable BEFORE UPDATE OR DELETE ON order_gateway_events FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TRIGGER order_gateway_reconciliations_immutable BEFORE UPDATE OR DELETE ON order_gateway_reconciliations FOR EACH ROW EXECUTE FUNCTION immutable_record();

CREATE FUNCTION resolve_order_gateway_callback(token_digest text) RETURNS TABLE(tenant_id uuid,order_payment_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT p.tenant_id,p.id FROM order_gateway_payments p WHERE length(token_digest)=64 AND p.callback_hash=token_digest LIMIT 1;
$$;
REVOKE ALL ON FUNCTION resolve_order_gateway_callback(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_order_gateway_callback(text) TO astra_app;
