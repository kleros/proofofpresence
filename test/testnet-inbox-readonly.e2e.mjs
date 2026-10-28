import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { chromium, expect as baseExpect } from "@playwright/test";
import { assertNonce, singleAttemptConnection } from "./testnet-ui-c.e2e.mjs";
import { loadV8Artifacts } from "../src/contracts-v8.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ORIGIN = "https://kleros-event-workbench-preview.netlify.app";
if (process.argv.length !== 3 || process.argv[2] !== "--execute") {
  console.log(
    JSON.stringify({
      status: "review-only",
      networkRequests: 0,
      signingFilesRead: 0,
      instruction:
        "Explicit --execute performs only A/B owner-inbox GET/UI checks and nonce authentication. No financial transaction method exists.",
    }),
  );
} else await run();
async function run() {
  const runId =
    new Date().toISOString().replace(/[:.]/g, "-") +
    "-" +
    randomUUID().slice(0, 8);
  const directory = path.join(ROOT, "artifacts/testnet-inbox-readonly", runId);
  const screenshots = path.join(
    ROOT,
    "artifacts/screenshots/testnet-inbox-readonly",
    runId,
  );
  const proof = {
    status: "stopped",
    origin: ORIGIN,
    runId,
    checks: 0,
    nonceSignatures: 0,
    contractSignatures: 0,
    contractBroadcasts: 0,
    apiWrites: "nonce authentication only",
    screenshots: [],
  };
  let browser,
    provider,
    stage = "configuration";
  const check = (ok, message) => {
    if (!ok) throw new Error(message);
    proof.checks++;
  };
  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const expect = baseExpect.configure({ timeout: 90000 });
  const target = (relative) => {
    const u = new URL(relative, ORIGIN);
    check(
      u.origin === ORIGIN && !u.username && !u.password,
      "Exact primary origin required",
    );
    return u.href;
  };
  try {
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(ROOT, "registry/chiado-v8-controlled.json"),
        "utf8",
      ),
    );
    check(
      manifest.publicOrigin === ORIGIN &&
        manifest.chain.chainId === 10200 &&
        manifest.events.length === 2,
      "Exact original A/B manifest required",
    );
    const [a, b] = manifest.events,
      eventPath = `/api/events/${a.definition.id}`;
    const boot = await (
      await fetch(target("/api/bootstrap"), {
        redirect: "error",
        signal: AbortSignal.timeout(90000),
      })
    ).json();
    check(
      boot.mode === "hosted-testnet" &&
        boot.capabilities.contractInbox === true &&
        boot.chain.chainId === 10200,
      "Deployed v8 contract inbox capability required",
    );
    proof.source = {
      manifestSha256: digest(
        fs.readFileSync(path.join(ROOT, "registry/chiado-v8-controlled.json")),
      ),
      harnessSha256: digest(fs.readFileSync(fileURLToPath(import.meta.url))),
      backendInstanceId: boot.instanceId,
      eventId: a.definition.id,
      contract: a.deployment.contract,
    };
    const anonymous = await fetch(target(eventPath + "/deposit-inbox"), {
      redirect: "error",
      signal: AbortSignal.timeout(90000),
    });
    check(
      anonymous.status === 401,
      "Anonymous callers cannot read the private inbox",
    );
    const keyPath = path.join(ROOT, ".runtime/testnet/chiado-deployer.json"),
      info = fs.lstatSync(keyPath);
    check(
      info.isFile() &&
        !info.isSymbolicLink() &&
        (info.mode & 0o077) === 0 &&
        info.uid === process.getuid(),
      "Owner-only original signing file required",
    );
    const keys = JSON.parse(fs.readFileSync(keyPath, "utf8"));
    check(
      keys.purpose === "Disposable Chiado controlled rehearsal only" &&
        keys.chainId === 10200,
      "Only original disposable A/B nonce wallets are permitted",
    );
    browser = await chromium.launch();
    let ownerSummary;
    const failures = [];
    for (const role of ["ownerA", "alice"]) {
      stage = `${role}: exact wallet nonce login`;
      const wallet = new ethers.Wallet(keys.roles[role].privateKey);
      check(
        same(wallet.address, manifest.rehearsalAddresses[role]),
        "Wallet must match original public rehearsal role",
      );
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
      context.setDefaultTimeout(90000);
      const issued = new Map();
      let signed;
      await context.exposeBinding(
        "__inboxReadOnlyWallet",
        async ({ frame }, method, params = []) => {
          check(
            new URL(frame.url()).origin === ORIGIN &&
              frame.parentFrame() === null,
            "Exact primary top-level origin required",
          );
          if (method === "eth_chainId") return "0x27d8";
          if (["eth_accounts", "eth_requestAccounts"].includes(method))
            return [wallet.address];
          check(
            method === "personal_sign" &&
              params.length === 2 &&
              same(params[1], wallet.address),
            "Financial wallet requests are unavailable",
          );
          const message = ethers.toUtf8String(params[0]),
            challenge = issued.get(message);
          check(
            challenge &&
              assertNonce(challenge, wallet.address, ORIGIN) === message,
            "Only fresh exact primary login nonce may be signed",
          );
          issued.delete(message);
          signed = {
            nonce: challenge.nonce,
            signature: await wallet.signMessage(message),
          };
          proof.nonceSignatures++;
          return signed.signature;
        },
      );
      await context.addInitScript(() => {
        window.ethereum = {
          request: ({ method, params = [] }) =>
            window.__inboxReadOnlyWallet(method, params),
          on() {},
          removeListener() {},
        };
      });
      await context.route("**/*", async (route) => {
        const request = route.request(),
          u = new URL(request.url());
        try {
          check(u.origin === ORIGIN, "External browser network refused");
          if (["GET", "HEAD"].includes(request.method()))
            return route.continue();
          check(
            request.method() === "POST" &&
              ["/api/auth/challenge", "/api/auth/verify"].includes(u.pathname),
            "Only login API writes are allowed",
          );
          const body = request.postDataJSON();
          if (u.pathname === "/api/auth/challenge")
            check(
              Object.keys(body).join() === "wallet" &&
                same(body.wallet, wallet.address),
              "Exact wallet nonce target required",
            );
          else
            check(
              signed &&
                body.nonce === signed.nonce &&
                body.signature === signed.signature &&
                Object.keys(body).sort().join() === "nonce,signature",
              "Only the exact signed nonce may authenticate",
            );
          const response = await route.fetch({ maxRedirects: 0 });
          check(response.status() === 200, "Nonce operation failed");
          if (u.pathname === "/api/auth/challenge") {
            const challenge = await response.json();
            assertNonce(challenge, wallet.address, ORIGIN);
            issued.set(challenge.message, challenge);
          }
          return route.fulfill({ response });
        } catch {
          failures.push("Unexpected browser origin or write blocked");
          return route.abort("blockedbyclient");
        }
      });
      const page = await context.newPage();
      page.on("pageerror", () => failures.push("Browser runtime error"));
      await page.goto(
        target(
          `/?inbox_readonly=${role}#event=${a.definition.id}&view=${role === "ownerA" ? "organizer" : "participant"}`,
        ),
      );
      await expect(page.locator("#loading")).toBeHidden();
      await expect(page.locator("#content")).toBeVisible();
      await page.locator("#top-identity").click();
      const verified = page.waitForResponse(
        (r) =>
          r.url() === target("/api/auth/verify") &&
          r.request().method() === "POST",
      );
      await page.locator("#review-dialog [data-connect-wallet]").click();
      check((await verified).status() === 200, "Actual wallet nonce accepted");
      await expect(page.locator("#top-identity")).toHaveText(
        "Verified browser wallet",
      );
      await expect(page.locator("#loading")).toBeHidden();
      if (await page.locator("#review-dialog").isVisible())
        await page.locator("#review-dialog [data-close]").last().click();
      const read = async (relative) => {
        const response = await context.request.get(target(relative), {
          maxRedirects: 0,
          timeout: 120000,
        });
        check(response.status() === 200, "Authenticated GET failed");
        return response.json();
      };
      const session = await read("/api/bootstrap");
      check(
        session.instanceId === boot.instanceId &&
          same(session.session.wallet, wallet.address),
        "Stable backend and exact role session required",
      );
      if (role === "alice") {
        stage = "alice: inbox privacy denial";
        const response = await context.request.get(
          target(eventPath + "/deposit-inbox"),
          { timeout: 120000, maxRedirects: 0 },
        );
        check(
          response.status() === 403,
          "A participant cannot read the owner inbox",
        );
        check(
          (await page.locator("#contract-deposit-inbox").count()) === 0,
          "Participant UI has no owner inbox",
        );
        await context.close();
        continue;
      }
      stage = "ownerA: canonical contract inbox";
      const before = await read(eventPath);
      check(
        before.permissions.owner &&
          same(before.ownWallet.wallet, wallet.address) &&
          same(before.event.contract, a.deployment.contract),
        "Actual owner selected the exact A child",
      );
      let inbox;
      for (let attempt = 0; attempt < 3; attempt++) {
        inbox = await read(eventPath + "/deposit-inbox");
        if (!inbox.stale && inbox.indexedBlock) break;
        if (attempt < 2)
          await new Promise((resolve) => setTimeout(resolve, 31000));
      }
      check(
        inbox.stale === false &&
          inbox.error === null &&
          inbox.chainId === 10200 &&
          inbox.eventId === a.definition.id &&
          same(inbox.contract, a.deployment.contract) &&
          inbox.contractVersion === "kleros-event-v8",
        "Fresh exact contract-scoped inbox required",
      );
      const expectedWallets = ["alice", "bob", "carol"]
        .map((r) => manifest.rehearsalAddresses[r].toLowerCase())
        .sort();
      check(
        JSON.stringify(
          inbox.rows.map((row) => row.wallet.toLowerCase()).sort(),
        ) === JSON.stringify(expectedWallets),
        "Inbox contains only canonical A payer wallets",
      );
      const abi = loadV8Artifacts().event.abi,
        iface = new ethers.Interface(abi);
      provider = new ethers.JsonRpcProvider(
        singleAttemptConnection("https://rpc.chiado.gnosis.gateway.fm"),
        undefined,
        { cacheTimeout: -1, batchMaxCount: 1 },
      );
      check(
        BigInt(await provider.send("eth_chainId", [])) === 10200n,
        "Canonical inbox proof uses Chiado only",
      );
      const c = new ethers.Contract(a.deployment.contract, abi, provider),
        at = { blockTag: inbox.indexedBlock.number };
      check(
        (await provider.getBlock(inbox.indexedBlock.number)).hash ===
          inbox.indexedBlock.hash,
        "Indexed inbox block remains canonical",
      );
      const rows = [];
      for (const row of inbox.rows) {
        const p = before.participants.find((p) => same(p.wallet, row.wallet));
        check(
          p?.identityVerified &&
            p.eventId === a.definition.id &&
            p.id === row.participantId &&
            row.linked &&
            row.name === p.name &&
            row.email === p.email,
          "Names/emails join only this event's authenticated linked wallet",
        );
        const [pending, owed, status] = await Promise.all([
          c.pendingDeposits(row.wallet, at),
          c.owed(row.wallet, at),
          c.status(row.wallet, at),
        ]);
        check(
          row.pendingCreditWei === String(pending) &&
            row.owedWei === String(owed) &&
            Number(status) === 1 &&
            row.committedPrincipalWei === a.deployment.depositWei,
          "Current credit/principal/owed match pinned contract state",
        );
        check(
          row.attendancePaidWei === "0" &&
            row.heldShareWei === "0" &&
            row.claimsPaidWei === "0",
          "Matched-before-ordinary inbox does not invent payments or held shares",
        );
        for (const lot of row.transactions) {
          const receipt = await provider.getTransactionReceipt(lot.txHash),
            log = receipt?.logs.find(
              (l) =>
                l.index === lot.logIndex &&
                same(l.address, a.deployment.contract),
            );
          const event = log ? iface.parseLog(log) : null;
          check(
            receipt?.status === 1 &&
              receipt.blockHash === lot.blockHash &&
              (await provider.getBlock(receipt.blockNumber)).hash ===
                receipt.blockHash &&
              event?.name === "Deposited" &&
              same(event.args.from, row.wallet) &&
              String(event.args.amount) === lot.amountWei &&
              lot.status === "confirmed",
            "Each lot is an actual confirmed canonical payer deposit",
          );
        }
        rows.push({
          wallet: row.wallet,
          receivedWei: row.receivedWei,
          pendingCreditWei: row.pendingCreditWei,
          committedPrincipalWei: row.committedPrincipalWei,
          returnedWei: row.returnedWei,
          creditWithdrawnWei: row.creditWithdrawnWei,
          owedWei: row.owedWei,
          attendancePaidWei: row.attendancePaidWei,
          receiptLots: row.transactions.length,
          secureContactLink: true,
        });
      }
      const alice = inbox.rows.find((row) =>
        same(row.wallet, manifest.rehearsalAddresses.alice),
      );
      check(
        alice.receivedWei === "2000000000000" &&
          alice.creditWithdrawnWei === "1000000000000" &&
          alice.returnedWei === "1000000000000",
        "Alice's historical2D deposit and actualD credit recovery remain distinct from currentD principal",
      );
      const foreign = await context.request.get(
        target(`/api/events/${b.definition.id}/deposit-inbox`),
        { timeout: 120000, maxRedirects: 0 },
      );
      check(foreign.status() === 403, "A owner cannot read B owner inbox");
      stage = "ownerA: loaded inbox and deposit review UI";
      await expect(
        page.locator("#contract-deposit-inbox [data-contract-rows] tbody tr"),
      ).toHaveCount(3);
      await expect(
        page.locator("#contract-deposit-inbox [data-contract-meta]"),
      ).toContainText(String(inbox.indexedBlock.number));
      fs.mkdirSync(screenshots, { recursive: true });
      const capture = async (label) => {
        await page.evaluate(() => {
          document.activeElement?.blur();
          window.scrollTo(0, 0);
        });
        for (const [size, viewport] of [
          ["desktop", { width: 1440, height: 1000 }],
          ["mobile", { width: 390, height: 844 }],
        ]) {
          await page.setViewportSize(viewport);
          check(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
            "Loaded inbox fits viewport",
          );
          const name = `${label}-${size}.png`;
          await page.screenshot({
            path: path.join(screenshots, name),
            fullPage: true,
            mask: [
              page.locator(
                ".contract-person strong,.contract-person small,.person-cell strong,[data-contract-dialog-body] > p:has(strong)",
              ),
            ],
          });
          proof.screenshots.push(
            path.relative(ROOT, path.join(screenshots, name)),
          );
        }
      };
      await capture("owner-overview");
      await page
        .locator(
          `[data-contract-action="review"][data-contract-wallet="${alice.wallet}"]`,
        )
        .click();
      const dialog = page.locator("[data-contract-dialog]");
      await expect(dialog).toBeVisible();
      const fact = (label) =>
        dialog
          .locator("dl.contract-review-facts > div")
          .filter({ has: page.getByText(label, { exact: true }) })
          .locator("dd");
      for (const [label, value] of [
        ["Historical amount received", alice.receivedWei],
        ["Current unused payer credit", alice.pendingCreditWei],
        ["Current committed principal", alice.committedPrincipalWei],
        ["Held case share", alice.heldShareWei],
        ["Still owed", alice.owedWei],
      ])
        await expect(fact(label)).toContainText(`${value} wei`);
      await dialog.locator("details summary").click();
      await expect(dialog).toContainText(a.definition.id);
      await expect(dialog).toContainText(a.deployment.contract);
      await expect(fact("Principal / credit returns recorded")).toContainText(
        "1000000000000 wei",
      );
      await capture("alice-deposit-review");
      await dialog.locator('[data-contract-action="close"]').click();
      const after = await read(eventPath);
      for (const key of [
        "phase",
        "owner",
        "balanceWei",
        "poolWei",
        "pendingTotalWei",
        "heldBackWei",
        "owedTotalWei",
        "challengeEscrowWei",
        "pendingChallenges",
        "payoutShareWei",
      ])
        check(
          JSON.stringify(before.state[key]) ===
            JSON.stringify(after.state[key]),
          "Read-only inbox acceptance changed no financial state",
        );
      ownerSummary = {
        indexedBlock: inbox.indexedBlock,
        counts: inbox.counts,
        rows,
        contactStringsIncludedInProof: false,
        contactStringsMaskedInScreenshots: true,
      };
      provider.destroy();
      provider = null;
      await context.close();
    }
    check(
      proof.nonceSignatures === 2 && failures.length === 0,
      "Exactly two nonce logins and no unexpected browser mutation/runtime error",
    );
    Object.assign(proof, {
      status: "passed",
      checkedAt: new Date().toISOString(),
      ownerInbox: ownerSummary,
      privacy: {
        anonymousDenied: true,
        participantDenied: true,
        foreignOwnerDenied: true,
      },
      limitations: [
        "All three live A payers were already securely linked; unknown-payer behavior remains covered by local tests rather than a new public deposit",
      ],
    });
  } catch {
    proof.stage = stage;
    proof.error =
      "Read-only inbox acceptance stopped; private transport/session/contact diagnostics redacted";
    process.exitCode = 1;
  } finally {
    await browser?.close();
    provider?.destroy();
    fs.mkdirSync(directory, { recursive: true });
    const filename = path.join(directory, "proof.json");
    fs.writeFileSync(filename, JSON.stringify(proof, null, 2) + "\n", {
      flag: "wx",
    });
    console.log(
      JSON.stringify(
        { ...proof, archivedProof: path.relative(ROOT, filename) },
        null,
        2,
      ),
    );
  }
}
