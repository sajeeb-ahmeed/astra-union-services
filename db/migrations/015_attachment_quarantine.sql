-- Existing uploads are quarantined, never treated as a prior successful scan.
ALTER TABLE attachments
 ADD COLUMN content_sha256 text,
 ADD COLUMN scan_attempts integer NOT NULL DEFAULT 0,
 ADD COLUMN lease_token_hash text,
 ADD COLUMN lease_expires_at timestamptz,
 ADD COLUMN next_retry_at timestamptz,
 ADD COLUMN scan_reason text NOT NULL DEFAULT 'PENDING_SCAN',
 ADD COLUMN scanned_at timestamptz,
 ADD COLUMN scanned_sha256 text,
 ADD COLUMN scan_worker_id text,
 ADD COLUMN scan_engine_version text,
 ADD COLUMN scan_signature_version text,
 ADD COLUMN scan_signature_updated_at timestamptz;
-- Managed owners need not bypass FORCE RLS. Backfill every tenant explicitly,
-- then restore the migration connection's prior tenant scope.
DO $$ DECLARE office record; previous_scope text := current_setting('astra.tenant_id',true); BEGIN
 FOR office IN SELECT id FROM tenants ORDER BY id LOOP
  PERFORM set_config('astra.tenant_id',office.id::text,true);
  UPDATE attachments SET content_sha256=encode(digest(bytes,'sha256'),'hex'),scan_state='QUARANTINED' WHERE tenant_id=office.id;
 END LOOP;
 PERFORM set_config('astra.tenant_id',coalesce(previous_scope,''),true);
END $$;
ALTER TABLE attachments ALTER COLUMN content_sha256 SET NOT NULL;
ALTER TABLE attachments ALTER COLUMN scan_state SET DEFAULT 'QUARANTINED';
ALTER TABLE attachments
 ADD CONSTRAINT attachment_content_integrity CHECK(content_sha256=encode(digest(bytes,'sha256'),'hex') AND byte_length=octet_length(bytes)),
 ADD CONSTRAINT attachment_scan_state CHECK(scan_state IN ('QUARANTINED','SCANNING','CLEAN','REJECTED','ERROR')),
 ADD CONSTRAINT attachment_scan_attempts CHECK(scan_attempts BETWEEN 0 AND 3),
 ADD CONSTRAINT attachment_scan_reason CHECK(scan_reason IN ('PENDING_SCAN','OK','UNSAFE_FILE','SCAN_FAILED','SCAN_LIMIT','UNSUPPORTED_FILE','SCANNER_UNAVAILABLE')),
 ADD CONSTRAINT attachment_scan_lease CHECK(
   (scan_state='SCANNING' AND lease_token_hash IS NOT NULL AND lease_token_hash ~ '^[a-f0-9]{64}$' AND lease_expires_at IS NOT NULL)
   OR (scan_state<>'SCANNING' AND lease_token_hash IS NULL AND lease_expires_at IS NULL)),
 ADD CONSTRAINT attachment_scan_result CHECK(
   (scan_state IN ('CLEAN','REJECTED') AND scanned_at IS NOT NULL AND scanned_sha256 IS NOT NULL AND scanned_sha256=content_sha256
    AND scan_worker_id IS NOT NULL AND scan_engine_version IS NOT NULL AND scan_signature_version IS NOT NULL AND scan_signature_updated_at IS NOT NULL)
   OR (scan_state NOT IN ('CLEAN','REJECTED') AND scanned_at IS NULL AND scanned_sha256 IS NULL)),
 ADD CONSTRAINT attachment_clean_reason CHECK((scan_state='CLEAN')=(scan_reason='OK'));
CREATE INDEX attachment_scan_queue ON attachments(tenant_id,scan_state,next_retry_at,created_at,id);

