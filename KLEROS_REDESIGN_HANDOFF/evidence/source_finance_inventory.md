# Kickback and booth — source visual inventory

## Evidence boundary

**OBSERVED (SOURCE):** This inventory reads the previously fetched source snapshots of `weiwei-ooi/devcon-side-event-kickback` at `57fc1c8233c60e31c1b5988c631ef57d7c3f1b81` and `weiwei-ooi/kleros-devcon-checkin` at `169220bb41787b8aabdec5190ab85379328f143f`. Booth SVG assets were also fetched directly at that pinned commit. No browser rendering, wallet connection, on-chain check, test execution, backend submission or production mutation was performed for this inventory. “Observed” means present in source, not verified in the deployed UI. Color values are implementation tokens, not independently verified official brand guidelines. **ESTIMATE** labels below denote proposed design interpretation.

## 1. URLs and routes

| Surface | OBSERVED (SOURCE) URL / route | Qualification |
|---|---|---|
| Kickback guest deposit | https://weiwei-ooi.github.io/devcon-side-event-kickback/ | README declares GitHub Pages hosting from `gh-pages`; deployed bytes not compared with pinned `main`. [K1] |
| Kickback guest status / disputes | https://weiwei-ooi.github.io/devcon-side-event-kickback/#status | Same HTML file; hash toggles deposit-only/status-only sections. [K2] |
| Event registration | https://luma.com/qewnqhas | Existing event-specific Luma destination in guest template/config. [K2] |
| Owner console | http://localhost:8787 | Local server started by `npm run console`; no public console URL established. [K1] |
| Kleros case | `https://court.kleros.io/cases/<arbitratorDisputeID>` | Existing Court V1 case deep link; resolver-local ID is a different value. [K1, K2] |
| Booth visitor | https://devcon.kleros.io | README's intended production/custom domain; availability not checked here. [B1] |
| Booth review preview | https://kleros-devcon.pages.dev | README labels temporary review copy, not a separate product. [B1] |
| Booth staff | `/admin` / `site/admin.html` | README declares `/admin`; dashboard-key access in source. [B1, B3] |
| Booth follow-up | `/connect` / `site/connect.html` | README declares dedicated follow-up form; visitor page links `connect.html`. That file's visual styles were not inspected here. [B1, B2] |

## 2. Kickback guest page

### Exact tokens and geometry — OBSERVED (SOURCE)

Source: `site/index.html`, lines 11–130. [K2]

| Role / CSS token | Light default | Dark scheme / `data-theme="dark"` |
|---|---|---|
| Background `--bg` | `#f3f5f9` | `#0e1320` |
| Surface `--surface` | `#ffffff` | `#161d2e` |
| Text `--ink` | `#141b2b` | `#e8ecf5` |
| Muted `--muted` | `#5a6478` | `#9aa5bb` |
| Border `--line` | `#d9dfea` | `#29324a` |
| Action `--accent` | `#1f5fd6` | `#6c9cff` |
| On-action `--accent-ink` | `#ffffff` | `#0b1020` |
| Action surface `--accent-soft` | `#e4ecfb` | `#1c2948` |
| Warning / soft | `#9a5b00` / `#fff3dc` | `#f2b65a` / `#34270f` |
| Error / soft | `#b3261e` / `#fde7e5` | `#ff8a80` / `#3a1a1a` |
| Success / soft | `#1b7a46` / `#e2f4ea` | `#6fd39b` / `#13301f` |

- **Fonts:** Google Fonts imports Bricolage Grotesque 500/700 for display, IBM Plex Sans 400/500/600 for body, IBM Plex Mono 400/500 for wallet addresses and data. Body `15px/1.55`; H1 `clamp(1.7rem, 5vw, 2.3rem)`, line-height `1.1`, weight 700; H2 `1.12rem`.
- **Layout:** centered single column, maximum 600 px, 18 px grid gap; body horizontal safe-area-aware minimum 16 px padding, vertical 28/48 px. Cards radius 12 px/padding 18 px. Steps use 30 px numbered circles and 34 px first grid column. Network warning radius 10 px. Inputs/buttons radius 8 px. Pills radius 999 px.
- **Controls:** primary filled blue; ghost outlined/transparent; disabled opacity `.45`; locked steps `.6`. Focus outline 3 px accent plus 2 px offset. Hover brightness transition only when reduced motion is not requested.
- **Assets:** no image logo, hero photograph, favicon or SVG asset reference found in the guest HTML. The event title and partners are text. Do not describe a currently visible Kleros logo on this source page. Theme CSS exists, but no user-facing theme switch was found.

### Page composition — OBSERVED (SOURCE)

Source: `site/index.html`, lines 133–263. [K2]

