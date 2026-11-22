-- Phase 6b: a public "include our office" request. Anyone can ask for a union, municipality or city
-- corporation office to be added to Astra; the platform owner reviews the request and, if accepted, creates
-- the office through the existing owner onboarding. Contact details are kept only for that follow-up.
-- Effect on existing data: none (new table).
CREATE TABLE office_inclusion_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 office_name text NOT NULL CHECK (length(btrim(office_name)) BETWEEN 3 AND 160),
 office_type text NOT NULL CHECK (office_type IN ('UNION','MUNICIPALITY','CITY_CORPORATION')),
 division_code text, district_code text, upazila_code text, union_code text,
 contact_name text NOT NULL CHECK (length(btrim(contact_name)) BETWEEN 2 AND 120),
 contact_role text NOT NULL CHECK (length(btrim(contact_role)) BETWEEN 2 AND 120),
 contact_mobile text NOT NULL CHECK (contact_mobile ~ '^01[3-9][0-9]{8}$'),
 contact_email text CHECK (contact_email IS NULL OR contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
 message text CHECK (message IS NULL OR length(message) <= 1000),
 status text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','CONTACTED','ACCEPTED','DECLINED')),
 owner_note text CHECK (owner_note IS NULL OR length(owner_note) <= 500),
 decided_by uuid REFERENCES platform_users(id),
 decided_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (status <> 'DECLINED' OR owner_note IS NOT NULL)
);
CREATE INDEX office_inclusion_requests_queue ON office_inclusion_requests(status, created_at);
-- Written by the public form and read by the owner queue, before any office exists (as in migration 023).
GRANT SELECT, INSERT ON office_inclusion_requests TO astra_app;
GRANT UPDATE(status, owner_note, decided_by, decided_at) ON office_inclusion_requests TO astra_app;
