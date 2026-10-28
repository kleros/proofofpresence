# Interactive hosted demo

The full interactive demo is live at
[kleros-event-workbench-preview.netlify.app](https://kleros-event-workbench-preview.netlify.app).
Published 28 October 2026,15:31:28UTC; **370 live acceptance checks passed**.

## Deployed source and services

- Branch: `codex/core-application`; source: `371b4c80b0c65ce7b7f571ca41d9f85c8720660b`.
- Netlify site: `f6b82f41-9e30-49b0-a836-40fedbab93a4`;
  deploy: `6ae2154852ea8b5634d56e84`, state `ready`.
- Railway project: `23ab879a-90d0-4f8f-a56a-d63baa85eed5`;
  service: `d9178cc4-b1a5-4b80-af54-6c2b0aafe8f6`, environment `production`.
- Backend: `https://workbench-api-production-d9a7.up.railway.app`;
  deployment: `2186138d-9268-4ec8-8ab9-575c76067ca7`, state `SUCCESS`.
- Railway-reported image digest:
  `sha256:af03586b14ff715b992daf12d5e0734c2fdcb22f0517dce46d35fb15d9ecfab7`.

Both application packages were assembled from that immutable v7 commit. The concurrent v8 experiment
in the shared working directory was preserved and excluded from deployment. Public metadata and
evidence are in `artifacts/hosted-deployment.json`, `artifacts/hosted-live-verification.json` and
`artifacts/hosted-readiness.json`. The primary URL is required for API use; exact-origin checks
intentionally reject API calls from unique Netlify deploy URLs.

## Architecture

Netlify serves the existing frontend and `netlify/functions/workbench.mjs`. The function forwards
only known application paths to one persistent Node/Ganache backend on Railway. It has a fixed
HTTPS destination and a server-only proxy key. Browser requests never receive that key. All financial
decisions still use `src/workbench.mjs`, the trusted registry and unchanged v7 bytecode.

The backend runs explicit `hosted-demo` mode, checks its exact configured Host and proxy key,
requires the actual public HTTPS Origin for API writes, issues Secure/HttpOnly/SameSite cookies and
binds nonce signatures to the public domain. Only `/healthz` is publicly readable at the backend.
Ganache remains on loopback. API replies are never cached or replaced with fabricated successes.

The same-origin `/rpc` is a separate public, cookie-free wallet transport. It permits bounded chain
reads and cryptographically signed chain1337 transactions to the demo's trusted contracts. Unlocked
account sends, admin methods, foreign chains/contracts and oversized transactions are rejected.
RPC CORS does not authorize API mutations or forward session cookies.

Every hosted process mines a unique zero-value synthetic self-transfer. Browser signing verifies its
block hash, so a wallet configured for another chain1337 cannot silently send to a different instance.
The main UI and generated advanced financial pages apply that check. If a wallet already has chain1337
configured elsewhere, set its RPC URL to the published site's `/rpc`, then reconnect.

This remains a **shared synthetic demo**. Any visitor can intentionally choose a demo identity; browser
wallet nonce proof is separate. ETH has no value, Court rulings are mocks, data entry must be synthetic,
and chain/sessions/projections reset on process restart. Run exactly one long-lived backend replica;
do not enable sleeping or horizontal replicas. This is not production authentication or durable storage.

## Build and local checks

```sh
npm run build:hosted
npm run typecheck
npm run verify
npm run test:hosted
node scripts/prepare-hosted-backend.mjs
```

`test:hosted` uses a temporary local HTTPS certificate, real gateway and real backend. It checks Secure
browser sessions, actual deposits in A/B, isolated registration, API/RPC boundaries, advanced routes
and mobile layout. The hosted Node tests also execute a real random EOA's signed deposit through RPC.

`Dockerfile` installs only production dependencies, compiles/checks the original artifact and runs as
the non-root `node` user. `prepare-hosted-backend.mjs` creates a closed upload context under ignored
`.runtime/hosted-backend-context/`; it excludes user attachments, private runtime/env files, Git history
and original live configs. The exact HTML/template assets needed by advanced tools are included.
It defaults to the committed HEAD, or accepts a commit argument. The frontend builder also accepts an
optional commit argument, allowing source-bound packaging despite unrelated working-directory changes:

```sh
node scripts/prepare-hosted-backend.mjs 371b4c80b0c65ce7b7f571ca41d9f85c8720660b
node scripts/build-hosted-frontend.mjs 371b4c80b0c65ce7b7f571ca41d9f85c8720660b
```

## Deployment sequence

1. Sign in to the existing Railway account. Create one dedicated project/service for this demo, with
   no Git-provider connection. Existing unrelated projects and Netlify sites are not changed.
   Use the current pinned CLI (`npx --yes @railway/cli@5.71.0`). Website sign-in must finish the
   device-activation authorization; verify `whoami --json` succeeds before creating resources.
2. Generate the service's Railway domain with target port3000. Configure health `/healthz`, one replica,
   no sleeping and an ordinary failure restart policy. Keep existing billing; do not purchase upgrades.
3. Run the following with the exact returned project/service IDs and backend HTTPS origin:

   ```sh
   python3 scripts/configure-hosted-deployment.py \
     --backend-origin https://YOUR_BACKEND.up.railway.app \
     --project-id YOUR_PROJECT_ID --service-id YOUR_SERVICE_ID
   ```

   The helper generates/reuses a high-entropy key in an ignored0600 local file, passes Railway values
   through stdin and configures only this Netlify site's three runtime variables. It logs variable
   names only. The existing Netlify plan uses ordinary private site environment variables; paid
   granular-scope/secret-redaction features were not enabled. Only the server function consumes the
   key, and the published frontend was checked for zero occurrences of its value. Never copy a secret
   into client code, a command argument, a document or test output.
4. Recreate the closed backend context and deploy that directory with `railway up --path-as-root` and
   exact project/service/environment selectors. Wait for a healthy deployment; inspect bounded logs.
   Check direct health200 and protected routes403 without the key.
5. Build the frontend, then deploy the existing Netlify site with official CLI27.15.0:

   ```sh
   npm run build:hosted
   npx --yes netlify-cli@27.15.0 deploy --no-build --prod \
     --dir dist/netlify-app --functions netlify/functions \
     --site f6b82f41-9e30-49b0-a836-40fedbab93a4
   ```

6. Verify mode, instance identity, public RPC, Secure cookies, actual synthetic transactions and mobile
   UI against the published URL. `test/hosted-live.e2e.mjs` is reserved for an explicitly provisioned,
   untouched synthetic instance; it refuses other hosts/chains and consumed seed state. It sends
   financial operations once and must not be automatically rerun or reset after submission.
   Save public deployment IDs/results without credentials.

If a future replacement fails, restore read-only deploy `6ae2003e06e5123259e8297c` while fixing the
backend/gateway. This rollback removes interactive access; it does not migrate or preserve the
backend's ephemeral state. The original snapshot is available at its
[immutable URL](https://6ae2003e06e5123259e8297c--kleros-event-workbench-preview.netlify.app).

## Current status

The gateway bundles locally. Focused checks passed19 gateway tests,7 hosted server tests,4 wrong-instance
wallet tests and35 HTTPS integration browser assertions plus Playwright expectations. Root typecheck
passed. A clean production-dependency context also compiled with pinned artifact equality and served
guest/console/settings routes. The complete verification passed build/typecheck, **121 Node tests**
and **143 browser assertions** plus interaction/expectation checks across five suites. Its output is
`artifacts/hosted-full-verification.log`.

The actual Railway Linux/Node22 image installed production dependencies and compiled the unchanged v7
with exact pinned ABI/bytecode equality. Ganache's nested macOS-only fsevents lock entry needed its
missing `optional:true` flag; versions and financial sources were preserved. Health passed with one
replica in `asia-southeast1-eqsg3a`, sleeping disabled, restart-on-failure and `/healthz`.

The published Netlify application passed **370 live acceptance checks**, recording five actual
synthetic chain1337 transaction hashes. These include browser A/B deposits, owner A admission and
registration, unchanged B accounting, cross-event403, Secure/HttpOnly sessions, public-domain nonce
proof, an independent memory-only EOA's signed RPC deposit/canonical reconciliation, instance checks,
loaded assets and mobile bounds. No external requests, browser runtime errors, state reset, automatic
rebroadcast or persisted private keys occurred. This is not370 distinct workflows; repeated transport
and instance checks contribute to the count. A normal browser wallet extension was not used; full
arbitration/payout lifecycle evidence remains local.

Final readiness checks returned backend health200, unkeyed backend API403 and public bootstrap200,
with hosted-demo, chain1337 and the same instance as acceptance. The accepted seeded state is retained;
the live script should not be rerun against it. Users may explore the shared demo with synthetic data.

The hosting request is complete. Production work remains durable authentication/storage, dependency
remediation, content/RLS staging rehearsals, a fresh mainnet fork and an independently authorized
production rollout. No mainnet deployment, real Court interaction, real guest submission, original
production-system change, upstream push or billing upgrade was performed.
