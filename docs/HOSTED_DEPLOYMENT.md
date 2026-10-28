# Interactive hosted demo

The user selected the full interactive online demo. The read-only
[Netlify preview](https://kleros-event-workbench-preview.netlify.app) stays published until the
interactive backend is healthy and the replacement frontend passes live checks.

## Prepared architecture

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

## Deployment sequence

1. Sign in to the existing Railway account. Create one dedicated project/service for this demo, with
   no Git-provider connection. Existing unrelated projects and Netlify sites are not changed.
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
   names only. Never copy a secret into client code, a command argument, a document or test output.
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
   UI against the published URL. `test/hosted-live.e2e.mjs` is reserved for that explicit live demo check;
   it refuses other hosts/chains. Save public deployment IDs/results without credentials.

If replacement checks fail, restore the known working read-only deploy
`6ae2003e06e5123259e8297c` while fixing the backend/gateway. Do not claim the full application is online
until live transaction/session checks pass.

## Current status

Implemented checkpoint: `25c4797ea3475bb8e0a58c529ead0b62b8a6802d`, branch `codex/core-application`.

The gateway bundles locally. Focused checks passed19 gateway tests,7 hosted server tests,4 wrong-instance
wallet tests and35 HTTPS integration browser assertions plus Playwright expectations. Root typecheck
passed. A clean production-dependency context also compiled with pinned artifact equality and served
guest/console/settings routes. The complete verification passed build/typecheck, **121 Node tests**
and **143 browser assertions** plus interaction/expectation checks across five suites. Its output is
`artifacts/hosted-full-verification.log`. Local Docker's engine was unavailable, so actual Linux image execution
must be verified during Railway build/deployment. The current Railway login expired; a fresh browserless
sign-in is pending. No interactive backend has yet been deployed, and the public link remains read-only.
