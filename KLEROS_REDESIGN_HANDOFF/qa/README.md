# Prototype verification

These checks exercise the design artifact, not the production apps or their smart contracts. They use only synthetic data.

## Run the DOM checks

Use a current Node version supported by the pinned dependencies. From this directory:

```sh
npm install
npm test
```

`dom-check.mjs` tests event isolation, import/provenance gates, role boundaries, deposit/admission distinctions, unmatched and matched cases, ruling-0 copy, owed claims and dialog behavior in jsdom. This does not measure layout, actual browser focus or accessibility conformance.

The optional `--snapshots /absolute/output/directory` argument writes initialized HTML state snapshots for document rendering. Those are not browser screenshots.

## Run the pending browser checks in Codex

```sh
npx playwright install chromium
npm run test:browser
```

`browser-check.mjs` serves only the prototype and options page through an ephemeral localhost server. It blocks external requests and checks the 1440x900 and 400x800 viewports. Screenshots and results are written to `browser-results/`.

This script was prepared but **not executed** during the design-preparation session: its cloud browser security policy rejected local `file://` access, and no alternate browser route was used. Run and fix this script in the authorized Codex development environment before claiming browser validation. A failing check is a task to resolve, not a reason to replace its expected behavior with success.

After implementation, adapt these scenarios to the real components and local chain/database fixtures. Verify actual accessible names, keyboard order, modal focus, 200% text zoom, reflow, permission enforcement, transaction simulations, contract versions and asynchronous error states. The design prototype is not a security or contract test suite.

## Recorded preparation results

See `dom-results.json` for the exact executed DOM checks and `../QA_REPORT.md` for contrast, static-render and remaining verification boundaries. Do not relabel them as browser or production results.
