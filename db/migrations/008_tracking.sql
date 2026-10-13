CREATE FUNCTION public_track(application_uuid uuid) RETURNS TABLE(status text,office_bn text,office_en text,service_no integer,service_bn text,service_en text,created_at timestamptz,demo boolean)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT a.state,t.name_bn,t.name_en,a.service_no,s.name_bn,s.name_en,a.created_at,t.demo
 FROM applications a JOIN tenants t ON t.id=a.tenant_id JOIN service_catalog s ON s.service_no=a.service_no
 WHERE a.id=application_uuid AND t.status='ACTIVE' AND a.state<>'DRAFT';
$$;
REVOKE ALL ON FUNCTION public_track(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_track(uuid) TO astra_app;
