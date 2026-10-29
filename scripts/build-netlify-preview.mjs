import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWorkbench } from "../src/workbench.mjs";
import { json } from "../src/utils.mjs";

// Publish only synthetic, read-only projections. This build never loads a live registry,
// accepts user input, exports a signer, or connects to a public chain/provider.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "dist/netlify-preview");
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
await fs.access(path.join(root, "scripts/netlify-preview-client.js"));
const w = await createWorkbench({ rpcPort: 0 });
try {
  const people = ["alice", "bob", "carol"];
  const ownerA = w.session("organizer-a");
  const ownerB = w.session("organizer-b");
  const tx = async (eventId, session, action, params = {}) => {
    const draft = await w.createDraft(eventId, session, { action, params });
    const result = await w.executeDraft(eventId, session, draft.id);
    assert.equal(result.status, "confirmed");
    assert.equal(
      (await w.provider.getTransactionReceipt(result.hash)).status,
      1,
    );
    return result;
  };
  for (const person of people) {
    const session = w.session(person);
    await tx("event-a", session, "deposit");
    await w.admit("event-a", ownerA, `event-a-${person}`, "approved");
  }
  await tx("event-a", ownerA, "register");
  await tx("event-b", w.session("alice"), "deposit");
  await tx("event-b", w.session("carol"), "deposit");
  await w.admit("event-b", ownerB, "event-b-alice", "approved");
  await w.admit("event-b", ownerB, "event-b-bob", "free");
  await tx("event-b", ownerB, "register");
  await w.advance(7201);
  const a = await w.detail("event-a", ownerA);
  const alice = a.participants.find((p) => p.id === "event-a-alice");
  const imported = await w.importCsv("event-a", ownerA, {
    kind: "attendance",
    sourceEventId: "event-a",
    review: {
      confirmed: true,
      note: "Synthetic CSV generated from this exact local event/deployment and participant by the preview build; no external export origin is claimed.",
    },
    csv: `event_id,chain_id,contract,participant_id,email,wallet,checked_in_at\nevent-a,1337,${a.event.contract},${alice.id},${alice.email},${alice.wallet},${new Date(a.now * 1000).toISOString()}\n`,
  });
  assert.equal(imported.errors.length, 0);
  await w.checkin("event-a", w.session("staff-a"), {
    participantId: "event-a-carol",
    nonce: "synthetic-preview-carol-door-observation",
    source: "staff-door",
    note: "Synthetic observation generated for the read-only online preview.",
  });
  await tx("event-a", ownerA, "postAttendance");
  await tx("event-a", w.session("bob"), "challenge");
  await tx("event-a", ownerA, "match", { wallet: w.session("bob").wallet });
  await w.advance(86401);
  await tx("event-a", ownerA, "release");
  const settled = await w.detail("event-a", ownerA);
  const independent = await w.detail("event-b", ownerB);
  assert.equal(settled.state.phase, "Finalized");
  assert.equal(BigInt(settled.state.heldBackWei), 10n ** 16n);
  assert.equal(independent.state.phase, "Open");
  assert.equal(independent.state.cases.length, 0);

  const instanceId = `read-only-preview-${randomUUID()}`;
  const data = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    sourceCommit,
    notice:
      "Read-only snapshots from synthetic local v7 execution. No hosted chain, wallet signing, deposits or personal-data entry.",
    bootstrapByIdentity: {},
    detailsByIdentity: {},
  };
  for (const identity of [
    "anonymous",
    "organizer-a",
    "organizer-b",
    "staff-a",
    ...people,
  ]) {
    const session = identity === "anonymous" ? null : w.session(identity);
    const bootstrap = await w.bootstrap(session);
    bootstrap.mode = "read-only-preview";
    bootstrap.instanceId = instanceId;
    bootstrap.chain.rpcUrl = "";
    bootstrap.capabilities = { readOnly: true, browserWallet: false };
    data.bootstrapByIdentity[identity] = bootstrap;
    data.detailsByIdentity[identity] = {};
    for (const event of bootstrap.events)
      data.detailsByIdentity[identity][event.id] = await w.detail(
        event.id,
        session,
      );
  }
  const serialized = json(data);
  assert.ok(
    !/privateKey|access_token|kleros_session|secretKey|mnemonic/.test(
      serialized,
    ),
  );
  assert.ok(
    !serialized.includes(w.chain.rpcUrl),
    "No local RPC endpoint is exported",
  );
  await fs.rm(output, { recursive: true, force: true });
  await fs.mkdir(output, { recursive: true });
  await fs.cp(path.join(root, "public"), output, { recursive: true });
  const index = (await fs.readFile(path.join(output, "index.html"), "utf8"))
    .replace(
      /<script type="module" src="\/(?:app|entry)\.js"><\/script>/,
      '<script type="module" src="/preview.js"></script>',
    )
    .replace(
      "<title>Kleros · Events & commitments</title>",
      "<title>Kleros · Read-only preview</title>",
    );
  assert.ok(index.includes('src="/preview.js"'));
  await fs.writeFile(path.join(output, "index.html"), index);
  await fs.copyFile(
    path.join(root, "scripts/netlify-preview-client.js"),
    path.join(output, "preview.js"),
  );
  await fs.writeFile(path.join(output, "preview-data.json"), serialized);
  await fs.writeFile(
    path.join(output, "_headers"),
    "/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: same-origin\n  X-Frame-Options: DENY\n  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n",
  );
  console.log(`Built read-only Netlify preview: ${output}`);
  console.log(
    `Actual local receipts verified; A finalized with one 0.01 ETH held share; B independently Open. Source ${sourceCommit}.`,
  );
} finally {
  await w.close();
}
