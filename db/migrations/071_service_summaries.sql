-- F-011 (Phase 4 Stage 4): one aggregate fee/time summary per service
-- across all ACTIVE offices, for the catalog cards — fee range,
-- charter-days range and the count of offices with a published policy
-- for the service. Aggregated server-side from the same published-policy
-- rows the office detail endpoint reads.
--
-- SECURITY DEFINER, like public_service_office_info (048): the public
-- aggregate spans tenants, and the app role (astra_app) is restricted by
-- the tenant_scope RLS policy to its own tenant, so a plain query from
-- the API would see nothing. The function runs as its owner
-- (astra_admin); the definer_office_info_read policy lets astra_admin
-- read every tenant's rows when no tenant is set. Only published
-- policies contribute; services with none are absent (the cards then
-- show the honest "not yet published" line). No values are inferred.
CREATE OR REPLACE FUNCTION public_service_summaries() RETURNS TABLE(
  service_no integer, fee_min_minor integer, fee_max_minor integer,
  days_min integer, days_max integer, offices integer)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT s.service_no,
   MIN(p.statutory_fee_minor + p.processing_fee_minor)::int,
   MAX(p.statutory_fee_minor + p.processing_fee_minor)::int,
   MIN(p.charter_days)::int,
   MAX(p.charter_days)::int,
   COUNT(*)::int
 FROM tenants t
 JOIN tenant_service_configuration c ON c.tenant_id = t.id AND c.enabled
 JOIN service_catalog s ON s.service_no = c.service_no
 JOIN LATERAL (SELECT * FROM service_order_policies o WHERE o.tenant_id = c.tenant_id AND o.service_no = c.service_no ORDER BY o.version DESC LIMIT 1) p ON true
 WHERE t.status = 'ACTIVE' AND p.version IS NOT NULL
 GROUP BY s.service_no ORDER BY s.service_no;
$$;
REVOKE ALL ON FUNCTION public_service_summaries() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_service_summaries() TO astra_app;
