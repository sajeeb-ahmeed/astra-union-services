-- Dataset identifiers are community application IDs, not official BBS codes.
CREATE TABLE geo_divisions (code text PRIMARY KEY, name_en text NOT NULL, name_bn text NOT NULL);
CREATE TABLE geo_districts (code text PRIMARY KEY, parent_code text NOT NULL REFERENCES geo_divisions(code), name_en text NOT NULL, name_bn text NOT NULL, UNIQUE(parent_code,code));
CREATE TABLE geo_upazilas (code text PRIMARY KEY, parent_code text NOT NULL REFERENCES geo_districts(code), name_en text NOT NULL, name_bn text NOT NULL, UNIQUE(parent_code,code));
CREATE TABLE geo_unions (code text PRIMARY KEY, parent_code text NOT NULL REFERENCES geo_upazilas(code), name_en text NOT NULL, name_bn text NOT NULL, UNIQUE(parent_code,code));
CREATE TABLE geo_wards (code text PRIMARY KEY, parent_code text NOT NULL REFERENCES geo_unions(code), name_en text NOT NULL, name_bn text NOT NULL, derived boolean NOT NULL DEFAULT true CHECK(derived), UNIQUE(parent_code,code));
CREATE TABLE geo_dataset_metadata (id text PRIMARY KEY, details jsonb NOT NULL, imported_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX geo_districts_parent ON geo_districts(parent_code,name_en);
CREATE INDEX geo_upazilas_parent ON geo_upazilas(parent_code,name_en);
CREATE INDEX geo_unions_parent ON geo_unions(parent_code,name_en);
CREATE INDEX geo_wards_parent ON geo_wards(parent_code,code);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['tenants','citizens'] LOOP
  EXECUTE format('ALTER TABLE %I ADD COLUMN division_code text REFERENCES geo_divisions(code), ADD COLUMN district_code text, ADD COLUMN upazila_code text, ADD COLUMN union_code text, ADD COLUMN ward_code text',tab);
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY(division_code,district_code) REFERENCES geo_districts(parent_code,code)',tab,tab||'_geo_district');
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY(district_code,upazila_code) REFERENCES geo_upazilas(parent_code,code)',tab,tab||'_geo_upazila');
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY(upazila_code,union_code) REFERENCES geo_unions(parent_code,code)',tab,tab||'_geo_union');
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY(union_code,ward_code) REFERENCES geo_wards(parent_code,code)',tab,tab||'_geo_ward');
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK ((division_code IS NULL AND district_code IS NULL AND upazila_code IS NULL AND union_code IS NULL AND ward_code IS NULL) OR (division_code IS NOT NULL AND district_code IS NOT NULL AND upazila_code IS NOT NULL AND (ward_code IS NULL OR union_code IS NOT NULL)))',tab,tab||'_geo_complete');
 END LOOP;
END $$;
CREATE INDEX tenants_geography ON tenants(division_code,district_code,upazila_code,union_code) WHERE status='ACTIVE';
REVOKE ALL ON geo_divisions,geo_districts,geo_upazilas,geo_unions,geo_wards,geo_dataset_metadata FROM PUBLIC,astra_app;
GRANT SELECT ON geo_divisions,geo_districts,geo_upazilas,geo_unions,geo_wards,geo_dataset_metadata TO astra_app;
