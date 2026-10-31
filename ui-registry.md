# Kleros event workbench visual registry

### Database Manage and event timezone

Files: `public/first-event-manage.js`, `public/first-event-display.js`, `public/luma-setup.js` · Updated 30 October 2026.

Reuse existing plum panels, serif headings, Geist body text, teal primary
buttons and secondary review controls. Keep wallet/status hashes wrapped with
overflow-wrap and existing mono text. Core actions stay on the database page.
Attended checkboxes are a review selection; the primary attendance action posts
one exact batch. Show ETH amounts in readable decimals and exact wallet lists
before wallet confirmation. Explain challenge and matching deadlines separately.
The timezone field offers common native choices plus an editable IANA datalist
using the existing form style; preserve selected-zone walltime and UTC in the
transaction terms. WalletConnect stays lazy and
uses the matching dark/lavender theme; it adds no startup wallet request.

Recovery keeps the same panel and secondary button styles on the saved-data page.
Show “Recover unused deposit” visibly, disabled until a wallet is connected. Its
existing review dialog lists the original contract, exact returned ETH and same
wallet destination in wrapped monospace. Keep progress in the existing status
line; loading an action must not replace the event page with an overlay.

### Wallet chooser and returning depositors

Files: `public/wallet-connection.css`, `public/first-event/wallet.js` · Updated 30 October 2026.

| Property | Pattern |
| --- | --- |
| Background | Plum `#1C1829`; inset fields `#120E1C` |
| Border | 1px `#473C5F`, 14px dialog radius; fields 1px `#84739E`, 8px radius |
| Text | Primary `#EEEAF5`, secondary `#CAC5D5`; serif heading 32px, regular weight |
| Spacing | Dialog padding 24px, body gap 14px, choice gap 10px |
| Controls | Existing secondary buttons; minimum 44px targets; visible close control |
| Focus | 3px `#C2B5F2` outline with 3px offset |
| Backdrop | `rgba(9,6,18,.78)` |

Use wallet names as plain text. Account-only Connect does not add policy or
signature prompts. App links open the current page, preserving the event route.
Prefer the singular current browser provider and allow late provider discovery;
external wallet options stay available when the browser exposes no provider.
Wallet return metadata retains the exact same-origin event URL.
When the production browser has no provider, the first Connect opens the existing
Reown picker directly. A cancelled attempt ends; browser-app links appear only on
the next explicit Connect on that route. Keep existing dark/lavender picker tokens.
Saved completed deposits replace payment controls with the original transaction
ID and Copy transaction ID button. Unknown or pending originals retain recovery
controls and take precedence over history. Do not label SQL history as current
withdrawable credit or organizer authority.

### Direct deposit, recorded recovery and check-in access

Updated 30 October 2026. Deposit opens the wallet's transaction review directly;
do not reintroduce an app deposit-review modal. Keep short preparing/submitted/
confirmed status and original-hash recovery controls. Use existing amount/card
and teal button styles. Recovery displays saved receipt history and labels it
separately from withdrawable credit. Check in is visible per depositor row and
in authenticated organizer controls, with event-hour availability explained in
the confirmation form. Recorded confirmed creation offers Create new event;
this opens a blank form and never relabels old links as freshly verified.

### Wallet-only public connection

Updated 30 October 2026. Public Connect opens account selection only, then shows
`Connected · 0x…` and the deposit button or setup form. Do not display sign-in,
policy or event verification messages on this control. Keep plain transaction
progress after Deposit/Create: Preparing, Confirm in wallet, Submitted, Confirmed.
Reuse existing teal primary buttons, plum cards and status/live-region styling.
Your events appears beneath setup for the selected wallet using public recorded
creation metadata. Its Manage link opens the database view; private controls
remain a separate authenticated action. A connected address is never a verified
organizer badge. Preserve original transaction IDs and pending controls on reload.

### Fast setup and authenticated connection

Updated 30 October 2026; `public/app.js`, `public/luma-setup.js`.

Reuse the existing plum setup card, serif heading, Geist form controls and teal
primary button. Setup configuration is display-only; explain that fresh checks
run before wallet confirmation without displaying a verified status. Production
V10 uses Create event in wallet as its single primary action; other versions keep
the separate review flow. Keep the form in place
while existing setup progress shows preparation, wallet review, submission and
confirmation. Progress uses text and `role=status`, not color alone.
Common timezones use a native select styled by `.luma-setup-form :is(input, select)`;
retain searchable IANA input for custom zones and the same date invalidation rules.
The launch capacity is an explicit read-only 150 field using the existing input
style. A reviewed replacement preset shows its new-contract disclosure and original
recovery link before the action; prefilled terms do not imply creation or migration.

