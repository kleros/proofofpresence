import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { startServer } from "../src/server.mjs";

test("UI assets preserve exact binary fonts and SVGs without exposing arbitrary public files", async () => {
  const server = await startServer({ port: 0, rpcPort: 0 });
  try {
    for (const [name, type] of [
      ["geist-latin.woff2", "font/woff2"],
      ["kleros-logo.svg", "image/svg+xml"],
    ]) {
      const response = await fetch(`${server.url}/assets/${name}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), type);
      assert.deepEqual(
        Buffer.from(await response.arrayBuffer()),
        await fs.readFile(new URL(`../public/assets/${name}`, import.meta.url)),
      );
    }
    assert.equal((await fetch(`${server.url}/reconciliation.js`)).status, 200);
    assert.equal(
      (await fetch(`${server.url}/assets/FONT_PROVENANCE.json`)).status,
      404,
    );
    assert.equal(
      (await fetch(`${server.url}/../PROJECT_BRAIN.md`)).status,
      404,
    );
  } finally {
    await server.close();
  }
});

test("UI pending-reference namespaces receive a stable distinct ID for each server instance", async () => {
  const first = await startServer({ port: 0, rpcPort: 0 });
  let second;
  try {
    second = await startServer({ port: 0, rpcPort: 0 });
    const a = await (await fetch(`${first.url}/api/bootstrap`)).json();
    const same = await (await fetch(`${first.url}/api/bootstrap`)).json();
    const b = await (await fetch(`${second.url}/api/bootstrap`)).json();
    assert.equal(typeof a.instanceId, "string");
    assert.ok(a.instanceId.length > 10);
    assert.equal(a.instanceId, same.instanceId);
    assert.notEqual(a.instanceId, b.instanceId);
  } finally {
    await second?.close();
    await first.close();
  }
});
