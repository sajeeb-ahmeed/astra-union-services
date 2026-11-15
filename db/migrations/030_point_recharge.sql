-- Phase 5b: offices recharge their points wallet by bank deposit; the platform owner confirms (owner decision).
-- The deposit slip is an office document that goes through the same quarantine and malware scan as citizen
-- uploads, so attachments gain a purpose and citizen_id becomes optional for office documents only.
-- Confirming a request credits the wallet with exactly one RECHARGE ledger entry named after the request.
-- Effect on existing data: existing attachments become purpose 'citizen' (unchanged behaviour).

ALTER TABLE attachments ALTER COLUMN citizen_id DROP NOT NULL;
ALTER TABLE attachments ADD COLUMN purpose text NOT NULL DEFAULT 'citizen' CHECK (purpose IN ('citizen', 'recharge_proof'));
ALTER TABLE attachments ADD CONSTRAINT attachments_purpose_owner CHECK ((purpose = 'citizen') = (citizen_id IS NOT NULL));
GRANT INSERT(purpose) ON attachments TO astra_app;

-- Owner-managed list of the accounts offices may deposit into.
CREATE TABLE recharge_banks (
 code text PRIMARY KEY CHECK (code ~ '^[a-z0-9-]{2,40}$'),
 name_bn text NOT NULL CHECK (length(btrim(name_bn)) BETWEEN 2 AND 120),
 name_en text NOT NULL CHECK (length(btrim(name_en)) BETWEEN 2 AND 120),
 account_name text NOT NULL CHECK (length(btrim(account_name)) BETWEEN 2 AND 120),
 account_number text NOT NULL CHECK (account_number ~ '^[0-9A-Za-z -]{4,40}$'),
 branch text CHECK (branch IS NULL OR length(branch) <= 120),
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON recharge_banks TO astra_app;

CREATE TABLE recharge_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 100 AND 100000000),
 bank_code text NOT NULL REFERENCES recharge_banks(code),
 deposit_reference text NOT NULL CHECK (length(btrim(deposit_reference)) BETWEEN 3 AND 80),
 deposit_date date NOT NULL,
 proof_attachment_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'REJECTED')),
 requested_by uuid NOT NULL REFERENCES platform_users(id),
 decided_by uuid REFERENCES platform_users(id),
 decided_at timestamptz,
 decision_note text CHECK (decision_note IS NULL OR length(decision_note) BETWEEN 3 AND 500),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (tenant_id, proof_attachment_id) REFERENCES attachments(tenant_id, id),
 CHECK ((status = 'PENDING') = (decided_at IS NULL) AND (status = 'PENDING') = (decided_by IS NULL)),
 CHECK (status <> 'REJECTED' OR decision_note IS NOT NULL)
);
CREATE INDEX recharge_requests_queue ON recharge_requests(status, created_at);
CREATE INDEX recharge_requests_office ON recharge_requests(tenant_id, created_at DESC);
-- One bank deposit reference can fund one request per bank.
CREATE UNIQUE INDEX recharge_requests_reference ON recharge_requests(bank_code, lower(deposit_reference)) WHERE status <> 'REJECTED';

-- A decided request never changes again; a pending one may only be decided.
CREATE FUNCTION recharge_request_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status <> 'PENDING' THEN RAISE EXCEPTION 'A decided recharge request is final'; END IF;
 IF (NEW.tenant_id, NEW.amount_minor, NEW.bank_code, NEW.deposit_reference, NEW.deposit_date, NEW.proof_attachment_id, NEW.requested_by, NEW.created_at)
    IS DISTINCT FROM (OLD.tenant_id, OLD.amount_minor, OLD.bank_code, OLD.deposit_reference, OLD.deposit_date, OLD.proof_attachment_id, OLD.requested_by, OLD.created_at)
 THEN RAISE EXCEPTION 'Only the decision of a recharge request can change'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recharge_request_transition BEFORE UPDATE ON recharge_requests FOR EACH ROW EXECUTE FUNCTION recharge_request_transition();
CREATE TRIGGER recharge_request_no_delete BEFORE DELETE ON recharge_requests FOR EACH ROW EXECUTE FUNCTION immutable_record();

ALTER TABLE recharge_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE recharge_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON recharge_requests USING (tenant_id=nullif(current_setting('astra.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('astra.tenant_id',true),'')::uuid);
REVOKE ALL ON recharge_requests FROM PUBLIC, astra_app;
GRANT SELECT, INSERT ON recharge_requests TO astra_app;
GRANT UPDATE(status, decided_by, decided_at, decision_note) ON recharge_requests TO astra_app;

-- The owner queue spans offices; it returns request metadata only (never the slip bytes). The API allows it
-- to the owner role only; opening a slip or deciding a request runs inside that office's tenant context.
CREATE FUNCTION owner_recharge_queue(wanted text) RETURNS TABLE (
 id uuid, tenant_id uuid, office_slug text, office_name_bn text, office_name_en text, amount_minor bigint,
 bank_code text, deposit_reference text, deposit_date date, status text, created_at timestamptz, decided_at timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT r.id, r.tenant_id, t.slug, t.name_bn, t.name_en, r.amount_minor, r.bank_code, r.deposit_reference, r.deposit_date,
        r.status, r.created_at, r.decided_at
 FROM recharge_requests r JOIN tenants t ON t.id = r.tenant_id
 WHERE r.status = wanted ORDER BY r.created_at LIMIT 200
$$;
REVOKE EXECUTE ON FUNCTION owner_recharge_queue(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION owner_recharge_queue(text) TO astra_app;

-- The owner queue function runs as the migration owner, which FORCE ROW LEVEL SECURITY also restricts
-- (see migration 009): give that owner an explicit read policy. astra_app keeps tenant_scope only.
DO $$ BEGIN
 IF current_user = 'astra_app' OR pg_has_role('astra_app', current_user, 'MEMBER') THEN
  RAISE EXCEPTION 'The application role must not be or inherit the migration owner';
 END IF;
 EXECUTE format('CREATE POLICY definer_queue_read ON recharge_requests FOR SELECT TO %I USING (true)', current_user);
END $$;
