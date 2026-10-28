# Deploying the Kleros Devcon check-in

Two parts: the **site** (static files, goes on Netlify) and the **backend** (Google Apps Script, already live). The site works as soon as it's up: `site/config.js` already points at the live backend.

## 1. Site on Netlify

Pick one:

- **From GitHub (recommended, redeploys on every push).** Netlify › *Add new site* › *Import an existing project* › GitHub › `weiwei-ooi/kleros-devcon-checkin`. Leave the build command empty; the publish directory is `site` (set by `netlify.toml`).
- **Drag and drop.** Netlify › *Add new site* › *Deploy manually*, then drop the `site` folder from this package. To update later: the site's *Deploys* tab › drop the folder again.

Then the domain:

1. Netlify › the site › *Domain management* › *Add a domain* › `devcon.kleros.io`.
2. Cloudflare (kleros.io's DNS) › DNS › add `CNAME devcon → <site-name>.netlify.app`, **DNS only** (grey cloud), so Netlify can issue the HTTPS certificate.
3. Back in Netlify, wait for the certificate (a few minutes), then open https://devcon.kleros.io.

The printed booth QR codes point to devcon.kleros.io, so this must be live before Devcon (3 Nov). The team dashboard is at https://devcon.kleros.io/admin.html (needs the dashboard key).

## 2. Backend (Google Apps Script)

Already deployed (web app version 18), owned by weiwei@kleros.io. Nothing to do unless the code changes. To change it: paste `backend/Code.gs` from this package (or `bash scripts/apps-script-bundle.sh | pbcopy` from the repo) over everything in the editor, save, then *Deploy › Manage deployments › ✏️ › New version › Deploy*. The URL stays the same.

## 3. Keys (Apps Script › Project settings › Script properties)

| Property | What | Then run |
|---|---|---|
| `GHOST_WEBHOOK_SECRET` | Made by the code: run `ghostWebhookSetup`, which logs the webhook target URL | Ghost admin › Settings › Integrations › custom integration "Devcon booth" › add webhooks *Member added* and *Member edited*, both with that URL |
| `TELEGRAM_BOT_TOKEN` | @KlerosDevconBot's token from @BotFather | `telegramSetup` |

No Ghost API key is needed: Ghost calls the backend, never the other way round. The booth doesn't wait for the email confirmation and stays that way for Devcon (`blogGateOff`; the blog box is optional); Ghost's own double opt-in is unchanged either way. The webhooks then only mark *Newsletter* `Confirmed` in the sheet, so the booth works without them. If the wait is ever turned back on (`blogGateOn`), visitors who tick the box need the webhooks to get past "Confirm your email". Without the bot token nobody reaches Purple or Gold. The webhook URL and the token are secrets: share them only in private messages.

## 4. Check

On a phone: open the site, check in with a real email, confirm the Kleros blog email, and see the final screen. The row appears in the Sheet (*Kleros Devcon 2026 · Booth Leads Database › Leads*).

More detail: `README.md`.
