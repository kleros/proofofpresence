# Historical Netlify viewing preview

The primary URL now serves the [full interactive demo](HOSTED_DEPLOYMENT.md). This document records
its earlier read-only deployment, retained as an immutable rollback artifact at
[6ae2003e06e5123259e8297c--kleros-event-workbench-preview.netlify.app](https://6ae2003e06e5123259e8297c--kleros-event-workbench-preview.netlify.app).
The statements below describe that historical deployment.

The Netlify target is an explicitly **read-only preview** of the integrated interface. It publishes
synthetic projections captured from actual local v7 execution, not a live financial application.
The full application still runs with `npm run demo` as described in the root README.

## Why the deployment has this boundary

The current workbench keeps Ganache, sessions, event projections, import reviews and action locks in
one Node process. Netlify Functions use ephemeral runtimes; putting that process behind a function
would reset or split authoritative state across invocations. See Netlify's
[runtime documentation](https://docs.netlify.com/build/functions/overview/).
A full interactive hosted version needs a persistent backend plus explicit HTTPS origin/Host and
wallet-RPC adapters. That is separate from this static viewing deployment.

The preview visibly labels its captured data and disables data entry, wallet connection, financial
actions, imports, check-in, mock rulings, time controls and advanced financial links. Switching a
demo identity changes only the view in that browser. It creates no authenticated server session.
API reads come from the saved projections; writes are refused locally. No hosted API or chain exists.
Captured roles and contacts are synthetic and intentionally viewable; they are not an access-control demo.

## Reproduce

```sh
npm ci --ignore-scripts
npm run build:netlify
npm run test:netlify
```

The build compiles/checks the unchanged v7 artifact, starts a fresh loopback chain, verifies each
successful receipt and captures two events for each demo identity. Event A has paid ordinary attendees
while Bob's matched case retains a 0.01 ETH share. Event B remains Open independently with approved,
free and admission-pending examples. The build closes its chain before exiting.

Only `dist/netlify-preview/` is published: public UI/assets/licenses, captured synthetic JSON, the
read-only adapter and security headers. Backend source, reference configs, credentials, runtime
files, user handoff attachments and local dependencies are not uploaded. `netlify.preview.toml` records
the read-only command and publish directory. The primary `netlify.toml` now prepares the requested
interactive gateway target; see [HOSTED_DEPLOYMENT](HOSTED_DEPLOYMENT.md). No Git provider connection
or upstream push is needed.

The deployment helper uses an existing official Netlify CLI login or `NETLIFY_AUTH_TOKEN` in memory:

```sh
python3 scripts/deploy-netlify-preview.py --team YOUR_NETLIFY_TEAM
```

It creates one specifically named preview site or reuses its exact local site binding. It never changes
an unrelated site, DNS, billing or financial deployment. `.netlify/state.json` stays ignored. Public
site/deploy IDs and source provenance are saved to `artifacts/netlify-deployment.json`. Poll the returned
deploy until ready, verify its HTTPS URL and rerun the preview browser checks against that URL.

## Verification record

The assembled preview passed build and **34 browser assertions** plus Playwright expectations.
These include all event/view/role combinations, disabled inputs and financial controls, direct draft/RPC
write refusals, zero wallet requests, zero API/RPC/external network calls, separate browser identities,
mobile layout, compact mobile navigation and loaded assets. Visual inspection caught and corrected
the preview banner's initial mobile header height; the regression is now covered. Root typecheck also
passed. The existing core source was unchanged.
This record supplements the completed core results in [TEST_REPORT](TEST_REPORT.md); it does not replace them.

## Published deployment

- Immutable URL: [read-only deployment](https://6ae2003e06e5123259e8297c--kleros-event-workbench-preview.netlify.app).
- The primary URL has since been replaced by the interactive demo.
- Source: `8e1c59e1058e844e18fe15d66c29e62131a492b5`, branch `codex/core-application`.
- Site ID: `f6b82f41-9e30-49b0-a836-40fedbab93a4`.
- Deploy ID: `6ae2003e06e5123259e8297c`; observed state `ready`.
- Published: 28 October 2026,14:01:35UTC. Snapshot capture:14:00:57UTC.
- Artifact:152601-byte ZIP;20 static files, including100799-byte captured JSON.
- The HTTPS page returned200, served the preview entry point, CSP and `nosniff`. Hosted captured JSON
  matched the local file byte-for-byte.
- `NETLIFY_PREVIEW_URL=https://kleros-event-workbench-preview.netlify.app npm run test:netlify`
  passed **34 assertions** plus Playwright expectations, including all read-only/network/wallet guards.

Public metadata is in [`artifacts/netlify-deployment.json`](../artifacts/netlify-deployment.json).
Build, local browser and live browser outputs are preserved beside it. Only this new dedicated preview
site was created; no existing site, DNS, billing, upstream Git repository or financial deployment changed.
