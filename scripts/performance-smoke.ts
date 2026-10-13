import {app} from '../apps/api/src/app.js';
import {mountWeb} from '../apps/api/src/web-assets.js';
import {pool} from '../apps/api/src/db.js';
import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
mountWeb(app);
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const origin=`http://127.0.0.1:${(server.address() as any).port}`;
const local=path.join(process.env.LOCALAPPDATA??'','ms-playwright');
const executable=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE??(fs.existsSync(local)?fs.readdirSync(local).filter(n=>/^chromium-/.test(n)).sort().reverse().map(n=>path.join(local,n,'chrome-win64','chrome.exe')).find(p=>fs.existsSync(p)):undefined);
const browser=await chromium.launch({headless:true,executablePath:executable});
try{
  const results=[];
  for(const viewport of [{width:1440,height:1024},{width:390,height:844}]){
    const page=await browser.newPage({viewport});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin,{waitUntil:'networkidle'});
    const metrics=await page.evaluate(()=>{const nav=performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;const resources=performance.getEntriesByType('resource') as PerformanceResourceTiming[];return {domContentLoadedMs:Math.round(nav.domContentLoadedEventEnd),loadMs:Math.round(nav.loadEventEnd),firstContentfulPaintMs:Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime??0),transferredBytes:resources.reduce((n,r)=>n+r.transferSize,nav.transferSize),horizontalOverflow:document.documentElement.scrollWidth>innerWidth+1};});
    results.push({viewport,...metrics,errors});await page.close();
  }
  const timings:number[]=[];
  for(let batch=0;batch<10;batch++)await Promise.all(Array.from({length:10},async()=>{const start=performance.now();const response=await fetch(origin+'/api/v1/offices?pageSize=12');if(!response.ok)throw Error('Public directory request failed');await response.arrayBuffer();timings.push(performance.now()-start);}));
  timings.sort((a,b)=>a-b);const report={date:new Date().toISOString(),environment:'Local Windows/Chromium; built frontend; loopback. Not production load or field Core Web Vitals.',pages:results,directoryRequests:100,concurrency:10,directoryMedianMs:Math.round(timings[50]!),directoryP95Ms:Math.round(timings[94]!),assets:JSON.parse(fs.readFileSync('execution/asset-sizes.json','utf8')).assets};
  fs.writeFileSync('execution/performance-smoke.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  if(results.some(r=>r.horizontalOverflow||r.errors.length))throw Error('Built frontend has a visible/error regression.');
}finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));await pool.end();}
