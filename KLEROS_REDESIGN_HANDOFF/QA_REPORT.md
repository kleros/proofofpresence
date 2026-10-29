# Redesign verification report

Prepared 28 October 2026. This report separates directly observed behavior, source inspection, executed non-browser checks, and work still requiring a browser.

## Evidence and execution

| Area | What actually happened | Limit |
| --- | --- | --- |
| Public existing sites | Events on its public Vercel deployment, Kickback guest/status pages, and booth page were inspected in the available browser. Public screenshots are included. | Reported browser viewport was 1363×936 CSS pixels; saved JPEGs are 1348×926 image pixels. Neither is the requested 1440×900 or 400×800 browser verification. No signed-in organizer flow, wallet, or financial action was exercised. |
| Canonical Events domain | An upstream connection error was observed for `events.kleros.io`; the public Vercel deployment worked. | This one observation does not establish a general outage. |
| Repository review | The three repositories and their styles/behavior were reviewed at pinned commits documented in the evidence and original brain. | Source behavior is not proof of which production migrations, settings, or deployments are active. |
| Independent critique | A fresh reviewer received the evidence handoff without the earlier conversation and wrote the included critique. | Recommendations remain design judgments; no user research or measured conversion study was performed. |
| Option comparison | Twelve concrete alternatives were produced: A/B/C for four priorities. The prepared B option was selected in each group under the user's delegation. | Choices are delegated defaults, not fabricated feedback from Kleros or a user-testing panel. |
| Prototype logic | `qa/dom-check.mjs` ran with jsdom 26.1.0: **49 passed, 0 failed, 0 network attempts**. Raw results are in `qa/dom-results.json`. | DOM emulation does not render layout, validate real focus behavior in browsers, or exercise wallets, RPCs, databases, or contracts. |
| Browser script | `qa/browser-check.mjs` was prepared and syntax-checked for Codex's authorized environment. | **Not executed here.** No Playwright result or screenshot is claimed. |
| Static previews | Initialized DOM states were rendered as documents at 1440px and 400px artboard widths using WeasyPrint 66.0, then inspected visually. | These are static document renders, not browser screenshots. The export resolves viewport type sizes, substitutes static presentation for native controls, and normalizes timeline layout. This cannot prove mobile/browser compatibility. |
| Review PDF | All eight final PDF pages were rendered and read at full size; no page-boundary text overflow was found. | Visual review applies to this PDF, not to a browser rendering of the app. |
| Contrast | Seventeen opaque foreground/background pairs were calculated using WCAG relative luminance. Raw precision and thresholds are in `evidence/contrast-calculations.json`. | Pair calculations do not establish complete WCAG conformance; gradients, opacity, all interactive states, semantics, and assistive technology behavior need separate checks. |

## Prototype coverage

The executed checks cover both event identities; search and recovery; free participation without a wallet; wallet/network prerequisites; explicit deposit review; receipt versus admission; all 19 participant scenarios; unmatched expiry versus a matched case; absent and refused outcomes; owed-ETH address review; organizer ownership scoped to each event; blocking a proven wrong-event import; provenance review for an unidentified source; clearing transaction/import drafts when switching events; staff observations without changing financial status; attendance review; funds reserved for an open case; keyboard tab-selection logic; and Escape restoring a modal trigger in the DOM emulator.

The financial review found and corrected three prototype issues before the final executed checks: Event B's owner now has its own check-in permission; absent/refused outcomes explicitly show zero attendance payout; and opening an unresolved case resets any prior illustrative final outcome. The unmatched challenge view has no Court case ID before matching.

The prototype models 19 distinct scenarios: choose participation, disconnected wallet, wrong network, ready to deposit, pending transaction, deposit received/admission pending, confirmed registration, staff check-in, accepted unmatched challenge, omitted attendance, unmatched challenge, matched case, appeal still open, payout sent, transfer owed, cancellation, failed transaction, loading, and unavailable status.

## Contrast findings

The existing opaque text pairs checked here passed AA for ordinary text. In particular, the console's actual white text on `#9747FF` is **4.5053:1**, a narrow pass; do not report it as a failure by substituting a different foreground. The existing Events body pair is 14.2420:1, muted text on surface is 6.6298:1, and its primary-button pair is 6.7138:1.

The selected success and warning text both exceed 9:1 on the raised surface. Danger text on that surface is 6.9748:1, so it passes AA but does not reach the 7:1 AAA ordinary-text threshold. The selected control boundary is 4.0325:1 on the surface and 3.6036:1 on the raised surface; it is a boundary color, not a normal-text color.

Reference criteria: [WCAG contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [enhanced contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-enhanced.html), [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html), and [target size minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html). A 44px primary target is this redesign's chosen standard. WCAG 2.2 AA target-size minimum is 24 CSS pixels with specified exceptions; these are different claims.

## Remaining browser and integration checks

The supplied browser environment rejected a local-file preview. That boundary was respected. No alternate browser, tunnel, or public hosting was used to bypass it. The remaining checks are provided for the active Codex implementation in its authorized development environment:

1. Run the prepared browser checks at 1440×900 and 400×800. Inspect every captured screen at full size; verify labels, row heights, wrapping, button bounds, horizontal overflow, reduced motion, focus outlines, tab order, modal containment, and browser logs. A script pass does not replace a visual review.
2. Review the actual application with authentic route/navigation structure. Verify retained private-event access, content, Luma links, staff permissions, and free participation. The prototype deliberately covers only the priority workflow.
3. Verify real event-scoped data and race conditions: switching events during imports or RPC reads, reused deposit references, duplicate payments, stale plans, owner/network mismatch, transaction replacements/failures, and invalid receiving addresses.
4. Exercise financial invariants against the implemented adapter and contract tests. The prototype's calculations and state controls are illustrative; no smart-contract tests were executed as part of this design preparation.
5. Verify evidence privacy/consent/publication, Court/resolver finality and ID mapping, appeal funding attribution, transfer retries, and cancellation handling using the original project brain.

No real wallet was connected, no guest record submitted, no production database changed, no transaction signed, and no source repository modified in preparing this package.
