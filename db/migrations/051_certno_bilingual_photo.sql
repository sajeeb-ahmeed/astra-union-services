-- CERTNO-01 (owner-approved 18 Nov 2026): bilingual certificate storage and the
-- optional citizen photo.
--
-- certificates.pdf keeps holding the Bangla render (the canonical document, as
-- before this migration). pdf_en holds the English render produced by the same
-- issuance under the same certificate number and QR. Rows issued before this
-- migration have pdf_en NULL; the download endpoint answers
-- LANGUAGE_VERSION_UNAVAILABLE for those instead of fabricating a translation.
ALTER TABLE certificates ADD COLUMN pdf_en bytea;

-- The citizen photo is fully dynamic: NULL means "no photo" and certificates
-- print nothing at all in the photo position (no box, no placeholder). Stored
-- on the citizen record so every later issuance of that citizen uses it.
ALTER TABLE citizens ADD COLUMN photo bytea;
ALTER TABLE citizens ADD COLUMN photo_mime text;
ALTER TABLE citizens ADD COLUMN photo_updated_at timestamptz;
ALTER TABLE citizens ADD CONSTRAINT citizens_photo_mime_check
  CHECK (photo_mime IS NULL OR photo_mime IN ('image/png','image/jpeg'));
