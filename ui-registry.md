# Kleros event workbench visual registry

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
