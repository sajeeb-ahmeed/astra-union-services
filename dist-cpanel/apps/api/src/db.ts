import pg from "pg";
// DATE is a calendar value, not an instant. Preserve YYYY-MM-DD across host timezones.
pg.types.setTypeParser(1082, (value: string) => value);
import fs from "node:fs";
import path from "node:path";
const localFile = path.resolve(".runtime/postgres.json");
const local = fs.existsSync(localFile)
  ? JSON.parse(fs.readFileSync(localFile, "utf8"))
  : {};
export const connectionString = process.env.DATABASE_URL ?? local.appUrl;
export const adminConnectionString =
  process.env.DATABASE_ADMIN_URL ?? local.adminUrl;
if (!connectionString)
  throw new Error(
    "DATABASE_URL or .runtime/postgres.json required. Run runtime setup.",
  );
export const pool = new pg.Pool({ connectionString, max: 20 });
export type DB = pg.PoolClient;
export async function transaction<T>(
  tenantId: string,
  fn: (db: DB) => Promise<T>,
  serializable = false,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const db = await pool.connect();
    try {
      await db.query(
        serializable ? "BEGIN ISOLATION LEVEL SERIALIZABLE" : "BEGIN",
      );
      await db.query("SELECT set_config('astra.tenant_id',$1,true)", [
        tenantId,
      ]);
      const result = await fn(db);
      await db.query("COMMIT");
      return result;
    } catch (error: any) {
      await db.query("ROLLBACK");
      if (
        serializable &&
        ["40001", "40P01"].includes(error.code) &&
        attempt < 5
      ) {
        await new Promise((r) => setTimeout(r, 20 * (attempt + 1)));
        continue;
      }
      throw error;
    } finally {
      db.release();
    }
  }
}
export async function audit(
  db: DB,
  tenantId: string,
  actorId: string,
  action: string,
  resourceId: string | null,
  metadata: object = {},
) {
  await db.query(
    "INSERT INTO audit_events(tenant_id,actor_id,action,resource_id,metadata) VALUES($1,$2,$3,$4,$5)",
    [tenantId, actorId, action, resourceId, JSON.stringify(metadata)],
  );
}
