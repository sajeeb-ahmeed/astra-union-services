import express from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { Auth } from "./app.js";
import { pool, transaction, audit } from "./db.js";
import { camelRow, citizenRow, fail } from "./models.js";
import { digest } from "./security.js";
import { renderHtmlPdf } from "./pdf.js";
import { geographyInput, geographyRow, geographyValues, validateGeography, validateOfficeJurisdiction, presentAddressInput, presentAddressRow, presentAddressValues, presentAddressColumns } from "./geography.js";
import { parseReferenceInput } from "./references.js";
import {
  createFailureBudget,
  createSharedRateLimiter,
  sharedRateLimitsEnabled,
} from "./shared-rate-limit.js";
import { logPlatformSecurityEvent } from "./security-audit.js";

// S-006: the same per-number failure budget as /verify/by-number in
// app.ts (10 failed lookups of one number in 15 minutes lock that number
// out; a success clears it). UUID lookups skip the budget — a UUID is
// not enumerable, so there is nothing to bound there.
const lookupBudget = createFailureBudget({
  pool,
  limit: 10,
  windowMs: 15 * 60_000,
  keyPrefix: "lookup:",
  shared: sharedRateLimitsEnabled(),
});

// S-015: unauthenticated public writes get a stricter per-IP hourly budget
// on top of httpHardening's 60/min mutation limiter: 10 feedbacks and 10
// subscribes per IP per hour, shared across processes through
// rate_limit_buckets when shared limits are enabled (same store as S-004).
// CAPTCHA is deliberately NOT added here — no provider exists in this
// stack and S-006 is an open owner decision (see
// docs/PUBLIC_DATA_RETENTION.md). The budget is the abuse control that is
// safe to ship without one.
const feedbackBudget = createSharedRateLimiter({
  pool,
  limit: 10,
  windowMs: 60 * 60_000,
  keyPrefix: "public-write:feedback:",
  shared: sharedRateLimitsEnabled(),
});
const subscribeBudget = createSharedRateLimiter({
  pool,
  limit: 10,
  windowMs: 60 * 60_000,
  keyPrefix: "public-write:subscribe:",
  shared: sharedRateLimitsEnabled(),
});

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
const page = (title: string, body: string) => `<!doctype html><html lang="bn"><meta charset="utf-8"><style>@page{size:A4;margin:18mm}body{font:13px 'Nirmala UI','Noto Sans Bengali',Arial,sans-serif;color:#142b24;line-height:1.7}h1{font-size:23px;color:#075941}h2{font-size:17px}table{border-collapse:collapse;width:100%;table-layout:fixed}td,th{border:1px solid #cbd9d2;padding:8px;overflow-wrap:anywhere;text-align:left}tr{break-inside:avoid}.foot{margin-top:24px;color:#48564f}thead{display:table-header-group}</style><body><h1>${esc(title)}</h1>${body}<p class="foot">DigitalUnion · স্মার্ট ইউনিয়ন, স্মার্ট বাংলাদেশ</p></body></html>`;
const rows = (values: [string, unknown][]) => `<table>${values.map(([k,v])=>`<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>`;

export const publicToolsRouter = express.Router();
publicToolsRouter.get("/track/:id",wrap(async(req,res)=>{
  // Phase 5 (5C): tracking accepts the legacy application UUID and the Phase 5 public
  // reference (grouped or plain digits). Anything else is simply not found, as before.
  const parsed=id.safeParse(req.params.id);
  if(parsed.success){
    const r=(await pool.query("SELECT * FROM public_track($1)",[parsed.data])).rows[0];
    if(!r)fail(404,"NOT_FOUND","Application status not found.");
    res.json(camelRow(r));
    return;
  }
  const reference=parseReferenceInput(req.params.id);
  if(!reference)fail(404,"NOT_FOUND","Application status not found.");
  // S-006: see the note on lookupBudget above. Malformed input is refused
  // without recording (it cannot match a real record).
  if(await lookupBudget.blocked(reference))
    fail(429,"TRACK_RATE_LIMIT","Too many failed lookups for this number. Try again later.");
  const r=(await pool.query("SELECT * FROM public_track_by_reference($1)",[reference])).rows[0];
  if(!r){
    await lookupBudget.recordFailure(reference);
    fail(404,"NOT_FOUND","Application status not found.");
  }
  await lookupBudget.clear(reference);
  res.json(camelRow(r));
}));
publicToolsRouter.post("/public/feedback", feedbackBudget.middleware(), wrap(async (req,res) => {
  const d = z.object({name:text(120,2),email:z.string().email().max(150).optional(),subject:text(180,3),message:text(4000,10)}).strict().parse(req.body);
  const r = await pool.query("INSERT INTO support_requests(name,email,subject,message) VALUES($1,$2,$3,$4) RETURNING id,status,created_at",[d.name,d.email??null,d.subject,d.message]);
  res.status(201).json({...camelRow(r.rows[0]),delivery:"SAVED_IN_PLATFORM"});
}));
publicToolsRouter.post("/public/subscribe", subscribeBudget.middleware(), wrap(async (req,res) => {
  const d = z.object({email:z.string().email().max(150)}).strict().parse(req.body);
  await pool.query("INSERT INTO subscriptions_interest(email) VALUES($1) ON CONFLICT DO NOTHING",[d.email.toLowerCase()]);
  res.status(202).json({status:"REQUESTED",message:"Your interest is saved."});
}));

export const protectedToolsRouter = express.Router();
// QAFIX-01 (live QA §1 bugs 1–5): the citizen record's core fields — the ones
// profile completeness and every certificate read — ride on /profile so the
// profile page can actually complete them. Before this, the page edited only
// platform_users while completeness read citizens, so saving there never
// moved the meter and the apply pre-step asked for the same data again.
const citizenProfileColumns="full_name_bn,full_name_en,date_of_birth,address_bn,address_en";
const citizenCoreFields=(citizen:any)=>citizen?{
  citizenNameBn:citizen.full_name_bn??null,
  citizenNameEn:citizen.full_name_en??null,
  dateOfBirth:typeof citizen.date_of_birth==="string"?citizen.date_of_birth:citizen.date_of_birth?.toISOString().slice(0,10)??null,
  permanentAddressBn:citizen.address_bn??null,
  permanentAddressEn:citizen.address_en??null,
}:{};
const citizenSelect=`SELECT division_code,district_code,upazila_code,union_code,ward_code,${citizenProfileColumns},${presentAddressColumns} FROM citizens WHERE tenant_id=$1 AND user_id=$2 LIMIT 1`;
protectedToolsRouter.get("/profile",wrap(async(req,res)=>{
  const a=identity(req);
  const r=await pool.query("SELECT id,email,display_name,name_bn,phone,address FROM platform_users WHERE id=$1",[a.userId]);
  const citizen = a.tenantId ? await transaction(a.tenantId,async(db)=>(await db.query(citizenSelect,[a.tenantId,a.userId])).rows[0]) : undefined;
  res.json({...camelRow(r.rows[0]),role:a.role,...citizenCoreFields(citizen),geography:geographyRow(citizen),presentAddress:citizen?presentAddressRow(citizen):null});
}));
const profileDateOfBirth=z.string().regex(/^\d{4}-\d{2}-\d{2}$/,"জন্ম তারিখ দিন। / Enter a date of birth.").refine((v)=>Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v&&v<=new Date().toISOString().slice(0,10)&&v>="1900-01-01","জন্ম তারিখ আজকের বা তার আগের হতে হবে। / Date of birth must be today or earlier.");
protectedToolsRouter.patch("/profile",wrap(async(req,res)=>{
  const a=identity(req);
  const d=z.object({displayName:text(120,2),nameBn:text(120,0).optional(),phone:z.string().regex(/^(?:01\d{9})?$/).optional(),address:text(1000,0).optional(),geography:geographyInput.optional(),presentAddress:presentAddressInput.optional(),citizenNameEn:z.string().trim().min(2).max(120).optional(),dateOfBirth:profileDateOfBirth.optional(),permanentAddressBn:z.string().trim().min(4).max(500).optional(),permanentAddressEn:z.string().trim().min(4).max(500).optional()}).strict().parse(req.body);
  if((d.geography||d.presentAddress) && (!a.tenantId || a.role!=="citizen")) fail(403,"GEOGRAPHY_PROFILE_UNAVAILABLE","Only citizen profiles can update an address hierarchy.");
  // QAFIX-01: the citizen-only core fields belong to the citizen record.
  // (nameBn is shared: every role keeps it on the account row; for a
  // citizen it is additionally synced to the citizen record below.)
  const touchesCitizenOnly = d.citizenNameEn!==undefined || d.dateOfBirth!==undefined || d.permanentAddressBn!==undefined || d.permanentAddressEn!==undefined;
  if(touchesCitizenOnly && (!a.tenantId || a.role!=="citizen")) fail(403,"CITIZEN_PROFILE_UNAVAILABLE","Only citizen profiles carry citizen record fields.");
  const touchesCitizenCore = a.role==="citizen" && (touchesCitizenOnly || d.nameBn!==undefined);
  const save=async(db:Pick<typeof pool,'query'>)=>{
    if(d.geography) {
      await validateGeography(db,d.geography,"citizen");
      const office=(await db.query("SELECT * FROM tenants WHERE id=$1",[a.tenantId])).rows[0];
      validateOfficeJurisdiction(office,d.geography);
      const updated=await db.query("UPDATE citizens SET division_code=$3,district_code=$4,upazila_code=$5,union_code=$6,ward_code=$7 WHERE tenant_id=$1 AND user_id=$2",[a.tenantId,a.userId,...geographyValues(d.geography)]);
      if(!updated.rowCount)fail(404,"PROFILE_NOT_FOUND","Citizen profile not found.");
    }
    if(d.presentAddress) {
      const updated=await db.query("UPDATE citizens SET present_same_as_permanent=$3,present_address_bn=$4,present_address_en=$5,present_division_code=$6,present_district_code=$7,present_upazila_code=$8,present_union_code=$9,present_ward_code=$10 WHERE tenant_id=$1 AND user_id=$2",[a.tenantId,a.userId,...await presentAddressValues(db,d.presentAddress)]);
      if(!updated.rowCount)fail(404,"PROFILE_NOT_FOUND","Citizen profile not found.");
    }
    if(touchesCitizenCore) {
      // The Bangla name the citizen saves here is the citizen record's name
      // too — one name, one store — so completeness and the apply pre-step
      // see exactly what the profile page shows.
      const sets:string[]=[]; const values:unknown[]=[];
      const put=(column:string,value:unknown)=>{ if(value===undefined)return; values.push(value); sets.push(`${column}=$${values.length+2}`); };
      // An empty account nameBn means "not provided" here, never "erase the
      // citizen record's Bangla name" — the account row keeps its own
      // empty-string semantics, the citizen record only takes real values.
      put("full_name_bn",d.nameBn?.trim()?d.nameBn:undefined);
      put("full_name_en",d.citizenNameEn);
      put("date_of_birth",d.dateOfBirth);
      put("address_bn",d.permanentAddressBn);
      put("address_en",d.permanentAddressEn);
      if(sets.length) {
        const updated=await db.query(`UPDATE citizens SET ${sets.join(",")} WHERE tenant_id=$1 AND user_id=$2`,[a.tenantId,a.userId,...values]);
        if(!updated.rowCount)fail(404,"PROFILE_NOT_FOUND","Citizen profile not found.");
      }
    }
    const r=await db.query("UPDATE platform_users SET display_name=$1,name_bn=COALESCE($2,name_bn),phone=COALESCE($3,phone),address=COALESCE($4,address) WHERE id=$5 RETURNING id,email,display_name,name_bn,phone,address",[d.displayName,d.nameBn??null,d.phone??null,d.address??null,a.userId]);
    if(a.tenantId)await audit(db as any,a.tenantId,a.userId,"PROFILE_UPDATED",a.userId,{fields:Object.keys(d)});
    const citizen = a.tenantId ? (await db.query(citizenSelect,[a.tenantId,a.userId])).rows[0] : undefined;
    return {...camelRow(r.rows[0]),...citizenCoreFields(citizen),geography:geographyRow(citizen),presentAddress:citizen?presentAddressRow(citizen):null};
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
const printSummary=(r:any)=>({...camelRow(r),status:"READY",demo:process.env.ISSUANCE_MODE === "official" ? false : true,pdfUrl:`/api/v1/print-requests/${r.id}/pdf`});
protectedToolsRouter.get("/print-requests",wrap(async(req,res)=>{
  const a=scoped(req,["citizen","staff","admin"]);
  // Phase 6c: optional search by citizen name, reference or mobile, and an inclusive Asia/Dhaka date range.
  const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v);
  const d=z.object({kind:z.enum(["biodata","holding","witness"]).optional(),page:z.coerce.number().int().min(1).max(10000).default(1),q:z.string().trim().max(100).optional(),from:day.optional(),to:day.optional()}).strict().refine(v=>!v.from||!v.to||v.from<=v.to,{message:"The start date must not be after the end date."}).parse(req.query);
  const data=await transaction(a.tenantId,async(db)=>{
    const values=[a.tenantId,a.role==="citizen"?a.userId:null,d.kind??null,d.q?`%${d.q}%`:null,d.from??null,d.to??null];
    const filter="p.tenant_id=$1 AND ($2::uuid IS NULL OR c.user_id=$2) AND ($3::text IS NULL OR p.kind=$3) AND ($4::text IS NULL OR c.full_name_bn ILIKE $4 OR c.full_name_en ILIKE $4 OR c.synthetic_reference ILIKE $4 OR c.contact_mobile ILIKE $4) AND ($5::date IS NULL OR (p.created_at AT TIME ZONE 'Asia/Dhaka')::date>=$5::date) AND ($6::date IS NULL OR (p.created_at AT TIME ZONE 'Asia/Dhaka')::date<=$6::date)";
    const r=await db.query(`SELECT p.id,p.kind,p.language,p.citizen_id,p.created_at,c.full_name_bn AS citizen_name_bn,c.full_name_en AS citizen_name_en FROM print_requests p JOIN citizens c ON c.tenant_id=p.tenant_id AND c.id=p.citizen_id WHERE ${filter} ORDER BY p.created_at DESC,p.id LIMIT 20 OFFSET $7`,[...values,(d.page-1)*20]);
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
  const content:[string,unknown][]=[[local("নাম","Name"),local(c.nameBn,c.nameEn)],[local("জন্ম তারিখ","Date of birth"),c.dateOfBirth],[local("ঠিকানা","Address"),local(c.addressBn,c.addressEn)],[local("পরিচিতি","Reference"),c.syntheticReference]];
  if(d.holding)content.push([local("হোল্ডিং নম্বর","Holding number"),d.holding.number],[local("মালিক","Owner"),local(d.holding.ownerBn,d.holding.ownerEn)],[local("হোল্ডিং ঠিকানা","Holding address"),local(d.holding.addressBn,d.holding.addressEn)],[local("বার্ষিক মূল্য (টাকা)","Declared annual value (BDT)"),(d.holding.annualValueMinor/100).toFixed(2)]);
  if(d.witness)content.push([local("মৃত ব্যক্তির নাম","Deceased name"),local(d.witness.deceasedNameBn,d.witness.deceasedNameEn)],[local("সাক্ষীর নাম","Witness name"),local(d.witness.witnessNameBn,d.witness.witnessNameEn)],[local("বক্তব্য","Statement"),d.witness.statement]);
  const bytes=await renderHtmlPdf(page(title,rows(content)+"<p>Applicant-supplied information.</p>"));
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
  res.type("pdf").setHeader("Content-Disposition",'attachment; filename="digitalunion-copy.pdf"');res.send(r.pdf);
}));

protectedToolsRouter.get("/notifications",wrap(async(req,res)=>{
  const a=scoped(req);
  // Phase W: the feed carries application events as well as issuance. Submission events
  // (resource_id = application id) are office-facing only; rejection and issuance events
  // reach the citizen who owns the application, and the office feed sees everything.
  const r=await transaction(a.tenantId,async(db)=>(await db.query("SELECT e.id,e.kind,e.detail,e.created_at,r.read_at,c.number certificate_number,ap.id application_id,ap.service_no FROM outbox_events e LEFT JOIN certificates c ON c.id=e.resource_id AND c.tenant_id=e.tenant_id JOIN applications ap ON ap.tenant_id=e.tenant_id AND ap.id=COALESCE(c.application_id,e.resource_id) JOIN citizens ct ON ct.id=ap.citizen_id AND ct.tenant_id=ap.tenant_id LEFT JOIN notification_receipts r ON r.event_id=e.id AND r.tenant_id=e.tenant_id AND r.user_id=$2 WHERE e.tenant_id=$1 AND (CASE WHEN e.kind IN ('APPLICATION_SUBMITTED','APPLICATION_RESUBMITTED') THEN $3::boolean=false ELSE ($3::boolean=false OR ct.user_id=$2) END) ORDER BY e.created_at DESC LIMIT 100",[a.tenantId,a.userId,a.role==="citizen"])).rows);
  res.json({items:r.map(camelRow),channel:"IN_APP"});
}));
protectedToolsRouter.post("/notifications/:id/read",wrap(async(req,res)=>{
  const a=scoped(req),eventId=id.parse(req.params.id);
  await transaction(a.tenantId,async(db)=>{
    const allowed=(await db.query("SELECT e.id FROM outbox_events e LEFT JOIN certificates c ON c.id=e.resource_id AND c.tenant_id=e.tenant_id JOIN applications ap ON ap.tenant_id=e.tenant_id AND ap.id=COALESCE(c.application_id,e.resource_id) JOIN citizens ct ON ct.id=ap.citizen_id AND ct.tenant_id=ap.tenant_id WHERE e.id=$1 AND e.tenant_id=$2 AND (CASE WHEN e.kind IN ('APPLICATION_SUBMITTED','APPLICATION_RESUBMITTED') THEN $3::boolean=false ELSE ($3::boolean=false OR ct.user_id=$4) END)",[eventId,a.tenantId,a.role==="citizen",a.userId])).rowCount;
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
    return {ledger:ledger.map(camelRow),states,balance,from:d.from??null,to:d.to??null,demo:process.env.ISSUANCE_MODE === "official" ? false : true,governmentFees:"NOT_CONFIGURED",currency:"BDT",timezone:"UTC"};
  });
  if(d.format==="json"){res.json(report);return;}
  const csvrows=report.ledger.map((r:any)=>[r.id,r.kind,r.delta,r.balanceAfter,new Date(r.createdAt).toISOString()]);
  if(d.format==="csv"){
    const csv=[['id','kind','credits','balance_after','created_at_utc'],...csvrows].map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\r\n');
    res.type("text/csv").setHeader("Content-Disposition",'attachment; filename="digitalunion-credit-ledger.csv"');res.send('\uFEFF'+csv);return;
  }
  const html=page("Credit ledger report / ক্রেডিট লেজার",`<p>Current balance: ${report.balance} credits. Range: ${esc(d.from??"start")} to ${esc(d.to??"today")} (UTC).</p><p>SaaS credits only.</p><table><thead><tr><th>Type</th><th>Credits</th><th>Balance</th><th>Date UTC</th></tr></thead><tbody>${report.ledger.map((r:any)=>`<tr><td>${esc(r.kind)}</td><td>${r.delta}</td><td>${r.balanceAfter}</td><td>${esc(new Date(r.createdAt).toISOString().slice(0,10))}</td></tr>`).join('')}</tbody></table>`);
  res.type("pdf").setHeader("Content-Disposition",'attachment; filename="digitalunion-credit-ledger.pdf"');res.send(await renderHtmlPdf(html));
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
  const html=page("SaaS invoice / চালান",rows([["Invoice",r.id],["Order",r.order_id],["Office",`${r.name_bn} / ${r.name_en}`],["Type",r.kind],["Credits",r.credits],["Amount",`${r.currency} ${(r.amount_minor/100).toFixed(2)}`],["Status",r.status],["Issued UTC",new Date(r.issued_at).toISOString()]]));
  res.type("pdf").setHeader("Content-Disposition",'attachment; filename="digitalunion-invoice.pdf"');res.send(await renderHtmlPdf(html));
}));
protectedToolsRouter.patch("/owner/feedback/:id",wrap(async(req,res)=>{
  const a=identity(req);if(a.role!=="owner")fail(403,"ROLE_DENIED","Platform owner access required.");
  const d=z.object({status:z.enum(["OPEN","RESOLVED"])}).strict().parse(req.body);
  const r=await pool.query("UPDATE support_requests SET status=$1,resolved_by=$2,resolved_at=CASE WHEN $1='RESOLVED' THEN now() ELSE NULL END WHERE id=$3 RETURNING id,status",[d.status,a.userId,id.parse(req.params.id)]);
  if(!r.rowCount)fail(404,"NOT_FOUND","Support request not found.");res.json(camelRow(r.rows[0]));
}));

/**
 * S-015: retention purge for the unauthenticated public writes. The policy
 * (docs/PUBLIC_DATA_RETENTION.md) is explicit and the purge is manual and
 * owner-only — never an automatic silent delete (automatic deletion is an
 * OWNER DECISION, recorded in that doc). Eligible rows:
 * - support_requests RESOLVED more than 90 days ago, or (even if still
 *   OPEN) created more than 2 years ago as stale/unactioned;
 * - subscriptions_interest with consent older than 12 months.
 * dryRun:true reports the counts without deleting. A real purge writes a
 * PUBLIC_DATA_PURGED row to the durable platform audit stream (S-014).
 */
export const publicDataRetention = {
  resolvedSupportRequestsDays: 90,
  staleSupportRequestsYears: 2,
  subscriptionsInterestMonths: 12,
};
protectedToolsRouter.post("/owner/public-data/purge",wrap(async(req,res)=>{
  const a=identity(req);if(a.role!=="owner")fail(403,"ROLE_DENIED","Platform owner access required.");
  const d=z.object({dryRun:z.boolean().optional().default(false)}).strict().parse(req.body);
  const counts=async()=>{
    const support=(await pool.query(
      "SELECT count(*)::int n FROM support_requests WHERE (status='RESOLVED' AND resolved_at < now() - interval '90 days') OR created_at < now() - interval '2 years'",
    )).rows[0].n;
    const subscriptions=(await pool.query(
      "SELECT count(*)::int n FROM subscriptions_interest WHERE consent_at < now() - interval '12 months'",
    )).rows[0].n;
    return {supportRequests:support,subscriptions};
  };
  const eligible=await counts();
  let purged={supportRequests:0,subscriptions:0};
  if(!d.dryRun){
    purged={
      supportRequests:(await pool.query(
        "DELETE FROM support_requests WHERE (status='RESOLVED' AND resolved_at < now() - interval '90 days') OR created_at < now() - interval '2 years'",
      )).rowCount ?? 0,
      subscriptions:(await pool.query(
        "DELETE FROM subscriptions_interest WHERE consent_at < now() - interval '12 months'",
      )).rowCount ?? 0,
    };
    await logPlatformSecurityEvent(pool,{
      actorId:a.userId,actorRole:a.role,action:"PUBLIC_DATA_PURGED",
      metadata:{...purged,eligible},
    });
  }
  res.json({dryRun:d.dryRun,eligible,purged,policy:{
    resolvedSupportRequestsDays:publicDataRetention.resolvedSupportRequestsDays,
    staleSupportRequestsYears:publicDataRetention.staleSupportRequestsYears,
    subscriptionsInterestMonths:publicDataRetention.subscriptionsInterestMonths,
  }});
}));

