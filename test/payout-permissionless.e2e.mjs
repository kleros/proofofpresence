// Actual browser controller + event-read job transport. Every provider/API reply
// and wallet transaction is synthetic; no public network or real signature.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Interface } from 'ethers';
import { chromium, expect } from '@playwright/test';
import { EVENT } from '../public/first-event/event.js';
import { createEventReadJobService } from '../src/event-read-jobs.mjs';
import { V10_WALLET_CAPABILITIES, V10_WALLET_SUPPORT } from '../src/v10-production-wallets.mjs';

const root=fileURLToPath(new URL('../public/',import.meta.url));
const observed=JSON.parse(await fs.readFile(new URL('../artifacts/v10-integration/metamask-runtime-observed.json',import.meta.url),'utf8'));
const framework=Object.fromEntries(observed.contracts.map(row=>[row.address.toLowerCase(),row.code]));
const origin='http://127.0.0.1:43143', instance='synthetic-payout-both-wallets', event=EVENT;
const owner='0x'+'1'.repeat(40), depositor='0x'+'2'.repeat(40), blockHash='0x'+'b'.repeat(64), txHash='0x'+'a'.repeat(64);
const iface=new Interface(['function releasePayouts()']);
const now=Math.floor(Date.now()/1000), deposit='10000000000000000';
const policy={mode:event.mode,instanceId:instance,contractVersion:event.abiVersion,abiVersion:event.abiVersion,
  chain:{chainId:1},environment:{chainId:1,production:true,network:'ethereum-mainnet'},
  contractProfile:{contractVersion:event.abiVersion,abiVersion:event.abiVersion,version:10,financialModel:'v8',upgradeable:true,verified:true,testOnly:false,chainId:1,challengeWindowSeconds:86400,matchWindowSeconds:86400},
  walletSupport:V10_WALLET_SUPPORT,capabilities:{...V10_WALLET_CAPABILITIES,transactionsReady:false,createEvents:false,manageEvents:false}};
let scenario='fresh', allowDraft=true, requests=[], pageErrors=[], external=[], validated=[], drafts=new Map(), draftNo=0;
const snapshot=()=>({schemaVersion:1,kind:'first-event-depositors',displayOnly:true,eventId:event.id,mode:event.mode,instanceId:instance,
  chainId:1,contract:event.contract,status:scenario==='stale'?'stale':'current',checkedAt:new Date((now-(scenario==='stale'?3600:0))*1000).toISOString(),blockNumber:100,blockHash,
  depositors:[depositor].map((wallet,i)=>({wallet,totalReceivedWei:deposit,deposits:[{txHash:'0x'+String(i+1).repeat(64),logIndex:0,amountWei:deposit,blockNumber:99,blockHash}]})),
  ...(scenario==='missing'?{}:{eventState:{phase:'Listed',owner,eventStart:now-90000,endsAt:now-86401,claimDeadline:now+1000,challengeEndsAt:now-31,challengeDepositWei:deposit,chainTimestamp:now,
    stakers:[depositor].map(wallet=>({wallet,status:1,attended:true,challenge:{state:0,depositWei:'0',matchDeadline:0,localId:'0'}}))}})});

