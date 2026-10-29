// @ts-check
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { execFileSync } from "node:child_process";
import { ethers } from "ethers";
import { assertDemoChainInstance } from "../public/hosted-wallet.js";
import { createWorkbench } from "./workbench.mjs";
import { createDepositInbox } from "./deposit-inbox.mjs";
import { productionErrorResponse } from "./production-errors.mjs";
import { createOrganizerJobService } from "./organizer-jobs.mjs";
import { V10_WALLET_CAPABILITIES } from "./v10-production-wallets.mjs";
import {
  json,
  requireThat,
  id,
  text,
  hash,
  associations,
  csvCell,
} from "./utils.mjs";
import { V7 } from "./chain.mjs";
import { isV8Version } from "./contracts-v8.mjs";
import {
  consoleSettings,
  renderConsole,
} from "../references/kickback/scripts/console-support.mjs";
import { ipfsPathOf } from "../references/kickback/scripts/lib.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const readMethods = new Set([
  "eth_chainId",
  "net_version",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_getTransactionCount",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getLogs",
  "eth_call",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
]);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

const staticPaths = new Set([
  "/",
  "/index.html",
  "/app.js",
  "/entry.js",
  "/public-home.js",
  "/ui-keyboard.js",
  "/selected-event.js",
  "/loading.css",
  "/contract-inbox.js",
  "/contract-profiles.js",
  "/v10-wallet-account.js",
  "/contract-inbox.css",
  "/batch-actions.js",
  "/batch-actions.css",
  "/batch-selection.js",
  "/batch-pending.js",
  "/styles.css",
  "/ethers.js",
  "/transaction-context.js",
  "/environment.js",
  "/luma-launch.js",
  "/luma-launch.css",
  "/luma-setup.js",
  "/setup-progress.js",
  "/owned-events.js",
  "/recovery.html",
  "/recovery-creation.js",
  "/luma-factory.js",
  "/event-search.js",
  "/case-publication.js",
  "/hosted-wallet.js",
  "/reconciliation.js",
  "/policies/v8-testnet.md",
  "/policies/v8-test15m.md",
  "/assets/kleros-logo.svg",
  "/assets/kleros-symbol.svg",
  "/assets/geist-latin.woff2",
  "/assets/geist-mono-latin.woff2",
  "/assets/instrument-serif-regular.woff2",
  "/assets/instrument-serif-italic.woff2",
]);

/**
 * @param {{port?:number,rpcPort?:number,contractVersion?:string,testnet?:any,production?:any,deployment?:{mode?:string,publicOrigin?:string,backendOrigin?:string,proxySecret?:string,runtimeRoot?:string}}} [options]
 */
