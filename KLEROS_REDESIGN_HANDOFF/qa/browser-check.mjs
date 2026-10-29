// Prepared for Codex. This script was NOT executed in the design-preparation session.
// It opens only the self-contained prototype on a temporary localhost server.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const out=path.join(here,'browser-results');fs.mkdirSync(out,{recursive:true});
const files={'/':'KLEROS_REDESIGN_PROTOTYPE.html','/options':'DESIGN_OPTIONS.html'};
const server=http.createServer((req,res)=>{const p=new URL(req.url,'http://localhost').pathname;if(!files[p]){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(fs.readFileSync(path.join(root,files[p])));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true});
const results=[];const errors=[];const blocked=[];
async function step(name,fn){try{await fn();results.push({name,status:'passed'});}catch(e){results.push({name,status:'failed',error:e.message});}}
try{
 for(const viewport of [{width:1440,height:900},{width:400,height:800}]){
  const label=viewport.width+'x'+viewport.height;
  const context=await browser.newContext({viewport,reducedMotion:'reduce',serviceWorkers:'block'});
  await context.route('**/*',route=>{const url=route.request().url();if(url.startsWith(origin+'/')||url.startsWith('data:'))return route.continue();blocked.push(url);return route.abort();});
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push({viewport:label,type:'pageerror',message:e.message}));
  page.on('console',m=>{if(m.type()==='error')errors.push({viewport:label,type:'console',message:m.text()});});
  const noOverflow=async()=>{const x=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));assert.ok(x.scroll<=x.client+1,'Page overflow: '+JSON.stringify(x));};
  const capture=async name=>{await page.screenshot({path:path.join(out,label+'-'+name+'.png'),fullPage:false});};
  const setScenario=async value=>{await page.getByLabel('Participant scenario',{exact:true}).selectOption(value);await noOverflow();};
  await page.goto(origin,{waitUntil:'load'});await page.evaluate(()=>document.fonts.ready);
  await step(label+' public entry, font loading and no page overflow',async()=>{await noOverflow();assert.equal(await page.locator('.event-card').count(),2);assert.ok(await page.evaluate(()=>document.fonts.check('16px Geist')&&document.fonts.check('32px "Instrument Serif"')));await capture('discover');});
  await step(label+' empty search and recovery',async()=>{await page.getByLabel('Search events',{exact:true}).fill('no-such-event');await page.getByRole('heading',{name:'No matching events'}).waitFor();await page.getByRole('button',{name:'Clear filters',exact:true}).click();assert.equal(await page.locator('.event-card').count(),2);});
  const values=await page.locator('#scenario option').evaluateAll(es=>es.map(e=>e.value));
  for(const value of values)await step(label+' scenario '+value,async()=>{await setScenario(value);assert.equal(await page.locator('.side-card').count(),1);const overflow=await page.locator('.side-card').evaluate(el=>el.scrollWidth>el.clientWidth+1);assert.equal(overflow,false,'Participant panel overflows');});
  await step(label+' gated deposit modal, focus containment and pending state',async()=>{await setScenario('ready');await page.getByRole('button',{name:'Review 0.01 ETH deposit',exact:true}).click();const dialog=page.getByRole('dialog');assert.equal(await dialog.getByRole('button',{name:'Simulate wallet approval'}).isEnabled(),false);await dialog.getByLabel('I understand that a deposit receipt does not confirm admission.').check();await dialog.getByRole('button',{name:'Simulate wallet approval'}).focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>!!document.activeElement?.closest('[role="dialog"]')),true);await capture('deposit-review');await dialog.getByRole('button',{name:'Simulate wallet approval'}).click();await page.getByRole('heading',{name:'Deposit submitted',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:/Review .* ETH deposit/}).count(),0);});
  await step(label+' registered participant view',async()=>{await setScenario('registered');await capture('participant-confirmed');});
  await step(label+' wrong-event import cannot be approved',async()=>{await page.getByRole('button',{name:'Organizer demo',exact:true}).click();await page.getByRole('tab',{name:'Guest imports',exact:true}).click();await page.getByRole('button',{name:'Try wrong-event fixture',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Review import plan',exact:true}).isEnabled(),false);await noOverflow();await capture('wrong-event-import');});
  await step(label+' unidentified source review and event-switch reset',async()=>{await page.getByRole('button',{name:'Try unidentified CSV',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Review import plan',exact:true}).isEnabled(),false);await page.locator('#provenance-review').check();await page.getByRole('button',{name:'Review import plan',exact:true}).click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');await page.getByLabel('Selected event',{exact:true}).selectOption('b');await page.getByRole('button',{name:'Load matching fixture',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Review import plan',exact:true}).isEnabled(),false);await page.getByLabel('Simulated organizer role',{exact:true}).selectOption('owner-b');assert.equal(await page.getByRole('button',{name:'Review import plan',exact:true}).isEnabled(),true);});
  await step(label+' Event B owner can record check-in',async()=>{await page.getByRole('tab',{name:'Check-in',exact:true}).click();await page.getByRole('button',{name:'Record check-in',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Record check-in',exact:true}).count(),0);await noOverflow();});
  await step(label+' payout obligations and case zero-ruling copy',async()=>{await page.getByRole('button',{name:'Reset demo',exact:true}).click();await page.getByRole('button',{name:'Organizer demo',exact:true}).click();await page.getByRole('tab',{name:'Payouts & cases',exact:true}).click();await noOverflow();await capture('payouts');await page.getByRole('button',{name:'Open example case →',exact:true}).click();await page.getByRole('button',{name:'Refused to arbitrate',exact:true}).click();await page.getByRole('heading',{name:'No attendance payout',exact:true}).waitFor();await noOverflow();await capture('case-refused');});
  await step(label+' focus visible and reduced motion',async()=>{await page.getByRole('button',{name:'Reset demo',exact:true}).focus();const style=await page.getByRole('button',{name:'Reset demo',exact:true}).evaluate(el=>({outline:getComputedStyle(el).outlineStyle,width:getComputedStyle(el).outlineWidth,height:el.getBoundingClientRect().height}));assert.notEqual(style.outline,'none');assert.ok(parseFloat(style.width)>=2);assert.ok(style.height>=44);assert.ok(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches));});
  await step(label+' options comparison renders without page overflow',async()=>{await page.goto(origin+'/options',{waitUntil:'load'});await page.evaluate(()=>document.fonts.ready);await noOverflow();await capture('options');});
  await context.close();
 }
 await step('No unexpected network attempts or browser errors',async()=>{assert.deepEqual(blocked,[]);assert.deepEqual(errors,[]);});
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
const report={executedAt:new Date().toISOString(),scope:'Local prototype browser checks only; no live app, wallet, contract or production verification',passed:results.filter(x=>x.status==='passed').length,failed:results.filter(x=>x.status==='failed').length,errors,blocked,results};
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
if(report.failed)process.exitCode=1;
