import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ethers } from "ethers";
import { startServer } from "../src/server.mjs";

test(
  "a wallet with no guest profile can authenticate and recover its own plain-transfer v8 credit to a chosen address",
  { timeout: 90000 },
  async () => {
    const runtimeRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "kleros-v8-unlinked-credit-"),
    );
    let app;
    try {
      app = await startServer({
        port: 0,
        rpcPort: 0,
        contractVersion: "kleros-event-v8",
        deployment: { mode: "local-demo", runtimeRoot },
      });
      const w = app.workbench,
        provider = w.provider;
      assert.equal(
        Number((await provider.getNetwork()).chainId),
        1337,
        "The regression must use only the isolated local chain",
      );
      const owner = w.session("organizer-a"),
        alice = w.session("alice");
      const seed = async (who, action) => {
        const draft = await w.createDraft("event-a", who, { action });
        const confirmed = await w.executeDraft("event-a", who, draft.id);
        assert.equal(
          (await provider.getTransactionReceipt(confirmed.hash)).status,
          1,
        );
      };
      // Another payer's committed principal makes recovery isolation meaningful.
      await seed(alice, "deposit");
      const alicePerson = (await w.detail("event-a", alice)).participants[0];
      await w.admit("event-a", owner, alicePerson.id, "approved");
      await seed(owner, "register");
      const aRecord = w.record("event-a", owner),
        bBefore = await w.state("event-b");
      const deposit = BigInt(aRecord.deployment.depositWei);
      const existingPrincipal = (await w.state("event-a")).poolWei;
      assert.equal(existingPrincipal, String(deposit));

      const payer = ethers.Wallet.createRandom().connect(provider);
      const recipient = ethers.Wallet.createRandom().address;
      assert.notEqual(recipient, payer.address);
      await (
        await w.chain.signers[0].sendTransaction({
          to: payer.address,
          value: ethers.parseEther("0.1"),
        })
      ).wait();
      const transfer = await payer.sendTransaction({
        to: aRecord.deployment.contract,
        value: deposit,
      });
      const transferReceipt = await transfer.wait();
      assert.equal(transferReceipt.status, 1);
      assert.equal(
        (await provider.getTransaction(transfer.hash)).data,
        "0x",
        "This must exercise the receive/plain-transfer path",
      );
      assert.equal(
        [...aRecord.participants.values()].some(
          (p) => p.wallet.toLowerCase() === payer.address.toLowerCase(),
        ),
        false,
      );

      const request = async (
        pathname,
        { method = "GET", payload, cookie } = {},
      ) => {
        const response = await fetch(app.url + pathname, {
          method,
          headers: {
            ...(method === "GET"
              ? {}
              : { origin: app.url, "content-type": "application/json" }),
            ...(cookie ? { cookie } : {}),
          },
          ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        });
        return { response, data: await response.json() };
      };
      const anonymous = await request("/api/events/event-a");
      assert.equal(anonymous.response.status, 200);
      assert.equal(anonymous.data.ownWallet, null);
      const issued = await request("/api/auth/challenge", {
        method: "POST",
        payload: { wallet: payer.address },
      });
      assert.equal(issued.response.status, 200);
      assert.ok(issued.data.message.includes(`URI: ${app.url}\n`));
      assert.ok(issued.data.message.includes("Chain ID: 1337\n"));
      assert.ok(issued.data.message.includes(`Wallet: ${payer.address}\n`));
      const authenticated = await request("/api/auth/verify", {
        method: "POST",
        payload: {
          nonce: issued.data.nonce,
          signature: await payer.signMessage(issued.data.message),
        },
      });
      assert.equal(authenticated.response.status, 200);
      assert.equal(authenticated.data.wallet, payer.address);
      assert.equal(authenticated.data.mode, "wallet");
      const cookie = authenticated.response.headers
        .get("set-cookie")
        .split(";")[0];
      const before = (await request("/api/events/event-a", { cookie })).data;
      assert.deepEqual(
        before.participants,
        [],
        "Wallet authentication must not invent a name/email registration",
      );
      assert.deepEqual(before.ownWallet, {
        wallet: payer.address,
        owedWei: "0",
        pendingCreditWei: String(deposit),
      });
      assert.equal(
        Object.hasOwn(before.state.pendingCredits, payer.address.toLowerCase()),
        false,
        "The wallet-specific recovery view must not add actor-only fields to the global financial fingerprint",
      );
      assert.equal(before.state.pendingTotalWei, String(deposit));
      assert.equal(before.state.poolWei, existingPrincipal);
      assert.equal(before.state.balanceWei, String(2n * deposit));
      const sameWalletB = (await request("/api/events/event-b", { cookie }))
        .data;
      assert.equal(
        sameWalletB.ownWallet.pendingCreditWei,
        "0",
        "A credit must not appear in the same wallet's B context",
      );

      const reviewed = await request("/api/events/event-a/drafts", {
        method: "POST",
        cookie,
        payload: {
          action: "withdrawPending",
          params: { to: recipient, amountWei: String(deposit) },
        },
      });
      assert.equal(reviewed.response.status, 201);
      assert.equal(reviewed.data.method, "withdrawPending");
      assert.deepEqual(reviewed.data.args, [recipient, String(deposit)]);
      assert.equal(reviewed.data.valueWei, "0");
      const freshDetail = (await request("/api/events/event-a", { cookie }))
        .data;
      assert.equal(
        reviewed.data.snapshot,
        freshDetail.state.fingerprint,
        "Recovery review and refreshed authenticated detail must share the same global financial fingerprint",
      );
      const validated = await request(
        `/api/events/event-a/drafts/${reviewed.data.id}/validate`,
        { method: "POST", cookie, payload: {} },
      );
      assert.equal(validated.response.status, 200);
      assert.equal(validated.data.to, aRecord.deployment.contract);
      assert.equal(validated.data.from, payer.address);
      assert.equal(validated.data.chainId, 1337);
      const recipientBefore = await provider.getBalance(recipient);
      const withdrawal = await payer.sendTransaction({
        ...validated.data,
        gasLimit: 300000n,
      });
      const withdrawalReceipt = await withdrawal.wait();
      assert.equal(withdrawalReceipt.status, 1);
      const confirmed = await request(
        `/api/events/event-a/drafts/${reviewed.data.id}/confirm`,
        { method: "POST", cookie, payload: { hash: withdrawal.hash } },
      );
      assert.equal(confirmed.response.status, 200);
      assert.equal(confirmed.data.status, "confirmed");
      assert.equal(confirmed.data.hash, withdrawal.hash);
      assert.equal(
        (await provider.getBalance(recipient)) - recipientBefore,
        deposit,
        "The chosen recipient receives the actual credit without paying the payer's gas",
      );

      const after = (await request("/api/events/event-a", { cookie })).data;
      assert.deepEqual(after.participants, []);
      assert.equal(
        [...aRecord.participants.values()].some(
          (p) => p.wallet.toLowerCase() === payer.address.toLowerCase(),
        ),
        false,
        "Recovery must finish before any guest name/email is collected",
      );
      assert.deepEqual(after.ownWallet, {
        wallet: payer.address,
        owedWei: "0",
        pendingCreditWei: "0",
      });
      assert.equal(after.state.pendingTotalWei, "0");
      assert.equal(after.state.poolWei, existingPrincipal);
      assert.equal(after.state.stakerCount, 1);
      assert.equal(after.state.balanceWei, String(deposit));
      assert.equal(after.state.reservedWei, String(deposit));
      assert.equal(after.state.spareWei, "0");
      assert.equal(after.participants.length, 0);
      const exhausted = await request("/api/events/event-a/drafts", {
        method: "POST",
        cookie,
        payload: {
          action: "withdrawPending",
          params: { to: recipient, amountWei: "1" },
        },
      });
      assert.equal(exhausted.response.status, 409);
      assert.equal(
        exhausted.data.code,
        "INSUFFICIENT_CREDIT",
        "An unlinked wallet cannot reuse the other payer's protected principal after its own credit is empty",
      );
      const aliceAfter = (await w.detail("event-a", alice)).participants[0];
      assert.equal(aliceAfter.registered, true);
      assert.equal(aliceAfter.deposit.verified, true);
      const financial = (state) =>
        Object.fromEntries(
          Object.entries(state).filter(
            ([key]) => !["now", "blockNumber", "fingerprint"].includes(key),
          ),
        );
      assert.deepEqual(
        financial(await w.state("event-b")),
        financial(bBefore),
        "Plain-transfer credit and withdrawal must leave B's full financial state unchanged",
      );
    } finally {
      await app?.close();
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  },
);