### Current event and previous-event recovery

Files: `public/first-event/event.js`, `page.js`, `public/first-event-display.js`,
`public/home-wallet.js` · Updated 30 October 2026 using imprint.

Reuse the existing plum cards, `.field-help`, secondary links, wrapped `.mono`
addresses and cyan current-event action. Normal discovery/counts/search shows one
current Truth Pays event. Label prior receipts and creator history “Previous event —
recovery only”; retain the exact original contract in that view. Previous links
never become a new payment or attendance action. A visible recovery link on the
current page keeps old credit accessible. Current static address, QR pixels and
wallet transaction share one source identity; hide stale manual-payment controls.
After authentication in the guarded app, clear the previous event and actor
content before showing the connected-wallet card. Its single primary control
continues to freshly checked event actions. Preserve the preferred first-event
deposit card and its immediate post-connect Deposit button.

Testnet environment notices must visibly name the authoritative controlled-arbitrator setup and
state that it has no independent jury. Use the existing persistent notice pattern and trusted
bootstrap text; exact chain/currency, policy and transaction review remain available.
Before bootstrap returns, network labels say “Connecting” instead of assuming a local chain.
Wallet-owned unused credit and owed recovery must stay visible without a name/email registration.
Use authenticated `ownWallet` facts from the same verified block. An initial recorded payment can
still have later top-ups; show ordinary batch, final ruling and completed settlement separately.
Case details disclose the challenge-time organizer, and only final values0/1/2 enable settlement.
Wallet/app activity labels describe their visibility scope rather than implying complete chain history.

### Shared online demo environment notice

Files: `public/app.js`, `public/styles.css` · Updated 28 October 2026

| Property  | Pattern                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------ |
| Condition | Visible when authoritative bootstrap mode is `hosted-demo`                                                         |
| Container | `.hosted-demo-notice`, sticky top, `--raised` background, 1px `--amber` bottom border                              |
| Text      | Geist 12px / 1.5; uppercase amber title 11px, descriptive text in `--ink`                                          |
| Spacing   | 10px 24px desktop; 8px 16px mobile with a stacked title and description                                            |
| Sidebar   | Height/top offset applies only at widths above 900px; mobile remains in normal compact flow                        |
| Inputs    | `.hosted-input-hint`, 12px muted text with a 2px amber left rule; explanation only, API owns validation            |
| Identity  | Shared role selection explicitly described as synthetic impersonation; browser-wallet nonce proof remains distinct |

The notice stays visible through event and identity switches and states valueless ETH, mock Court, shared state, reset on server restart and synthetic inputs only. It has no dismissal control and does not move focus. Existing financial action, calldata, authority and journal behavior remains unchanged.

Updated 29 October 2026 using the imprint skill. The user-supplied Kleros briefing and booth references
supersede the original Option B color values in `KLEROS_REDESIGN_HANDOFF/design-tokens.json`;
that handoff remains a historical design snapshot. The retained legacy apps keep their own visual
systems. See [current palette and reference images](docs/UI_COLOR_PALETTE.md). Preserve these tokens
when integrating the compact portal from the separate UI worktree.

### Shell and typography

Files: `public/styles.css`, `public/index.html` · Last updated: 29 October 2026

| Property                      | Token / selector                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| Background / rail             | `--paper: #120E1C`, `--deep: #100C19`; subtle plum glow at the canvas's top right             |
| Surface / raised              | `--surface: #1C1829`, `--raised: #2E1D4C`                                                   |
| Text / heading / muted        | `--ink: #EEEAF5`, `--heading: #FCFAFF`, `--muted: #CAC5D5`                                  |
| Decorative / control boundary | `--line: #473C5F`, `--boundary: #84739E`                                                    |
| Display                       | Instrument Serif, regular 400; h1 up to 60px, h2 32px                                       |
| Body / controls / metadata    | Geist 16px/1.6; 14px controls; 13px metadata                                                |
| Identifiers / amounts         | Geist Mono; long values wrap rather than disappear                                          |
| Brand                         | Original supplied Kleros SVGs, unchanged; font binaries and OFL notices in `public/assets/` |

