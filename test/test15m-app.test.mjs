import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { execFileSync } from "node:child_process";
import { ethers } from "ethers";
import {
  localChain,
  deployEvent,
  verifyDeployment,
  contractFor,
  chainState,
  DAY,
} from "../src/chain.mjs";
import { startServer } from "../src/server.mjs";

const FAST = "kleros-event-v8-test15m";
const financial = (state) =>
  Object.fromEntries(
    Object.entries(state).filter(
      ([key]) => !["now", "blockNumber"].includes(key),
    ),
  );
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

// Real HTTP, self-signed HTTPS transport and chain10200 all remain on ephemeral
// loopback listeners. No public RPC, manifest, signing file or C state is read.
test(
  "actual local fast-profile testnet HTTP supports signed deposits, batch admission, safe credit recovery and canonical 900-second windows",
  { timeout: 240_000 },
  async () => {
    const temporary = fs.mkdtempSync(
      path.join(os.tmpdir(), "kleros-fast-app-"),
    );
    const originalTransport = ethers.FetchRequest.createGetUrlFunc();
    let chain, bridge, app, agent;
    const bridgeMethods = [],
      broadcasts = [];
    try {
      chain = await localChain(0, { chainId: 10200 });
      assert.equal(new URL(chain.rpcUrl).hostname, "127.0.0.1");
      assert.equal(Number((await chain.provider.getNetwork()).chainId), 10200);
      const keyFile = path.join(temporary, "tls-key.pem"),
        certFile = path.join(temporary, "tls-cert.pem");
      execFileSync(
        "/usr/bin/openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-keyout",
          keyFile,
          "-out",
          certFile,
          "-days",
          "1",
          "-subj",
          "/CN=127.0.0.1",
          "-addext",
          "subjectAltName=IP:127.0.0.1",
        ],
        { stdio: "ignore" },
      );
      fs.chmodSync(keyFile, 0o600);
      const certificate = fs.readFileSync(certFile);
      bridge = https.createServer(
        { key: fs.readFileSync(keyFile), cert: certificate },
        async (req, res) => {
          try {
            assert.equal(req.method, "POST");
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const body = Buffer.concat(chunks),
              payload = JSON.parse(body);
            for (const entry of Array.isArray(payload) ? payload : [payload])
              bridgeMethods.push(entry.method);
            const forwarding = http.request(
              chain.rpcUrl,
              {
                method: "POST",
                headers: { "content-type": "application/json" },
              },
              (reply) => {
                res.writeHead(reply.statusCode, {
                  "content-type": "application/json",
                });
                reply.pipe(res);
              },
            );
            forwarding.on("error", () => {
              res.writeHead(502);
              res.end();
            });
            forwarding.end(body);
          } catch {
            res.writeHead(500, { "content-type": "application/json" });
            res.end(
              JSON.stringify({
                error: "Local fast-profile test bridge failed",
              }),
            );
          }
        },
      );
      await new Promise((resolve, reject) => {
        bridge.once("error", reject);
        bridge.listen(0, "127.0.0.1", resolve);
      });
      const rpcOrigin = `https://127.0.0.1:${bridge.address().port}`;
      agent = new https.Agent({ ca: certificate });
      const trustedTransport = ethers.FetchRequest.createGetUrlFunc({ agent });
      ethers.FetchRequest.registerGetUrl((request, signal) => {
        const origin = new URL(request.url).origin;
        if (origin === rpcOrigin) return trustedTransport(request, signal);
        assert.equal(
          origin,
          new URL(chain.rpcUrl).origin,
          "The fast app test cannot contact an external provider",
        );
        return originalTransport(request, signal);
      });
      const now = (await chain.provider.getBlock("latest")).timestamp;
      const start = now + 3600,
        deadline = start + 15 * DAY,
        D = 1_000_000_000_000n;
      const addresses = await Promise.all(
        chain.signers.map((signer) => signer.getAddress()),
      );
      const accounts = chain.server.provider.getInitialAccounts();
      const wallet = (index) =>
        new ethers.Wallet(
          accounts[addresses[index].toLowerCase()].secretKey,
          chain.provider,
        );
      const owner = wallet(0),
        staff = wallet(2),
        alice = wallet(3),
        bob = wallet(4),
        unlinked = wallet(6),
        recipient = addresses[8];
      const definition = (id, creator, staffAddresses = []) => ({
        id,
        slug: id,
        title: `Synthetic ${id}`,
        description: "Actual local fast-profile HTTP fixture",
        startsAt: new Date(start * 1000).toISOString(),
        endsAt: new Date((start + 3600) * 1000).toISOString(),
        timezone: "UTC",
        location: "Synthetic isolated venue",
        visibility: "public",
        editorialStatus: "published",
        registrationStatus: "open",
        organizers: [creator],
        staff: staffAddresses,
      });
      const fastDefinition = definition("local-fast-http", owner.address, [
        staff.address,
      ]);
      const fast = {
        definition: fastDefinition,
        ...(await deployEvent(
          chain,
          fastDefinition,
          chain.signers[0],
          D,
          start,
          deadline,
          { contractVersion: FAST },
        )),
      };
      const normalDefinition = definition("local-normal-control", addresses[1]);
      const normal = {
        definition: normalDefinition,
        ...(await deployEvent(
          chain,
          normalDefinition,
          chain.signers[1],
          D,
          start,
          deadline,
          { contractVersion: "kleros-event-v8" },
        )),
      };
      const v7Definition = definition("local-v7-control", addresses[1]);
      const historical = {
        definition: v7Definition,
        ...(await deployEvent(
          chain,
          v7Definition,
          chain.signers[1],
          D,
          start,
          deadline,
          { contractVersion: "truth-pays-v7" },
        )),
      };
      for (const record of [fast, normal, historical])
        await verifyDeployment(chain, record.deployment);
      const event = contractFor(chain, fast.deployment),
        normalEvent = contractFor(chain, normal.deployment);
      assert.equal(await event.VERSION(), 80015n);
      assert.equal(await event.CHALLENGE_PERIOD(), 900n);
      assert.equal(await event.MATCH_PERIOD(), 900n);
      assert.equal(await event.eventStart(), BigInt(start));
      assert.equal(await event.claimDeadline(), BigInt(deadline));
      assert.equal(await normalEvent.VERSION(), 8n);
      assert.equal(await normalEvent.CHALLENGE_PERIOD(), 86400n);
      assert.equal(await normalEvent.MATCH_PERIOD(), 86400n);
      const controlRecord = (record) => ({
        ...record,
        participants: new Map(),
        publications: new Map(),
      });
      const normalBefore = financial(
          await chainState(chain, controlRecord(normal)),
        ),
        v7Before = financial(
          await chainState(chain, controlRecord(historical)),
        );
      const manifest = {
        environment: "testnet",
        chain: {
          chainId: 10200,
          name: "Chiado",
          rpcUrl: rpcOrigin,
          nativeCurrency: { name: "Test xDAI", symbol: "XDAI", decimals: 18 },
        },
        arbitration: {
          mode: "controlled",
          resolver: chain.resolver.target,
          arbitrator: chain.liquid.target,
        },
        events: [fast],
      };
      const stateFile = path.join(temporary, "state", "fast-state.json");
      app = await startServer({
        port: 0,
        rpcPort: 0,
        contractVersion: FAST,
        testnet: { manifest, stateFile },
        deployment: {
          mode: "testnet",
          runtimeRoot: path.join(temporary, "runtime"),
        },
      });
      assert.equal(new URL(app.url).hostname, "127.0.0.1");
      const base = `/api/events/${fastDefinition.id}`;
      const request = async (
        pathname,
        { method = "GET", cookie, body, status = 200 } = {},
      ) => {
        const response = await fetch(app.url + pathname, {
          method,
          headers: {
            ...(cookie ? { cookie } : {}),
            ...(method !== "GET"
              ? { origin: app.url, "content-type": "application/json" }
              : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const data = await response.json();
        assert.equal(
          response.status,
          status,
          `${method} ${pathname}: ${data.code ?? "response"}`,
        );
        return {
          data,
          cookie: response.headers.get("set-cookie")?.split(";")[0] ?? cookie,
        };
      };
      const login = async (actor) => {
        const challenge = (
          await request("/api/auth/challenge", {
            method: "POST",
            body: { wallet: actor.address },
          })
        ).data;
        assert.ok(
          challenge.message.includes(`URI: ${app.url}\n`) &&
            challenge.message.includes("Chain ID: 10200\n") &&
            challenge.message.includes(`Wallet: ${actor.address}\n`),
        );
        return (
          await request("/api/auth/verify", {
            method: "POST",
            body: {
              nonce: challenge.nonce,
              signature: await actor.signMessage(challenge.message),
            },
          })
        ).cookie;
      };
      const boot = (await request("/api/bootstrap")).data;
      assert.equal(boot.mode, "testnet");
      assert.deepEqual(boot.identities, []);
      assert.equal(boot.contractVersion, FAST);
      assert.equal(boot.chain.chainId, 10200);
      assert.equal(boot.chain.nativeCurrency.symbol, "XDAI");
      for (const flag of ["contractInbox", "batchActions"])
        assert.equal(
          boot.capabilities[flag],
          true,
          `${FAST} must expose its v8 ${flag} capability`,
        );
      for (const item of [
        boot.contractProfile,
        boot.events[0].contractProfile,
      ]) {
        assert.equal(item.contractVersion, FAST);
        assert.equal(item.version, 80015);
        assert.equal(item.challengeWindowSeconds, 900);
        assert.equal(item.matchWindowSeconds, 900);
        assert.equal(item.chainId, 10200);
        assert.equal(item.testOnly, true);
      }
      assert.equal(boot.events[0].abiVersion, FAST);
      assert.equal(Date.parse(boot.events[0].startsAt) / 1000, start);
      assert.equal(boot.events[0].depositDeadline, start);
      assert.equal(boot.events[0].claimDeadline, deadline);
      for (const asset of [
        "/contract-profiles.js",
        "/batch-pending.js",
        "/batch-actions.js",
        "/contract-inbox.js",
        "/policies/v8-test15m.md",
      ]) {
        const response = await fetch(app.url + asset);
        assert.equal(response.status, 200, asset);
        const source = await response.text();
        assert.ok(source.length > 0);
        if (asset.endsWith("v8-test15m.md"))
          assert.match(source, /TEST ONLY.*Chiado[\s\S]*900/);
        if (asset === "/contract-profiles.js") assert.ok(source.includes(FAST));
      }
      const ownerCookie = await login(owner),
        staffCookie = await login(staff),
        aliceCookie = await login(alice),
        bobCookie = await login(bob),
        unlinkedCookie = await login(unlinked);
      await request(`/finance/${fastDefinition.id}/guest/config.json`, {
        cookie: ownerCookie,
        status: 409,
      });
      const detail = async (cookie) => (await request(base, { cookie })).data;
      const sendReviewed = async (cookie, actor, action, params = {}) => {
        assert.equal(
          Number((await chain.provider.getNetwork()).chainId),
          10200,
        );
        assert.equal(actor.provider, chain.provider);
        assert.equal(new URL(chain.rpcUrl).hostname, "127.0.0.1");
        const draft = (
          await request(base + "/drafts", {
            method: "POST",
            cookie,
            body: { action, params },
            status: 201,
          })
        ).data;
        assert.equal(draft.contractVersion, FAST);
        assert.equal(draft.abiVersion, FAST);
        assert.equal(draft.eventId, fastDefinition.id);
        assert.equal(draft.chainId, 10200);
        if (action === "deposit") assert.match(draft.summary, /XDAI/);
        assert.ok(same(draft.wallet, actor.address));
        assert.ok(
          same(draft.contract, event.target) &&
            same(draft.transaction.to, event.target),
        );
        const validated = (
          await request(base + `/drafts/${draft.id}/validate`, {
            method: "POST",
            cookie,
            body: {},
          })
        ).data;
        assert.deepEqual(validated, draft.transaction);
        assert.ok(same(validated.from, actor.address));
        assert.equal(Number(validated.chainId), 10200);
        assert.equal(BigInt(validated.value), BigInt(draft.valueWei));
        const parsed = event.interface.parseTransaction({
          data: validated.data,
          value: BigInt(validated.value),
        });
        assert.equal(parsed.name, draft.method);
        if (action === "challenge")
          assert.equal(BigInt(validated.value), await event.challengeDeposit());
        const transaction = { ...validated, value: BigInt(validated.value) };
        const gasLimit =
          ((await chain.provider.estimateGas(transaction)) * 130n) / 100n;
        assert.ok(gasLimit <= 16_777_216n);
        const sent = await actor.sendTransaction({ ...transaction, gasLimit });
        broadcasts.push({ action, hash: sent.hash });
        const receipt = await sent.wait();
        assert.equal(receipt.status, 1);
        const confirmed = (
          await request(base + `/drafts/${draft.id}/confirm`, {
            method: "POST",
            cookie,
            body: { hash: sent.hash },
          })
        ).data;
        assert.equal(confirmed.status, "confirmed");
        assert.equal(confirmed.hash, sent.hash);
        assert.equal(confirmed.blockNumber, receipt.blockNumber);
        return { draft, receipt };
      };

      // A plain transfer creates payer-owned fast credit without inventing a guest.
      await (
        await unlinked.sendTransaction({ to: event.target, value: D / 3n })
      ).wait();
      const unlinkedBefore = await detail(unlinkedCookie);
      assert.deepEqual(unlinkedBefore.participants, []);
      assert.equal(unlinkedBefore.ownWallet.pendingCreditWei, String(D / 3n));
      const recipientBefore = await chain.provider.getBalance(recipient);
      await sendReviewed(unlinkedCookie, unlinked, "withdrawPending", {
        to: recipient,
        amountWei: String(D / 3n),
      });
      assert.equal(
        await chain.provider.getBalance(recipient),
        recipientBefore + D / 3n,
      );
      const unlinkedAfter = await detail(unlinkedCookie);
      assert.equal(unlinkedAfter.ownWallet.pendingCreditWei, "0");
      assert.deepEqual(unlinkedAfter.participants, []);
      const alicePerson = (
        await request(base + "/participants", {
          method: "POST",
          cookie: aliceCookie,
          body: {
            name: "Synthetic fast Alice",
            email: "fast-alice@example.test",
          },
          status: 201,
        })
      ).data;
      const bobPerson = (
        await request(base + "/participants", {
          method: "POST",
          cookie: bobCookie,
          body: { name: "Synthetic fast Bob", email: "fast-bob@example.test" },
          status: 201,
        })
      ).data;
      const aliceDeposit = await sendReviewed(aliceCookie, alice, "deposit");
      await sendReviewed(bobCookie, bob, "deposit");
      await (
        await alice.sendTransaction({ to: event.target, value: D / 2n })
      ).wait();
      const paid = await detail(aliceCookie);
      assert.equal(
        paid.participants[0].deposit.txHash,
        aliceDeposit.receipt.hash,
      );
      assert.equal(paid.participants[0].deposit.verified, true);
      assert.equal(paid.participants[0].registered, false);
      assert.equal(paid.participants[0].admission, "pending");
      assert.equal(paid.ownWallet.pendingCreditWei, String((3n * D) / 2n));
      assert.equal(paid.state.poolWei, "0");
      const financialBeforeApproval = financial(
        (await detail(ownerCookie)).state,
      );
      const approval = (
        await request(base + "/batches/preview", {
          method: "POST",
          cookie: ownerCookie,
          body: {
            action: "approve-admission",
            nonce: "fast-local-approval-1",
            items: [
              { participantId: alicePerson.id, wallet: alice.address },
              { participantId: bobPerson.id, wallet: bob.address },
            ],
          },
          status: 201,
        })
      ).data;
      assert.equal(approval.contractVersion, FAST);
      assert.equal(approval.canCommit, true);
      assert.deepEqual(approval.counts, {
        selected: 2,
        eligible: 2,
        blocked: 0,
      });
      await request(base + `/batches/${approval.id}/commit`, {
        method: "POST",
        cookie: ownerCookie,
        body: { nonce: approval.nonce, confirmed: true },
      });
      assert.deepEqual(
        financial((await detail(ownerCookie)).state),
        financialBeforeApproval,
      );
      await sendReviewed(ownerCookie, owner, "register", {
        wallets: [alice.address, bob.address],
      });
      assert.equal(
        (await event.depositAmount()) * (await event.stakerCount()),
        2n * D,
      );
      assert.equal(await event.pendingDeposits(alice.address), D / 2n);
      const protectedBefore = await detail(aliceCookie),
        recipientAfterUnlinked = await chain.provider.getBalance(recipient);
      await sendReviewed(aliceCookie, alice, "withdrawPending", {
        to: recipient,
        amountWei: String(D / 2n),
      });
      const protectedAfter = await detail(aliceCookie);
      assert.equal(
        await chain.provider.getBalance(recipient),
        recipientAfterUnlinked + D / 2n,
      );
      assert.equal(protectedAfter.ownWallet.pendingCreditWei, "0");
      assert.equal(protectedAfter.participants[0].deposit.verified, true);
      assert.equal(protectedAfter.participants[0].registered, true);
      for (const field of ["poolWei", "stakerCount"])
        assert.equal(
          protectedAfter.state[field],
          protectedBefore.state[field],
          field,
        );
      assert.equal(
        BigInt(protectedAfter.state.reservedWei),
        BigInt(protectedBefore.state.reservedWei) - D / 2n,
        "Only the recovered unused-credit reserve is released; admitted principal remains protected",
      );
      assert.equal(protectedAfter.state.poolWei, String(2n * D));
      assert.equal(protectedAfter.state.spareWei, "0");
      const noCredit = await request(base + "/drafts", {
        method: "POST",
        cookie: aliceCookie,
        body: {
          action: "withdrawPending",
          params: { to: recipient, amountWei: String(D) },
        },
        status: 409,
      });
      assert.equal(noCredit.data.code, "INSUFFICIENT_CREDIT");
      await request(base + "/deposit-inbox", { status: 401 });
      await request(base + "/deposit-inbox", {
        cookie: bobCookie,
        status: 403,
      });
      const inbox = (
        await request(base + "/deposit-inbox", { cookie: ownerCookie })
      ).data;
      assert.equal(inbox.contractVersion, FAST);
      assert.equal(inbox.chainId, 10200);
      assert.equal(inbox.stale, false);
      assert.equal(inbox.actionable, true);
      const aliceRow = inbox.rows.find((row) =>
          same(row.wallet, alice.address),
        ),
        unknownRow = inbox.rows.find((row) =>
          same(row.wallet, unlinked.address),
        );
      assert.equal(aliceRow.pendingCreditWei, "0");
      assert.equal(aliceRow.committedPrincipalWei, String(D));
      assert.equal(aliceRow.creditWithdrawnWei, String(D / 2n));
      assert.equal(aliceRow.receivedWei, String((3n * D) / 2n));
      assert.equal(aliceRow.receiptLinked, true);
      assert.equal(aliceRow.linked, true);
      assert.equal(unknownRow.linked, false);
      assert.equal(unknownRow.participantId, null);
      assert.equal(unknownRow.name, null);
      assert.equal(unknownRow.email, null);
      assert.equal(unknownRow.returnedWei, String(D / 3n));

      // Only the isolated local chain clock advances. HTTP testnet clock controls stay forbidden.
      await chain.provider.send("evm_setTime", [start * 1000]);
      await chain.provider.send("evm_mine", []);
      const closedDeposit = await request(base + "/drafts", {
        method: "POST",
        cookie: aliceCookie,
        body: { action: "deposit" },
        status: 409,
      });
      assert.equal(closedDeposit.data.code, "OUTSIDE_DEPOSIT_WINDOW");
      const observation = (
        await request(base + "/batches/preview", {
          method: "POST",
          cookie: staffCookie,
          body: {
            action: "check-in",
            nonce: "fast-local-checkin-1",
            items: [{ participantId: alicePerson.id, wallet: alice.address }],
            note: "Actual local fast-profile door observation",
          },
          status: 201,
        })
      ).data;
      assert.equal(observation.canCommit, true);
      await request(base + `/batches/${observation.id}/commit`, {
        method: "POST",
        cookie: staffCookie,
        body: { nonce: observation.nonce, confirmed: true },
      });
      assert.equal((await detail(ownerCookie)).state.attendeeCount, 0);
      const posted = await sendReviewed(ownerCookie, owner, "postAttendance");
      const postedBlock = await chain.provider.getBlock(
        posted.receipt.blockNumber,
      );
      assert.equal(
        await event.challengeEndsAt(),
        BigInt(postedBlock.timestamp + 900),
      );
      const listed = await detail(bobCookie);
      assert.equal(listed.state.challengeEndsAt, postedBlock.timestamp + 900);
      assert.equal(Date.parse(listed.event.startsAt) / 1000, start);
      assert.equal(listed.event.depositDeadline, start);
      const challenged = await sendReviewed(bobCookie, bob, "challenge");
      const challengedBlock = await chain.provider.getBlock(
          challenged.receipt.blockNumber,
        ),
        challenge = await event.challenges(bob.address);
      assert.equal(
        challenge.matchEndsAt,
        BigInt(challengedBlock.timestamp + 900),
      );
      const waiting = (await detail(bobCookie)).state.cases.find((row) =>
        same(row.wallet, bob.address),
      );
      assert.equal(waiting.state, "Waiting");
      assert.equal(waiting.matchEndsAt, challengedBlock.timestamp + 900);
      assert.equal(waiting.caseOrganizer, owner.address);
      assert.equal(fs.statSync(stateFile).mode & 0o777, 0o600);
      assert.equal(
        broadcasts.length,
        7,
        "Each reviewed local financial action is broadcast exactly once",
      );
      assert.deepEqual(
        financial(await chainState(chain, controlRecord(normal))),
        normalBefore,
      );
      assert.deepEqual(
        financial(await chainState(chain, controlRecord(historical))),
        v7Before,
      );
      assert.equal(await normalEvent.VERSION(), 8n);
      assert.equal(await normalEvent.CHALLENGE_PERIOD(), 86400n);
      assert.equal(await normalEvent.MATCH_PERIOD(), 86400n);
      assert.ok(bridgeMethods.length > 0);
      assert.ok(
        !bridgeMethods.some((method) =>
          /^(eth_accounts|eth_sendTransaction|eth_sendRawTransaction|evm_)/.test(
            method,
          ),
        ),
        "The external backend transport remains read-only; only Node test wallets submit on the private loopback chain",
      );
    } finally {
      await app?.close();
      ethers.FetchRequest.registerGetUrl(originalTransport);
      agent?.destroy();
      if (bridge) await new Promise((resolve) => bridge.close(resolve));
      await chain?.close();
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  },
);
