// Actual Manage controller, strict draft guard and durable sender. HTTP and EOA
// provider are synthetic; no real account, external chain or signature is used.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Interface } from "ethers";
import { chromium, expect } from "@playwright/test";
import { EVENT } from "../public/first-event/event.js";
const ROOT = fileURLToPath(new URL("../", import.meta.url)), ORIGIN = "http://127.0.0.1:43139";
const owner = "0x" + "1".repeat(40), admin = "0x" + "2".repeat(40), staff = "0x" + "3".repeat(40), next = "0x" + "4".repeat(40), payer = "0x" + "5".repeat(40), zero = "0x" + "0".repeat(40), blockHash = "0x" + "b".repeat(64);
const instanceId = "synthetic-event-access", sent = [], requests = [], jobs = [], errors = [], external = [], checks = [];
const pass = text => checks.push(text);
let selected = owner, currentOwner = owner, pendingOwner = zero, admins = [], staffList = [], checkins = [], accessRevision = 0, sessionWallet = null, challengeWallet = null, currentDraft = null, draftId = 0;
const policy = { mode: EVENT.mode, instanceId, contractVersion: EVENT.abiVersion, abiVersion: EVENT.abiVersion,
  contractProfile: { contractVersion: EVENT.abiVersion, abiVersion: EVENT.abiVersion, version: 10, financialModel: "v8", upgradeable: true, verified: true, testOnly: false, chainId: 1, challengeWindowSeconds: 86400, matchWindowSeconds: 86400 }, chain: { chainId: 1 }, environment: { chainId: 1, production: true, network: "ethereum-mainnet" }, walletSupport: { type: "eoa-only", eoa: true, eip7702: false, erc1271: false }, capabilities: { production: true, browserWallet: true, walletTransactions: true, serverSigning: false, supportedAccountTypes: ["eoa"], contractWallets: false, eip7702: false, erc1271: false, transactionsReady: false, createEvents: false, manageEvents: false } };
const same = (a,b) => a.toLowerCase() === b.toLowerCase();
const role = wallet => same(wallet,currentOwner) ? "owner" : same(wallet,pendingOwner) ? "pending-owner" : admins.includes(wallet) ? "admin" : staffList.includes(wallet) ? "staff" : "participant";
const access = () => ({ kind: "event-access", eventId: EVENT.id, chainId: 1, contract: EVENT.contract, instanceId, wallet: selected, owner: currentOwner, pendingOwner, role: role(selected), revision: accessRevision,
  admins: role(selected) === "participant" ? [] : admins, staff: role(selected) === "participant" ? [] : staffList, checkins: role(selected) === "participant" ? [] : checkins });
const snapshot = () => ({ schemaVersion: 1, kind: "first-event-depositors", displayOnly: true, eventId: EVENT.id, mode: EVENT.mode, instanceId, chainId: 1, contract: EVENT.contract, status: "current", checkedAt: "2026-10-31T12:00:00.000Z", blockNumber: 100, blockHash,
  depositors: [{ wallet: payer, totalReceivedWei: EVENT.depositWei, deposits: [{ txHash: "0x" + "a".repeat(64), logIndex: 0, amountWei: EVENT.depositWei, blockNumber: 99, blockHash }] }], eventState: { phase: "Open", owner: currentOwner, eventStart: 1, endsAt: 4000000000, claimDeadline: 4000000001, challengeEndsAt: 0, challengeDepositWei: "12345", chainTimestamp: 100,
    stakers: [{ wallet: payer, status: 1, attended: false, challenge: { state: 0, depositWei: "0", matchDeadline: 0, localId: "0" } }] } });
