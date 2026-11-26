-- CH-007: plain password sign-ins are recorded in the security activity
-- feed (Recent security activity stayed empty for accounts that never
-- changed a password or touched MFA). The action list is a CHECK
-- constraint, so SIGNED_IN is added here; the audit itself is written
-- by passwordLogin in mfa.ts, and MFA sign-ins keep their existing
-- MFA_LOGIN_SUCCEEDED row.
ALTER TABLE account_security_events DROP CONSTRAINT account_security_events_action_check;
ALTER TABLE account_security_events ADD CONSTRAINT account_security_events_action_check CHECK (action IN (
  'SIGNED_IN',
  'PASSWORD_CHANGED','OTHER_SESSIONS_REVOKED','PASSWORD_RECOVERY_COMPLETED',
  'MFA_ENROLLMENT_STARTED','MFA_ENABLED','MFA_DISABLED','MFA_RECOVERY_CODES_ROTATED',
  'MFA_CHALLENGE_CREATED','MFA_LOGIN_SUCCEEDED','MFA_RECOVERY_CODE_USED','MFA_CODE_REJECTED',
  'SIGN_IN_IDENTIFIER_SET','SIGN_IN_IDENTIFIER_REMOVED'));
