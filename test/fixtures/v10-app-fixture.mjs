// Real local V10 factory/controller/proxies/store/app. Only public Court metadata/code is mocked.
// Synthetic signing keys stay in this Node closure and are never returned to the browser or files.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import ganache from "ganache";
import { ethers } from "ethers";
import { hash } from "../../src/utils.mjs";
import { createWorkbench } from "../../src/workbench.mjs";
import { startServer } from "../../src/server.mjs";
import { loadV10UpgradeableArtifacts } from "../../src/v10-upgrade-artifacts.mjs";
import { MAINNET_KLEROS, MAINNET_EXTRA_DATA } from "../../scripts/mainnet/verify-kleros.mjs";

export const V10_APP_PROFILE = "kleros-event-v10-uups";
export async function createV10AppFixture({ origin = "https://v10-browser.example.invalid", firstEventManageScope } = {}) {
  assert.equal(new URL(origin).origin, origin); assert.equal(new URL(origin).protocol, "https:");
  const backendOrigin = "https://v10-loopback-backend.example.invalid", proxySecret = "synthetic_v10_browser_proxy_" + "0123456789abcdef".repeat(4);
  let rpc, provider, app, w, organizer, dir, stateFile, auth = null, review = null, armed = null;
  const stats = { providerReads: 0, backendSigningCalls: 0, authSignatures: 0, walletRequests: 0, sent: [] };
  const usedNonces = new Set();
  let runtime, manifest;
  async function close() { await app?.close(); app = null; provider?.destroy(); await rpc?.disconnect(); if (dir) fs.rmSync(dir, { recursive: true, force: true }); }
  try {
    rpc = ganache.provider({ logging: { quiet: true }, chain: { chainId: 1, hardfork: "shanghai" }, miner: { blockGasLimit: 60000000 }, wallet: { totalAccounts: 3, defaultBalance: 1000 } });
    provider = new ethers.BrowserProvider(rpc, undefined, { cacheTimeout: -1 }); provider.pollingInterval = 10;
    const owner = await provider.getSigner(0), a = loadV10UpgradeableArtifacts();
    organizer = new ethers.Wallet(Object.values(rpc.getInitialAccounts())[1].secretKey, provider);
    const deploy = async (artifact, ...args) => { const c = await new ethers.ContractFactory(artifact.abi, artifact.bytecode, owner).deploy(...args, { gasLimit: 16000000 }); await c.waitForDeployment(); return c; };
    const controller = await deploy(a.controller, owner.address), eventImpl = await deploy(a.event), factoryImpl = await deploy(a.factory),
      proxy = await deploy(a.proxy, factoryImpl.target, factoryImpl.interface.encodeFunctionData("initialize", [eventImpl.target, controller.target]));
    const mock = name => JSON.parse(fs.readFileSync(new URL(`../../references/kickback/build/${name}.json`, import.meta.url)));
    const liquidCode = await deploy(mock("MockKlerosLiquid")), resolverCode = await deploy(mock("MockArbitrableProxy"), MAINNET_KLEROS.arbitrator);
    await rpc.request({ method: "evm_setAccountCode", params: [MAINNET_KLEROS.arbitrator, await provider.getCode(liquidCode.target)] });
    await rpc.request({ method: "evm_setAccountCode", params: [MAINNET_KLEROS.resolver, await provider.getCode(resolverCode.target)] });
    const birth = await proxy.deploymentTransaction().wait(), controllerBirth = await controller.deploymentTransaction().wait(),
      policyText = fs.readFileSync(new URL("../../docs/contracts/v10-luma-generic-policy.md", import.meta.url), "utf8");
    const F = { chainId: 1, contractVersion: V10_APP_PROFILE, abiVersion: V10_APP_PROFILE, factory: proxy.target, factoryCodeHash: ethers.keccak256(await provider.getCode(proxy.target)),
      factoryImplementation: factoryImpl.target, factoryImplementationCodeHash: ethers.keccak256(await provider.getCode(factoryImpl.target)), initialFactoryImplementation: factoryImpl.target,
      implementation: eventImpl.target, implementationCodeHash: ethers.keccak256(await provider.getCode(eventImpl.target)), initialImplementation: eventImpl.target,
      upgradeAuthority: controller.target, upgradeAuthorityCodeHash: ethers.keccak256(await provider.getCode(controller.target)), initialUpgradeOwner: owner.address,
      factoryDeploymentTxHash: birth.hash, factoryDeploymentBlock: birth.blockNumber, controllerDeploymentTxHash: controllerBirth.hash, controllerDeploymentBlock: controllerBirth.blockNumber,
      policy: { contractVersion: V10_APP_PROFILE, uri: "https://policy.example.invalid/v10.md", sha256: hash(policyText), text: policyText }, policyStatus: "published" };
    const governance = { kind: "single-owner-immediate", initialOwner: owner.address, upgradeDelaySeconds: 0, renounceable: true };
    manifest = { environment: "production", chain: { chainId: 1, name: "Ethereum", rpcUrl: "https://ethereum.example.invalid", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } },
      factoryDeployment: F, events: [], governance, arbitration: { mode: "kleros-v1", resolver: MAINNET_KLEROS.resolver, arbitrator: MAINNET_KLEROS.arbitrator, extraData: MAINNET_EXTRA_DATA },
      provenance: Object.fromEntries([["v10BuildManifestSha256", "manifest"], ["v10StandardInputSha256", "standard-input"]]
        .map(([key, file]) => [key, hash(JSON.parse(fs.readFileSync(new URL(`../../build/contracts-v10/${file}.json`, import.meta.url))))])) };
    const backend = new Proxy(provider, { get(target, key) {
      if (["getSigner", "listAccounts", "broadcastTransaction"].includes(key)) return async () => { stats.backendSigningCalls++; throw Error("No backend signing"); };
      const value = target[key]; return typeof value === "function" ? (...args) => { stats.providerReads++; return value.apply(target, args); } : value;
    } });
    runtime = { provider: backend, chainId: 1, production: true, signers: [], financialModel: "v8", governance, manifest, factoryDeployment: F, eventVerification: new Map(),
      resolver: new ethers.Contract(MAINNET_KLEROS.resolver, resolverCode.interface, backend), liquid: new ethers.Contract(MAINNET_KLEROS.arbitrator, liquidCode.interface, backend), close: async () => {} };
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "v10-app-browser-")); stateFile = path.join(dir, "v10-state.json");
    await launch();
  } catch (error) { await close(); throw error; }
  async function launch() {
    app = await startServer({ port: 0, rpcPort: 0, production: { manifest, stateFile }, deployment: { mode: "hosted-production", publicOrigin: origin, backendOrigin, proxySecret, runtimeRoot: dir } }, {
      workbenchFactory: async options => { w = await createWorkbench(options, { productionRuntime: async () => runtime,
        ...(firstEventManageScope === undefined ? {} : { firstEventManageScope }) }); return w; },
    });
  }
  async function forward(route, { method = "GET", headers = {}, body } = {}) {
    const url = new URL(route, app.url); assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.protocol, "http:");
    const response = await new Promise((resolve, reject) => {
      const req = http.request(url, { method, agent: false, headers: { host: new URL(backendOrigin).host, "x-kleros-proxy-key": proxySecret,
        ...(headers.cookie ? { cookie: headers.cookie } : {}), ...(method === "GET" ? {} : { origin: headers.origin ?? origin, "content-type": "application/json" }) } }, res => {
        const chunks = []; res.on("data", chunk => chunks.push(chunk)); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      }); req.on("error", reject); req.end(body);
    });
    if (response.headers["content-type"]?.startsWith("application/json")) {
      const data = JSON.parse(response.body.toString("utf8"));
      if (route === "/api/auth/challenge" && method === "POST" && response.status === 200) auth = data;
      if (data.kind === "organizer-job" && data.state === "ready") {
        if (data.operation === "prepare") review = data.result;
        if (data.operation === "validate") review = data.result.draft;
      }
    }
    return response;
  }
  async function wallet(request, callerURL) {
    const url = new URL(callerURL); assert.equal(url.origin, origin);
    const { method, params = [] } = request;
    if (["eth_accounts", "eth_requestAccounts"].includes(method)) return [organizer.address];
    if (method === "eth_chainId") return "0x1";
    if (method === "eth_getBlockByNumber") {
      assert.equal(params.length, 2); assert.equal(params[1], false);
      assert(params[0] === "latest" || /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(params[0]));
      return provider.send(method, params);
    }
    if (method === "eth_getCode") {
      assert.equal(params.length, 2); assert.equal(ethers.getAddress(params[0]), organizer.address);
      assert(/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(params[1]));
      return provider.send(method, params);
    }
    if (method === "personal_sign") {
      assert(auth && auth.expiresAt > Date.now()); assert.equal(params.length, 2);
      const message = ethers.toUtf8String(params[0]); assert.equal(message, auth.message); assert.equal(ethers.getAddress(params[1]), organizer.address);
      assert(message.startsWith("Kleros Ethereum mainnet workbench\n"));
      assert(message.includes(`\nDomain: ${new URL(origin).host}\nURI: ${origin}\nChain ID: 1\nWallet: ${organizer.address}\n`));
      assert(!usedNonces.has(auth.nonce)); usedNonces.add(auth.nonce); stats.authSignatures++;
      return organizer.signMessage(message);
    }
    assert.equal(method, "eth_sendTransaction", "Only nonce auth and one reviewed local CREATE may use the synthetic signer");
    assert.equal(params.length, 1); assert.equal(new URLSearchParams(url.hash.slice(1)).get("setup"), "kickback");
    assert(review && armed === review.id && stats.walletRequests === 0 && review.contractVersion === V10_APP_PROFILE && review.expiresAt > Date.now());
    assert.equal(review.chainId, 1); assert.equal(review.scopeKind, "factory-create"); assert.equal(review.terms.policySha256, manifest.factoryDeployment.policy.sha256);
    assert.deepEqual(params[0], { to: review.transaction.to, from: review.transaction.from, data: review.transaction.data, value: "0x0", chainId: "0x1" });
    assert.equal(review.transaction.to, manifest.factoryDeployment.factory); assert.equal(review.transaction.from, organizer.address);
    assert.equal(await provider.getCode(organizer.address), "0x"); assert.equal(BigInt(await provider.send("eth_chainId", [])), 1n);
    stats.walletRequests++; armed = null;
    const tx = await organizer.sendTransaction(review.transaction);
    stats.sent.push({ hash: tx.hash, draftId: review.id, eventId: review.eventId }); return tx.hash;
  }
  // Test-only local signer. Keys remain in this fixture closure and never reach responses or files.
  async function sendSyntheticTransaction(index, transaction) {
    const accounts = Object.values(rpc.getInitialAccounts());
    assert(Number.isInteger(index) && index >= 0 && index < accounts.length);
    return new ethers.Wallet(accounts[index].secretKey, provider).sendTransaction(transaction);
  }
  return { origin, manifest, provider, stats, organizerAddress: organizer.address, forward, wallet, sendSyntheticTransaction,
    reviewedDraft: () => structuredClone(review), armCreation: id => { assert(review && review.id === id); armed = id; },
    workbench: () => w, savedState: () => fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : null,
    restart: async () => { await app.close(); app = null; auth = null; review = null; await launch(); }, close };
}
