import {spawn, type ChildProcess} from 'node:child_process';
import fs from 'node:fs';
let stack:ChildProcess|undefined;
async function healthy(){try{return (await fetch('http://127.0.0.1:5173/api/v1/health',{signal:AbortSignal.timeout(2000)})).ok;}catch{return false;}}
try{
  if(!await healthy()){
    stack=spawn(process.execPath,['--import','tsx','scripts/dev.ts'],{stdio:'inherit',windowsHide:true});
    for(let i=0;i<80&&!await healthy();i++)await new Promise(r=>setTimeout(r,250));
    if(!await healthy())throw Error('Browser QA stack did not start. Initialize PostgreSQL first.');
  }
  const files=fs.readdirSync('apps/web/test').filter(n=>n.endsWith('.test.ts')).sort().map(n=>'apps/web/test/'+n);
  const test=spawn(process.execPath,['--import','tsx','--test','--test-concurrency=1',...files],{stdio:'inherit',windowsHide:true});
  process.exitCode=await new Promise<number>((resolve,reject)=>{test.on('error',reject);test.on('exit',code=>resolve(code??1));});
}finally{stack?.kill();}
