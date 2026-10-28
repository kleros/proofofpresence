// Reusable event-scoped console support for the unified local application.
import fs from "node:fs";
import { ethers } from "ethers";
import { loadConfig, klerosConfig, deployArgs, KLEROS } from "./lib.mjs";
import { identity, configHash } from "./provenance.mjs";
export function consoleSettings(file) {
  const raw = fs.readFileSync(file, "utf8");
  const out = { configHash: ethers.id(raw) };
  let cfg, k;
  try { cfg = loadConfig(file); k = klerosConfig(cfg); }
  catch (e) { return { ...out, error: e.message }; }
  Object.assign(out, { ...identity(cfg), provenanceConfigHash: configHash(cfg),
    chainId: cfg.chainId, chainName: cfg.chainName, rpcUrl: cfg.rpcUrl, explorer: cfg.explorer,
    symbol: cfg.symbol, deposit: cfg.deposit, depositWei: cfg.depositUnits,
    poolCap: cfg.poolCap ?? null, poolCapWei: cfg.poolCapUnits ?? null,
    logChunk: cfg.logChunk, deployBlock: cfg.deployBlock ?? null,
    kleros: k, knownKleros: KLEROS[cfg.chainId] ?? null });
  try { out.deployArgs = deployArgs(cfg, ethers.ZeroAddress); }
  catch (e) { out.deployError = e.message; }
  return out;
}
export function renderConsole(basePath, title = "Event") {
  if (!/^\/[a-zA-Z0-9/_-]*$/.test(basePath) || basePath.includes("..")) throw new Error("Invalid console mount path");
  const prefix = basePath.replace(/\/$/, "");
  const safeTitle = String(title).replace(/[&<>"']/g, (s) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[s]);
  return fs.readFileSync(new URL("../console/index.html", import.meta.url), "utf8")
    .replace(/(["'])\/(config\.json|settings\.json|build\/|out\/|node_modules\/)/g, `$1${prefix}/$2`)
    .replace(/Truth Pays ·/g, `${safeTitle} ·`);
}
