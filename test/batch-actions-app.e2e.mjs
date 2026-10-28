import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, expect as baseExpect } from "@playwright/test";
import { ethers } from "ethers";
import { startServer } from "../src/server.mjs";

// Actual isolated v8 HTTP/browser acceptance. Synthetic keys remain in Node;
// browser wallets can authenticate but cannot sign or submit transactions.
const expect = baseExpect.configure({ timeout: 15_000 });
const batchPrefix = "kleros.offchain-batch-pending.v1:";
const checks = [],
  errors = [],
  external = [],
  methods = [];
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const financial = (state) =>
  Object.fromEntries(
    Object.entries(state).filter(
      ([key]) => !["blockNumber", "now"].includes(key),
    ),
  );
function check(value, label) {
  assert.ok(value, label);
  checks.push(label);
}
const runtimeRoot = await fs.mkdtemp(
  path.join(os.tmpdir(), "kleros-batch-browser-"),
);
let server,
  browser,
  stage = "setup";
try {
  server = await startServer({
    port: 0,
    rpcPort: 0,
    contractVersion: "kleros-event-v8",
    deployment: { mode: "local-demo", runtimeRoot },
  });
  const w = server.workbench,
    owner = w.session("organizer-a"),
    ownerB = w.session("organizer-b"),
    staff = w.session("staff-a"),
    alice = w.session("alice"),
    bob = w.session("bob"),
    carol = w.session("carol");
  check(
    new URL(server.url).hostname === "127.0.0.1" &&
      Number((await w.provider.getNetwork()).chainId) === 1337,
    "All tests use loopback HTTP and an isolated synthetic chain1337",
  );
  const record = w.record("event-a", owner),
    contract = w.contract("event-a");
  const execute = async (session, action, params = {}) => {
    const draft = await w.createDraft("event-a", session, { action, params });
    return {
      draft,
      transaction: await w.executeDraft("event-a", session, draft.id),
    };
  };
  const aliceDeposit = await execute(alice, "deposit");
  await execute(bob, "deposit");
  await execute(bob, "withdrawPending", {
    to: bob.wallet,
    amountWei: record.deployment.depositWei,
  });
  await w.admit("event-a", owner, "event-a-carol", "free");
  const unknown = w.chain.signers[6],
    unknownWallet = await unknown.getAddress();
  await (
    await unknown.sendTransaction({
      to: contract.target,
      value: BigInt(record.deployment.depositWei) / 2n,
    })
  ).wait();
  await w.provider.send("evm_mine", []);
  await w.provider.send("evm_mine", []);
  const beforeA = financial(await w.state("event-a")),
    beforeB = financial(await w.state("event-b"));
  const initial = w.chain.server.provider.getInitialAccounts();
  const walletFor = (session) =>
    new ethers.Wallet(initial[session.wallet.toLowerCase()].secretKey);
  browser = await chromium.launch({ headless: true });
  async function makeActor(session, { brokenBatchStorage = false } = {}) {
    const actor = {
      wallet: walletFor(session),
      commitPosts: 0,
      previewPosts: 0,
      statusGets: 0,
      drafts: [],
      dropped: false,
      dropNextCommit: false,
      markedBeforeCommit: false,
      page: null,
    };
    const issued = new Map(),
      context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
    actor.context = context;
    await context.exposeBinding(
      "__localBatchWallet",
      async ({ frame }, method, params) => {
        assert.equal(new URL(frame.url()).origin, server.url);
        methods.push(method);
        if (method === "eth_chainId") return "0x539";
        if (["eth_accounts", "eth_requestAccounts"].includes(method))
          return [actor.wallet.address];
        assert.equal(
          method,
          "personal_sign",
          "Browser signing is restricted to authentication",
        );
        assert.equal(params.length, 2);
        assert.ok(same(params[1], actor.wallet.address));
        const message = ethers.toUtf8String(params[0]),
          challenge = issued.get(message);
        assert.ok(challenge && challenge.expiresAt > Date.now());
        assert.ok(
          message.includes(`URI: ${server.url}\n`) &&
            message.includes("Chain ID: 1337\n") &&
            message.includes(`Wallet: ${actor.wallet.address}\n`) &&
            message.endsWith(
              "Authenticate this isolated demo wallet. No financial transaction.",
            ),
        );
        issued.delete(message);
        return actor.wallet.signMessage(message);
      },
    );
    await context.addInitScript(
      ({ brokenBatchStorage }) => {
        const listeners = new Map();
        window.ethereum = {
          request: ({ method, params = [] }) =>
            window.__localBatchWallet(method, params),
          on: (name, callback) => listeners.set(name, callback),
          removeListener: (name) => listeners.delete(name),
        };
        window.__batchAccountChange = () =>
          listeners.get("accountsChanged")?.([]);
        if (brokenBatchStorage) {
          const get = Storage.prototype.getItem;
          Storage.prototype.getItem = function (key) {
            if (String(key).startsWith("kleros.offchain-batch-pending.v1:"))
              throw new Error("Synthetic blocked batch storage");
            return get.call(this, key);
          };
        }
      },
      { brokenBatchStorage },
    );
    await context.route("**/*", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (url.origin !== server.url) {
        external.push(url.href);
        return route.abort("blockedbyclient");
      }
      const allowedWrite =
        [
          "/api/auth/challenge",
          "/api/auth/verify",
          "/api/session",
          "/api/events/event-a/drafts",
          "/api/events/event-a/deposit-inbox/refresh",
        ].includes(url.pathname) ||
        /^\/api\/events\/event-a\/batches\/(preview|[a-zA-Z0-9_-]+\/commit)$/.test(
          url.pathname,
        );
      if (!["GET", "HEAD"].includes(request.method()) && !allowedWrite) {
        errors.push(
          `Unexpected browser write ${request.method()} ${url.pathname}`,
        );
        return route.abort("blockedbyclient");
      }
      if (url.pathname === "/api/auth/challenge") {
        const response = await route.fetch(),
          data = await response.json();
        issued.set(data.message, data);
        return route.fulfill({ response, json: data });
      }
      if (url.pathname.endsWith("/batches/preview")) actor.previewPosts++;
      if (/\/batches\/[^/]+$/.test(url.pathname) && request.method() === "GET")
        actor.statusGets++;
      if (url.pathname === "/api/events/event-a/drafts")
        actor.drafts.push(request.postDataJSON());
      if (/\/batches\/[^/]+\/commit$/.test(url.pathname)) {
        actor.commitPosts++;
        const markers = await actor.page.evaluate(
          (prefix) =>
            Object.keys(localStorage)
              .filter((key) => key.startsWith(prefix))
              .map((key) => JSON.parse(localStorage.getItem(key))),
          batchPrefix,
        );
        actor.markedBeforeCommit = markers.some(
          (saved) =>
            saved.marker?.id === url.pathname.split("/").at(-2) &&
            saved.marker.phase === "submitting",
        );
        if (actor.dropNextCommit) {
          actor.dropNextCommit = false;
          const response = await route.fetch(),
            result = await response.json();
          assert.equal(response.status(), 200);
          assert.equal(result.status, "committed");
          actor.dropped = true;
          return route.abort("failed"); // Actual server saved; simulate the lost HTTP response only.
        }
      }
      return route.continue();
    });
    actor.page = await context.newPage();
    actor.page.on("pageerror", (error) => errors.push(error.message));
    actor.login = async () => {
      await actor.page.locator("#top-identity").click();
      await actor.page.locator("[data-connect-wallet]").click();
      await expect(actor.page.locator("#top-identity")).toHaveText(
        "Verified browser wallet",
      );
      await expect(actor.page.locator("#content")).toBeVisible();
    };
    await actor.page.goto(server.url + "/#event=event-a&view=organizer");
    await actor.login();
    return actor;
  }
  stage = "owner roles and storage";
  const failedStorage = await makeActor(owner, { brokenBatchStorage: true });
  await expect(
    failedStorage.page.locator(
      '[data-batch-toolbar="approve-admission"] [data-batch-error]',
    ),
  ).toBeVisible();
  await expect(
    failedStorage.page.locator(
      '[data-batch-toolbar="approve-admission"] [data-batch-master]',
    ),
  ).toBeDisabled();
  check(
    failedStorage.commitPosts === 0 && failedStorage.previewPosts === 0,
    "Unavailable durable recovery storage visibly locks selection and sends no preview or save",
  );
  await failedStorage.context.close();
  const actor = await makeActor(owner),
    page = actor.page;
  const approval = page.locator('[data-batch-toolbar="approve-admission"]'),
    checkin = page.locator('[data-batch-toolbar="check-in"]'),
    inbox = page.locator("#contract-deposit-inbox");
  await expect(inbox.locator("tbody tr")).toHaveCount(3);
  await expect(approval.locator("[data-batch-master]")).toBeEnabled();
  await expect(checkin.locator("[data-batch-master]")).toBeDisabled();
  check(
    (await page.locator("[data-batch-toolbar]").count()) === 2,
    "The owner receives separate approval and trusted check-in controls with no duplicate task controller",
  );
  const box = (wallet, action = "approve-admission") =>
    page.locator(
      `input[data-batch-kind="${action}"][data-batch-key="${wallet.toLowerCase()}"]`,
    );
  await expect(box(unknownWallet)).toBeDisabled();
  await expect(box(bob.wallet)).toBeDisabled();
  await expect(box(alice.wallet)).toBeEnabled();
  check(
    await box(unknownWallet)
      .getAttribute("title")
      .then((text) => /verified guest profile/.test(text)),
    "Unknown plain-transfer payers have a visible blocked reason and cannot become guest approvals",
  );
  check(
    (await inbox
      .locator(`tr:has([data-contract-wallet="${unknownWallet}"])`)
      .getAttribute("data-contract-linked-id")) === "",
    "Unknown payer rows expose no invented participant ID or contact join",
  );
  await approval.locator("[data-batch-master]").check();
  await expect(approval.locator("[data-batch-selected]")).toHaveText(
    "1 selected",
  );
  check(
    (await box(alice.wallet).isChecked()) &&
      !(await box(bob.wallet).isChecked()),
    "Select visible includes only the current verified eligible payer, excluding a returned receipt",
  );
  await inbox.locator("[data-contract-search]").fill(unknownWallet);
  await expect(approval.locator("[data-batch-selected]")).toHaveText(
    "0 selected",
  );
  await expect(approval.locator("[data-batch-master]")).toBeDisabled();
  await inbox.locator("[data-contract-search]").fill("");
  await expect(approval.locator("[data-batch-master]")).toBeEnabled();
  check(
    (await box(alice.wallet).isChecked()) === false,
    "A filter change creates a fresh empty approval selection instead of carrying hidden intent",
  );
  await box(alice.wallet).check();
  await page.locator("#event-switch").selectOption("event-b");
  await expect(page.locator("h1")).toHaveText("Open Justice Workshop");
  await expect(page.locator("[data-batch-toolbar]")).toHaveCount(0);
  check(
    !(await page.locator("#content").textContent()).includes(
      "alice@example.test",
    ),
    "Switching to another owner's event removes selections and private guest contacts",
  );
  await page.locator("#event-switch").selectOption("event-a");
  await expect(approval.locator("[data-batch-master]")).toBeEnabled();
  await expect(approval.locator("[data-batch-selected]")).toHaveText(
    "0 selected",
  );

  stage = "preserved financial journal";
  const boot = await (
    await page.request.get(server.url + "/api/bootstrap")
  ).json();
  const financialJournal = await page.evaluate(
    async ({ instanceId, contract, aliceWallet, draftId, hash }) => {
      const { createTransactionJournal } = await import(
        "/transaction-context.js"
      );
      const journal = createTransactionJournal(localStorage);
      journal.record(
        {
          eventId: "event-a",
          wallet: aliceWallet,
          chainId: 1337,
          contract,
          abiVersion: "kleros-event-v8",
          mode: "local-demo",
          instanceId,
        },
        { draftId, hash, action: "deposit" },
      );
      const key = Object.keys(localStorage).find(
        (key) =>
          key.startsWith("kleros-transactions:v1:") &&
          localStorage.getItem(key).includes(hash),
      );
      return { key, value: localStorage.getItem(key) };
    },
    {
      instanceId: boot.instanceId,
      contract: record.deployment.contract,
      aliceWallet: alice.wallet,
      draftId: aliceDeposit.draft.id,
      hash: aliceDeposit.transaction.hash,
    },
  );
  await box(alice.wallet).check();
  await approval.locator('[data-batch-action="review"]').click();
  const dialog = approval.locator("[data-batch-dialog]");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("tbody tr")).toHaveCount(1);
  await expect(dialog).toContainText(
    "Contract registration is a separate transaction",
  );
  await expect(dialog.locator('[data-batch-action="commit"]')).toBeDisabled();
  await fs.mkdir("artifacts/screenshots/batch-actions-app", {
    recursive: true,
  });
  await page.screenshot({
    path: "artifacts/screenshots/batch-actions-app/owner-approval-review.png",
    fullPage: true,
  });
  check(
    actor.commitPosts === 0 && actor.drafts.length === 0,
    "Reviewing curated admission creates no save or financial draft before explicit confirmation",
  );
  await dialog.locator("[data-batch-confirm]").check();
  actor.dropNextCommit = true;
  await dialog.locator('[data-batch-action="commit"]').click();
  await expect(dialog).toContainText("save result could not be confirmed");
  check(
    actor.dropped && actor.commitPosts === 1 && actor.markedBeforeCommit,
    "The durable contact-free marker is saved before the one actual HTTP commit whose response is lost",
  );
  const savedMarkers = await page.evaluate(
    (prefix) =>
      Object.keys(localStorage)
        .filter((key) => key.startsWith(prefix))
        .map((key) => localStorage.getItem(key)),
    batchPrefix,
  );
  check(
    savedMarkers.length === 1 &&
      savedMarkers.every(
        (value) => !/Alice|alice@example|name|email/.test(value),
      ),
    "The unresolved saved marker contains identity references without names or emails",
  );
  check(
    record.participants.get("event-a-alice").admission === "approved" &&
      Number(await contract.status(alice.wallet)) === 0,
    "The actual saved app approval still leaves Alice financially unregistered",
  );
  assert.deepEqual(financial(await w.state("event-a")), beforeA);

  stage = "reload and GET-only recovery";
  await page.reload();
  await expect(approval.locator('[data-batch-action="status"]')).toBeVisible();
  await expect(approval.locator("[data-batch-master]")).toBeDisabled();
  check(
    actor.commitPosts === 1 && actor.statusGets === 0,
    "A full reload restores uncertainty and never automatically retries the save or silently resolves it",
  );
  await approval.locator('[data-batch-action="status"]').click();
  await expect(page.locator("[data-batch-register]")).toBeVisible();
  check(
    actor.statusGets === 1 &&
      actor.commitPosts === 1 &&
      actor.drafts.length === 0,
    "Explicit recovery uses one authenticated GET and offers separate registration without automatically preparing a transaction",
  );
  check(
    (await page.evaluate(
      (prefix) =>
        Object.keys(localStorage).filter((key) => key.startsWith(prefix))
          .length,
      batchPrefix,
    )) === 0,
    "A validated committed status removes only the expected batch recovery marker",
  );
  await page.locator("[data-batch-register]").click();
  await expect(page.locator("#review-dialog")).toBeVisible();
  await expect(page.locator("#dialog-body")).toContainText(alice.wallet);
  check(
    actor.drafts.length === 1 &&
      actor.drafts[0].action === "register" &&
      actor.drafts[0].params.wallets.length === 1 &&
      same(actor.drafts[0].params.wallets[0], alice.wallet),
    "The explicit registration follow-up reviews exactly the approved selection and ignores an unrelated returned payer",
  );
  await page.locator("#review-dialog [data-close]").click();
  await w.admit("event-a", owner, "event-a-alice", "declined");
  await page.locator("[data-batch-register]").click();
  await expect(page.locator("#dialog-body")).toContainText(
    "Host approval changed",
  );
  check(
    actor.drafts.length === 1,
    "Changed eligibility blocks the entire saved registration selection with a reason instead of silently filtering it",
  );
  await page.locator("#review-dialog [data-close]").click();
  await w.admit("event-a", owner, "event-a-alice", "approved");
  check(
    await page.evaluate(
      ({ key, value }) => localStorage.getItem(key) === value,
      financialJournal,
    ),
    "Batch selection, saving, reload and recovery preserve the independent submitted financial journal byte for byte",
  );

  stage = "wallet scope reset";
  actor.wallet = walletFor(ownerB);
  await page.evaluate(() => window.__batchAccountChange());
  await expect(page.locator("[data-batch-toolbar]")).toHaveCount(0);
  await actor.login();
  await expect(page.locator("[data-batch-toolbar]")).toHaveCount(0);
  check(
    !(await page.locator("#content").textContent()).includes(
      "alice@example.test",
    ),
    "A wallet change disposes owner task selections and contacts before a different wallet authenticates",
  );
  await page.locator("#event-switch").selectOption("event-b");
  await expect(
    page.locator(
      '[data-batch-toolbar="approve-admission"] [data-batch-selected]',
    ),
  ).toHaveText("0 selected");
  check(
    await page.evaluate(
      ({ key, value }) => localStorage.getItem(key) === value,
      financialJournal,
    ),
    "Wallet and event scope changes also preserve the unrelated submitted financial journal",
  );

  stage = "real staff check-in";
  const door = await makeActor(staff),
    doorPage = door.page,
    doorToolbar = doorPage.locator('[data-batch-toolbar="check-in"]');
  await expect(
    doorPage.locator('[data-batch-toolbar="approve-admission"]'),
  ).toHaveCount(0);
  await expect(doorToolbar.locator("[data-batch-master]")).toBeDisabled();
  check(
    true,
    "Staff receive trusted check-in only and cannot batch approve admission",
  );
  await w.advance(3601);
  await doorPage.reload();
  await expect(doorToolbar.locator("[data-batch-master]")).toBeEnabled();
  for (const wallet of [alice.wallet, carol.wallet])
    await doorPage
      .locator(
        `input[data-batch-kind="check-in"][data-batch-key="${wallet.toLowerCase()}"]`,
      )
      .check();
  await expect(doorToolbar.locator("[data-batch-selected]")).toHaveText(
    "2 selected",
  );
  await doorToolbar.locator('[data-batch-action="review"]').click();
  const doorDialog = doorToolbar.locator("[data-batch-dialog]");
  await expect(doorDialog.locator("tbody tr")).toHaveCount(2);
  await expect(doorDialog).toContainText(
    "Publishing the financial attendance list is a separate transaction",
  );
  await doorDialog.locator("[data-batch-confirm]").check();
  await doorDialog.locator('[data-batch-action="commit"]').click();
  await expect(doorPage.locator("#toast")).toContainText(
    "Trusted check-ins saved",
  );
  const observations = record.observations,
    now = (await w.provider.getBlock("latest")).timestamp;
  check(
    door.commitPosts === 1 &&
      door.markedBeforeCommit &&
      observations.length === 2 &&
      observations.every(
        (row) =>
          row.timestamp === now &&
          same(row.reviewer, staff.wallet) &&
          row.source === "staff-door",
      ),
    "One explicit staff save records both actual door observations at chain time with reviewer and replay-safe audit",
  );
  check(
    record.participants.get("event-a-carol").admission === "free" &&
      Number(await contract.status(carol.wallet)) === 0 &&
      (await contract.attended(carol.wallet)) === false,
    "A free guest's trusted check-in does not admit money or publish financial attendance",
  );
  await expect(doorPage.locator('[data-tx="postAttendance"]')).toBeDisabled();
  check(
    (await w.state("event-a")).phase === "Open" &&
      (await w.state("event-a")).poolWei === "0",
    "Approval and staff check-in leave the contract Open with no registered pool",
  );
  assert.deepEqual(financial(await w.state("event-a")), beforeA);
  assert.deepEqual(financial(await w.state("event-b")), beforeB);
  check(
    true,
    "All batch UI activity leaves Event A and independent Event B financial state unchanged",
  );
  await doorPage.setViewportSize({ width: 390, height: 844 });
  check(
    await doorPage.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "The integrated staff batch controls fit a mobile viewport",
  );
  await fs.mkdir("artifacts/screenshots/batch-actions-app", {
    recursive: true,
  });
  await doorPage.screenshot({
    path: "artifacts/screenshots/batch-actions-app/staff-mobile.png",
    fullPage: true,
  });
  check(
    methods.every((method) =>
      [
        "eth_accounts",
        "eth_requestAccounts",
        "eth_chainId",
        "personal_sign",
      ].includes(method),
    ) && !methods.some((method) => /send|signTransaction/.test(method)),
    "Browser wallets perform nonce authentication only, with no financial signing or sends",
  );
  check(
    errors.length === 0 && external.length === 0,
    "No JavaScript errors, unexpected writes or external requests occur",
  );
  await fs.writeFile(
    "artifacts/screenshots/batch-actions-app/results.json",
    JSON.stringify(
      {
        mode: "isolated-real-v8-http-and-crypto-wallet",
        checks,
        errors,
        external,
        limitations: [
          "Only the successful commit response is deliberately dropped to exercise durable recovery; backend mutations and later GET are real.",
          "The retained Alice journal simulates a submitted deposit awaiting app reconciliation; the setup receipt is real.",
          "No public RPC or testnet transaction is used.",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`Batch actions app integration: ${checks.length} checks passed`);
} catch (error) {
  console.error(
    `Batch actions app integration failed at ${stage}: ${error.message}`,
  );
  throw error;
} finally {
  await browser?.close();
  await server?.close();
  await fs.rm(runtimeRoot, { recursive: true, force: true });
}
