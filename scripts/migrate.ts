import fs from "node:fs";
import path from "node:path";
import pg from "pg";
const local = fs.existsSync(".runtime/postgres.json")
  ? JSON.parse(fs.readFileSync(".runtime/postgres.json", "utf8"))
  : {};
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_ADMIN_URL ?? local.adminUrl,
});
const db = await pool.connect();
try {
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const name of fs
    .readdirSync("db/migrations")
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    if (
      (await db.query("SELECT 1 FROM schema_migrations WHERE name=$1", [name]))
        .rowCount
    )
      continue;
    await db.query("BEGIN");
    try {
      await db.query(fs.readFileSync(path.join("db/migrations", name), "utf8"));
      await db.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
      await db.query("COMMIT");
      console.log(`Applied ${name}`);
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    }
  }
} finally {
  db.release();
  await pool.end();
}
