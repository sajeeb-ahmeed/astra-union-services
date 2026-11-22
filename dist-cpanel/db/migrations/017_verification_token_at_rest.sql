-- B1: stop storing the plaintext certificate verification token.
-- Public verification already looks certificates up by token_hash (digest of the token), so the
-- plaintext copy was only used to rebuild the verify URL for staff screens. The URL is now
-- returned once, in the issuance response, and printed as the QR code on the PDF.
-- Effect on existing data: every stored plaintext token is set to NULL. token_hash is kept, so
-- QR codes on already-issued PDFs keep verifying. Staff screens show no verify link for any
-- certificate after this migration; the link remains on the certificate itself.
ALTER TABLE certificates ALTER COLUMN verification_token DROP NOT NULL;
UPDATE certificates SET verification_token = NULL WHERE verification_token IS NOT NULL;
ALTER TABLE certificates ADD CONSTRAINT certificates_no_plaintext_verification_token
  CHECK (verification_token IS NULL);