Pattern notes: Every financial view keeps stable event identity and network visible. Full trusted deployment, policy and verified snapshot are available through the context disclosure and remain expanded during transaction review. The context stays at the top on wide screens; mobile preserves the same data in normal flow. Public directory and content associations remain accessible.

### Cards, participant facts and next action

Files: `public/styles.css`, `public/app.js` · Last updated: 29 October 2026

| Property         | Token / selector                                                         |
| ---------------- | ------------------------------------------------------------------------ |
| Container        | `.panel`, `.event-card`: surface, 1px decorative border                  |
| Radius / padding | `--radius: 14px`; 24px panels, 20px on mobile                            |
| Inner facts      | `.state-fact`: raised surface, control radius 8px; explicit dt/dd labels |
| Next action      | `.next-action`: accent boundary, one primary eligible action with reason |
| Status           | Text and badge; never color alone                                        |
| Hover            | Lavender boundary / plum raised surface; no essential motion              |
| Shadow           | `--shadow: 0 18px 56px #09060d38`, restrained use                        |

Pattern notes: Admission, verified deposit, contract registration, staff check-in, financial attendance, challenge and payout remain independent. Personal history is a separate panel. Participant status precedes event story. Do not label a receipt as confirmed admission, an open matched case as a global payout freeze, or absent payment history as a successful payout.

### Buttons, inputs and focus

Files: `public/styles.css`, `public/app.js` · Last updated: 29 October 2026

| Property       | Token / selector                                                                   |
| -------------- | ---------------------------------------------------------------------------------- |
| Primary        | `.button-primary`: `--teal: #5BD4EF`, dark `--on-accent: #100C19`; hover `#86E2F5`  |
| Links / focus  | Lavender `--purple: #C2B5F2`; soft tint `#C2B5F214`, tinted border `#C2B5F240`      |
| Secondary      | `.button-secondary`: transparent/deep surface, meaningful boundary                 |
| Danger         | `--red: #FF8FA3` with tinted surface                                               |
| Geometry       | 8px control radius; buttons at least 44px; fields at least 46px                    |
| Focus          | 3px lavender outline, 3px offset; keyboard-visible                                 |
| Disabled       | Explicit disabled property and reason in nearby text; server remains authoritative |
| Reduced motion | `prefers-reduced-motion` disables nonessential transitions                         |

Pattern notes: Tabs use roving tabindex and Arrow/Home/End. The native review dialog adds explicit Tab containment, Escape dismissal and trigger restoration. Async replacement restores stable focus when possible; polite notices announce outcomes. Do not infer permissions from disabled controls.

### Context, reconciliation and review

Files: `public/styles.css`, `public/app.js`, `public/reconciliation.js` · Last updated: 28 October 2026

| Property                  | Token / selector                                                              |
| ------------------------- | ----------------------------------------------------------------------------- |
| Context                   | `.event-context`: deep surface, visible boundary, 14px radius                 |
| Review steps              | `.workflow-step`: surface blocks, 8px radius, readable numbered labels        |
| Provenance / exceptions   | `.notice`, `.source-hash`, `.reconciliation-table`                            |
| Success / warning / error | `#86D9B4` / `#F0C08A` / `#FF8FA3`; tinted surfaces                            |
| Table records             | Explicit column scope; mobile cells retain column names via `data-label`      |
| Dialog                    | Deep/surface background, 18px radius, safe overflow, clear Cancel and Confirm |

Pattern notes: Select source, inspect all rows and exceptions, review consequences, then apply. Every row stays visible; no silent exclusions or source rewriting. A client preview never authenticates CSV origin or verifies a receipt. Financial registration/attendance still require separate simulated transaction reviews. Source edits, event/wallet changes and stale snapshots invalidate pending review.

### Money and case summaries

Files: `public/styles.css`, `public/app.js` · Last updated: 28 October 2026

| Property          | Token / selector                                                                |
| ----------------- | ------------------------------------------------------------------------------- |
| Money cards       | `.money-summary`, `.money-card`: raised surface, 14px radius, technical amounts |
| Case              | `.case-summary`, `.case-card`: surface with explicit lifecycle heading          |
| Supplemental data | `.details-list`: muted labels, primary values, long identifiers wrap            |
| Missing totals    | Visible “Unavailable” plus explanation, never estimated from remaining balance  |

Pattern notes: Sent, reserved case shares, owed failed transfers and challenge escrow have separate explanations. Total reserves overlap these obligations and must not be added again. Appeal costs and deadlines use the current resolver projection. A jury vote, final resolver result, settled challenge and delivered ETH are separate states. Waiting challenges have no Court IDs.

