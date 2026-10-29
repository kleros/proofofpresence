# Kleros Events redesign handoff

Prepared 28 October 2026. This is a continuation brief for the Codex implementation already underway. Read it alongside the original `PROJECT_BRAIN.md` and engineering prompt; preserve completed work and reconcile this design with the current branch. The user delegated the preparation and design choices and permits a rebuild when simpler. The selections below are assistant-selected defaults under that delegation, not recorded human approvals.

## 1. Completed brief and selected direction

**DESIGN DECISION:** Connect public discovery, optional commitment, admission, attendance review and settlement through a persistent event context. Attendees need a clear next action; organizers need reviewable evidence and consequences; door staff need scoped attendance tools. Content editors retain their separate permissions. Keep the existing Events visual identity and free attendance route.

Success means users can identify their event, distinguish payment from admission, understand what remains unresolved and recover from errors. Financial correctness, event isolation, task completion, accessibility and visual consistency are proposed internal priorities. No Kleros grading rubric, delivery date or measured conversion target was supplied.

Choose **B in each of the four groups in `DESIGN_OPTIONS.html`**:

| Area | Selected B concept | Implementation intent |
|---|---|---|
| Discovery and context | An event that stays with you | Preserve public browsing; carry event identity into every consequential task. |
| Commitment and status | Your state, without ambiguity | Present independent states with one eligible next action. |
| Import and review | Reconcile inside the event | Combine a guided review gate, exception table and consequence preview. |
| Payouts and disputes | An obligations view | Show transferred, reserved and owed money together, with case and claim actions. |

These A/B/C letters describe extent of change. They are not the lettered concept families in `FRESH_CRITIQUE.md`. Retain that critique’s public directory entry, participant state summary, guided import review and money-and-obligations summary. The B import concept is substantial product work, not a styling adjustment.

## 2. What the evidence establishes

**OBSERVED — BROWSER:** The canonical `events.kleros.io` request failed in the inspection session; the recorded `kleros-events.vercel.app` deployment rendered. This does not establish a global outage or parity between deployments. The public directory, one event detail, disconnected commitment/status pages and booth form were inspected at **1363 × 936 reported CSS pixels only (saved JPEGs: 1348 × 926 image pixels)**. No registration, wallet transaction, dispute, subscription or guest record was submitted. Connected wallet and authenticated organizer behavior were not observed.

**OBSERVED — SOURCE:** The Events app already has multi-event content, search/filter/calendar capabilities, talks, materials, Q&A and access controls. Kickback already implements native ETH and Kleros V1 disputes. Personal attendance and booth progression are separate from financial attendance. The original brain contains pinned source references and the detailed financial baseline; this document does not replace that audit.

**OBSERVED — CALCULATED:** Selected contrast pairs are approximately 14.24:1 for `#E6E1EE` on `#17131F`, 6.63:1 for `#A69FB5` on `#201A2B`, and 6.71:1 for `#17131F` on `#A78BFA`. The proposed `#81788F` boundary on `#201A2B` is about 4.03:1 for meaningful non-text boundaries. These calculations do not establish whole-product accessibility. The existing white-on-`#9747FF` console pair narrowly passes normal-text AA at 4.5053:1; do not report it as a confirmed failure.

**ESTIMATE / DESIGN PROPOSAL:** Benefits, effort, new layouts and target sizes are design judgments. No usability study, production analytics or measured task-time improvement supports a quantified benefit.

## 3. Visual specification

Use `design-tokens.json` as the portable token inventory. Its proposed values are implemented in the prototype; provenance distinguishes existing visual precedent from new choices.

| Token | Exact value | Token | Exact value |
|---|---|---|---|
| background | `#17131F` | deep | `#120F19` |
| surface | `#201A2B` | raised | `#2A2336` |
| decorativeBorder | `#352D44` | controlBoundary | `#81788F` |
| text | `#E6E1EE` | heading | `#F2EEF7` |
| muted | `#A69FB5` | accent | `#A78BFA` |
| onAccent | `#17131F` | success | `#86D9B4` |
| warning | `#F0C08A` | danger | `#FF8FA3` |

Use **Instrument Serif** for display headings, **Geist** for interface/body text, and **Geist Mono** for addresses, identifiers and technical amounts. Both HTML documents embed the exact retrieved WOFF2 files and complete supplied SIL Open Font License notices. The binaries are `geist-latin.woff2`, `instrument-serif-regular.woff2`, `instrument-serif-italic.woff2` and `geist-mono-latin.woff2`. File hashes and observed live asset URLs are recorded in `assets/FONT_PROVENANCE.json`; keep those notices when moving fonts into production assets. Preserve the original `kleros-logo.svg` and `kleros-symbol.svg` unchanged. This is observed product styling, not a newly supplied official brand guide or permission claim.

