import test, {before, after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import pg from "pg";
import fs from "node:fs";
import {app} from "../src/app.js";
import {pool,adminConnectionString} from "../src/db.js";
import {closePdfBrowser} from "../src/pdf.js";
let server:ReturnType<typeof app.listen>,base:string;
const admin=new pg.Pool({connectionString:adminConnectionString});
const sessions:Record<string,{cookie:string;csrf:string;user:any}>={};
let citizen:any;
async function req(method:string,path:string,data?:unknown,role?:string){
  const s=role?sessions[role]:undefined;
  const r=await fetch(`${base}/api/v1${path}`,{method,headers:{...(data!==undefined?{"Content-Type":"application/json"}:{}),...(s?{Cookie:s.cookie,"X-CSRF-Token":s.csrf}:{})},body:data===undefined?undefined:JSON.stringify(data)});
  return {status:r.status,headers:r.headers,body:r.headers.get("content-type")?.includes("application/json")?await r.json():Buffer.from(await r.arrayBuffer())};
}
before(async()=>{
  server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));base=`http://127.0.0.1:${(server.address() as any).port}`;
  for(const role of ["citizen","staff","finance","owner","beta"]){
    const email=role==="owner"?"owner@astra.demo.test":role==="beta"?"staff@beta.demo.test":`${role}@alpha.demo.test`;
    const r=await req("POST","/auth/login",{email,password:"Demo-Phase1!"});assert.equal(r.status,200,JSON.stringify(r.body));
    sessions[role]={cookie:r.headers.get("set-cookie")!.split(";")[0],csrf:r.body.csrfToken,user:r.body.user};
  }
  citizen=(await req("GET","/citizens",undefined,"citizen")).body.items[0];assert.ok(citizen);
});
after(async()=>{await closePdfBrowser();await new Promise<void>(r=>server.close(()=>r()));await pool.end();await admin.end();});

test("Portal: feedback persists, only owner resolves, subscribe is idempotent and never claims email delivery",async()=>{
  const email=`feedback-${randomUUID()}@example.test`;
  const r=await req("POST","/public/feedback",{name:"Synthetic support request",email,subject:"Demonstration issue",message:"Please review this synthetic demonstration request."});
  assert.equal(r.status,201);assert.equal(r.body.delivery,"SAVED_IN_PLATFORM");
  assert.equal((await req("GET","/owner/feedback",undefined,"staff")).status,403);
  const inbox=await req("GET","/owner/feedback?status=OPEN",undefined,"owner");assert.ok(inbox.body.items.some((x:any)=>x.id===r.body.id));
  assert.equal((await req("PATCH",`/owner/feedback/${r.body.id}`,{status:"RESOLVED"},"owner")).status,200);
  const row=(await admin.query("SELECT status,resolved_by FROM support_requests WHERE id=$1",[r.body.id])).rows[0];assert.equal(row.status,"RESOLVED");assert.equal(row.resolved_by,sessions.owner.user.id);
  for(let i=0;i<2;i++){const subscribed=await req("POST","/public/subscribe",{email});assert.equal(subscribed.status,202);assert.match(subscribed.body.message,/not configured/);}
  assert.equal((await admin.query("SELECT count(*)::int n FROM subscriptions_interest WHERE email=$1",[email])).rows[0].n,1);
});

test("Portal: self profile edits persist, reject privilege fields and record audit without logging profile values",async()=>{
  const original=(await req("GET","/profile",undefined,"citizen")).body;
  const fields={displayName:"Synthetic profile test",nameBn:"পরীক্ষামূলক নাম",phone:"01000000000",address:"Demo profile address"};
  try{
    assert.equal((await req("PATCH","/profile",{...fields,role:"owner"},"citizen")).status,422);
    assert.equal((await req("PATCH","/profile",fields,"citizen")).status,200);
    const updated=(await req("GET","/profile",undefined,"citizen")).body;assert.equal(updated.displayName,fields.displayName);assert.equal(updated.role,"citizen");
    const partial=await req("PATCH","/profile",{displayName:"Synthetic renamed profile"},"citizen");assert.equal(partial.status,200);
    for(const field of ["nameBn","phone","address"] as const)assert.equal(partial.body[field],fields[field],`Omitted ${field} must be preserved`);
    const cleared=await req("PATCH","/profile",{displayName:fields.displayName,phone:"",address:""},"citizen");assert.equal(cleared.status,200);assert.equal(cleared.body.phone,"");assert.equal(cleared.body.address,"");assert.equal(cleared.body.nameBn,fields.nameBn);
    const audit=(await admin.query("SELECT metadata FROM audit_events WHERE actor_id=$1 AND action='PROFILE_UPDATED' ORDER BY created_at DESC LIMIT 1",[sessions.citizen.user.id])).rows[0];assert.ok(audit);assert.ok(!JSON.stringify(audit.metadata).includes(fields.address));
  }finally{await req("PATCH","/profile",{displayName:original.displayName,nameBn:original.nameBn,phone:original.phone,address:original.address},"citizen");}
});

