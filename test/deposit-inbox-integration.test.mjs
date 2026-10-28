import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer } from "../src/server.mjs";
import { createWorkbench } from "../src/workbench.mjs";
import { indexDepositInbox } from "../src/deposit-inbox.mjs";

const sent = async (transaction) => (await transaction).wait();
const rowFor = (snapshot, wallet) =>
  snapshot.rows.find(
    (row) => row.wallet.toLowerCase() === wallet.toLowerCase(),
  );
const financial = (state) =>
  Object.fromEntries(
    Object.entries(state).filter(
      ([key]) => !["blockNumber", "now"].includes(key),
    ),
  );

test(
  "real v8 inbox tracks unknown receive deposits, partial credit recovery, readmission, wrapper refunds/owed and payout without inventing contacts",
  { timeout: 120000 },
  async () => {
    const runtimeRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "kleros-deposit-inbox-"),
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
        owner = w.session("organizer-a"),
        ownerB = w.session("organizer-b"),
        alice = w.session("alice");
      assert.equal(Number((await w.provider.getNetwork()).chainId), 1337);
      const ownerSigner = await w.provider.getSigner(owner.wallet),
        aliceSigner = await w.provider.getSigner(alice.wallet);
      const c = w.contract("event-a").connect(ownerSigner),
        d = await c.depositAmount();
      const payer = w.chain.signers[6],
        recipient = await w.chain.signers[8].getAddress(),
        wallet = await payer.getAddress();
      const bBefore = financial(await w.state("event-b"));
      const first = await sent(
        payer.sendTransaction({ to: c.target, value: 2n * d }),
      );
      let snapshot = await indexDepositInbox(w, "event-a");
      let row = rowFor(snapshot, wallet);
      assert.equal(row.pendingCreditWei, String(2n * d));
      assert.equal(row.committedPrincipalWei, "0");
      assert.equal(row.transactions[0].txHash, first.hash);
      assert.equal(row.transactions[0].status, "confirming");
      const pinned = snapshot.indexedBlock.number;
      await sent(c.connect(payer).withdrawPending(recipient, d / 2n));
      assert.equal(
        (await w.depositLedger("event-a", pinned))[0].pendingCreditWei,
        String(2n * d),
        "historical ledger reads must not include a later withdrawal",
      );
      snapshot = await indexDepositInbox(w, "event-a");
      row = rowFor(snapshot, wallet);
      assert.equal(row.pendingCreditWei, String((3n * d) / 2n));
      assert.equal(row.returnedWei, String(d / 2n));
      assert.equal(row.creditWithdrawnWei, String(d / 2n));
      await sent(c.registerStakers([wallet]));
      snapshot = await indexDepositInbox(w, "event-a");
      row = rowFor(snapshot, wallet);
      assert.equal(row.committedPrincipalWei, String(d));
      assert.equal(row.pendingCreditWei, String(d / 2n));
      await sent(c.rejectAndRefund([wallet]));
      snapshot = await indexDepositInbox(w, "event-a");
      row = rowFor(snapshot, wallet);
      assert.equal(row.returnedWei, String((3n * d) / 2n));
      assert.equal(row.committedPrincipalWei, "0");
      assert.equal(row.registrationBasisWei, "0");
      await sent(c.connect(payer).deposit({ value: d / 2n }));
      await sent(c.registerStakers([wallet]));
      snapshot = await indexDepositInbox(w, "event-a");
      row = rowFor(snapshot, wallet);
      assert.equal(row.receivedWei, String((5n * d) / 2n));
      assert.equal(row.pendingCreditWei, "0");
      assert.equal(row.committedPrincipalWei, String(d));
      assert.equal(row.registrationBasisWei, String(d));
      assert.equal(row.transactions.length, 2);

      const refusing = await w.chain.deploy("TestWallet", ownerSigner);
      await sent(
        refusing.exec(c.target, c.interface.encodeFunctionData("deposit"), {
          value: d,
        }),
      );
      await sent(c.registerStakers([refusing.target]));
      await sent(refusing.setMode(1));
      await sent(c.rejectAndRefund([refusing.target], { gasLimit: 4_000_000 }));
      snapshot = await indexDepositInbox(w, "event-a");
      row = rowFor(snapshot, refusing.target);
      assert.equal(
        row.wallet,
        refusing.target,
        "the canonical inner payer is the contract wallet, not its outer caller",
      );
      assert.equal(
        row.returnedWei,
        "0",
        "a failed refund is owed credit, never delivered principal",
      );
      assert.equal(row.owedWei, String(d));
      assert.equal(row.committedPrincipalWei, "0");
      assert.equal(row.registrationBasisWei, "0");
      assert.equal(row.claimsPaidWei, "0");
      await sent(
        refusing.exec(
          c.target,
          c.interface.encodeFunctionData("claim", [recipient]),
        ),
      );
      snapshot = await indexDepositInbox(w, "event-a");
      row = rowFor(snapshot, refusing.target);
      assert.equal(row.owedWei, "0");
      assert.equal(row.claimsPaidWei, String(d));
      assert.equal(
        row.returnedWei,
        "0",
        "fungible owed claims cannot be relabeled as direct principal refunds",
      );

      await sent(c.connect(aliceSigner).deposit({ value: d }));
      await sent(c.registerStakers([alice.wallet]));
      const request = async (
        pathname,
        { method = "GET", cookie, payload } = {},
      ) => {
        const response = await fetch(app.url + pathname, {
          method,
          headers: {
            ...(cookie ? { cookie } : {}),
            ...(method === "POST"
              ? { origin: app.url, "content-type": "application/json" }
              : {}),
          },
          ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        });
        return {
          status: response.status,
          data: await response.json(),
          cookie: response.headers.get("set-cookie")?.split(";")[0],
        };
      };
      const login = async (identity) =>
        (
          await request("/api/session", {
            method: "POST",
            payload: { identity },
          })
        ).cookie;
      const ownerCookie = await login("organizer-a"),
        ownerBCookie = await login("organizer-b");
      assert.equal(
        (await request("/api/bootstrap")).data.capabilities.contractInbox,
        true,
      );
      assert.equal(
        (await request("/api/events/event-a/deposit-inbox")).status,
        401,
      );
      for (const identity of ["alice", "staff-a", "organizer-b"])
        assert.equal(
          (
            await request("/api/events/event-a/deposit-inbox", {
              cookie: await login(identity),
            })
          ).status,
          403,
        );
      const beforeRead = financial(await w.state("event-a"));
      const inbox = await request("/api/events/event-a/deposit-inbox", {
        cookie: ownerCookie,
      });
      assert.equal(inbox.status, 200);
      assert.equal(inbox.data.stale, false);
      const unknown = rowFor(inbox.data, wallet),
        known = rowFor(inbox.data, alice.wallet);
      assert.equal(unknown.name, null);
      assert.equal(unknown.email, null);
      assert.equal(unknown.participantId, null);
      assert.equal(unknown.linked, false);
      assert.equal(known.name, "Alice");
      assert.equal(known.linked, true);
      assert.equal(
        known.receiptLinked,
        false,
        "a real transfer does not automatically link a receipt",
      );
      assert.ok(
        [...w.record("event-a", owner).participants.values()].every(
          (p) => p.wallet.toLowerCase() !== wallet.toLowerCase(),
        ),
        "inbox refresh must never register an unknown payer",
      );
      assert.equal(
        (
          await request("/api/events/event-a/deposit-inbox/refresh", {
            method: "POST",
            cookie: ownerCookie,
            payload: {},
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await request("/api/events/event-a/deposit-inbox/refresh", {
            method: "POST",
            cookie: ownerCookie,
            payload: { source: "external" },
          })
        ).status,
        400,
      );
      assert.deepEqual(
        financial(await w.state("event-a")),
        beforeRead,
        "inbox reads and refreshes cannot change financial state",
      );
      const b = await request("/api/events/event-b/deposit-inbox", {
        cookie: ownerBCookie,
      });
      assert.equal(b.status, 200);
      assert.deepEqual(b.data.rows, []);
      assert.notEqual(b.data.contract, inbox.data.contract);
      assert.deepEqual(financial(await w.state("event-b")), bBefore);

      await w.advance(3601);
      await sent(c.postAttendance([wallet, alice.wallet], d));
      await w.advance(86401);
      await sent(c.releasePayouts({ gasLimit: 4_000_000 }));
      snapshot = await indexDepositInbox(w, "event-a");
      row = rowFor(snapshot, wallet);
      assert.equal(
        row.committedPrincipalWei,
        "0",
        "paid attendance never remains recoverable registered principal",
      );
      assert.equal(
        row.registrationBasisWei,
        String(d),
        "historical admission provenance remains explicitly labeled",
      );
      assert.equal(row.attendancePaidWei, String(d));
      assert.equal(row.returnedWei, String((3n * d) / 2n));
      assert.deepEqual(financial(await w.state("event-b")), bBefore);
      // Even a warm cache cannot authorize a former owner after two-step transfer.
      await sent(c.transferOwnership(ownerB.wallet));
      await sent(
        c.connect(await w.provider.getSigner(ownerB.wallet)).acceptOwnership(),
      );
      assert.equal(
        (
          await request("/api/events/event-a/deposit-inbox", {
            cookie: ownerCookie,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request("/api/events/event-a/deposit-inbox", {
            cookie: ownerBCookie,
          })
        ).status,
        200,
      );
    } finally {
      await app?.close();
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  },
);

test(
  "v7 inbox preserves aggregate-spare semantics and reports successful refunds without inventing payer-owned credit",
  { timeout: 60000 },
  async () => {
    const w = await createWorkbench({ rpcPort: 0 });
    try {
      const owner = w.session("organizer-a"),
        alice = w.session("alice");
      const c = w
        .contract("event-a")
        .connect(await w.provider.getSigner(owner.wallet));
      const d = await c.depositAmount(),
        payer = w.chain.signers[6],
        wallet = await payer.getAddress();
      await sent(
        c
          .connect(await w.provider.getSigner(alice.wallet))
          .deposit({ value: d }),
      );
      await sent(payer.sendTransaction({ to: c.target, value: d / 2n }));
      await sent(c.registerStakers([alice.wallet]));
      await sent(c.refund(wallet, d / 2n));
      const snapshot = await indexDepositInbox(w, "event-a");
      const row = rowFor(snapshot, wallet);
      assert.equal(row.pendingCreditWei, null);
      assert.equal(row.returnedWei, String(d / 2n));
      assert.equal(row.unallocatedWei, "0");
      assert.equal(row.committedPrincipalWei, "0");
      assert.equal(
        rowFor(snapshot, alice.wallet).committedPrincipalWei,
        String(d),
      );
      assert.equal(rowFor(snapshot, alice.wallet).pendingCreditWei, null);
    } finally {
      await w.close();
    }
  },
);
