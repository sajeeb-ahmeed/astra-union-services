import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

// This regression creates only new local roles/database. It never changes the
// existing application's role, database, memberships, or tenant records.
const local = JSON.parse(fs.readFileSync('.runtime/postgres.json', 'utf8'));
const adminUrl = new URL(local.adminUrl);
assert.equal(adminUrl.hostname, '127.0.0.1');
assert.equal(adminUrl.port, '55432');
const suffix = `${Date.now()}_${randomBytes(3).toString('hex')}`;
const database = `astra_managed_${suffix}`;
const migrationRole = `astra_migrator_${suffix}`;
const probeRole = `astra_probe_${suffix}`;
const rolePassword = randomBytes(32).toString('hex');
for (const identifier of [database, migrationRole, probeRole])
  assert.match(identifier, /^astra_[a-z0-9_]+$/);
const evidence: Record<string, unknown> = {
  executedAt: new Date().toISOString(), database, migrationRole,
  checks: [] as string[],
};
const checks = evidence.checks as string[];
const control = new pg.Pool({ connectionString: adminUrl.toString() });
const roleSql = (await control.query(
  "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB CREATEROLE PASSWORD %L',$1::text,$2::text) sql",
  [migrationRole, rolePassword],
)).rows[0].sql;
await control.query(roleSql);
await control.query(`CREATE DATABASE ${database} OWNER ${migrationRole} ENCODING 'UTF8'`);
await control.end();