test("Portal: biodata, holding and witness generate real private PDFs; repeat request spends no credit and creates no duplicate",{timeout:60000},async()=>{
  const before=(await admin.query("SELECT balance FROM tenant_wallets WHERE tenant_id=$1",[sessions.citizen.user.tenantId])).rows[0].balance;
  for(const kind of ["biodata","holding","witness"]){
    const body:any={kind,citizenId:citizen.id,language:"bilingual",requestKey:randomUUID()};
    if(kind==="holding")body.holding={number:"DEMO-H-100",ownerBn:"ডেমো মালিক",ownerEn:"Demo owner",addressBn:"ডেমো গ্রামের ঠিকানা",addressEn:"Demo holding address",annualValueMinor:123456};
    if(kind==="witness")body.witness={deceasedNameBn:"ডেমো মৃত ব্যক্তি",deceasedNameEn:"Demo deceased",witnessNameBn:"ডেমো সাক্ষী",witnessNameEn:"Demo witness",statement:"Synthetic statement only <script>throw new Error('bad')</script>"};
    const r=await req("POST","/print-requests",body,"citizen");assert.equal(r.status,201,JSON.stringify(r.body));assert.equal(r.body.status,"READY");
    const repeat=await req("POST","/print-requests",body,"citizen");assert.equal(repeat.status,200);assert.equal(repeat.body.id,r.body.id);
    const pdf=await req("GET",`/print-requests/${r.body.id}/pdf`,undefined,"citizen");assert.equal(pdf.status,200);assert.equal(pdf.body.subarray(0,4).toString(),"%PDF");assert.ok(pdf.body.length>10000);
    fs.mkdirSync("execution",{recursive:true});fs.writeFileSync(`execution/${kind}-copy-demo.pdf`,pdf.body);
    assert.equal((await req("GET",`/print-requests/${r.body.id}/pdf`,undefined,"beta")).status,404);
    assert.equal((await req("GET",`/print-requests/${r.body.id}/pdf`,undefined,"owner")).status,403);
    assert.equal((await req("GET",`/print-requests/${r.body.id}/pdf`,undefined,"finance")).status,403);
    assert.equal((await req("POST","/print-requests",{...body,language:"en"},"citizen")).status,409);
    const saved=(await admin.query("SELECT count(*)::int n FROM print_requests WHERE tenant_id=$1 AND request_key=$2",[sessions.citizen.user.tenantId,body.requestKey])).rows[0].n;assert.equal(saved,1);
  }
  const after=(await admin.query("SELECT balance FROM tenant_wallets WHERE tenant_id=$1",[sessions.citizen.user.tenantId])).rows[0].balance;
  assert.equal(after,before,"Informational copies are not certificate issuance and have no invented statutory fee");
});

test("Portal: print lookup is read-only, filters survive pagination, malformed and cross-tenant inputs denied",async()=>{
  const counts=async()=>(await admin.query("SELECT count(*)::int n FROM print_requests")).rows[0].n;
  const before=await counts();
  for(const page of [1,2]){const r=await req("GET",`/print-requests?kind=holding&page=${page}`,undefined,"citizen");assert.equal(r.status,200);assert.ok(r.body.items.every((x:any)=>x.kind==="holding"));assert.equal(r.body.page,page);}
  assert.equal(await counts(),before);
  assert.equal((await req("POST","/print-requests",{kind:"holding",citizenId:citizen.id,language:"en"},"staff")).status,422);
  assert.equal((await req("POST","/print-requests",{kind:"biodata",citizenId:citizen.id,language:"en"},"beta")).status,404);
  assert.equal((await req("POST","/print-requests",{kind:"biodata",citizenId:citizen.id,language:"en",tenantId:sessions.beta.user.tenantId},"citizen")).status,422);
});

test("Portal: finance reports have actual tenant ledger, safe CSV and PDF exports with date validation",{timeout:30000},async()=>{
  const report=await req("GET","/reports",undefined,"finance");assert.equal(report.status,200);assert.equal(report.body.governmentFees,"NOT_CONFIGURED");
  const rows=(await admin.query("SELECT count(*)::int n FROM credit_ledger WHERE tenant_id=$1",[sessions.finance.user.tenantId])).rows[0].n;assert.equal(report.body.ledger.length,rows);
  const csv=await req("GET","/reports?format=csv",undefined,"finance");assert.equal(csv.status,200);assert.match(csv.body.toString(),/balance_after/);assert.ok(!csv.body.toString().includes(citizen.nameEn));
  const pdf=await req("GET","/reports?format=pdf",undefined,"finance");assert.equal(pdf.status,200);assert.equal(pdf.body.subarray(0,4).toString(),"%PDF");fs.writeFileSync("execution/credit-report-demo.pdf",pdf.body);
  assert.equal((await req("GET","/reports?from=2026-02-30",undefined,"finance")).status,422);
  assert.equal((await req("GET","/reports?from=2026-10-13&to=2026-10-01",undefined,"finance")).status,422);
  assert.equal((await req("GET","/reports",undefined,"citizen")).status,403);
  assert.equal((await req("GET","/reports",undefined,"owner")).status,403);
});

