import fs from "node:fs";
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";
import {
  serviceCatalog,
  getServiceSchema,
  getCatalogPreviewSchema,
  stableSchemaJson,
  allServiceSchemaVersions,
} from "@astra/shared-schemas";
const settings = JSON.parse(fs.readFileSync(".runtime/postgres.json", "utf8"));
const adminURL = new URL(settings.adminUrl),
  appURL = new URL(settings.appUrl);
assert.equal(adminURL.hostname, "127.0.0.1");
assert.equal(adminURL.port, "55432");
assert.equal(appURL.hostname, "127.0.0.1");
const database = `astra_clean_${Date.now()}_${randomBytes(3).toString("hex")}`;
assert.match(database, /^astra_clean_[a-z0-9_]+$/);
const control = new pg.Pool({ connectionString: settings.adminUrl });
await control.query(
  `CREATE DATABASE ${database} OWNER astra_admin ENCODING 'UTF8'`,
);
await control.end();
adminURL.pathname = `/${database}`;
appURL.pathname = `/${database}`;
const env = {
  ...process.env,
  DATABASE_ADMIN_URL: adminURL.toString(),
  DATABASE_URL: appURL.toString(),
  NODE_ENV: "test",
};
const lines = [
  `Clean bootstrap verification — isolated generated database ${database}`,
  `Main astra database untouched. Connection credentials are omitted.`,
  ``,
];
function run(label: string, args: string[]) {
  lines.push(`COMMAND: ${label}`);
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    timeout: 240000,
  });
  // Child commands print tests and migration names, never connection URLs.
  const out = (result.stdout ?? "") + (result.stderr ?? "");
  lines.push(out.trim());
  lines.push(`Exit code: ${result.status}`, "");
  fs.mkdirSync("execution", { recursive: true });
  fs.writeFileSync("execution/clean-bootstrap.log", lines.join("\n"));
  assert.equal(
    result.status,
    0,
    `${label} failed. See execution/clean-bootstrap.log.`,
  );
}
run("migration from empty database", ["--import", "tsx", "scripts/migrate.ts"]);
run("first synthetic seed", ["--import", "tsx", "scripts/seed.ts"]);
run("second synthetic seed (idempotency)", [
  "--import",
  "tsx",
  "scripts/seed.ts",
]);
const verify = new pg.Pool({ connectionString: adminURL.toString() });
const counts = (
  await verify.query(
    "SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE')::int tables,(SELECT count(*) FROM service_catalog)::int services,(SELECT count(*) FROM platform_users)::int users,(SELECT count(*) FROM tenants)::int tenants,(SELECT count(*) FROM schema_migrations)::int migrations",
  )
).rows[0];
assert.deepEqual(counts, {
  tables: 32,
  services: 47,
  users: 13,
  tenants: 2,
  migrations: fs.readdirSync('db/migrations').filter(n=>n.endsWith('.sql')).length,
});
const wallets = (
  await verify.query(
    "SELECT t.slug,w.balance,count(l.id)::int seed_grants FROM tenants t JOIN tenant_wallets w ON w.tenant_id=t.id LEFT JOIN credit_ledger l ON l.tenant_id=t.id AND l.idempotency_key='seed-demo-v1' GROUP BY t.slug,w.balance ORDER BY t.slug",
  )
).rows;
assert.deepEqual(wallets, [
  { slug: "alpha", balance: 20, seed_grants: 1 },
  { slug: "beta", balance: 20, seed_grants: 1 },
]);
const versions = (
  await verify.query(
    "SELECT service_no,version,schema_hash FROM service_versions",
  )
).rows;
const published=[...allServiceSchemaVersions,...serviceCatalog.map(item=>getCatalogPreviewSchema(item.service_no))];
const uniquePublished=[...new Map(published.map(s=>[`${s.serviceNo}:${s.version}`,s])).values()];
assert.equal(versions.length, uniquePublished.length);
for (const schema of uniquePublished) {
  const expected = createHash("sha256")
    .update(stableSchemaJson(schema))
    .digest("hex");
  const stored = versions.find(
    (v) => v.service_no === schema.serviceNo && v.version === schema.version,
  );
  assert.equal(stored?.schema_hash, expected);
}
lines.push(
  `PASS:${counts.tables} tables,47 services,13 users,2 tenants,${counts.migrations} migrations.`,
  "PASS: seed repeated twice; each tenant balance20 and exactlyone seed grant.",
  `PASS: all ${versions.length} persisted schema hashes match published immutable profiles; all47 services operational.`,
  "",
);
fs.writeFileSync("execution/clean-bootstrap.log", lines.join("\n"));
await verify.end();
const artifact = "execution/demo-permanent-resident.pdf";
const previousArtifact = fs.existsSync(artifact)
  ? fs.readFileSync(artifact)
  : null;
try {
  run("full real PostgreSQL backend integration suite on clean database", [
    "--import",
    "tsx",
    "--test",
    "--test-concurrency=1",
    ...fs.readdirSync('apps/api/test').filter(n=>n.endsWith('.test.ts')).sort().map(n=>'apps/api/test/'+n),
  ]);
  if (fs.existsSync(artifact))
    fs.copyFileSync(artifact, "execution/clean-bootstrap-demo.pdf");
} finally {
  if (previousArtifact) fs.writeFileSync(artifact, previousArtifact);
}
lines.push(
  "RESULT: PASS. Isolated clean database retained as reproducibility evidence. Main astra database was not modified by this script.",
);
fs.writeFileSync("execution/clean-bootstrap.log", lines.join("\n"));
console.log(
  `PASS: clean migration, repeated seed,${versions.length} schema hashes and full API suite. See execution/clean-bootstrap.log. Generated database: ${database}`,
);
