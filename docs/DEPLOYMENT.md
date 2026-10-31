# Kickback production deployment

Deploy the latest `main` from this repository to the `kickback-kleros` Netlify
project in the team that manages `kleros.io`. Its canonical domain is
`https://kickback.kleros.io`; its Netlify address is
`https://kickback-kleros.netlify.app`. The frontend and
gateway use the existing production Railway backend, database and Reown project.
No contract deployment or database migration is part of this frontend deployment.

The checked-in domain redirects send both the current and previous Netlify
addresses to the canonical domain while retaining paths and query parameters.

## Import from Git

Use the repository root as the base directory. The checked-in `netlify.toml`
provides these settings:

| Setting | Value |
| --- | --- |
| Node.js | 22 |
| Build command | `npm run build:netlify:production` |
| Publish directory | `dist/netlify-app` |
| Functions directory | `netlify/functions` |

The build copies the production frontend and writes the same security headers as
the verified V10 release, including the approved WalletConnect/Reown connections
and wallet icons. It does not compile contracts, start a chain/backend, read
credentials, regenerate the SDK, or require Git metadata during the build.
Historical local/demo build commands remain available separately.

## Netlify environment variables

Set the following values in the project's environment settings for **Production**,
available to **Functions** (or all scopes). Build-only variables cannot configure
the gateway. [Netlify Functions environment documentation](https://docs.netlify.com/build/functions/environment-variables/).

| Variable | Value |
| --- | --- |
| `KLEROS_BACKEND_URL` | `https://luma-v10-mainnet-backend-production.up.railway.app` |
| `KLEROS_PUBLIC_ORIGIN` | `https://kickback.kleros.io` |
| `KLEROS_PROXY_SECRET` | Existing Railway `PROXY_SECRET`, supplied privately |

`netlify.env.example` contains placeholders only. Do not upload a full Railway
environment file: database/RPC credentials and any wallet material stay outside
Netlify and the repository. No new Reown environment variable is required; its
public project ID and approved connector are already part of the frontend.

## Coordinate domain activation

1. Attach `kickback.kleros.io` to the new project and arrange the DNS/TLS setup with
   the domain administrator. Share the new Netlify project URL before cutover.
2. Coordinate with the Railway operator to set that existing service's
   `PUBLIC_ORIGIN` to `https://kickback.kleros.io`. Its `BACKEND_ORIGIN`, database,
   persistent state and shared proxy secret remain on the existing service.
3. Verify the existing Reown project permits the final domain if its dashboard
   has domain restrictions. The frontend already permits `kickback.kleros.io`.
4. Activate the canonical domain and verify the public routes below. Fresh wallet
   actions use the canonical origin; preserved original receipts retain their
   original event and wallet bindings.

API requests on arbitrary deploy-preview URLs are intentionally rejected by the
exact-origin gateway, and those URLs are outside the connector's production
allowlist. Preview HTML can be inspected before activation; use the canonical
domain for functional checks and coordinate the origin switch before go-live.

## Read-only smoke checks

- `/first-event/`: Truth Pays, 4 November 2026, 18:00–22:00 India (IST), 0.01 ETH.
- `/#event=event-3aac5a07-5074-4241-9246-2798d4111039&view=organizer`: saved Manage Event.
- `/#event=event-b338a3d3-bbbf-4b4b-844c-5b098d515ea5&view=participant&deposit=manage`:
  previous-event recovery, retaining the original contract.
- `/api/first-event/depositors`: HTTP 200 with `displayOnly: true` and the current
  event ID. Historical receipt rows are not a wallet's current withdrawable credit.

These checks require no wallet signature or blockchain transaction. Connected
wallet tests and actual financial actions remain separate user-confirmed steps.

## Keep a verified release live

Netlify publishes a complete deploy atomically. A failed build leaves the
published deploy in place. The production build now rejects invalid JavaScript,
missing local modules and missing HTML/CSS assets before replacing its output.
The independent `production-frontend` CI job also exercises the static fallback.
These checks reduce broken releases; they do not prove that every runtime action
or upstream service is available.

For the launch, a Kleros-team administrator should use the project's
[deploy list](https://app.netlify.com/projects/kickback-kleros/deploys) to:

1. Confirm the canonical-domain smoke checks above, record the published deploy
   ID and commit, and **lock that published deploy**. A lock prevents automatic
   publishing while updates are built and tested.
2. Build the next candidate without publishing it. Require the frontend CI/build
   checks and inspect its static files. Production wallet/API requests on preview
   URLs must remain blocked by the existing origin restrictions; do not expand
   those restrictions to test a preview.
3. Publish the reviewed candidate, run the read-only checks on the canonical
   domain, and retain the previous verified deploy ID. Keep publishing locked
   between deliberate releases.
4. If a published update fails, select the previous verified deploy and use
   **Publish deploy** to roll back. Keep the lock so the next Git build does not
   immediately replace the restored release. Record the failure before retrying.

The homepage offers the static `/first-event/` page when its directory or a startup
module fails. That page renders the current event's address, amount and QR without
the database. Wallet actions still require their normal current checks. Recovery
routes keep their original event and never automatically become a new deposit.

A frontend rollback does not roll back Railway or PostgreSQL. Backend releases
must keep the previous frontend's API working, and receipt journals must remain
intact. A hosting outage needs separate recovery; no release strategy guarantees
continuous availability during every provider outage.

See Netlify's [deploy management](https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/)
for locking and restoring published deploys.
