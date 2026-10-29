# Mainnet hosting checkpoint — 29 October 2026

## Release state

Branch `codex/core-application`; application/image source
`2f597662f846fb816a77bc6b2ea7ac003f25bcb9`. The final change only includes the exact production
manifest in the Docker build context. Core application checkpoint is `fe476ee`, and final public
manifest/policy checkpoint is `e887f05`. No upstream push has occurred.

All four separately approved, human-signed Ethereum infrastructure CREATEs are canonical. Their
original hashes and once-journal are preserved; they must never be replayed. Factory proxy:
`0xEe049D03a007e150ec8ec46B066823043BAcf14E`. Upgrade owner:
`0x2bb03593892724d225071068E59ab1E48aF05b55`, through the reviewed 172800-second timelock.
Total actual gas cost: `0.000466986018937392 ETH`.

The separately approved generic attendance policy was uploaded exactly once and byte-verified:
`https://cdn.kleros.link/ipfs/QmYyofYYD211etbQAabmdoqLeoM5w54STNZW5yfQECYwG1`, 8246 bytes,
SHA256 `24e3608d8ed5daf919671193a71c6e91ebac90095a2780a8946a20cda41f8308`.
The final registry is `registry/ethereum-v9-luma-mainnet.json`, with zero events. No real event,
participant deposit, dispute or kickback has been executed on mainnet by this release work.

**The public application is not launched.** The image builds on Railway/Linux/Node22, but startup
correctly fails when the RPC cannot supply required historical verification reads. The new Netlify
site still has no published deploy. Never describe platform build/SUCCESS status as verified app health.

## Isolated hosting resources

| Resource | Exact identity |
|---|---|
| Netlify site | `5daad91a-3e1c-44f8-a43e-a42adacd6936` / `kleros-luma-ethereum` |
| Public origin | `https://kleros-luma-ethereum.netlify.app` |
| Railway project | `fc82ba7d-dbd8-46a1-90b0-46c150405823` |
| Railway environment | `da2b097e-6883-424e-8539-99fb7422df10` |
| Railway service | `5de64f0d-3712-41c9-b6ae-a5df868e716a` / `luma-mainnet-backend` |
| Backend origin | `https://luma-mainnet-backend-production.up.railway.app` |
| Railway volume | `ff8af62f-9282-4205-ac81-6aac49c06ef0`, mounted at `/data` |
| Durable state | `/data/workbench-state.json` |

The human explicitly approved storing one newly generated app-only gateway secret in BOTH new
services. This configuration is complete; no repeat approval is needed. The secret is separate from
the user's wallet. Private settings, CLI output and the local secret stay under `.runtime/` and
must never be committed, printed or sent to other chats.

The current service settings restore `node src/container.mjs`, with `/healthz`, a 300-second startup
health-check timeout and one replica. Temporary transport observers do not belong in final startup.
Setting changes alone are not proof an existing deployment uses them. Use a fresh service deployment
after the RPC is configured; ordinary snapshot redeploy previously retained old configuration.
The bootstrap drops to UID1000 before importing the app and networking; cloud diagnostic samples
confirmed UID1000. No backend signer or financial broadcast is enabled.

## Verified blocker

The exact reviewed verifier already scans complete constructor/proxy-birth-to-pinned-head history
in inclusive pages of at most5000 blocks. It retains source, creation, role, ownership, upgrade and
canonical-anchor checks. Do not shorten history, substitute recent snapshots or waive these checks.

- PublicNode responds200 to current code but403 to birth-block `eth_getCode`, with an explicit
  personal archive-token requirement. Hosted startup shows the same denial and fails closed.
- dRPC serves the exact birth code and a single birth-block log query. It nevertheless rejects the
  actual range26297406–26297880 (475 blocks) with HTTP400/rpc35 and an inconsistent
  “ranges over10000 blocks” free-plan error, both with and without topics. No pagination patch is
  justified by this result; full verification did not pass.
- Ankr's public endpoint responds to the initial chain-ID request with an API-key-required error.
  No account, key, payment or billing upgrade was created.

The human has ONE pending request in the core chat: set `MAINNET_RPC_URL` directly in the new
Railway service to an authenticated Ethereum-mainnet archive RPC supporting historical `eth_getCode`
and `eth_getLogs`. Credentials must not be pasted into chat. The private override remains server-side;
public bootstrap metadata uses the credential-free manifest RPC. Never log or publish the override.

Public, secret-free diagnostic evidence:

- `artifacts/mainnet-release/mainnet-publicnode-hosted-denial.json`
- `artifacts/mainnet-release/public-rpc-historical-diagnostic.json`
- `artifacts/mainnet-release/mainnet-drpc-full-diagnostic.json`
- `artifacts/mainnet-release/mainnet-drpc-log-ranges.json`
- `artifacts/mainnet-release/mainnet-drpc-log-diagnostic.json`
- `artifacts/mainnet-release/mainnet-ankr-full-diagnostic.json`
- `artifacts/mainnet-release/netlify-new-site-preflight.json`
- `artifacts/mainnet-release/backend-normal-start-health-config.json`

## Prepared application and remaining checks

The 111-file backend context is a closed Git archive, not a working-directory upload. The exact
production registry is allowed; `.env`, `.runtime`, `.git`, keys, wallet plans, deferred Chiado E
helpers and symlinks are excluded. Context/file hashes are in `backend-context-2f59766.json`.
The first missing-manifest packaging failure and subsequent RPC failures remain recorded honestly.

The frontend and gateway match the reviewed source; the latest comparison verified36 tracked files
and8 key artifact pins. The Netlify function build passes. Exact app SHA256:
`6aef1590d728f746ef300274e0be4f3b540c6146290125ccf53567736a5e5de4`; case helper SHA256:
`488354b0e9b0de7b80eaca34e1d88300b291333d1fc40f683b2588d2fb8375ca`.
Optional UI-worktree keyboard annotations remain deferred. Current core routes, receipt/draft
interfaces and financial decisions are documented in `LM_CORE_HANDOFF.md`.

Resume in this order:

1. After the human's RPC-setting confirmation, fresh-deploy the same reviewed source/configuration
   to the exact new Railway service. Require successful full source/history verification and actual
   `/healthz`, then use the private gateway credential in memory for read-only bootstrap/trust checks.
2. Verify the exact Netlify site identity again, then publish only the prepared frontend and current
   gateway to its explicit site ID, from the isolated Netlify control directory. Do not use the root
   checkout's historical Netlify link. Verify returned site/deploy IDs, state and published pointer.
3. Run actual public read-only source/asset/CSP/bootstrap/privacy/RPC checks and desktop/mobile browser
   inspection. Require chain1, the exact factory, verified policy, zero events, no server signing,
   and no exposure of credentials or private case/session data. A local mock ruling is not a jury.
4. Save source-bound public hosting/browser proofs; update this checkpoint, `PROJECT_BRAIN.md` and
   `TEST_REPORT.md`. Send only public origin/source/proof outcomes for independent UI/management
   read-only verification. Report the portal live only after these checks pass.

The human retired the old A/B/C rehearsals incomplete; both old native heartbeat jobs are PAUSED.
Their source, hosted assets, contracts, funds and once-journals remain untouched. D is independently
complete and must not be replayed. No old-site mutation, new financial rehearsal, mainnet user-wallet
signature, upstream push, DNS change or billing upgrade is part of resolving this hosting blocker.
