// Explicit one-visit public/static readback. Never authenticate, click, sign or send a transaction.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const origin='https://kleros-luma-ethereum.netlify.app';
const originalHash='0xef60cbf9c65883eb3a1daf6f250bd6cc8328ba655270e897ba17870b1d8a06dc';
const sha=b=>createHash('sha256').update(b).digest('hex');
const comment='<!-- This site is hosted on Netlify. Anyone can build and deploy a site\n'+
  '     like this one for free: https://netlify.new/?utm_campaign=loops&utm_source=ai-legible&utm_medium=owned&utm_content=comment&utm_id=5daad91a-3e1c-44f8-a43e-a42adacd6936\n'+
  '     Netlify hosting facts for this site: static/SSR served via Netlify Edge. -->\n';
function compare(name,actual,expected){
  const info={path:name,rawSha256:sha(actual),expectedSha256:sha(expected),rawExact:actual.equals(expected),transform:'exact-bytes'};
  if(info.rawExact)return {...info,matches:true};
  const offset=71,anchor=Buffer.from('<meta charset="utf-8" />\n'),extra=Buffer.from(comment);
  if(name!=='recovery.html'||expected.indexOf(anchor)+anchor.length!==offset||actual.length!==expected.length+extra.length||
    actual.indexOf(extra)!==offset||actual.lastIndexOf(extra)!==offset||!actual.subarray(offset-anchor.length,offset).equals(anchor))return {...info,matches:false};
  const normalized=Buffer.concat([actual.subarray(0,offset),actual.subarray(offset+extra.length)]);
  return {...info,matches:normalized.equals(expected),transform:'one-exact-reviewed-own-site-comment',removedOffset:offset,removedBytes:extra.length,commentSha256:sha(extra),normalizedSha256:sha(normalized)};
}
const args=process.argv.slice(2);
if(args.length===0){console.log('Review only. Use --execute-readonly --source FULL_COMMIT for one anonymous visit; no auth or financial actions.');}
else{
  assert.equal(args.length,3);assert.equal(args[0],'--execute-readonly');assert.equal(args[1],'--source');assert.match(args[2],/^[0-9a-f]{40}$/);
  const source=execFileSync('git',['rev-parse',args[2]+'^{commit}'],{encoding:'utf8'}).trim();assert.equal(source,args[2]);
  const out=path.resolve('artifacts/recovery-hosting-readonly',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID());await fs.mkdir(out,{recursive:true});
  const proof={kind:'public-recovery-static-and-anonymous-boundary',status:'running',sourceCommit:source,origin,startedAt:new Date().toISOString(),checkerSha256:sha(await fs.readFile(new URL(import.meta.url))),assets:[],api:[],screenshots:[],errors:[],blocked:[],walletRequests:0,authActions:0,financialActions:0,limits:['One anonymous static visit and two unauthenticated GETs only. No original owner signature, private inspection result, adoption or financial compatibility was tested.','Unknown or additional hosting byte transformations fail; the only HTML exception is one exact reviewed own-site non-executable comment at charset offset71.']};
  const expected=name=>execFileSync('git',['show',source+':public/'+name],{maxBuffer:5*1024*1024});
  const staticNames=['recovery.html','recovery-creation.js','setup-progress.js','owned-events.js','app.js','luma-setup.js','luma-launch.css'];
  // Self-check the new HTML's narrow hosting allowance; never rewrite responses delivered to Chromium.
  const html=expected('recovery.html'),extra=Buffer.from(comment),injected=Buffer.concat([html.subarray(0,71),extra,html.subarray(71)]);
  assert.equal(compare('recovery.html',html,html).matches,true);assert.equal(compare('recovery.html',injected,html).matches,true);
  assert.equal(compare('recovery.html',Buffer.concat([injected,Buffer.from('<script>extra()</script>')]),html).matches,false);
  assert.equal(compare('recovery.html',Buffer.concat([injected.subarray(0,71),extra,injected.subarray(71)]),html).matches,false);
  let browser;
  try{
    for(const name of staticNames){const r=await fetch(origin+'/'+name,{redirect:'error',signal:AbortSignal.timeout(35000)});assert.equal(r.status,200);const comparison=compare(name,Buffer.from(await r.arrayBuffer()),expected(name));proof.assets.push(comparison);assert.equal(comparison.matches,true,'SOURCE_MISMATCH:'+name);}
    for(const [route,status,code] of [['/api/recovery/original-creation',401,'UNAUTHENTICATED'],['/api/public-catalog',200,null]]){
      const r=await fetch(origin+route,{redirect:'error',signal:AbortSignal.timeout(35000)}),body=await r.json();assert.equal(r.status,status);
      if(code)assert.equal(body.code,code);else{assert.equal(body.mode,'hosted-production');assert.equal(body.catalog.metadataOnly,true);}
      proof.api.push({method:'GET',path:route,status:r.status,...code?{code:body.code}:{publicEventCount:body.events.length,metadataOnly:true}});
    }
    const {chromium}=await import('@playwright/test');browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});
    await context.addInitScript(()=>{window.__walletRequests=0;Object.defineProperty(window,'ethereum',{get(){window.__walletRequests++;return{request(){window.__walletRequests++;return Promise.reject(Error('No wallet access in read-only check'));}};}});});
    const visibleAssets=new Set(['/recovery.html','/recovery-creation.js','/setup-progress.js','/styles.css','/luma-launch.css','/assets/kleros-logo.svg','/assets/kleros-symbol.svg','/assets/geist-latin.woff2','/assets/geist-mono-latin.woff2','/assets/instrument-serif-regular.woff2','/assets/instrument-serif-italic.woff2']);
    await context.route('**/*',async route=>{const r=route.request(),url=new URL(r.url());if(url.origin!==origin||r.method()!=='GET'||url.search||!visibleAssets.has(url.pathname)){proof.blocked.push({method:r.method(),origin:url.origin,path:url.pathname});await route.abort();}else await route.continue();});
    const page=await context.newPage();page.on('pageerror',e=>proof.errors.push(e.message));await page.goto(origin+'/recovery.html#transaction='+originalHash,{waitUntil:'networkidle'});
    assert.equal(await page.locator('[name=transaction]').inputValue(),originalHash);assert.equal(await page.locator('[data-recovery-facts]').isVisible(),false);assert.equal(await page.locator('[data-recovery-check]').isVisible(),false);assert.match(await page.locator('h1').textContent(),/original event transaction/i);
    for(const [device,size] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){await page.setViewportSize(size);const file=path.join(out,device+'.png');await page.screenshot({path:file,fullPage:true});proof.screenshots.push({device,path:file,sha256:sha(await fs.readFile(file))});}
    proof.walletRequests=await page.evaluate(()=>window.__walletRequests);assert.equal(proof.walletRequests,0);assert.deepEqual(proof.errors,[]);assert.deepEqual(proof.blocked,[]);proof.status='passed';
  }catch(e){proof.status='failed';proof.errors.push(e.message);throw e;}
  finally{await browser?.close();proof.completedAt=new Date().toISOString();await fs.writeFile(path.join(out,'tested-harness.mjs.txt'),await fs.readFile(new URL(import.meta.url)));await fs.writeFile(path.join(out,'proof.json'),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify({status:proof.status,proofPath:path.join(out,'proof.json'),assets:proof.assets.length,apiGets:proof.api.length,walletRequests:proof.walletRequests,authActions:0,financialActions:0,errors:proof.errors},null,2));}
}