const ownerUrl = new URL(adminUrl);
ownerUrl.username = migrationRole;
ownerUrl.password = rolePassword;
ownerUrl.pathname = `/${database}`;
const appUrl = new URL(local.appUrl);
appUrl.pathname = `/${database}`;
const environment = {
  ...process.env,
  DATABASE_ADMIN_URL: ownerUrl.toString(),
  DATABASE_URL: appUrl.toString(),
  ASTRA_APP_PASSWORD: randomBytes(32).toString('hex'),
  OWNER_EMAIL: 'managed-rls-owner@example.test',
  OWNER_PASSWORD: randomBytes(32).toString('hex'),
};
const owner = new pg.Pool({ connectionString: ownerUrl.toString() });
const app = new pg.Pool({ connectionString: appUrl.toString() });
try {
  const flags = (await owner.query(
    'SELECT rolsuper,rolbypassrls,rolcreaterole FROM pg_roles WHERE rolname=current_user',
  )).rows[0];
  assert.deepEqual(flags, { rolsuper: false, rolbypassrls: false, rolcreaterole: true });
  checks.push('Migration owner is NOSUPERUSER NOBYPASSRLS with CREATEROLE.');

  // Match bootstrap-db.ts's CREATE ROLE options without modifying astra_app.
  const probeSql = (await owner.query(
    "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L',$1::text,$2::text) sql",
    [probeRole, randomBytes(32).toString('hex')],
  )).rows[0].sql;
  await owner.query(probeSql);
  const probe = (await owner.query(
    'SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=$1', [probeRole],
  )).rows[0];
  assert.deepEqual(probe, { rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false });
  checks.push('A non-superuser migration owner can create the restricted application-role shape.');

  for (const script of ['scripts/bootstrap-db.ts', 'scripts/migrate.ts', 'scripts/initialize.ts']) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', script], {
      env: environment, encoding: 'utf8', timeout: 60_000, windowsHide: true,
    });
    // Avoid connection-string/error object output if a provider rejects setup.
    assert.equal(result.status, 0, `${script} failed; inspect the local isolated database without printing credentials.`);
    checks.push(`${script} completed under the restricted migration owner.`);
  }

  assert.equal((await owner.query(
    "SELECT pg_has_role('astra_app',current_user,'MEMBER') member",
  )).rows[0].member, false);
  const policies = (await owner.query(
    "SELECT tablename,roles::text[] roles,cmd,qual FROM pg_policies WHERE policyname='public_definer_owner_read' ORDER BY tablename",
  )).rows;
  assert.equal(policies.length, 4);
  for (const policy of policies) {
    assert.deepEqual(policy.roles, [migrationRole]);
    assert.equal(policy.cmd, 'SELECT');
    assert.equal(policy.qual, 'true');
  }
  checks.push('Exactly four SELECT policies name only the migration owner; astra_app has no membership.');
  const tenantA = randomUUID(), tenantB = randomUUID(), userId = randomUUID();
  const citizenA = randomUUID(), citizenB = randomUUID(), applicationA = randomUUID(), applicationB = randomUUID();
  const draftA = randomUUID(), certificateA = randomUUID(), noticeA = randomUUID();
  await owner.query(
    "INSERT INTO platform_users(id,email,display_name,password_hash) VALUES($1,'managed-fixture@example.test','Synthetic managed fixture','not-a-login-password')", [userId],
  );
  for (const [id, suffix] of [[tenantA, 'a'], [tenantB, 'b']]) {
    await owner.query(
      'INSERT INTO tenants(id,slug,name_bn,name_en) VALUES($1,$2,$3,$4)',
      [id, `managed-${suffix}-${database}`, 'পরীক্ষা কার্যালয়', `Managed fixture ${suffix}`],
    );
  }
  const schema = (await owner.query(
    'SELECT service_no,version,schema_hash FROM service_versions WHERE service_no=45 AND version=1',
  )).rows[0];
  for (const [tenantId, citizenId, applicationId] of [[tenantA, citizenA, applicationA], [tenantB, citizenB, applicationB]]) {
    const client = await owner.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('astra.tenant_id',$1,true)", [tenantId]);
      await client.query(
        "INSERT INTO citizens(id,tenant_id,full_name_bn,full_name_en,date_of_birth,address_bn,address_en,synthetic_reference) VALUES($1,$2,'পরীক্ষা নাগরিক','Synthetic citizen','2000-01-01','পরীক্ষা ঠিকানা','Synthetic address',$3)",
        [citizenId, tenantId, `managed-${tenantId}`],
      );
      await client.query(
        "INSERT INTO applications(id,tenant_id,citizen_id,service_no,schema_version,schema_hash,state,created_by) VALUES($1,$2,$3,$4,$5,$6,'SUBMITTED',$7)",
        [applicationId, tenantId, citizenId, schema.service_no, schema.version, schema.schema_hash, userId],
      );
      await client.query('INSERT INTO tenant_wallets(tenant_id) VALUES($1)', [tenantId]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  const fixture = await owner.connect();
  try {
    await fixture.query('BEGIN');
    await fixture.query("SELECT set_config('astra.tenant_id',$1,true)", [tenantA]);
    await fixture.query(
      "INSERT INTO applications(id,tenant_id,citizen_id,service_no,schema_version,schema_hash,created_by) VALUES($1,$2,$3,45,1,$4,$5)",
      [draftA, tenantA, citizenA, schema.schema_hash, userId],
    );
    await fixture.query(
      "INSERT INTO certificates(id,tenant_id,application_id,number,service_no,verification_token,token_hash,pdf,issued_by) VALUES($1,$2,$3,$4,45,'synthetic-verification-token','managed-certificate-digest',$5,$6)",
      [certificateA, tenantA, applicationA, `MANAGED-${certificateA}`, Buffer.from('%PDF-synthetic-rls-fixture'), userId],
    );
    await fixture.query(
      "INSERT INTO notices(id,tenant_id,title_bn,title_en,body_bn,body_en,published,created_by) VALUES($1,$2,'প্রকাশিত বিজ্ঞপ্তি','Published fixture','পরীক্ষা','Synthetic',true,$3),($4,$2,'অপ্রকাশিত বিজ্ঞপ্তি','Unpublished fixture','পরীক্ষা','Synthetic',false,$3)",
      [noticeA, tenantA, userId, randomUUID()],
    );
    await fixture.query(
      "INSERT INTO password_recovery_tokens(token_hash,tenant_id,user_id,created_by,expires_at) VALUES('managed-recovery-valid',$1,$2,$2,now()+interval '15 minutes'),('managed-recovery-expired',$1,$2,$2,now()-interval '1 minute')",
      [tenantA, userId],
    );
    await fixture.query('COMMIT');
  } catch (error) { await fixture.query('ROLLBACK'); throw error; }
  finally { fixture.release(); }

  for (const table of ['certificates', 'applications', 'notices', 'password_recovery_tokens', 'citizens']) {
    assert.equal((await app.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n, 0);
    assert.equal((await owner.query(
      'SELECT relrowsecurity AND relforcerowsecurity enabled FROM pg_class WHERE oid=$1::regclass', [table],
    )).rows[0].enabled, true);
  }
  checks.push('Unscoped astra_app direct reads return zero rows; FORCE RLS remains enabled.');
  assert.equal((await app.query("SELECT * FROM public_verify('managed-certificate-digest')")).rows.length, 1);
  assert.equal((await app.query("SELECT * FROM public_verify('invalid-digest')")).rows.length, 0);
  assert.equal((await app.query('SELECT * FROM public_track($1)', [applicationA])).rows.length, 1);
  assert.equal((await app.query('SELECT * FROM public_track($1)', [draftA])).rows.length, 0);
  assert.equal((await app.query('SELECT * FROM public_notices()')).rows.length, 1);
  assert.deepEqual((await app.query("SELECT * FROM locate_password_recovery('managed-recovery-valid')")).rows, [{ tenant_id: tenantA }]);
  assert.equal((await app.query("SELECT * FROM locate_password_recovery('managed-recovery-expired')")).rows.length, 0);
  checks.push('All four bounded public definer functions work; invalid token, draft, unpublished notice and expired recovery remain hidden.');

  const request = await app.connect();
  try {
    await request.query('BEGIN');
    await request.query("SELECT set_config('astra.tenant_id',$1,true)", [tenantA]);
    assert.equal((await request.query('SELECT count(*)::int n FROM applications WHERE tenant_id=$1', [tenantB])).rows[0].n, 0);
    assert.equal((await request.query('SELECT count(*)::int n FROM applications WHERE tenant_id=$1', [tenantA])).rows[0].n, 2);
    await request.query('SAVEPOINT denied_cross_tenant_write');
    await assert.rejects(request.query(
      "INSERT INTO notices(tenant_id,title_bn,title_en,body_bn,body_en,created_by) VALUES($1,'পরীক্ষা','Denied fixture','পরীক্ষা','Synthetic',$2)",
      [tenantB, userId],
    ), { code: '42501' });
    await request.query('ROLLBACK TO SAVEPOINT denied_cross_tenant_write');
    await request.query('RELEASE SAVEPOINT denied_cross_tenant_write');
    assert.equal((await request.query('SELECT balance FROM lock_tenant_wallet()')).rows[0].balance, 0);
    await request.query(
      "INSERT INTO credit_ledger(tenant_id,delta,kind,idempotency_key,actor_id,reason,balance_after) VALUES($1,3,'TOPUP','managed-ledger-check',$2,'Synthetic regression',0)",
      [tenantA, userId],
    );
    assert.equal((await request.query('SELECT balance FROM tenant_wallets')).rows[0].balance, 3);
    await request.query('COMMIT');
  } catch (error) { await request.query('ROLLBACK'); throw error; }
  finally { request.release(); }
  await assert.rejects(app.query('UPDATE tenant_wallets SET balance=999'), { code: '42501' });
  await assert.rejects(app.query(`SET ROLE ${migrationRole}`), { code: '42501' });
  checks.push('Cross-tenant reads and writes are denied; managed-owner ledger lock/trigger works; direct wallet updates and owner SET ROLE are denied.');
  evidence.status = 'PASS';
  evidence.migrations = (await owner.query('SELECT count(*)::int n FROM schema_migrations')).rows[0].n;
  fs.mkdirSync('execution', { recursive: true });
  fs.writeFileSync('execution/managed-postgres-qa.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(`PASS: ${checks.length} managed PostgreSQL compatibility checks; isolated database ${database}. No credentials printed.`);
} finally {
  await Promise.all([owner.end(), app.end()]);
}