CREATE FUNCTION protect_attachment_content() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Attachment retention requires a reviewed deletion policy'; END IF;
 IF TG_OP='INSERT' THEN
   IF NEW.scan_state<>'QUARANTINED' OR NEW.scan_attempts<>0 OR NEW.lease_token_hash IS NOT NULL OR NEW.scanned_at IS NOT NULL OR NEW.scanned_sha256 IS NOT NULL
      OR NEW.scan_worker_id IS NOT NULL OR NEW.scan_engine_version IS NOT NULL OR NEW.scan_signature_version IS NOT NULL OR NEW.scan_signature_updated_at IS NOT NULL
      OR NEW.scan_reason<>'PENDING_SCAN' OR NEW.next_retry_at IS NOT NULL THEN
     RAISE EXCEPTION 'New attachments must enter quarantine';
   END IF;
   NEW.content_sha256:=encode(digest(NEW.bytes,'sha256'),'hex');
 ELSE
   IF ROW(NEW.id,NEW.tenant_id,NEW.citizen_id,NEW.uploaded_by,NEW.mime_type,NEW.byte_length,NEW.bytes,NEW.content_sha256,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.citizen_id,OLD.uploaded_by,OLD.mime_type,OLD.byte_length,OLD.bytes,OLD.content_sha256,OLD.created_at) THEN
     RAISE EXCEPTION 'Attachment content and identity are immutable';
   END IF;
   IF OLD.scan_state IN ('CLEAN','REJECTED') THEN RAISE EXCEPTION 'A completed scan is immutable'; END IF;
   IF NEW.scan_state=OLD.scan_state THEN RAISE EXCEPTION 'Scan metadata changes require a state transition'; END IF;
   IF NEW.scan_attempts<OLD.scan_attempts OR NEW.scan_attempts>OLD.scan_attempts+1 THEN RAISE EXCEPTION 'Invalid scan attempt sequence'; END IF;
   IF NOT (
     (OLD.scan_state='QUARANTINED' AND NEW.scan_state='SCANNING' AND NEW.scan_attempts=OLD.scan_attempts+1)
     OR (OLD.scan_state='ERROR' AND NEW.scan_state='SCANNING' AND NEW.scan_attempts=OLD.scan_attempts+1 AND OLD.next_retry_at IS NOT NULL AND OLD.next_retry_at<=clock_timestamp())
     OR (OLD.scan_state='SCANNING' AND NEW.scan_state IN ('CLEAN','REJECTED','ERROR') AND NEW.scan_attempts=OLD.scan_attempts)
     OR (OLD.scan_state='ERROR' AND NEW.scan_state='QUARANTINED' AND NEW.scan_attempts=OLD.scan_attempts AND OLD.scan_attempts<3 AND OLD.next_retry_at IS NOT NULL AND OLD.next_retry_at<=clock_timestamp())
   ) THEN RAISE EXCEPTION 'Invalid scan state transition'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER attachment_content_guard BEFORE INSERT OR UPDATE OR DELETE ON attachments FOR EACH ROW EXECUTE FUNCTION protect_attachment_content();

CREATE TABLE attachment_scan_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id), attachment_id uuid NOT NULL,
 event text NOT NULL CHECK(event IN ('CLAIMED','CLEAN','REJECTED','ERROR','LEASE_EXPIRED','RETRY_REQUESTED')),
 attempt integer NOT NULL CHECK(attempt BETWEEN 0 AND 3), content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
 worker_id text, reason_code text NOT NULL, engine_version text, signature_version text, signature_updated_at timestamptz,
 actor_id uuid REFERENCES platform_users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,attachment_id) REFERENCES attachments(tenant_id,id)
);
CREATE INDEX attachment_scan_events_recent ON attachment_scan_events(tenant_id,attachment_id,created_at,id);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON attachment_scan_events FOR EACH ROW EXECUTE FUNCTION immutable_record();

-- Heartbeats are scoped to each visited tenant; no broad scanner RLS bypass.
CREATE TABLE attachment_scanner_heartbeats (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id), worker_id text NOT NULL,
 engine_version text NOT NULL, signature_version text NOT NULL, signature_updated_at timestamptz NOT NULL,
 seen_at timestamptz NOT NULL DEFAULT clock_timestamp(), last_claimed_at timestamptz
);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['attachment_scan_events','attachment_scanner_heartbeats'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY tenant_scope ON %I USING (tenant_id = nullif(current_setting(''astra.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''astra.tenant_id'',true),'''')::uuid)',tab);
 END LOOP;
END $$;
REVOKE ALL ON attachment_scan_events,attachment_scanner_heartbeats FROM PUBLIC;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON attachments FROM astra_app;
GRANT INSERT(tenant_id,citizen_id,uploaded_by,mime_type,byte_length,bytes) ON attachments TO astra_app;
GRANT UPDATE(scan_state,scan_attempts,lease_token_hash,lease_expires_at,next_retry_at,scan_reason,scanned_at,scanned_sha256,scan_worker_id,scan_engine_version,scan_signature_version,scan_signature_updated_at) ON attachments TO astra_app;
GRANT SELECT,INSERT ON attachment_scan_events TO astra_app;
GRANT SELECT,INSERT,UPDATE ON attachment_scanner_heartbeats TO astra_app;
