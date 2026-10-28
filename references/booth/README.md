# Kleros booth check-in · Devcon VIII Mumbai

Visitors scan the booth QR, check in on their phone, confirm their Kleros blog subscription, and get a personalised "Picked for you" screen with their merch tier. More steps unlock better merch: Teal for checking in, Purple for joining the Kleros Telegram and following Kleros on X and LinkedIn, Gold for also getting the Kleros 101 quiz right. Staff hand over merch by the colour on the screen. Every check-in lands in a Google Sheet, matched to a Kleros use case with a priority and a suggested next step.

- **Site:** static HTML/JS in `site/`, no build step. Goes live at **https://devcon.kleros.io** (same URL every Devcon; the printed QR codes point there).
- **Backend:** Google Apps Script web app in `apps-script/`, writing to a Google Sheet in the weiwei@kleros.io Drive.
- **Preview:** https://kleros-devcon.pages.dev (temporary copy on Wei Wei's Cloudflare account, for review only).

## Start here (devs)

Short version: [`docs/DEPLOY.md`](docs/DEPLOY.md). `bash scripts/package.sh` builds `dist/kleros-devcon-deploy.zip` (site folder for Netlify, the backend as one file, the deploy guide) for handing over without the repo.

1. **Deploy the site** on Kleros's Netlify, like ai.kleros.io. `netlify.toml` publishes `site/` as is; connect this repo, or drag `site/` into *Deploy manually*.
2. **Domain:** add `devcon.kleros.io` to the Netlify site, and a CNAME `devcon` → `<site-name>.netlify.app` in Cloudflare (kleros.io's DNS lives there).
3. **Blog gate webhooks:** run `ghostWebhookSetup`, then a Ghost admin adds two webhooks pointing at the URL it logs (see [Blog confirmation gate](#blog-confirmation-gate)). No Ghost API key is needed. **Until then nobody can finish checking in.**
4. **Telegram bot:** add the @KlerosDevconBot token and run `telegramSetup` (see [Merch tiers and the Telegram bot](#merch-tiers-and-the-telegram-bot)). **Until then nobody can reach Purple or Gold.**

## Repo layout

| Path | What it is |
|---|---|
| `site/index.html` | Visitor page: merch tier ladder and form → "Confirm your email" → final screen (tier ticket, level-up steps, Kleros 101, "Picked for you") |
| `site/connect.html` | "Connect with the Kleros team": the hot-lead form (button at the bottom of the check-in page and of the ticket), saved to the *Hot leads* tab |
| `site/admin.html` | Team dashboard: stats, lead list, optional merch desk, CSV export (`/admin`, needs the dashboard key) |
| `site/matching.js` | Use-case matching rules, shared by the page, the dashboard and the backend |
| `site/config.js` | Backend URL, edition/city, privacy contact, blog URL, merch tiers, Telegram bot and follow links, Community Hubs card |
| `site/quiz.js` | The three Kleros 101 questions, with why each answer is right or wrong |
| `site/assets/merch/` | Merch thumbnails for the tiers (from the Web3Merch mock-ups) |
| `site/_headers`, `site/robots.txt` | No-cache for `config.js`/`matching.js`/`quiz.js`, dashboard kept out of search engines |
| `apps-script/Code.gs` | Backend: check-ins, Sheet tabs and views, research-agent API, blog gate, merch tiers, Telegram bot |
| `apps-script/Matching.gs` | Copy of `site/matching.js` for the backend (kept in sync by the bundle script) |
| `scripts/apps-script-bundle.sh` | Prints the backend as the single file that lives in the Apps Script editor |
| `scripts/package.sh` | Builds `dist/kleros-devcon-deploy.zip`: Netlify-ready site, backend file, deploy guide |
| `docs/DEPLOY.md` | Step-by-step deploy: Netlify, domain, backend, keys |
| `qr/` | Booth QR generator (`make_qr.py`) and the print-ready codes |
| `docs/RESEARCH_AGENT.md` | Playbook for the agents that research leads |
| `docs/telegram-bot-avatar.png` | @KlerosDevconBot's profile picture (the gold Kleros Juror seal from the tattoo sheet) |

Run locally: `python3 -m http.server -d site 8000`. Note `config.js` points at the **live** backend; set `endpoint: ''` for demo mode (check-ins stay on the device, no emails sent).

## How a check-in works

1. **Form.** Name, company, role, job level, **email** (required), optional Telegram/LinkedIn/X, interests (four focus cards, "Others" with free text, extra chips), optional free text, and an optional "Subscribe me to the Kleros blog" box. (No "Book a call": people who want a follow-up use the Connect page, below.)
2. **Saved.** The check-in is queued on the phone and posted to the backend; it leaves the queue only when the backend confirms the save (retries are safe, the backend dedupes on a client id). `keepalive` lets it finish if the visitor closes the page.
3. **Blog sign-up (only if they ticked the box).** The page asks Ghost (blog.kleros.io) to send its own "Complete your sign up" email. Ghost only creates the subscriber once they tap *Confirm signup*. Visitors who leave the box unticked skip steps 3–4 and go straight to the final screen.
4. **Confirm your email.** The page polls the backend every 4 s (immediately when the visitor returns from their mail app). Ghost's webhook marks **Newsletter = Confirmed** in the Sheet (*Yes* = ticked, not confirmed yet; *No* = box left unticked). With the wait off, the screen still stays up 15 s before moving on.
5. **Final screen.** Only then: a ticket in their tier's colour (reward, name, code and a ticking clock, so a screenshot is easy to spot), the level-up steps, Kleros 101, then "Picked for you": their best-fit Kleros area (with why, and their own words quoted back), another area they picked, a tip for their role, the other headline areas, the Community Hubs card and links. All links go to docs.kleros.io, ai.kleros.io or the Kleros Telegram (Booth Guidelines: no token pages).
6. **Level up.** Join the Kleros Telegram (checked by @KlerosDevconBot), tap Follow on X and LinkedIn (counted on tap) → Purple. Plus all three Kleros 101 questions right → Gold. A wrong answer is crossed out with the reason, and they pick again.
7. **One check-in per person.** Reopening the page on the same phone shows the same screen, tier and progress. A second check-in with an email (or Telegram account) that already reached the final screen shows **Already claimed** instead of a tier. "Check in someone else" only exists on a staff tablet opened with `?kiosk=1` (Teal only: the tablet resets after a few seconds).

Staff just look at the colour; nothing to scan. The dashboard's merch desk is optional; it re-checks the confirmation with Ghost and refuses "Already claimed" check-ins.

## Backend (Apps Script)

Live project: **Kleros Devcon 2026 · Booth Leads Backend** (standalone, owned by weiwei@kleros.io), deployed as a web app (*Execute as: Me*, *Access: Anyone*). Its `/exec` URL is in `site/config.js`. The Sheet is **Kleros Devcon 2026 · Booth Leads Database**, in Drive › Devcon 2026 -Master Reference › Kleros Booth Check-in · Devcon 2026.

| Request | What it does |
|---|---|
| `POST {check-in}` | Saves a check-in (no key; malformed requests are rejected) |
| `POST {action:'verify', id[, steps, tg]}` | Polled by the page: blog subscription confirmed? Then the merch tier, Telegram state and "Already claimed". Also records the page's steps (`{x, linkedin, quiz, wrong}`); `tg: true` makes it read the bot's new messages |
| `POST {action:'enrich', key, ticket, agent, fields}` | Research agents write the Background research columns, logged in *Agent log* |
| `GET ?key=K` | All leads (dashboard) |
| `GET ?key=K&action=merch&id=ID&value=true` | Record merch given (only for confirmed subscribers) |
| `GET ?key=K&action=queue[&limit=N]` | Leads waiting for research |

Guards use `require_(condition, error)`; `respond_` turns a failed one into `{ ok: false, error }`.

**Script properties:** `ADMIN_KEY` (dashboard/agent key; Sheet menu *Kleros › Show dashboard / agent key*), `SHEET_ID`, `GHOST_WEBHOOK_SECRET` (made by `ghostWebhookSetup`), `TELEGRAM_BOT_TOKEN`, optional `TELEGRAM_GROUP` (default `@kleros`) and `SITE_URL` (default `https://devcon.kleros.io`). `TELEGRAM_OFFSET` is managed by the code.

**Changing the backend:** edit `apps-script/Code.gs` (and `site/matching.js` for matching), then

```bash
bash scripts/apps-script-bundle.sh | pbcopy
```

paste over everything in the editor, save, then *Deploy › Manage deployments › ✏️ › Version: New version › Deploy* (same URL). Menu actions use the saved code straight away; the web app only changes on a new version. Current live version: **18** (blog gate via Ghost webhooks with an on/off switch and a webhook call log; merch tier columns already added with `addMerchTierColumns`).

**From scratch:** create a standalone project at script.google.com while signed in as the Kleros account, paste the bundle, set `FOLDER_ID` in `Code.gs`, run `setup` (it creates and names the Sheet in that folder), approve permissions, deploy as a web app as above, and put the `/exec` URL in `site/config.js`.

### Blog confirmation gate

The page signs visitors up through Ghost's public members API, and Ghost emails them a link. Ghost creates a member only after they tap it, so "Ghost added this member" means "confirmed". Ghost tells the backend through webhooks; the backend holds no Ghost key and never calls Ghost.

1. Apps Script editor: run `ghostWebhookSetup`. It saves `GHOST_WEBHOOK_SECRET` and logs the target URL (the web app URL plus `?hook=ghost&secret=…`). Send that URL to the Ghost admin privately: it contains the secret.
2. Ghost admin › Settings › Integrations › **Add custom integration** ("Devcon booth") › **Add webhook**, twice, both with that target URL:
   - `Member added`: a new subscriber tapped *Confirm signup*.
   - `Member edited`: an existing subscriber gets a sign-in email instead; opening the blog from it updates their "last seen", which Ghost reports as an edit (at most once a day per member).
3. Check in on a phone with a fresh email, tap the link in the blog email, and the final screen appears within seconds.

Why a secret in the URL: Apps Script can't read Ghost's `X-Ghost-Signature` header. The backend keeps an email only when it matches a check-in (as *Newsletter = Confirmed*); any other member's email sits in the script cache for 6 hours and is never stored. Ghost may show the deliveries as failed, because Apps Script answers POSTs with a redirect; the backend still gets them. **Not confirming?** Run `ghostWebhookStatus` in the editor: it logs the last 10 webhook calls (parameter names and lengths, no secrets or emails). `params: ["hook"]` with `givenLength: 0` means the Target URL in Ghost lost its `&secret=…` part.

**Switch (live setting: OFF for Devcon, decided 27 Oct: the blog box is optional, so the booth never waits).** Run `blogGateOff` in the editor and the booth stops waiting: visitors reach the final screen and merch right after checking in, and the blog card asks them to tap the link in Ghost's email. Only this site's waiting step changes. Ghost still emails them and subscribes them only once they tap the link (Kleros's double opt-in is untouched), and a webhook confirmation still sets *Newsletter* to `Confirmed`. `blogGateOn` restores the wait. `ghostWebhookStatus` shows which way it is set.

Strict on purpose: until `ghostWebhookSetup` has run, visitors wait on "Confirm your email" and see "Confirmation check is offline. Please ask the Kleros team." Nobody is waved through. An existing subscriber who already opened the blog that day gets no new event; set their row's *Newsletter* to `Confirmed` in the Sheet to let them through.

### Connect with the Kleros team (hot leads)

A quiet button at the bottom of the check-in page and of the ticket opens `connect.html` (also at `/connect`). It is for people who want a real follow-up, not merch: name, company, email, what they want to talk about (using Kleros in their product, a pilot, partnership, speaking/research/media, other), what they are building, timing, how to reach them, and who they talked to at the booth. It is pre-filled when they checked in on the same phone, and offline-safe like the check-in.

The backend (`POST {action:'connect', rid, …}`) adds one row to the **Hot leads** tab (deduped on `rid`), with empty *Follow-up owner*, *Status* (starts as New) and *Team notes* for the team. If the same email checked in, that Leads row gets *Wants call = Yes* and fresh matching, so it shows as Hot everywhere and the Dashboard counts it.

### Merch tiers and the Telegram bot

| Tier | Needs | Checked how | Merch (stock) |
|---|---|---|---|
| Everyone | nothing | | Stickers, metallic tattoos (50 A5 sheets) |
| Teal | Check-in (if they ticked the blog box while the wait is on: a confirmed email) | Ghost webhooks (above) | Flip-flops (200) |
| Purple | + joined the Kleros Telegram group, tapped Follow on X and on LinkedIn | Telegram: @KlerosDevconBot. X and LinkedIn: counted on tap (checking needs paid APIs) | Copper bottle (100) or gamcha (100) |
| Gold | + all three Kleros 101 questions right | On the page (a wrong pick explains why; they pick again until right) | Kurta (100) |

One item per person, from their tier. PoH charms (50) and PoH tees (50) are left out for now; the 28 named kurtas are the team's. Rewards and pictures live in `site/config.js` (`merch`), the questions in `site/quiz.js`.

Purple and Gold are easy to reach (the quiz can't be failed), so most visitors will aim for them. Split the stock per day (about 25 kurtas and 50 Purple items a day over the four days) and give the tier below when today's runs out.

**Telegram check.** The page links to `t.me/KlerosDevconBot?start=<client id>`. The visitor taps Start; the backend reads the bot's messages (`getUpdates`) whenever a waiting page polls and every minute from a trigger, asks Telegram whether that account is in the group (`getChatMember`), saves the result and replies in the chat (with a "Join the Kleros group" button if they aren't in yet). One Telegram account unlocks one check-in.

Setup, once:

1. **Token.** In Telegram, @BotFather › `/mybots` › KlerosDevconBot › *API Token*. Apps Script › Project settings › Script properties: `TELEGRAM_BOT_TOKEN` = the token. Never paste it anywhere else.
2. **Group.** The bot is already in t.me/kleros as a member (added 26 Oct 2026). Telegram only guarantees member lookups to admins.
3. Run `telegramSetup` in the editor: it checks the token, tests a member lookup, and installs the every-minute trigger. If it logs "Member lookups: NOT working", a group admin who can add admins makes @KlerosDevconBot an administrator with no permissions. As an admin the bot also receives the group's messages; the backend skips them and stores nothing. After Devcon, run `telegramStop`.

Bot profile (name, description, picture `docs/telegram-bot-avatar.png`) is set in @BotFather.

**Already claimed.** The first check-in of an email to reach the final screen gets the merch (Sheet: *Claim = Claimed*). A later check-in with the same email, from another phone or browser, gets *Already claimed* and no tier; so does a check-in whose Telegram account already unlocked another one. Reopening the page on the same phone is the same check-in, so a visitor who confirms now and comes back for merch later keeps their tier.

## The Sheet

`setup` builds: **Read me**, **Leads** (one row per person, 7 colour-coded column groups, pre-sized for 10,000 rows; the last group, *Merch tier*, holds tier, claim, Telegram check and steps), **Priority queue**, **By pipeline**, **By level**, **Flags**, **Research queue**, **Dashboard**, **Agent log**. The stacked views show each section's best 100 with a full count. A **Kleros** menu re-runs matching, rebuilds views, shows the key, and loads or deletes the three fictional `EX-` example rows (delete them before Devcon).

Visitor text is written as plain text (anything starting with `=`, `+`, `-`, `@` can't run as a formula; the CSV export is protected the same way). Times are in Asia/Kolkata. The same email checking in twice is flagged **Returning visitor**.

## Matching

`site/matching.js`: 11 Kleros tracks with keywords, products and owners. `focus: true` marks this year's pipelines (AI agents, prediction markets, enterprise, DeFi curation): big cards on the form, dashboard tiles, and the only tracks that can be **Hot**. Level comes from job level (counted double) plus role: Decision-maker / Influencer / Practitioner / Community. Interest labels match regardless of case. Avoid everyday words as keywords ("chain" matches "blockchain").

After changing it: redeploy the site and the backend, then Sheet menu *Kleros › Re-run use-case matching*.

## What updates by itself

| Change | Shows up how |
|---|---|
| Check-ins, Sheet edits, team notes, research | Instantly; the dashboard re-reads every minute |
| `site/` | On the next Netlify deploy (a push, once the repo is connected) |
| `apps-script/` | Only after pasting the bundle and deploying a new version |

## New Devcon year

1. `site/config.js`: `edition`, `city`, `event`, Community Hubs.
2. `site/matching.js`: move `focus: true` to that year's pipelines; adjust keywords.
3. A fresh Sheet (new Apps Script project, "From scratch") or keep one and filter on **Event**.
4. Redeploy. The QR codes stay the same.

## Booth QR codes

`python3 qr/make_qr.py` regenerates the booth poster (6×8 in, plus an A4 PNG and print-ready PDF), square sticker and plain PNG/SVG for https://devcon.kleros.io, and checks each one scans (OpenCV and ZXing; needs `qrcode[pil]`, `opencv-python-headless`, `zxing-cpp`). Keep the finder-eye corners small (`EYE_R`) so every scanner finds the code.

## Privacy

The page carries its own privacy notice (controller: Cooperative Kleros; purposes include public-profile research; deletion on request). The blog box is never pre-ticked.
