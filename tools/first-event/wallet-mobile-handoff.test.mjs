// Actual pinned SDK utility, mocked window only. No SDK initialization, relay,
// wallet app, transaction, pairing URI or key is created by these checks.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const requireSDK = createRequire("/tmp/kleros-walletconnect-build/node_modules/@walletconnect/ethereum-provider/node_modules/@walletconnect/sign-client/package.json");
const entry = requireSDK.resolve("@walletconnect/utils"), pkg = JSON.parse(fs.readFileSync(path.resolve(path.dirname(entry), "../package.json")));
assert.equal(pkg.version, "2.26.0");
const { formatDeeplinkUrl, openDeeplink } = requireSDK("@walletconnect/utils");

for (const telegram of [false, true]) test(`official SDK request handoff uses ${telegram ? "a new context in Telegram" : "the same context in Safari"}`, () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window"), calls = [];
  const win = { open(url, target) { calls.push({ url, target }); }, ...(telegram ? { TelegramWebviewProxy: {} } : {}) };
  win.self = win; win.top = win;
  Object.defineProperty(globalThis, "window", { configurable: true, value: win });
  try {
    const link = formatDeeplinkUrl("metamask://", 123, "synthetic-placeholder-not-a-session");
    openDeeplink(link);
    assert.equal(calls.length, 1); assert.equal(calls[0].target, telegram ? "_blank" : "_self");
    const decoded = new URL(calls[0].url);
    assert.equal(decoded.protocol, "metamask:");
    assert(decoded.searchParams.get("requestId") === "123");
    assert(decoded.searchParams.get("sessionTopic") === "synthetic-placeholder-not-a-session");
  } finally { if (original) Object.defineProperty(globalThis, "window", original); else delete globalThis.window; }
});