Body is 16px/1.6, controls 14px, metadata 13px. The prototype uses smaller supplementary eyebrows, so never place required instructions solely in that treatment. Display headings scale up to 60px; mobile hero text is 46px and the detail heading reduces to 38px. Use spacing steps 4/8/12/16/24/32/48/64px, card radius 14px and control radius 8px. Main content is at most 1180px, with 16px side gutters. The participant column is 350px on wide layouts. Lavender buttons use dark text; muted text must remain readable. Decorative borders are not the sole indication of an interactive field.

## 4. Screen and component mapping

Treat the prototype as a state and composition reference, not an application to deploy unchanged.

| Prototype surface | Production components and data boundary |
|---|---|
| Discover | Existing directory, filters, list/calendar and event cards; canonical event metadata adapter. Preserve controls absent from the small mock. |
| Event detail | Event context header, story/agenda/content and participant panel; metadata plus independent admission, commitment and eligibility projections. |
| My events | Event-scoped participation summaries and pending actions; authenticated personal records, without promoting saved/self-reported history into evidence. |
| Organizer overview | Deployment identity, role explanation and next actions; server permissions plus financial adapter capabilities. |
| Guest imports | Source record, event binding, reconciliation exceptions, exclusion reasons and effect preview; authenticated import service and deposit verification. |
| Check-in and Attendance | Staff observations followed by a separate owner-reviewed proposal; scoped observation service and authoritative financial permissions. |
| Payouts and cases | Transferred/reserved/owed totals, open cases and recoveries; versioned contract/resolver reads and receipt-aware transactions. |
| Case detail | Challenge/matching state, finality, evidence, appeals and settlement; correct resolver-local and Court identifiers. |

Reusable components should include `EventContext`, `DeploymentIdentity`, `ParticipantStatus`, `NextAction`, `StateNotice`, `MoneySummary`, `ReviewDialog`, `ImportProvenance`, `ExceptionTable` and `CaseSummary`. Names are suggestions, not a required rewrite of existing components.

The prototype’s import screen demonstrates gates and synthetic fixtures; it does **not** implement the selected concept’s complete reconciliation table. Its participant scenarios illustrate branches rather than a complete normalized production model. Implement separate admission, receipt, contract-registration, personal/staff attendance and financial-eligibility fields. The discovery hero and example deadlines/fees/balances are fixtures; replace them with verified projections or honest empty/loading states.

The UI must consume adapters rather than recreate financial rules in component conditionals. Public Luma metadata is not authenticated guest or wallet evidence. Bind plans to stable event ID, chain ID, contract, version, policy and source provenance. Reject proven event mismatches; an acknowledgment cannot override one. Unidentified CSV requires an auditable provenance review plus actual identity/deposit reconciliation. Revalidate plans after event, wallet, network or source-state changes and immediately before signing. Preserve pending transaction references across navigation.

## 5. Financial, authority and privacy requirements

Preserve legacy **v7 native ETH / Kleros V1** behavior through versioned adapters. Existing direct deployments and historical policy remain compatible. This redesign does not authorize a switch to generic Escrow, ERC-20 deposits, V2 callbacks or changed payout economics.

A confirmed receipt does not prove admission or contract registration. Host approval, content access, staff authority and contract-owner authority are distinct. The same person or wallet may participate in multiple events without shared funds, eligibility or permissions. Saving an event, “I was there,” a booth QR scan or merchandise handover cannot authorize a payout.

An ordinary payout batch can finish while matched cases retain held shares. Preserve the existing share/redistribution algorithm, final resolver checks, direct contributor-to-resolver appeals, failed-transfer owed claims, alternate claim recipients and rounding treatment. A jury vote is not necessarily final; a final ruling is not a successful settlement receipt. Cancellation refunds registered stakers under the existing rules; do not promise every unregistered payer an automatic refund. Include the source-defined no-list recovery path even though the prototype does not fully demonstrate it.

Keep private-event access enforced by the backend/database, including materials and retrieval paths. Import tables expose only necessary identity data to authorized staff. Preserve optional newsletter consent, subscription confirmation, merch eligibility and handover as separate records. Do not carry synthetic demo subscriptions into live queues. Evidence publication requires a clear review because public content can be persistent; do not upload real attendee information from a design demo.

Continue in local/mock development. A blank endpoint alone is insufficient isolation where queued Ghost/Telegram-related work survives; namespace or disable all demo queues and outbound adapters. Existing rehearsal configuration can involve real ETH. Production actions remain governed by the original engineering handoff and current user authorization.

## 6. Responsive, keyboard and state copy

At 900px and below, stack the two-column layouts and convert four metrics to two columns. At 600px and below, wrap navigation, make event selection full-width, stack the hero, put participant status before the event story, reduce card padding from 24px to 20px, and convert review tables to labeled records. Retain all information and actions; do not solve overflow by hiding financial identity or consent. Wrap long addresses and test with enlarged text.

