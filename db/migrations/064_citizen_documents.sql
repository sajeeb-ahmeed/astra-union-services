-- 064_citizen_documents.sql
-- Citizen dashboard+profile build (WS-A, Md's decisions 2026-11-26), migration 064:
-- the documents vault — one named document slot per kind on the citizen record, so a
-- citizen uploads an NID or birth-registration image once and reuses it in applications.
--
-- What this does:
--   1. Creates citizen_documents (tenant_id, citizen_id, kind, attachment_id,
--      updated_at) with PRIMARY KEY (tenant_id, citizen_id, kind). A row exists only
--      while a document is linked; unlinking deletes the row (the upload itself is
--      kept, exactly like the Phase 3c identity-document unlink). The composite
--      foreign key to attachments(tenant_id, citizen_id, id) makes the database
--      itself refuse a document that belongs to another citizen or office (same
--      pattern as migration 026), and the key to citizens(tenant_id, id) keeps
--      every row inside one office.
--   2. Kind CHECK is ('nid', 'birth_reg') ONLY — deliberately no 'photo' kind.
--      The citizen photo is stored as bytes on the citizen record (migration 051,
--      citizens.photo), not as an attachment, and it is the single photo source
--      printed on certificates. A vault 'photo' kind would need an
--      attachment-backed photo document, which nothing supports today (no form
--      asks for a photo upload); adding the kind would create a second, competing
--      photo store. The profile photo stays where it is; if an attachable photo
--      document is ever required, a later migration can widen this CHECK.
--   3. Copies every existing Phase 3c identity document (citizens.
--      identity_document_id / identity_document_kind) into the vault under its
--      kind. The old columns are KEPT (dual-read): the API surfaces a legacy
--      document when no vault row exists for its kind, and the old
--      PUT /citizens/:id/identity-document endpoint keeps working. Dropping the
--      old columns is a later migration, after every reader uses the vault.
--   4. Row Level Security follows the citizens/attachments tenant pattern
--      (migration 001): ENABLE + FORCE + tenant_scope policy on
--      astra.tenant_id. Grants mirror migration 021 (SELECT, INSERT, UPDATE,
--      DELETE — DELETE is the unlink).
--
-- Scan policy is unchanged: a vault document is an ordinary private attachment,
-- quarantined until the scanner verdict is CLEAN, and submit/resubmit/issuance
-- still refuse non-CLEAN attachments (409 ATTACHMENT_NOT_READY). The vault is
-- storage, never a scan bypass.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS before CREATE
-- POLICY, grants re-apply cleanly, and the copy uses ON CONFLICT DO NOTHING, so
-- re-running this file changes nothing (the 062/063 re-run pattern). Atomic: the
-- runner applies the file in one transaction.

CREATE TABLE IF NOT EXISTS citizen_documents (
  tenant_id uuid NOT NULL,
  citizen_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('nid', 'birth_reg')),
  attachment_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, citizen_id, kind),
  FOREIGN KEY (tenant_id, citizen_id) REFERENCES citizens(tenant_id, id),
  FOREIGN KEY (tenant_id, citizen_id, attachment_id) REFERENCES attachments(tenant_id, citizen_id, id)
);

ALTER TABLE citizen_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE citizen_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_scope ON citizen_documents;
CREATE POLICY tenant_scope ON citizen_documents
  USING (tenant_id = nullif(current_setting('astra.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('astra.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON citizen_documents TO astra_app;

INSERT INTO citizen_documents (tenant_id, citizen_id, kind, attachment_id, updated_at)
SELECT tenant_id, id, identity_document_kind, identity_document_id, now()
FROM citizens
WHERE identity_document_id IS NOT NULL AND identity_document_kind IS NOT NULL
ON CONFLICT (tenant_id, citizen_id, kind) DO NOTHING;
