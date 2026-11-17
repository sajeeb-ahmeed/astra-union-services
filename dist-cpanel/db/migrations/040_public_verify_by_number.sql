-- Phase Y: Template v7 documents print the official-format verification line
-- {origin}/verify?searchText={certificateNo}. This adds the matching public
-- lookup: the same limited public record as public_verify(text), keyed by the
-- printed certificate number instead of the QR token digest. The number
-- embeds an unguessable UUID fragment, and only the fields already printed on
-- the paper document are returned. SECURITY DEFINER like public_verify; the
-- migration owner's public_definer_owner_read policy (migration 009) covers
-- the certificates read.
CREATE FUNCTION public_verify_by_number(cert_number text) RETURNS TABLE(status text,office_bn text,office_en text,service_no integer,service_bn text,service_en text,issued_at timestamptz,demo boolean)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT c.status,t.name_bn,t.name_en,c.service_no,s.name_bn,s.name_en,c.issued_at,t.demo
 FROM certificates c JOIN tenants t ON t.id=c.tenant_id JOIN service_catalog s ON s.service_no=c.service_no WHERE c.number=cert_number;
$$;
REVOKE ALL ON FUNCTION public_verify_by_number(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_verify_by_number(text) TO astra_app;
