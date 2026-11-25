import {spawn, type ChildProcess} from 'node:child_process';
import fs from 'node:fs';
import { assertScannerVerdictPath, probeFixtureSecret } from './scanner/preflight.js';
import { resetTestOrderPolicies } from './test-support/reset-test-order-policies.js';
let stack:ChildProcess|undefined;
async function healthy(){try{return (await fetch('http://127.0.0.1:5173/api/v1/health',{signal:AbortSignal.timeout(2000)})).ok;}catch{return false;}}
try{
  if(!await healthy()){
    // B2: the browser suite settles a sandbox order, so its stack enables the otherwise-off route.
    stack=spawn(process.execPath,['--import','tsx','scripts/dev.ts'],{stdio:'inherit',windowsHide:true,env:{...process.env,DEMO_SETTLE_ENABLED:'true'}});
    for(let i=0;i<80&&!await healthy();i++)await new Promise(r=>setTimeout(r,250));
    if(!await healthy())throw Error('Browser QA stack did not start. Initialize PostgreSQL first.');
  }
  // T-002: fail fast when no scanner verdict path exists. Without one,
  // every document-bearing test fails one by one with 409
  // ATTACHMENT_NOT_READY instead of a single clear message.
  const verdict = await assertScannerVerdictPath();
  console.log(`Scanner verdict path: ${verdict.mode} — ${verdict.detail}`);
  if (verdict.mode === 'fixture') {
    // The runner reuses an already-running stack, so the secret must also
    // be in the API process — probe the running API before the suite runs.
    const accepted = await probeFixtureSecret('http://127.0.0.1:3001', process.env.ATTACHMENT_SCANNER_SECRET!);
    if (!accepted) throw new Error('Scanner preflight failed (T-002): the API rejected ATTACHMENT_SCANNER_SECRET. If a dev stack is already running, stop it and restart it with the secret set — the web runner reuses an already-running stack.');
    console.log('Scanner fixture secret accepted by the API.');
  }
  // T-003: restore the seeded no-policy assumption before the suite runs.
  // The seed creates no order policies; every row is state a previous
  // suite created (e.g. the alpha/42 zero-fee policy from test:api).
  const removed = await resetTestOrderPolicies();
  console.log(`Test isolation (T-003): removed ${removed} test-created order polic(ies).`);
  const files=fs.readdirSync('apps/web/test').filter(n=>n.endsWith('.test.ts')).sort().map(n=>'apps/web/test/'+n);
  const test=spawn(process.execPath,['--import','tsx','--test','--test-concurrency=1',...files],{stdio:'inherit',windowsHide:true});
  process.exitCode=await new Promise<number>((resolve,reject)=>{test.on('error',reject);test.on('exit',code=>resolve(code??1));});
}finally{stack?.kill();}
