# Kleros Kickback

Event deposits, organizer attendance review, participant challenges and recovery
using Ethereum smart contracts and Kleros.

The production frontend runs on Netlify. Its gateway uses the existing Railway
backend and PostgreSQL read model; wallet transactions are confirmed by the user.

## Deploy

Follow [the production deployment guide](docs/DEPLOYMENT.md). Netlify imports this
repository from its root and reads the checked-in `netlify.toml`:

- Node.js 22
- Build: `npm run build:netlify:production`
- Publish: `dist/netlify-app`
- Functions: `netlify/functions`

The frontend-only build uses the existing production assets and approved
WalletConnect/Reown headers. The existing backend, database and Reown project are
reused. Configure the three gateway environment variables described in the guide;
`netlify.env.example` contains placeholders only.

## Local verification

```sh
npm ci --ignore-scripts
npm run build:netlify:production
npm run typecheck
node --test test/v10-netlify-build.test.mjs test/walletconnect-csp.test.mjs test/first-event-static-target.test.mjs
```

[Testing notes](docs/TESTING.md) describe the focused checks and existing local
compatibility suite. Historical v7/v8 demos and versioned contract builds remain
available through the existing package scripts.

## Source layout

| Directory | Purpose |
| --- | --- |
| `public/` | Frontend and licensed, vendored wallet connector |
| `src/` | Application, gateway and versioned contract runtime |
| `netlify/functions/` | Netlify gateway entry point |
| `contracts/`, `references/kickback/` | Contract source, historical compatibility and ABI inputs |
| `registry/`, `verification/` | Public deployment and provenance inputs |
| `scripts/`, `tools/`, `test/` | Build, verification and developer tooling |
| `artifacts/` | Required public verification/test fixtures |
| `docs/contracts/` | Versioned policy and template snapshots |

Keep service credentials, signing material and local runtime state outside Git.
The public Reown project ID, contract addresses and transaction hashes are public
identifiers. See [configuration and security](SECURITY.md).
