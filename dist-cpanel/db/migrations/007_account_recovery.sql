CREATE TABLE password_recovery_tokens (
 token_hash text PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),user_id uuid NOT NULL REFERENCES platform_users(id),
 created_by uuid NOT NULL REFERENCES platform_users(id),expires_at timestamptz NOT NULL,consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE password_recovery_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_recovery_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON password_recovery_tokens USING(tenant_id=nullif(current_setting('astra.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('astra.tenant_id',true),'')::uuid);
CREATE FUNCTION locate_password_recovery(token_digest text) RETURNS TABLE(tenant_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT r.tenant_id FROM password_recovery_tokens r JOIN tenants t ON t.id=r.tenant_id WHERE r.token_hash=token_digest AND r.consumed_at IS NULL AND r.expires_at>now() AND t.status='ACTIVE'; $$;
REVOKE ALL ON FUNCTION locate_password_recovery(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION locate_password_recovery(text) TO astra_app;
GRANT SELECT,INSERT,UPDATE ON password_recovery_tokens TO astra_app;
