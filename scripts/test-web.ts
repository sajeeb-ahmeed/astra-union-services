import {spawn, spawnSync, type ChildProcess} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertScannerVerdictPath, probeFixtureSecret } from './scanner/preflight.js';
import { resetTestOrderPolicies } from './test-support/reset-test-order-policies.js';
// The Vite config resolves its root as path.resolve("apps/web"), i.e.
// relative to the process working directory. Pin every spawned server
// to the repo root (this file lives in <repo>/scripts) so a runner
// invoked from any directory still serves the right tree.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let stack:ChildProcess[]=[];
async function healthy(){try{return (await fetch('http://127.0.0.1:5173/api/v1/health',{signal:AbortSignal.timeout(2000)})).ok;}catch{return false;}}
async function devHarnessHealthy(){try{return (await fetch('http://127.0.0.1:5174/',{signal:AbortSignal.timeout(2000)})).ok;}catch{return false;}}
async function runTests(files:string[], env:NodeJS.ProcessEnv):Promise<number>{
  const test=spawn(process.execPath,['--import','tsx','--test','--test-concurrency=1',...files],{stdio:'inherit',windowsHide:true,env});
  return await new Promise<number>((resolve,reject)=>{test.on('error',reject);test.on('exit',code=>resolve(code??1));});
}
try{
  if(!await healthy()){
    // Task C (browser stability): the suite used to run against the Vite
    // dev server (scripts/dev.ts). With 26 offices in the directory,
    // every public page fires one /offices/<slug> detail request per
    // office on mount (PublicPortal.loadServiceOfficeSummaries, cache
    // is per document), and a 7-navigation tour refires that fan-out
    // on top of the dev server's per-module transform load. On this
    // VM the headless browser's network service then fails the chunk
    // import with net::ERR_INSUFFICIENT_RESOURCES — the page stays
    // blank (language tour geography.test.ts:384, tracking fill
    // public-home-browser.test.ts:145). The same tour passes 3/3
    // rounds against the production build, so the suite now builds
    // once and serves the built bundle with `vite preview` (plus the
    // API). The build also exercises the real shipped artifact, which
    // is what the suite should be testing. A stack that is already
    // running is still reused untouched.
    const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', windowsHide: true, cwd: repoRoot });
    if (build.status !== 0) throw Error('Browser QA stack did not start: production build failed.');
    // B2: the browser suite settles a sandbox order, so its stack enables the otherwise-off route.
    const env = {...process.env, DEMO_SETTLE_ENABLED:'true'};
    stack.push(spawn(process.execPath,['--import','tsx','apps/api/src/server.ts'],{stdio:'inherit',windowsHide:true,env,cwd:repoRoot}));
    stack.push(spawn(process.execPath,[path.resolve('node_modules/vite/bin/vite.js'),'preview','--config','apps/web/vite.config.ts'],{stdio:'inherit',windowsHide:true,env,cwd:repoRoot}));
    for(let i=0;i<80&&!await healthy();i++)await new Promise(r=>setTimeout(r,250));
    if(!await healthy())throw Error('Browser QA stack did not start. Initialize PostgreSQL first.');
  }
  // The attachment component tests (attachment-browser.test.ts) load a
  // test-only harness page (/test/fixtures/attachment-harness.tsx)
  // that only the Vite dev server can serve: it is a .tsx module
  // outside the production bundle, and `vite preview` has no route
  // for it — the harness never mounts there and all 9 tests time
  // out. So the runner keeps a dev server on 5174 for that one file
  // (ATTACHMENT_TEST_ORIGIN), while the rest of the suite runs
  // against the production build on 5173. The harness page loads
  // once per test and never navigates rapidly, so the dev server's
  // resource-exhaustion path does not apply to it.
  if(!await devHarnessHealthy()){
    stack.push(spawn(process.execPath,[path.resolve('node_modules/vite/bin/vite.js'),'--config','apps/web/vite.config.ts','--port','5174','--strictPort'],{stdio:'inherit',windowsHide:true,env:{...process.env,DEMO_SETTLE_ENABLED:'true'},cwd:repoRoot}));
    for(let i=0;i<80&&!await devHarnessHealthy();i++)await new Promise(r=>setTimeout(r,250));
    if(!await devHarnessHealthy())throw Error('Browser QA stack did not start: attachment-harness dev server on 5174 did not come up.');
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
  const attachmentFiles=files.filter(n=>n.endsWith('/attachment-browser.test.ts'));
  const restFiles=files.filter(n=>!n.endsWith('/attachment-browser.test.ts'));
  // Attachment component tests first, against the dev server on 5174;
  // the rest of the suite against the production build on 5173.
  // The runner's exit code is the worst of the two runs.
  let code=await runTests(attachmentFiles,{...process.env,ATTACHMENT_TEST_ORIGIN:'http://127.0.0.1:5174'});
  const restCode=await runTests(restFiles,process.env);
  process.exitCode=Math.max(code,restCode);
}finally{for (const child of stack) child.kill();}