const iface = new Interface(["function transferOwnership(address)", "function acceptOwnership()"]);
let browser;
try {
  browser = await chromium.launch({ headless: true }); const context = await browser.newContext({ viewport: { width: 1150, height: 950 }, serviceWorkers: "block" });
  await context.addInitScript(({ owner, blockHash }) => {
    window.selected = owner; window.walletMethods = []; const listeners = new Map(); window.changeWallet = wallet => { window.selected = wallet; for (const fn of listeners.get("accountsChanged") ?? []) fn([wallet]); };
    window.ethereum = { on(event,fn) { const values=listeners.get(event) ?? []; values.push(fn); listeners.set(event,values); }, removeListener(event,fn) { listeners.set(event,(listeners.get(event)??[]).filter(value=>value!==fn)); }, async request(request) {
      window.walletMethods.push(request.method);
      if (["eth_requestAccounts","eth_accounts"].includes(request.method)) return [window.selected];
      if (request.method === "eth_chainId") return "0x1";
      if (request.method === "eth_getCode") return "0x";
      if (request.method === "eth_getBlockByNumber") return {number:"0x64",hash:blockHash};
      if (request.method === "personal_sign") return "synthetic-event-access-signature";
      if (request.method === "eth_sendTransaction") return window.__send(request.params[0]);
      throw Error("Unexpected wallet method " + request.method);
    } };
  }, { owner, blockHash });
  const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  await page.exposeFunction("__send", tx => { sent.push(tx); return "0x" + String(sent.length).padStart(64,"0"); });
  await context.route("**/*", async route => {
    const req=route.request(), url=new URL(req.url()), input=req.method()==="POST" || req.method()==="PATCH" ? req.postDataJSON() : null;
    requests.push({path:url.pathname,method:req.method(),input});
    if (url.origin !== ORIGIN) { external.push(url.origin); return route.abort(); }
    const json=(data,status=200)=>route.fulfill({status,contentType:"application/json",body:JSON.stringify(data)});
    if (url.pathname === "/") return route.fulfill({contentType:"text/html",body:`<!doctype html><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/luma-launch.css"><main id="root"></main><script type="module">import{mountFirstEventDisplay}from'/first-event-display.js';window.view=mountFirstEventDisplay({root:document.querySelector('#root'),view:'organizer',onReview:()=>{throw Error('No legacy navigation');}});</script>`});
    if (url.pathname === "/api/first-event/depositors") return json(snapshot());
    if (url.pathname === "/api/bootstrap") { assert.equal(url.search,"?background=1"); return json({kind:"event-read-transport",enabled:true,chainId:1,contractVersion:EVENT.abiVersion,instanceId,walletContext:policy}); }
    if (url.pathname === "/api/kickback-setup") return json({kind:"kickback-setup-display",mode:EVENT.mode,instanceId,session:sessionWallet?{mode:"wallet",wallet:sessionWallet}:null});
    if (url.pathname === "/api/auth/challenge") { challengeWallet=input.wallet; return json({nonce:"synthetic-access-nonce",message:"Synthetic event access sign-in"}); }
    if (url.pathname === "/api/auth/verify") { sessionWallet=challengeWallet; return json({wallet:sessionWallet}); }
    if (url.pathname === `/api/events/${EVENT.id}/access`) {
      assert.equal(sessionWallet,selected);
      if (req.method()==="PATCH") { const actorRole=role(selected); assert(actorRole==="owner" || actorRole==="admin" && input.role==="staff"); assert.equal(input.revision,accessRevision); const list=input.role==="admin"?admins:staffList; if(input.enabled) { if(!list.includes(input.wallet)) list.push(input.wallet); } else { const at=list.indexOf(input.wallet); if(at>=0) list.splice(at,1); } accessRevision++; }
      return json(access());
    }
    if (url.pathname === `/api/events/${EVENT.id}/staff-checkins`) { assert(["owner","admin","staff"].includes(role(selected))); assert.equal(input.wallet,payer); assert.match(input.nonce,/^[a-f0-9-]{36}$/); assert.equal(input.note,"Verified this registered wallet was present at the event."); checkins=[{wallet:payer,actorWallet:selected,recordedAt:"2026-11-04T13:00:00.000Z"}]; return json(access()); }
    if (url.pathname === "/api/event-read-jobs" && req.method()==="POST") {
      jobs.push(input); let result;
      if (input.operation==="manage-draft") { assert(input.action==="transferOwnership"?role(selected)==="owner":role(selected)==="pending-owner"); const args=input.action==="transferOwnership"?[input.params.to]:[]; currentDraft={eventId:EVENT.id,wallet:selected,chainId:1,contract:EVENT.contract,abiVersion:EVENT.abiVersion,mode:EVENT.mode,instanceId,origin:ORIGIN,scopeKind:"event-call",contractVersion:EVENT.abiVersion,id:"ownership-"+(++draftId),action:input.action,method:input.action,args,params:input.params,valueWei:"0",snapshot:"synthetic-sealed-access-snapshot",expiresAt:Date.now()+60000,summary:"Synthetic two-step event ownership review",transaction:{from:selected,to:EVENT.contract,chainId:1,data:iface.encodeFunctionData(input.action,args),value:"0"}}; result=currentDraft; }
      else if(input.operation==="validate") result={transaction:currentDraft.transaction};
      else if(input.operation==="confirm") { if(currentDraft.action==="transferOwnership") pendingOwner=currentDraft.params.to; else {currentOwner=selected;pendingOwner=zero;admins=[];staffList=[];accessRevision=0;} result={status:"confirmed",eventId:EVENT.id,chainId:1,contract:EVENT.contract,wallet:selected,instanceId,hash:input.hash,blockNumber:100}; }
      else throw Error("Unexpected job " + input.operation);
      return json({kind:"event-read-job",schemaVersion:1,requestId:input.requestId,operation:input.operation,eventId:EVENT.id,chainId:1,contractVersion:EVENT.abiVersion,instanceId,wallet:selected,state:"ready",expiresAt:Date.now()+30000,result});
    }
    if (/\/drafts\//.test(url.pathname) && url.pathname.endsWith("/submitted")) return json({status:"submitted"});
    if(url.pathname.startsWith("/api/")) throw Error("Unexpected API " + url.pathname);
    const file=path.resolve(ROOT,"public","."+url.pathname); assert(file.startsWith(path.join(ROOT,"public")+path.sep)); return route.fulfill({contentType:file.endsWith(".css")?"text/css":"text/javascript",body:await fs.readFile(file)});
  });
  const switchTo=async wallet=>{selected=wallet;await page.evaluate(wallet=>window.changeWallet(wallet),wallet);await page.locator("[data-manage-connect]").click();await expect(page.locator("[data-manage-wallet]")).toContainText(wallet);};
  const load=async label=>{await page.locator("[data-manage-access-load]").click();await expect(page.locator("[data-manage-access-status]")).toContainText(label);};
  const openTeam=async()=>{const team=page.locator("[data-manage-access]");if(!(await team.evaluate(node=>node.open)))await team.locator(":scope > summary").click();};
  await page.goto(ORIGIN,{waitUntil:"networkidle"});
  assert(requests.filter(item=>item.path.startsWith("/api/")).every(item=>item.path==="/api/first-event/depositors"));
  const beforeConnect=requests.filter(item=>item.path.startsWith("/api/")).length; await page.locator("[data-manage-connect]").click(); await expect(page.locator("[data-manage-wallet]")).toContainText(owner); await page.waitForLoadState("networkidle");
  assert.deepEqual(await page.evaluate(()=>window.walletMethods),["eth_requestAccounts"]); assert.equal(requests.filter(item=>item.path.startsWith("/api/")).length,beforeConnect); await expect(page.locator("[data-manage-final-label]")).toBeHidden(); pass("Connect selects only the account; cached owner alone enables no owner tools");
  await load("Contract owner"); assert.equal((await page.evaluate(()=>window.walletMethods)).filter(value=>value==="personal_sign").length,1); assert.equal(jobs.length,0); pass("Explicit permission loading signs in without a full event bootstrap");
  const grant=async(role,wallet)=>{await openTeam();await page.locator("[data-manage-access-form] input").fill(wallet);await page.locator("[data-manage-access-form] select").selectOption(role);await page.locator("[data-manage-access-form] button").click();await expect(page.locator("[data-manage-status]")).toHaveText("Event access granted.");};
  await grant("admin",admin);await grant("staff",staff);assert.deepEqual(admins,[admin]);assert.deepEqual(staffList,[staff]);assert.equal(sent.length,0);pass("Owner assigns admin and check-in staff through revision-bound metadata only");
  await switchTo(admin);await load("Admin");await expect(page.locator("[data-manage-access-form] option[value=admin]")).toHaveCount(0);await expect(page.locator("[data-manage-transfer-form]")).toHaveCount(0);await expect(page.locator("[data-manage-attendance]")).toBeHidden();await expect(page.locator("[data-manage-final-label]")).toBeHidden();await expect(page.locator("[data-manage-staff-checkin]")).toBeVisible();
  await grant("staff",next);await page.locator(`[data-manage-access-revoke=staff][data-manage-target="${next}"]`).click();await expect(page.locator("[data-manage-status]")).toHaveText("Event access revoked.");assert.deepEqual(staffList,[staff]);pass("Admin grants and revokes staff while owner-only signing tools stay unavailable");
  await switchTo(staff);await load("Check-in staff");await expect(page.locator("[data-manage-access-form]")).toHaveCount(0);await page.locator("[data-manage-staff-checkin]").click();await expect(page.locator("[data-manage-status]")).toContainText("Door check-in recorded");await expect(page.locator("[data-manage-review]")).not.toBeVisible();await expect(page.locator("[data-manage-checkin-state]")).toContainText(staff);assert.equal(sent.length,0);assert.equal(jobs.length,0);pass("One staff Check in click records a nonce-bound off-chain check-in without a review dialog, transaction or final attendance selection");
  await switchTo(owner);await load("Contract owner");await expect(page.locator("[data-manage-attended]")).not.toBeChecked();await openTeam();await page.locator("[data-manage-transfer-form] input").fill(next);await page.locator("[data-manage-transfer-form] button").click();await expect(page.locator("[data-manage-review]")).toContainText(next);await expect(page.locator("[data-manage-review]")).toContainText("0 ETH");await page.locator("[data-manage-confirm]").click();await expect(page.locator("[data-manage-status]")).toContainText("Confirmed transaction");assert.deepEqual(sent[0],{to:EVENT.contract,from:owner,data:iface.encodeFunctionData("transferOwnership",[next]),value:"0x0",chainId:"0x1"});pass("Owner reviews exact recipient and sends zero-ETH two-step transfer through the original sender");
  await page.locator("[data-manage-access] > summary").click();assert.equal(await page.locator("[data-manage-access]").evaluate(node=>node.open),false);
  await switchTo(next);await load("Pending owner");assert.equal(await page.locator("[data-manage-access]").evaluate(node=>node.open),true);await expect(page.locator("[data-manage-access-form]")).toHaveCount(0);await expect(page.locator("[data-manage-staff-checkin]")).toBeHidden();await page.locator('[data-manage-action="acceptOwnership"]').click();await expect(page.locator("[data-manage-review]")).toContainText(next);await page.locator("[data-manage-confirm]").click();await expect(page.locator("[data-manage-status]")).toContainText("Confirmed transaction");assert.deepEqual(sent[1],{to:EVENT.contract,from:next,data:iface.encodeFunctionData("acceptOwnership",[]),value:"0x0",chainId:"0x1"});await load("Contract owner");assert.equal(admins.length+staffList.length,0);pass("Pending owner can accept in the same Manage page; the new owner starts with no old grants");
  await switchTo(owner);await load("Participant");await expect(page.locator("[data-manage-access-form]")).toHaveCount(0);await expect(page.locator("[data-manage-transfer-form]")).toHaveCount(0);await expect(page.locator("[data-manage-attendance]")).toBeHidden();await switchTo(admin);await load("Participant");await expect(page.locator("[data-manage-staff-checkin]")).toBeHidden();pass("Former owner and old admin lose tools after the accepted transfer");
  assert.equal(sent.length,2);assert(jobs.every(job=>["manage-draft","validate","confirm"].includes(job.operation)));assert.deepEqual(errors,[]);assert.deepEqual(external,[]);pass("Only two reviewed ownership sends occur; no legacy navigation, bootstrap or external request runs");
  console.log(JSON.stringify({status:"passed",checks:checks.length,details:checks,sends:sent.length,externalRequests:0}));
}finally{await browser?.close();}
