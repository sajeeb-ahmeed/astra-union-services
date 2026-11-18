-- Phase 5 (5C): public application references in the owner-decided format
-- (18 digits, three groups of six; segments derived from keyed hashes of the
-- citizen's date of birth and NID — see apps/api/src/references.ts).
-- Existing applications keep reference NULL and stay trackable by their UUID;
-- only applications created after this migration carry a reference. The value
-- is globally unique because the public tracking page resolves it without a
-- tenant context.
ALTER TABLE applications ADD COLUMN reference text;
CREATE UNIQUE INDEX applications_reference_key ON applications (reference);

-- The by-reference twin of public_track (migration 008): the same limited
-- public record, keyed by the printed reference instead of the UUID.
-- SECURITY DEFINER like public_track; the migration owner's
-- public_definer_owner_read policy (migration 009) covers the applications read.
CREATE FUNCTION public_track_by_reference(ref text) RETURNS TABLE(status text,office_bn text,office_en text,service_no integer,service_bn text,service_en text,created_at timestamptz,demo boolean)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT a.state,t.name_bn,t.name_en,a.service_no,s.name_bn,s.name_en,a.created_at,t.demo
 FROM applications a JOIN tenants t ON t.id=a.tenant_id JOIN service_catalog s ON s.service_no=a.service_no
 WHERE a.reference=ref AND t.status='ACTIVE' AND a.state<>'DRAFT';
$$;
REVOKE ALL ON FUNCTION public_track_by_reference(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_track_by_reference(text) TO astra_app;
