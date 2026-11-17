-- Phase X: email verification for citizen registration.
-- Until now an account's email (platform_users.email, the sign-in identity) was never confirmed:
-- registration completed and sign-in worked without any proof that the address belongs to the
-- registrant (E2E QA J3 gap). A verification token is now issued at registration and delivered by
-- email; only its digest is stored, it expires after 24 hours and is used once, mirroring the
-- password-recovery token design (migration 007). Verification stays optional: it never blocks
-- sign-in; platform_users.email_verified_at simply records whether the address was confirmed.
-- Effect on existing data: every existing account keeps email_verified_at NULL (unverified).
ALTER TABLE platform_users ADD COLUMN email_verified_at timestamptz;

CREATE TABLE email_verification_tokens (
 token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 user_id uuid NOT NULL REFERENCES platform_users(id),
 email text NOT NULL,
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (expires_at > created_at)
);
CREATE INDEX email_verification_tokens_user ON email_verification_tokens (user_id, created_at DESC);
ALTER TABLE email_verification_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_verification_tokens FORCE ROW LEVEL SECURITY;
-- The locate function below runs before any session or tenant context exists. In the two-role
-- deployment its owner bypasses RLS; in the single-role cPanel deployment the owner is subject
-- to FORCE RLS like everyone else, so the policy also admits reads while the function-scoped
-- astra.locate_email_verification flag is set. The function raises the flag at runtime with
-- set_config (the same mechanism the API uses for astra.tenant_id) because a function-level
-- SET of a custom parameter requires superuser at definition time. WITH CHECK stays
-- tenant-strict for every write.
CREATE POLICY tenant_scope ON email_verification_tokens USING(tenant_id=nullif(current_setting('astra.tenant_id',true),'')::uuid OR current_setting('astra.locate_email_verification',true)='on') WITH CHECK(tenant_id=nullif(current_setting('astra.tenant_id',true),'')::uuid);
-- The verification link is opened before any session or tenant exists, so the tenant is located
-- from the token digest alone (same pattern as locate_password_recovery).
CREATE FUNCTION locate_email_verification(token_digest text) RETURNS TABLE(tenant_id uuid, user_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM set_config('astra.locate_email_verification','on',true);
  RETURN QUERY SELECT r.tenant_id, r.user_id FROM email_verification_tokens r JOIN tenants t ON t.id=r.tenant_id WHERE r.token_hash=token_digest AND r.consumed_at IS NULL AND r.expires_at>now() AND t.status='ACTIVE';
END;
$$;
REVOKE ALL ON FUNCTION locate_email_verification(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION locate_email_verification(text) TO astra_app;
GRANT SELECT,INSERT,UPDATE ON email_verification_tokens TO astra_app;
