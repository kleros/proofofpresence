// @ts-check
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { ethers } from "ethers";
import { createWorkbench } from "./workbench.mjs";
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

export async function startServer({
  port = Number(process.env.PORT ?? 3000),
  rpcPort = Number(process.env.RPC_PORT ?? 18545),
} = {}) {
  requireThat(
    !process.env.MODE || process.env.MODE === "local-demo",
    "Only local-demo mode is supported; live writes are disabled",
  );
  const w = await createWorkbench({ rpcPort }),
    sessions = new Map(),
    nonces = new Map(),
    localFiles = new Map(),
    configCache = new Map();
  const instanceId = id();
  let listeningPort = port;
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
      `kleros_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`,
    );
  }
  function guardMutation(req, upload = false) {
    requireThat(
      req.headers.origin === `http://${req.headers.host}`,
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
    const observed = await w.state(eventId);
    const key = `${eventId}:${d.contract}:${r.revision}:${observed.owner}`;
    if (configCache.has(key)) return configCache.get(key);
    const dir = path.join(root, ".runtime", instanceId, eventId);
    fs.mkdirSync(dir, { recursive: true });
    const cfg = {
      eventId,
      eventName: r.definition.title,
      description: r.definition.description,
      venue: r.definition.location,
      timezone: r.definition.timezone,
      chain: "local",
      chainId: 1337,
      chainName: "Local demo ETH · no monetary value",
      rpcUrl: w.chain.rpcUrl,
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
      mode: "local-demo",
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
        courtUrl: `http://127.0.0.1:${listeningPort}/#event=${eventId}&view=cases`,
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
      requireThat(
        host === `127.0.0.1:${listeningPort}` ||
          host === `localhost:${listeningPort}`,
        "Loopback host required",
        "BAD_HOST",
        403,
      );
      const url = new URL(req.url, `http://${host}`),
        p = decodeURIComponent(url.pathname),
        s = getSession(req);
      if (
        req.method === "POST" ||
        req.method === "PATCH" ||
        req.method === "DELETE"
      )
        guardMutation(req, p === "/local-upload");
      if (p === "/api/bootstrap" && req.method === "GET")
        return send(res, 200, { ...(await w.bootstrap(s)), instanceId });
      if (p === "/api/session" && req.method === "POST") {
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
          "kleros_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        );
        return send(res, 200, { ok: true });
      }
      if (p === "/api/auth/challenge" && req.method === "POST") {
        const b = await body(req);
        requireThat(ethers.isAddress(b.wallet), "Invalid wallet");
        const nonce = randomBytes(20).toString("hex"),
          expiresAt = Date.now() + 300_000;
        const message = `Kleros local event workbench\nDomain: ${host}\nURI: http://${host}\nChain ID: 1337\nWallet: ${ethers.getAddress(b.wallet)}\nNonce: ${nonce}\nExpires: ${new Date(expiresAt).toISOString()}\nAuthenticate this local wallet. No financial transaction.`;
        nonces.set(nonce, {
          wallet: ethers.getAddress(b.wallet),
          message,
          expiresAt,
          host,
        });
        return send(res, 200, { nonce, message, expiresAt });
      }
      if (p === "/api/auth/verify" && req.method === "POST") {
        const b = await body(req),
          n = nonces.get(b.nonce);
        requireThat(
          n && n.expiresAt > Date.now() && n.host === host,
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
      if (p === "/api/events" && req.method === "POST")
        return send(res, 201, await w.createEvent(s, await body(req)));
      if (p === "/api/demo/advance" && req.method === "POST") {
        requireThat(s, "Sign in first", "UNAUTHENTICATED", 401);
        return send(res, 200, await w.advance((await body(req)).seconds));
      }
      if (p === "/api/demo/fund" && req.method === "POST") {
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
          mode: "local-demo",
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
        await w.state(eventId);
        w.record(eventId, s);
        if (!tail && req.method === "GET")
          return send(res, 200, await w.detail(eventId, s));
        if (!tail && req.method === "PATCH") {
          const r = await w.owner(eventId, s),
            b = await body(req);
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
        if (tail === "personal" && req.method === "POST")
          return send(res, 200, w.personal(eventId, s, await body(req)));
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
                      1337,
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
                      1337,
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
          batch.length <= 50 && batch.every((x) => readMethods.has(x.method)),
          "RPC is read-only",
          "RPC_METHOD_FORBIDDEN",
          403,
        );
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
        const [, eventId, view, file = ""] = finance;
        await w.state(eventId);
        const r = w.record(eventId, s);
        if (view === "console") await w.owner(eventId, s);
        const { cfg, file: cfgPath, dir } = await localConfig(eventId, s);
        if (view === "guest" && (!file || file === "index.html"))
          return send(
            res,
            200,
            fs.readFileSync(path.join(dir, "guest/index.html"), "utf8"),
            "text/html; charset=utf-8",
          );
        if (view === "console") {
          if (!file || file === "index.html")
            return send(
              res,
              200,
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
        [
          "/",
          "/index.html",
          "/app.js",
          "/styles.css",
          "/ethers.js",
          "/transaction-context.js",
          "/reconciliation.js",
          "/assets/kleros-logo.svg",
          "/assets/kleros-symbol.svg",
          "/assets/geist-latin.woff2",
          "/assets/geist-mono-latin.woff2",
          "/assets/instrument-serif-regular.woff2",
          "/assets/instrument-serif-italic.woff2",
        ].includes(p)
      ) {
        const file =
          p === "/ethers.js"
            ? path.join(root, "node_modules/ethers/dist/ethers.umd.min.js")
            : path.join(root, "public", p === "/" ? "index.html" : p.slice(1));
        return send(res, 200, fs.readFileSync(file), mime[path.extname(file)]);
      }
      send(res, 404, { error: "Not found", code: "NOT_FOUND" });
    } catch (e) {
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
      server.listen(port, "127.0.0.1", () => {
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
    `Kleros local demo: ${app.url}\nLocal ETH only. State resets on restart. No production services connected.`,
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
