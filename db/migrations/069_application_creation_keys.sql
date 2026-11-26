-- W-004: client-supplied idempotency keys for application creation.
--
-- POST /applications accepted no idempotency key, so a repeated request
-- (double-click, browser retry, network retry, concurrent submission)
-- created a second draft — and each draft could later settle its own
-- submit fee. A caller-supplied requestKey (uuid) now claims exactly
-- one application per (tenant, citizen, service, key): a replay of the
-- same key returns the original application instead of creating another
-- one, while a new key (or no key) still creates a legitimate repeat
-- application. Historical applications are untouched — no key rows are
-- backfilled for them.
--
-- The claim is taken inside the creation transaction under a
-- pg_advisory_xact_lock on the key, so concurrent replays serialize:
-- the loser waits for the winner's transaction, then reads the
-- committed key row and returns the same application. A failed
-- creation rolls the claim back with the transaction, so the key is
-- never consumed by a request that did not create an application.
CREATE TABLE application_creation_keys (
  tenant_id uuid NOT NULL,
  citizen_id uuid NOT NULL,
  service_no integer NOT NULL,
  request_key uuid NOT NULL,
  application_id uuid NOT NULL REFERENCES applications(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, citizen_id, service_no, request_key)
);

ALTER TABLE application_creation_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_creation_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON application_creation_keys
  USING (tenant_id = nullif(current_setting('astra.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('astra.tenant_id', true), '')::uuid);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON application_creation_keys
  FOR EACH ROW EXECUTE FUNCTION immutable_record();
REVOKE ALL ON application_creation_keys FROM PUBLIC, astra_app;
GRANT SELECT, INSERT ON application_creation_keys TO astra_app;