### Read-only online preview

Files: `scripts/netlify-preview-client.js` · Last updated: 28 October 2026

Pattern notes: A persistent, plainly labeled preview notice explains captured synthetic data and disabled
transactions. Reuse the existing plum/lavender typography and surfaces. Identity switching is presented
as choosing a saved view. Disable data-entry and financial controls with a reason; retain event/view
navigation, disclosures and help. Refuse writes in the adapter as well as disabling UI controls. The
full local application retains its original behavior and visual patterns.

### Simple event journey and progressive disclosure

Files: `public/app.js`, `public/styles.css` · Last updated: 28 October 2026

| Property             | Pattern                                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Onboarding / journey | `.quick-start`, `.participation-steps`: existing surface and decorative border; 18px / 14px padding                  |
| Step marker          | `.step-number`: raised background, muted label; current uses purple/on-accent, completed uses green plus a checkmark |
| Current action       | Existing `.next-action`, one primary action with an explicit reason                                                  |
| Detail disclosure    | Native `details`/`summary`, lavender focus; `.context-verification` and `.status-details` start closed               |
| Text                 | Geist 14px semibold titles; 12px muted descriptions; existing Instrument Serif headings                              |
| Credit               | `.credit-summary`: purple-soft surface and purple boundary, 8px radius, 16px padding                                 |
| Spacing              | 12px between steps, 28px after onboarding; existing panel spacing retained                                           |

Pattern notes: Everyday navigation is “Your spot”, “Manage event”, “Disputes & kickbacks”. The four-step
journey reports reserve/payment, admission/contract registration, financial attendance and successful
attendance payments independently. A staff observation does not mark financial attendance complete.
An owed claim can contain mixed credit types and does not manufacture a completed kickback. Seven
full source-labeled facts remain available in “All status details”. Event identity and network remain
visible while full contract, policy and verified block details are available on demand; exact transaction
amount, recipient, wallet, network, event and policy stay expanded before confirmation. All journal,
retry, event-switch and stale-review protections remain authoritative.

v8 alone shows authoritative `pendingCreditWei`, distinguishing unused payer credit from an admitted
commitment. Withdrawal requires its own destination/amount and fresh transaction review. The money summary also reports unused credits separately from attendance payouts, owed transfers and case shares. The older
v7 guest/console links are never shown for v8. Public-testnet mode uses wallet authentication and
server-provided chain/native-currency metadata; it removes demo identity, faucet, time-travel and mock
Court controls. Its persistent notice explains test tokens and public transactions without claiming
that a browser fixture constitutes a testnet deployment.

### Contract deposit inbox

Files: `public/contract-inbox.js`, `public/contract-inbox.css`, `public/app.js` · Last updated: 29 October 2026

| Property                | Pattern                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| Source bar              | Deep surface, line border, 12px radius, 14px / 16px padding; muted sync metadata                        |
| Rows and receipt review | Existing ink/heading/muted text and plum/lavender tokens; grouped wallet observations, native dialog    |
| Controls                | Existing button variants; purple 3px focus outline and 3px offset; 44px minimum targets                 |
| Warnings                | Existing amber/red tokens with tinted surfaces; plain stale, unavailable and owner-access reasons       |
| Technical facts         | Full wrapping wallet, receipt and block identifiers; exact token and wei amounts; contextual disclosure |

Pattern notes: Mount only for the authenticated current v8 owner when the backend advertises the
capability. Event, wallet, chain, contract, version and server instance scope every read; dispose before
navigation, reload or identity changes. Unknown payers show only wallet/receipt observations. Verified
contact links, application receipt linkage, admission and financial registration remain independent.
The modal preserves its observed block, warns when the source changes, and never becomes a signing
review. Historical receipts, current unused credit, current committed principal, held case shares,
owed balances and delivered payment categories are separate facts, never added as disjoint totals.
Transient failures visibly retain stale observations; proven orphaned anchors clear old rows and
reviews. Authorization failures remove contacts immediately. Inbox review invalidates unsigned
financial/import previews while preserving submitted transaction journals. The linked-guest action
rechecks owner access and focuses only a current, authorized participant already in People review.

### Separate batch approval and trusted check-in

Files: `public/batch-actions.js`, `public/batch-selection.js`, `public/batch-actions.css`, `public/batch-pending.js`, `public/app.js` · Last updated: 29 October 2026

