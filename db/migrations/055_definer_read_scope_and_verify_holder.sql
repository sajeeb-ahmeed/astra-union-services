-- QA-25 (pre-launch QA, 21 Nov 2026): stop the owner-only "definer"
-- policies from overriding tenant isolation inside office-scoped requests.
--
-- Migrations 009, 029, 030, 037 and 048 give the migration owner policies
-- with USING (true) so SECURITY DEFINER functions (public verify, password
-- recovery, owner operations, gateway callbacks, points, scanner) can work
-- across offices. On the cPanel single-role track the migration owner IS the
-- runtime role, so those policies also applied to every ordinary request:
-- with the tenant scope set to office B, a plain SELECT returned office A's
-- applications, certificates and attachments, and every office's service
-- configuration (which is why the admin service dropdowns listed each
-- service once per office — QA-15). Tenant isolation on those tables rested
-- on application WHERE clauses alone, and point_wallets was even writable
-- across offices at the database level.
--
-- Fix: each of those policies now matches only when NO tenant scope is set
-- (astra.tenant_id empty). Every office-scoped transaction sets the scope, so
-- tenant_scope is the only policy that can match there, on both tracks. The
-- definer functions and callbacks run outside any tenant scope and keep
-- working. (A function-level SET of a custom flag would be tighter, but
-- PostgreSQL only lets superusers attach unregistered settings to functions,
-- and the cPanel database user is not a superuser.)
DO $$
DECLARE
  p record;
  unscoped constant text :=
    $q$(NULLIF(current_setting('astra.tenant_id', true), '') IS NULL)$q$;
BEGIN
  FOR p IN
    SELECT tablename, policyname, cmd
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname IN (
        'public_definer_owner_read', 'definer_operations_read',
        'callback_owner_read', 'definer_ledger_read',
        'definer_wallet_maintenance', 'definer_queue_read',
        'definer_office_info_read'
      )
      AND qual = 'true'
  LOOP
    IF p.cmd IN ('ALL', 'UPDATE') THEN
      EXECUTE format('ALTER POLICY %I ON public.%I USING %s WITH CHECK %s',
        p.policyname, p.tablename, unscoped, unscoped);
    ELSIF p.cmd = 'INSERT' THEN
      EXECUTE format('ALTER POLICY %I ON public.%I WITH CHECK %s',
        p.policyname, p.tablename, unscoped);
    ELSE
      EXECUTE format('ALTER POLICY %I ON public.%I USING %s',
        p.policyname, p.tablename, unscoped);
    END IF;
  END LOOP;

  -- The verify-holder lookup below reads the citizen's name.
  EXECUTE format(
    'CREATE POLICY public_definer_owner_read ON public.citizens FOR SELECT TO %I USING %s',
    current_user, unscoped
  );
END $$;

-- QA-06: public verify returned no holder detail, so a genuine number could be
-- reused on a forged PDF with another person's name. This returns the holder's
-- name for an issued certificate number; the API masks it before it leaves the
-- server (first and last letter of each word), so verifiers can match the
-- paper without the full name being published.
CREATE FUNCTION public_verify_holder_by_number(cert_number text)
RETURNS TABLE(name_bn text, name_en text)
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
 SELECT ct.full_name_bn, ct.full_name_en
 FROM certificates c
 JOIN applications a ON a.id = c.application_id AND a.tenant_id = c.tenant_id
 JOIN citizens ct ON ct.id = a.citizen_id AND ct.tenant_id = a.tenant_id
 WHERE c.number = cert_number;
$$;
REVOKE ALL ON FUNCTION public_verify_holder_by_number(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_verify_holder_by_number(text) TO astra_app;
