import {spawn, type ChildProcess} from 'node:child_process';
import fs from 'node:fs';
import {randomBytes} from 'node:crypto';
let stack:ChildProcess|undefined;
// The browser suite runs no scanner worker. Journey fixtures (test/fixtures/fill-form.ts) stand in
// for it over the internal scanner API, which needs the SAME secret in the API stack and the test
// process; without one, uploads stay QUARANTINED and every submit with a document fails 409.
// Generate a run-local secret unless the caller supplied one (a pre-started stack must share it).
if(!/^[a-f0-9]{64}$/i.test(process.env.ATTACHMENT_SCANNER_SECRET??''))process.env.ATTACHMENT_SCANNER_SECRET=randomBytes(32).toString('hex');
async function healthy(){try{return (await fetch('http://127.0.0.1:5173/api/v1/health',{signal:AbortSignal.timeout(2000)})).ok;}catch{return false;}}
try{
  if(!await healthy()){
    // B2: the browser suite settles a sandbox order, so its stack enables the otherwise-off route.
    stack=spawn(process.execPath,['--import','tsx','scripts/dev.ts'],{stdio:'inherit',windowsHide:true,env:{...process.env,DEMO_SETTLE_ENABLED:'true'}});
    for(let i=0;i<80&&!await healthy();i++)await new Promise(r=>setTimeout(r,250));
    if(!await healthy())throw Error('Browser QA stack did not start. Initialize PostgreSQL first.');
  }
  const files=fs.readdirSync('apps/web/test').filter(n=>n.endsWith('.test.ts')).sort().map(n=>'apps/web/test/'+n);
  const test=spawn(process.execPath,['--import','tsx','--test','--test-concurrency=1',...files],{stdio:'inherit',windowsHide:true});
  process.exitCode=await new Promise<number>((resolve,reject)=>{test.on('error',reject);test.on('exit',code=>resolve(code??1));});
}finally{stack?.kill();}
