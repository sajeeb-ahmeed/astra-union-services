/**
 * cPanel single-role bootstrap.
 *
 * The standard deployment uses two PostgreSQL roles: a migration owner and
 * the restricted runtime role `astra_app` (created by scripts/bootstrap-db.ts,
 * which needs CREATEROLE). Shared cPanel PostgreSQL cannot create extra
 * roles: the control panel provisions exactly one database user. This
 * bootstrap is the single-role counterpart used with ASTRA_DB_SINGLE_ROLE=1:
 *
 *   - It NEVER creates or alters any role.
 *   - DATABASE_URL and DATABASE_ADMIN_URL must both name the SAME single
 *     user (the cPanel database user); the script refuses to run otherwise.
 *   - It verifies that user can connect and work in the target database.
 *
 * Row Level Security is unchanged: migrations keep ENABLE/FORCE RLS and the
 * tenant_scope policies. What is dropped in this mode is only the
 * privilege separation between migration owner and runtime role (the owner
 * approved this trade-off for cPanel hosting; see docs/DEPLOY-CPANEL.md).
 */
import pg from "pg";

if (process.env.ASTRA_DB_SINGLE_ROLE !== "1")
  throw Error(
    "bootstrap-cpanel is only for single-role cPanel deployments: set ASTRA_DB_SINGLE_ROLE=1.",
  );
const runtimeUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!runtimeUrl || !adminUrl)
  throw Error("Provide DATABASE_URL and DATABASE_ADMIN_URL (both naming the one cPanel database user).");

function urlUser(raw: string): string {
  return decodeURIComponent(new URL(raw).username);
}
const runtimeUser = urlUser(runtimeUrl);
const adminUser = urlUser(adminUrl);
if (runtimeUser !== adminUser)
  throw Error(
    `Single-role mode requires DATABASE_URL and DATABASE_ADMIN_URL to name the same user (got "${runtimeUser}" vs "${adminUser}").`,
  );
if (!/^[a-zA-Z0-9_]+$/.test(runtimeUser))
  throw Error(`Database username "${runtimeUser}" is not a plain PostgreSQL identifier; refusing to continue.`);

const db = new pg.Pool({ connectionString: adminUrl });
try {
  const { rows } = await db.query(
    "SELECT current_user AS user, current_database() AS database, " +
      "(SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_super, " +
      "(SELECT rolcreaterole FROM pg_roles WHERE rolname = current_user) AS can_create_role",
  );
  const info = rows[0];
  // The single user owns (or fully controls) its cPanel database, so CONNECT
  // is implicit; issuing the grant documents intent and proves write access
  // to the ACL. It is a no-op when the user is the database owner.
  await db.query(
    `GRANT CONNECT ON DATABASE "${info.database.replace(/"/g, '""')}" TO "${runtimeUser}"`,
  );
  console.log(
    `Single-role bootstrap OK: user "${info.user}" on database "${info.database}" ` +
      `(superuser=${info.is_super}, createrole=${info.can_create_role}). No roles created or altered.`,
  );
} finally {
  await db.end();
}
