-- Managed PostgreSQL migration owners need explicit SELECT policies because
-- FORCE ROW LEVEL SECURITY also applies inside their SECURITY DEFINER functions.
-- The request role retains tenant_scope and must never inherit this owner role.
DO $$
DECLARE
  target_table text;
  owner_oid oid := (SELECT oid FROM pg_roles WHERE rolname = current_user);
BEGIN
  IF current_user = 'astra_app'
     OR pg_has_role('astra_app', current_user, 'MEMBER') THEN
    RAISE EXCEPTION 'The application role must not be or inherit the migration owner';
  END IF;

  FOREACH target_table IN ARRAY ARRAY[
    'certificates', 'applications', 'notices', 'password_recovery_tokens'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = target_table
        AND c.relowner = owner_oid AND c.relrowsecurity AND c.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION 'Expected a forced-RLS table owned by the migration role: %', target_table;
    END IF;
    EXECUTE format(
      'CREATE POLICY public_definer_owner_read ON public.%I FOR SELECT TO %I USING (true)',
      target_table, current_user
    );
  END LOOP;
END $$;
