import fs from 'node:fs';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import pg from 'pg';
const local=JSON.parse(fs.readFileSync('.runtime/postgres.json','utf8'));
const url=new URL(local.adminUrl);
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55432');
const database=`astra_release_${Date.now()}_${randomBytes(3).toString('hex')}`;
assert.match(database,/^astra_release_[a-z0-9_]+$/);
const control=new pg.Pool({connectionString:url.toString()});
await control.query(`CREATE DATABASE ${database} OWNER astra_admin ENCODING 'UTF8'`);await control.end();url.pathname='/'+database;
const appUrl=new URL(local.appUrl);appUrl.pathname='/'+database;
const env={...process.env,DATABASE_ADMIN_URL:url.toString(),DATABASE_URL:appUrl.toString(),OWNER_EMAIL:'initial-owner@example.test',OWNER_PASSWORD:randomBytes(32).toString('hex')};
const lines=[`Isolated deployment initialization test; ${new Date().toISOString()}`,`Database: ${database}`];
for(const script of ['scripts/migrate.ts','scripts/initialize.ts','scripts/initialize.ts']){
  const result=spawnSync(process.execPath,['--import','tsx',script],{env,encoding:'utf8',timeout:30000,windowsHide:true});
  lines.push(script,result.stdout,result.stderr);assert.equal(result.status,0,`${script} failed`);
}
const db=new pg.Pool({connectionString:url.toString()});
try{
  const c=(await db.query("SELECT (SELECT count(*) FROM platform_users)::int users,(SELECT count(*) FROM tenants)::int tenants,(SELECT count(*) FROM citizens)::int citizens,(SELECT count(*) FROM service_catalog)::int services")).rows[0];
  assert.deepEqual(c,{users:1,tenants:0,citizens:0,services:47});
  const owner=(await db.query('SELECT platform_role,password_hash FROM platform_users')).rows[0];assert.equal(owner.platform_role,'owner');assert.ok(!owner.password_hash.includes(env.OWNER_PASSWORD));
  lines.push('PASS: idempotent initialization creates exactly1 owner,47 services,0 sample users/citizens/tenants. Password hash only; no credentials printed.');
}finally{await db.end();}
fs.writeFileSync('execution/deployment-bootstrap.log',lines.join('\n'));console.log(lines.at(-1));
