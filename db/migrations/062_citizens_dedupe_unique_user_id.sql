-- 062_citizens_dedupe_unique_user_id.sql
-- WS-G (r10-live fix phase), migration 062: remove duplicate citizens rows
-- per account and enforce one citizen row per account with a UNIQUE index.
--
-- Why: the QA citizen account has TWO citizens rows on live (WS-B
-- two-stores investigation, qa-fixes/r10live-engine.md §4b/§4f) — an older
-- row (name "কিউএ টেস্ট নাগরিক" / "QA Citizen Test", NID hint ••••456,
-- empty DOB/address) and a newer row (name "সাকিব / Sakib", NID hint
-- ••••011, complete). Reads without ORDER BY flip between the two rows,
-- so the profile form shows empty DOB/address while the completeness
-- meter measures the complete row at 100%. WS-B fixed the read side
-- (portal-tools.ts ORDER BY created_at DESC LIMIT 1) and explicitly left
-- this cleanup + UNIQUE index as a follow-up needing Md's decision; Md
-- approved it 25 Nov 2026 14:10 ("Ha, purono row-ta soriye UNIQUE index
-- bosao").
--
-- What this does, in order:
--   Phase 1 — per (tenant_id, user_id), user_id NOT NULL: keep exactly ONE
--     row, the newest by created_at (tie-break: greatest id). Every older
--     row's referencing rows are REPOINTED to the kept row first
--     (applications, attachments, print_requests — the only three tables
--     with a FOREIGN KEY to citizens(tenant_id, id); see below), then the
--     older row is deleted. Each deletion is logged with RAISE NOTICE
--     (user_id, tenant_id, deleted row id, kept row id, repoint counts),
--     so nothing is ever silently deleted.
--   Phase 2 — cross-tenant leftovers: after phase 1 a user_id can still
--     have rows in more than one office. Keep the globally newest row;
--     delete an older row in another office ONLY if it has zero referencing
--     rows in its own office (logged with RAISE NOTICE). If it DOES have
--     referencing rows, the migration RAISES an exception naming the
--     user_id / tenant / row — it cannot be repointed across offices
--     because the foreign keys are composite (tenant_id, citizen_id) and
--     the kept row lives in a different tenant. The whole migration rolls
--     back; resolve that account by hand, then re-run.
--   Phase 3 — CREATE UNIQUE INDEX IF NOT EXISTS citizens_user_id_unique
--     ON citizens(user_id). A plain unique index permits multiple NULL
--     user_id rows (Postgres semantics), so staff-created rows
--     (user_id NULL, see management.ts/app.ts) are unaffected.
--
-- Foreign-key survey (proved from the schema, not assumed):
--   * citizens.user_id is NULLABLE (001_initial.sql:25 — no NOT NULL, and
--     no later migration makes it NOT NULL). NULL-user_id rows exist by
--     design (staff-created rows) and are EXCLUDED from the cleanup.
--   * Tables referencing citizens(tenant_id, id), all with NO ON DELETE
--     action (default NO ACTION — deleting a referenced row raises a
--     foreign-key violation, so repoint-before-delete is mandatory):
--       - applications.citizen_id  (001_initial.sql:45,50; NOT NULL)
--       - attachments.citizen_id   (001_initial.sql:121,123; nullable
--         since 030_point_recharge.sql:7, but CHECK
--         (purpose='citizen') = (citizen_id IS NOT NULL), so citizen
--         uploads always reference a row)
--       - print_requests.citizen_id (006_portal_tools.sql:14,18; NOT NULL)
--     No other table references citizens (grep REFERENCES citizens over
--     db/, apps/, packages/, scripts/ returns only these three).
--   * Reverse direction: citizens.identity_document_id references
--     attachments(tenant_id, citizen_id, id) (026:13). Deleting a citizen
--     row never violates that outgoing key, but the identity-document
--     attachment itself references the citizen, so it is covered by the
--     attachments repoint — AND the repoint order matters: the old row's
--     outgoing key must be CLEARED before its document attachment is
--     repointed, or the repoint violates the key (the attachment's
--     citizen_id would stop matching the old row while the old row
--     still points at it). The migration therefore captures the old
--     row's document, clears its link, repoints, then merges the
--     document onto the kept row (only when the kept row has none).
--     This ordering was found by the scratch verification (first run
--     failed on exactly this FK) and is covered by the att1 seed case.
--     If the kept row already has its own document, the old row's
--     document attachment is still repointed to the kept row (it stays
--     owned by that citizen) but the kept row keeps its own document.
--   * No DELETE-blocking trigger exists on citizens: the append-only
--     `immutable` triggers (001) cover credit_ledger,
--     application_payload_versions, application_events, audit_events,
--     payment_events, invoices and service_versions only.
--   * Trigger survey for the repoint UPDATEs (proved, not assumed):
--       - applications: `renewal_closed` fires only AFTER UPDATE OF
--         state, `application_order_origin` only on INSERT OR UPDATE OF
--         order_mode (004:34, 011:44) — a citizen_id repoint fires
--         neither. `application_order_required` is AFTER INSERT only.
--       - print_requests: an `immutable` trigger (BEFORE UPDATE OR
--         DELETE, 006_portal_tools.sql:32) — a citizen_id repoint MUST
--         disable it inside this migration's transaction and re-enable
--         it before commit, same precedent as above. (A grep survey
--         first missed it because the line was filtered out as
--         "CREATE TRIGGER immutable"; the authoritative check is
--         pg_trigger on a migrated database — print_requests,
--         applications and attachments trigger lists were all read
--         from the scratch DB after applying 001–058.)
--       - attachments: `attachment_content_guard` (015:68, BEFORE INSERT
--         OR UPDATE OR DELETE) raises 'Attachment content and identity
--         are immutable' on ANY identity-column change, so a citizen_id
--         repoint MUST disable it inside this migration's transaction
--         and re-enable it before commit — the exact precedent of
--         migrations 054/057/058, which disable the `immutable` trigger
--         on service_versions the same way. Only citizen_id changes;
--         the CHECK constraint attachment_content_integrity
--         (content_sha256 = digest(bytes), byte_length = octet_length)
--         is NOT a trigger and stays enforced throughout, and no
--         attachment row is deleted (the trigger also blocks DELETEs).
--         If anything raises after the disable, the transaction rolls
--         back and the trigger state is restored with it.
--   * Existing non-unique index citizens_tenant_user ON
--     citizens(tenant_id, user_id) (004_portal_management.sql:13) is
--     left in place.
--
-- Idempotent: a re-run finds no (tenant_id, user_id) group with >1 row
-- and no cross-tenant leftover, deletes 0 rows, and the index already
-- exists (IF NOT EXISTS). Atomic: the runner applies the file in one
-- transaction; any RAISE EXCEPTION rolls everything back.
--
-- Pre-flight (Md runs BEFORE this migration, via cPanel/phpPgAdmin):
--   SELECT user_id, count(*) AS row_count,
--          array_agg(id ORDER BY created_at DESC, id DESC)
--            AS row_ids_newest_first,
--          array_agg(full_name_en ORDER BY created_at DESC, id DESC)
--            AS names_en_newest_first,
--          array_agg(nid_hint ORDER BY created_at DESC, id DESC)
--            AS nid_hints_newest_first
--   FROM citizens WHERE user_id IS NOT NULL
--   GROUP BY user_id HAVING count(*) > 1 ORDER BY count(*) DESC, user_id;
--   SELECT count(*) AS null_user_rows FROM citizens WHERE user_id IS NULL;
-- A full production-wide count cannot be verified from the VM (no
-- production DB access); the pre-flight query is the step that produces
-- it. Known from live evidence before this migration: exactly one
-- affected account (the QA citizen account, two rows in belabo-up).

DO $$
DECLARE
  grp RECORD;
  old_id uuid;
  kept_id uuid;
  kept_has_doc boolean;
  doc_id uuid;
  doc_kind text;
  n_apps int;
  n_atts int;
  n_prints int;
  ref_count int;
  deleted_rows int := 0;
  repointed_apps int := 0;
  repointed_atts int := 0;
  repointed_prints int := 0;
  cross_deleted int := 0;
BEGIN
  -- The attachments identity guard (015) blocks ANY citizen_id change,
  -- and the print_requests `immutable` trigger (006) blocks ANY update;
  -- disable both for this transaction only (054/057/058 precedent) and
  -- re-enable them before commit. A rollback restores them automatically.
  EXECUTE 'ALTER TABLE attachments DISABLE TRIGGER attachment_content_guard';
  EXECUTE 'ALTER TABLE print_requests DISABLE TRIGGER immutable';

  -- Phase 1: per-(tenant, user) dedupe with repoint-before-delete.
  FOR grp IN
    SELECT tenant_id, user_id,
           array_agg(id ORDER BY created_at DESC, id DESC) AS ids
    FROM citizens
    WHERE user_id IS NOT NULL
    GROUP BY tenant_id, user_id
    HAVING count(*) > 1
  LOOP
    kept_id := grp.ids[1];

    -- Repoint + delete each older row, newest first.
    FOR i IN 2..array_length(grp.ids, 1) LOOP
      old_id := grp.ids[i];

      -- Capture the old row's identity document, then CLEAR its link
      -- first: the outgoing key citizens(tenant_id, id,
      -- identity_document_id) REFERENCES attachments(tenant_id,
      -- citizen_id, id) would block the attachment repoint below while
      -- the old row still points at its document. The old row is
      -- deleted below, so clearing loses nothing; the document is
      -- merged onto the kept row after the repoint.
      SELECT identity_document_id, identity_document_kind
        INTO doc_id, doc_kind
        FROM citizens WHERE id = old_id;
      IF doc_id IS NOT NULL THEN
        UPDATE citizens
           SET identity_document_id = NULL,
               identity_document_kind = NULL
         WHERE id = old_id;
      END IF;

      UPDATE applications
         SET citizen_id = kept_id
       WHERE tenant_id = grp.tenant_id AND citizen_id = old_id;
      GET DIAGNOSTICS n_apps = ROW_COUNT;

      UPDATE attachments
         SET citizen_id = kept_id
       WHERE tenant_id = grp.tenant_id AND citizen_id = old_id;
      GET DIAGNOSTICS n_atts = ROW_COUNT;

      UPDATE print_requests
         SET citizen_id = kept_id
       WHERE tenant_id = grp.tenant_id AND citizen_id = old_id;
      GET DIAGNOSTICS n_prints = ROW_COUNT;

      -- Merge the captured identity document onto the kept row when
      -- the kept row has none. The attachment was just repointed, so
      -- the citizens->attachments key now holds.
      SELECT identity_document_id IS NOT NULL INTO kept_has_doc
        FROM citizens WHERE id = kept_id;
      IF NOT kept_has_doc AND doc_id IS NOT NULL THEN
        UPDATE citizens
           SET identity_document_id = doc_id,
               identity_document_kind = doc_kind
         WHERE id = kept_id;
      END IF;

      DELETE FROM citizens
       WHERE id = old_id AND tenant_id = grp.tenant_id;

      deleted_rows := deleted_rows + 1;
      repointed_apps := repointed_apps + n_apps;
      repointed_atts := repointed_atts + n_atts;
      repointed_prints := repointed_prints + n_prints;
      RAISE NOTICE 'Migration 062 dedupe: user_id % tenant_id % deleted citizen % kept % (applications repointed %, attachments repointed %, print_requests repointed %).',
        grp.user_id, grp.tenant_id, old_id, kept_id, n_apps, n_atts, n_prints;
    END LOOP;
  END LOOP;

  -- Phase 2: cross-tenant leftovers for one user_id. Keep the globally
  -- newest row; delete an older row in another office only when nothing
  -- in its own office references it, else fail loudly and roll back.
  FOR grp IN
    SELECT user_id,
           array_agg(id ORDER BY created_at DESC, id DESC) AS ids,
           array_agg(tenant_id ORDER BY created_at DESC, id DESC) AS tenants
    FROM citizens
    WHERE user_id IS NOT NULL
    GROUP BY user_id
    HAVING count(DISTINCT tenant_id) > 1
  LOOP
    kept_id := grp.ids[1];
    FOR i IN 2..array_length(grp.ids, 1) LOOP
      old_id := grp.ids[i];
      SELECT
        (SELECT count(*) FROM applications
          WHERE tenant_id = grp.tenants[i] AND citizen_id = old_id)
        + (SELECT count(*) FROM attachments
          WHERE tenant_id = grp.tenants[i] AND citizen_id = old_id)
        + (SELECT count(*) FROM print_requests
          WHERE tenant_id = grp.tenants[i] AND citizen_id = old_id)
        INTO ref_count;
      IF ref_count > 0 THEN
        RAISE EXCEPTION 'Migration 062 unresolvable cross-office duplicate: user_id % has citizen % in tenant % with % referencing row(s); the kept row % lives in another office and composite foreign keys (tenant_id, citizen_id) cannot be repointed across offices. Resolve this account by hand, then re-run.',
          grp.user_id, old_id, grp.tenants[i], ref_count, kept_id;
      END IF;
      DELETE FROM citizens
       WHERE id = old_id AND tenant_id = grp.tenants[i];
      cross_deleted := cross_deleted + 1;
      RAISE NOTICE 'Migration 062 cross-office dedupe: user_id % tenant_id % deleted unreferenced citizen % kept % (other office).',
        grp.user_id, grp.tenants[i], old_id, kept_id;
    END LOOP;
  END LOOP;

  EXECUTE 'ALTER TABLE attachments ENABLE TRIGGER attachment_content_guard';
  EXECUTE 'ALTER TABLE print_requests ENABLE TRIGGER immutable';

  RAISE NOTICE 'Migration 062 dedupe: % duplicate row(s) deleted (% cross-office unreferenced), % application(s), % attachment(s) and % print request(s) repointed to kept rows.',
    deleted_rows + cross_deleted, cross_deleted, repointed_apps, repointed_atts, repointed_prints;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS citizens_user_id_unique ON citizens(user_id);
