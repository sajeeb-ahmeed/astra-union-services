import express from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { Auth } from "./app.js";
import { pool, transaction, audit } from "./db.js";
import { camelRow, citizenRow, fail } from "./models.js";
import { digest } from "./security.js";
import { renderHtmlPdf } from "./pdf.js";

type Req = express.Request & { auth?: Auth };
const wrap = (fn: (req: Req, res: express.Response) => Promise<unknown>) => (req: Req, res: express.Response, next: express.NextFunction) => { Promise.resolve(fn(req, res)).catch(next); };
const identity = (req: Req) => req.auth ?? fail(401, "LOGIN_REQUIRED", "Sign in required.");
const scoped = (req: Req, roles?: string[]) => {
  const a = identity(req);
  if (!a.tenantId || (roles && !roles.includes(a.role))) fail(403, "ROLE_DENIED", "This action is not available to this role.");
  return a as Auth & { tenantId: string };
};
const text = (max: number, min = 1) => z.string().trim().min(min).max(max);
const id = z.string().uuid();
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const page = (title: string, body: string) => `<!doctype html><html lang="bn"><meta charset="utf-8"><style>@page{size:A4;margin:18mm}body{font:13px 'Nirmala UI','Noto Sans Bengali',Arial,sans-serif;color:#142b24;line-height:1.7}h1{font-size:23px;color:#075941}h2{font-size:17px}table{border-collapse:collapse;width:100%;table-layout:fixed}td,th{border:1px solid #cbd9d2;padding:8px;overflow-wrap:anywhere;text-align:left}tr{break-inside:avoid}.demo{border:2px solid #9d2424;padding:12px;color:#8c2222;font-weight:bold}.foot{margin-top:24px;color:#48564f}thead{display:table-header-group}</style><body><div class="demo">DEMO / NOT OFFICIAL · পরীক্ষামূলক — সরকারি নথি নয়</div><h1>${esc(title)}</h1>${body}<p class="foot">Astra · Independent demonstration copy. No official signature, seal or payment receipt.</p></body></html>`;
const rows = (values: [string, unknown][]) => `<table>${values.map(([k,v])=>`<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>`;

export const publicToolsRouter = express.Router();
publicToolsRouter.get("/track/:id",wrap(async(req,res)=>{
  const parsed=id.safeParse(req.params.id);
  if(!parsed.success)fail(404,"NOT_FOUND","Application status not found.");
  const r=(await pool.query("SELECT * FROM public_track($1)",[parsed.data])).rows[0];
  if(!r)fail(404,"NOT_FOUND","Application status not found.");
  res.json(camelRow(r));
}));
publicToolsRouter.post("/public/feedback", wrap(async (req,res) => {
  const d = z.object({name:text(120,2),email:z.string().email().max(150).optional(),subject:text(180,3),message:text(4000,10)}).strict().parse(req.body);
  const r = await pool.query("INSERT INTO support_requests(name,email,subject,message) VALUES($1,$2,$3,$4) RETURNING id,status,created_at",[d.name,d.email??null,d.subject,d.message]);
  res.status(201).json({...camelRow(r.rows[0]),delivery:"SAVED_IN_PLATFORM"});
}));
publicToolsRouter.post("/public/subscribe", wrap(async (req,res) => {
  const d = z.object({email:z.string().email().max(150)}).strict().parse(req.body);
  await pool.query("INSERT INTO subscriptions_interest(email) VALUES($1) ON CONFLICT DO NOTHING",[d.email.toLowerCase()]);
  res.status(202).json({status:"REQUESTED",message:"Your interest is saved. Email delivery is not configured in this demonstration."});
}));

export const protectedToolsRouter = express.Router();
protectedToolsRouter.get("/profile",wrap(async(req,res)=>{
  const a=identity(req);
  const r=await pool.query("SELECT id,email,display_name,name_bn,phone,address FROM platform_users WHERE id=$1",[a.userId]);
  res.json({...camelRow(r.rows[0]),role:a.role});
}));
protectedToolsRouter.patch("/profile",wrap(async(req,res)=>{
  const a=identity(req);
  const d=z.object({displayName:text(120,2),nameBn:text(120,0).optional(),phone:z.string().regex(/^(?:01\d{9})?$/).optional(),address:text(1000,0).optional()}).strict().parse(req.body);
  const save=async(db:Pick<typeof pool,'query'>)=>{
    const r=await db.query("UPDATE platform_users SET display_name=$1,name_bn=COALESCE($2,name_bn),phone=COALESCE($3,phone),address=COALESCE($4,address) WHERE id=$5 RETURNING id,email,display_name,name_bn,phone,address",[d.displayName,d.nameBn??null,d.phone??null,d.address??null,a.userId]);
    if(a.tenantId)await audit(db as any,a.tenantId,a.userId,"PROFILE_UPDATED",a.userId,{fields:Object.keys(d)});
    return camelRow(r.rows[0]);
  };
  res.json(a.tenantId?await transaction(a.tenantId,save):await save(pool));
}));

const holding=z.object({number:text(80),addressBn:text(1000,2),addressEn:text(1000,2),ownerBn:text(150,2),ownerEn:text(150,2),annualValueMinor:z.number().int().min(0).max(1_000_000_000)}).strict();
const witness=z.object({deceasedNameBn:text(150,2),deceasedNameEn:text(150,2),witnessNameBn:text(150,2),witnessNameEn:text(150,2),statement:text(2000,10)}).strict();
const printInput=z.object({kind:z.enum(["biodata","holding","witness"]),citizenId:id,language:z.enum(["bn","en","bilingual"]),requestKey:id.optional(),holding:holding.optional(),witness:witness.optional()}).strict().superRefine((v,ctx)=>{
  if(v.kind==="holding"&&!v.holding)ctx.addIssue({code:"custom",path:["holding"],message:"Holding information required."});
  if(v.kind!=="holding"&&v.holding)ctx.addIssue({code:"custom",path:["holding"],message:"Unexpected holding information."});
  if(v.kind==="witness"&&!v.witness)ctx.addIssue({code:"custom",path:["witness"],message:"Witness information required."});
  if(v.kind!=="witness"&&v.witness)ctx.addIssue({code:"custom",path:["witness"],message:"Unexpected witness information."});
});
const printSummary=(r:any)=>({...camelRow(r),status:"READY",demo:true,pdfUrl:`/api/v1/print-requests/${r.id}/pdf`});
protectedToolsRouter.get("/print-requests",wrap(async(req,res)=>{
  const a=scoped(req,["citizen","staff","admin"]);
  const d=z.object({kind:z.enum(["biodata","holding","witness"]).optional(),page:z.coerce.number().int().min(1).max(10000).default(1)}).strict().parse(req.query);
  const data=await transaction(a.tenantId,async(db)=>{
    const values=[a.tenantId,a.role==="citizen"?a.userId:null,d.kind??null];
    const filter="p.tenant_id=$1 AND ($2::uuid IS NULL OR c.user_id=$2) AND ($3::text IS NULL OR p.kind=$3)";
    const r=await db.query(`SELECT p.id,p.kind,p.language,p.citizen_id,p.created_at FROM print_requests p JOIN citizens c ON c.tenant_id=p.tenant_id AND c.id=p.citizen_id WHERE ${filter} ORDER BY p.created_at DESC,p.id LIMIT 20 OFFSET $4`,[...values,(d.page-1)*20]);
    const total=(await db.query(`SELECT count(*)::int n FROM print_requests p JOIN citizens c ON c.tenant_id=p.tenant_id AND c.id=p.citizen_id WHERE ${filter}`,values)).rows[0].n;
    return {items:r.rows.map(printSummary),page:d.page,pageSize:20,total};
  });res.json(data);
}));
protectedToolsRouter.post("/print-requests",wrap(async(req,res)=>{
  const a=scoped(req,["citizen","staff","admin"]),d=printInput.parse(req.body);
  const key=d.requestKey??randomUUID(),hash=digest(JSON.stringify({...d,requestKey:undefined}));
  const prepared=await transaction(a.tenantId,async(db)=>{
    const c=(await db.query("SELECT * FROM citizens WHERE id=$1 AND tenant_id=$2 AND ($3::uuid IS NULL OR user_id=$3)",[d.citizenId,a.tenantId,a.role==="citizen"?a.userId:null])).rows[0];
    if(!c)fail(404,"NOT_FOUND","Citizen not found.");
    const prior=(await db.query("SELECT id,kind,language,citizen_id,created_at,input_hash FROM print_requests WHERE tenant_id=$1 AND created_by=$2 AND request_key=$3",[a.tenantId,a.userId,key])).rows[0];
    if(prior&&prior.input_hash!==hash)fail(409,"IDEMPOTENCY_CONFLICT","This request key belongs to different print information.");
    return {citizen:citizenRow(c),prior};
  });
  if(prepared.prior){delete prepared.prior.input_hash;res.json(printSummary(prepared.prior));return;}
  const c=prepared.citizen!, language=d.language;
  const local=(bn:string,en:string)=>language==="bn"?bn:language==="en"?en:`${bn} / ${en}`;
  const title=local(d.kind==="biodata"?"নাগরিক তথ্যের কপি":d.kind==="holding"?"হোল্ডিং তথ্যের কপি":"সাক্ষীর বক্তব্য",d.kind==="biodata"?"Citizen biodata copy":d.kind==="holding"?"Holding information copy":"Witness statement");
  const content:[string,unknown][]=[[local("নাম","Name"),local(c.nameBn,c.nameEn)],[local("জন্ম তারিখ","Date of birth"),c.dateOfBirth],[local("ঠিকানা","Address"),local(c.addressBn,c.addressEn)],[local("পরীক্ষামূলক পরিচিতি","Synthetic reference"),c.syntheticReference]];
  if(d.holding)content.push([local("হোল্ডিং নম্বর","Holding number"),d.holding.number],[local("মালিক","Owner"),local(d.holding.ownerBn,d.holding.ownerEn)],[local("হোল্ডিং ঠিকানা","Holding address"),local(d.holding.addressBn,d.holding.addressEn)],[local("বার্ষিক মূল্য (টাকা)","Declared annual value (BDT)"),(d.holding.annualValueMinor/100).toFixed(2)]);
  if(d.witness)content.push([local("মৃত ব্যক্তির নাম","Deceased name"),local(d.witness.deceasedNameBn,d.witness.deceasedNameEn)],[local("সাক্ষীর নাম","Witness name"),local(d.witness.witnessNameBn,d.witness.witnessNameEn)],[local("বক্তব্য","Statement"),d.witness.statement]);
  const bytes=await renderHtmlPdf(page(title,rows(content)+"<p>Applicant-supplied demonstration information. No tax assessment, identity verification or legal attestation was performed.</p>"));
  const result=await transaction(a.tenantId,async(db)=>{
    const r=(await db.query("INSERT INTO print_requests(tenant_id,citizen_id,kind,language,request_key,input_hash,snapshot,pdf,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(tenant_id,created_by,request_key) DO NOTHING RETURNING id,kind,language,citizen_id,created_at",[a.tenantId,d.citizenId,d.kind,d.language,key,hash,JSON.stringify({citizen:c,holding:d.holding,witness:d.witness}),bytes,a.userId])).rows[0];
    if(r){await audit(db,a.tenantId,a.userId,"PRINT_COPY_CREATED",r.id,{kind:d.kind});return r;}
    const existing=(await db.query("SELECT id,kind,language,citizen_id,created_at,input_hash FROM print_requests WHERE tenant_id=$1 AND created_by=$2 AND request_key=$3",[a.tenantId,a.userId,key])).rows[0];
    if(existing.input_hash!==hash)fail(409,"IDEMPOTENCY_CONFLICT","This request key belongs to different print information.");delete existing.input_hash;return existing;
  },true);
  res.status(201).json(printSummary(result));
}));
protectedToolsRouter.get("/print-requests/:id/pdf",wrap(async(req,res)=>{
  const a=scoped(req,["citizen","staff","admin"]);
  const r=await transaction(a.tenantId,async(db)=>(await db.query("SELECT p.pdf FROM print_requests p JOIN citizens c ON c.id=p.citizen_id AND c.tenant_id=p.tenant_id WHERE p.id=$1 AND p.tenant_id=$2 AND ($3::uuid IS NULL OR c.user_id=$3)",[id.parse(req.params.id),a.tenantId,a.role==="citizen"?a.userId:null])).rows[0]);
  if(!r)fail(404,"NOT_FOUND","Print copy not found.");
  res.type("pdf").setHeader("Content-Disposition",'attachment; filename="astra-demo-copy.pdf"');res.send(r.pdf);
}));

protectedToolsRouter.get("/notifications",wrap(async(req,res)=>{
  const a=scoped(req);
  const r=await transaction(a.tenantId,async(db)=>(await db.query("SELECT e.id,e.kind,e.created_at,r.read_at,c.number certificate_number FROM outbox_events e JOIN certificates c ON c.id=e.resource_id AND c.tenant_id=e.tenant_id JOIN applications ap ON ap.id=c.application_id AND ap.tenant_id=c.tenant_id JOIN citizens ct ON ct.id=ap.citizen_id AND ct.tenant_id=ap.tenant_id LEFT JOIN notification_receipts r ON r.event_id=e.id AND r.tenant_id=e.tenant_id AND r.user_id=$2 WHERE e.tenant_id=$1 AND ($3::boolean=false OR ct.user_id=$2) ORDER BY e.created_at DESC LIMIT 100",[a.tenantId,a.userId,a.role==="citizen"])).rows);
  res.json({items:r.map(camelRow),channel:"IN_APP"});
}));
protectedToolsRouter.post("/notifications/:id/read",wrap(async(req,res)=>{
  const a=scoped(req),eventId=id.parse(req.params.id);
  await transaction(a.tenantId,async(db)=>{
    const allowed=(await db.query("SELECT e.id FROM outbox_events e JOIN certificates c ON c.id=e.resource_id AND c.tenant_id=e.tenant_id JOIN applications ap ON ap.id=c.application_id AND ap.tenant_id=c.tenant_id JOIN citizens ct ON ct.id=ap.citizen_id AND ct.tenant_id=ap.tenant_id WHERE e.id=$1 AND e.tenant_id=$2 AND ($3::boolean=false OR ct.user_id=$4)",[eventId,a.tenantId,a.role==="citizen",a.userId])).rowCount;
    if(!allowed)fail(404,"NOT_FOUND","Notification not found.");
    await db.query("INSERT INTO notification_receipts(tenant_id,event_id,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[a.tenantId,eventId,a.userId]);
  });res.json({ok:true});
}));

const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v);
protectedToolsRouter.get("/reports",wrap(async(req,res)=>{
  const a=scoped(req,["finance","admin"]);
  const d=z.object({from:date.optional(),to:date.optional(),format:z.enum(["json","csv","pdf"]).default("json")}).strict().refine(v=>!v.from||!v.to||v.from<=v.to,{message:"Invalid date interval"}).parse(req.query);
  const report=await transaction(a.tenantId,async(db)=>{
    const ledger=(await db.query("SELECT id,kind,delta,balance_after,created_at FROM credit_ledger WHERE tenant_id=$1 AND ($2::date IS NULL OR created_at>=($2::date::timestamp AT TIME ZONE 'UTC')) AND ($3::date IS NULL OR created_at<(($3::date+1)::timestamp AT TIME ZONE 'UTC')) ORDER BY created_at,id LIMIT 5001",[a.tenantId,d.from??null,d.to??null])).rows;
    if(ledger.length>5000)fail(422,"REPORT_TOO_LARGE","Choose a narrower date interval (maximum 5000 ledger rows).");
    const states=(await db.query("SELECT state,count(*)::int count FROM applications WHERE tenant_id=$1 AND ($2::date IS NULL OR created_at>=($2::date::timestamp AT TIME ZONE 'UTC')) AND ($3::date IS NULL OR created_at<(($3::date+1)::timestamp AT TIME ZONE 'UTC')) GROUP BY state ORDER BY state",[a.tenantId,d.from??null,d.to??null])).rows;
    const balance=(await db.query("SELECT balance FROM tenant_wallets WHERE tenant_id=$1",[a.tenantId])).rows[0]?.balance??0;
    return {ledger:ledger.map(camelRow),states,balance,from:d.from??null,to:d.to??null,demo:true,governmentFees:"NOT_CONFIGURED",currency:"BDT",timezone:"UTC"};
  });
  if(d.format==="json"){res.json(report);return;}
  const csvrows=report.ledger.map((r:any)=>[r.id,r.kind,r.delta,r.balanceAfter,new Date(r.createdAt).toISOString()]);
  if(d.format==="csv"){
    const csv=[['id','kind','credits','balance_after','created_at_utc'],...csvrows].map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\r\n');
    res.type("text/csv").setHeader("Content-Disposition",'attachment; filename="astra-credit-ledger.csv"');res.send('\uFEFF'+csv);return;
  }
  const html=page("Credit ledger report / ক্রেডিট লেজার",`<p>Current balance: ${report.balance} credits. Range: ${esc(d.from??"start")} to ${esc(d.to??"today")} (UTC).</p><p>SaaS demo credits only. Government fees: NOT CONFIGURED.</p><table><thead><tr><th>Type</th><th>Credits</th><th>Balance</th><th>Date UTC</th></tr></thead><tbody>${report.ledger.map((r:any)=>`<tr><td>${esc(r.kind)}</td><td>${r.delta}</td><td>${r.balanceAfter}</td><td>${esc(new Date(r.createdAt).toISOString().slice(0,10))}</td></tr>`).join('')}</tbody></table>`);
  res.type("pdf").setHeader("Content-Disposition",'attachment; filename="astra-credit-ledger.pdf"');res.send(await renderHtmlPdf(html));
}));

protectedToolsRouter.get("/owner/feedback",wrap(async(req,res)=>{
  if(identity(req).role!=="owner")fail(403,"ROLE_DENIED","Platform owner access required.");
  const d=z.object({status:z.enum(["OPEN","RESOLVED"]).optional()}).strict().parse(req.query);
  res.json({items:(await pool.query("SELECT id,name,email,subject,message,status,created_at,resolved_at FROM support_requests WHERE ($1::text IS NULL OR status=$1) ORDER BY created_at DESC LIMIT 100",[d.status??null])).rows.map(camelRow)});
}));
protectedToolsRouter.get("/invoices/:id/pdf",wrap(async(req,res)=>{
  const a=scoped(req,["admin","finance"]);
  const r=await transaction(a.tenantId,async(db)=>(await db.query("SELECT i.id,i.order_id,i.amount_minor,i.currency,i.type,i.issued_at,o.kind,o.credits,o.status,t.name_bn,t.name_en FROM invoices i JOIN payment_orders o ON o.id=i.order_id AND o.tenant_id=i.tenant_id JOIN tenants t ON t.id=i.tenant_id WHERE i.id=$1 AND i.tenant_id=$2",[id.parse(req.params.id),a.tenantId])).rows[0]);
  if(!r)fail(404,"NOT_FOUND","Invoice not found.");
  const html=page("Sandbox SaaS invoice / পরীক্ষামূলক চালান",rows([["Invoice",r.id],["Order",r.order_id],["Office",`${r.name_bn} / ${r.name_en}`],["Type",r.kind],["Credits",r.credits],["Sandbox amount",`${r.currency} ${(r.amount_minor/100).toFixed(2)}`],["Status",r.status],["Issued UTC",new Date(r.issued_at).toISOString()]])+"<p>Local sandbox settlement only. No money collected. This is not a government fee or tax invoice.</p>");
  res.type("pdf").setHeader("Content-Disposition",'attachment; filename="astra-sandbox-invoice.pdf"');res.send(await renderHtmlPdf(html));
}));
protectedToolsRouter.patch("/owner/feedback/:id",wrap(async(req,res)=>{
  const a=identity(req);if(a.role!=="owner")fail(403,"ROLE_DENIED","Platform owner access required.");
  const d=z.object({status:z.enum(["OPEN","RESOLVED"])}).strict().parse(req.body);
  const r=await pool.query("UPDATE support_requests SET status=$1,resolved_by=$2,resolved_at=CASE WHEN $1='RESOLVED' THEN now() ELSE NULL END WHERE id=$3 RETURNING id,status",[d.status,a.userId,id.parse(req.params.id)]);
  if(!r.rowCount)fail(404,"NOT_FOUND","Support request not found.");res.json(camelRow(r.rows[0]));
}));