| Property      | Pattern                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| Entry toolbar | Quiet until selection; existing line boundaries, 8px spacing and 13px semibold count                      |
| Row selection | 44px labelled targets, 18px native checkbox, purple accent, existing small-radius hover surface           |
| Focus         | Purple 3px outline with 3px offset; native dialog containment and focus restoration                       |
| Review        | Surface dialog, 20px radius, 24px padding; every selected row plus exact event/account/deployment context |
| Explanations  | Deep surface, line boundary and 12px radius; muted 13px copy, red unavailable/error states                |

Pattern notes: Curated host approval and trusted door check-in have separate toolbars and selection
controllers. Owners can use both; staff get check-in only. Each toolbar sits outside its source rows.
Select visible chooses only current, explicitly eligible records. Unknown payer addresses stay blocked
with no invented identity. A filter change clears that task's unsigned selection; event, wallet, server,
permission and view changes dispose private UI before remount. The exact trusted participant ID,
verified identity and full wallet must agree before a contract row receives a guest link.

Saving is explicit and off-chain. A durable contact-free intent marker must exist before the one save
request; storage failure visibly locks saving. Uncertain results survive reload and reconcile only
through authenticated GET status, without automatic POST retry. Submitted financial journals remain
independent. A saved approval offers a separate explicit registration review for the exact approved
selection. Changed eligibility blocks that complete selection with a reason; no selected wallet is
silently dropped. Registration, financial attendance, disputes and payouts retain fresh canonical
simulation and the existing exact signing review. Luma approval remains a manual task outside this app.

### Accelerated Chiado test profile

Files: `public/contract-profiles.js`, `public/app.js`, `public/batch-pending.js` · Last updated: 29 October 2026

Pattern notes: The exact `kleros-event-v8-test15m` profile reuses the existing persistent amber
`.hosted-demo-notice` and `.notice.warning` surfaces; it adds no visual theme. Label it prominently
“15-minute TEST ONLY · Chiado (10200)” in the environment, event context and signing review.
Use synthetic data/test XDAI and retain the controlled-arbitrator/no-independent-jury disclosure.
Show actual reported omission and matching deadlines with seconds; never calculate a new deadline
from the window length or relabel a normal v7/v8 event as accelerated.

Only the explicit known profile receives the v8 financial interface. Its ABI, chain10200 and any
provided pinned profile metadata must agree. Unknown version prefixes and prototype names receive
no financial support. Payer credit, admission, separate batch curation and exact signing review keep
their established behavior. The contact-free pending journal admits this profile only on Chiado and
keeps it isolated by version from normal v8; existing v7/v8 presentation and journal scopes remain.

### Stable loading and keyboard recovery

Files: `public/index.html`, `public/loading.css`, `public/ui-keyboard.js`, `public/app.js` · 29 October 2026

| Property             | Pattern                                                                                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loading              | Static `aria-hidden` cards using existing deep/surface/raised/line/radius tokens; 36rem initial main reserve.                                                                      |
| Accent and type      | Scoped loading cyan resolves to shared `--teal: #5BD4EF`; existing Instrument Serif heading and Geist 14px status.                                                                 |
| Compact mobile shell | Same navigation geometry before/after hydration at ≤600px; preallocated account slot ≤45%; 44px refresh keeps a screen-reader label.                                               |
| Announcements        | Stage status outside busy content; one explicit read-error alert with a focused retry only when focus remains in the request context.                                              |
| Focus                | Skip focuses main without routing; event/tab focus intent binds to the current load; background refresh retains the most recent focus and never displaces a moved-to live control. |
| Disclosures/dialogs  | Closed details expose only their first summary subtree to the trap. Native interior Tab/Escape remain; wrap only visible boundaries.                                               |
| Motion               | Skeleton stays static; reduced-motion stops the spinner.                                                                                                                           |

Pending money/actions remain unavailable until fresh detail and existing journal guards are restored.
Never add simulated percentages, cached eligibility or optimistic payment success to loading UI.

### Verified production context and upgrade disclosure

Files: `public/environment.js`, `public/app.js`, `public/contract-profiles.js` · 29 October 2026

| Property | Pattern |
| --- | --- |
| Environment status | Existing persistent notice surface, with plain Ethereum/ETH and standard-wallet support metadata. |
| Unavailable authority | Existing amber warning notice; plain reason, no simulated completion or financial eligibility. |
| Governance details | Existing native details/summary, context-details and details-list; full wrapping addresses and exact reported delay/pending time. |
| Financial review | Existing expanded event, network, wallet, contract, recipient, exact ETH/wei and policy facts before signing. |
| Interaction | Existing native dialogs, 44px targets and scope-bound focus; no new navigation or visual theme. |

