# Kleros redesign: brief and observed evidence

Date: 28 October 2026. This is a source and browser evidence handoff, before selecting the detailed redesign. The user already sent the engineering prompt to Codex and now delegates the attached redesign workflow because they have no time to run its checkpoints. A rebuild is authorized; this supplement must fit the active implementation rather than restart it.

## 0. Completed brief

| Item | Working answer |
|---|---|
| Product | Kleros multi-event registration, refundable commitment, verified attendance, Kleros disputes and payout experience, using the three supplied repositories |
| Existing URLs | Source-recorded events.kleros.io; observed working kleros-events.vercel.app; observed Kickback GitHub Pages; observed devcon.kleros.io |
| Users | Attendees on phones; organizers reviewing imports/transactions; door staff; content editors with separate authority |
| Must survive | Current v7 ETH/V1 contract semantics and old-deployment compatibility; held shares during open matched cases; admission distinct from deposit; personal/booth attendance distinct from financial evidence; event isolation; optional marketing consent; existing content/private access and a deliberate migration boundary |
| Better means | Obvious event and next action; fewer unnecessary context changes; legible financial states; prevention of wrong-event actions; mobile usability; accurate accessible status wording |
| Formal rubric | None supplied. Proposed internal priorities: financial correctness, task completion, event isolation, accessibility, then visual polish. Do not present these as Kleros's grading rubric. |
| Deadline/audience | No deadline supplied. User is time-constrained. Deliver to the active Codex session and Kleros technical reviewers. |
| Decision authority | User delegated design preparation. Assistant selects recommended defaults and records them; these are not fabricated human approvals. No production deployment, transaction, signup or migration is authorized by this design exercise. |

## 1. Evidence labels

- OBSERVED (BROWSER): directly inspected in the anonymous public cloud browser this session.
- OBSERVED (SOURCE): directly read in the pinned source snapshot; not proof of deployed behavior.
- OBSERVED (CALCULATED): deterministic calculation using identified source/computed colors.
- ESTIMATE: proposed design, effort, inferred user impact, or behavior requiring implementation/testing.

Source files: source_events_inventory.md and source_finance_inventory.md. The earlier PROJECT_BRAIN.md is the financial/domain reference. Do not claim a full production or accessibility audit.

## 2. Browser evidence

All public captures below used the available viewport **1363 x 936 CSS px**. Exact 1440 x 900 and 400 x 800 live-site viewports were not available through the selected browser API. Do not relabel these captures. The proposed local mockup will be tested in explicitly sized content frames if feasible.

### B1: events home and directory

OBSERVED (BROWSER): https://events.kleros.io/ returned an upstream connection failure. https://kleros-events.vercel.app/ rendered the public Kleros Events app. This does not establish that the custom domain is generally down or that the two hosts are at the same source revision.

OBSERVED (BROWSER): header names Events, Talks, Luma and Sign in; white Kleros logo, italic lavender Events label; dark page; large serif editorial headline; featured event; Coming up cards; talks and archive content. The directory at /events has All/Upcoming/Past, List/Calendar, Search events, Topic and Event type controls and event cards.

OBSERVED (BROWSER): computed body Geist, 17px/400, #E6E1EE on #17131F; home h1 Instrument Serif, 59.2px/400, #F2EEF7; nav labels 15.2px, #A69FB5; primary Luma link #17131F on #A78BFA, 17px/600, height 41.796875px. A secondary link uses #201A2B. Navigation links measured about 40.3125px high. These are measured values at the observed viewport, not universal breakpoints.

Screenshot: events-before-desktop.jpg. Browser log entries inspected were extension metadata errors with chrome-extension:// URLs, not demonstrated application faults. The tool did not expose a complete request-failure log. No authenticated views were opened.

### B2: Truth Pays event detail

OBSERVED (BROWSER): https://kleros-events.vercel.app/events/ground-truth-mumbai renders the event title, 4 Nov 2026, 18:00 GMT+5:30, Hitchki (BKC), Mumbai. Primary action is RSVP on Luma, pointing to https://luma.com/qewnqhas. Sections include About, Ask the speaker and Meet Kleros. A sign-in-to-save link and Add to calendar are present. The anonymous page does not expose an integrated deposit or settlement panel.

OBSERVED (BROWSER): Ask the speaker has Your question, Your name, Ask, Top/Newest and Ask from your phone. These forms were not submitted. Public event copy says attendance is free and hosts approve registrations; the separate Kickback flow explains optional committed spots. Do not remove the free route or treat sending ETH as host approval.

### B3: deposit page

OBSERVED (BROWSER): https://weiwei-ooi.github.io/devcon-side-event-kickback/ renders a light, centered 600px column. Title is Bricolage Grotesque 36.8px/700; body IBM Plex Sans 15px; body #141B2B on #F3F5F9. Primary Connect wallet button is #FFFFFF on #1F5FD6, 15.2px/600, height 42px. Amber Ethereum-mainnet/ETH-only guidance precedes the contract and five numbered stages.

OBSERVED (BROWSER): stages are Connect wallet, Switch network, Check balance, Send exactly 0.01 ETH, and return to Luma. The browser has no wallet; subsequent financial controls were disabled. This is a real observed disconnected state, not evidence that connected, pending or successful states work.

OBSERVED (BROWSER): a full contract address, Copy, View on Etherscan, contract checks and current-read statistics were visible. No wallet was connected, no payment was attempted, no address was copied for use, and no financial action occurred. Screenshot: kickback-before-desktop.jpg.

