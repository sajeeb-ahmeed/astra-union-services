-- W-012: global platform statistics for the System Owner — total
-- citizens, applications and certificates, the applications by current
-- state, and a per-office breakdown, optionally within a UTC date range
-- and/or scoped to one office. Counts only: no names, numbers, addresses
-- or any other personal data leave the function.
--
-- Counting rules (also documented in docs/OWNER_STATISTICS.md):
--   * the range is UTC calendar days: from 00:00 UTC on `from_date`
--     (inclusive) to 00:00 UTC the day after `to_date` (exclusive);
--     a NULL bound is unbounded;
--   * citizens and applications count rows created in the range,
--     certificates count rows ISSUED in the range (issued_at);
--   * applicationsByState is the CURRENT state of the applications
--     created in the range (not the state at creation);
--   * the per-office breakdown uses the same range and the same rules,
--     so the office rows add up to the totals.
-- Like owner_operations_summary (migration 037) this is a SECURITY
-- DEFINER function: the application role cannot read across tenants
-- (FORCE RLS), so the aggregation runs as the migration owner. The API
-- allows it to the owner role only.
-- Effect on existing data: none.
DO $$ BEGIN
 IF current_user = 'astra_app' OR pg_has_role('astra_app', current_user, 'MEMBER') THEN
  RAISE EXCEPTION 'The application role must not be or inherit the migration owner';
 END IF;
END $$;

CREATE OR REPLACE FUNCTION owner_statistics(p_from date, p_to date, p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $func$
DECLARE
  v_from timestamptz := CASE WHEN p_from IS NULL THEN '-infinity'::timestamptz ELSE p_from::timestamptz END;
  v_to timestamptz := CASE WHEN p_to IS NULL THEN 'infinity'::timestamptz ELSE (p_to + INTERVAL '1 day')::timestamptz END;
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'totals', jsonb_build_object(
      'citizens', (SELECT count(*) FROM citizens
        WHERE created_at >= v_from AND created_at < v_to AND (p_tenant IS NULL OR tenant_id = p_tenant)),
      'applications', (SELECT count(*) FROM applications
        WHERE created_at >= v_from AND created_at < v_to AND (p_tenant IS NULL OR tenant_id = p_tenant)),
      'certificates', (SELECT count(*) FROM certificates
        WHERE issued_at >= v_from AND issued_at < v_to AND (p_tenant IS NULL OR tenant_id = p_tenant))
    ),
    -- The full state partition (zero where a state has no rows), so the
    -- UI can show that the tiles add up to the applications total.
    'applicationsByState', (
      SELECT jsonb_object_agg(s.state, s.n) FROM (
        SELECT st.state, COALESCE(a.n, 0)::int AS n FROM
          (VALUES ('DRAFT'),('SUBMITTED'),('UNDER_REVIEW'),('CORRECTION_REQUIRED'),('RESUBMITTED'),
                  ('APPROVED'),('ISSUED'),('REJECTED'),('CANCELLED'),('REVOKED')) AS st(state)
          LEFT JOIN (
            SELECT state, count(*)::int AS n FROM applications
            WHERE created_at >= v_from AND created_at < v_to AND (p_tenant IS NULL OR tenant_id = p_tenant)
            GROUP BY state
          ) a ON a.state = st.state
      ) s
    ),
    'certificatesByState', (
      SELECT jsonb_object_agg(s.status, s.n) FROM (
        SELECT st.status, COALESCE(c.n, 0)::int AS n FROM
          (VALUES ('ISSUED'),('REVOKED')) AS st(status)
          LEFT JOIN (
            SELECT status, count(*)::int AS n FROM certificates
            WHERE issued_at >= v_from AND issued_at < v_to AND (p_tenant IS NULL OR tenant_id = p_tenant)
            GROUP BY status
          ) c ON c.status = st.status
      ) s
    ),
    'offices', (
      SELECT COALESCE(jsonb_agg(o ORDER BY o.applications DESC, o."nameEn" ASC), '[]'::jsonb) FROM (
        SELECT
          t.id AS "tenantId", t.slug, t.name_bn AS "nameBn", t.name_en AS "nameEn",
          COALESCE(c.n, 0)::int AS citizens,
          COALESCE(a.n, 0)::int AS applications,
          COALESCE(ce.n, 0)::int AS certificates
        FROM tenants t
        LEFT JOIN (
          SELECT tenant_id, count(*)::int AS n FROM citizens
          WHERE created_at >= v_from AND created_at < v_to GROUP BY tenant_id
        ) c ON c.tenant_id = t.id
        LEFT JOIN (
          SELECT tenant_id, count(*)::int AS n FROM applications
          WHERE created_at >= v_from AND created_at < v_to GROUP BY tenant_id
        ) a ON a.tenant_id = t.id
        LEFT JOIN (
          SELECT tenant_id, count(*)::int AS n FROM certificates
          WHERE issued_at >= v_from AND issued_at < v_to GROUP BY tenant_id
        ) ce ON ce.tenant_id = t.id
        WHERE p_tenant IS NULL OR t.id = p_tenant
      ) o
    ),
    'checkedAt', now()
  ) INTO v_result;
  RETURN v_result;
END;
$func$;
REVOKE EXECUTE ON FUNCTION owner_statistics(date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION owner_statistics(date, date, uuid) TO astra_app;

-- W-020: how many offices have a payment merchant configured, per
-- provider. Counts only — no merchant account numbers, keys or secrets.
CREATE OR REPLACE FUNCTION owner_payment_merchants_summary() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object(
   'merchantsTotal', (SELECT count(*) FROM office_payment_merchants),
   'officesConfigured', (SELECT count(DISTINCT tenant_id) FROM office_payment_merchants),
   'byProvider', (
     SELECT COALESCE(jsonb_object_agg(provider, n), '{}'::jsonb) FROM (
       SELECT provider, count(*)::int AS n FROM office_payment_merchants GROUP BY provider
     ) s
   ),
   'checkedAt', now()
 );
$$;
REVOKE EXECUTE ON FUNCTION owner_payment_merchants_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION owner_payment_merchants_summary() TO astra_app;
