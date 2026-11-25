/** Test-isolation reset for T-003.
 *
 * The API and browser suites share one seeded database. The seed creates
 * NO order policies (scripts/seed.ts), so every row in
 * service_order_policies is state a previous test file created — most
 * notably the zero-fee alpha/42 policy published by
 * apps/api/test/certificate-assets.test.ts. A later suite that assumes
 * "no policy" (e.g. the expanded-browser trade-renewal test, which
 * creates a service-42 application without order preferences) then fails
 * with 409 ORDER_REQUIRED.
 *
 * This reset deletes test-created rows from that table before the
 * browser suite runs, restoring the seeded assumption where possible.
 * It is deliberately narrow (one table, no application/citizen/tenant
 * data).
 *
 * Two guards make it safe:
 * - It refuses to run unless NODE_ENV=test and the database is loopback,
 *   so it can never touch a hosted database.
 * - service_order_policies is append-only (a BEFORE UPDATE OR DELETE
 *   trigger raises 'Append-only record'), so the DELETE runs with that
 *   trigger disabled inside one transaction that re-enables it before
 *   commit — a failure rolls the disable back with the transaction.
 *   The trigger is never left disabled.
 * - Order snapshots reference policies (application_order_snapshots has
 *   a foreign key on tenant/service/policy_version), so only policies
 *   with no referencing snapshot are removed. A policy already used by
 *   an application survives the reset — tests that create applications
 *   must read the current policy instead of assuming none exists (the
 *   expanded-browser renewal test does this; see T-003).
 * It is idempotent.
 */
import pg from "pg";

export async function resetTestOrderPolicies(
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  if (env.NODE_ENV !== "test") {
    throw new Error(
      "TEST_RESET_REFUSED: resetTestOrderPolicies runs only with NODE_ENV=test.",
    );
  }
  const connectionString = env.DATABASE_ADMIN_URL || env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "TEST_RESET_REFUSED: DATABASE_ADMIN_URL (or DATABASE_URL) is required.",
    );
  }
  const host = new URL(connectionString).hostname;
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(
      `TEST_RESET_REFUSED: refusing to reset policies on non-loopback database host ${host}.`,
    );
  }
  const db = new pg.Pool({ connectionString, max: 1 });
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    try {
      await client.query(
        "ALTER TABLE service_order_policies DISABLE TRIGGER immutable",
      );
      const result = await client.query(
        `DELETE FROM service_order_policies p
         WHERE NOT EXISTS (
           SELECT 1 FROM application_order_snapshots s
           WHERE s.tenant_id = p.tenant_id
             AND s.service_no = p.service_no
             AND s.policy_version = p.version
         )`,
      );
      await client.query(
        "ALTER TABLE service_order_policies ENABLE TRIGGER immutable",
      );
      await client.query("COMMIT");
      return result.rowCount ?? 0;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
    await db.end();
  }
}
