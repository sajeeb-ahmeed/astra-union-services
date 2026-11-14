-- Phase 2c: one-time codes sent to a mobile number during citizen registration.
-- The challenge token and the code are stored only as digests; the mobile number only as the keyed
-- identifier digest from Phase 2b. A code expires, allows five tries, and is used once.
-- Effect on existing data: none (new table).
CREATE TABLE otp_challenges (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  purpose text NOT NULL CHECK (purpose IN ('signup_mobile')),
  identifier_digest text NOT NULL CHECK (identifier_digest ~ '^[a-f0-9]{64}$'),
  code_hash text NOT NULL CHECK (code_hash ~ '^[a-f0-9]{64}$'),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  consumed_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR verified_at IS NOT NULL)
);
CREATE INDEX otp_challenges_recent ON otp_challenges (identifier_digest, created_at DESC);
-- Used before any account or tenant exists.
GRANT SELECT, INSERT, UPDATE ON otp_challenges TO astra_app;
