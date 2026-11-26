-- S-005: session hygiene — per-session identity and idle tracking.
--
-- sessions previously had no public identifier (the primary key is the
-- token hash, which must never leave the server) and no record of when a
-- session was last used, so a single session could not be revoked and an
-- idle session stayed valid for the full 8 h. This adds:
--   id           — stable public identifier, used by GET /auth/sessions/list
--                   and POST /auth/sessions/revoke; never derived from the token.
--   created_at   — absolute-lifetime anchor: a session never lives past
--                   created_at + 8 h, however often it is used.
--   last_seen_at — idle anchor: a session idle longer than 45 min is refused
--                   (see apps/api/src/session-hygiene.ts).
-- Existing rows backfill both timestamps to now() via the DEFAULTs, so a
-- pre-migration session keeps at most its remaining expires_at lifetime.
ALTER TABLE sessions ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE sessions ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE sessions ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE sessions ADD CONSTRAINT sessions_id_unique UNIQUE (id);
CREATE INDEX sessions_user_expires ON sessions(user_id, expires_at);

-- The per-session revoke endpoint writes SESSION_REVOKED to the same
-- immutable account audit stream as revoke-others (OTHER_SESSIONS_REVOKED),
-- so the action list gains one entry. The list below is the migration-067
-- list plus SESSION_REVOKED, nothing else.
ALTER TABLE account_security_events DROP CONSTRAINT account_security_events_action_check;
ALTER TABLE account_security_events ADD CONSTRAINT account_security_events_action_check CHECK (action IN (
  'SIGNED_IN',
  'PASSWORD_CHANGED','OTHER_SESSIONS_REVOKED','SESSION_REVOKED','PASSWORD_RECOVERY_COMPLETED',
  'MFA_ENROLLMENT_STARTED','MFA_ENABLED','MFA_DISABLED','MFA_RECOVERY_CODES_ROTATED',
  'MFA_CHALLENGE_CREATED','MFA_LOGIN_SUCCEEDED','MFA_RECOVERY_CODE_USED','MFA_CODE_REJECTED',
  'SIGN_IN_IDENTIFIER_SET','SIGN_IN_IDENTIFIER_REMOVED'));
