import pg from 'pg';
import {createHash} from 'node:crypto';
import {serviceCatalog,allServiceSchemaVersions,getCatalogPreviewSchema,stableSchemaJson} from '@astra/shared-schemas';
import {hashPassword} from '../apps/api/src/security.js';
const connectionString=process.env.DATABASE_ADMIN_URL,email=process.env.OWNER_EMAIL,password=process.env.OWNER_PASSWORD;
if(!connectionString||!email||!/^\S+@\S+\.\S+$/.test(email)||!password||password.length<16||password==='Demo-Phase1!')throw Error('Provide administrator DB URL, OWNER_EMAIL and a unique OWNER_PASSWORD of at least 16 characters.');
const db=new pg.Pool({connectionString});const client=await db.connect();
try{
  await client.query('BEGIN');
  for(const service of serviceCatalog){
    await client.query("INSERT INTO service_catalog(service_no,name_bn,name_en,category,readiness,reference_evidence) VALUES($1,$2,$3,$4,'operational_demo',$5) ON CONFLICT(service_no) DO UPDATE SET readiness='operational_demo'",[service.service_no,service.name_bn,service.name_en,service.category_en,service.evidence_file]);
    for(const schema of [getCatalogPreviewSchema(service.service_no),...allServiceSchemaVersions.filter(s=>s.serviceNo===service.service_no)]){
      const json=stableSchemaJson(schema),hash=createHash('sha256').update(json).digest('hex');
      const stored=(await client.query('SELECT schema_hash FROM service_versions WHERE service_no=$1 AND version=$2',[schema.serviceNo,schema.version])).rows[0];
      if(stored&&stored.schema_hash!==hash)throw Error(`Service ${schema.serviceNo} version ${schema.version} is immutable; publish a new schema version.`);
      await client.query('INSERT INTO service_versions(service_no,version,schema_json,schema_hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[schema.serviceNo,schema.version,json,hash]);
    }
  }
  await client.query("INSERT INTO subscription_plans(id,name,price_minor,currency,grant_credits,duration_days,rollover) VALUES('demo-monthly','Engineering demo plan — no commercial price',0,'BDT',20,30,true) ON CONFLICT DO NOTHING");
  const existing=(await client.query('SELECT platform_role FROM platform_users WHERE email=$1',[email.toLowerCase()])).rows[0];
  if(existing&&existing.platform_role!=='owner')throw Error('This email already belongs to another role. No privilege escalation performed.');
  await client.query("INSERT INTO platform_users(email,display_name,password_hash,platform_role) VALUES($1,'Platform owner',$2,'owner') ON CONFLICT DO NOTHING",[email.toLowerCase(),hashPassword(password)]);
  await client.query('COMMIT');console.log('Published catalog and demo plan initialized; owner account available. Existing passwords preserved. No sample tenant/citizen accounts created.');
}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();await db.end();}
