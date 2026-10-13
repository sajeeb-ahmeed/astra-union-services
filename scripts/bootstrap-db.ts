import pg from 'pg';
const connectionString=process.env.DATABASE_ADMIN_URL;
const password=process.env.ASTRA_APP_PASSWORD;
if(!connectionString||!password||password.length<24)throw Error('Provide DATABASE_ADMIN_URL and a unique ASTRA_APP_PASSWORD of at least 24 characters.');
const db=new pg.Pool({connectionString});
try{
  const existing=(await db.query("SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname='astra_app'")).rows[0];
  if(!existing){
    const statement=(await db.query("SELECT format('CREATE ROLE astra_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L',$1::text) sql",[password])).rows[0].sql;
    await db.query(statement);console.log('Restricted astra_app database role created. Password omitted.');
  }else if(existing.rolsuper||existing.rolbypassrls||existing.rolcreatedb||existing.rolcreaterole)throw Error('Existing astra_app is privileged. Correct role privileges before starting.');
  else console.log('Existing restricted astra_app role preserved; password unchanged.');
}finally{await db.end();}
