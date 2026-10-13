import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium,type Page} from 'playwright';
const origin='http://127.0.0.1:5173';
async function launch(){
  const local=path.join(process.env.LOCALAPPDATA??'','ms-playwright');
  const executable=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE??(fs.existsSync(local)?fs.readdirSync(local).filter(n=>/^chromium-/.test(n)).sort().reverse().map(n=>path.join(local,n,'chrome-win64','chrome.exe')).find(p=>fs.existsSync(p)):undefined);
  return chromium.launch({headless:true,executablePath:executable});
}
async function login(page:Page,role:string){await page.goto(origin+'/login');await page.getByLabel('Email',{exact:true}).fill(`${role}@alpha.demo.test`);await page.getByLabel('Password',{exact:true}).fill('Demo-Phase1!');await page.locator('.login-form').getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).waitFor();}
async function nav(page:Page,name:RegExp){await page.getByRole('navigation',{name:'Workspace navigation'}).getByRole('button',{name}).click();}
test('portal browser: responsive profile, searchable applicant and biodata/holding/witness private PDF copies',{timeout:90000},async()=>{
  const browser=await launch(),page=await browser.newPage({viewport:{width:390,height:844}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await login(page,'citizen');await nav(page,/প্রোফাইল|Profile/i);
    await page.getByRole('button',{name:'Save profile',exact:true}).click();await page.getByRole('status').filter({hasText:'Profile saved'}).waitFor();
    await nav(page,/প্রিন্ট|Print/i);
    await page.getByLabel('Find applicant by name or synthetic reference').fill('DEMO-');await page.getByRole('button',{name:'Find applicant',exact:true}).click();
    for(const kind of ['biodata','holding','witness']){
      await page.getByLabel('Copy type',{exact:true}).selectOption(kind);
      if(kind==='holding'){
        await page.getByLabel('Holding number',{exact:true}).fill('DEMO-BROWSER-H1');await page.getByLabel('Owner name (Bangla)',{exact:true}).fill('ডেমো মালিক');await page.getByLabel('Owner name (English)',{exact:true}).fill('Synthetic Owner');await page.getByLabel('Holding address (Bangla)',{exact:true}).fill('ডেমো ঠিকানা');await page.getByLabel('Holding address (English)',{exact:true}).fill('Synthetic holding address');await page.getByLabel('Declared annual value',{exact:false}).fill('100000');
      }
      if(kind==='witness'){
        await page.getByLabel('Deceased name (Bangla)',{exact:true}).fill('ডেমো মৃত ব্যক্তি');await page.getByLabel('Deceased name (English)',{exact:true}).fill('Synthetic Deceased');await page.getByLabel('Witness name (Bangla)',{exact:true}).fill('ডেমো সাক্ষী');await page.getByLabel('Witness name (English)',{exact:true}).fill('Synthetic Witness');await page.getByLabel('Statement (minimum 10 characters)',{exact:true}).fill('Demonstration witness statement, supplied for automated QA only.');
      }
      const saved=page.waitForResponse(r=>r.url().endsWith('/print-requests')&&r.request().method()==='POST');await page.getByRole('button',{name:'Generate private PDF',exact:true}).click();const r=await saved;assert.equal(r.status(),201,await r.text());await page.getByRole('status').filter({hasText:'Copy ready:'}).waitFor();
      const download=page.waitForEvent('download');await page.getByRole('link',{name:'Download PDF',exact:true}).first().click();const downloaded=await download;const file=await downloaded.path();assert.ok(file);assert.equal(fs.readFileSync(file!).subarray(0,4).toString(),'%PDF');
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    fs.mkdirSync('execution/screenshots',{recursive:true});await page.screenshot({path:'execution/screenshots/portal-print-mobile.png',fullPage:true});assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
test('portal browser: finance filters actual reports and downloads private CSV/PDF',{timeout:60000},async()=>{
  const browser=await launch(),page=await browser.newPage({viewport:{width:1440,height:1024}});
  try{
    await login(page,'finance');await nav(page,/প্রতিবেদন|Reports/i);await page.getByRole('link',{name:'Export CSV',exact:true}).waitFor();
    await page.getByLabel('From date',{exact:true}).fill('2020-01-01');await page.getByLabel('To date',{exact:true}).fill('2099-12-31');const response=page.waitForResponse(r=>r.url().includes('/reports?from='));await page.getByRole('button',{name:'Apply date range',exact:true}).click();assert.equal((await response).status(),200);
    for(const type of ['CSV','PDF']){const pending=page.waitForEvent('download');await page.getByRole('link',{name:`Export ${type}`,exact:true}).click();const download=await pending;const file=await download.path();assert.ok(file);const bytes=fs.readFileSync(file!);if(type==='CSV')assert.match(bytes.toString(),/balance_after/);else assert.equal(bytes.subarray(0,4).toString(),'%PDF');}
    await page.screenshot({path:'execution/screenshots/portal-finance-report.png',fullPage:true});
    assert.equal(await page.getByRole('navigation').getByRole('button',{name:/Print requests/i}).count(),0);
  }finally{await browser.close();}
});
