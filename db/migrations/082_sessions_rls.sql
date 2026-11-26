-- A-013 step 2 (docs/A-013-IDENTITY-AUTHORIZATION.md): row-level security on
-- sessions. Until now the runtime role read every user's session rows (token
-- hashes, CSRF tokens) with only the API's WHERE clauses in the way.
--
-- Policy: a session row is visible and writable only when it belongs to the
-- acting user, astra.user_id, which the API sets for every authenticated
-- transaction (apps/api/src/db.ts asUser / setActingUser).
--
-- The one read that happens before any user is known is the auth middleware
-- resolving a cookie's token hash. It goes through auth_resolve_session(),
-- which returns exactly the columns the middleware needs for that one token.
-- Same single-role pattern as migrations 039/042: in the two-role deployment
-- the function owner bypasses RLS; in the single-role cPanel deployment the
-- owner is the application role, which FORCE RLS subjects to the policy, so
-- the policy also admits READS while the function-scoped flag
-- astra.resolve_session is raised. The function lowers the flag again before
-- returning, so it never outlives the lookup. WITH CHECK stays user-strict:
-- every write needs astra.user_id.
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY user_scope ON sessions
  USING (
    user_id = nullif(current_setting('astra.user_id', true), '')::uuid
    OR current_setting('astra.resolve_session', true) = 'on'
  )
  WITH CHECK (user_id = nullif(current_setting('astra.user_id', true), '')::uuid);

CREATE OR REPLACE FUNCTION auth_resolve_session(token_digest text)
RETURNS TABLE(
  id uuid,
  user_id uuid,
  tenant_id uuid,
  csrf_token text,
  expires_at timestamptz,
  created_at timestamptz,
  last_seen_at timestamptz,
  email text,
  display_name text,
  active boolean,
  platform_role text,
  email_verified_at timestamptz,
  role text,
  membership_active boolean,
  tenant_status text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM set_config('astra.resolve_session', 'on', true);
  RETURN QUERY
    SELECT s.id, s.user_id, s.tenant_id, s.csrf_token, s.expires_at, s.created_at, s.last_seen_at,
           u.email, u.display_name, u.active, u.platform_role, u.email_verified_at,
           m.role, m.active, t.status
      FROM sessions s
      JOIN platform_users u ON u.id = s.user_id
      LEFT JOIN staff_memberships m ON m.user_id = s.user_id AND m.tenant_id = s.tenant_id
      LEFT JOIN tenants t ON t.id = s.tenant_id
     WHERE s.token_hash = token_digest AND s.expires_at > now();
  PERFORM set_config('astra.resolve_session', 'off', true);
END;
$$;
REVOKE ALL ON FUNCTION auth_resolve_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_resolve_session(text) TO astra_app;
