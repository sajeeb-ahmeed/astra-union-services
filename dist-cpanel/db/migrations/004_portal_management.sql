ALTER TABLE tenants ADD COLUMN division text NOT NULL DEFAULT 'Demo division', ADD COLUMN district text NOT NULL DEFAULT 'Demo district', ADD COLUMN upazila text NOT NULL DEFAULT 'Demo upazila', ADD COLUMN office_type text NOT NULL DEFAULT 'UNION' CHECK(office_type IN ('UNION','MUNICIPALITY','CITY_CORPORATION'));
CREATE TABLE notices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 title_bn text NOT NULL,title_en text NOT NULL,body_bn text NOT NULL,body_en text NOT NULL,
 published boolean NOT NULL DEFAULT false,created_by uuid NOT NULL REFERENCES platform_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id)
);
ALTER TABLE notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE notices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON notices USING(tenant_id=nullif(current_setting('astra.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('astra.tenant_id',true),'')::uuid);
CREATE INDEX notices_published ON notices(tenant_id,published,created_at DESC);
CREATE INDEX applications_tenant_state_time ON applications(tenant_id,state,updated_at DESC);
CREATE INDEX citizens_tenant_user ON citizens(tenant_id,user_id);
CREATE TABLE renewal_links (
 tenant_id uuid NOT NULL REFERENCES tenants(id),application_id uuid NOT NULL,source_certificate_id uuid NOT NULL,
 active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,application_id),
 FOREIGN KEY(tenant_id,application_id) REFERENCES applications(tenant_id,id),
 FOREIGN KEY(tenant_id,source_certificate_id) REFERENCES certificates(tenant_id,id)
);
CREATE UNIQUE INDEX one_active_renewal ON renewal_links(tenant_id,source_certificate_id) WHERE active;
ALTER TABLE renewal_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE renewal_links FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON renewal_links USING(tenant_id=nullif(current_setting('astra.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('astra.tenant_id',true),'')::uuid);
CREATE FUNCTION enforce_renewal_lineage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM applications child JOIN certificates c ON c.id=NEW.source_certificate_id AND c.tenant_id=NEW.tenant_id JOIN applications parent ON parent.id=c.application_id AND parent.tenant_id=c.tenant_id WHERE child.id=NEW.application_id AND child.tenant_id=NEW.tenant_id AND child.service_no=parent.service_no AND child.citizen_id=parent.citizen_id AND c.status='ISSUED' AND parent.state='ISSUED') THEN RAISE EXCEPTION 'Invalid renewal lineage' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER renewal_lineage BEFORE INSERT ON renewal_links FOR EACH ROW EXECUTE FUNCTION enforce_renewal_lineage();
CREATE FUNCTION close_abandoned_renewal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.state IN ('REJECTED','CANCELLED') THEN UPDATE renewal_links SET active=false WHERE tenant_id=NEW.tenant_id AND application_id=NEW.id; END IF; RETURN NEW;
END $$;
CREATE TRIGGER renewal_closed AFTER UPDATE OF state ON applications FOR EACH ROW EXECUTE FUNCTION close_abandoned_renewal();
CREATE FUNCTION public_notices() RETURNS TABLE(id uuid,tenant_id uuid,office_slug text,office_bn text,office_en text,title_bn text,title_en text,body_bn text,body_en text,created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT n.id,n.tenant_id,t.slug,t.name_bn,t.name_en,n.title_bn,n.title_en,n.body_bn,n.body_en,n.created_at FROM notices n JOIN tenants t ON t.id=n.tenant_id WHERE n.published AND t.status='ACTIVE'; $$;
REVOKE ALL ON FUNCTION public_notices() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_notices() TO astra_app;
GRANT SELECT,INSERT,UPDATE ON notices,renewal_links TO astra_app;
