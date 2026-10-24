/** Offline orchestration test: every fetch is intercepted; no hosted access. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const script = fileURLToPath(
  new URL("./verify-hosted-attachments.ts", import.meta.url),
);
const mock = `
import fs from 'node:fs';
import assert from 'node:assert/strict';
const phase=process.argv[2], stateFile='mock-state.json';
const state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):{uploads:0,requests:[],clean:''};
const ids={citizen:'11111111-1111-4111-8111-111111111111',clean:'22222222-2222-4222-8222-222222222222',threat:'33333333-3333-4333-8333-333333333333'};
const saved=()=>fs.writeFileSync(stateFile,JSON.stringify(state));
const reply=(body,status=200,headers={})=>new Response(Buffer.isBuffer(body)?body:JSON.stringify(body),{status,headers:{'content-type':Buffer.isBuffer(body)?'application/pdf':'application/json',...headers}});
globalThis.fetch=async (input, options={})=>{
 const url=new URL(input); assert.equal(url.origin,'https://offline-qa.example.test');
 const route=url.pathname.replace('/api/v1',''), method=options.method??'GET', headers=options.headers??{}, cookie=headers.Cookie??'';
 const body=options.body?JSON.parse(options.body):undefined;
 state.requests.push(method+' '+route);saved();
 if(route==='/auth/login'){
   const who=body.email.split('@')[0];assert.ok(['staff','admin','foreign'].includes(who));
   return reply({user:{role:who==='staff'?'staff':'admin',tenantId:who==='foreign'?'other-tenant':'qa-tenant'},csrfToken:'csrf'},200,{'set-cookie':'astra_session='+who+'; HttpOnly; Secure; SameSite=Strict'});
 }
 if(route==='/auth/logout')return reply({ok:true});
 if(route==='/internal/attachment-scans/claim')return reply({error:{code:'SCANNER_AUTH_REQUIRED'}},401);
 if(route==='/auth/me')return reply({tenant:{},user:{}});
 if(route==='/wallet')return reply({balance:3,ledger:[]});
 if(route==='/payments/configuration')return reply({available:false,configured:false,environment:'DISABLED',bankSettlement:'NOT_CONNECTED',nagad:{configured:false}});
 if(route==='/applications/baseline-app')return reply({application:{state:'APPROVED'},payload:{synthetic:true}});
 if(route==='/certificates/baseline-cert/pdf')return reply(Buffer.from('%PDF synthetic baseline'));
 if(route==='/citizens'&&method==='POST'){assert.match(body.syntheticReference,/^DEMO-ATT-/);return reply({id:ids.citizen},201);}
 if(route==='/attachments'&&method==='POST'){
   const bytes=Buffer.from(body.base64,'base64');assert.equal(body.citizenId,ids.citizen);assert.equal(body.mimeType,'application/pdf');
   state.uploads++;assert.ok(state.uploads<=2);
   const label=state.uploads===1?'clean':'threat';
   if(label==='clean')state.clean=body.base64;else assert.ok(bytes.includes(Buffer.from('/EmbeddedFile')),'Actual embedded fixture must be used');
   state[label+'Length']=bytes.length;saved();
   return reply({attachmentId:ids[label],mimeType:'application/pdf',byteLength:bytes.length,scanState:'QUARANTINED',downloadAllowed:false,retryAllowed:false},201);
 }
 const match=/^\\/attachments\\/([^/]+)(\\/status|\\/retry)?$/.exec(route);
 if(match){
   if(!cookie)return reply({error:{}},401);if(cookie.includes('foreign'))return reply({error:{}},404);
   const label=match[1]===ids.clean?'clean':match[1]===ids.threat?'threat':null;assert.ok(label);
   if(match[2]==='/retry'){assert.equal(label,'threat');return reply({error:{code:'ATTACHMENT_RETRY_DENIED'}},409);}
   if(match[2]==='/status')return reply({attachmentId:ids[label],mimeType:'application/pdf',byteLength:state[label+'Length'],scanState:phase==='prepare'?'QUARANTINED':label==='clean'?'CLEAN':'REJECTED',downloadAllowed:phase==='verify'&&label==='clean',retryAllowed:false,reasonCode:label==='threat'?'UNSAFE_FILE':'OK',scannedAt:phase==='verify'?new Date().toISOString():null});
   if(phase==='verify'&&label==='clean')return reply(Buffer.from(state.clean,'base64'),200,{'cache-control':'no-store','x-content-type-options':'nosniff','content-disposition':'attachment; filename="private-upload"'});
   return reply({error:{code:'ATTACHMENT_NOT_READY'}},409);
 }
 throw Error('Unexpected offline request');
};
`;

test("hosted attachment verifier prepares and verifies only synthetic fixtures, preserves private IDs and refuses duplicate preparation", () => {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), "astra-hosted-attachments-"),
  );
  const privateDir = path.join(temp, ".runtime", "hosted");
  fs.mkdirSync(privateDir, { recursive: true });
  fs.mkdirSync(path.join(temp, "execution"));
  const write = (file: string, data: unknown) =>
    fs.writeFileSync(path.join(temp, file), JSON.stringify(data));
  const base = "https://offline-qa.example.test";
  write(".runtime/hosted/credentials.json", { publicOrigin: base });
  write("execution/hosted-orders-qa.json", { status: "PASS", runId: "orders" });
  write("execution/hosted-qa.json", { status: "PASS", runId: "initial" });
  write(".runtime/hosted/qa-credentials.json", {
    runs: [
      {
        runId: "orders",
        kind: "HOSTED_ORDERS_QA",
        baseUrl: base,
        lastStatus: "PASS",
        accounts: {
          staff: {
            email: "staff@synthetic.test",
            password: "private-password",
          },
          admin: {
            email: "admin@synthetic.test",
            password: "private-password",
          },
        },
        offices: { primary: { id: "qa-tenant" } },
        applications: { positive: "baseline-app" },
        certificateId: "baseline-cert",
      },
      {
        runId: "initial",
        baseUrl: base,
        lastStatus: "PASS",
        accounts: {
          otheradmin: {
            email: "foreign@synthetic.test",
            password: "private-password",
          },
        },
        offices: { isolation: { id: "other-tenant" } },
      },
    ],
  });
  fs.writeFileSync(path.join(temp, "mock-fetch.mjs"), mock);
  const run = (phase: string) =>
    spawnSync(
      process.execPath,
      [
        "--import",
        pathToFileURL(require.resolve("tsx")).href,
        "--import",
        pathToFileURL(path.join(temp, "mock-fetch.mjs")).href,
        script,
        phase,
      ],
      {
        cwd: temp,
        env: {
          ...process.env,
          ASTRA_LIVE_URL: base,
          ASTRA_ATTACHMENT_WAIT_SECONDS: "0",
          ASTRA_QA_OUTPUT: undefined,
        },
        encoding: "utf8",
        timeout: 20000,
        windowsHide: true,
      },
    );
  try {
    const prepared = run("prepare");
    assert.equal(prepared.status, 0, prepared.stderr);
    const prepareEvidence = JSON.parse(
      fs.readFileSync(
        path.join(temp, "execution/attachments-hosted-prepare.json"),
        "utf8",
      ),
    );
    assert.equal(prepareEvidence.status, "PREPARED");
    assert.equal(prepareEvidence.sessionsClosed, 3);
    const duplicated = run("prepare");
    assert.equal(duplicated.status, 1);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(temp, "mock-state.json"), "utf8"))
        .uploads,
      2,
      "A repeated prepare must not upload or mutate again",
    );
    const verified = run("verify");
    assert.equal(verified.status, 0, verified.stderr);
    const published = fs.readFileSync(
      path.join(temp, "execution/attachments-hosted-qa.json"),
      "utf8",
    );
    const evidence = JSON.parse(published);
    assert.equal(evidence.status, "PASS");
    assert.equal(evidence.sessionsClosed, 3);
    for (const secret of [
      "private-password",
      "11111111-",
      "22222222-",
      "33333333-",
      "baseline-app",
      "baseline-cert",
      "EICAR",
      "base64",
    ])
      assert.ok(!published.includes(secret));
    const state = JSON.parse(
      fs.readFileSync(path.join(temp, "mock-state.json"), "utf8"),
    );
    assert.equal(
      state.requests.filter((r: string) => r === "POST /citizens").length,
      1,
    );
    assert.equal(
      state.requests.filter((r: string) => r === "POST /attachments").length,
      2,
    );
    assert.ok(
      !state.requests.some((r: string) =>
        /finish|billing|issue|transition|order-policies/.test(r),
      ),
    );
    assert.equal(
      state.requests.filter((r: string) => r.endsWith("/retry")).length,
      1,
    );
  } finally {
    assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
    assert.match(path.basename(temp), /^astra-hosted-attachments-/);
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
