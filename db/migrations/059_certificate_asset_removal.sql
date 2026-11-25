-- WS-5 ASSETS-REMOVE (25 Nov 2026): certificate-asset removal as a tombstone.
--
-- Md is holding back the original logo/signature while the site is still
-- staging, and the placeholder platform logo sitting in the logo + seal slots
-- cannot be cleared without a Remove option. Removal must NOT physically
-- delete anything: office_certificate_assets is append-only (migration 050
-- header) and office_certificate_asset_changes is immutable and FK-bound to
-- the asset rows, so a DELETE would dismantle the audit design.
--
-- Removal therefore INSERTs a new version row (version = current + 1) with
-- removed = true, copying the previous row's mime_type / byte_length /
-- content_sha256 / bytes so every CHECK on the table still passes, plus a
-- change row (action REMOVED, reason mandatory) and an audit event
-- OFFICE_CERTIFICATE_ASSET_REMOVED. The resolver treats a kind whose LATEST
-- version is removed as having no asset; older versions stay in history and
-- already-issued certificates never change (their PDF bytes are stored at
-- issuance).
--
-- The action CHECK on office_certificate_asset_changes was inline in 050, so
-- Postgres auto-named it office_certificate_asset_changes_action_check
-- (verified from pg_constraint on the dev cluster, 25 Nov 2026). The
-- existing reason CHECK (action = 'UPLOADED' OR reason IS NOT NULL) already
-- forces a reason for REMOVED, so it is kept unchanged.

ALTER TABLE office_certificate_assets ADD COLUMN removed boolean NOT NULL DEFAULT false;

ALTER TABLE office_certificate_asset_changes DROP CONSTRAINT office_certificate_asset_changes_action_check;
ALTER TABLE office_certificate_asset_changes ADD CONSTRAINT office_certificate_asset_changes_action_check CHECK (action IN ('UPLOADED', 'REPLACED', 'REMOVED'));
