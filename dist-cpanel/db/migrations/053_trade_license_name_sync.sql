-- Name sync (owner decision, 20 Nov 2026): the canonical English spelling of
-- service 42 is "Trade License" (American -se), matching the public catalog.
-- The reference catalog carried the British "Trade Licence", and every seeded
-- database inherited it. The seed and initialize paths insert the catalog with
-- ON CONFLICT ... DO UPDATE SET readiness only, so existing databases never
-- pick up a corrected catalog name without this migration.
-- Scope: the global service_catalog definition row only. Applications and
-- certificates store service_no and resolve the display name from
-- service_catalog at read time, so no historical record is rewritten here;
-- PDFs and e-mails already generated keep the spelling they were rendered
-- with. Idempotent: the predicate matches only the old spelling, so a second
-- run updates 0 rows.

UPDATE service_catalog
SET name_en = 'Trade License'
WHERE service_no = 42
  AND name_en = 'Trade Licence';
