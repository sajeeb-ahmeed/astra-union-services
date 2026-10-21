-- Account authentication is global across office memberships. These tables contain
-- no business/tenant records. Per-account RLS protects MFA state and security history.
CREATE TABLE account_mfa (
 user_id uuid PRIMARY KEY REFERENCES platform_users(id),
 encrypted_secret text, enabled_at timestamptz,
 pending_secret text, pending_expires_at timestamptz,
 last_counter bigint NOT NULL DEFAULT -1,
 recovery_hashes text[] NOT NULL DEFAULT '{}',
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
 failed_attempts integer NOT NULL DEFAULT 0 CHECK(failed_attempts>=0),
 attempt_window_at timestamptz,
 CHECK((encrypted_secret IS NULL)=(enabled_at IS NULL)),
 CHECK((pending_secret IS NULL)=(pending_expires_at IS NULL))
);
ALTER TABLE account_mfa ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_mfa FORCE ROW LEVEL SECURITY;
CREATE POLICY account_scope ON account_mfa
 USING(user_id=nullif(current_setting('astra.account_id',true),'')::uuid)
 WITH CHECK(user_id=nullif(current_setting('astra.account_id',true),'')::uuid);

-- A challenge is an opaque, hashed, five-minute capability, not a session. The
-- backend resolves its account then rechecks the account lock, MFA revision,
-- credential digest and office authorization before granting any session.
CREATE TABLE mfa_login_challenges (
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 user_id uuid NOT NULL REFERENCES platform_users(id),
 tenant_id uuid REFERENCES tenants(id),
 credential_digest text NOT NULL,
 mfa_revision integer NOT NULL,
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX mfa_login_challenges_account ON mfa_login_challenges(user_id,expires_at);

CREATE TABLE account_security_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES platform_users(id),
 action text NOT NULL CHECK(action IN (
  'PASSWORD_CHANGED','OTHER_SESSIONS_REVOKED','PASSWORD_RECOVERY_COMPLETED',
  'MFA_ENROLLMENT_STARTED','MFA_ENABLED','MFA_DISABLED','MFA_RECOVERY_CODES_ROTATED',
  'MFA_CHALLENGE_CREATED','MFA_LOGIN_SUCCEEDED','MFA_RECOVERY_CODE_USED','MFA_CODE_REJECTED')),
 metadata jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(metadata)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX account_security_events_recent ON account_security_events(user_id,created_at DESC,id);
ALTER TABLE account_security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_security_events FORCE ROW LEVEL SECURITY;
CREATE POLICY account_scope ON account_security_events
 USING(user_id=nullif(current_setting('astra.account_id',true),'')::uuid)
 WITH CHECK(user_id=nullif(current_setting('astra.account_id',true),'')::uuid);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON account_security_events
 FOR EACH ROW EXECUTE FUNCTION immutable_record();

REVOKE ALL ON account_mfa,mfa_login_challenges,account_security_events FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON account_mfa,mfa_login_challenges TO astra_app;
GRANT SELECT,INSERT ON account_security_events TO astra_app;
