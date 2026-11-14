-- Phase 2b: sign in with mobile, NID or birth registration as well as email.
-- Numbers are never stored: only an HMAC-SHA-256 digest keyed with the server secret IDENTIFIER_SECRET
-- (owner decision), plus a short masked hint for the account owner's own settings page.
-- Email stays in platform_users.email. Effect on existing data: none; no account has these identifiers yet.
CREATE TABLE account_identifiers (
  user_id uuid NOT NULL REFERENCES platform_users(id),
  kind text NOT NULL CHECK (kind IN ('mobile','nid','birth_reg')),
  digest text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  hint text NOT NULL CHECK (length(hint) BETWEEN 3 AND 24),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, kind),
  UNIQUE (kind, digest)
);
-- Read before any tenant is chosen (sign-in), like platform_users itself.
GRANT SELECT, INSERT, UPDATE, DELETE ON account_identifiers TO astra_app;

ALTER TABLE account_security_events DROP CONSTRAINT account_security_events_action_check;
ALTER TABLE account_security_events ADD CONSTRAINT account_security_events_action_check CHECK (action IN (
  'PASSWORD_CHANGED','OTHER_SESSIONS_REVOKED','PASSWORD_RECOVERY_COMPLETED',
  'MFA_ENROLLMENT_STARTED','MFA_ENABLED','MFA_DISABLED','MFA_RECOVERY_CODES_ROTATED',
  'MFA_CHALLENGE_CREATED','MFA_LOGIN_SUCCEEDED','MFA_RECOVERY_CODE_USED','MFA_CODE_REJECTED',
  'SIGN_IN_IDENTIFIER_SET','SIGN_IN_IDENTIFIER_REMOVED'));