1. Text header: “Committed Spot deposit · Devcon Mumbai side event”; “Truth Pays: Queryable Data, Prediction Markets & Onchain Justice”; date/time, venue and “Kleros · Arkiv · Web3 Mumbai”. Event-specific, not catalog-driven.
2. Deposit-only amber “Ethereum mainnet only” and “ETH only” warning.
3. Shared “Deposit contract” card: preview/open-soon notice, full address, **Copy**, **View on Etherscan**, live checks and confirmed-spot/pool statistics.
4. Five numbered deposit steps: **Connect your wallet** → **Switch to Ethereum mainnet** → **Check your balance** → **Send exactly [amount]** → **Back to Luma to finish registering**. The HTML comment says four, but the markup has five.
5. Hash navigation to status, with wallet lookup, challenge/evidence/reward/claim actions, open challenges and payout action.
6. Status-only “Missed at check-in? Challenge it on Kleros” explanation.
7. Footer explaining custody/attendance/deadline/refund behavior. Some broad footer labels need more precise new copy; see section 5.

### Financial labels and state inventory — OBSERVED (SOURCE)

Source: guest `renderChecks`, `verdict`, `refresh`, `lookup`, appeal and claim handlers. [K2]

| Context | Existing exact control labels or state wording | State distinction to preserve |
|---|---|---|
| Unavailable deployment | “Deposits open soon”; “Waiting for the live contract” | No usable address; deposit controls blocked |
| Wallet/network | **Connect wallet**; **Switch to Ethereum mainnet**; “Not connected”; “No wallet found in this browser” | Connected wallet and supported network are separate prerequisites |
| Live checks | “The deposit address is a live contract…”; “The deposit is exactly…”; “Attendance disputes go to Kleros Court” | Read failure/mismatched amount/service must not look verified |
| Funding | ETH balance + “Network fee (estimate)”; **Send [amount]** | Insufficient principal and insufficient gas are separate conditions |
| Existing payment | “Don't send it twice”; “waiting for Ethereum mainnet to confirm it” | Pending receipt, prior deposit, failed read and completed deposit block accidental repeat payment |
| Luma handoff | **Copy link and go back to Luma**; “pending approval” | Sending ETH is not host approval/confirmed admission |
| Lookup | **Check**; “Deposit received”; “Spot confirmed”; “No confirmed spot for this wallet” | Wallet payment evidence and registered status are distinct |
| Omitted attendance | **Challenge ([fee] ETH)**; “Not on the attendance list” | Challenge only during relevant window and from the omitted staker |
| Unmatched challenge | **Dispute this claim ([fee] ETH)**; **Settle challenge** | Matching deadline then automatic-attendance eligibility; settlement still requires a transaction |
| Matched case | “In a Kleros dispute”; “share is set aside”; **Settle (after the ruling)** | Ordinary payout may finish while this share remains reserved |
| Appeals | **Appeal: fund "Yes, attended" ([amount])** / **…"No, did not attend"…**; **Deliver the final ruling** | Jury vote, appeal deadline/funding, final resolver ruling and contract settlement differ |
| Evidence | **Send evidence**; title/description/file/link fields | Public/permanent notice; guest UI says photos/PDF up to 4 MB; publication can fail/retry |
| Owed money | **Claim ETH** + alternate destination | Failed transfer remains owed; not the normal batch payout |
| No attendance list | **Withdraw my deposit** + alternate destination | Registered-staker no-list recovery after deadline; not general dispute cancellation |
| Event payout | **Release payouts**; “Open challenges” → “Open Kleros cases” | Payout eligibility requires challenge/match conditions; held shares remain visible |
| Completed states | “Paid out”; “Refunded”; event cancelled; no-show; withdrawn after deadline | Preserve reason and transaction evidence; avoid one universal success badge |

## 3. Kickback owner console

### Exact tokens, structure and controls — OBSERVED (SOURCE)

Source: `console/index.html`, lines 1–160, 314–318, 547–585. [K3]

