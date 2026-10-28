# Simpler event workflow

The user requested a simpler interface and preparation for the new v8 contract, followed by a testnet
rehearsal from deposit through dispute and kickback. The existing visual brand and authoritative
financial interfaces are retained.

## Everyday screens

- The directory explains three steps: choose an event, reserve a place, attend and receive a kickback.
- “Your spot” shows a four-step journey and one primary next action with its reason. A confirmed
  receipt stays separate from host approval and contract registration; staff check-in stays separate
  from financial attendance. Only successful canonical attendance payments complete the kickback step.
- Seven source-labeled status facts are available under “All status details”. The event and network
  remain visible; technical deployment/policy/block details start collapsed. Transaction confirmation
  always expands exact amounts, signing wallet, recipient, chain, event and policy.
- “Manage event” retains guest admission, trusted check-in, reviewed source imports, registration and
  attendance publication. “Disputes & kickbacks” retains matching, evidence/appeals, finality, payout
  reserves, settlement and actual payment logs.
- The sidebar shows the identity/wallet and a small event summary. Advanced links and duplicate technical
  records are disclosed on demand. Native keyboard behavior, reduced motion and mobile layout remain.

## Contract and environment behavior

Version dispatch is explicit: `truth-pays-v7` and `kleros-event-v8`. v8 receives its unused-credit
amount from the backend's participant `pendingCreditWei`, and prepares `withdrawPending` with exact
`{to, amountWei}`. Independent credit is separate from admitted principal. No credit or financial
success is inferred from an address label or UI state. Historical v7 tools are hidden for v8.

`testnet` / `hosted-testnet` presentation uses a connected wallet, public-testnet notice and the
backend's chain name, ID and native-currency symbol. It does not expose demo identities, faucet,
clock advancement, mock Court ruling controls or historical guest/console links. Signing is still
preceded by nonce proof and exact reviewed transactions; sandbox1337 retains its instance guard.

This presentation support does not itself establish a public testnet deployment or prove that a
particular arbitrator, policy or provider is configured. Those checks belong to the testnet deployment
record and backend validation. Shared hosted-demo state remains synthetic, uses valueless ETH/mock
Court, and resets on backend restart.

## Verification

`test/simple-ui.e2e.mjs` runs a fresh isolated real-contract browser flow. It checks progressive
presentation, exact expanded transaction review, a real deposit that does not imply admission,
independent event state, mobile bounds and (for v8) actual unused-credit withdrawal. Its final public-
testnet presentation fixture performs no API mutations or external requests and is labeled as such.
Run both versions with:

```sh
node test/simple-ui.e2e.mjs
CONTRACT_VERSION=kleros-event-v8 node test/simple-ui.e2e.mjs
```

Existing lifecycle, redesign, session-context and signing-safety regressions remain applicable. Actual
commands and results are reported by the main integration owner in TEST_REPORT. Visual patterns were
captured using the imprint skill in the root `ui-registry.md`.

Executed for this change on 28 October 2026:

| Check                            | Result                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------- |
| Root typecheck                   | Passed                                                                        |
| Existing lifecycle browser suite | 39 assertions passed                                                          |
| Existing redesign browser suite  | 49 assertions passed                                                          |
| Wallet/signing safety            | 16 assertions passed; no wallet broadcast                                     |
| Event-response/session context   | 4 assertions passed                                                           |
| Focused simplified v7 flow       | 13 checks plus Playwright expectations passed                                 |
| Focused simplified v8 flow       | 18 checks plus Playwright expectations passed; real pending-credit withdrawal |

Logs are `artifacts/simple-ui-{lifecycle,regression,safety,context,v7,v8}.log`. Desktop/mobile screenshots
are under `artifacts/screenshots/simple-ui/`; final v7 screenshots were visually inspected. The
public-testnet portion remains a non-mutating presentation fixture, not public-chain execution.
