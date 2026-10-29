# Continue the Kleros project with this selected redesign

This is a follow-up to the Kleros implementation prompt and `PROJECT_BRAIN.md` I already sent. Continue the current task and branch. First inspect your working tree and current implementation so you preserve completed work. Do not restart the project, delete useful work, or trigger another architecture rewrite just because this design package is new. A rebuild remains allowed where the earlier engineering audit justifies it; record the reason and migration boundary.

I have delegated the redesign choices. The attached package completes the design workflow for you: evidence, independent critique, three options per priority, chosen direction, prototype, tokens, and verification notes. Treat the selections as implementation defaults. Do not ask me to select A/B/C or repeat the design exercise. Resolve routine details using the existing project and this handoff.

## Read these first

1. The original `PROJECT_BRAIN.md`, then `PROJECT_BRAIN_DESIGN_ADDENDUM.md`.
2. `REDESIGN_HANDOFF.md`, including prototype simplifications and acceptance criteria.
3. `KLEROS_REDESIGN_PROTOTYPE.html` and `design-tokens.json`.
4. `DESIGN_OPTIONS.html` for the selected B treatments and tradeoffs.
5. `QA_REPORT.md` and `qa/README.md` before interpreting any verification claim.

The files under `evidence/` and `assets/` provide the source inventory, fresh critique, observed screenshots, contrast calculations, actual font binaries, and provenance. The PDF is a concise review aid; the handoff and project brain are the implementation references.

## Selected product direction

Build one coherent, event-specific journey within the existing Kleros Events visual family. Use the prepared Option B for each of the four priorities:

- **Persistent event context:** public discovery and event details stay public; event identity, network, trusted deployment, and relevant deadlines stay visible on financial and organizer screens. Switch events without carrying over an unapproved import, transaction draft, or stale authorization. Preserve event-scoped personal history separately.
- **Participant status and next action:** show admission, deposit receipt, contract registration, staff check-in, financial attendance, dispute, and payout as distinct facts. Give the person one clear next action. Keep a free registration route without requiring a wallet. A deposit receipt alone must never appear as confirmed admission.
- **Organizer reconciliation:** guide the owner through source selection, provenance and receipt reconciliation, an exception table, a reviewable plan, and explicit transaction approval. Hard-block proven event mismatches, reused receipts, and stale plans. An unidentified raw export needs provenance review; a hash alone does not prove event origin. Staff may record event-scoped observations, not silently approve financial eligibility.
- **Payouts and cases:** display sent, reserved, owed, and challenge/appeal funds separately. Keep case details and finality visible. An open matched case does not imply that all ordinary attendee payments are frozen.

Use the actual Kleros logo and supplied Instrument Serif, Geist, and Geist Mono assets. Use the selected dark plum/lavender tokens, readable status text, visible focus rings, and labels that do not depend on color. Use the existing app's component and route conventions. Preserve talks, recordings, Q&A, private-event access, editorial tools, and meaningful public navigation; the smaller prototype navigation is not an instruction to remove them.

## Financial and data boundaries

The original project brain and audited contract version are authoritative for financial behavior. A screenshot or prototype amount never overrides them.

- Preserve legacy v7 ETH deployments and Kleros V1 resolver behavior through versioned adapters. Do not silently migrate an immutable deployment or substitute a generic escrow flow.
- Keep the one-day omission challenge and each challenge's separate matching period. Display verified on-chain deadlines and freshness; do not hardcode the illustrative prototype clock or arbitration fee.
- Expired unmatched challenges and matched Court cases are different states. An interim jury vote is not a final resolver ruling. Keep resolver-local IDs separate from court case IDs.
- For the audited v7 settlement, initial ordinary payouts can proceed while a full share is held for each open matched case. An attended winner gets its held share; an absent/refused attendance result redistributes it under the contract rules. Ruling 0's remaining challenge-fund split must not be described as an attendance payout.
- Handle failed-transfer owed balances, authorized alternate receiving addresses, registered-staker cancellation refunds, and separate handling of unregistered payer returns.
- Never treat self-reported "I was there," newsletter consent, booth collection, or an unverified Luma row as financial attendance. Preserve private data and server-side/RLS authorization. Financial actions require current wallet and contract validation, not just hidden or disabled controls.

## Implement the design, not the demo simulator

The HTML is a self-contained interaction reference with synthetic participants and funds. Its role selector, scenario selector, fixture controls, fake receipts, in-memory state, and simulation handlers are review tools. They are not production identity, persistence, eligibility, or settlement logic. Keep fixtures in an explicitly isolated demo/test path if useful; never present them as a live deployment. Build real components against the project's existing services/adapters and verified interfaces.

The prototype intentionally simplifies the reconciliation table, full staff workflow, admission/contract registration distinctions, evidence publication, and appeal funding. Implement the complete requirements from the handoff and original brain, rather than limiting production to the mockup's screen depth. Respect actual Luma access and API capabilities; retain the documented import/manual route when credentials or supported features are unavailable.

Proceed in coherent increments: shared tokens and event context; participant flow; organizer reconciliation; payouts/cases; responsive and accessibility polish. Map these into the current code before changing it. Use explicit loading, empty, unavailable, permission-denied, wrong-network, pending, confirmed, and failed states. Keep async work scoped to the current event and reject stale responses.

## Verify and finish

The package's 49 DOM-emulator checks passed with zero network attempts. The prototype has not been checked in a real browser here. The PDF's new visuals are static document renders. Do not claim these prove production behavior, mobile layout, keyboard accessibility, or contract correctness.

In your authorized development environment, run the prepared browser checks, inspect the prototype and implemented app at **1440×900 and 400×800**, and fix any issues. Follow your own browser/tool policies. The provided browser script is for that environment and must not be used to bypass an access restriction. Verify overflow, typography, focus order and modal containment, event switching, every scenario, disabled actions, keyboard tabs, and console/network errors. Check 44px primary targets as a design requirement; do not confuse that with a blanket WCAG AA rule. Add or reuse meaningful app integration and financial-invariant tests where needed.

Recheck relevant permissions, private routes, imports, transaction receipts, and dispute transitions against real adapters/test doubles. Distinguish tested behavior, source-reviewed behavior, and remaining environment limitations. Do not fabricate credentials, deployed addresses, successful transactions, or screenshots.

Continue through implementation and validation, not only a new plan. Update project memory, decisions, and implementation status as you go. At completion, report what changed, what was tested, any concrete blockers, and how to run the demo. Do not publish, push to a protected branch, migrate production, send messages, or move real funds unless separately authorized.