- **Palette:** background `#1B003F`, card `#26085a`, border `#3d1b7a`, text `#f3ecff`, muted `#b9a6dd`, purple action `#9747FF`, cyan links `#27CDFE`, success `#3ddc97`, error `#ff6b8b`, warning `#ffc46b`. Live banner background `#5a0b2a`; rehearsal `#4a3300`; local `#063a2c`. Danger button `#a3204a`; inputs/log background `#12002b`.
- **Typography:** system UI body `15px/1.5`; heading 26 px, subheading 16 px, button 14 px; ui-monospace data 13 px. No custom font import or image logo found.
- **Geometry:** 760 px maximum main width; `32px 16px 64px` padding; card radius 14 px/padding 18×20 px; button radius 10 px; label/value grid 170 px + remaining width, collapsed below 520 px.
- **Structure:** title and wallet explanation; environment banner; connect; deploy once; contract status; approved registration; declined refunds; post attendance; challenges/corrections/appeals/evidence/payout; collapsed other actions; activity log. This is a long single-column operations page, not a sidebar/dashboard shell.
- **Mode labels:** LIVE (real guest deposits), REHEARSAL (throwaway contract), LOCAL TEST CHAIN. Rehearsal explicitly uses real network/ETH. No new design should turn rehearsal into an implied testnet status.
- **Primary labels:** **Deploy contract**, **Refresh**, **Register stakers**, **Refund declined guests**, **Post attendance list**, **Add to the list**, **Dispute (send to Kleros)**, **Settle**, **Publish case description**, **Fund appeal**, **Deliver final ruling**, **Collect appeal rewards**, **Submit evidence**, **Send challenge details (optional)**, **Release payouts**.
- **Folded operations:** **Remove and refund**, **Return**, **Return tokens**, **Collect leftovers**, **Cancel event and refund registered stakers**.
- **Confirmation UI:** browser `confirm`/`prompt` dialogs; typed tokens include POST, DISPUTE, APPEAL, PAY, CANCEL, and risk-specific SECOND/RETURN/SWEEP. Existing transactions simulate before wallet submission. Evidence console copy says up to 5 MB, differing from guest 4 MB.
- **Financial status includes:** owner, pending owner if present, phase, deposit, registered count, attendee/challenge counts, pool/balance, owed, spare, and “Set aside for open Kleros cases”. Owner-only actions are distinct from actions any wallet may perform; new visual treatment must reflect actual authority, not just an “admin” application role.

## 4. Booth visual system and reusable assets

### Tokens — OBSERVED (SOURCE)

Source: booth `site/index.html` lines 6–32, 35–228; `site/admin.html` lines 12–95. [B2, B3]

| Role | Visitor | Staff dashboard |
|---|---|---|
| Base / second background | `#0f0a2e` / `#1d1050` | `#120b33` / `#1a1046` |
| Dusk | `#4b2391` | — |
| Kleros purple / deep | `#9013fe` / `#4d00b4` | Same |
| Pink / gold / teal | `#de4fd0` / `#f2c46d` / `#7ff0e0` | Same |
| Text / muted | `#f7f3ff` / `#b8acdc` | `#f5f1ff` / `#a89cd2` |
| Danger / hot | `#ff8fa3` | `#ff7a9a` |
| Field or panel / border | white `.06` / white `.14` | panel white `.05` / line white `.11` |

- Visitor: Urbanist headings (700; H1 34–44 px, line-height 1.04); Inter body/controls. Space Mono is requested from Google Fonts, but inspected ticket code/clock CSS uses system monospace. Admin uses Inter `14px/1.45`, Cinzel 700/18 px title. Treat these as different existing choices, not one established shared type system.
- Visitor maximum width 480 px; safe-area-aware 22 px side padding; 52 px inputs/radius 14 px; 56 px primary button/radius 16 px; cards radius 22 px with translucent white gradient and 14 px backdrop blur. Staff maximum 1240 px; four-column KPIs collapse to two below 760 px; scrollable lead table.
- Visitor decoration: gradient night/dusk background with pink/teal glows, CSS starfield, gold corner frame, five floating Kleros symbols, swaying hero mark. Source includes a reduced-motion override. These are source-defined effects; no performance or contrast checks were run.

### Actual asset files — OBSERVED (SOURCE)

| Asset | Source evidence / reuse notes |
|---|---|
| `site/assets/logo-kleros-white.svg` | Fetched exact SVG: 185×48 viewBox, white combined symbol/wordmark paths. Visitor header height 30 px; staff header 26 px. [B5] |
| `site/assets/kleros-symbol-white-flat.svg` | Fetched exact SVG: 1445×1445 viewBox, white paths. Used as favicon. [B6] |
| Inline `#kleros-ico` | Visitor source contains a 54×48 symbol derived from the mark and reuses it for floating decorations, hero and quiz medal. [B2] |
| Merch images | Config references `assets/merch/stickers.jpg`, `tattoo.jpg`, `flipflops.jpg`, `bottle.jpg`, `gamcha.jpg`, `kurta.jpg`. Images themselves were not visually inspected; use only as booth merch media, not generic event artwork. [B4] |
| Other documented assets | README lists `docs/telegram-bot-avatar.png` and generated QR artwork in `qr/`; not visually inspected here. [B1] |

The fetched source asset paths are preferable to inventing a replacement Kleros mark. No verified light-background/black wordmark variant was established in this scoped inventory.

### Screens and labels — OBSERVED (SOURCE)

