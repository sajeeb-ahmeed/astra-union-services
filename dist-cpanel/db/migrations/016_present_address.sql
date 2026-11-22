-- PAR-06: separate present address. The existing address/geography columns remain the permanent address.
-- Present address may lie outside the office jurisdiction (e.g. a migrant worker), so only the
-- parent-child hierarchy is enforced, not the office area.
ALTER TABLE citizens
  ADD COLUMN present_same_as_permanent boolean NOT NULL DEFAULT true,
  ADD COLUMN present_address_bn text,
  ADD COLUMN present_address_en text,
  ADD COLUMN present_division_code text REFERENCES geo_divisions(code),
  ADD COLUMN present_district_code text,
  ADD COLUMN present_upazila_code text,
  ADD COLUMN present_union_code text,
  ADD COLUMN present_ward_code text;
ALTER TABLE citizens
  ADD CONSTRAINT citizens_present_geo_district FOREIGN KEY(present_division_code,present_district_code) REFERENCES geo_districts(parent_code,code),
  ADD CONSTRAINT citizens_present_geo_upazila FOREIGN KEY(present_district_code,present_upazila_code) REFERENCES geo_upazilas(parent_code,code),
  ADD CONSTRAINT citizens_present_geo_union FOREIGN KEY(present_upazila_code,present_union_code) REFERENCES geo_unions(parent_code,code),
  ADD CONSTRAINT citizens_present_geo_ward FOREIGN KEY(present_union_code,present_ward_code) REFERENCES geo_wards(parent_code,code),
  ADD CONSTRAINT citizens_present_address_complete CHECK (
    (present_same_as_permanent
      AND present_address_bn IS NULL AND present_address_en IS NULL
      AND present_division_code IS NULL AND present_district_code IS NULL AND present_upazila_code IS NULL
      AND present_union_code IS NULL AND present_ward_code IS NULL)
    OR
    (NOT present_same_as_permanent
      AND length(present_address_bn) BETWEEN 4 AND 500 AND length(present_address_en) BETWEEN 4 AND 500
      AND ((present_division_code IS NULL AND present_district_code IS NULL AND present_upazila_code IS NULL
            AND present_union_code IS NULL AND present_ward_code IS NULL)
        OR (present_division_code IS NOT NULL AND present_district_code IS NOT NULL AND present_upazila_code IS NOT NULL
            AND (present_ward_code IS NULL OR present_union_code IS NOT NULL))))
  );