### B4: status route

OBSERVED (BROWSER): direct navigation to https://weiwei-ooi.github.io/devcon-side-event-kickback/#status renders Check a deposit, Check, a wallet-address field, and Missed at check-in? Challenge it on Kleros. The hash controls page mode; it is not necessarily an element id. An earlier click did not immediately change observed state, but direct navigation succeeded, so do not report this as a proven broken link.

OBSERVED (BROWSER): lookup-addr has type=text, placeholder='0x… wallet address', no aria-label and no aria-labelledby. A visible/programmatic label should be verified in surrounding markup before declaring a specific WCAG failure; give the redesigned field an explicit visible label.

OBSERVED (BROWSER): challenge guidance describes the one-day challenge and matching windows, juror review, appeals and reserved shares while other guests are paid. The displayed fee is a live-read snapshot, not a fixed future price. No lookup or dispute transaction was submitted. Screenshot: status-before-desktop.jpg (upper common contract/wallet area; not a full-page capture).

### B5: booth visitor page

OBSERVED (BROWSER): https://devcon.kleros.io/ renders a centered narrow form over purple gradients, a Kleros wordmark/symbol, Urbanist 44px display title, Inter 16px body, teal/purple/gold merch tiers, profile/interests fields and an unchecked optional newsletter checkbox. Computed body background is #0F0A2E; text #F7F3FF. Inputs measured 52px high. The title uses transparent text with a clipped gradient, so its contrast cannot be computed from text color alone.

OBSERVED (BROWSER): controls include Your name, Company or project, Your role, Job level, Email, Telegram handle, LinkedIn, X handle, interest checkboxes, newsletter consent, Check in and How your details are used. No personal data was entered or submitted. Screenshot: booth-before-desktop.jpg.

## 3. Source facts that affect design

OBSERVED (SOURCE): the financial source already distinguishes payment from admission, personal check-in evidence from final financial eligibility, matched disputes from final rulings, ordinary payouts from reserved shares, and failed-transfer claims from batch payouts. Some shorthand labels such as Paid out describe a phase that can still contain open reserved cases. See PROJECT_BRAIN.md and source_finance_inventory.md.

OBSERVED (SOURCE): no multi-event financial navigation exists in Kickback; event selection is configuration-driven. Existing output JSON has partial deployment stamps, but intermediate/raw CSV provenance is incomplete. The proposed registry, contextual event selector and guarded review screens are new product work.

OBSERVED (SOURCE): the current Events CSS uses Instrument Serif + Geist + Geist Mono and the tokens below; its 1180px container, 14px cards and 8px controls provide a concrete visual precedent. Original Kleros SVG files are available. Exact fonts were retrieved from the live site's observed @font-face URLs for offline use; retain their SIL OFL license files. Do not claim ownership of the Kleros logo or invent an official brand guideline.

## 4. Contrast calculations

OBSERVED (CALCULATED): use the WCAG sRGB relative-luminance formula with the 0.04045 breakpoint and (lighter+0.05)/(darker+0.05). Pass/fail uses unrounded ratios; display rounding is informational. Raw calculations are in contrast-calculations.json.

| Pair | Ratio | Normal AA / AAA |
|---|---:|---|
| Events #E6E1EE / #17131F | 14.24:1 | Pass / Pass |
| Events muted #A69FB5 / #201A2B | 6.63:1 | Pass / Fail |
| Events button #17131F / #A78BFA | 6.71:1 | Pass / Fail |
| Events title #F2EEF7 / #17131F | 15.96:1 | Pass / Pass |
| Guest button #FFFFFF / #1F5FD6 | 5.73:1 | Pass / Fail |
| Console button #FFFFFF / #9747FF, source-only | 4.5053:1 | Pass / Fail |

The console button is explicitly white in CSS, not inherited #F3ECFF. It narrowly passes normal-text AA; do not falsely label it a contrast failure. Proposed input boundary #81788F against #201A2B is 4.03:1, meeting the 3:1 non-text target when that boundary is necessary. That gray is not a small-text color.

Normal text: AA 4.5:1, AAA 7:1. Large text: AA 3:1, AAA 4.5:1; large is at least 24 CSS px regular or about 18.67px bold. Meaningful non-text UI cues: AA 3:1. A 44px primary target is a proposed usability target; WCAG 2.2 AA minimum is 24x24 CSS px with specified exceptions. Passing selected pairs is not full WCAG conformance. Gradients, transparency, disabled states, focus, private views and all state combinations require separate assessment.

Sources: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html ; https://www.w3.org/WAI/WCAG22/Understanding/contrast-enhanced.html ; https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html ; https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html .

## 5. What a fresh reviewer should do

Rank 3-5 concrete UX problems for the multi-event financial journey. Ground each in a named component/source fact/measurement. State what already works. Do not invent mobile or signed-in observations, conversion metrics, user research, new financial guarantees, or a failing contrast pair. Distinguish an existing single-event scope limitation from a defect. Identify the proposed directions as ESTIMATE and preserve the product rules above.

Unverified: live mobile layout, live 1440px layout, hover behavior, full keyboard/screen-reader flow, authenticated organizer/private views, wallet-provider dialogs, real deposits, importing real guests, backend errors, all asynchronous case/payment states, and deployment/source parity.


## Saved capture dimensions

The reported browser viewport was 1363 × 936 CSS pixels. The four saved JPEG artifacts are 1348 × 926 image pixels, as measured from their encoded files. Neither should be relabeled as a requested 1440 × 900 or 400 × 800 browser check.
