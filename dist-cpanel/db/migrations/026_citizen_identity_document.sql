-- Phase 3c: an optional NID or birth-registration image linked to the citizen record.
-- The image is an ordinary private attachment, so it goes through the existing quarantine and malware scan;
-- it can be opened only after a CLEAN scan. The composite key makes the database itself refuse a document
-- that belongs to another citizen or office.
-- Effect on existing data: none; both new columns are null for every existing citizen.
CREATE UNIQUE INDEX attachments_citizen_key ON attachments(tenant_id, citizen_id, id);
ALTER TABLE citizens
  ADD COLUMN identity_document_id uuid,
  ADD COLUMN identity_document_kind text CHECK (identity_document_kind IN ('nid', 'birth_reg')),
  ADD CONSTRAINT citizens_identity_document_parts
    CHECK ((identity_document_id IS NULL) = (identity_document_kind IS NULL)),
  ADD CONSTRAINT citizens_identity_document_own
    FOREIGN KEY (tenant_id, id, identity_document_id) REFERENCES attachments(tenant_id, citizen_id, id);
