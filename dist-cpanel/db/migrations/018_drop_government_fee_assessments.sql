-- B3: drop the unused government_fee_assessments table from migration 001.
-- No code reads or writes it; statutory and other fees are captured per order in
-- service_order_policies / application_order_snapshots (0.4) and the 0.5 gateway tables.
-- Effect on existing data: the table must be empty. If any row exists the migration stops and
-- nothing is dropped, so no fee record can be lost silently. Its RLS policy and grants go with it.
DO $$
BEGIN
  IF to_regclass('public.government_fee_assessments') IS NOT NULL
     AND EXISTS (SELECT 1 FROM government_fee_assessments) THEN
    RAISE EXCEPTION 'government_fee_assessments has rows; review them before dropping the table';
  END IF;
END $$;
DROP TABLE IF EXISTS government_fee_assessments;
