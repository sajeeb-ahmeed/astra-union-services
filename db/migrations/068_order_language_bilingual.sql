-- W-024: the order panel must represent delivery_language="bilingual".
--
-- The form schema already offers bn / en / bilingual for
-- delivery_language, and issuance always renders BOTH language versions
-- under one number (CERTNO-01 bilingual issuance), so a citizen who
-- picks "bilingual" in the form was stuck at the fees step: the order
-- panel only accepted bn/en, its select had no "bilingual" option, and
-- Review fees stayed permanently disabled with no visible explanation.
--
-- This widens the snapshot CHECK so an order preference may record
-- "bilingual" (both language versions). Existing snapshots are bn/en
-- only and are untouched; the constraint change is additive.
ALTER TABLE application_order_snapshots
  DROP CONSTRAINT IF EXISTS application_order_snapshots_certificate_language_check;
ALTER TABLE application_order_snapshots
  ADD CONSTRAINT application_order_snapshots_certificate_language_check
  CHECK (certificate_language IN ('bn', 'en', 'bilingual'));
