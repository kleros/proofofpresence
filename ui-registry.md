# Kleros event workbench visual registry

Testnet environment notices must visibly name the authoritative controlled-arbitrator setup and
state that it has no independent jury. Use the existing persistent notice pattern and trusted
bootstrap text; exact chain/currency, policy and transaction review remain available.
Before bootstrap returns, network labels say “Connecting” instead of assuming a local chain.

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

Updated 28 October 2026 using the imprint skill after implementing selected Option B in the isolated UI worktree. This replaces the earlier light workbench patterns. The retained legacy apps keep their own visual systems. Exact selected values come from `KLEROS_REDESIGN_HANDOFF/design-tokens.json`.

### Shell and typography

Files: `public/styles.css`, `public/index.html` · Last updated: 28 October 2026

| Property                      | Token / selector                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| Background / rail             | `--paper: #17131F`, `--deep: #120F19`                                                       |
| Surface / raised              | `--surface: #201A2B`, `--raised: #2A2336`                                                   |
| Text / heading / muted        | `--ink: #E6E1EE`, `--heading: #F2EEF7`, `--muted: #A69FB5`                                  |
| Decorative / control boundary | `--line: #352D44`, `--boundary: #81788F`                                                    |
| Display                       | Instrument Serif, regular 400; h1 up to 60px, h2 32px                                       |
| Body / controls / metadata    | Geist 16px/1.6; 14px controls; 13px metadata                                                |
| Identifiers / amounts         | Geist Mono; long values wrap rather than disappear                                          |
| Brand                         | Original supplied Kleros SVGs, unchanged; font binaries and OFL notices in `public/assets/` |

Pattern notes: Every financial view keeps stable event identity and network visible. Full trusted deployment, policy and verified snapshot are available through the context disclosure and remain expanded during transaction review. The context stays at the top on wide screens; mobile preserves the same data in normal flow. Public directory and content associations remain accessible.

### Cards, participant facts and next action

Files: `public/styles.css`, `public/app.js` · Last updated: 28 October 2026

| Property         | Token / selector                                                         |
| ---------------- | ------------------------------------------------------------------------ |
| Container        | `.panel`, `.event-card`: surface, 1px decorative border                  |
| Radius / padding | `--radius: 14px`; 24px panels, 20px on mobile                            |
| Inner facts      | `.state-fact`: raised surface, control radius 8px; explicit dt/dd labels |
| Next action      | `.next-action`: accent boundary, one primary eligible action with reason |
| Status           | Text and badge; never color alone                                        |
| Hover            | Lavender boundary / subtle raised surface; no essential motion           |
| Shadow           | `--shadow: 0 18px 56px #09060d38`, restrained use                        |

Pattern notes: Admission, verified deposit, contract registration, staff check-in, financial attendance, challenge and payout remain independent. Personal history is a separate panel. Participant status precedes event story. Do not label a receipt as confirmed admission, an open matched case as a global payout freeze, or absent payment history as a successful payout.

### Buttons, inputs and focus

Files: `public/styles.css`, `public/app.js` · Last updated: 28 October 2026

| Property       | Token / selector                                                                   |
| -------------- | ---------------------------------------------------------------------------------- |
| Primary        | `.button-primary`: `--purple: #A78BFA`, `--on-accent: #17131F`                     |
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
