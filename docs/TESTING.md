# Local verification

Use Node.js 22 and install the locked dependencies with `npm ci --ignore-scripts`.

## Production frontend packaging

```sh
npm run build:netlify:production
npm run typecheck
node --test test/v10-netlify-build.test.mjs test/walletconnect-csp.test.mjs test/first-event-static-target.test.mjs
```

The build tests run the configured command in a clean source fixture without Git
metadata, dependencies, compiled contracts or runtime files, with network access
denied. They compare every public asset and the approved V10 headers, check safe
failure on missing inputs, and preserve the generic hosted builder. Local Chromium
checks wallet icons and security-policy boundaries. Static event/QR checks retain
the current event and separate original-event recovery identity.

## Runtime and historical compatibility

The versioned Solidity, ABI, policy, template, registry and verification inputs
remain in source. Existing `npm run verify` and `npm run test:contracts` run the
broader local compatibility checks, compiling contracts where required. Individual
`test/*.test.mjs` files can be run after their required compilation inputs exist.

Only twelve public JSON inputs remain under `artifacts/`: four runtime wallet
verification proofs and eight event/rehearsal fixtures used by existing tests.
Their paths and bytes are retained. Generated run outputs and operator notes are
excluded. The retired Booth/Events reference applications and their three
Booth-only boundary checks are outside the Kickback source.

Use synthetic fixtures/local chains for tests. A frontend build does not exercise
live hosting configuration, final-domain cutover or actual wallet transactions.