Pattern notes: The explicit hosted-production mode hides sandbox utilities even when production
metadata is incomplete. Verified metadata and transaction readiness are separate from presentation.
A pending/unavailable appeal reward amount stays unavailable rather than becoming zero.
An event's UUPS proxy and upgrade authority are event-specific. The timelock gives review notice,
not guaranteed withdrawal; custody logic can change under the upgrade authority. Factory defaults
apply to future events. Only verified supplied governance facts are displayed as verified.
Keep the simple participant, organizer and disputes navigation and the shared cyan action accents.

### Compact participant deposit page

Files: active UI worktree `public/luma-launch.css`, `public/styles.css`, `public/index.html` · 29 October 2026

| Property | Pattern |
| --- | --- |
| Canvas / cards | Shared plum paper/deep/surface tokens and restrained background gradient. |
| Primary action | Cyan `--teal: #5BD4EF`, dark `--on-accent: #100C19`, hover `#86E2F5`. |
| State / receipt boundary | `--launch-accent: var(--teal)`; confirmed remains a receipt-backed state. |
| Links / keyboard focus | Lavender `--purple: #C2B5F2`; 3px outline with 3px offset. |
| Geometry / text | Existing 20px cards, 24px padding (20px mobile), 44px actions, Instrument Serif/Geist. |

Pattern notes: Deposit, pending, failed and confirmed states share one palette. Return to Luma uses
the same cyan primary action. Launch CSS must not remap shared lavender tokens to older teal or
override the shared action label color. Current implementation is in the compact UI worktree;
preserve these changes on integration. Existing warning/error semantics and signing behavior remain.


### Submitted hashes during verification failure

File: `public/app.js` ·29October2026

Pattern notes: Use the existing panel, transaction-log, mono wrapping text, warning surface and native
button. An error never hides a scoped durable transaction reference. Show full event/contract/wallet
context and exact recorded hash; offer one explicit receipt check. Keep all new financial actions
absent while event verification is unavailable. Confirmed means the original receipt was verified,
not that payout delivery or event trust is established. Malformed responses retain the hash; changed
actor, event, backend instance or mode cannot inherit the panel or signing authority.
# Luma guest entry correction — 29 October 2026

The generic root page gives guests plain guidance to follow the event-specific deposit link from
Luma; it has no manual paste-link opener or popup. Organizer setup stays directly reachable.
After confirmed event creation, preserve canonical Copy deposit link and Open deposit page actions.
Keep direct participant URLs, wallet review/receipt recovery, Return to Luma and the existing palette.

## Superseding public-event search — 29 October 2026

The later explicit human request replaces the generic guest guidance with a title-searchable public
event catalog. Filter explicit public+published records before indexing, counts or rendering; never
default unknown flags to public. Keep search and clear local, use native participant links, preserve
organizer setup and generated share links, and show truthful empty/no-match states. Reuse the current
palette,44px controls and responsive wrapping. Private/draft/owner-only events never enter the list.

### Fast public directory and neutral initial shell

Updated29October2026. Files: `public/app.js`, `public/event-search.js`, `public/index.html`,
`public/loading.css`. Before environment discovery, `.initial-shell` uses a compact900px single-column
loading geometry and neutral Connecting label. It claims no network/session. Once metadata loads,
Event Directory chrome hides the wallet identity button; explicit event/setup navigation restores the
existing verified environment and wallet controls only after its guarded bootstrap.

Public directory rows use existing teal/plum cards,44px controls, wrapped titles/amounts and native
Open event links. The recorded metadata projection says **Check status on open** and explains that
current status and wallet actions are checked there. Never borrow financial-ready styling or current
Open/Paid states from the fast catalog. Search/clear are local, counts exclude private/draft/missing
flags before indexing, errors require explicit retry, and same-scope refresh keeps the search caret.

### Setup wallet progress and recovery

Files: `public/app.js`, `public/loading.css`. Updated29October2026, using the imprint pattern.

