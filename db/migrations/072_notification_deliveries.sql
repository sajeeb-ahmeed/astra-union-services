-- W-010: delivery outcomes for status notifications were discarded.
-- sendEmail/sendStatusSms return whether the message was sent, but the
-- notifiers ignored the result, so nothing distinguished "sent" from
-- "no provider configured" or "reached no handset". Each attempted
-- channel now leaves one row here. Status is honest about the log
-- provider: 'logged' means the message was recorded locally and
-- reached no handset — it is never reported as 'sent'. 'unavailable'
-- means no provider was configured at all; 'no_contact' means the
-- citizen has no address/mobile on file for that channel; 'failed'
-- means the provider call threw. Rows are append-only.
CREATE TABLE notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  application_id uuid NOT NULL,
  kind text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'sms')),
  status text NOT NULL CHECK (status IN ('sent', 'logged', 'failed', 'unavailable', 'no_contact')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, application_id) REFERENCES applications(tenant_id, id)
);
CREATE INDEX notification_deliveries_application ON notification_deliveries(tenant_id, application_id, created_at DESC);

ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON notification_deliveries
  USING (tenant_id = nullif(current_setting('astra.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('astra.tenant_id', true), '')::uuid);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON notification_deliveries
  FOR EACH ROW EXECUTE FUNCTION immutable_record();
REVOKE ALL ON notification_deliveries FROM PUBLIC, astra_app;
GRANT SELECT, INSERT ON notification_deliveries TO astra_app;
