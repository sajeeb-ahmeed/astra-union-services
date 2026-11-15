-- Phase 4c (G13): the public witness-statement generator. Which certificate types exist for which religion is
-- a list the platform owner maintains (the guide requires these options to come from evidence, not a guess),
-- so the generator works with exactly the options the owner enters. Generated documents are not stored.
-- Effect on existing data: none (new table, empty until the owner adds types).
CREATE TABLE witness_certificate_types (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 religion_bn text NOT NULL CHECK (length(btrim(religion_bn)) BETWEEN 2 AND 60),
 religion_en text NOT NULL CHECK (length(btrim(religion_en)) BETWEEN 2 AND 60),
 name_bn text NOT NULL CHECK (length(btrim(name_bn)) BETWEEN 2 AND 160),
 name_en text NOT NULL CHECK (length(btrim(name_en)) BETWEEN 2 AND 160),
 active boolean NOT NULL DEFAULT true,
 sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 1000),
 created_by uuid NOT NULL REFERENCES platform_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (religion_en, name_en)
);
GRANT SELECT, INSERT ON witness_certificate_types TO astra_app;
GRANT UPDATE(active, sort_order) ON witness_certificate_types TO astra_app;