| Property | Pattern |
| --- | --- |
| Container | Existing `.loading-shell`; setup variant `#loading[data-setup-loading]` |
| Background/border | `--surface`, 1px `--line`; existing `--radius` cards |
| Text | Existing Instrument Serif loading heading, Geist muted status; teal eyebrow/spinner |
| Shape/spacing | Form-shaped context and two field cards, existing24px panel padding/gaps |
| Busy state | Stale form disposed; `#content` hidden/busy; polite status stays outside that subtree |
| Error | Existing `.luma-setup`, `.error-panel` and alert; persistent explanation, wrapped text |
| Recovery | Existing teal primary/outlined secondary44px buttons with normal keyboard focus styles |
| Motion | Existing reduced-motion rules; no new shimmer or transition |

Stages distinguish wallet sign-in from Ethereum/session verification. Errors never restore a cached
signed-in form. Normal retry performs a fresh read; a changed server instance explicitly asks the
user to reload. No automatic reload or transaction resend. Preserve saved transaction journals.

### Immediate wallet and transaction feedback

File: `public/app.js` · Updated30October2026 using the imprint skill.

| Property | Pattern |
| --- | --- |
| Sign-in / result notice | Existing `#toast`, `role=status`, polite live region; raised plum surface, `--ink` text |
| Border / shape / shadow | Existing1px `--boundary`, `--small-radius`, `--shadow`; no new tokens |
| Copy / spacing | Existing Geist14px/1.7,16px20px toast padding; hashes wrap within the viewport |
| Transaction stage | Existing `#transaction-status` and `.notice`; raised surface,1px line,16px padding, muted text |
| Busy control | Existing disabled button, explicit stage label and sign-in `aria-busy`; normal focus styles |
| Errors | Existing toast error variant and `.error-panel`; no success styling for pending or unknown outcomes |
| Receipt-check limit | Existing amber `.notice.warning`; full wrapped original hash and disabled original execute control |

Show wallet account/signature waits immediately. Authentication acknowledgment still requires the
fresh session/event read before verified readiness. Transaction stages distinguish checking, wallet
approval, a journaled submitted hash, and authoritative confirmation. A confirmed result can appear
while event details refresh; the older displayed balance/admission remains a separate snapshot.
Feedback belongs to the captured event, actor, server, route and review generation; late outcomes
retain their journals without repainting another view. No automatic transaction retry, resend or style change.
When receipt checks stop, say that success/failure remains unverified. Keep the hash visible and
direct the user to close the review and check the original transaction. Only a canonical failed
receipt can use the failed state; a browser deadline or interrupted read cannot establish failure.

### Shared public directory startup

Files: `public/entry.js`, `public/public-home.js`, `public/app.js`. Updated29October2026.
The existing public directory pattern is now rendered by one shared pure helper in lean and full
startup. No token changes: surface cards,1px line border,20px radius,24px padding, Instrument Serif
headings, Geist copy, teal primary/outlined secondary controls and existing44px minimum targets.
Loading stays neutral until context arrives. Metadata status remains Check status on open. Retry/error
uses the same alert/button patterns and restores keyboard focus when owned; same-scope refresh keeps
the input/caret. CSS for contract inbox and batch controls loads only with the full app before it starts.
No duplicated visual system, wallet prompt, storage initialization or financial controls on cold home.

### Explicit setup transaction progress and owned-event summaries

Files: `public/setup-progress.js`, `public/owned-events.js`, `public/luma-launch.css`.
Updated29October2026. Reuse plum surface, teal1px outline,20px radius,24px padding (20pxmobile),
Instrument Serif heading and Geist copy. Four compact stages use Review/Wallet/Confirm/Event page;
only current step uses teal. Attention uses existing amber. Native full-value readonly fields retain
selection, labels and44px controls; wrapped action rows fit mobile. Polite live status sits outside
the busy stage subtree. No percentages, invented counts, auto-reload or send controls. Confirmation
and event-page readiness are separate; ready links need the authoritative adapter's explicit verified
result. Reuse existing directory rows for Your events, with title/date/Public-or-Private/Draft-or-
Published and one Manage event link. Null/unavailable and verified empty are different states.
Private titles require the fresh exact authenticated actor/environment before rendering. These pure
components are unwired until Core's transaction/auth/route integration is approved and tested.
# Original-transaction recovery view — 29October2026

Use existing Luma cards, labels, monospace hashes and progress component. A read-only recovery view
has a separate authentication message and shows transaction confirmation separately from portal
readiness. Preserve the exact original hash through every error. Clear owned facts on actor/network
loss; never generate deposit/manage links from an unadopted receipt. Ordinary organized-event rows
come only from fresh canonical organizer summaries and refresh independently of the receipt panel.

### Separate V10 setup review page

