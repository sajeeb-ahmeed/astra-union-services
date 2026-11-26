import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {gzipSync,brotliCompressSync} from 'node:zlib';
import express from 'express';
import {mountWeb} from '../src/web-assets.js';
import {httpHardening} from '../src/http-hardening.js';
test('Deployment: same-origin SPA uses compressed immutable assets; private API misses never become HTML',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'astra-assets-'));
  fs.mkdirSync(path.join(directory,'assets'));
  fs.writeFileSync(path.join(directory,'index.html'),'<!doctype html><title>Astra</title><div id="root"></div>');
  const code='console.log("synthetic static fixture");';
  for(const [ext,bytes] of [['',Buffer.from(code)],['.gz',gzipSync(code)],['.br',brotliCompressSync(code)]] as const)fs.writeFileSync(path.join(directory,'assets','index-fixture.js'+ext),bytes);
  const app=express();app.use(httpHardening);app.use('/api',(_req,res)=>res.status(404).json({error:'NOT_FOUND'}));mountWeb(app,directory);
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  try{
    const url=`http://127.0.0.1:${(server.address() as any).port}`;
    const home=await fetch(url+'/offices');assert.equal(home.status,200);assert.equal(home.headers.get('cache-control'),'no-store');assert.match(await home.text(),/Astra/);
    for(const [accept,encoding] of [['br','br'],['gzip','gzip'],['br;q=0,gzip;q=0.5','gzip'],['identity',null]]){
      const r=await fetch(url+'/assets/index-fixture.js',{headers:{'Accept-Encoding':accept!}});assert.equal(r.status,200);assert.equal(r.headers.get('content-encoding'),encoding);assert.equal(await r.text(),code);assert.match(r.headers.get('cache-control')!,/immutable/);
    }
    assert.equal((await fetch(url+'/assets/missing.js')).status,404);
    const unknown=await fetch(url+'/api/unknown');assert.equal(unknown.status,404);assert.match(unknown.headers.get('content-type')!,/json/);
    assert.equal((await fetch(url+'/secret.env')).status,404);
    // BUNDLE06-R5 B5: unknown extensionless paths are honest 404s that
    // still carry the SPA shell (the friendly not-found view renders);
    // known exact and prefixed SPA routes stay 200.
    const missing=await fetch(url+'/no-such-page');assert.equal(missing.status,404);assert.match(await missing.text(),/Astra/);
    assert.equal((await fetch(url+'/home-preview')).status,404);
    for(const known of ['/','/services','/services/citizenship-certificate','/offices/belabo','/verify/2026111832694893','/login','/register','/register-office','/payments/return']){
      assert.equal((await fetch(url+known)).status,200,known);
    }
  }finally{
    await new Promise<void>(r=>server.close(()=>r()));
    // Only known individual test fixture files; no recursive computed-path deletion.
    for(const name of ['index-fixture.js','index-fixture.js.gz','index-fixture.js.br'])fs.unlinkSync(path.join(directory,'assets',name));
    fs.unlinkSync(path.join(directory,'index.html'));fs.rmdirSync(path.join(directory,'assets'));fs.rmdirSync(directory);
  }
});

// F-019: with a prerendered slug table present, an unknown
// /services/<slug> is an honest 404 (the shell still carries the
// friendly not-found view); a known slug stays 200.
test('F-019: unknown service slug is 404 when the prerender slug table exists',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'astra-assets-'));
  fs.mkdirSync(path.join(directory,'assets'));
  fs.writeFileSync(path.join(directory,'index.html'),'<!doctype html><title>Astra</title><div id="root"></div>');
  fs.writeFileSync(path.join(directory,'seo-slugs.json'),JSON.stringify({'1':'holding-tax','2':'family-certificate'}));
  const app=express();app.use(httpHardening);mountWeb(app,directory);
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  try{
    const url=`http://127.0.0.1:${(server.address() as any).port}`;
    assert.equal((await fetch(url+'/services/holding-tax')).status,200);
    assert.equal((await fetch(url+'/services/family-certificate')).status,200);
    const bad=await fetch(url+'/services/no-such-service');
    assert.equal(bad.status,404);
    assert.match(await bad.text(),/Astra/);
  }finally{
    await new Promise<void>(r=>server.close(()=>r()));
    fs.unlinkSync(path.join(directory,'seo-slugs.json'));
    fs.unlinkSync(path.join(directory,'index.html'));fs.rmdirSync(path.join(directory,'assets'));fs.rmdirSync(directory);
  }
});
