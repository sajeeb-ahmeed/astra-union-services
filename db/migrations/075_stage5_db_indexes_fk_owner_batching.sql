-- Phase 4 Stage 5 Batch A (Database): A-014, A-007, A-011, A-012.
--
-- A-014 (P3): missing indexes. applications(citizen_id) serves the
--   citizen-dashboard join (applications JOIN citizens ON citizen_id) and
--   audit_events(tenant_id, created_at DESC) serves tenant/time audit reads
--   (incl. the S-010 bulk-read guard). Verified with EXPLAIN on 40,000
--   applications / 20,000 audit events before this migration (Seq/Bitmap
--   scans over the whole tenant slice) and after (index scans); see
--   qa-audit/remediation/fragments/stage5-batch-a-db.md.
-- A-007 (P3): approval_authorizations.service_no gets a foreign key to
--   service_catalog (static 1-47, never deleted). Verified zero orphan
--   rows on the seeded database before adding; the migration aborts if
--   any orphan exists, so no authorization can be lost silently.
-- A-011 (P3): append-only citizen_artifact_deletions ledger (same
--   immutable-trigger pattern as audit_events / account_security_events)
--   for tenant-scoped citizen-artifact deletions. DELETE
--   /citizens/:id/photo writes one row here (photo bytes are NULLed, so
--   the row records what was removed, not the bytes). The sign-in
--   identifier DELETE already writes an append-only
--   account_security_events row (SIGN_IN_IDENTIFIER_REMOVED); the
--   platform_settings DELETE is already history-tracked in
--   platform_setting_changes. No delete behaviour changes: rows/bytes
--   are still hard-removed; recovery is from backup (see
--   docs/BACKUP_AND_RECOVERY.md).
-- A-012 (P3): owner cross-tenant lookups batched into SECURITY DEFINER
--   functions (same pattern as 037 owner_operations_summary, 048
--   public_service_office_info, 071 public_service_summaries): the app
--   role cannot batch across tenants with a plain query because
--   payment_orders etc. sit behind FORCE RLS keyed on astra.tenant_id.
--   The API calls these functions instead of looping tenants with one
--   transaction each. Response shapes are unchanged (the list function
--   returns the same columns, in the same created_at DESC order).
--   The scanner sweep in attachments.ts is intentionally NOT rewritten:
--   it is a single transaction whose per-tenant loop IS the fairness
--   scheduler (least-recently-claimed tenant first, SKIP LOCKED claim);
--   see the fragment for the reasoning and follow-up.
-- A-010 / A-008 / A-020 / A-013 are documentation-only; see
--   db/migrations/README.md. This migration changes no data.
-- Effect on existing data: none (new indexes, one FK, one new table,
--   four new functions, three new definer policies).

-- A-007 guard: refuse to add the FK while any orphan authorization exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM approval_authorizations aa
    LEFT JOIN service_catalog sc ON sc.service_no = aa.service_no
    WHERE sc.service_no IS NULL
  ) THEN
    RAISE EXCEPTION 'approval_authorizations has service_no values outside service_catalog; review them before adding the foreign key';
  END IF;
END $$;
ALTER TABLE approval_authorizations
  ADD CONSTRAINT approval_authorizations_service_no_fkey
  FOREIGN KEY (service_no) REFERENCES service_catalog(service_no);

-- A-014 indexes.
CREATE INDEX applications_citizen_id ON applications(citizen_id);
CREATE INDEX audit_events_tenant_created ON audit_events(tenant_id, created_at DESC);

