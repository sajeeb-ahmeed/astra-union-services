-- Phase 2a: office account types as data, mapped onto the existing membership roles.
-- Permissions keep coming only from staff_memberships.role; an account type names the office post and
-- fixes which role that post receives. Types whose behaviour is not yet evidenced are 'provisional'.
-- Effect on existing data: none changes. The new staff_memberships.account_type column is NULL for every
-- existing membership, and NULL keeps today's behaviour (role chosen directly).
CREATE TABLE account_types (
  code text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{2,39}$'),
  name_bn text NOT NULL CHECK (length(name_bn) BETWEEN 2 AND 120),
  name_en text NOT NULL CHECK (length(name_en) BETWEEN 2 AND 120),
  office_types text[] NOT NULL CHECK (
    cardinality(office_types) > 0
    AND office_types <@ ARRAY['UNION','MUNICIPALITY','CITY_CORPORATION']::text[]
  ),
  role text NOT NULL CHECK (role IN ('admin','approver','reviewer','staff','finance')),
  status text NOT NULL CHECK (status IN ('confirmed','provisional')),
  sort_order integer NOT NULL UNIQUE
);
INSERT INTO account_types(code,name_bn,name_en,office_types,role,status,sort_order) VALUES
  ('up_chairman','ইউপি চেয়ারম্যান','UP Chairman','{UNION}','approver','provisional',10),
  ('up_panel_chairman','ইউপি প্যানেল চেয়ারম্যান','UP Panel Chairman','{UNION}','approver','provisional',20),
  ('up_secretary','ইউপি সচিব','UP Secretary','{UNION}','reviewer','provisional',30),
  ('up_admin_officer','ইউপি প্রশাসনিক কর্মকর্তা','UP Administrative Officer','{UNION}','admin','provisional',40),
  ('up_member','ইউপি সদস্য','UP Member','{UNION}','staff','provisional',50),
  ('up_reserved_women_member','ইউপি সংরক্ষিত মহিলা সদস্য','UP Reserved Women Member','{UNION}','staff','provisional',60),
  ('gram_police','গ্রাম পুলিশ','Gram Police','{UNION}','staff','provisional',70),
  ('information_officer','তথ্য কর্মকর্তা','Information Officer','{UNION}','staff','provisional',80),
  ('municipality_mayor','পৌরসভার মেয়র','Municipality Mayor','{MUNICIPALITY}','approver','provisional',110),
  ('municipality_secretary','পৌরসভার সচিব','Municipality Secretary','{MUNICIPALITY}','reviewer','provisional',120),
  ('municipality_officer','পৌরসভার কর্মকর্তা','Municipality Officer','{MUNICIPALITY}','staff','provisional',130),
  ('city_corporation_mayor','সিটি কর্পোরেশনের মেয়র','City Corporation Mayor','{CITY_CORPORATION}','approver','provisional',210),
  ('city_corporation_secretary','সিটি কর্পোরেশনের সচিব','City Corporation Secretary','{CITY_CORPORATION}','reviewer','provisional',220),
  ('city_corporation_officer','সিটি কর্পোরেশনের কর্মকর্তা','City Corporation Officer','{CITY_CORPORATION}','staff','provisional',230),
  ('digital_centre_entrepreneur','ডিজিটাল সেন্টার উদ্যোক্তা','Digital Centre Entrepreneur (UDC)','{UNION,MUNICIPALITY,CITY_CORPORATION}','staff','confirmed',310),
  ('info_service_centre_staff','তথ্য ও সেবা কেন্দ্রের কর্মী','Information & Service Centre staff','{UNION,MUNICIPALITY,CITY_CORPORATION}','staff','provisional',320);
-- Reference data: readable by the runtime role, changed only by migrations.
GRANT SELECT ON account_types TO astra_app;

ALTER TABLE staff_memberships ADD COLUMN account_type text REFERENCES account_types(code);

-- The type fixes the role and must suit the office type, whoever writes the row.
CREATE FUNCTION enforce_membership_account_type() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  t account_types;
  office text;
BEGIN
  IF NEW.account_type IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO t FROM account_types WHERE code = NEW.account_type;
  SELECT office_type INTO office FROM tenants WHERE id = NEW.tenant_id;
  IF NEW.role IS DISTINCT FROM t.role THEN
    RAISE EXCEPTION 'Account type % requires role %', t.code, t.role USING ERRCODE = '23514';
  END IF;
  IF NOT (office = ANY (t.office_types)) THEN
    RAISE EXCEPTION 'Account type % is not available for a % office', t.code, office USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER staff_membership_account_type
  BEFORE INSERT OR UPDATE OF role, account_type ON staff_memberships
  FOR EACH ROW EXECUTE FUNCTION enforce_membership_account_type();
