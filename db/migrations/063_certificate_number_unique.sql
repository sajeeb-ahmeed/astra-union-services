-- 063_certificate_number_unique.sql
-- CERTNO-DDMM (owner order, 25 Nov 2026: "sonod number gulo only date
-- months + 10 digit random number (do not duplicated sonod number)"),
-- migration 063: certificate numbers become DDMM + 10 random digits
-- (14 digits) for NEW issuances, and must NEVER be duplicated.
--
-- Why: the number format itself is minted in code
-- (apps/api/src/app.ts newCertificateNumber: dhakaDayMonthStamp +
-- randomTenDigits, node:crypto). What the database must guarantee is
-- the "never duplicated" half. certificates.number has carried a
-- global UNIQUE constraint (certificates_number_key) since
-- 001_initial.sql, and issuance already retries on a 23505 collision
-- against it (retryOnCertificateNumberCollision). This migration
-- idempotently re-asserts that guarantee on every lineage so the
-- owner rule is enforced at the DB level, not only in code:
--
--   1. Duplicate audit — if any certificate number is somehow stored
--      twice (impossible while the constraint stands, but an era
--      lineage that lost it would be caught here), RAISE naming the
--      duplicated numbers. Nothing is silently renumbered or deleted:
--      issued certificates keep their numbers forever.
--   2. If certificates_number_key is missing, add it as
--      UNIQUE (number). If it already exists, this is a no-op.
--
-- Safety / era behaviour: existing rows are untouched — 16-digit
-- CERTNO-01 numbers (YYYYMMDD + 8 random) and any older forms stay
-- exactly as issued and keep verifying (public_verify_by_number keys
-- on the stored string, length-agnostic). No format CHECK is added:
-- a strict 14-digit check would reject every already-issued 16-digit
-- row. Idempotent: a re-run finds no duplicates, finds the constraint
-- present, and changes nothing.
DO $$
DECLARE
  dup_numbers text;
BEGIN
  SELECT string_agg(number, ', ' ORDER BY number)
    INTO dup_numbers
    FROM (SELECT number FROM certificates GROUP BY number HAVING count(*) > 1) d;
  IF dup_numbers IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 063: duplicate certificate number(s) already stored: %. Certificate numbers must never be duplicated; resolve these rows by hand (issued certificates are never renumbered automatically), then re-run.', dup_numbers;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'certificates_number_key'
  ) THEN
    ALTER TABLE certificates
      ADD CONSTRAINT certificates_number_key UNIQUE (number);
    RAISE NOTICE 'Migration 063: certificates_number_key was missing and has been added (UNIQUE on certificates.number).';
  ELSE
    RAISE NOTICE 'Migration 063: certificates_number_key already present (UNIQUE on certificates.number); no change.';
  END IF;
END $$;

COMMENT ON COLUMN certificates.number IS
  'Certificate number (sonod no). New issuances since CERTNO-DDMM (25 Nov 2026): DDMM + 10 cryptographically random digits = 14 digits (DEMO- prefixed outside official mode). Already-issued CERTNO-01 numbers are 16 digits (YYYYMMDD + 8 random) and are never renumbered. Globally UNIQUE (certificates_number_key) — never duplicated.';
