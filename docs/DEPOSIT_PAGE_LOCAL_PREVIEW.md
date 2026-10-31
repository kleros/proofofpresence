# Deposit-page local preview

The loopback preview demonstrates the deposit presentation without connecting
a real wallet or contacting production services.

Run `node scripts/deposit-page-preview.mjs`, then open
http://127.0.0.1:8790/first-event/ . The sample timeline selector shows seven
states. All data is synthetic, the wallet controller is substituted only by this
loopback preview server, and all write routes are refused. The product build does
not include this substitution, scenario selector, sample clock, or fixture data.

The product page shares the existing single anonymous SQL receipt GET between
its summary and wallet controller. Initial event details do not await this read.
Unique depositor wallets and cumulative received ETH are historical facts, not
current staked balances or confirmed admission. Receipt parsing retains exact
wallet/event/chain/contract/environment/instance boundaries and pending-reference
precedence. Transaction validation, signing, journals and original-hash recovery
algorithms are unchanged. The current event identity and legacy recovery exports
are unchanged.

The timeline counts down to event start/end and the actual posted challenge
window. It never invents a payout start at event end. Each unmatched challenge
has a separate matching deadline. Normal payouts are sent on release; disputed
shares and failed delivery remain separate. A saved Finalized status is not proof
that a particular wallet received ETH. The 10-registered/8-attended example is
illustrative, with no open disputes; it is not a live payout estimate.

Checks actually run on 31 October 2026:

- `node --test test/deposit-journey.test.mjs test/first-event-receipts.test.mjs`:
  11 passed (amount/scope validation, posting-dependent deadlines, admission,
  original receipt/reference and journal-preservation regressions).
- `node test/deposit-page-preview.e2e.mjs`: 29 presentation checks passed;
  desktop/mobile screenshots in `artifacts/deposit-page-preview/`. No external
  requests, page errors, wallet access, or financial requests. Initial harness
  failures were corrected: normalized the static root and replaced a network-idle
  wait with the specific snapshot response.
- `node test/deposit-wallet-presentation.e2e.mjs`: passed against the actual
  product wallet controller with a synthetic account and sample SQL receipts.
  Correct original hash, recorded-vs-confirmed state, admission and account
  invalidation; one SQL GET and one synthetic account-selection request. No
  signature, send, transaction flow or production service.
- `npm run typecheck`: passed.
- `npm run build:netlify:production`: passed (offline source/asset/build checks).
- `git diff --check`: passed.
- Native Brave local preview inspected; user-facing sample page opened.

These checks used no hosted deployment, live database changes, real wallet,
blockchain transaction, contract change or DNS change. They validate presentation
and existing financial guards; they do not measure physical phone handoff or
public network latency.

The subsequent focused audit and local simplification are recorded in
[DEPOSIT_PAGE_AUDIT.md](DEPOSIT_PAGE_AUDIT.md).