- Visitor header: white Kleros wordmark and edition badge; “Trust at Machine Speed” hero; merch ladder “More steps, better merch”; profile/interests form; optional newsletter checkbox; **Check in**; **Connect with the Kleros team**. [B2]
- Conditional email screen: “Confirm your email”, **Resend email**, **Change email**. Source/backend settings affect whether this gate waits; do not infer the live state from README's introductory prose alone. [B1, B2]
- Final ticket: tier, reward, visitor name/code, live clock; Teal/Purple/Gold/Already claimed treatments, each with text as well as color. Telegram **1 · Join the group** / **2 · Verify with our bot**, social **Follow**, **Start the quiz**, **Next question →**; personalized recommendations, Community Hubs and external resource links. “Check in someone else” is staff-kiosk-specific. [B2, B4]
- Staff: database-key connection; Check-ins/Hot leads/Want a call/Merch given KPIs; pipeline cards; matched use case/role summaries; merch lookup; search and priority/level/pipeline/use case/owner filters; visitor table; **Refresh**, **Export CSV**, **Give merch**, **Undo**. These are booth lead/merch operations, not financial attendance approval. [B3]

## 5. Design interpretation and missing rendered evidence

**ESTIMATE — proposed reuse:** The existing white Kleros wordmark/symbol, shared purple `#9013fe`, dark purple backgrounds, Inter, and teal `#7ff0e0` provide a defensible starting family for a unified design. Kickback's current blue receipt style and console's `#9747FF` are separate source precedents. Selecting one is a new design decision, not an observed universal standard. The financial application can reuse the brand while making amounts, event identity, network, permissions, deadlines and transaction outcomes more prominent than decoration.

**OBSERVED (SOURCE) precision issues to account for in redesign:** console `PHASES` labels Finalized as “Paid out”, and guest contract checks call it “settled”, even though matched cases may still hold reserved shares. Guest cancellation copy sometimes says every deposit was refunded; actual cancellation refunds registered stakers, while unregistered deposits need separate return handling. The source “Release payouts” summary is broader than the actual reserved-share flow. Redesign labels should preserve the accurate mechanics documented in PROJECT_BRAIN rather than copy those shorthand statements. Historical “about 3 weeks” / fee fallback strings are source copy, not current service guarantees. [K2, K3, K4]

**Unknown / not visually verified:** actual deployed branch/version, font delivery, real breakpoints/overflow, computed contrast, wallet-provider dialog appearance, live busy/loading/error screens, receipt reorg/replacement experience, hosted logo/media loading, staff access wall, current data volumes, and any production states requiring signatures or backend writes. All financial case/refund screens above were found statically, not exercised. No existing multi-event selector/catalog, organizer workspace navigation, global event search, cross-event dashboard or event-creation wizard is established by this Kickback source. Those are new redesign surfaces requiring explicit mock fixtures and state specifications.

## Pinned source references

- [K1](https://github.com/weiwei-ooi/devcon-side-event-kickback/blob/57fc1c8233c60e31c1b5988c631ef57d7c3f1b81/README.md) Kickback README, especially guest deployment and owner-console sections.
- [K2](https://github.com/weiwei-ooi/devcon-side-event-kickback/blob/57fc1c8233c60e31c1b5988c631ef57d7c3f1b81/site/index.html) Guest visual tokens/markup, checks, deposit gating, lookup and financial state rendering.
- [K3](https://github.com/weiwei-ooi/devcon-side-event-kickback/blob/57fc1c8233c60e31c1b5988c631ef57d7c3f1b81/console/index.html) Owner visual tokens, controls, permissions, mode banners and confirmations.
- [K4](https://github.com/weiwei-ooi/devcon-side-event-kickback/blob/57fc1c8233c60e31c1b5988c631ef57d7c3f1b81/contracts/TruthPaysKickback.sol) Actual financial phases, payout reserves and cancellation behavior.
- [B1](https://github.com/weiwei-ooi/kleros-devcon-checkin/blob/169220bb41787b8aabdec5190ab85379328f143f/README.md) Booth declared URLs, routes and workflow.
- [B2](https://github.com/weiwei-ooi/kleros-devcon-checkin/blob/169220bb41787b8aabdec5190ab85379328f143f/site/index.html) Visitor visual tokens, components and conditional screens.
- [B3](https://github.com/weiwei-ooi/kleros-devcon-checkin/blob/169220bb41787b8aabdec5190ab85379328f143f/site/admin.html) Staff visual tokens and controls.
- [B4](https://github.com/weiwei-ooi/kleros-devcon-checkin/blob/169220bb41787b8aabdec5190ab85379328f143f/site/config.js) Edition, merch and external links. Backend endpoint not reproduced in this inventory.
- [B5](https://github.com/weiwei-ooi/kleros-devcon-checkin/blob/169220bb41787b8aabdec5190ab85379328f143f/site/assets/logo-kleros-white.svg) Actual white Kleros wordmark SVG.
- [B6](https://github.com/weiwei-ooi/kleros-devcon-checkin/blob/169220bb41787b8aabdec5190ab85379328f143f/site/assets/kleros-symbol-white-flat.svg) Actual white Kleros symbol SVG.
