# Focused deposit-page audit — 31 October 2026

Audited the deposit presentation against the simple deposit, admission,
receipt and kickback journey.
This is a presentation audit, not a new contract security or production-flow audit.

Findings addressed:

- The separate three-step explanation and three-step timeline repeated the same
  journey. They are now one three-step section with countdowns and the kickback
  illustration beneath it. No essential eligibility information was removed.
- The QR/address alternative competed with the primary wallet action. It is now
  an accessible native disclosure. Its exact address/QR pins remain checked, and
  the entire alternative hides after an existing completed payment. Contract and
  rules links remain visible. Prior-event recovery remains available separately.
- BFCache page restoration could retain a disposed mount and frozen countdown.
  Persisted pagehide events now retain the mount; ordinary navigation disposes it.
- Refund opening was described as a passed deadline. It now identifies recovery
  opening rather than suggesting that refunds have expired.
- Saved/stale status was qualified only in supporting notes. The principal
  countdown/admission labels now explicitly qualify saved state, including a
  snapshot that ages beyond 60 seconds. Fixed event times do not become stale just
  because the optional status projection is old.
- Cancelled event rows could display Paid as active registration. The admission
  card now directs guests to check refund/recovery without claiming delivery.

Verification of this revision:

- 11 focused Node checks passed (including saved receipt/reference regressions).
- 29 focused browser presentation checks passed. Added coverage for collapsed QR,
  single three-step journey, stale primary labels and BFCache-preserved rendering.
- Actual product wallet controller returning-guest check passed with a synthetic
  account, one SQL GET, original hash, complete manual-option hiding and account
  invalidation. No signing, send or transaction-flow API call.
- Typecheck, offline production frontend build and diff whitespace checks passed.
- Desktop/mobile screenshots regenerated in artifacts/deposit-page-preview/.

Wallet/send/journal validation algorithms and contract state are unchanged.
The loopback preview uses sample data with payments disabled; the production
build contains the real wallet controller. The three-step journey, disclosures
and status labels were also inspected in a local browser.

## Release preservation follow-up

A read-only comparison with base1ad950f confirmed32 protected files unchanged,
including contracts, event identity, registries, transaction sender/journal,
direct-deposit validators and wallet-account policy. The product build contains
its real wallet controller; sample data/controller substitution exists only in
the local preview server. No storage reset, deletion or resubmission was added.

The review found one background promise handler that did not preserve the base
loader's contained-error behavior. Its catch is now restored. The raw receipt
snapshot remains available to the explicit Deposit gate, so malformed or
cross-event data still fails closed before creating any transaction flow. A
focused actual-controller browser regression passed for a delayed cross-event
response after account selection: no unhandled rejection, no signing/send or
transaction-flow request. Typecheck and offline frontend build passed afterward.
