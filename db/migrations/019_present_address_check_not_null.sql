-- B4: tighten the PAR-06 present-address CHECK from migration 016.
-- In 016, `length(present_address_bn) BETWEEN 4 AND 500` evaluates to NULL when the text is NULL,
-- and a CHECK that evaluates to NULL passes, so a row with present_same_as_permanent=false and no
-- present address text was accepted by the database (the API already rejects it through zod).
-- This replaces the constraint with the same rule plus explicit IS NOT NULL terms.
-- Effect on existing data: none is changed. Adding the constraint validates every existing row;
-- if any row has a separate present address without both texts, the migration stops.
ALTER TABLE citizens
  DROP CONSTRAINT citizens_present_address_complete,
  ADD CONSTRAINT citizens_present_address_complete CHECK (
    (present_same_as_permanent
      AND present_address_bn IS NULL AND present_address_en IS NULL
      AND present_division_code IS NULL AND present_district_code IS NULL AND present_upazila_code IS NULL
      AND present_union_code IS NULL AND present_ward_code IS NULL)
    OR
    (NOT present_same_as_permanent
      AND present_address_bn IS NOT NULL AND present_address_en IS NOT NULL
      AND length(present_address_bn) BETWEEN 4 AND 500 AND length(present_address_en) BETWEEN 4 AND 500
      AND ((present_division_code IS NULL AND present_district_code IS NULL AND present_upazila_code IS NULL
            AND present_union_code IS NULL AND present_ward_code IS NULL)
        OR (present_division_code IS NOT NULL AND present_district_code IS NOT NULL AND present_upazila_code IS NOT NULL
            AND (present_ward_code IS NULL OR present_union_code IS NOT NULL))))
  );
