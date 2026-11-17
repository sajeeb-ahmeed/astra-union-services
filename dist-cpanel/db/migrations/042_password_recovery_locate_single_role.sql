-- Integration: migration 007's locate_password_recovery has the same single-role
-- FORCE-RLS limitation Phase X fixed for email verification inside migration 039.
-- The function runs before any session or tenant context exists. In the two-role
-- deployment its owner bypasses RLS; in the single-role cPanel deployment the owner
-- is the application role itself, which FORCE RLS subjects to the tenant policy —
-- with no tenant context it locates nothing, so every emailed password-recovery link
-- resolves as invalid on the bundle. Mirroring 039 exactly: the policy also admits
-- reads while the function-scoped astra.locate_password_recovery flag is set, and
-- the function (now plpgsql) raises the flag at runtime with set_config (a
-- function-level SET of a custom parameter requires superuser at definition time,
-- which the single-role migration user is not). WITH CHECK stays tenant-strict
-- for every write. Migration 007 itself is immutable and is not edited.
DROP POLICY tenant_scope ON password_recovery_tokens;
CREATE POLICY tenant_scope ON password_recovery_tokens USING(tenant_id=nullif(current_setting('astra.tenant_id',true),'')::uuid OR current_setting('astra.locate_password_recovery',true)='on') WITH CHECK(tenant_id=nullif(current_setting('astra.tenant_id',true),'')::uuid);
CREATE OR REPLACE FUNCTION locate_password_recovery(token_digest text) RETURNS TABLE(tenant_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM set_config('astra.locate_password_recovery','on',true);
  RETURN QUERY SELECT r.tenant_id FROM password_recovery_tokens r JOIN tenants t ON t.id=r.tenant_id WHERE r.token_hash=token_digest AND r.consumed_at IS NULL AND r.expires_at>now() AND t.status='ACTIVE';
END;
$$;
REVOKE ALL ON FUNCTION locate_password_recovery(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION locate_password_recovery(text) TO astra_app;
