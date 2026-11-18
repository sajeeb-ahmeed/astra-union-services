-- CERTASSETS-01 (owner-approved plan, 18 Nov 2026): office certificate assets.
-- Each office (tenant) holds its own certificate artwork — office LOGO, office
-- SEAL and the chairman's SIGNATURE image — uploaded once from the office
-- profile and picked up dynamically by Template v7 at issuance. Until now the
-- seal lived as hand-placed files inside the app folder
-- (apps/api/assets/offices/<tenantId>/), which a cPanel redeploy can wipe and
-- which no new union can self-serve; the logo and signature image did not
-- exist at all.
--
-- Storage follows the attachments pattern (migration 001/015): the image
-- bytes live in the database (bytea), never in the deployable app folder, so
-- redeploys cannot lose an office's artwork. Upload validation reuses the
-- attachment pipeline's decodeUpload() (magic-byte signature + 2 MiB cap).
--
-- Versioning follows the platform_setting_changes pattern (migration 044):
-- office_certificate_assets is append-only — a replace INSERTs a new version
-- row, nothing is ever updated or deleted, and the current asset is the
-- highest version per (tenant, kind). Every upload/replace also writes a row
-- to office_certificate_asset_changes (immutable, trigger-guarded) recording
-- the actor and, for a replace, the mandatory reason; the same event is
-- written to audit_events by the API so it shows in the office/owner audit
-- views. Issued certificates never change: their PDF bytes are stored at
-- issuance (existing design), so a later asset replace affects only new
-- issuances.

CREATE TABLE office_certificate_assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 kind text NOT NULL CHECK (kind IN ('LOGO','SEAL','SIGNATURE')),
 version integer NOT NULL CHECK (version >= 1),
 mime_type text NOT NULL CHECK (mime_type IN ('image/png','image/jpeg')),
 byte_length integer NOT NULL CHECK (byte_length BETWEEN 1 AND 2097152),
 content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
 bytes bytea NOT NULL,
 uploaded_by uuid NOT NULL REFERENCES platform_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id, kind, version),
 UNIQUE (tenant_id, id)
);
CREATE INDEX office_certificate_assets_current
 ON office_certificate_assets(tenant_id, kind, version DESC);
ALTER TABLE office_certificate_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE office_certificate_assets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON office_certificate_assets
 USING (tenant_id = nullif(current_setting('astra.tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id = nullif(current_setting('astra.tenant_id',true),'')::uuid);
REVOKE ALL ON office_certificate_assets FROM PUBLIC, astra_app;
GRANT SELECT, INSERT ON office_certificate_assets TO astra_app;

CREATE TABLE office_certificate_asset_changes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 asset_id uuid NOT NULL,
 kind text NOT NULL CHECK (kind IN ('LOGO','SEAL','SIGNATURE')),
 version integer NOT NULL CHECK (version >= 1),
 action text NOT NULL CHECK (action IN ('UPLOADED','REPLACED')),
 reason text CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 8 AND 500),
 changed_by uuid NOT NULL REFERENCES platform_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (tenant_id, asset_id) REFERENCES office_certificate_assets(tenant_id, id),
 CHECK (action = 'UPLOADED' OR reason IS NOT NULL)
);
CREATE INDEX office_certificate_asset_changes_office
 ON office_certificate_asset_changes(tenant_id, created_at DESC);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON office_certificate_asset_changes
 FOR EACH ROW EXECUTE FUNCTION immutable_record();
ALTER TABLE office_certificate_asset_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE office_certificate_asset_changes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON office_certificate_asset_changes
 USING (tenant_id = nullif(current_setting('astra.tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id = nullif(current_setting('astra.tenant_id',true),'')::uuid);
REVOKE ALL ON office_certificate_asset_changes FROM PUBLIC, astra_app;
GRANT SELECT, INSERT ON office_certificate_asset_changes TO astra_app;
