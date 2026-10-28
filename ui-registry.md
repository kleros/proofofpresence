# Kleros event workbench visual registry

Updated 28 October 2026 using the imprint skill after implementing selected Option B in the isolated UI worktree. This replaces the earlier light workbench patterns. The retained legacy apps keep their own visual systems. Exact selected values come from `KLEROS_REDESIGN_HANDOFF/design-tokens.json`.

### Shell and typography

Files: `public/styles.css`, `public/index.html` · Last updated: 28 October 2026

| Property | Token / selector |
| --- | --- |
| Background / rail | `--paper: #17131F`, `--deep: #120F19` |
| Surface / raised | `--surface: #201A2B`, `--raised: #2A2336` |
| Text / heading / muted | `--ink: #E6E1EE`, `--heading: #F2EEF7`, `--muted: #A69FB5` |
| Decorative / control boundary | `--line: #352D44`, `--boundary: #81788F` |
| Display | Instrument Serif, regular 400; h1 up to 60px, h2 32px |
| Body / controls / metadata | Geist 16px/1.6; 14px controls; 13px metadata |
| Identifiers / amounts | Geist Mono; long values wrap rather than disappear |
| Brand | Original supplied Kleros SVGs, unchanged; font binaries and OFL notices in `public/assets/` |

Pattern notes: Every financial view keeps stable event identity, local environment, full trusted deployment and verified snapshot visible. The context stays at the top on wide screens; mobile preserves the same data in normal flow. Public directory and content associations remain accessible.

### Cards, participant facts and next action

Files: `public/styles.css`, `public/app.js` · Last updated: 28 October 2026

| Property | Token / selector |
| --- | --- |
| Container | `.panel`, `.event-card`: surface, 1px decorative border |
| Radius / padding | `--radius: 14px`; 24px panels, 20px on mobile |
| Inner facts | `.state-fact`: raised surface, control radius 8px; explicit dt/dd labels |
| Next action | `.next-action`: accent boundary, one primary eligible action with reason |
| Status | Text and badge; never color alone |
| Hover | Lavender boundary / subtle raised surface; no essential motion |
| Shadow | `--shadow: 0 18px 56px #09060d38`, restrained use |

Pattern notes: Admission, verified deposit, contract registration, staff check-in, financial attendance, challenge and payout remain independent. Personal history is a separate panel. Participant status precedes event story. Do not label a receipt as confirmed admission, an open matched case as a global payout freeze, or absent payment history as a successful payout.

### Buttons, inputs and focus

Files: `public/styles.css`, `public/app.js` · Last updated: 28 October 2026

| Property | Token / selector |
| --- | --- |
| Primary | `.button-primary`: `--purple: #A78BFA`, `--on-accent: #17131F` |
| Secondary | `.button-secondary`: transparent/deep surface, meaningful boundary |
| Danger | `--red: #FF8FA3` with tinted surface |
| Geometry | 8px control radius; buttons at least 44px; fields at least 46px |
| Focus | 3px lavender outline, 3px offset; keyboard-visible |
| Disabled | Explicit disabled property and reason in nearby text; server remains authoritative |
| Reduced motion | `prefers-reduced-motion` disables nonessential transitions |

Pattern notes: Tabs use roving tabindex and Arrow/Home/End. The native review dialog adds explicit Tab containment, Escape dismissal and trigger restoration. Async replacement restores stable focus when possible; polite notices announce outcomes. Do not infer permissions from disabled controls.

### Context, reconciliation and review

Files: `public/styles.css`, `public/app.js`, `public/reconciliation.js` · Last updated: 28 October 2026

| Property | Token / selector |
| --- | --- |
| Context | `.event-context`: deep surface, visible boundary, 14px radius |
| Review steps | `.workflow-step`: surface blocks, 8px radius, readable numbered labels |
| Provenance / exceptions | `.notice`, `.source-hash`, `.reconciliation-table` |
| Success / warning / error | `#86D9B4` / `#F0C08A` / `#FF8FA3`; tinted surfaces |
| Table records | Explicit column scope; mobile cells retain column names via `data-label` |
| Dialog | Deep/surface background, 18px radius, safe overflow, clear Cancel and Confirm |

Pattern notes: Select source, inspect all rows and exceptions, review consequences, then apply. Every row stays visible; no silent exclusions or source rewriting. A client preview never authenticates CSV origin or verifies a receipt. Financial registration/attendance still require separate simulated transaction reviews. Source edits, event/wallet changes and stale snapshots invalidate pending review.

### Money and case summaries

Files: `public/styles.css`, `public/app.js` · Last updated: 28 October 2026

| Property | Token / selector |
| --- | --- |
| Money cards | `.money-summary`, `.money-card`: raised surface, 14px radius, technical amounts |
| Case | `.case-summary`, `.case-card`: surface with explicit lifecycle heading |
| Supplemental data | `.details-list`: muted labels, primary values, long identifiers wrap |
| Missing totals | Visible “Unavailable” plus explanation, never estimated from remaining balance |

Pattern notes: Sent, reserved case shares, owed failed transfers and challenge escrow have separate explanations. Total reserves overlap these obligations and must not be added again. Appeal costs and deadlines use the current resolver projection. A jury vote, final resolver result, settled challenge and delivered ETH are separate states. Waiting challenges have no Court IDs.
