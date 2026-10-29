# Setup wallet feedback — isolated UI handoff

Base live source: `fec62112aca1bb36cab08a02d823044646a73a6e` (app3b121b18).
This work starts at `c6674b6` on `codex/kleros-ui-ux-speed-audit`, in
`/Users/hashmanansala/.codex/worktrees/kleros-ui-ux-speed-audit/Kleros projects`.
Core remains sole backend/integration/publication operator.

## Problem and change

Connecting a wallet disposed the setup controller before awaiting the wallet/authentication response.
Its dispose cleared the setup host, and silent refresh suppressed global loading. Rejected prompts
left only a toast and an empty area. Both original states were reproduced against archived source.

The app now immediately shows a setup-shaped skeleton after disposing stale controls, with explicit
Waiting for wallet sign-in and Checking Ethereum setup stages. The existing polite loading status
stays outside the hidden busy content. Cancellation/error leaves persistent retry/reconnect controls.
A changed backend instance offers an explicit user-triggered Reload setup, preserving browser
transaction records; no automatic reload occurs. Fresh GET/session/context checks precede a form.

Known actor/null acknowledgements are checked before assigning/mounting a setup bootstrap. Wallet
listeners install immediately after acknowledged authentication. A monotonic wallet-operation epoch
covers connect/logout/provider changes and stale response/error/finally cleanup, alongside existing
route/generation/environment guards. Duplicate Connect is checked before disabling its current button.
No stale form HTML, transaction authority or submitted hash is restored from a failed attempt.

## Scope and exact sources

Only product files `public/app.js` and `public/loading.css` changed. New focused test:
`test/setup-wallet-feedback.e2e.mjs`. Exact final hashes and commands are recorded in
`artifacts/setup-wallet-feedback/ui-handoff-proof.json`; app `a61e10c9`, CSS `38ff0705`.

The date/setup widget remains SHA390aac98 as a local test dependency and is EXCLUDED from this
handoff. Core owns its newer review504/authenticated job/polling orchestration. Preserve that entire
newer file and its existing date behavior. No controller API, backend route, financial rule, policy,
contract, wallet sender or once-journal change is requested by this UI patch.

## Actual checks

- Original source: two blank setup states reproduced, with archived assets/screens.
- Final source: ten focused browser groups passed: pending desktop/mobile, cancellation/fresh retry,
  delayed challenge/verify/bootstrap, actor mismatch, account/network change during first verification,
  explicit sign-out, backend-instance explicit reload, late ACK during held logout without a GET,
  and duplicate prompt/route changes. All use synthetic loopback authentication/session fixtures.
- `npm run typecheck`, `node scripts/build.mjs` and `git diff --check`: passed.
  Static build checks historical pinned ABI/build; financial/contract suites were not rerun.
- Root inspected mobile pending/cancel and desktop reload screenshots; no clipping found.
  Existing reduced-motion behavior is retained; no additional motion was introduced.

Final source-bound evidence: `artifacts/setup-wallet-feedback/final-2026-10-29T13-40-38.475Z/`.
Earlier candidate results and a corrected test-reset preparation run remain separate. No real wallet,
cryptographic signature, public HTTP, RPC, financial endpoint, transaction or publishing was performed.
This is UI feedback/recovery evidence, not a real wallet-extension or latency benchmark.

## Integration

Apply the two product files plus focused test/docs/evidence. Never overwrite Core's newer
`public/luma-setup.js`, backend, registry or canonical project memory with this branch. Existing
bootstrap fields/auth/session APIs are retained; no new interface is required. Core should combine
with its independent504/widget fix and perform its bounded hosting verification. This patch can also
publish independently with the current widget. Do not force-reload the human's active organizer form.

The original speed question remains separate: directory startup has a measurable frontend import
waterfall; full financial checks are paced for the free RPC allowance. This skeleton does not remove
that work. No billing/hosting/RPC plan change is part of this handoff.
