-- Phase 2d: office staff register themselves for a post; the platform owner verifies them before they can
-- sign in (owner decision). The applicant's platform_users row is created inactive and gets no membership
-- until approval; approval creates the membership with the post's role (the 020 trigger still applies).
-- Effect on existing data: none (new table).
CREATE TABLE office_account_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL UNIQUE REFERENCES platform_users(id),
  account_type text NOT NULL REFERENCES account_types(code),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  reason text CHECK (reason IS NULL OR length(reason) BETWEEN 8 AND 500),
  decided_by uuid REFERENCES platform_users(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((status = 'PENDING') = (decided_at IS NULL)),
  CHECK ((status = 'PENDING') = (decided_by IS NULL)),
  CHECK (status <> 'REJECTED' OR reason IS NOT NULL)
);
CREATE INDEX office_account_requests_queue ON office_account_requests (status, created_at);
-- Written by the public registration and read by the owner queue, before any tenant context exists.
GRANT SELECT, INSERT, UPDATE ON office_account_requests TO astra_app;
