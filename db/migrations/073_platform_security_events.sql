-- S-014: durable, append-only, owner-scoped audit stream for owner actions
-- and authentication failures. Previously the only record of an owner
-- password change, session revocation or tenant create was a stdout JSON
-- line (logOwnerAccountAction), and failed logins were not recorded at all,
-- so incident response for the most privileged account relied on log
-- retention that is not guaranteed.
--
-- Same immutable-trigger pattern as account_security_events (migration 013):
-- UPDATE/DELETE raise 'Append-only record'. No RLS policy by design:
-- failed-login rows have no authenticated actor (actor_id is NULL for an
-- unknown identifier), so an account-scoped policy would reject exactly the
-- rows this table exists to keep; instead the table is owner-only by
-- application access — REVOKE ALL FROM PUBLIC, GRANT SELECT/INSERT to
-- astra_app only, and no endpoint reads it except a future owner-only audit
-- view (which must filter in SQL). Never store passwords, tokens, or raw
-- IPs here: ip_hash is SHA-256 of the client IP (see security-audit.ts).
CREATE TABLE platform_security_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id uuid REFERENCES platform_users(id),
 actor_role text,
 action text NOT NULL CHECK(action IN (
   'OWNER_PASSWORD_CHANGED','OWNER_SESSIONS_REVOKED','OWNER_SESSION_REVOKED',
   'TENANT_CREATED','TENANT_STATUS_UPDATED',
   'LOGIN_FAILED','LOGIN_LOCKED_OUT',
   'PUBLIC_DATA_PURGED')),
 identifier_kind text CHECK(identifier_kind IN ('email','mobile','nid','birth_reg','unknown')),
 ip_hash text,
 metadata jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(metadata)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX platform_security_events_recent ON platform_security_events(created_at DESC, id);
CREATE INDEX platform_security_events_actor ON platform_security_events(actor_id, created_at DESC);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON platform_security_events
 FOR EACH ROW EXECUTE FUNCTION immutable_record();
REVOKE ALL ON platform_security_events FROM PUBLIC;
GRANT SELECT,INSERT ON platform_security_events TO astra_app;
