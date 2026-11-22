-- Policies are explicit per-office tariffs; no default tariff is inferred.
CREATE TABLE service_order_policies (
 tenant_id uuid NOT NULL, service_no integer NOT NULL, version integer NOT NULL CHECK(version>0),
 statutory_fee_minor integer NOT NULL CHECK(statutory_fee_minor BETWEEN 0 AND 100000000),
 processing_fee_minor integer NOT NULL CHECK(processing_fee_minor BETWEEN 0 AND 100000000),
 emergency_surcharge_minor integer NOT NULL CHECK(emergency_surcharge_minor BETWEEN 0 AND 100000000),
 office_collection_fee_minor integer NOT NULL CHECK(office_collection_fee_minor BETWEEN 0 AND 100000000),
 digital_copy_fee_minor integer NOT NULL CHECK(digital_copy_fee_minor BETWEEN 0 AND 100000000),
 delivery_modes text[] NOT NULL CHECK(cardinality(delivery_modes) BETWEEN 1 AND 2 AND delivery_modes <@ ARRAY['office_collection','digital_copy']::text[] AND (cardinality(delivery_modes)=1 OR delivery_modes[1]<>delivery_modes[2])),
 urgencies text[] NOT NULL CHECK(cardinality(urgencies) BETWEEN 1 AND 2 AND urgencies <@ ARRAY['normal','urgent']::text[] AND (cardinality(urgencies)=1 OR urgencies[1]<>urgencies[2])),
 currency text NOT NULL DEFAULT 'BDT' CHECK(currency='BDT'), reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 500),
 created_by uuid NOT NULL REFERENCES platform_users(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,service_no,version),
 FOREIGN KEY(tenant_id,service_no) REFERENCES tenant_service_configuration(tenant_id,service_no)
);

ALTER TABLE applications ADD COLUMN order_mode text NOT NULL DEFAULT 'LEGACY' CHECK(order_mode IN ('LEGACY','POLICY'));
ALTER TABLE applications ADD CONSTRAINT applications_tenant_id_service UNIQUE(tenant_id,id,service_no);
CREATE TABLE application_order_snapshots (
 tenant_id uuid NOT NULL, application_id uuid NOT NULL, service_no integer NOT NULL, policy_version integer NOT NULL,
 address_basis text NOT NULL CHECK(address_basis='registered_profile'), certificate_language text NOT NULL CHECK(certificate_language IN ('bn','en')),
 delivery_mode text NOT NULL CHECK(delivery_mode IN ('office_collection','digital_copy')), urgency text NOT NULL CHECK(urgency IN ('normal','urgent')),
 statutory_fee_minor integer NOT NULL CHECK(statutory_fee_minor>=0), processing_fee_minor integer NOT NULL CHECK(processing_fee_minor>=0),
 emergency_surcharge_minor integer NOT NULL CHECK(emergency_surcharge_minor>=0), delivery_fee_minor integer NOT NULL CHECK(delivery_fee_minor>=0),
 total_minor integer NOT NULL CHECK(total_minor=statutory_fee_minor+processing_fee_minor+emergency_surcharge_minor+delivery_fee_minor),
 currency text NOT NULL CHECK(currency='BDT'), payment_status text NOT NULL DEFAULT 'NOT_COLLECTED' CHECK(payment_status='NOT_COLLECTED'),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,application_id),
 FOREIGN KEY(tenant_id,application_id,service_no) REFERENCES applications(tenant_id,id,service_no),
 FOREIGN KEY(tenant_id,service_no,policy_version) REFERENCES service_order_policies(tenant_id,service_no,version)
);

CREATE FUNCTION enforce_order_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.order_mode<>OLD.order_mode THEN RAISE EXCEPTION 'Application order origin is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 PERFORM 1 FROM tenant_service_configuration WHERE tenant_id=NEW.tenant_id AND service_no=NEW.service_no FOR SHARE;
 IF (NEW.order_mode='POLICY') <> EXISTS(SELECT 1 FROM service_order_policies WHERE tenant_id=NEW.tenant_id AND service_no=NEW.service_no) THEN
  RAISE EXCEPTION 'Application order policy must match creation origin' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER application_order_origin BEFORE INSERT OR UPDATE OF order_mode ON applications FOR EACH ROW EXECUTE FUNCTION enforce_order_origin();

CREATE FUNCTION enforce_order_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p service_order_policies%ROWTYPE;
BEGIN
 SELECT * INTO p FROM service_order_policies WHERE tenant_id=NEW.tenant_id AND service_no=NEW.service_no AND version=NEW.policy_version;
 IF p.version IS NULL OR NOT (NEW.delivery_mode=ANY(p.delivery_modes)) OR NOT (NEW.urgency=ANY(p.urgencies))
  OR NEW.statutory_fee_minor<>p.statutory_fee_minor OR NEW.processing_fee_minor<>p.processing_fee_minor
  OR NEW.emergency_surcharge_minor<>(CASE WHEN NEW.urgency='urgent' THEN p.emergency_surcharge_minor ELSE 0 END)
  OR NEW.delivery_fee_minor<>(CASE WHEN NEW.delivery_mode='office_collection' THEN p.office_collection_fee_minor ELSE p.digital_copy_fee_minor END)
  OR NOT EXISTS(SELECT 1 FROM applications WHERE tenant_id=NEW.tenant_id AND id=NEW.application_id AND order_mode='POLICY') THEN
  RAISE EXCEPTION 'Invalid application order snapshot' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER application_order_validate BEFORE INSERT ON application_order_snapshots FOR EACH ROW EXECUTE FUNCTION enforce_order_snapshot();
CREATE FUNCTION require_order_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.order_mode='POLICY' AND NOT EXISTS(SELECT 1 FROM application_order_snapshots WHERE tenant_id=NEW.tenant_id AND application_id=NEW.id) THEN
  RAISE EXCEPTION 'Application order snapshot is required' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER application_order_required AFTER INSERT ON applications DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_order_snapshot();

DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['service_order_policies','application_order_snapshots'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY tenant_scope ON %I USING (tenant_id=nullif(current_setting(''astra.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=nullif(current_setting(''astra.tenant_id'',true),'''')::uuid)',tab);
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION immutable_record()',tab);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,astra_app',tab);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO astra_app',tab);
 END LOOP;
END $$;
