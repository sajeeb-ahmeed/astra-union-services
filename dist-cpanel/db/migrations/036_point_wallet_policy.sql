-- Give point_wallets the same tenant policy shape as every other tenant table (USING and WITH CHECK), so the
-- encrypted-backup safety check recognises it. astra_app still has only SELECT on this table, so nothing the
-- application can do changes.
-- Effect on existing data: none.
DROP POLICY tenant_scope ON point_wallets;
CREATE POLICY tenant_scope ON point_wallets
  USING (tenant_id=nullif(current_setting('astra.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=nullif(current_setting('astra.tenant_id',true),'')::uuid);
