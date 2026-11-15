-- Phase 5d: refunds of a verified citizen payment, as their own state machine:
--   REQUESTED → APPROVED → SENT → SETTLED, or REQUESTED → REJECTED, or SENT → FAILED.
-- A refund is requested by the applicant or office staff, approved by office admin/finance, sent once to the
-- provider (the refund id is stored before the call, so a retry repeats the same request), and settled only
-- when the provider reports it refunded. The original payment, confirmation and receipt are never edited;
-- an application with an approved or settled refund no longer counts as paid, so it cannot be issued.
-- Effect on existing data: none (new table).

CREATE TABLE application_refunds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 application_id uuid NOT NULL,
 intent_id uuid NOT NULL,
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
 FOREIGN KEY (tenant_id, intent_id) REFERENCES gateway_payment_confirmations(tenant_id, intent_id),
 CHECK ((status IN ('REQUESTED')) = (decided_at IS NULL)),
 CHECK (status <> 'REJECTED' OR decision_note IS NOT NULL),
 CHECK (status NOT IN ('SENT','SETTLED','FAILED') OR provider_refund_id IS NOT NULL),
 CHECK ((status = 'SETTLED') = (settled_at IS NOT NULL))
);
-- At most one live refund per application.
CREATE UNIQUE INDEX application_refunds_live ON application_refunds(tenant_id, application_id) WHERE status NOT IN ('REJECTED','FAILED');
CREATE INDEX application_refunds_office ON application_refunds(tenant_id, requested_at DESC);

CREATE FUNCTION application_refund_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE paid integer;
BEGIN
 IF TG_OP = 'INSERT' THEN
  SELECT amount_minor INTO paid FROM gateway_payment_confirmations
   WHERE tenant_id=NEW.tenant_id AND intent_id=NEW.intent_id AND application_id=NEW.application_id;
  IF paid IS NULL OR NEW.amount_minor > paid THEN RAISE EXCEPTION 'A refund cannot exceed the verified payment'; END IF;
  IF NEW.status <> 'REQUESTED' THEN RAISE EXCEPTION 'A refund starts as requested'; END IF;
  RETURN NEW;
 END IF;
 IF (NEW.tenant_id, NEW.application_id, NEW.intent_id, NEW.amount_minor, NEW.reason, NEW.requested_by, NEW.requested_at)
    IS DISTINCT FROM (OLD.tenant_id, OLD.application_id, OLD.intent_id, OLD.amount_minor, OLD.reason, OLD.requested_by, OLD.requested_at)
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
CREATE TRIGGER application_refund_rules BEFORE INSERT OR UPDATE ON application_refunds FOR EACH ROW EXECUTE FUNCTION application_refund_rules();
CREATE TRIGGER application_refund_no_delete BEFORE DELETE ON application_refunds FOR EACH ROW EXECUTE FUNCTION immutable_record();

ALTER TABLE application_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_refunds FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON application_refunds USING (tenant_id=nullif(current_setting('astra.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('astra.tenant_id',true),'')::uuid);
REVOKE ALL ON application_refunds FROM PUBLIC, astra_app;
GRANT SELECT, INSERT ON application_refunds TO astra_app;
GRANT UPDATE(status, decided_by, decided_at, decision_note, provider_refund_id, provider_reference, sent_at, settled_at, last_error, expected_by) ON application_refunds TO astra_app;
