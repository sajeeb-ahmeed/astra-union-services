-- Owner operations summary: counts and times only, across all offices, so the platform owner can see when the
-- malware scanner stops (files waiting in quarantine) and which queues need attention. No row contents, file
-- bytes or personal data leave the function. The API allows it to the owner role only.
-- Effect on existing data: none.
CREATE FUNCTION owner_operations_summary() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object(
  'scanner', jsonb_build_object(
    'waiting', (SELECT count(*) FROM attachments WHERE scan_state='QUARANTINED'),
    'scanning', (SELECT count(*) FROM attachments WHERE scan_state='SCANNING'),
    'errors', (SELECT count(*) FROM attachments WHERE scan_state='ERROR'),
    'rejected', (SELECT count(*) FROM attachments WHERE scan_state='REJECTED'),
    'oldestWaitingAt', (SELECT min(created_at) FROM attachments WHERE scan_state IN ('QUARANTINED','SCANNING')),
    'lastHeartbeatAt', (SELECT max(seen_at) FROM attachment_scanner_heartbeats)
  ),
  'queues', jsonb_build_object(
    'rechargesPending', (SELECT count(*) FROM recharge_requests WHERE status='PENDING'),
    'officeAccountRequestsPending', (SELECT count(*) FROM office_account_requests WHERE status='PENDING'),
    'officeInclusionRequestsOpen', (SELECT count(*) FROM office_inclusion_requests WHERE status IN ('NEW','CONTACTED')),
    'refundsAwaitingDecision', (SELECT count(*) FROM application_refunds WHERE status='REQUESTED'),
    'refundsInProgress', (SELECT count(*) FROM application_refunds WHERE status IN ('APPROVED','SENT'))
  ),
  'checkedAt', now()
 )
$$;
REVOKE EXECUTE ON FUNCTION owner_operations_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION owner_operations_summary() TO astra_app;

-- The function runs as the migration owner, which FORCE ROW LEVEL SECURITY also restricts when it is not a
-- superuser (see migration 009): give that owner read policies on the tables it counts.
DO $$ BEGIN
 IF current_user = 'astra_app' OR pg_has_role('astra_app', current_user, 'MEMBER') THEN
  RAISE EXCEPTION 'The application role must not be or inherit the migration owner';
 END IF;
 EXECUTE format('CREATE POLICY definer_operations_read ON attachments FOR SELECT TO %I USING (true)', current_user);
 EXECUTE format('CREATE POLICY definer_operations_read ON attachment_scanner_heartbeats FOR SELECT TO %I USING (true)', current_user);
 EXECUTE format('CREATE POLICY definer_operations_read ON application_refunds FOR SELECT TO %I USING (true)', current_user);
END $$;
