-- Tenant audit writers always supply an office. Global owner/account security
-- events are stored separately by migration 013. PostgreSQL validates every
-- existing row here, including rows hidden by FORCE RLS; a legacy NULL aborts
-- the migration rather than silently omitting it from a recovery export.
-- No row is rewritten, deleted or reassigned, and no RLS policy is weakened.
ALTER TABLE audit_events ALTER COLUMN tenant_id SET NOT NULL;