test("Portal: in-app notifications obey tenant/applicant scope and idempotent read acknowledgements",async()=>{
  assert.equal((await req("GET","/notifications",undefined,"owner")).status,403);
  const alpha=await req("GET","/notifications",undefined,"citizen");assert.equal(alpha.status,200);assert.equal(alpha.body.channel,"IN_APP");
  const beta=await req("GET","/notifications",undefined,"beta");assert.ok(!beta.body.items.some((b:any)=>alpha.body.items.some((a:any)=>a.id===b.id)));
  if(alpha.body.items.length){
    const event=alpha.body.items[0];
    assert.equal((await req("POST",`/notifications/${event.id}/read`,{},"beta")).status,404);
    for(let i=0;i<2;i++)assert.equal((await req("POST",`/notifications/${event.id}/read`,{},"citizen")).status,200);
    assert.equal((await admin.query("SELECT count(*)::int n FROM notification_receipts WHERE event_id=$1 AND user_id=$2",[event.id,sessions.citizen.user.id])).rows[0].n,1);
  }
  assert.equal((await req("POST",`/notifications/${randomUUID()}/read`,{},"citizen")).status,404);
});

test("Portal: report date boundaries are UTC regardless of PostgreSQL server timezone",async()=>{
  const times=['2009-12-31T23:59:59Z','2010-01-01T00:00:00Z','2010-01-01T23:59:59Z','2010-01-02T00:00:00Z'];
  const inserted:string[]=[];
  for(const at of times){
    const r=await admin.query("INSERT INTO credit_ledger(tenant_id,delta,kind,idempotency_key,actor_id,reason,balance_after,created_at) VALUES($1,1,'ADJUSTMENT',$2,$3,'Synthetic UTC boundary fixture',0,$4::timestamptz) RETURNING id",[sessions.finance.user.tenantId,randomUUID(),sessions.owner.user.id,at]);inserted.push(r.rows[0].id);
  }
  const r=await req('GET','/reports?from=2010-01-01&to=2010-01-01',undefined,'finance');assert.equal(r.status,200);
  const ids=r.body.ledger.map((x:any)=>x.id);assert.ok(ids.includes(inserted[1]));assert.ok(ids.includes(inserted[2]));assert.ok(!ids.includes(inserted[0]));assert.ok(!ids.includes(inserted[3]));
});

test("Portal: public tracking returns only minimal submitted status; drafts and missing IDs stay private",async()=>{
  const submitted=(await admin.query("SELECT id,state FROM applications WHERE state<>'DRAFT' AND tenant_id=$1 ORDER BY created_at DESC LIMIT 1",[sessions.citizen.user.tenantId])).rows[0];
  assert.ok(submitted,'The workflow integration suite must create a submitted certificate application.');
  const r=await req('GET',`/track/${submitted.id}`);assert.equal(r.status,200);assert.equal(r.body.status,submitted.state);
  assert.deepEqual(Object.keys(r.body).sort(),['status','officeBn','officeEn','serviceNo','serviceBn','serviceEn','createdAt','demo'].sort());
  for(const value of [randomUUID(),'not-an-id'])assert.equal((await req('GET',`/track/${value}`)).status,404);
  const draft=(await admin.query("SELECT id FROM applications WHERE state='DRAFT' AND tenant_id=$1 LIMIT 1",[sessions.citizen.user.tenantId])).rows[0];
  if(draft)assert.equal((await req('GET',`/track/${draft.id}`)).status,404);
});

test("Portal: sandbox invoice PDF is real, tenant-private and separate from statutory receipts",{timeout:30000},async()=>{
  const order=await req('POST','/billing/orders',{kind:'topup',credits:1},'finance');assert.equal(order.status,201,JSON.stringify(order.body));
  const settled=await req('POST',`/billing/orders/${order.body.id}/demo-settle`,{},'finance');assert.equal(settled.status,200,JSON.stringify(settled.body));
  const invoice=(await admin.query('SELECT id FROM invoices WHERE order_id=$1',[order.body.id])).rows[0];assert.ok(invoice);
  const r=await req('GET',`/invoices/${invoice.id}/pdf`,undefined,'finance');assert.equal(r.status,200);assert.equal(r.body.subarray(0,4).toString(),'%PDF');fs.writeFileSync('execution/sandbox-invoice-demo.pdf',r.body);
  for(const role of ['citizen','owner'])assert.equal((await req('GET',`/invoices/${invoice.id}/pdf`,undefined,role)).status,403);
});
