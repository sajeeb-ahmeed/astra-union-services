-- Phase 6: citizen-facing required documents per service, published by the office as part of its
-- versioned fee policy (the same record that carries the fees and the citizen-charter time).
-- Each entry is a bilingual pair {bn, en}; an empty list means the office has not stated any
-- required documents. Effect on existing data: earlier policy versions get the empty list —
-- no document list is inferred or invented for them.
ALTER TABLE service_order_policies
  ADD COLUMN required_documents jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(required_documents) = 'array' AND jsonb_array_length(required_documents) <= 20);

-- The public service page reads every participating office's current policy for one service.
-- FORCE ROW LEVEL SECURITY applies to the migration owner as well, so the definer function below
-- gets explicit owner read policies (as in migrations 009/029). The request role (astra_app)
-- keeps tenant_scope only and must never inherit the owner.
DO $$ BEGIN
 IF current_user = 'astra_app' OR pg_has_role('astra_app', current_user, 'MEMBER') THEN
  RAISE EXCEPTION 'The application role must not be or inherit the migration owner';
 END IF;
 EXECUTE format('CREATE POLICY definer_office_info_read ON tenant_service_configuration FOR SELECT TO %I USING (true)', current_user);
 EXECUTE format('CREATE POLICY definer_office_info_read ON service_order_policies FOR SELECT TO %I USING (true)', current_user);
END $$;

-- One row per ACTIVE office that offers the service: the office identity plus its latest published
-- policy, or NULL policy columns when the office has not published one. No values are inferred.
CREATE FUNCTION public_service_office_info(service_no integer) RETURNS TABLE(
  slug text, name_bn text, name_en text, division text, district text, upazila text, office_type text,
  policy_version integer, statutory_fee_minor integer, processing_fee_minor integer,
  emergency_surcharge_minor integer, office_collection_fee_minor integer, digital_copy_fee_minor integer,
  delivery_modes text[], urgencies text[], charter_days integer, required_documents jsonb)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT t.slug,t.name_bn,t.name_en,t.division,t.district,t.upazila,t.office_type,
   p.version,p.statutory_fee_minor,p.processing_fee_minor,p.emergency_surcharge_minor,
   p.office_collection_fee_minor,p.digital_copy_fee_minor,p.delivery_modes,p.urgencies,p.charter_days,
   p.required_documents
 FROM tenants t
 JOIN tenant_service_configuration c ON c.tenant_id=t.id AND c.service_no=$1 AND c.enabled
 LEFT JOIN LATERAL (SELECT * FROM service_order_policies o WHERE o.tenant_id=t.id AND o.service_no=$1 ORDER BY o.version DESC LIMIT 1) p ON true
 WHERE t.status='ACTIVE' ORDER BY t.name_en,t.id;
$$;
REVOKE ALL ON FUNCTION public_service_office_info(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_service_office_info(integer) TO astra_app;