Primary interactive targets have a proposed minimum 44px height; inputs are at least 46px. The 44px target is a usability choice, not a statement that WCAG AA always requires it. Use the implemented 3px focus outline with 3px offset, visible labels, a skip link and announced asynchronous status. Tabs support arrow keys plus Home/End. Dialogs require sensible initial focus, Tab containment, Escape dismissal where safe, and focus restoration. Real asynchronous updates must preserve focus and announce changed outcomes without repeatedly interrupting users. Respect reduced-motion preferences.

| State or phrase | Required meaning |
|---|---|
| Admission pending / approved | Host decision only; explain any remaining financial registration step. |
| Deposit submitted / received | Pending transaction versus verified receipt; retain its reference and prevent accidental duplicate payment. |
| Staff check-in recorded | Event-scoped observation; financial attendance remains separately determined. |
| Challenge waiting for a match | No Court case until matched; show the separate, verified matching deadline. |
| Attendance accepted | State why it is accepted; expired unmatched settlement differs from a final matched ruling. |
| Ordinary batch processed | Some transfers completed; reserved shares and owed claims remain visible. |
| Share reserved | Held funds for an unresolved matched case, not money already paid. |
| Final result available | Resolver finality verified; settlement and payment may still be outstanding. |
| Payment still owed | Failed transfer remains claimable by the entitled wallet; explain recipient recovery. |
| Status unavailable | Current state could not be verified; pause dependent financial actions and offer retry. |

Separate user rejection, pending receipt, confirmed revert and read failure in production, even where one mock scenario groups them. Use specific action labels such as “Review attendance transaction” and “Review owed-ETH claim.” Avoid a global “settled,” “all refunded” or “paid out” badge while obligations remain.

## 7. Implementation sequence and scope

**ESTIMATES:** S/M/L express relative implementation and validation effort, not hours, dates or cost promises. Reassess against the active branch.

1. **Reconcile and retain — S/M.** Inspect current Codex work; identify reusable components and adapters, merge tokens, and record design decisions without restarting completed engineering.
2. **Event identity and shell — M.** Integrate directory/detail navigation, persistent context, role presentation and safe event switching. Preserve existing discovery/content capabilities.
3. **Participant states — M/L.** Map independent projections, transaction recovery and the next-action panel to the real adapter; implement unavailable and stale-data treatment.
4. **Guided reconciliation — L.** Add provenance, identity/deposit matching, exceptions, exclusions, consequence review and transaction simulation. Verify authority beyond disabled buttons.
5. **Settlement and cases — M/L.** Integrate the three money totals, open-case branches, finality, failed-transfer claims and no-list/cancellation recovery with existing financial tests.
6. **Responsive and interaction validation — M.** Test the integrated product in real browsers, keyboard and assistive-technology flows; add focused regression coverage for consequential transitions.

A cleaner unified application remains allowed if it reduces total complexity and preserves a credible migration path. Retain event/talk/material/Q&A content, private access, historical links, free participation and original financial contracts. If booth operations remain separate initially, document that boundary. Do not expand this redesign into a mandatory merch, newsletter, research or portfolio-workbench rebuild. Preserve existing public QR destinations and consent records if a later migration includes them.

## 8. Review packet, provenance and validation limits

Review `DESIGN_OPTIONS.html` first, then exercise `KLEROS_REDESIGN_PROTOTYPE.html` across both synthetic events, roles and participant scenarios. Use `design-tokens.json` for implementation and `PROJECT_BRAIN_DESIGN_ADDENDUM.md` for persistent project context. Review controls and simulated transitions are demonstration utilities; they must not ship as production authority.

Supporting evidence is packaged in `evidence/DESIGN_EVIDENCE.md`, `evidence/FRESH_CRITIQUE.md`, `evidence/contrast-calculations.json` and `assets/FONT_PROVENANCE.json`. The assets come from the inspected Events source at commit `fa732b8ea20e57648516b6e46e1076c0bf2ab434` and recorded live font URLs. The original project brain holds the repository audit citations. Recheck source references against the current branch before implementation.

**OBSERVED — VALIDATION:** 49 DOM-emulator checks passed with zero network attempts. This supports the exercised synthetic logic and offline boundaries; it is not real-browser, screen-reader, wallet or production testing. The cloud browser refused local-file access and no workaround was used. A browser QA script has been prepared but not run. Static document renders/PDF previews are a separate review aid, never browser screenshots. The package includes seven static proposal excerpts and an eight-page visual summary. All eight final PDF pages were rendered and visually inspected. `previews/render-report.json` records the static artboard widths; `QA_REPORT.md` records export adaptations and remaining browser checks.

Real-browser acceptance must still cover desktop/mobile layouts, overflow, zoom, keyboard/focus, announcements, role and event changes, stale reviews, wallet rejection/receipts and unresolved obligations. Completion requires functioning adapters and meaningful authorization/financial regression checks, not visual similarity alone.
