import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { V10_FRONTEND_HEADERS } from "../scripts/prepare-v10-frontend.mjs";

const csp = V10_FRONTEND_HEADERS.split("Content-Security-Policy: ")[1].trim();
const directives = new Map(csp.split(";").map(value => value.trim().split(/\s+/)).filter(row => row[0]).map(([name, ...values]) => [name, values]));

test("WalletConnect policy permits only approved services and local image objects", () => {
  assert.deepEqual(directives.get("script-src"), ["'self'"]);
  assert.deepEqual(directives.get("connect-src"), ["'self'", "https://api.web3modal.org", "https://rpc.walletconnect.org", "https://verify.walletconnect.org", "wss://relay.walletconnect.org"]);
  assert.deepEqual(directives.get("frame-src"), ["'self'", "https://verify.walletconnect.org"]);
  assert.deepEqual(directives.get("img-src"), ["'self'", "data:", "blob:", "https://api.web3modal.org"]);
  assert.deepEqual(directives.get("font-src"), ["'self'"]);
  assert.deepEqual(directives.get("frame-ancestors"), ["'self'"]);
  assert(!csp.includes("unsafe-eval") && !csp.includes("pulse.") && !csp.includes("*."));
});

test("real browser loads a local blob icon while blocking blob scripts and telemetry", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const external = [];
    await page.route("**/*", async route => {
      if (route.request().url() === "https://csp-test.example.invalid/")
        return route.fulfill({ status: 200, contentType: "text/html", headers: { "content-security-policy": csp }, body: "<!doctype html><title>Local CSP probe</title><body></body>" });
      external.push(new URL(route.request().url()).origin);
      return route.abort();
    });
    await page.goto("https://csp-test.example.invalid/");
    const result = await page.evaluate(async () => {
      const violations = [];
      let connectViolation;
      const connectionReport = new Promise(resolve => { connectViolation = resolve; });
      document.addEventListener("securitypolicyviolation", event => {
        violations.push(event.effectiveDirective);
        if (event.effectiveDirective === "connect-src") connectViolation();
      });
      const iconURL = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="white"/></svg>'], { type: "image/svg+xml" }));
      const icon = new Image();
      const loaded = new Promise(resolve => { icon.onload = () => resolve(true); icon.onerror = () => resolve(false); });
      icon.src = iconURL; document.body.append(icon);
      const iconLoaded = await loaded;
      URL.revokeObjectURL(iconURL);
      const scriptURL = URL.createObjectURL(new Blob(["window.__unexpectedBlobScript = true"], { type: "text/javascript" }));
      const script = document.createElement("script");
      const scriptDone = new Promise(resolve => { script.onload = () => resolve(); script.onerror = () => resolve(); });
      script.src = scriptURL; document.body.append(script); await scriptDone;
      URL.revokeObjectURL(scriptURL);
      let telemetryBlocked = false;
      try { await fetch("https://pulse.walletconnect.org/e", { method: "POST", body: "local-policy-probe" }); } catch { telemetryBlocked = true; }
      await Promise.race([connectionReport, new Promise(resolve => setTimeout(resolve, 500))]);
      return { iconLoaded, scriptExecuted: window.__unexpectedBlobScript === true, telemetryBlocked, violations };
    });
    assert.equal(result.iconLoaded, true);
    assert.equal(result.scriptExecuted, false);
    assert.equal(result.telemetryBlocked, true);
    assert(result.violations.some(value => value.startsWith("script-src")));
    assert(result.violations.includes("connect-src"));
    assert.deepEqual(external, []);
  } finally { await browser.close(); }
});