-- A-011 append-only deletion ledger.
CREATE TABLE citizen_artifact_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  actor_id uuid REFERENCES platform_users(id),
  citizen_id uuid NOT NULL,
  artifact_type text NOT NULL CHECK (artifact_type IN ('citizen_photo')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, citizen_id) REFERENCES citizens(tenant_id, id)
);
ALTER TABLE citizen_artifact_deletions ENABLE ROW LEVEL SECURITY;
ALTER TABLE citizen_artifact_deletions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON citizen_artifact_deletions
  USING (tenant_id = nullif(current_setting('astra.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('astra.tenant_id', true), '')::uuid);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON citizen_artifact_deletions
  FOR EACH ROW EXECUTE FUNCTION immutable_record();
REVOKE ALL ON citizen_artifact_deletions FROM PUBLIC;
GRANT SELECT, INSERT ON citizen_artifact_deletions TO astra_app;

-- A-012: the migration owner must be able to read the two order tables
-- across tenants for the definer functions below (FORCE RLS restricts
-- the owner too when it is not a superuser; same pattern as 037/048).
-- The application role must not be or inherit the migration owner.
DO $$ BEGIN
  IF current_user = 'astra_app' OR pg_has_role('astra_app', current_user, 'MEMBER') THEN
    RAISE EXCEPTION 'The application role must not be or inherit the migration owner';
  END IF;
  EXECUTE format('CREATE POLICY definer_owner_read ON payment_orders FOR SELECT TO %I USING (true)', current_user);
  EXECUTE format('CREATE POLICY definer_owner_read ON order_gateway_refunds FOR SELECT TO %I USING (true)', current_user);
  EXECUTE format('CREATE POLICY definer_recovery_consume ON password_recovery_tokens FOR UPDATE TO %I USING (true)', current_user);
END $$;

-- A-012: locate a payment order's office in one call (was: one tenant
-- transaction per tenant in app.ts locateOrderTenant).
CREATE FUNCTION locate_payment_order_tenant(p_order_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT tenant_id FROM payment_orders WHERE id = $1
$$;
REVOKE ALL ON FUNCTION locate_payment_order_tenant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION locate_payment_order_tenant(uuid) TO astra_app;

-- A-012: locate a gateway refund's office in one call (was: one tenant
-- transaction per tenant in order-payments.ts locateRefundTenant).
CREATE FUNCTION locate_order_refund_tenant(p_refund_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT tenant_id FROM order_gateway_refunds WHERE id = $1
$$;
REVOKE ALL ON FUNCTION locate_order_refund_tenant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION locate_order_refund_tenant(uuid) TO astra_app;

-- A-012: all payment orders across offices in one call (was: one tenant
-- transaction + query per tenant in GET /owner/payment-orders).
-- Columns match the previous per-tenant SELECT * plus the tenant
-- identity the API used to attach; ordering matches the API's
-- created_at DESC sort (tenant_slug, id break created_at ties the way
-- the old tenant-by-slug loop did).
CREATE FUNCTION owner_payment_orders(p_status text)
RETURNS TABLE(
  id uuid, tenant_id uuid, kind text, plan_id text, credits integer,
  amount_minor integer, currency text, status text, created_by uuid,
  created_at timestamptz, coupon_code text, discount_minor integer,
  tenant_slug text, tenant_name_bn text, tenant_name_en text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT o.id, o.tenant_id, o.kind, o.plan_id, o.credits, o.amount_minor,
    o.currency, o.status, o.created_by, o.created_at, o.coupon_code,
    o.discount_minor, t.slug, t.name_bn, t.name_en
  FROM payment_orders o
  JOIN tenants t ON t.id = o.tenant_id
  WHERE ($1 = 'ALL' OR o.status = $1)
  ORDER BY o.created_at DESC, t.slug, o.id
$$;
REVOKE ALL ON FUNCTION owner_payment_orders(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION owner_payment_orders(text) TO astra_app;

-- A-012: consume every unconsumed password-recovery token of one user in
-- one statement (was: one set_config + UPDATE per membership in
-- account-security.ts consumeAccountRecoveryLinks). The UPDATE has no
-- tenant filter by design: recovery links are per-account, and a later
-- password change must invalidate links issued under every membership.
CREATE FUNCTION consume_password_recovery_tokens(p_user_id uuid) RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH consumed AS (
    UPDATE password_recovery_tokens SET consumed_at = now()
    WHERE user_id = $1 AND consumed_at IS NULL
    RETURNING 1
  )
  SELECT count(*)::int FROM consumed
$$;
REVOKE ALL ON FUNCTION consume_password_recovery_tokens(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_password_recovery_tokens(uuid) TO astra_app;
