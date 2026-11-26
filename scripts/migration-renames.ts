/**
 * R-001 (Phase 4 / upstream integration): migration renumbering map.
 *
 * Upstream (18d85af) and the Phase 4 remediation line (64eec25) both added
 * migrations numbered 059–064 with DIFFERENT content. The integration keeps
 * upstream 059–064 unchanged and moves the Phase 4 line 059–075 to 065–081
 * (same files, same content, same relative order).
 *
 * schema_migrations keys applied migrations by FILE NAME, so a database that
 * already applied a Phase 4 migration under its old name (any Phase 4 test
 * database, or a deployment of the Stage 1 cPanel bundle, which shipped
 * 059_mobile_verification.sql and 060_release_read_schema_migrations.sql)
 * would otherwise run it a second time under the new name.
 *
 * reconcileRenamedMigrations() records the new name, carrying over the
 * original applied_at, for every old name that is already recorded — the
 * SQL is not re-run. The old rows are kept: migration history is never
 * deleted or rewritten. Upstream migrations the database has not applied
 * yet are then applied by the normal loop.
 */
export const LEGACY_MIGRATION_RENAMES: ReadonlyArray<readonly [string, string]> = [
  ["059_mobile_verification.sql", "065_mobile_verification.sql"],
  ["060_release_read_schema_migrations.sql", "066_release_read_schema_migrations.sql"],
  ["061_shared_rate_limit_buckets.sql", "067_shared_rate_limit_buckets.sql"],
  ["062_order_language_bilingual.sql", "068_order_language_bilingual.sql"],
  ["063_application_creation_keys.sql", "069_application_creation_keys.sql"],
  ["064_reset_citizen_fee_payer.sql", "070_reset_citizen_fee_payer.sql"],
  ["065_payment_attempt_superseded.sql", "071_payment_attempt_superseded.sql"],
  ["066_notification_deliveries.sql", "072_notification_deliveries.sql"],
  ["067_sign_in_security_event.sql", "073_sign_in_security_event.sql"],
  ["068_owner_statistics.sql", "074_owner_statistics.sql"],
  ["069_support_contact_clear.sql", "075_support_contact_clear.sql"],
  ["070_stage3_workflows.sql", "076_stage3_workflows.sql"],
  ["071_service_summaries.sql", "077_service_summaries.sql"],
  ["072_session_hygiene.sql", "078_session_hygiene.sql"],
  ["073_platform_security_events.sql", "079_platform_security_events.sql"],
  ["074_public_data_purge_delete.sql", "080_public_data_purge_delete.sql"],
  ["075_stage5_db_indexes_fk_owner_batching.sql", "081_stage5_db_indexes_fk_owner_batching.sql"],
];

type Queryable = {
  query: (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null; rows: any[] }>;
};

/** Returns the new names that were recorded (empty on a clean or already-reconciled DB). */
export async function reconcileRenamedMigrations(db: Queryable): Promise<string[]> {
  const recorded: string[] = [];
  for (const [oldName, newName] of LEGACY_MIGRATION_RENAMES) {
    const r = await db.query(
      "INSERT INTO schema_migrations(name, applied_at) SELECT $2, applied_at FROM schema_migrations WHERE name=$1 ON CONFLICT (name) DO NOTHING",
      [oldName, newName],
    );
    if (r.rowCount) recorded.push(newName);
  }
  return recorded;
}
