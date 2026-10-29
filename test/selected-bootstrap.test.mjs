import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { execFileSync } from "node:child_process";
import { ethers } from "ethers";
import { startServer } from "../src/server.mjs";
import { localChain, deployEvent, DAY } from "../src/chain.mjs";

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const selectedPath = (eventId) =>
  `/api/bootstrap?selectedEventId=${encodeURIComponent(eventId)}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
async function request(
  app,
  pathname,
  { method = "GET", cookie, body, status = 200 } = {},
) {
  const response = await fetch(app.url + pathname, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(method === "GET"
        ? {}
        : { origin: app.url, "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json();
  assert.equal(
    response.status,
    status,
    `${method} ${pathname}: ${value.code ?? "response"}`,
  );
  assert.equal(response.headers.get("cache-control"), "no-store");
  return {
    value,
    cookie: response.headers.get("set-cookie")?.split(";")[0] ?? cookie,
  };
}
const login = async (app, identity) =>
  (await request(app, "/api/session", { method: "POST", body: { identity } }))
    .cookie;
async function local(version = "truth-pays-v7") {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "selected-bootstrap-local-"),
  );
  const app = await startServer({
    port: 0,
    rpcPort: 0,
    contractVersion: version,
    deployment: { runtimeRoot: path.join(directory, "runtime") },
  });
  return {
    app,
    directory,
    close: async () => {
      await app.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}
function agreement(data, eventId, wallet) {
  const selected = data.selectedEvent;
  assert.equal(data.capabilities.selectedEventBootstrap, true);
  assert.equal(selected.eventId, eventId);
  assert.equal(selected.instanceId, data.instanceId);
  assert.equal(selected.wallet, wallet);
  assert.ok(selected.detail && !selected.error);
  const summary = data.events.find((event) => event.id === eventId);
  assert.deepEqual(summary, selected.detail.event);
  for (const field of [
    "deploymentBlock",
    "contractVersion",
    "abiVersion",
    "policyURI",
    "templateHash",
    "contract",
    "chainId",
  ])
    assert.equal(summary[field], selected.detail.event[field]);
  assert.equal(
    selected.detail.payments.blockNumber,
    selected.detail.state.blockNumber,
  );
  assert.equal(selected.detail.now, selected.detail.state.now);
  assert.equal(
    Object.hasOwn(selected.detail.state, "blockHash"),
    false,
    "The request-only canonical anchor is not a new detail field",
  );
  return selected.detail;
}
function countCalls(app) {
  const provider = app.workbench.provider,
    original = provider.send.bind(provider),
    calls = [];
  provider.send = async (method, params) => {
    calls.push({ method, params });
    return original(method, params);
  };
  return {
    calls,
    reset: () => {
      calls.length = 0;
    },
    restore: () => {
      provider.send = original;
    },
    phase: (address) =>
      calls.filter(
        ({ method, params }) =>
          method === "eth_call" &&
          same(params[0].to, address) &&
          params[0].data === ethers.id("phase()").slice(0, 10),
      ).length,
  };
}

test(
  "v7 opt-in selection preserves default API and shares private-state work without leaking between actors",
  { timeout: 120000 },
  async () => {
    const fixture = await local();
    const { app } = fixture;
    try {
      const original = (await request(app, "/api/bootstrap")).value;
      assert.equal(Object.hasOwn(original, "selectedEvent"), false);
      assert.equal(Object.hasOwn(original, "capabilities"), false);
      assert.deepEqual(
        (await request(app, "/api/bootstrap?unused=1")).value,
        original,
      );
      const anonymous = (
        await request(app, selectedPath("event-a") + "&wallet=organizer-a")
      ).value;
      const publicDetail = agreement(anonymous, "event-a", null);
      assert.deepEqual(publicDetail.participants, []);
      assert.equal(publicDetail.ownWallet, null);
      assert.deepEqual(
        publicDetail,
        (await request(app, "/api/events/event-a")).value,
      );
      const unknown = (await request(app, selectedPath("missing-event"))).value;
      assert.deepEqual(unknown.selectedEvent.error, {
        code: "NOT_FOUND",
        status: 404,
        message: "Unknown event",
      });
      assert.equal(unknown.selectedEvent.detail, null);
      assert.equal(unknown.events.length, 2);
      const malformed = (await request(app, "/api/bootstrap?selectedEventId="))
        .value;
      assert.equal(malformed.selectedEvent.error.status, 400);
      await request(
        app,
        "/api/bootstrap?selectedEventId=event-a&selectedEventId=event-b",
        { status: 400 },
      );
      const cookies = Object.fromEntries(
        await Promise.all(
          ["organizer-a", "organizer-b", "staff-a", "alice", "bob"].map(
            async (actor) => [actor, await login(app, actor)],
          ),
        ),
      );
      const [alice, bob] = await Promise.all(
        ["alice", "bob"].map(async (role) => {
          const data = (
            await request(app, selectedPath("event-a"), {
              cookie: cookies[role],
            })
          ).value;
          const wallet = app.workbench.session(role).wallet;
          const detail = agreement(data, "event-a", wallet);
          assert.equal(detail.participants.length, 1);
          assert.ok(same(detail.participants[0].wallet, wallet));
          assert.equal(detail.permissions.owner, false);
          return detail;
        }),
      );
      assert.notEqual(alice.participants[0].id, bob.participants[0].id);
      const owner = agreement(
        (
          await request(app, selectedPath("event-a"), {
            cookie: cookies["organizer-a"],
          })
        ).value,
        "event-a",
        app.workbench.session("organizer-a").wallet,
      );
      assert.equal(owner.permissions.owner, true);
      assert.equal(owner.participants.length, 3);
      const staff = agreement(
        (
          await request(app, selectedPath("event-a"), {
            cookie: cookies["staff-a"],
          })
        ).value,
        "event-a",
        app.workbench.session("staff-a").wallet,
      );
      assert.equal(staff.permissions.staff, true);
      assert.equal(staff.permissions.owner, false);
      assert.equal(staff.participants.length, 3);
      await request(app, "/api/events/event-a", {
        method: "PATCH",
        cookie: cookies["organizer-a"],
        body: { visibility: "private" },
      });
      for (const cookie of [undefined, cookies["organizer-b"]]) {
        const denied = (await request(app, selectedPath("event-a"), { cookie }))
          .value;
        assert.equal(denied.selectedEvent.detail, null);
        assert.equal(denied.selectedEvent.error.status, 403);
        assert.ok(!denied.events.some((event) => event.id === "event-a"));
        assert.equal(
          JSON.stringify(denied).includes("alice@example.test"),
          false,
        );
      }
      const selectedB = agreement(
        (
          await request(app, selectedPath("event-b"), {
            cookie: cookies["organizer-b"],
          })
        ).value,
        "event-b",
        app.workbench.session("organizer-b").wallet,
      );
      assert.equal(selectedB.permissions.owner, true);
      const counter = countCalls(app),
        address = app.workbench.events.get("event-a").deployment.contract;
      try {
        await request(app, selectedPath("event-a"), {
          cookie: cookies["organizer-a"],
        });
        assert.equal(
          counter.phase(address),
          1,
          "Private selected access, summary and detail share one chainState",
        );
        counter.reset();
        await request(app, "/api/bootstrap", {
          cookie: cookies["organizer-a"],
        });
        await request(app, "/api/events/event-a", {
          cookie: cookies["organizer-a"],
        });
        assert.equal(
          counter.phase(address),
          4,
          "The preserved serial path refreshes private bootstrap access, summary, route access and detail separately",
        );
        console.log(
          "selected-bootstrap: private selected chainState calls1; legacy serial calls4",
        );
      } finally {
        counter.restore();
      }
      await request(app, "/api/session", {
        method: "DELETE",
        cookie: cookies.alice,
      });
      const afterLogout = (
        await request(app, selectedPath("event-a"), { cookie: cookies.alice })
      ).value;
      assert.equal(afterLogout.selectedEvent.wallet, null);
      assert.equal(afterLogout.selectedEvent.detail, null);
      assert.equal(afterLogout.selectedEvent.error.status, 403);
      const defaultAfter = (await request(app, "/api/bootstrap")).value;
      assert.equal(Object.hasOwn(defaultAfter, "selectedEvent"), false);
      assert.equal(Object.hasOwn(defaultAfter, "capabilities"), false);
    } finally {
      await fixture.close();
    }
  },
);

test(
  "v8 selected receipt, own credit and payment facts use one canonical block while the next request sees changed money",
  { timeout: 120000 },
  async () => {
    const fixture = await local("kleros-event-v8"),
      { app } = fixture;
    try {
      const cookie = await login(app, "alice"),
        w = app.workbench,
        signer = w.chain.signers[3],
        wallet = await signer.getAddress();
      const r = w.events.get("event-a"),
        c = w.contract("event-a").connect(signer),
        D = BigInt(r.deployment.depositWei);
      const receipt = await (await c.deposit({ value: D })).wait();
      await request(app, "/api/events/event-a/deposits", {
        method: "POST",
        cookie,
        body: { txHash: receipt.hash },
      });
      const defaults = (await request(app, "/api/bootstrap")).value;
      assert.deepEqual(defaults.capabilities, {
        contractInbox: true,
        batchActions: true,
      });
      const provider = w.provider,
        original = provider.send.bind(provider),
        calls = [];
      let armed = true,
        withdrawnAt;
      provider.send = async (method, params) => {
        calls.push({ method, params });
        if (
          armed &&
          method === "eth_getLogs" &&
          same(params[0].address, r.deployment.contract)
        ) {
          armed = false;
          withdrawnAt = await (await c.withdrawPending(wallet, D)).wait();
        }
        return original(method, params);
      };
      let selected;
      try {
        selected = (await request(app, selectedPath("event-a"), { cookie }))
          .value;
      } finally {
        provider.send = original;
      }
      const detail = agreement(selected, "event-a", wallet),
        block = detail.state.blockNumber;
      assert.ok(withdrawnAt.blockNumber > block);
      assert.equal(detail.ownWallet.pendingCreditWei, String(D));
      assert.equal(detail.state.pendingTotalWei, String(D));
      assert.equal(detail.participants[0].deposit.verified, true);
      assert.equal(detail.payments.pendingCreditWithdrawnWei, "0");
      const phaseCalls = calls.filter(
        ({ method, params }) =>
          method === "eth_call" &&
          same(params[0].to, r.deployment.contract) &&
          params[0].data === c.interface.getFunction("phase").selector,
      );
      assert.equal(phaseCalls.length, 1);
      const pendingCalls = calls.filter(
        ({ method, params }) =>
          method === "eth_call" &&
          same(params[0].to, r.deployment.contract) &&
          params[0].data.startsWith(
            c.interface.getFunction("pendingDeposits").selector,
          ),
      );
      assert.ok(pendingCalls.length >= 3);
      assert.ok(
        pendingCalls.every(({ params }) => BigInt(params[1]) === BigInt(block)),
        "Credit history and own-wallet rechecks stay on the selected block",
      );
      const current = agreement(
        (await request(app, selectedPath("event-a"), { cookie })).value,
        "event-a",
        wallet,
      );
      assert.equal(current.ownWallet.pendingCreditWei, "0");
      assert.equal(current.state.pendingTotalWei, "0");
      assert.equal(current.payments.pendingCreditWithdrawnWei, String(D));
      assert.equal(
        current.participants[0].deposit.verificationState,
        "returned",
      );
      assert.notEqual(current.state.fingerprint, detail.state.fingerprint);
    } finally {
      await fixture.close();
    }
  },
);

test(
  "a slow directory event cannot expose selected private contacts after ownership changes",
  { timeout: 120000 },
  async () => {
    const fixture = await local("kleros-event-v8"),
      { app } = fixture;
    try {
      const oldCookie = await login(app, "organizer-a"),
        nextCookie = await login(app, "organizer-b"),
        w = app.workbench;
      await request(app, "/api/events/event-a", {
        method: "PATCH",
        cookie: oldCookie,
        body: { visibility: "private" },
      });
      const nextOwner = await w.chain.signers[1].getAddress();
      await (
        await w
          .contract("event-a")
          .connect(w.chain.signers[0])
          .transferOwnership(nextOwner)
      ).wait();
      const pendingOwner = agreement(
        (await request(app, selectedPath("event-a"), { cookie: nextCookie }))
          .value,
        "event-a",
        nextOwner,
      );
      assert.equal(pendingOwner.permissions.owner, false);
      assert.deepEqual(
        pendingOwner.participants,
        [],
        "Pending ownership grants private-event access without owner contacts",
      );
      await (
        await w
          .contract("event-a")
          .connect(w.chain.signers[0])
          .transferOwnership(await w.chain.signers[6].getAddress())
      ).wait();
      const revokedPending = (
        await request(app, selectedPath("event-a"), { cookie: nextCookie })
      ).value;
      assert.equal(revokedPending.selectedEvent.detail, null);
      assert.equal(
        revokedPending.selectedEvent.error.status,
        403,
        "Superseded pending ownership cannot reuse prior access",
      );
      const a = w.events.get("event-a").deployment.contract,
        b = w.events.get("event-b").deployment.contract;
      const provider = w.provider,
        original = provider.send.bind(provider),
        blocked = deferred(),
        release = deferred(),
        built = deferred();
      const phase = ethers.id("phase()").slice(0, 10),
        owed = ethers.id("owedTotal()").slice(0, 10),
        owner = ethers.id("owner()").slice(0, 10);
      let owedCalls = 0,
        ownerReads = 0;
      provider.send = async (method, params) => {
        if (
          method === "eth_call" &&
          same(params[0].to, b) &&
          params[0].data === phase
        ) {
          blocked.resolve();
          await release.promise;
        }
        const result = await original(method, params);
        if (method === "eth_call" && same(params[0].to, a)) {
          if (params[0].data === owner) ownerReads++;
          if (params[0].data === owed && ++owedCalls === 2) built.resolve();
        }
        return result;
      };
      let response;
      try {
        const pending = request(app, selectedPath("event-a"), {
          cookie: oldCookie,
        });
        await Promise.race([
          Promise.all([blocked.promise, built.promise]),
          sleep(10000).then(() => {
            throw new Error("Selected detail/directory barrier did not arrive");
          }),
        ]);
        await sleep(40);
        assert.equal(
          ownerReads,
          1,
          "No final owner disclosure guard may finish while directory work is still pending",
        );
        await (
          await w
            .contract("event-a")
            .connect(w.chain.signers[0])
            .transferOwnership(await w.chain.signers[1].getAddress())
        ).wait();
        await (
          await w
            .contract("event-a")
            .connect(w.chain.signers[1])
            .acceptOwnership()
        ).wait();
        release.resolve();
        response = (await pending).value;
      } finally {
        release.resolve();
        provider.send = original;
      }
      assert.equal(response.selectedEvent.detail, null);
      assert.equal(
        response.selectedEvent.error.code,
        "SELECTED_EVENT_ACCESS_CHANGED",
      );
      assert.equal(response.selectedEvent.error.status, 409);
      assert.equal(
        response.events.some((event) => event.id === "event-a"),
        false,
      );
      assert.equal(
        JSON.stringify(response).includes("alice@example.test"),
        false,
      );
      const currentOwner = agreement(
        (await request(app, selectedPath("event-a"), { cookie: nextCookie }))
          .value,
        "event-a",
        await w.chain.signers[1].getAddress(),
      );
      assert.equal(currentOwner.permissions.owner, true);
      assert.equal(currentOwner.participants.length, 3);
      const formerOwner = agreement(
        (await request(app, selectedPath("event-a"), { cookie: oldCookie }))
          .value,
        "event-a",
        await w.chain.signers[0].getAddress(),
      );
      assert.equal(formerOwner.permissions.owner, false);
      assert.deepEqual(formerOwner.participants, []);
    } finally {
      await fixture.close();
    }
  },
);

test(
  "opt-in final disclosure rechecks nonselected directory access after a third event delays the bundle",
  { timeout: 180000 },
  async (t) => {
    for (const kind of [
      "owner-transfer",
      "pending-revoked",
      "staff-revoked",
      "definition-private",
    ]) {
      await t.test(kind, async () => {
        const fixture = await local("kleros-event-v8"),
          { app } = fixture;
        try {
          const w = app.workbench,
            bRecord = w.events.get("event-b"),
            bTitle = bRecord.definition.title;
          bRecord.definition.organizers = [];
          bRecord.definition.staff = [];
          bRecord.definition.visibility =
            kind === "definition-private" ? "public" : "private";
          const actor =
            kind === "owner-transfer"
              ? "organizer-b"
              : kind === "definition-private"
                ? null
                : "staff-a";
          const cookie = actor ? await login(app, actor) : undefined;
          const actorWallet = actor ? w.session(actor).wallet : null;
          const bContract = w.contract("event-b");
          if (kind === "pending-revoked")
            await (
              await bContract
                .connect(w.chain.signers[1])
                .transferOwnership(actorWallet)
            ).wait();
          if (kind === "staff-revoked")
            bRecord.definition.staff = [actorWallet];
          const now = (await w.provider.getBlock("latest")).timestamp;
          const slow = await w.createEvent(w.session("organizer-a"), {
            title: "Synthetic slow directory C",
            slug: "slow-directory-c",
            description: "Ephemeral third event",
            startsAt: new Date((now + 10800) * 1000).toISOString(),
            endsAt: new Date((now + 14400) * 1000).toISOString(),
            timezone: "UTC",
            location: "Synthetic local",
            depositEth: "0.01",
          });
          const initial = (
            await request(app, selectedPath("event-a"), { cookie })
          ).value;
          assert.ok(
            initial.events.some((event) => event.id === "event-b"),
            "The actor can initially see B's real private/public title",
          );
          assert.ok(JSON.stringify(initial).includes(bTitle));
          const a = w.events.get("event-a").deployment.contract,
            b = bRecord.deployment.contract;
          const provider = w.provider,
            original = provider.send.bind(provider),
            blocked = deferred(),
            release = deferred(),
            built = deferred();
          const phase = ethers.id("phase()").slice(0, 10),
            owed = ethers.id("owedTotal()").slice(0, 10),
            owner = ethers.id("owner()").slice(0, 10);
          let owedCalls = 0,
            ownerReadsB = 0,
            phaseReadsB = 0;
          provider.send = async (method, params) => {
            if (
              method === "eth_call" &&
              same(params[0].to, slow.contract) &&
              params[0].data === phase
            ) {
              blocked.resolve();
              await release.promise;
            }
            const result = await original(method, params);
            if (
              method === "eth_call" &&
              same(params[0].to, a) &&
              params[0].data === owed &&
              ++owedCalls === 2
            )
              built.resolve();
            if (method === "eth_call" && same(params[0].to, b)) {
              if (params[0].data === owner) ownerReadsB++;
              if (params[0].data === phase) phaseReadsB++;
            }
            return result;
          };
          let response;
          try {
            const pending = request(app, selectedPath("event-a"), { cookie });
            await Promise.race([
              Promise.all([blocked.promise, built.promise]),
              sleep(10000).then(() => {
                throw new Error(
                  "Nonselected private directory barrier did not arrive",
                );
              }),
            ]);
            await sleep(30);
            assert.equal(
              ownerReadsB,
              1,
              "B's original state read has completed; final authority waits for C",
            );
            if (kind === "owner-transfer") {
              const next = await w.chain.signers[6].getAddress();
              await (
                await bContract
                  .connect(w.chain.signers[1])
                  .transferOwnership(next)
              ).wait();
              await (
                await bContract.connect(w.chain.signers[6]).acceptOwnership()
              ).wait();
            } else if (kind === "pending-revoked") {
              await (
                await bContract
                  .connect(w.chain.signers[1])
                  .transferOwnership(await w.chain.signers[6].getAddress())
              ).wait();
            } else if (kind === "staff-revoked") bRecord.definition.staff = [];
            else bRecord.definition.visibility = "private";
            release.resolve();
            response = (await pending).value;
            assert.equal(
              phaseReadsB,
              1,
              "Final authority checks do not take another full financial snapshot",
            );
            assert.equal(
              ownerReadsB,
              2,
              "Final disclosure re-reads B's current owner cheaply",
            );
          } finally {
            release.resolve();
            provider.send = original;
          }
          const selected = agreement(response, "event-a", actorWallet);
          assert.ok(
            selected && response.events.some((event) => event.id === slow.id),
          );
          assert.equal(
            response.events.some((event) => event.id === "event-b"),
            false,
          );
          assert.equal(
            JSON.stringify(response).includes(bTitle),
            false,
            "Revoked private B's title is absent from the entire opt-in bundle",
          );
        } finally {
          await fixture.close();
        }
      });
    }
  },
);

test(
  "a reorg of only the final authority block cannot disclose a private directory title",
  { timeout: 120000 },
  async () => {
    const fixture = await local("kleros-event-v8"),
      { app } = fixture;
    try {
      const w = app.workbench,
        cookie = await login(app, "organizer-b"),
        bRecord = w.events.get("event-b");
      bRecord.definition.visibility = "private";
      bRecord.definition.organizers = [];
      bRecord.definition.staff = [];
      const b = w.contract("event-b"),
        successor = await w.chain.signers[6].getAddress();
      await (
        await b.connect(w.chain.signers[1]).transferOwnership(successor)
      ).wait();
      const now = (await w.provider.getBlock("latest")).timestamp;
      const c = await w.createEvent(w.session("organizer-a"), {
        title: "Synthetic authority delay C",
        slug: "authority-delay-c",
        description: "Ephemeral authority reorg fixture",
        startsAt: new Date((now + 10800) * 1000).toISOString(),
        endsAt: new Date((now + 14400) * 1000).toISOString(),
        timezone: "UTC",
        location: "Synthetic local",
        depositEth: "0.01",
      });
      const provider = w.provider,
        send = provider.send.bind(provider),
        getBlock = provider.getBlock.bind(provider);
      const selectedAnchor = await getBlock("latest"),
        snapshot = await provider.send("evm_snapshot", []);
      const aAddress = w.events.get("event-a").deployment.contract,
        bTitle = bRecord.definition.title;
      const blocked = deferred(),
        release = deferred(),
        built = deferred();
      const phase = ethers.id("phase()").slice(0, 10),
        owed = ethers.id("owedTotal()").slice(0, 10);
      const authoritySelectors = [
        ethers.id("owner()").slice(0, 10),
        ethers.id("pendingOwner()").slice(0, 10),
      ];
      const targets = [aAddress, bRecord.deployment.contract, c.contract];
      let owedReads = 0,
        authorityReads = 0,
        armed = false,
        authorityBlock,
        replacement;
      provider.getBlock = async (tag) => {
        const block = await getBlock(tag);
        if (
          armed &&
          tag === "latest" &&
          !authorityBlock &&
          block.number > selectedAnchor.number
        )
          authorityBlock = block;
        return block;
      };
      provider.send = async (method, params) => {
        if (
          method === "eth_call" &&
          same(params[0].to, c.contract) &&
          params[0].data === phase
        ) {
          blocked.resolve();
          await release.promise;
        }
        const result = await send(method, params);
        if (
          method === "eth_call" &&
          same(params[0].to, aAddress) &&
          params[0].data === owed &&
          ++owedReads === 2
        )
          built.resolve();
        if (
          authorityBlock &&
          method === "eth_call" &&
          params[1] === ethers.toQuantity(authorityBlock.number) &&
          authoritySelectors.includes(params[0].data) &&
          targets.some((target) => same(target, params[0].to))
        ) {
          authorityReads++;
          if (authorityReads === 6) {
            // All six authority values were read from old N. Replace only N while
            // withholding the final response; the selected monetary block M stays.
            assert.equal(await send("evm_revert", [snapshot]), true);
            replacement = await (
              await b
                .connect(w.chain.signers[6])
                .acceptOwnership({ gasLimit: 500000n })
            ).wait();
          }
        }
        return result;
      };
      let response;
      try {
        const pending = request(app, selectedPath("event-a"), { cookie });
        await Promise.race([
          Promise.all([blocked.promise, built.promise]),
          sleep(10000).then(() => {
            throw new Error("Authority reorg barrier did not arrive");
          }),
        ]);
        await send("evm_mine", []);
        armed = true;
        release.resolve();
        response = (await pending).value;
      } finally {
        release.resolve();
        provider.send = send;
        provider.getBlock = getBlock;
      }
      assert.equal(authorityReads, 6);
      assert.ok(authorityBlock && replacement);
      assert.equal(replacement.blockNumber, authorityBlock.number);
      const [stillSelected, nowAuthority] = await Promise.all([
        getBlock(selectedAnchor.number),
        getBlock(authorityBlock.number),
      ]);
      assert.equal(
        stillSelected.hash,
        selectedAnchor.hash,
        "The selected financial anchor M remains canonical",
      );
      assert.notEqual(
        nowAuthority.hash,
        authorityBlock.hash,
        "Only the newer authority anchor N was reorganized",
      );
      assert.equal(await b.owner(), successor);
      assert.deepEqual(
        response.events,
        [],
        "Untrusted authority data cannot expose any directory summary",
      );
      assert.equal(response.selectedEvent.detail, null);
      assert.equal(response.selectedEvent.error.code, "SELECTED_EVENT_REORG");
      assert.equal(response.selectedEvent.error.status, 409);
      assert.equal(
        JSON.stringify(response).includes(bTitle),
        false,
        "B's private title is not disclosed from an orphan authority block",
      );
      console.log(
        `authority-reorg: selected block ${selectedAnchor.number} unchanged; guard block ${authorityBlock.number} replaced`,
      );
    } finally {
      await fixture.close();
    }
  },
);

test(
  "a logout during a delayed selected request redacts both contacts and the old private directory",
  { timeout: 120000 },
  async () => {
    const fixture = await local("kleros-event-v8"),
      { app } = fixture;
    try {
      const cookie = await login(app, "organizer-a"),
        w = app.workbench;
      await request(app, "/api/events/event-a", {
        method: "PATCH",
        cookie,
        body: { visibility: "private" },
      });
      const provider = w.provider,
        original = provider.send.bind(provider),
        a = w.events.get("event-a").deployment.contract,
        b = w.events.get("event-b").deployment.contract,
        blocked = deferred(),
        release = deferred(),
        built = deferred();
      let owed = 0;
      provider.send = async (method, params) => {
        if (
          method === "eth_call" &&
          same(params[0].to, b) &&
          params[0].data === ethers.id("phase()").slice(0, 10)
        ) {
          blocked.resolve();
          await release.promise;
        }
        const result = await original(method, params);
        if (
          method === "eth_call" &&
          same(params[0].to, a) &&
          params[0].data === ethers.id("owedTotal()").slice(0, 10) &&
          ++owed === 2
        )
          built.resolve();
        return result;
      };
      let response;
      try {
        const pending = request(app, selectedPath("event-a"), { cookie });
        await Promise.race([
          Promise.all([blocked.promise, built.promise]),
          sleep(10000).then(() => {
            throw new Error("Logout privacy barrier did not arrive");
          }),
        ]);
        await request(app, "/api/session", { method: "DELETE", cookie });
        release.resolve();
        response = (await pending).value;
      } finally {
        release.resolve();
        provider.send = original;
      }
      assert.equal(response.session, null);
      assert.deepEqual(response.events, []);
      assert.equal(response.selectedEvent.wallet, null);
      assert.equal(response.selectedEvent.detail, null);
      assert.equal(
        response.selectedEvent.error.code,
        "SELECTED_EVENT_SESSION_CHANGED",
      );
      assert.equal(response.selectedEvent.error.status, 401);
      assert.equal(
        JSON.stringify(response).includes("alice@example.test"),
        false,
      );
    } finally {
      await fixture.close();
    }
  },
);

test(
  "selected read failures and a changed canonical anchor return safe scoped errors while other events remain usable",
  { timeout: 120000 },
  async () => {
    const fixture = await local(),
      { app } = fixture;
    try {
      const provider = app.workbench.provider,
        original = provider.send.bind(provider),
        a = app.workbench.events.get("event-a").deployment.contract;
      provider.send = async (method, params) => {
        if (
          method === "eth_call" &&
          same(params[0].to, a) &&
          params[0].data === ethers.id("phase()").slice(0, 10)
        )
          throw new Error(
            "https://private-provider.invalid/?key=secret alice@example.test private payload",
          );
        return original(method, params);
      };
      let failed;
      try {
        failed = (await request(app, selectedPath("event-a"))).value;
      } finally {
        provider.send = original;
      }
      assert.deepEqual(failed.selectedEvent.error, {
        code: "SELECTED_EVENT_UNAVAILABLE",
        status: 503,
        message: "Selected event is temporarily unavailable",
      });
      assert.equal(failed.selectedEvent.detail, null);
      assert.deepEqual(
        failed.events.map((r) => r.id),
        ["event-b"],
      );
      assert.ok(
        !/secret|private-provider|alice@example/.test(JSON.stringify(failed)),
      );
      const getBlock = provider.getBlock.bind(provider);
      let historicalReads = 0;
      provider.getBlock = async (tag) => {
        const block = await getBlock(tag);
        if (Number.isInteger(tag) && ++historicalReads >= 3)
          return { ...block, hash: ethers.ZeroHash };
        return block;
      };
      let reorg;
      try {
        reorg = (await request(app, selectedPath("event-a"))).value;
      } finally {
        provider.getBlock = getBlock;
      }
      assert.equal(reorg.selectedEvent.detail, null);
      assert.equal(reorg.selectedEvent.error.code, "SELECTED_EVENT_REORG");
      agreement(
        (await request(app, selectedPath("event-a"))).value,
        "event-a",
        null,
      );
    } finally {
      await fixture.close();
    }
  },
);

test(
  "fast-profile HTTPS testnet selection binds actual signed sessions and separate server instances",
  { timeout: 120000 },
  async () => {
    const temp = fs.mkdtempSync(
      path.join(os.tmpdir(), "selected-bootstrap-tls-"),
    );
    const transport = ethers.FetchRequest.createGetUrlFunc();
    let chain, bridge, agent, first, second;
    const methods = [];
    try {
      chain = await localChain(0, { chainId: 10200 });
      const key = path.join(temp, "tls-key.pem"),
        cert = path.join(temp, "tls-cert.pem");
      execFileSync(
        "/usr/bin/openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-keyout",
          key,
          "-out",
          cert,
          "-days",
          "1",
          "-subj",
          "/CN=127.0.0.1",
          "-addext",
          "subjectAltName=IP:127.0.0.1",
        ],
        { stdio: "ignore" },
      );
      fs.chmodSync(key, 0o600);
      bridge = https.createServer(
        { key: fs.readFileSync(key), cert: fs.readFileSync(cert) },
        async (req, res) => {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const body = Buffer.concat(chunks),
            payload = JSON.parse(body);
          for (const entry of Array.isArray(payload) ? payload : [payload])
            methods.push(entry.method);
          const outgoing = http.request(
            chain.rpcUrl,
            { method: "POST", headers: { "content-type": "application/json" } },
            (reply) => {
              res.writeHead(reply.statusCode, {
                "content-type": "application/json",
              });
              reply.pipe(res);
            },
          );
          outgoing.on("error", () => {
            res.writeHead(502);
            res.end();
          });
          outgoing.end(body);
        },
      );
      await new Promise((resolve) => bridge.listen(0, "127.0.0.1", resolve));
      const origin = `https://127.0.0.1:${bridge.address().port}`;
      agent = new https.Agent({ ca: fs.readFileSync(cert) });
      const trusted = ethers.FetchRequest.createGetUrlFunc({ agent });
      ethers.FetchRequest.registerGetUrl((request, signal) => {
        if (new URL(request.url).origin === origin)
          return trusted(request, signal);
        assert.equal(
          new URL(request.url).origin,
          new URL(chain.rpcUrl).origin,
          "Fixture cannot contact any public RPC",
        );
        return transport(request, signal);
      });
      const now = (await chain.provider.getBlock("latest")).timestamp,
        owner = await chain.signers[0].getAddress();
      const definition = {
        id: "selected-fast",
        title: "Synthetic selected fast",
        slug: "selected-fast",
        description: "Synthetic fixture",
        startsAt: new Date((now + 3600) * 1000).toISOString(),
        endsAt: new Date((now + 7200) * 1000).toISOString(),
        timezone: "Asia/Bangkok",
        location: "Synthetic local",
        visibility: "public",
        editorialStatus: "published",
        registrationStatus: "open",
        organizers: [owner],
        staff: [],
      };
      const record = {
        definition,
        ...(await deployEvent(
          chain,
          definition,
          chain.signers[0],
          1_000_000_000_000n,
          now + 3600,
          now + 8 * DAY,
          { contractVersion: "kleros-event-v8-test15m" },
        )),
      };
      const manifest = {
        environment: "testnet",
        chain: {
          chainId: 10200,
          name: "Synthetic Chiado",
          rpcUrl: origin,
          nativeCurrency: {
            name: "Synthetic XDAI",
            symbol: "XDAI",
            decimals: 18,
          },
        },
        arbitration: {
          mode: "controlled",
          resolver: chain.resolver.target,
          arbitrator: chain.liquid.target,
        },
        events: [record],
      };
      const start = (suffix) =>
        startServer({
          port: 0,
          rpcPort: 0,
          contractVersion: "kleros-event-v8-test15m",
          testnet: {
            manifest,
            stateFile: path.join(temp, suffix, "state.json"),
          },
          deployment: {
            mode: "testnet",
            runtimeRoot: path.join(temp, suffix, "runtime"),
          },
        });
      first = await start("first");
      second = await start("second");
      const wallet = ethers.Wallet.createRandom(); // Ephemeral synthetic auth only; no signing file or funding.
      const challenge = (
        await request(first, "/api/auth/challenge", {
          method: "POST",
          body: { wallet: wallet.address },
        })
      ).value;
      assert.ok(
        challenge.message.includes(`URI: ${first.url}\n`) &&
          challenge.message.includes("Chain ID: 10200\n"),
      );
      const cookie = (
        await request(first, "/api/auth/verify", {
          method: "POST",
          body: {
            nonce: challenge.nonce,
            signature: await wallet.signMessage(challenge.message),
          },
        })
      ).cookie;
      await request(first, "/api/events/selected-fast/participants", {
        method: "POST",
        cookie,
        body: {
          name: "Synthetic selected Alice",
          email: "selected-alice@example.test",
        },
        status: 201,
      });
      const defaults = (await request(first, "/api/bootstrap", { cookie }))
        .value;
      assert.equal(defaults.contractProfile.version, 80015);
      assert.equal(defaults.contractProfile.challengeWindowSeconds, 900);
      assert.equal(defaults.capabilities.selectedEventBootstrap, undefined);
      assert.equal(defaults.selectedEvent, undefined);
      const selected = (
        await request(first, selectedPath("selected-fast"), { cookie })
      ).value;
      const detail = agreement(selected, "selected-fast", wallet.address);
      assert.equal(detail.participants.length, 1);
      assert.equal(detail.participants[0].email, "selected-alice@example.test");
      assert.equal(detail.ownWallet.wallet, wallet.address);
      assert.equal(detail.ownWallet.pendingCreditWei, "0");
      const anonymous = agreement(
        (await request(first, selectedPath("selected-fast"))).value,
        "selected-fast",
        null,
      );
      assert.deepEqual(anonymous.participants, []);
      assert.equal(anonymous.ownWallet, null);
      const isolated = (
        await request(second, selectedPath("selected-fast"), { cookie })
      ).value;
      assert.notEqual(isolated.instanceId, selected.instanceId);
      const secondDetail = agreement(isolated, "selected-fast", null);
      assert.deepEqual(secondDetail.participants, []);
      assert.equal(secondDetail.ownWallet, null);
      assert.ok(
        methods.length > 0 &&
          methods.every(
            (method) =>
              !/^(eth_accounts|eth_send|eth_sign|personal_|evm_)/.test(method),
          ),
        "External backend stays strictly read-only",
      );
    } finally {
      await first?.close();
      await second?.close();
      ethers.FetchRequest.registerGetUrl(transport);
      agent?.destroy();
      if (bridge) await new Promise((resolve) => bridge.close(resolve));
      await chain?.close();
      fs.rmSync(temp, { recursive: true, force: true });
    }
  },
);