const browser=await chromium.launch({headless:true});
try {
  for(const [role, wallet, delegated, savedState] of [['owner',owner,true,'stale'],['depositor',depositor,false,'missing'],['depositor',depositor,false,'unavailable']]) {
    scenario=savedState;allowDraft=false;
    const session={id:'session-'+role,mode:'wallet',wallet}, context=await browser.newContext({serviceWorkers:'block'});
    const service=createEventReadJobService({instanceId:instance,isSessionCurrent:s=>s===session,
      execute:async(operation,input)=>{
        assert.equal(input.eventId,event.id); assert.equal(input.session,session);
        if(operation==='participant-draft') {
          assert.equal(input.action,'release'); assert.deepEqual(input.params,{});
          if(!allowDraft)throw Object.assign(Error('Synthetic contract not ready'),{code:'STALE_DRAFT'});
          const id='draft-'+ ++draftNo;
          const draft={id,eventId:event.id,action:'release',params:{},wallet,chainId:1,contract:event.contract,
            contractVersion:event.abiVersion,abiVersion:event.abiVersion,valueWei:'0',method:'releasePayouts',args:[],
            summary:'Synthetic release of the event payout',expiresAt:Date.now()+60000,snapshot:'synthetic-fingerprint',scopeKind:'event-call',mode:event.mode,instanceId:instance,origin,
            transaction:{to:event.contract,from:wallet,data:iface.encodeFunctionData('releasePayouts'),value:'0',chainId:1}};
          drafts.set(id,draft);return draft;
        }
        if(operation==='validate') { const d=drafts.get(input.draftId);assert(d);assert.equal(d.wallet,wallet);validated.push({role,transaction:d.transaction});return {transaction:d.transaction}; }
        if(operation==='confirm')return {status:'confirmed',eventId:event.id,wallet,hash:input.hash,blockNumber:101};
        throw Error('Unexpected operation: '+operation);
      },deliver:(_operation,result)=>result});
    await context.addInitScript(({wallet,delegated,framework,blockHash,txHash})=>{
      window.__sends=[];const listeners=new Map();
      window.ethereum={isMetaMask:true,on(name,fn){const a=listeners.get(name)||new Set();a.add(fn);listeners.set(name,a);},removeListener(name,fn){listeners.get(name)?.delete(fn);},
        async request(request){const {method,params=[]}=request;if(['eth_requestAccounts','eth_accounts'].includes(method))return[wallet];
          if(method==='eth_chainId')return'0x1';if(method==='eth_getBlockByNumber')return{number:'0x64',hash:blockHash};
          if(method==='eth_getCode'){const a=String(params[0]).toLowerCase();if(a===wallet.toLowerCase())return delegated?'0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b':'0x';return framework[a]??'0x';}
          if(method==='personal_sign')return'synthetic-auth-signature';if(method==='eth_sendTransaction'){window.__sends.push(params[0]);return txHash;}
          throw Error('Unexpected synthetic wallet method '+method);
        }};
    },{wallet,delegated,framework,blockHash,txHash});
    await context.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());if(url.origin!==origin){external.push(url.origin);return route.abort();}
      const json=(v,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(v)});
      const data=req.method()==='POST'?req.postDataJSON():null;requests.push({role,path:url.pathname,method:req.method(),operation:data?.operation});
      if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><main></main><script type="module">import {mountFirstEventDisplay} from "/first-event-display.js"; mountFirstEventDisplay({root:document.querySelector("main"),view:"${role==='owner'?'organizer':'recovery'}",onReview:()=>{throw Error("old page")}})</script>`});
      if(url.pathname==='/api/first-event/depositors')return scenario==='unavailable'?json({error:'Synthetic saved-state outage'},503):json(snapshot());
      if(url.pathname==='/api/bootstrap')return json({kind:'event-read-transport',enabled:true,chainId:1,contractVersion:event.abiVersion,instanceId:instance,walletContext:policy});
      if(url.pathname==='/api/kickback-setup')return json({kind:'kickback-setup-display',mode:event.mode,instanceId:instance,session:{mode:'wallet',wallet}});
      if(url.pathname===`/api/events/${event.id}/access`)return json({kind:'event-access',eventId:event.id,chainId:1,contract:event.contract,instanceId:instance,wallet,owner,pendingOwner:'0x'+'0'.repeat(40),role:role==='owner'?'owner':'participant',revision:0,admins:[],staff:[],checkins:[]});
      if(url.pathname==='/api/event-read-jobs'&&req.method()==='POST')return json(service.start(session,data));
      if(url.pathname.startsWith('/api/event-read-jobs/'))return json(await service.status(session,url.pathname.split('/').at(-1)));
      if(/\/drafts\/[^/]+\/submitted$/.test(url.pathname))return json({status:'confirmed',eventId:event.id,wallet,hash:txHash,blockNumber:101});
      if(url.pathname.startsWith('/api/')||url.pathname==='/app.js')throw Error('Unexpected old bootstrap or API '+url.pathname);
      const file=path.resolve(root,'.'+url.pathname);assert(file.startsWith(root));return route.fulfill({contentType:url.pathname.endsWith('.css')?'text/css':'text/javascript',body:await fs.readFile(file)});
    });
    const page=await context.newPage();page.on('pageerror',e=>pageErrors.push(e.message));await page.goto(origin);
    await page.locator('[data-manage-connect]').click();await expect(page.locator('[data-manage-wallet]')).toContainText(wallet);
    const release=page.locator('[data-manage-action=release]');await expect(release).toHaveText('Check payout eligibility');await expect(release).toBeEnabled();
    await release.click();await expect(page.locator('[data-manage-status]')).toContainText(/changed|stale|review/i);
    assert.equal(await page.locator('dialog[open]').count(),0,'ineligible contract cannot produce a transaction review');
    assert.equal((await page.evaluate(()=>window.__sends)).length,0,'ineligible contract never asks the wallet');
    allowDraft=true;await release.click();
    const dialog=page.locator('dialog[data-manage-review]');await expect(dialog).toContainText('Release eligible payouts');await expect(dialog).toContainText(wallet);await expect(dialog).toContainText(event.contract);
    assert.equal((await page.evaluate(()=>window.__sends)).length,0,'review preparation does not request a wallet transaction');
    await dialog.locator('[data-manage-confirm]').click();await expect(page.locator('[data-manage-status]')).toContainText('Confirmed transaction');
    const sent=await page.evaluate(()=>window.__sends);assert.equal(sent.length,1);assert.deepEqual(sent[0],{to:event.contract,from:wallet,data:'0x766f8426',value:'0x0',chainId:'0x1'});
    assert.equal(validated.at(-1).role,role);assert.equal(validated.at(-1).transaction.value,'0');
    await page.evaluate(({wallet,event,instance,origin})=>{
      const context={eventId:event.id,wallet,chainId:1,contract:event.contract,abiVersion:event.abiVersion,mode:event.mode,instanceId:instance};
      const key='kleros-first-event-manage-intent:v1:'+[origin,instance,wallet.toLowerCase(),event.id,event.contract.toLowerCase()].map(encodeURIComponent).join(':');
      localStorage.setItem(key,JSON.stringify({phase:'awaiting-wallet',origin,context,draftId:'unresolved-synthetic-payout'}));
    },{wallet,event,instance,origin});
    await page.reload();await expect(page.locator('[data-manage-wallet]')).toContainText(wallet);
    await expect(page.locator('[data-manage-pending]')).toContainText('no recorded hash');
    await expect(page.locator('[data-manage-action=release]')).toBeDisabled();
    assert.equal((await page.evaluate(()=>window.__sends)).length,0,'unresolved original intent blocks another wallet request');
    await context.close();
  }
  assert.deepEqual(pageErrors,[]);assert.deepEqual(external,[]);
  assert.equal(requests.filter(x=>x.path==='/api/event-read-jobs'&&x.operation==='bootstrap').length,0);
  assert.deepEqual(validated.map(x=>x.role),['owner','depositor','depositor']);
  console.log(JSON.stringify({status:'passed',roles:['EIP-7702 owner','EOA depositor'],snapshots:['stale','missing-state','unavailable'],validationCount:validated.length,externalRequests:external.length}));
} finally { await browser.close(); }