export async function startServer({
  port = Number(process.env.PORT ?? 3000),
  rpcPort = Number(process.env.RPC_PORT ?? 18545),
  contractVersion = process.env.CONTRACT_VERSION ?? "truth-pays-v7",
  testnet = null,
  production = null,
  deployment = {},
} = {}, { workbenchFactory = createWorkbench } = {}) {
  const mode = deployment.mode ?? process.env.MODE ?? "local-demo";
  requireThat(
    ["local-demo", "hosted-demo", "testnet", "hosted-testnet", "hosted-production"].includes(mode),
    "Choose an explicit supported deployment mode",
  );
  const isProduction = mode === "hosted-production";
  const hosted = mode === "hosted-demo" || mode === "hosted-testnet" || isProduction;
  const external = mode === "testnet" || mode === "hosted-testnet" || isProduction;
  requireThat(!production || isProduction, "Production configuration requires hosted-production mode");
  requireThat(!isProduction || !testnet, "Production cannot use a testnet configuration");
  const configuredOrigin = (value, label) => {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {}
    requireThat(
      parsed &&
        parsed.protocol === "https:" &&
        parsed.origin === value &&
        !parsed.username &&
        !parsed.password,
      `${label} must be an exact HTTPS origin without a path`,
    );
    return parsed;
  };
  const publicUrl = hosted
    ? configuredOrigin(
        deployment.publicOrigin ?? process.env.PUBLIC_ORIGIN,
        "PUBLIC_ORIGIN",
      )
    : null;
  const backendUrl = hosted
    ? configuredOrigin(
        deployment.backendOrigin ?? process.env.BACKEND_ORIGIN,
        "BACKEND_ORIGIN",
      )
    : null;
  const proxySecret = deployment.proxySecret ?? process.env.PROXY_SECRET;
  requireThat(
    !hosted || /^[A-Za-z0-9_-]{43,256}$/.test(proxySecret ?? ""),
    "Hosted mode requires a high-entropy PROXY_SECRET of at least 43 URL-safe characters",
  );
  const proxyDigest = hosted
    ? createHash("sha256").update(proxySecret).digest()
    : null;
  const runtimeRoot = path.resolve(
    deployment.runtimeRoot ??
      process.env.RUNTIME_ROOT ??
      path.join(root, ".runtime"),
  );
  if (isProduction && !production) {
    requireThat(process.env.MAINNET_MANIFEST && process.env.MAINNET_STATE_FILE,
      "Production requires explicit MAINNET_MANIFEST and durable MAINNET_STATE_FILE paths");
    production = {
      manifest: JSON.parse(fs.readFileSync(process.env.MAINNET_MANIFEST, "utf8")),
      stateFile: process.env.MAINNET_STATE_FILE,
      rpcUrl: process.env.MAINNET_RPC_URL,
    };
  }
  if (external && !isProduction && !testnet) {
    requireThat(
      process.env.TESTNET_MANIFEST && process.env.TESTNET_STATE_FILE,
      "Testnet requires explicit TESTNET_MANIFEST and durable TESTNET_STATE_FILE paths",
    );
    testnet = {
      manifest: JSON.parse(
        fs.readFileSync(process.env.TESTNET_MANIFEST, "utf8"),
      ),
      stateFile: process.env.TESTNET_STATE_FILE,
      rpcUrl: process.env.TESTNET_RPC_URL,
    };
  }
  const instanceId = id();
  const w = await workbenchFactory({
      rpcPort,
      contractVersion,
      testnet: external && !isProduction ? testnet : null,
      production: isProduction ? production : null,
      serverInstanceId: instanceId,
      productionOrigin: isProduction ? publicUrl.origin : null,
    }),
    sessions = new Map(),
    nonces = new Map(),
    localFiles = new Map(),
    configCache = new Map();
  requireThat(!isProduction || (w.chain.chainId === 1 && "production" in w.chain && w.chain.production === true &&
    Array.isArray(w.chain.signers) && w.chain.signers.length === 0),
    "Production runtime must be verified chain1 with no server signers", "WRONG_CHAIN", 409);
  const organizerFactory = production?.manifest?.factoryDeployment?.factory ??
    Reflect.get(w.chain, "factoryDeployment")?.factory;
  const productionProfile = isProduction ? production?.manifest?.factoryDeployment?.contractVersion ??
    production?.manifest?.events?.[0]?.deployment?.contractVersion ??
    Reflect.get(w.chain, "manifest")?.factoryDeployment?.contractVersion ?? "kleros-event-v9-uups" : null;
  requireThat(!isProduction || ["kleros-event-v9-uups", "kleros-event-v10-uups"].includes(productionProfile),
    "Choose one exact production contract profile", "DEPLOYMENT_MISMATCH", 409);
  const v10Production = productionProfile === "kleros-event-v10-uups";
  const originalCreationRecovery = isProduction && !v10Production;
  const organizerJobs = isProduction && ethers.isAddress(organizerFactory)
    ? createOrganizerJobService({ instanceId, factory: organizerFactory, contractVersion: productionProfile,
      isSessionCurrent: (session) => [...sessions.values()].some((entry) =>
        entry.session.id === session.id && entry.session.mode === "wallet" &&
        entry.session.wallet.toLowerCase() === session.wallet.toLowerCase() && entry.expiry > Date.now()),
      execute: async (operation, { session, input, draftId, hash: txHash }) => {
        if (operation === "prepare") return w.createFactoryDraft(session, input);
        if (operation === "validate") {
          const draft = await w.validateFactoryDraft(session, draftId);
          return { draft, transaction: draft.transaction };
        }
        const result = await w.reconcileFactorySubmission(session, draftId, txHash);
        return { ...result, ...(result.status === "confirmed"
          ? { participantUrl: `${publicUrl.origin}/#event=${encodeURIComponent(result.eventId)}&view=participant` } : {}) };
      },
    }) : null;
  const depositInbox = createDepositInbox(w, { environment: mode, instanceId });
  let instanceMarker = null;
  if (hosted && !external) {
    // Chain1337 can already exist in a visitor's wallet. A unique zero-value
    // self-transfer distinguishes this process from another deterministic demo.
    const marker = await w.chain.signers[0].sendTransaction({
      to: await w.chain.signers[0].getAddress(),
      value: 0n,
      data: `0x${randomBytes(32).toString("hex")}`,
      gasLimit: 100_000,
    });
    const receipt = await marker.wait();
    instanceMarker = {
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
    };
  }
  let listeningPort = port;
  function protectHostedFinance(html) {
    if (!hosted) return html;
    const metadata = json({
      marker: instanceMarker,
      rpcUrl: `${publicUrl.origin}/rpc`,
    }).replaceAll("<", "\\u003c");
    const guard = `<script>\nconst hostedChainMetadata=${metadata};\nconst hostedChainCheck=${assertDemoChainInstance.toString()};\nasync function hostedWalletRequest(request){\n const provider=window.ethereum;\n if(!provider) throw new Error("Connect a browser wallet to the hosted sandbox first.");\n if(!["eth_chainId","eth_accounts","eth_requestAccounts","wallet_switchEthereumChain","wallet_addEthereumChain"].includes(request.method)){\n  const chain=await provider.request({method:"eth_chainId"});\n  if(BigInt(chain)!==1337n) throw new Error("Select sandbox chain1337 before using these tools.");\n  await hostedChainCheck(provider,hostedChainMetadata.marker,hostedChainMetadata.rpcUrl);\n }\n return provider.request(request);\n}\n</script>`;
    return html
      .replaceAll("window.ethereum.request(", "hostedWalletRequest(")
      .replaceAll(
        "new ethers.BrowserProvider(window.ethereum)",
        "new ethers.BrowserProvider({request:hostedWalletRequest})",
      )
      .replace("<head>", `<head>${guard}`);
  }
  async function body(req, max = 1_000_000) {
    const chunks = [];
    let n = 0;
    for await (const chunk of req) {
      n += chunk.length;
      requireThat(n <= max, "Request too large", "TOO_LARGE", 413);
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString() || "{}");
    } catch {
      requireThat(false, "Invalid JSON");
    }
  }
  const send = (
    res,
    status,
    value,
    type = "application/json; charset=utf-8",
  ) => {
    res.writeHead(status, {
      "content-type": type,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "same-origin",
      "x-frame-options": "SAMEORIGIN",
    });
    res.end(type.startsWith("application/json") ? json(value) : value);
  };
  const getSession = (req) => {
    const token = req.headers.cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("kleros_session="))
      ?.slice(15);
    const entry = sessions.get(token);
    if (!entry || entry.expiry < Date.now()) {
      sessions.delete(token);
      return null;
    }
    return entry.session;
  };
  function setSession(req, res, s) {
    const old = req.headers.cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("kleros_session="))
      ?.slice(15);
    if (old) sessions.delete(old);
    const token = randomBytes(32).toString("hex");
    sessions.set(token, { session: s, expiry: Date.now() + 8 * 3600_000 });
    res.setHeader(
      "set-cookie",
      `kleros_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${hosted ? "; Secure" : ""}`,
    );
  }
  function guardMutation(req, upload = false) {
    requireThat(
      req.headers.origin ===
        (hosted ? publicUrl.origin : `http://${req.headers.host}`),
      "Mutation requires the same origin",
      "BAD_ORIGIN",
      403,
    );
    requireThat(
      upload
        ? req.headers["content-type"]?.startsWith("multipart/form-data")
        : req.headers["content-type"]?.startsWith("application/json"),
      "Unexpected content type",
      "BAD_CONTENT_TYPE",
      415,
    );
  }
  async function localConfig(eventId, s) {
    const r = w.record(eventId, s),
      d = r.deployment;
    requireThat(
      d.contractVersion === "truth-pays-v7" && !external,
      "These compatibility tools support the historical v7 local demo; use the main v8 workflow",
      "WRONG_VERSION",
      409,
    );
    const observed = await w.state(eventId);
    const key = `${eventId}:${d.contract}:${r.revision}:${observed.owner}`;
    if (configCache.has(key)) return configCache.get(key);
    const dir = path.join(runtimeRoot, instanceId, eventId);
    fs.mkdirSync(dir, { recursive: true });
    const cfg = {
      eventId,
      eventName: r.definition.title,
      description: r.definition.description,
      venue: r.definition.location,
      timezone: r.definition.timezone,
      chain: "local",
      chainId: 1337,
      chainName: `${hosted ? "Hosted" : "Local"} demo ETH · no monetary value`,
      rpcUrl: hosted ? `${publicUrl.origin}/rpc` : w.chain.rpcUrl,
      explorer: "",
      deposit: ethers.formatEther(d.depositWei),
      receiver: d.contract,
      contract: d.contract,
      owner: observed.owner,
      depositOpensAt: new Date(d.depositOpensAt * 1000).toISOString(),
      depositDeadline: new Date(d.depositDeadline * 1000).toISOString(),
      eventStart: r.definition.startsAt,
      claimDeadline: new Date(d.claimDeadline * 1000).toISOString(),
      deployBlock: d.deploymentBlock,
      mode,
      abiVersion: "v7",
      logChunk: 5000,
      lumaUrl: "",
      kleros: {
        disputeResolver: d.resolver,
        arbitrator: d.arbitrator,
        court: 0,
        jurors: 3,
        policyURI: d.policyURI,
        ipfsUpload: "/local-upload",
        ipfsGateway: "/local-ipfs",
        courtUrl: `${hosted ? publicUrl.origin : `http://127.0.0.1:${listeningPort}`}/#event=${eventId}&view=cases`,
      },
    };
    const file = path.join(dir, "config.json");
    fs.writeFileSync(file, json(cfg));
    try {
      execFileSync(
        process.execPath,
        [
          path.join(root, "references/kickback/scripts/build-site.mjs"),
          "--config",
          file,
          "--out",
          path.join(dir, "guest"),
        ],
        {
          cwd: path.join(root, "references/kickback"),
          stdio: "pipe",
          timeout: 10_000,
        },
      );
    } catch {
      throw Object.assign(
        new Error(
          "Local compatibility page could not be built; review its event configuration.",
        ),
        { status: 500, code: "LOCAL_BUILD_FAILED" },
      );
    }
    // Only generated local pages use chain time for financial eligibility. Keep wall-clock
    // transaction timeout/replacement logic intact, and leave the historical source unchanged.
    const guestFile = path.join(dir, "guest/index.html");
    const guestHtml = fs
      .readFileSync(guestFile, "utf8")
      .replaceAll(
        "Math.floor(Date.now() / 1000)",
        'Number(BigInt((await rpc("eth_getBlockByNumber", ["latest", false])).timestamp))',
      );
    fs.writeFileSync(guestFile, guestHtml);
    const result = { cfg, file, dir };
    configCache.set(key, result);
    return result;
  }
  const server = http.createServer(async (req, res) => {
    try {
      const host = req.headers.host;
      const url = new URL(req.url, "http://request.invalid"),
        p = decodeURIComponent(url.pathname);
      // Platform probes reveal no chain, identity, session or deployment information.
      if (p === "/healthz" && req.method === "GET")
        return send(res, 200, { status: "ok", mode });
      requireThat(
        hosted
          ? host === backendUrl.host
          : host === `127.0.0.1:${listeningPort}` ||
              host === `localhost:${listeningPort}`,
        hosted ? "Configured backend host required" : "Loopback host required",
        "BAD_HOST",
        403,
      );
      if (hosted) {
        const key = req.headers["x-kleros-proxy-key"];
        const received = createHash("sha256")
          .update(typeof key === "string" ? key : "")
          .digest();
        requireThat(
          timingSafeEqual(proxyDigest, received),
          "Trusted demo gateway required",
          "PROXY_REQUIRED",
          403,
        );
      }
      // Public metadata is actor-independent and never starts a chain refresh or
      // creates/renews a wallet session. Selected and financial routes below
      // retain their existing fresh verification.
      if (p === "/api/public-catalog") {
        requireThat(isProduction && req.method === "GET", "Not found", "NOT_FOUND", 404);
        requireThat(url.search === "", "Catalog does not accept query parameters", "INVALID_INPUT", 400);
        return send(res, 200, w.publicCatalog());
      }
      const s = getSession(req);
      const authOrigin = hosted ? publicUrl.origin : `http://${host}`;
      if (
        req.method === "POST" ||
        req.method === "PATCH" ||
        req.method === "DELETE"
      )
        guardMutation(req, p === "/local-upload");
      if (s?.mode === "recovery-only") {
        // Default deny BEFORE bootstrap, jobs, event routes or any workbench call.
        // A wallet-bearing read session must never reach loose historical auth.
        const permitted =
          (p === "/api/recovery/original-creation" && req.method === "GET") ||
          (p === "/api/session" && req.method === "DELETE") ||
          (req.method === "GET" && staticPaths.has(p));
        requireThat(
          permitted,
          "This session can only inspect its original creation",
          "RECOVERY_ONLY",
          403,
        );
      }

      if (isProduction) {
        requireThat(!(p === "/api/events" && req.method === "POST"),
          "Production deployments require a separately reviewed deployment plan", "DEMO_ONLY", 403);
        requireThat(!/^\/api\/(?:demo\/|events\/[^/]+\/demo\/)/.test(p),
          "Demo controls are unavailable in production", "DEMO_ONLY", 403);
        requireThat(!/^\/(?:local-upload|local-ipfs|local-policy)(?:\/|$)/.test(p),
          "Local preview files are unavailable in production", "NOT_FOUND", 404);
      }
      if (p === "/api/bootstrap" && req.method === "GET") {
        const selected = url.searchParams.has("selectedEventId");
        requireThat(
          !selected || url.searchParams.getAll("selectedEventId").length === 1,
          "Choose one stable event identity",
          "INVALID_INPUT",
          400,
        );
        /** @type {any} */
        let bootstrap = await w.bootstrap(
          s,
          selected
            ? { selectedEventId: url.searchParams.get("selectedEventId") }
            : undefined,
        );
        const selectedSession = selected || isProduction ? getSession(req) : s;
        if ((selected || isProduction) && selectedSession !== s)
          bootstrap = {
            ...bootstrap,
            session: selectedSession
              ? {
                  wallet: selectedSession.wallet,
                  label: selectedSession.label,
                  mode: selectedSession.mode,
                }
              : null,
            events: [],
            ...(isProduction ? { recoveryEvents: [] } : {}),
            ...("selectedEvent" in bootstrap ? { selectedEvent: {
              eventId: bootstrap.selectedEvent.eventId,
              wallet: selectedSession?.wallet ?? null,
              detail: null,
              error: {
                code: "SELECTED_EVENT_SESSION_CHANGED",
                status: 401,
                message: "Wallet session changed; refresh and try again",
              },
            } } : {}),
          };
        /** @type {Record<string, unknown>} */
        const capabilities = external
          ? {
              sharedDemo: false,
              browserWallet: true,
              createEvents: false,
              timeControls: false,
              ...(isProduction ? {
                organizerJobs: organizerJobs !== null,
                production: true, walletTransactions: true, serverSigning: false,
                lumaDepositPortal: true, walletFirstDeposits: true,
                createEvents: bootstrap.factory?.verified === true && bootstrap.organizerSetup?.policyStatus === "verified",
                financialInterface: "kleros-native-v1",
                transactionsReady: !Reflect.get(w.chain, "eventVerification") ||
                  [...Reflect.get(w.chain, "eventVerification").values()].some(entry => entry.status === "verified") ||
                  bootstrap.factory?.verified === true,
                supportedAccountTypes: ["eoa"], contractWallets: false,
                erc1271: false, eip7702: false, reset: false, timeTravel: false,
                mockRulings: false,
                ...(v10Production ? { ...V10_WALLET_CAPABILITIES, casePublication: false, originalCreationRecovery: false } : {}),
              } : {}),
            }
          : hosted
            ? { sharedDemo: true, browserWallet: true }
            : {};
        if (isV8Version(bootstrap.contractVersion)) {
          capabilities.contractInbox = true;
          capabilities.batchActions = true;
        }
        if (selected) capabilities.selectedEventBootstrap = true;
        return send(res, 200, {
          ...bootstrap,
          mode,
          instanceId,
          ...(selected && "selectedEvent" in bootstrap
            ? {
                selectedEvent: {
                  ...bootstrap.selectedEvent,
                  instanceId,
                  wallet: selectedSession?.wallet ?? null,
                },
              }
            : {}),
          chain: {
            ...bootstrap.chain,
            rpcUrl:
              hosted && !external
                ? `${publicUrl.origin}/rpc`
                : bootstrap.chain.rpcUrl,
            ...(hosted && !external ? { instanceMarker } : {}),
          },
          ...(Object.keys(capabilities).length ? { capabilities } : {}),
        });
      }
      if (p === "/api/session" && req.method === "POST") {
        requireThat(
          !external,
          "Testnet requires a signed wallet login",
          "WALLET_REQUIRED",
          403,
        );
        const b = await body(req),
          selected = w.session(b.identity);
        setSession(req, res, {
          ...selected,
          identityId: selected.id,
          id: id(),
        });
        return send(res, 200, {
          wallet: selected.wallet,
          label: selected.label,
          mode: selected.mode,
        });
      }
      if (p === "/api/session" && req.method === "DELETE") {
        const t = req.headers.cookie?.match(/kleros_session=([^;]+)/)?.[1];
        sessions.delete(t);
        res.setHeader(
          "set-cookie",
          `kleros_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${hosted ? "; Secure" : ""}`,
        );
        return send(res, 200, { ok: true });
      }
      if (p === "/api/auth/challenge" && req.method === "POST") {
        const b = await body(req);
        requireThat(ethers.isAddress(b.wallet), "Invalid wallet");
        await w.assertWallet(b.wallet);
        const nonce = randomBytes(20).toString("hex"),
          expiresAt = Date.now() + 300_000;
        const message = `Kleros ${isProduction ? "Ethereum mainnet" : external ? "Chiado testnet" : hosted ? "hosted demo" : "local event"} workbench\nDomain: ${new URL(authOrigin).host}\nURI: ${authOrigin}\nChain ID: ${w.chain.chainId}\nWallet: ${ethers.getAddress(b.wallet)}\nNonce: ${nonce}\nExpires: ${new Date(expiresAt).toISOString()}\nAuthenticate this ${isProduction ? "Ethereum mainnet" : external ? "testnet" : "isolated demo"} wallet. No financial transaction.`;
        nonces.set(nonce, {
          purpose: "wallet-auth",
          wallet: ethers.getAddress(b.wallet),
          message,
          expiresAt,
          origin: authOrigin,
        });
        return send(res, 200, { nonce, message, expiresAt });
      }
      if (p === "/api/auth/verify" && req.method === "POST") {
        const b = await body(req),
          n = nonces.get(b.nonce);
        requireThat(
          n && n.purpose === "wallet-auth" && n.expiresAt > Date.now() && n.origin === authOrigin,
          "Nonce expired or wrong domain",
          "BAD_NONCE",
          403,
        );
        nonces.delete(b.nonce);
        requireThat(
          ethers.verifyMessage(n.message, b.signature) === n.wallet,
          "Signature does not prove wallet ownership",
          "BAD_SIGNATURE",
          403,
        );
        await w.assertWallet(n.wallet);
        const walletSession = {
          id: id(),
          wallet: n.wallet,
          label: "Verified browser wallet",
          mode: "wallet",
        };
        setSession(req, res, walletSession);
        return send(res, 200, {
          wallet: n.wallet,
          label: walletSession.label,
          mode: "wallet",
        });
      }
      if (p === "/api/recovery/auth/challenge" && req.method === "POST") {
        requireThat(
          originalCreationRecovery && typeof w.creationRecoveryScope === "function",
          "Creation recovery is unavailable",
          "NOT_FOUND",
          404,
        );
        requireThat(
          url.search === "",
          "Use an exact recovery request",
          "INVALID_INPUT",
          400,
        );
        const b = await body(req);
        requireThat(
          Object.keys(b).length === 2 &&
            ethers.isAddress(b.wallet) &&
            /^0x[0-9a-fA-F]{64}$/.test(b.hash ?? ""),
          "Use your wallet and original transaction hash",
          "INVALID_INPUT",
          400,
        );
        const wallet = ethers.getAddress(b.wallet),
          txHash = b.hash.toLowerCase();
        const nonce = randomBytes(20).toString("hex"),
          expiresAt = Date.now() + 300_000;
        const message = `Kleros original event creation recovery\nPurpose: Read only; no financial authority\nDomain: ${new URL(authOrigin).host}\nURI: ${authOrigin}\nChain ID: 1\nWallet: ${wallet}\nOriginal transaction: ${txHash}\nNonce: ${nonce}\nExpires: ${new Date(expiresAt).toISOString()}\nAuthenticate to inspect only your matching saved event creation. This signature cannot authorize a transaction, deposit, dispute, payout, event adoption or account change.`;
        nonces.set(nonce, {
          purpose: "factory-creation-recovery",
          wallet,
          hash: txHash,
          message,
          expiresAt,
          origin: authOrigin,
        });
        return send(res, 200, {
          nonce,
          message,
          expiresAt,
          instanceId,
          purpose: "factory-creation-recovery",
          chainId: 1,
        });
      }
      if (p === "/api/recovery/auth/verify" && req.method === "POST") {
        requireThat(
          originalCreationRecovery && typeof w.creationRecoveryScope === "function",
          "Creation recovery is unavailable",
          "NOT_FOUND",
          404,
        );
        requireThat(
          url.search === "",
          "Use an exact recovery request",
          "INVALID_INPUT",
          400,
        );
        const b = await body(req),
          n = nonces.get(b.nonce);
        requireThat(
          n?.purpose === "factory-creation-recovery" &&
            n.expiresAt > Date.now() &&
            n.origin === authOrigin,
          "Recovery nonce expired or wrong purpose",
          "BAD_NONCE",
          403,
        );
        nonces.delete(b.nonce);
        let recovered;
        try {
          recovered = ethers.verifyMessage(n.message, b.signature);
        } catch {}
        requireThat(
          recovered === n.wallet,
          "Signature does not prove wallet ownership",
          "BAD_SIGNATURE",
          403,
        );
        const recoveryScope = w.creationRecoveryScope(n.wallet, n.hash);
        requireThat(
          recoveryScope?.wallet?.toLowerCase() === n.wallet.toLowerCase() &&
            recoveryScope.hash?.toLowerCase() === n.hash &&
            recoveryScope.instanceId === instanceId,
          "Recovery scope changed",
          "RECOVERY_SCOPE",
          409,
        );
        setSession(req, res, {
          id: id(),
          wallet: n.wallet,
          label: "Original creation · read only",
          mode: "recovery-only",
          recoveryScope,
        });
        return send(res, 200, {
          wallet: n.wallet,
          mode: "recovery-only",
          instanceId,
          hash: n.hash,
          capabilities: {
            walletTransactions: false,
            createEvents: false,
            manageEvents: false,
            adoptEvent: false,
          },
        });
      }
      if (p === "/api/recovery/original-creation" && req.method === "GET") {
        requireThat(
          originalCreationRecovery && typeof w.inspectCreationRecovery === "function",
          "Creation recovery is unavailable",
          "NOT_FOUND",
          404,
        );
        requireThat(
          s?.mode === "recovery-only",
          "Authenticate the original creation first",
          "UNAUTHENTICATED",
          401,
        );
        requireThat(
          url.search === "",
          "Recovery reads only the signed original scope",
          "INVALID_INPUT",
          400,
        );
        requireThat(
          getSession(req) === s,
          "Recovery session changed",
          "RECOVERY_SESSION_CHANGED",
          401,
        );
        const result = await w.inspectCreationRecovery(s);
        requireThat(
          getSession(req) === s,
          "Recovery session changed",
          "RECOVERY_SESSION_CHANGED",
          401,
        );
        return send(res, 200, {
          ...result,
          mode,
          instanceId,
          session: { wallet: s.wallet, mode: "recovery-only" },
        });
      }
      const organizerJobRoute = p.match(/^\/api\/organizer\/events\/jobs(?:\/([a-zA-Z0-9_-]+))?$/);
      if (organizerJobRoute) {
        requireThat(organizerJobs, "Organizer checks are unavailable", "FACTORY_UNAVAILABLE", 503);
        requireThat(s?.mode === "wallet", "Sign in with your wallet first", "UNAUTHENTICATED", 401);
        requireThat(url.search === "", "Use an exact job request", "INVALID_INPUT", 400);
        const requestId = organizerJobRoute[1];
        if (!requestId && req.method === "POST")
          return send(res, 202, organizerJobs.start(s, await body(req)));
        if (requestId && req.method === "GET")
          return send(res, 200, organizerJobs.status(s, requestId));
        return send(res, 405, { error: "Method is not available", code: "METHOD_NOT_ALLOWED" });
      }
      const factoryRoute = p.match(/^\/api\/organizer\/events\/drafts(?:\/([a-zA-Z0-9_-]+)(?:\/(validate|submitted|reconcile))?)?$/);
      if (factoryRoute) {
        requireThat(isProduction, "Organizer setup requires the verified production factory", "FACTORY_UNAVAILABLE", 503);
        requireThat(s?.mode === "wallet", "Sign in with your wallet first", "UNAUTHENTICATED", 401);
        const [, draftId, action] = factoryRoute;
        if (!draftId && req.method === "POST")
          return send(res, 201, await w.createFactoryDraft(s, await body(req)));
        if (draftId && !action && req.method === "GET")
          return send(res, 200, await w.getFactoryDraft(s, draftId));
        if (draftId && req.method === "POST" && action) {
          const input = await body(req);
          if (action === "validate") {
            const draft = await w.validateFactoryDraft(s, draftId);
            return send(res, 200, { draft, transaction: draft.transaction });
          }
          if (action === "submitted")
            return send(res, 200, await w.recordFactorySubmitted(s, draftId, input.hash));
          const result = await w.reconcileFactorySubmission(s, draftId, input.hash);
          return send(res, 200, { ...result, ...(result.status === "confirmed"
            ? { participantUrl: `${publicUrl.origin}/#event=${encodeURIComponent(result.eventId)}&view=participant` } : {}) });
        }
        return send(res, 405, { error: "Method is not available", code: "METHOD_NOT_ALLOWED" });
      }
      if (p === "/api/events" && req.method === "POST")
        return send(res, 201, await w.createEvent(s, await body(req)));
      if (p === "/api/demo/advance" && req.method === "POST") {
        requireThat(s, "Sign in first", "UNAUTHENTICATED", 401);
        return send(res, 200, await w.advance((await body(req)).seconds));
      }
      if (p === "/api/demo/fund" && req.method === "POST") {
        requireThat(
          !external,
          "Use the Chiado faucet for test xDAI",
          "TESTNET_FAUCET",
          403,
        );
        requireThat(
          s?.mode === "wallet",
          "Authenticate a browser wallet first",
          "WALLET_REQUIRED",
          403,
        );
        await body(req);
        requireThat(
          (await w.provider.getBalance(s.wallet)) < ethers.parseEther("1"),
          "Wallet already has at least 1 local ETH",
        );
        const tx = await w.chain.signers[0].sendTransaction({
          to: s.wallet,
          value: ethers.parseEther("1"),
        });
        const receipt = await tx.wait();
        return send(res, 200, {
          hash: tx.hash,
          blockNumber: receipt.blockNumber,
          amountWei: String(ethers.parseEther("1")),
          mode,
        });
      }
      if (p === "/local-upload" && req.method === "POST") {
        requireThat(
          s,
          "Authenticate before storing local evidence",
          "UNAUTHENTICATED",
          401,
        );
        const chunks = [];
        let n = 0;
        for await (const chunk of req) {
          n += chunk.length;
          requireThat(
            n <= 300_000,
            "Local evidence is limited to one 256 KiB IPFS block",
            "TOO_LARGE",
            413,
          );
          chunks.push(chunk);
        }
        const form = await new Response(Buffer.concat(chunks), {
          headers: { "content-type": req.headers["content-type"] },
        }).formData();
        const file = form.get("data");
        if (!file || typeof file === "string")
          throw new Error("Upload a file in the data field");
        const bytes = new Uint8Array(await file.arrayBuffer()),
          uri = ipfsPathOf(bytes);
        localFiles.set(uri, Buffer.from(bytes));
        return send(res, 200, {
          path: uri,
          status: "local-only",
          sha256: hash(bytes),
          notice:
            "Stored in this process only. No IPFS publication or remote request occurred.",
        });
      }
      const match = p.match(/^\/api\/events\/([a-zA-Z0-9_-]+)(?:\/(.*))?$/);
      if (match) {
        const [, eventId, tail = ""] = match;
        if (tail === "deposit-inbox" && req.method === "GET")
          return send(res, 200, await depositInbox.read(eventId, s));
        if (tail === "deposit-inbox/refresh" && req.method === "POST") {
          const input = await body(req);
          requireThat(
            input &&
              typeof input === "object" &&
              !Array.isArray(input) &&
              Object.keys(input).length === 0,
            "Refresh accepts an empty object only",
          );
          return send(
            res,
            200,
            await depositInbox.read(eventId, s, { refresh: true }),
          );
        }
        // These endpoints record facts about an already submitted transaction.
        // A later upgrade must not make its canonical receipt inaccessible.
        const recoveryHash = tail.match(/^submissions\/(0x[0-9a-fA-F]{64})$/);
        const recoveryDraft = tail.match(/^drafts\/([^/]+)\/submitted$/);
        if (isProduction && ((tail === "submissions/reconcile" && req.method === "POST") ||
          (recoveryHash && req.method === "GET") || (recoveryDraft && req.method === "POST"))) {
          requireThat(s, "Sign in first", "UNAUTHENTICATED", 401);
          if (recoveryHash) return send(res, 200, await w.submissionStatus(eventId, s, recoveryHash[1]));
          const input = await body(req);
          if (recoveryDraft) return send(res, 200, await w.recordSubmitted(eventId, s, recoveryDraft[1], input.hash));
          return send(res, 200, await w.reconcileSubmission(eventId, s, input.draftId, input.hash));
        }
        await w.state(eventId);
        w.record(eventId, s);
        if (!tail && req.method === "GET")
          return send(res, 200, await w.detail(eventId, s));
        if (!tail && req.method === "PATCH") {
          const r = await w.owner(eventId, s),
            b = await body(req);
          requireThat(!isProduction || !["lumaUrl", "lumaEventId", "contentUrl", "contentEventId"].some(key => Object.hasOwn(b, key)),
            "The Luma destination was fixed in the event creation review", "IMMUTABLE_EVENT_TERMS", 409);
          const allowed = [
            "description",
            "location",
            "visibility",
            "editorialStatus",
            "registrationStatus",
            "lumaEventId",
            "lumaUrl",
            "contentEventId",
            "contentUrl",
          ];
          requireThat(
            Object.keys(b).every((k) => allowed.includes(k)),
            "Financial terms and stable identity cannot be edited; create a new deployment",
          );
          if (b.visibility)
            requireThat(
              ["private", "public"].includes(b.visibility),
              "Invalid visibility",
            );
          if (b.editorialStatus)
            requireThat(
              ["draft", "published"].includes(b.editorialStatus),
              "Invalid editorial status",
            );
          if (b.registrationStatus)
            requireThat(
              ["open", "closed"].includes(b.registrationStatus),
              "Invalid registration status",
            );
          const linked = associations(b);
          for (const [k, v] of Object.entries(b))
            if (!Object.hasOwn(linked, k))
              r.definition[k] = text(v, k === "description" ? 2000 : 200, 1);
          Object.assign(r.definition, linked);
          r.revision++;
          w.persist();
          return send(res, 200, r.definition);
        }
        if (tail === "participants" && req.method === "POST")
          return send(
            res,
            201,
            await w.registerParticipant(eventId, s, await body(req)),
          );
        if (tail.startsWith("participants/") && req.method === "PATCH")
          return send(
            res,
            200,
            await w.admit(
              eventId,
              s,
              tail.slice(13),
              (await body(req)).admission,
            ),
          );
        if (tail === "deposits" && req.method === "POST")
          return send(
            res,
            200,
            await w.linkDeposit(eventId, s, await body(req)),
          );
        if (tail === "checkins" && req.method === "POST")
          return send(res, 201, await w.checkin(eventId, s, await body(req)));
        if (tail === "batches/preview" && req.method === "POST") {
          requireThat(s, "Sign in first", "UNAUTHENTICATED", 401);
          return send(
            res,
            201,
            await w.previewBatch(eventId, s, await body(req)),
          );
        }
        const batchCommit = tail.match(/^batches\/([^/]+)\/commit$/);
        if (batchCommit && req.method === "POST") {
          requireThat(s, "Sign in first", "UNAUTHENTICATED", 401);
          return send(
            res,
            200,
            await w.commitBatch(eventId, s, batchCommit[1], await body(req)),
          );
        }
        const batchStatus = tail.match(/^batches\/([^/]+)$/);
        if (batchStatus && req.method === "GET") {
          requireThat(s, "Sign in first", "UNAUTHENTICATED", 401);
          return send(
            res,
            200,
            await w.batchStatus(eventId, s, batchStatus[1]),
          );
        }
        if (tail === "personal" && req.method === "POST")
          return send(res, 200, await w.personal(eventId, s, await body(req)));
        if (tail === "imports" && req.method === "POST")
          return send(res, 201, await w.importCsv(eventId, s, await body(req)));
        if (tail === "imports/preview" && req.method === "POST")
          return send(
            res,
            200,
            await w.previewImport(eventId, s, await body(req)),
          );
        const importCommit = tail.match(/^imports\/([^/]+)\/commit$/);
        if (importCommit && req.method === "POST")
          return send(
            res,
            201,
            await w.commitImport(
              eventId,
              s,
              importCommit[1],
              (await body(req)).review,
            ),
          );
        const submission = tail.match(/^submissions\/(0x[0-9a-fA-F]{64})$/);
        if (tail === "submissions/reconcile" && req.method === "POST") {
          const b = await body(req);
          return send(
            res,
            200,
            await w.reconcileSubmission(eventId, s, b.draftId, b.hash),
          );
        }
        if (submission && req.method === "GET")
          return send(
            res,
            200,
            await w.submissionStatus(eventId, s, submission[1]),
          );
        if (tail === "drafts" && req.method === "POST")
          return send(
            res,
            201,
            await w.createDraft(eventId, s, await body(req)),
          );
        const draft = tail.match(
          /^drafts\/([^/]+)\/(execute|confirm|validate|submitted)$/,
        );
        if (draft && req.method === "POST") {
          requireThat(!isProduction || draft[2] !== "execute",
            "Production transactions require a browser wallet", "WALLET_SIGNATURE_REQUIRED", 403);
          const b = await body(req);
          if (draft[2] === "submitted")
            return send(
              res,
              200,
              await w.recordSubmitted(eventId, s, draft[1], b.hash),
            );
          if (draft[2] === "validate") {
            const result = await w.validateDraft(eventId, s, draft[1]);
            return send(res, 200, result.d.transaction);
          }
          return send(
            res,
            200,
            draft[2] === "execute"
              ? await w.executeDraft(eventId, s, draft[1])
              : await w.confirmDraft(eventId, s, draft[1], b.hash),
          );
        }
        const productionCase = tail.match(/^cases\/(0x[0-9a-fA-F]{40})\/(artifact|availability|publish)$/);
        if (isProduction && productionCase && req.method === "POST") {
          const input = await body(req);
          const assertSession = () => requireThat(getSession(req) === s && s,
            "Wallet session changed; authenticate again", "UNAUTHENTICATED", 401);
          assertSession();
          const action = productionCase[2], wallet = productionCase[1];
          if (action !== "publish") requireThat(input && !Array.isArray(input) &&
            typeof input === "object" && Object.keys(input).length === 0,
            "This read-only case action accepts no parameters");
          const out = action === "artifact"
            ? await w.caseArtifact(eventId, s, wallet, assertSession)
            : action === "availability"
              ? await w.verifyCaseArtifact(eventId, s, wallet, assertSession)
              : await w.publishCaseArtifact(eventId, s, wallet, input, assertSession);
          assertSession();
          return send(res, 200, out);
        }
        const publish = tail.match(/^cases\/(0x[0-9a-fA-F]{40})\/publish$/);
        if (publish && req.method === "POST") {
          const out = await w.publish(eventId, s, publish[1]);
          localFiles.set(out.uri, out.content);
          return send(res, 200, out);
        }
        if (tail === "demo/ruling" && req.method === "POST") {
          const b = await body(req);
          return send(
            res,
            200,
            await w.mockRuling(eventId, s, b.wallet, b.ruling),
          );
        }
        if (tail === "demo/appeal" && req.method === "POST") {
          const b = await body(req);
          return send(
            res,
            200,
            await w.mockAppeal(eventId, s, b.wallet, b.ruling, b.duration),
          );
        }
        if (tail === "fixture" && req.method === "GET") {
          const r = await w.owner(eventId, s),
            kind = url.searchParams.get("kind") ?? "attendance";
          const csv =
            kind === "guests"
              ? "event_id,chain_id,contract,participant_id,email,wallet,tx_hash,admission\n" +
                [...r.participants.values()]
                  .map((x) =>
                    [
                      eventId,
                      r.deployment.chainId,
                      r.deployment.contract,
                      x.id,
                      x.email,
                      x.wallet,
                      x.deposit?.txHash ?? "",
                      x.admission,
                    ]
                      .map(csvCell)
                      .join(","),
                  )
                  .join("\n")
              : "event_id,chain_id,contract,participant_id,email,wallet,checked_in_at\n" +
                [...r.participants.values()]
                  .slice(0, 1)
                  .map((x) =>
                    [
                      eventId,
                      r.deployment.chainId,
                      r.deployment.contract,
                      x.id,
                      x.email,
                      x.wallet,
                      r.definition.startsAt,
                    ]
                      .map(csvCell)
                      .join(","),
                  )
                  .join("\n");
          res.setHeader(
            "content-disposition",
            `attachment; filename="${eventId}-${kind}.csv"`,
          );
          return send(res, 200, csv, "text/csv; charset=utf-8");
        }
      }
      if (p === "/rpc" && req.method === "POST") {
        const b = await body(req),
          batch = Array.isArray(b) ? b : [b];
        requireThat(
          batch.length > 0 &&
            batch.length <= 50 &&
            batch.every(
              (x) =>
                readMethods.has(x?.method) ||
                (hosted && !external && x?.method === "eth_sendRawTransaction"),
            ) &&
            batch.filter((x) => x?.method === "eth_sendRawTransaction")
              .length <= 1,
          hosted
            ? "RPC allows bounded reads and one signed demo transaction"
            : "RPC is read-only",
          "RPC_METHOD_FORBIDDEN",
          403,
        );
        // The public wallet transport never exposes unlocked Ganache accounts or
        // administrative methods. Validate the entire batch before forwarding any call.
        for (const x of batch.filter(
          (x) => x.method === "eth_sendRawTransaction",
        )) {
          let tx;
          try {
            requireThat(
              Array.isArray(x.params) &&
                x.params.length === 1 &&
                typeof x.params[0] === "string" &&
                ethers.isHexString(x.params[0]) &&
                x.params[0].length <= 2 + 2 * (65_536 + 1024),
              "Invalid signed demo transaction",
            );
            tx = ethers.Transaction.from(x.params[0]);
          } catch {
            throw Object.assign(
              new Error("A valid bounded signed demo transaction is required"),
              {
                status: 403,
                code: "RPC_TRANSACTION_FORBIDDEN",
              },
            );
          }
          const destinations = new Set(
            [...w.events.values()].flatMap((r) =>
              [
                r.deployment.contract,
                r.deployment.resolver,
                r.deployment.arbitrator,
              ].map((value) => String(value).toLowerCase()),
            ),
          );
          requireThat(
            tx.isSigned() &&
              tx.from &&
              tx.chainId === 1337n &&
              tx.to &&
              destinations.has(tx.to.toLowerCase()) &&
              tx.gasLimit > 0n &&
              tx.gasLimit <= 6_000_000n &&
              ethers.getBytes(tx.data).length <= 65_536 &&
              [0, 1, 2].includes(tx.type ?? 0),
            "Signed transaction must target a registered demo contract on chain 1337 within gas/data bounds",
            "RPC_TRANSACTION_FORBIDDEN",
            403,
          );
        }
        const results = await Promise.all(
          batch.map(async (x) => {
            try {
              return {
                jsonrpc: "2.0",
                id: x.id,
                result: await w.provider.send(x.method, x.params ?? []),
              };
            } catch {
              return {
                jsonrpc: "2.0",
                id: x.id,
                error: { code: -32000, message: "Local RPC request failed" },
              };
            }
          }),
        );
        return send(res, 200, Array.isArray(b) ? results : results[0]);
      }
      if (p.startsWith("/local-policy/")) {
        const r = [...w.events.values()].find(
          (x) => x.deployment.policyURI === p,
        );
        requireThat(r, "Unknown policy", "NOT_FOUND", 404);
        w.record(r.definition.id, s);
        return send(res, 200, r.policy, "text/plain; charset=utf-8");
      }
      if (p.startsWith("/local-ipfs/")) {
        const value = localFiles.get(p.slice(11));
        requireThat(value, "Not published locally", "NOT_FOUND", 404);
        return send(res, 200, value, "application/octet-stream");
      }
      // Legacy modules stay event-scoped. Their external upload/gateway settings point only here.
      const finance = p.match(
        /^\/finance\/([a-zA-Z0-9_-]+)\/(guest|console)(?:\/(.*))?$/,
      );
      if (finance && req.method === "GET") {
        requireThat(!isProduction, "Legacy demo finance tools are unavailable in production", "NOT_FOUND", 404);
        const [, eventId, view, file = ""] = finance;
        await w.state(eventId);
        const r = w.record(eventId, s);
        if (view === "console") await w.owner(eventId, s);
        const { cfg, file: cfgPath, dir } = await localConfig(eventId, s);
        if (view === "guest" && (!file || file === "index.html"))
          return send(
            res,
            200,
            protectHostedFinance(
              fs.readFileSync(path.join(dir, "guest/index.html"), "utf8"),
            ),
            "text/html; charset=utf-8",
          );
        if (view === "console") {
          if (!file || file === "index.html")
            return send(
              res,
              200,
              protectHostedFinance(
                renderConsole(`/finance/${eventId}/console`, r.definition.title)
                  .replace("<script>", "<script>\nlet DEMO_CHAIN_TIME = 0;\n")
                  .replace(
                    "async function refresh() {",
                    'async function refresh() {\n  DEMO_CHAIN_TIME = Number((await rp.getBlock("latest")).timestamp);\n',
                  )
                  .replace(
                    /const (now|nowS) = Math.floor\(Date.now\(\) \/ 1000\);/g,
                    "const $1 = DEMO_CHAIN_TIME;",
                  ),
              ),
              "text/html; charset=utf-8",
            );
          if (file === "config.json") return send(res, 200, cfg);
          if (file === "settings.json")
            return send(res, 200, consoleSettings(cfgPath));
          if (file === "build/TruthPaysKickback.json")
            return send(res, 200, V7);
          if (file === "node_modules/ethers/dist/ethers.umd.min.js")
            return send(
              res,
              200,
              fs.readFileSync(
                path.join(root, "node_modules/ethers/dist/ethers.umd.min.js"),
                "utf8",
              ),
              "text/javascript; charset=utf-8",
            );
          // Root financial plans are reviewed/consumed through its draft API. Old file actions require explicit script preparation.
        }
      }
      if (
        req.method === "GET" &&
        staticPaths.has(p)
      ) {
        const file =
          p === "/ethers.js"
            ? path.join(root, "node_modules/ethers/dist/ethers.umd.min.js")
            : path.join(root, "public", p === "/" ? "index.html" : p.slice(1));
        return send(res, 200, fs.readFileSync(file), mime[path.extname(file)]);
      }
      send(res, 404, { error: "Not found", code: "NOT_FOUND" });
    } catch (e) {
      if (isProduction && !res.headersSent) {
        const result = productionErrorResponse(e);
        return send(res, result.status, result.body);
      }
      if (!res.headersSent)
        send(
          res,
          Number.isInteger(e.status) && e.status >= 400 && e.status <= 599
            ? e.status
            : 400,
          {
            error: e.shortMessage ?? e.message ?? "Request failed",
            code: e.code ?? "INVALID_INPUT",
          },
        );
      else res.end();
    }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, hosted ? "0.0.0.0" : "127.0.0.1", () => {
        const address = server.address();
        if (address && typeof address !== "string")
          listeningPort = address.port;
        resolve(undefined);
      });
    });
  } catch (e) {
    await w.close();
    throw e;
  }
  return {
    mode,
    server,
    workbench: w,
    url: `http://127.0.0.1:${listeningPort}`,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await w.close();
    },
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const app = await startServer();
  console.log(
    `Kleros workbench backend: ${app.url}\nMode: ${app.mode}`,
  );
  let closing = false;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      if (closing) return;
      closing = true;
      await app.close();
      process.exit(0);
    });
}
