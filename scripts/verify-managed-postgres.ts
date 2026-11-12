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

  const geographyCounts = (await app.query("SELECT (SELECT count(*) FROM geo_divisions)::int divisions,(SELECT count(*) FROM geo_districts)::int districts,(SELECT count(*) FROM geo_upazilas)::int upazilas,(SELECT count(*) FROM geo_unions)::int unions,(SELECT count(*) FROM geo_wards)::int wards")).rows[0];
  assert.deepEqual(geographyCounts,{divisions:8,districts:64,upazilas:495,unions:4586,wards:41274});
  await assert.rejects(app.query("UPDATE geo_divisions SET name_en='Forbidden' WHERE code='div-01'"),(e:any)=>e.code==='42501');
  checks.push('All 46,427 geography records import under the managed owner; runtime role can read but cannot mutate reference geography.');

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
  const gatewayApplicationA = randomUUID(), gatewayIntentA = randomUUID();
  const callbackDigest = 'a'.repeat(64);
  const gatewayTables = ['gateway_token_cache', 'gateway_payment_intents', 'gateway_payment_events', 'gateway_payment_confirmations', 'gateway_payment_receipts', 'gateway_payment_reconciliations'];
  const gatewayHistoryTables = ['gateway_payment_events', 'gateway_payment_confirmations', 'gateway_payment_receipts', 'gateway_payment_reconciliations'];
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
      await client.query("INSERT INTO gateway_token_cache(tenant_id,credential_fingerprint) VALUES($1,'synthetic-managed-fixture')", [tenantId]);
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
      "INSERT INTO certificates(id,tenant_id,application_id,number,service_no,token_hash,pdf,issued_by) VALUES($1,$2,$3,$4,45,'managed-certificate-digest',$5,$6)",
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
    await fixture.query("INSERT INTO staff_memberships(tenant_id,user_id,role) VALUES($1,$2,'staff')", [tenantA, userId]);
    await fixture.query('INSERT INTO tenant_service_configuration(tenant_id,service_no,credit_cost) VALUES($1,45,1)', [tenantA]);
    await fixture.query(`INSERT INTO service_order_policies(tenant_id,service_no,version,statutory_fee_minor,processing_fee_minor,emergency_surcharge_minor,office_collection_fee_minor,digital_copy_fee_minor,delivery_modes,urgencies,reason,created_by)
      VALUES($1,45,1,200,50,0,0,0,ARRAY['office_collection'],ARRAY['normal'],'Synthetic managed gateway fixture',$2)`, [tenantA, userId]);
    await fixture.query(`INSERT INTO applications(id,tenant_id,citizen_id,service_no,schema_version,schema_hash,state,created_by,approved_by,approved_version,order_mode)
      VALUES($1,$2,$3,45,1,$4,'APPROVED',$5,$5,1,'POLICY')`, [gatewayApplicationA, tenantA, citizenA, schema.schema_hash, userId]);
    await fixture.query(`INSERT INTO application_order_snapshots(tenant_id,application_id,service_no,policy_version,address_basis,certificate_language,delivery_mode,urgency,statutory_fee_minor,processing_fee_minor,emergency_surcharge_minor,delivery_fee_minor,total_minor,currency)
      VALUES($1,$2,45,1,'registered_profile','en','office_collection','normal',200,50,0,0,250,'BDT')`, [tenantA, gatewayApplicationA]);
    await fixture.query("SELECT set_config('astra.actor_id',$1,true)", [userId]);
    await fixture.query(`INSERT INTO gateway_payment_intents(tenant_id,id,application_id,provider,environment,merchant_account,invoice,amount_minor,currency,created_by,request_key,request_hash,callback_hash,status)
      VALUES($1,$2,$3,'BKASH','SANDBOX','01700000000',$4,250,'BDT',$5,$6,$7,$8,'CREATE_PENDING')`,
      [tenantA, gatewayIntentA, gatewayApplicationA, `MANAGED-${gatewayIntentA}`, userId, randomUUID(), 'b'.repeat(64), callbackDigest]);
    await fixture.query('COMMIT');
  } catch (error) { await fixture.query('ROLLBACK'); throw error; }
  finally { fixture.release(); }

  for (const table of ['certificates', 'applications', 'notices', 'password_recovery_tokens', 'citizens', 'service_order_policies', 'application_order_snapshots', ...gatewayTables]) {
    assert.equal((await app.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n, 0);
    assert.equal((await owner.query(
      'SELECT relrowsecurity AND relforcerowsecurity enabled FROM pg_class WHERE oid=$1::regclass', [table],
    )).rows[0].enabled, true);
  }
  checks.push('Unscoped astra_app direct reads return zero rows; FORCE RLS remains enabled.');
  for (const table of ['service_order_policies', 'application_order_snapshots']) {
    const permissions = (await app.query(
      `SELECT has_table_privilege(current_user,$1,'SELECT') can_select,
              has_table_privilege(current_user,$1,'INSERT') can_insert,
              has_table_privilege(current_user,$1,'UPDATE') can_update,
              has_table_privilege(current_user,$1,'DELETE') can_delete`, [table],
    )).rows[0];
    assert.deepEqual(permissions, {can_select:true,can_insert:true,can_update:false,can_delete:false});
  }
  checks.push('Order policies and snapshots retain forced RLS and append-only runtime grants on managed PostgreSQL.');
  for (const table of gatewayTables) {
    const permissions = (await app.query(`SELECT has_table_privilege(current_user,$1,'SELECT') can_select,
      has_table_privilege(current_user,$1,'INSERT') can_insert,has_table_privilege(current_user,$1,'UPDATE') can_update,
      has_table_privilege(current_user,$1,'DELETE') can_delete`, [table])).rows[0];
    assert.deepEqual(permissions, {can_select:true,can_insert:true,can_update:table==='gateway_token_cache',can_delete:false});
  }
  const operationalColumns = ['status','payment_id','checkout_url','callback_signature','execute_started_at','updated_at','last_error'];
  const gatewayColumns = (await app.query(`SELECT a.attname name,has_column_privilege(current_user,a.attrelid,a.attnum,'UPDATE') can_update
    FROM pg_attribute a WHERE a.attrelid='gateway_payment_intents'::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`)).rows;
  for (const column of gatewayColumns) assert.equal(column.can_update, operationalColumns.includes(column.name), `Unexpected gateway UPDATE privilege: ${column.name}`);
  const immutableTriggers = (await owner.query(`SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    WHERE c.relname=ANY($1::text[]) AND NOT t.tgisinternal AND t.tgenabled='O'
      AND t.tgfoid='immutable_record()'::regprocedure AND (t.tgtype::int & 27)=27 ORDER BY c.relname`, [gatewayHistoryTables])).rows;
  assert.deepEqual(immutableTriggers.map(r=>r.relname), [...gatewayHistoryTables].sort());
  checks.push('All six gateway tables force tenant RLS; four history tables are append-only, token cache updates are scoped, and intent UPDATE grants cover only seven operational columns.');

  const callbackPolicy = (await owner.query("SELECT tablename,roles::text[] roles,cmd,qual FROM pg_policies WHERE policyname='callback_owner_read'")).rows;
  assert.deepEqual(callbackPolicy, [{tablename:'gateway_payment_intents',roles:[migrationRole],cmd:'SELECT',qual:'true'}]);
  const callbackFunction = (await owner.query(`SELECT p.prosecdef,p.proconfig,pg_get_function_result(p.oid) result,
    has_function_privilege('astra_app',p.oid,'EXECUTE') app_execute,
    EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') public_execute
    FROM pg_proc p WHERE p.oid='resolve_gateway_callback(text)'::regprocedure`)).rows[0];
  assert.deepEqual(callbackFunction, {prosecdef:true,proconfig:['search_path=public, pg_temp'],result:'TABLE(tenant_id uuid, intent_id uuid)',app_execute:true,public_execute:false});
  assert.deepEqual((await app.query('SELECT * FROM resolve_gateway_callback($1)', [callbackDigest])).rows, [{tenant_id:tenantA,intent_id:gatewayIntentA}]);
  for (const invalid of ['', 'a'.repeat(63), 'a'.repeat(65), 'c'.repeat(64)])
    assert.deepEqual((await app.query('SELECT * FROM resolve_gateway_callback($1)', [invalid])).rows, []);
  checks.push('The callback SECURITY DEFINER has a fixed search path and app-only execution; its owner-only SELECT policy resolves a matching opaque digest to exactly two IDs and hides invalid digests.');
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
    assert.equal((await request.query('SELECT count(*)::int n FROM applications WHERE tenant_id=$1', [tenantA])).rows[0].n, 3);
    assert.equal((await request.query('SELECT count(*)::int n FROM gateway_payment_intents')).rows[0].n, 1);
    assert.equal((await request.query('SELECT count(*)::int n FROM gateway_token_cache')).rows[0].n, 1);
    for (const table of gatewayTables)
      assert.equal((await request.query(`SELECT count(*)::int n FROM ${table} WHERE tenant_id=$1`, [tenantB])).rows[0].n, 0);
    await request.query('SAVEPOINT denied_cross_tenant_write');
    await assert.rejects(request.query(
      "INSERT INTO notices(tenant_id,title_bn,title_en,body_bn,body_en,created_by) VALUES($1,'পরীক্ষা','Denied fixture','পরীক্ষা','Synthetic',$2)",
      [tenantB, userId],
    ), { code: '42501' });
    await request.query('ROLLBACK TO SAVEPOINT denied_cross_tenant_write');
    await request.query('RELEASE SAVEPOINT denied_cross_tenant_write');
    await request.query('SAVEPOINT denied_gateway_write');
    await assert.rejects(request.query("INSERT INTO gateway_token_cache(tenant_id,credential_fingerprint) VALUES($1,'forbidden-cross-office')", [tenantB]), {code:'42501'});
    await request.query('ROLLBACK TO SAVEPOINT denied_gateway_write');
    await assert.rejects(request.query("UPDATE gateway_payment_intents SET invoice='forbidden-reprice' WHERE id=$1", [gatewayIntentA]), {code:'42501'});
    await request.query('ROLLBACK TO SAVEPOINT denied_gateway_write');
    assert.equal((await request.query("UPDATE gateway_payment_intents SET last_error='MANAGED_PROBE' WHERE id=$1 RETURNING last_error", [gatewayIntentA])).rows[0].last_error, 'MANAGED_PROBE');
    await request.query('ROLLBACK TO SAVEPOINT denied_gateway_write');
    await request.query('RELEASE SAVEPOINT denied_gateway_write');
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
  checks.push('Scoped gateway reads hide the other office token row; cross-office token inserts and immutable invoice updates fail, while a permitted operational status field can be updated.');
  evidence.status = 'PASS';
  evidence.migrations = (await owner.query('SELECT count(*)::int n FROM schema_migrations')).rows[0].n;
  fs.mkdirSync('execution', { recursive: true });
  fs.writeFileSync('execution/managed-postgres-qa.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(`PASS: ${checks.length} managed PostgreSQL compatibility checks; isolated database ${database}. No credentials printed.`);
} finally {
  await Promise.all([owner.end(), app.end()]);
}
