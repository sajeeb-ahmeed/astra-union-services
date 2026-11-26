-- A-013 step 3 (docs/A-013-IDENTITY-AUTHORIZATION.md): row-level security on
-- platform_users (emails, password hashes, profile data).
--
-- Read:   the acting user (astra.user_id); or any member of the office of the
--         current transaction (astra.tenant_id) -- staff lists, approver and
--         issuer names, the citizen's contact email, the gateway trigger;
--         or inside one of the narrow lookup functions below (flag
--         astra.identity_lookup, the 039/042/082 single-role pattern; each
--         function lowers the flag again before returning).
-- Lock:   SELECT ... FOR UPDATE must also pass the UPDATE policy's USING, so
--         UPDATE's USING admits self or a member of the current office
--         (admin recovery locks the target account) ...
-- Update: ... but WITH CHECK admits only the acting user's own row; code
--         that changes another account (recovery, email verification, owner
--         approval) declares it with setActingUser().
-- Insert: only the id declared in astra.new_user_id (signup, staff and
--         office-admin creation, staff account requests, initialize).
-- Delete: no policy -- the application never deletes accounts.
ALTER TABLE platform_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_users FORCE ROW LEVEL SECURITY;

CREATE POLICY identity_read ON platform_users FOR SELECT USING (
  id = nullif(current_setting('astra.user_id', true), '')::uuid
  OR EXISTS (
    SELECT 1 FROM staff_memberships m
     WHERE m.user_id = platform_users.id
       AND m.tenant_id = nullif(current_setting('astra.tenant_id', true), '')::uuid
  )
  OR current_setting('astra.identity_lookup', true) = 'on'
  -- INSERT ... RETURNING must also pass this policy: the creator sees the
  -- account it is creating (declared in astra.new_user_id), in that
  -- transaction only.
  OR id = nullif(current_setting('astra.new_user_id', true), '')::uuid
  -- auth_resolve_session (migration 082) joins platform_users; on the
  -- single-role database its owner is subject to this policy too.
  OR current_setting('astra.resolve_session', true) = 'on'
);
CREATE POLICY identity_update ON platform_users FOR UPDATE
  USING (
    id = nullif(current_setting('astra.user_id', true), '')::uuid
    OR EXISTS (
      SELECT 1 FROM staff_memberships m
       WHERE m.user_id = platform_users.id
         AND m.tenant_id = nullif(current_setting('astra.tenant_id', true), '')::uuid
    )
  )
  WITH CHECK (id = nullif(current_setting('astra.user_id', true), '')::uuid);
CREATE POLICY identity_insert ON platform_users FOR INSERT
  WITH CHECK (id = nullif(current_setting('astra.new_user_id', true), '')::uuid);

-- Sign-in by mobile / NID / birth registration: identifier digest -> email.
CREATE OR REPLACE FUNCTION auth_identifier_email(identifier_kind text, identifier_digest text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE result text;
BEGIN
  PERFORM set_config('astra.identity_lookup', 'on', true);
  SELECT u.email INTO result
    FROM account_identifiers i JOIN platform_users u ON u.id = i.user_id
   WHERE i.kind = identifier_kind AND i.digest = identifier_digest
     AND (i.kind <> 'mobile' OR i.verified_at IS NOT NULL);
  PERFORM set_config('astra.identity_lookup', 'off', true);
  RETURN result;
END;
$$;

-- Sign-in and the sign-in audit row: email (exact, as stored) -> account id.
CREATE OR REPLACE FUNCTION auth_user_id_by_email(account_email text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE result uuid;
BEGIN
  PERFORM set_config('astra.identity_lookup', 'on', true);
  SELECT u.id INTO result FROM platform_users u WHERE u.email = account_email;
  PERFORM set_config('astra.identity_lookup', 'off', true);
  RETURN result;
END;
$$;

-- Signup / staff account request: is this email already registered
-- (case-insensitive)?  Answers only yes or no.
CREATE OR REPLACE FUNCTION auth_email_taken(account_email text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE result boolean;
BEGIN
  PERFORM set_config('astra.identity_lookup', 'on', true);
  SELECT EXISTS (SELECT 1 FROM platform_users u WHERE lower(u.email) = lower(account_email)) INTO result;
  PERFORM set_config('astra.identity_lookup', 'off', true);
  RETURN result;
END;
$$;

-- The platform owner's staff-account request queue (the API checks the owner
-- role before calling it). The requesting accounts are not members of any
-- office yet, so no office scope can reach them.
CREATE OR REPLACE FUNCTION owner_account_requests(wanted_status text)
RETURNS TABLE(
  id uuid, status text, reason text, created_at timestamptz, decided_at timestamptz,
  account_type text, account_type_bn text, account_type_en text, role text,
  email text, display_name text, office_bn text, office_en text, office_type text,
  mobile_hint text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM set_config('astra.identity_lookup', 'on', true);
  RETURN QUERY
    SELECT r.id, r.status, r.reason, r.created_at, r.decided_at, r.account_type,
           a.name_bn, a.name_en, a.role,
           u.email, u.display_name, t.name_bn, t.name_en, t.office_type,
           (SELECT i.hint FROM account_identifiers i WHERE i.user_id = u.id AND i.kind = 'mobile')
      FROM office_account_requests r
      JOIN platform_users u ON u.id = r.user_id
      JOIN account_types a ON a.code = r.account_type
      JOIN tenants t ON t.id = r.tenant_id
     WHERE r.status = wanted_status
     ORDER BY r.created_at LIMIT 200;
  PERFORM set_config('astra.identity_lookup', 'off', true);
END;
$$;

REVOKE ALL ON FUNCTION auth_identifier_email(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_user_id_by_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_email_taken(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION owner_account_requests(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_identifier_email(text, text) TO astra_app;
GRANT EXECUTE ON FUNCTION auth_user_id_by_email(text) TO astra_app;
GRANT EXECUTE ON FUNCTION auth_email_taken(text) TO astra_app;
GRANT EXECUTE ON FUNCTION owner_account_requests(text) TO astra_app;
