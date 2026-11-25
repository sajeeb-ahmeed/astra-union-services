-- WS-D1 (r10-live fix phase), migration 060: backfill public references for
-- pre-047 applications. (Renamed from 059 on 25 Nov 2026: 059 belongs to
-- the cert side's 059_certificate_asset_removal.sql; content unchanged.)
--
-- Why: migration 047 added applications.reference but deliberately left
-- existing rows NULL ("stay trackable by their UUID"). The workspace list
-- falls back to `reference || id`, so every pre-047 row — including the
-- 17 Nov 2026 QA rows and most of the issued page-2 rows on live — renders
-- its raw UUID as the public reference (chairman-report finding 17,
-- applications-list-check defect (e)). New rows since CERTNO-01 already
-- carry a 16-digit reference (Dhaka submission date + 8 random digits).
--
-- What this does: mints a CERTNO-01 reference for every application whose
-- reference is NULL, empty, or UUID-shaped, using the application's own
-- created_at Dhaka calendar date as the prefix — the same date the mint
-- would have used had the row been created after CERTNO-01. The unique
-- index on applications.reference is honoured: each candidate is retried
-- on collision (up to 12 attempts per row, the mintReference contract).
--
-- Safety: the certificate number is independent (certificates.number is
-- minted at issuance from the issue date), so backfilling the application
-- reference cannot change any printed certificate number or QR link.
-- Rows that previously resolved by UUID keep resolving by UUID
-- (the lookup endpoint accepts UUID ids unchanged). Idempotent: a
-- re-run finds no NULL/empty/UUID-shaped reference and updates 0 rows.
DO $$
DECLARE
  app RECORD;
  candidate text;
  attempt int;
  done boolean;
BEGIN
  FOR app IN
    SELECT id, created_at FROM applications
    WHERE reference IS NULL
       OR reference = ''
       OR reference ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    ORDER BY created_at, id
  LOOP
    done := false;
    FOR attempt IN 1..12 LOOP
      candidate := to_char(app.created_at AT TIME ZONE 'Asia/Dhaka', 'YYYYMMDD')
        || lpad(floor(random() * 100000000)::text, 8, '0');
      BEGIN
        UPDATE applications SET reference = candidate WHERE id = app.id;
        done := true;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        -- Collision with an existing reference; mint a fresh candidate.
        CONTINUE;
      END;
    END LOOP;
    IF NOT done THEN
      RAISE EXCEPTION 'REFERENCE_GENERATION_FAILED for application %', app.id;
    END IF;
  END LOOP;
END $$;