Files: `tools/v10-wallet/index.html`, `deploy.js`, `style.css`. Updated30October2026.
Retain the local deployment review's background `#120E1C`, surface `#1C1829`, border `#473C5F`,
ink `#EEEAF5`, muted `#CAC5D5`, lavender primary/focus `#C2B5F2`, 12px card radius and20px padding.
Four numbered cards show exact CREATE nonce/address/gas/fee/runtime and a separate receipt state.
Mobile stacks controls and wraps full values without horizontal overflow. Mainnet, proposed total gas
cap, immediate owner/renunciation terms and signing-disabled status are visible before wallet actions.
Keep local receipt recovery and original hashes; do not add event creation or automatic sends.

### First-event deposit page

Files: `public/first-event/index.html`, `styles.css`, `wallet.js` · Updated 30 October 2026

Reuse paper `#120E1C`, surface `#1C1829`, line `#473C5F`, lavender `#C2B5F2`, cyan `#5BD4EF`, local Geist and Instrument Serif. One 14px-radius deposit card uses 28px padding (22px mobile); 8px controls have 44–46px minimum targets and 3px lavender keyboard focus. The persistent network label, exact full contract address and amount remain explicit. QR, copy and wallet-button paths share one event identity. Initial rendering never waits for chain reads. Confirmed payments hide further payment controls and show the original transaction ID plus Luma return; pending/ambiguous outcomes retain original-hash recovery.

The current IST replacement is the sole discovery result. Previous event links
use the same site origin and open recovery with their original event/contract.
Connect selects an injected wallet first; without one, open the existing Reown
picker directly. Keep its cancellation and explicit browser-app fallback behavior.

The canonical participant layout is `/first-event/`; simple Truth Pays participant links (including
an omitted view) resolve directly here without a second event card. Keep the existing deposit card,
QR, full address and Luma return unchanged. The disclosure's Manage/recover link explicitly uses
`review=1` to enter the fresh guarded app. Additional action, recovery or transaction route data stays
with that app; organizer links retain the separate public depositor list.

### First-event organizer review

Files: `public/app.js`, `public/contract-inbox.js`, `public/contract-inbox.css` · Updated 30 October 2026

Reuse existing plum/lavender/cyan tokens, 14px cards, 8px controls, 44px targets and lavender focus. The actual deposit inbox stays in its own initially open native disclosure for this event; legacy table ordering remains for other profiles. Payer review shows exact wallet/receipt with a factual editable note and unchecked acknowledgment; absent contacts are labelled wallet-only, without inferring signature or Luma verification. Registered-wallet attendance checkboxes start unselected and stay disabled until the authoritative event end. The exact list, owner note, interval, principal share, wallet, recipient and policy remain in the existing guarded transaction dialog.


### Immediate first-event display

Files: `public/first-event-display.js`, `public/entry.js` · Updated 30 October 2026 using the imprint skill.

Uses the existing `.luma-launch-event` header, `.panel` surface/border/radius, `.details-list` facts,
`.button-secondary` controls, muted field-help and `.table-scroll` receipt table. No new palette,
spacing scale or loading overlay. Long wallets wrap on mobile; receipts retain descriptive links.
Public event facts appear independently of network reads. Deposit rows always name their snapshot
block/time and cumulative received amount; stale/error states retain that qualification. A public
view never grants owner status, wallet eligibility or financial permissions. Review buttons enter
the existing fresh verification flow.

### Home wallet, public creator events and saved deposits

Files: `public/public-home.js`, `public/home-wallet.js` · Updated 30 October 2026 using imprint.

Reuse `.luma-launch-card`, `.public-event-list`, `.public-event-row`, `.public-event-copy`,
`.public-event-date`, `.badge`, `.field-help` and `.button-secondary`; no new visual tokens.
Your events sits below Find your event and before Organizing an event. Connect wallet only selects
the account and shows a short monospace address. Rows use public recorded creator metadata and a
Manage event navigation link; they never claim verified ownership or grant permissions. Keep the
public setup metadata read separate from Connect and clear the displayed wallet rows on account or
network changes.

Your deposits reuses the same card and event-row styles below Your events. Keep full transaction
IDs wrapped in `.mono`, with `.button-secondary.button-small` copy controls and `.field-help`
status text. Show only receipts for the connected wallet, label stale snapshots, and keep the
receipt read independent of Connect. Received payments, attendance and current credit remain
separate facts; the Manage attendance link opens the existing database view.
