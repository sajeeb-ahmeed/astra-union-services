/**
 * cPanel single-role migration runner.
 *
 * Applies the canonical migrations in db/migrations/ WITHOUT editing them
 * (merged migrations are immutable). Because shared cPanel PostgreSQL
 * provisions exactly one database user, the canonical two-role text cannot
 * run verbatim: the migrations shape a restricted runtime role `astra_app`
 * with GRANT/REVOKE and refuse to run as that role. This runner applies a
 * small, documented, in-memory transform to each migration before
 * executing it:
 *
 *   1. Role substitution — every `astra_app` identifier that remains after
 *      rules 2–3 (GRANT targets, 'astra_app' literals in role checks and
 *      format() strings) is replaced with the actual single username. RLS
 *      policies never name a role; they are tenant-setting based and are
 *      unchanged, as are ENABLE/FORCE ROW LEVEL SECURITY, the immutable
 *      triggers and the SECURITY DEFINER functions.
 *   2. Separation-guard neutralisation — migrations 009, 012, 029, 030 and
 *      037 contain a guard of the form
 *        IF current_user = 'astra_app' OR pg_has_role('astra_app', ...) THEN
 *          RAISE EXCEPTION '... must not be or inherit the migration owner';
 *      In single-role mode the migration owner IS the runtime role by
 *      design, so the guard's condition is rewritten to FALSE (the RAISE
 *      statement itself is left in place, unreachable).
 *   3. Runtime-role REVOKE neutralisation — every REVOKE whose target list
 *      includes astra_app is rewritten to drop astra_app from the list
 *      (FROM PUBLIC, astra_app → FROM PUBLIC), and a REVOKE targeting
 *      astra_app alone is replaced with a comment. Rationale: these
 *      statements shape the restricted runtime role, the layer the owner
 *      approved dropping for cPanel. Against the single user — who is the
 *      table owner — they are not a real boundary (an owner can re-grant
 *      itself any privilege at any time), but they DO break the migration
 *      process itself: a PostgreSQL owner that revokes its own privileges
 *      genuinely loses them, and later statements then fail (the migrator
 *      loses INSERT on schema_migrations in 001, INSERT on the geo tables
 *      before the dataset import in 010, REFERENCES for the foreign keys
 *      in 012, TRIGGER after the revocation loop in 012, and so on).
 *      REVOKEs against PUBLIC alone are preserved: they are meaningful in
 *      both modes, and the paired GRANTs restore the intended access.
 *
 * Everything else matches scripts/migrate.ts: same file order, one
 * transaction per file, the geography dataset import after migration 010,
 * and schema_migrations records the CANONICAL file names, so a database
 * migrated this way has identical bookkeeping to a two-role one. Every
 * transform count is logged per file.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { importGeographyDataset } from "./geography-data.js";

if (process.env.ASTRA_DB_SINGLE_ROLE !== "1")
  throw Error(
    "migrate-cpanel is only for single-role cPanel deployments: set ASTRA_DB_SINGLE_ROLE=1.",
  );
const connectionString = process.env.DATABASE_ADMIN_URL;
if (!connectionString)
  throw Error("Provide DATABASE_ADMIN_URL naming the one cPanel database user.");

const GUARD_PATTERN =
  /current_user\s*=\s*'astra_app'\s+OR\s+pg_has_role\(\s*'astra_app'\s*,\s*current_user\s*,\s*'MEMBER'\s*\)(\s*THEN\s+RAISE EXCEPTION)/g;
const REVOKE_LIST_PATTERN = /FROM PUBLIC,\s*astra_app/g;
const REVOKE_SOLE_PATTERN = /REVOKE [^;]*? FROM astra_app;/g;

export function transformMigration(
  sql: string,
  singleUser: string,
): {
  sql: string;
  guardsNeutralised: number;
  roleSubstitutions: number;
  revokesNeutralised: number;
} {
  let guardsNeutralised = 0;
  const withoutGuards = sql.replace(GUARD_PATTERN, (_m, raisePart: string) => {
    guardsNeutralised += 1;
    return `FALSE${raisePart}`;
  });
  let revokesNeutralised = 0;
  const withoutListRevokes = withoutGuards.replace(REVOKE_LIST_PATTERN, () => {
    revokesNeutralised += 1;
    return "FROM PUBLIC";
  });
  const withoutRevokes = withoutListRevokes.replace(REVOKE_SOLE_PATTERN, () => {
    revokesNeutralised += 1;
    return `-- [single-role transform] REVOKE against the runtime role skipped: in single-role mode it would revoke the migration owner's own privileges (see scripts/migrate-cpanel.ts).`;
  });
  const roleSubstitutions = (withoutRevokes.match(/astra_app/g) ?? []).length;
  const transformed = withoutRevokes.replace(/astra_app/g, singleUser);
  return { sql: transformed, guardsNeutralised, roleSubstitutions, revokesNeutralised };
}

const pool = new pg.Pool({ connectionString });
const db = await pool.connect();
try {
  const { rows } = await db.query("SELECT current_user AS user");
  const singleUser: string = rows[0].user;
  if (!/^[a-zA-Z0-9_]+$/.test(singleUser))
    throw Error(`Database username "${singleUser}" is not a plain PostgreSQL identifier; refusing to substitute it into migrations.`);
  console.log(`Single-role migration run as "${singleUser}".`);
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())",
  );
  let totalGuards = 0;
  let totalSubs = 0;
  let totalRevokes = 0;
  for (const name of fs
    .readdirSync("db/migrations")
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    if (
      (await db.query("SELECT 1 FROM schema_migrations WHERE name=$1", [name]))
        .rowCount
    )
      continue;
    const raw = fs.readFileSync(path.join("db/migrations", name), "utf8");
    const { sql, guardsNeutralised, roleSubstitutions, revokesNeutralised } =
      transformMigration(raw, singleUser);
    totalGuards += guardsNeutralised;
    totalSubs += roleSubstitutions;
    totalRevokes += revokesNeutralised;
    await db.query("BEGIN");
    try {
      await db.query(sql);
      if (name === "010_bangladesh_geography.sql")
        await importGeographyDataset(db);
      await db.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
      await db.query("COMMIT");
      console.log(
        `Applied ${name}` +
          (guardsNeutralised || roleSubstitutions || revokesNeutralised
            ? ` (transform: ${guardsNeutralised} separation guard(s) neutralised, ${roleSubstitutions} role substitution(s), ${revokesNeutralised} runtime-role revoke(s) neutralised)`
            : ""),
      );
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    }
  }
  console.log(
    `Single-role migrations complete. Totals: ${totalGuards} separation guard(s) neutralised, ${totalSubs} role substitution(s), ${totalRevokes} runtime-role revoke(s) neutralised.`,
  );
} finally {
  db.release();
  await pool.end();
}
