-- Phase 3a: personal and identity details on the citizen record.
-- NID and birth-registration numbers are stored encrypted (AES-256-GCM, key CITIZEN_DATA_KEY) so they can be
-- printed on certificates, with a keyed digest to find duplicates and a masked hint for lists (owner decision).
-- Effect on existing data: none changes. Every new column is nullable or defaults to "not declared", so
-- existing citizens stay valid; they simply have fewer details until someone adds them.
ALTER TABLE citizens
  ADD COLUMN gender text CHECK (gender IN ('female','male','other')),
  ADD COLUMN father_name_bn text CHECK (length(father_name_bn) BETWEEN 2 AND 120),
  ADD COLUMN father_name_en text CHECK (length(father_name_en) BETWEEN 2 AND 120),
  ADD COLUMN mother_name_bn text CHECK (length(mother_name_bn) BETWEEN 2 AND 120),
  ADD COLUMN mother_name_en text CHECK (length(mother_name_en) BETWEEN 2 AND 120),
  ADD COLUMN spouse_name_bn text CHECK (length(spouse_name_bn) BETWEEN 2 AND 120),
  ADD COLUMN spouse_name_en text CHECK (length(spouse_name_en) BETWEEN 2 AND 120),
  ADD COLUMN blood_group text CHECK (blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  ADD COLUMN nid_cipher text,
  ADD COLUMN nid_digest text CHECK (nid_digest ~ '^[a-f0-9]{64}$'),
  ADD COLUMN nid_hint text CHECK (length(nid_hint) BETWEEN 3 AND 24),
  ADD COLUMN birth_reg_cipher text,
  ADD COLUMN birth_reg_digest text CHECK (birth_reg_digest ~ '^[a-f0-9]{64}$'),
  ADD COLUMN birth_reg_hint text CHECK (length(birth_reg_hint) BETWEEN 3 AND 24),
  ADD COLUMN contact_mobile text CHECK (contact_mobile ~ '^01[3-9][0-9]{8}$'),
  ADD COLUMN no_mobile boolean NOT NULL DEFAULT false;
ALTER TABLE citizens
  -- The three parts of an encrypted number are present together or not at all.
  ADD CONSTRAINT citizens_nid_parts CHECK ((nid_cipher IS NULL) = (nid_digest IS NULL) AND (nid_digest IS NULL) = (nid_hint IS NULL)),
  ADD CONSTRAINT citizens_birth_reg_parts CHECK ((birth_reg_cipher IS NULL) = (birth_reg_digest IS NULL) AND (birth_reg_digest IS NULL) = (birth_reg_hint IS NULL)),
  -- "No mobile" and a mobile number cannot both be declared.
  ADD CONSTRAINT citizens_mobile_or_none CHECK (NOT (no_mobile AND contact_mobile IS NOT NULL));
-- One citizen record per number within an office.
CREATE UNIQUE INDEX citizens_nid_per_office ON citizens (tenant_id, nid_digest) WHERE nid_digest IS NOT NULL;
CREATE UNIQUE INDEX citizens_birth_reg_per_office ON citizens (tenant_id, birth_reg_digest) WHERE birth_reg_digest IS NOT NULL;
