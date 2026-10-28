import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const source = async (path) => readFile(new URL(path, root), "utf8");

// These execute unchanged legacy functions in a VM with an explicit fake fetch.
// They document why the retained marketing service is outside finance trust.
function between(text, start, end) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, "source markers must exist");
  return text.slice(from, to);
}

test("retained booth demo newsletter work can flush after a live config switch (documented legacy risk)", async () => {
  const html = await source("references/booth/site/index.html");
  const body = between(
    html,
    "  function blogSignup(s)",
    "  function syncAll()",
  );
  const queued = [
    { name: "Synthetic visitor", email: "visitor@example.invalid" },
  ];
  const calls = [];
  const memory = new Map([["blog", queued]]);
  const context = vm.createContext({
    ENDPOINT: "",
    BLOG: { url: "https://invalid.example", label: "synthetic" },
    K_BLOG: "blog",
    blogBusy: false,
    store(key, value) {
      if (value === undefined) return memory.get(key);
      memory.set(key, value);
    },
    fetch: async (url, options) => {
      calls.push({ url, method: options?.method ?? "GET" });
      return { ok: true, status: 200, text: async () => "synthetic-token" };
    },
  });
  vm.runInContext(body, context);
  vm.runInContext("flushBlog()", context);
  assert.equal(calls.length, 0);
  assert.equal(memory.get("blog").length, 1);
  vm.runInContext(
    "ENDPOINT = 'https://invalid.example/endpoint'; flushBlog()",
    context,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    calls.map((call) => call.method),
    ["GET", "POST"],
  );
  assert.equal(memory.get("blog").length, 0);
});

test("retained booth Connect demo queue can flush after config switch (documented legacy risk)", async () => {
  const html = await source("references/booth/site/connect.html");
  const body = between(html, "  function flush()", "  function showStatus(");
  const memory = new Map([
    ["connect", [{ rid: "synthetic-1", email: "visitor@example.invalid" }]],
  ]);
  const calls = [];
  const context = vm.createContext({
    ENDPOINT: "",
    K_QUEUE: "connect",
    busy: false,
    store(key, value) {
      if (value === undefined) return memory.get(key);
      memory.set(key, value);
    },
    fetch: async (url, options) => {
      calls.push({ url, method: options.method });
      return { json: async () => ({ ok: true }) };
    },
  });
  vm.runInContext(body, context);
  await vm.runInContext("flush()", context);
  assert.equal(calls.length, 0);
  assert.equal(memory.get("connect").length, 1);
  await vm.runInContext(
    "ENDPOINT = 'https://invalid.example/endpoint'; flush()",
    context,
  );
  assert.deepEqual(
    calls.map((call) => call.method),
    ["POST"],
  );
  assert.equal(memory.get("connect").length, 0);
});

test("legacy merch status is promotional and accepts client reported quiz/social steps", async () => {
  const backend = await source("references/booth/apps-script/Code.gs");
  const tierBody = between(backend, "function tier_(", "// Reads this row");
  const context = vm.createContext({ gateOn_: () => false });
  vm.runInContext(tierBody, context);
  assert.equal(
    vm.runInContext("tier_({'Claim': 'Claimed'}, 'No')", context),
    "Teal",
  );
  assert.equal(
    vm.runInContext(
      "tier_({'Claim': 'Claimed', 'Telegram check': 'Joined', 'Followed X': 'Tapped', 'Followed LinkedIn': 'Tapped', 'Kleros 101': 'Passed'}, 'No')",
      context,
    ),
    "Gold",
  );
  const verify = between(
    backend,
    "function verify_(d)",
    "/* ---------------------------------------------------------- merch tiers",
  );
  assert.match(verify, /if \(s\.quiz\)/);
  assert.match(verify, /if \(s\.x\)/);
  assert.match(verify, /if \(s\.linkedin\)/);
  assert.doesNotMatch(
    backend,
    /registerStakers|postAttendance|resolveChallenge|ethers\.Contract/,
  );
});
