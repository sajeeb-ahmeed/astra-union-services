-- PostgreSQL row locking requires UPDATE privilege. Expose a narrow tenant-derived
-- locking read while keeping every application UPDATE on tenant_wallets revoked.
CREATE FUNCTION lock_tenant_wallet() RETURNS TABLE(balance integer)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT w.balance FROM tenant_wallets w
 WHERE w.tenant_id=nullif(current_setting('astra.tenant_id',true),'')::uuid
 FOR UPDATE OF w;
$$;
REVOKE ALL ON FUNCTION lock_tenant_wallet() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lock_tenant_wallet() TO astra_app;
