#!/usr/bin/env node
// Builds the public guest deposit page with the live contract baked in.
//
//   node scripts/build-site.mjs [--config config.json] [--out site/dist]
//
// The page never takes the deposit address from the URL or anywhere else at runtime, so a
// look-alike link can't point guests at another address. Re-run after every deploy.
import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";
import { args, loadConfig, klerosConfig, isIpfsPath } from "./lib.mjs";

const a = args();
const cfg = loadConfig(a.config ?? "config.json");
const out = a.out ?? "site/dist";
const isAddr = (x) => /^0x[0-9a-fA-F]{40}$/.test(x || "");
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};
if (!isAddr(cfg.contract) && !a.preview)
  fail('No live "contract" in the config yet. Deploy first, or pass --preview for a page without an address.');
// The page reads each guest's earlier deposits from this block on. Without it, it would search the whole chain,
// which public RPCs refuse, and the page would block every deposit with "couldn't check for an earlier deposit".
const deployBlock = Number(cfg.deployBlock || 0);
if (!a.preview && !(Number.isInteger(deployBlock) && deployBlock > 0))
  fail('No "deployBlock" in the config. Set it to the block number of the deploy transaction (shown on Etherscan), then build again.');
// every read on the page goes through this RPC, before a wallet is even connected
if (!/^https?:\/\//.test(cfg.rpcUrl || "")) fail('No "rpcUrl" in the config: the page needs a public RPC to read the contract.');
const k = klerosConfig(cfg);
const historical = String(cfg.contract).toLowerCase() === "0xd5c6a73c05fa431c748781dabaa99fe2590d677d" || (!cfg.eventId && /^Truth Pays/.test(cfg.eventName || ""));
const lumaUrl = cfg.lumaUrl || (historical ? "https://luma.com/qewnqhas" : "");
if (lumaUrl && !/^https:\/\/luma\.com\/[a-zA-Z0-9/_-]+$/.test(lumaUrl)) fail("lumaUrl must be an explicit HTTPS Luma event URL");
const site = {
  eventId: cfg.eventId || `kickback:${cfg.chainId}:${String(cfg.contract || cfg.receiver).toLowerCase()}`,
  environment: cfg.mode || "local",
  eventName: cfg.eventName || "Event",
  contract: a.preview ? "" : cfg.contract,
  deployBlock: a.preview ? 0 : deployBlock,
  chainId: Number(cfg.chainId),
  // for wallet_addEthereumChain; the page's own text says "Ethereum mainnet"
  chainName: cfg.chainName,
  rpc: cfg.rpcUrl,
  // eth_getLogs is asked for this many blocks at a time (public mainnet RPCs refuse long ranges)
  logChunk: cfg.logChunk,
  explorer: cfg.explorer,
  // the deposit in ETH for the text, and in wei for the checks and the transaction
  deposit: ethers.formatEther(cfg.depositUnits).replace(/\.0$/, ""),
  depositWei: cfg.depositUnits.toString(),
  lumaUrl,
  // Kleros Court v1: the Dispute Resolver the contract must use (checked on the page), KlerosLiquid, the
  // court site, and the IPFS upload service and gateway for evidence
  klerosResolver: k.disputeResolver,
  klerosArbitrator: k.arbitrator,
  klerosCourt: k.courtUrl,
  klerosPolicy: isIpfsPath(k.policyURI) ? k.policyURI : "",
  ipfsUpload: k.ipfsUpload,
  ipfsGateway: k.ipfsGateway,
};
const src = fs.readFileSync(new URL("../site/index.html", import.meta.url), "utf8");
const start = src.indexOf("/*CONFIG*/"), end = src.indexOf("/*END CONFIG*/");
if (start < 0 || end < 0) throw new Error("CONFIG markers missing in site/index.html");
const escapeHtml = (v) => String(v ?? "").replace(/[&<>"']/g, (s) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[s]);
let html = src.slice(0, start) + `/*CONFIG*/\nconst CONFIG = ${JSON.stringify(site, null, 2).replace(/</g, "\\u003c")};\n` + src.slice(end);
if (!historical) {
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(site.eventName)} · Deposit</title>`)
    .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${escapeHtml(site.eventName)} committed spot and attendance disputes.">`)
    .replace(/<header>[\s\S]*?<\/header>/, `<header><span class="eyebrow">Committed Spot deposit · ${escapeHtml(site.chainName)}</span><h1>${escapeHtml(site.eventName)}</h1><div class="meta"><span>${escapeHtml(cfg.scheduleLabel || cfg.eventStart || "See event schedule")}${cfg.timezone ? " · " + escapeHtml(cfg.timezone) : ""}</span><span>${escapeHtml(cfg.venue || "See event venue")}</span><span>${escapeHtml(cfg.hosts || "Event organisers")}</span></div></header>`);
}
// Static HTML copy uses the selected chain; JavaScript uses CONFIG.chainName at runtime.
const scriptStart = html.indexOf("<script>");
if (scriptStart > 0) html = html.slice(0, scriptStart).replace(/Ethereum mainnet/g, escapeHtml(site.chainName)) + html.slice(scriptStart);
html = html.replace('href="https://luma.com/qewnqhas"', `href="${escapeHtml(site.lumaUrl || "#")}"`);
if (!site.lumaUrl) html = html.replace('<div class="row"><a id="luma-link"', '<div class="row" hidden><a id="luma-link"');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "index.html"), html);
console.log(`Wrote ${path.join(out, "index.html")} for contract ${site.contract || "(preview, no address)"} on chain ${site.chainId}, deposit ${site.deposit} ETH`);
