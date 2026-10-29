# Ethereum Kleros V1 verification

Verified29October2026. This records source review, public read-only Ethereum checks and an isolated
Ganache fork. **No mainnet contract was deployed, signed transaction submitted, real dispute opened,
private signing file read or IPFS content published.**

## Selected compatible pair

The explicitly reviewed candidate for this app is:

- Array-rewards resolver: `0x4B89e798B10478A839Ea0Abcf86C4B94A3C782A4`.
- KlerosLiquid V1: `0x988b3A538b618C7A603e1c11Ab82Cd16dbE28069`.
- Extra data: ABI encoding of General Court0 and3jurors.

This resolver is **not the current official-docs default**. The pinned
[official deployment list](https://github.com/kleros/kleros-docs/blob/e5bd1c7fe7bcc184b96f7631f9f73b9ab9a21773/developer/deployment-addresses.md)
lists `0x99489D7bb33539F3D1A401741E56e8f02B9AE0Cf`. That contract has scalar-ruling reward
withdrawals. The selected4B89 contract has array-ruling reward withdrawals compatible with the app.
The two share the core dispute interface but must not be silently substituted. Generic package
artifacts are not authority for the exact ABI of another deployed address.

Exact deployed ABIs and verified sources were obtained from the respective
[4B89 Etherscan source](https://etherscan.io/address/0x4B89e798B10478A839Ea0Abcf86C4B94A3C782A4#code),
[99489 Etherscan source](https://etherscan.io/address/0x99489d7bb33539f3d1a401741e56e8f02b9ae0cf#code)
and [Liquid Etherscan source](https://etherscan.io/address/0x988b3A538b618C7A603e1c11Ab82Cd16dbE28069#code).
The selected public ABI/source snapshots are retained under `scripts/mainnet/` and
`scripts/mainnet/verified/`; they are reference inputs, not new deployable project contracts.

| Input | SHA256 |
| --- | --- |
| Selected resolver ABI, canonical JSON | `2b60e4297a5fb120b3c48ddd3d417ed69c2914a5cfa4e8eaab770ed928020746` |
| Liquid ABI, canonical JSON | `8256ce11ae0e719675992245dabe2574b60369f71f5190cf92f5aeda54f88af3` |
| Verified resolver source | `dbeb627adc2cf7e5ab3ffee077f20f6e49a735f79a2e61a667fab26b9e2e172c` |
| Verified Liquid source | `4cbc179cdf8cda02d13f6c25861ac015173d11392cbb9b290646e11cc7f27b3b` |

Etherscan reports resolver compiler0.7.6, optimizer20,000runs, Byzantium; Liquid compiler0.4.25,
optimizer200runs. These dependency sources were not independently recompiled in this lane.
Live runtime hashes, exact ABI calls and actual fork execution provide the separate deployed-code checks.

## Canonical public reads

The fresh proof [ethereum-v1-readonly-final](../artifacts/mainnet-kleros/ethereum-v1-readonly-final.json)
has SHA256 `9fb2d8230cf7b496e16da743d68c84d2819777a2a6ff5d7b258a913924088a0c`.
It was captured at Ethereum block26296296, hash
`0x807b8eeac9066004e723452555394d61cabae7921c1e7bb6b889029f54a82b91`.

| Check | Result |
| --- | --- |
| RPC chain | Ethereum1 |
| Resolver runtime |9,272bytes; `0x9cd25def8eb247416e5321f7166d37c035b10574c41226cd78a33d8bdde3d09e` |
| Liquid runtime |23,206bytes; `0x20af43c09a24b7f13078a892878a463db494585f1dfbcd9ce89376b356d1f4fe` |
| Resolver `arbitrator()` | Exact selected Liquid address |
| Winner/loser/loser-period/denominator multipliers |10000/20000/5000/10000 |
| Court0/3juror arbitration cost |16,200,000,000,000,000wei =0.0162ETH at that block |
| Canonical-header reread | Same hash |
| Upstream calls |8, all read-only |

This fee is a recorded observation, not a fixed production quote. Challenge and matching each
require the current contract quote, plus transaction gas. Review and signing must fetch current
fees/court parameters again. Production must never inherit synthetic Chiado fees or grants.

`node scripts/mainnet/verify-kleros.mjs` defaults to a zero-network review. Explicit `--verify`
performs the public reads; `--block` permits a pinned block and checks the fixed baseline hash.
The transport has an immutable public read-method list backed by a private set, rejects all
signing/broadcast/emulator methods, follows no redirects and accepts root HTTPS endpoints without
credentials/query/path keys. Public output records only the endpoint origin. Sanitized errors retain
numeric status/code and safe network classification so bounded retry logic can work without exposing
provider diagnostics.

## Actual deployed-code fork test

Command actually run:

```sh
MAINNET_KLEROS_FORK=1 MAINNET_FORK_REPORT=artifacts/mainnet-kleros/fork-ethereum-v1-final.json \
  node --test --test-concurrency=1 test/mainnet-kleros-fork.test.mjs
```

**Passed1/1 in10.5seconds**, covering five locally created production-v8 factory children.
The test is opt-in; ordinary test imports perform no mainnet calls. The proof
[fork-ethereum-v1-final](../artifacts/mainnet-kleros/fork-ethereum-v1-final.json) has SHA256
`b76fac8f58736ddb0a83fe02363dd68ed2f70713646324f2a79bee1174fffcbe` and pins all executed source hashes.
Before any fork access it recompiles the exact reviewed production sources with solc0.8.38,
checks saved ABI/creation/runtime artifacts against that output, and deploys those checked artifacts.
The proof records compiler/input hashes and both exact creation code hashes.

The source fork block is26296250, hash
`0x8ae4a00aba84e5d2234a6e5a6940d2c22c3ba798a488980858771a8b33f7f4d6`.
The final bridge made22allowlisted upstream reads and zero upstream signing/broadcast requests.
Ganache reused its public fork-state cache; the earlier full run made133reads and passed separately.
All ETH, contract creations, transactions and clock/state changes were inside in-process Ganache,
checked through its client identity and snapshot capability. A loopback HTTP bridge rejects any
upstream non-read RPC method. No production wallet or signing file is loaded.

Proven paths:

- Normal VERSION8 factory/children retain86,400-second challenge and match periods; control-event
  deposits and pending credits stay isolated.
- Actual native ETH deposits, curated registration, protected excess recovery and immutable attendance.
- Real resolver→Liquid dispute creation, dynamically mapped local/Court IDs, sender-bound evidence
  and rejection of evidence after final delivery.
- Ordinary Alice payment with Bob held and unruled; an execution-period Court result is distinct
  from delivered resolver finality, and delivered finality is distinct from event settlement.
- Rulings1,0,2: Bob attendance/collateral, refusal collateral split and redistribution, absent top-up;
  no residual event escrow, owed amount or reserved excess after recovery.
- Positive two-sided appeal funding invokes actual `Liquid.appeal` and opens another evidence round.
  Exact7wei surplus is returned to the EOA contributor.
- One-sided full funding in the next round overrides the Court callback: Court current ruling2,
  resolver final ruling1. Actual `passPeriod` and `executeRuling` deliver the result.
- Array reward withdrawals pay the contributor directly: Bob0.3942ETH reward/reimbursement and
  matcher0.081ETH incomplete-contribution refund in this synthetic local case. Native balance deltas
  match views exactly, withdrawals become0, and event custody remains unchanged throughout appeals.

Only jury adjudication was simulated: plain cases use a local Court-address callback; the positive
appeal case changes the local Court's jury outcome/period storage after checking exact runtime and
observed struct layout. Actual Court/resolver bytecode is retained. This does not establish live juror
voting, drawing, responsiveness or the duration of a future public dispute.

Early fixture runs correctly exposed the real resolver's pre-final withdrawal rejection and a local
empty-storage decoding assumption; tests were corrected. Production Solidity was not changed.

## Upstream wallet and finality limits

Use resolver `disputes(localID).isRuled` as the delivered-finality gate. `Liquid.disputeStatus` or
execution period alone is insufficient. Preserve real local versus Court IDs and actual appeal
periods; no generic timer can bypass a matched case.

The selected resolver's surplus refunds and reward withdrawals deliberately use unchecked `.send`.
A contract wallet can reject that payment, and reward accounting may already be cleared. The
[official frontend warning](https://github.com/kleros/dispute-resolver/blob/7cb11e846c9e2ce214ce2da9955a025c7002d1d3/src/components/smartContractWalletWarning.js)
also identifies contract-wallet limitations. This verification establishes native delivery to EOAs,
not arbitrary smart-contract wallets. Production must enforce and explain its reviewed EOA scope;
events and UI success labels alone are not native-payment evidence.

Additional pure guard command: `node --test test/mainnet-kleros-verifier.test.mjs` passed7/7.
It checks prohibited methods before access, immutable allowlisting, URL/redirect/error redaction,
retry classification, chain rejection, baseline-header rejection and both ABI pins.

The parent production runtime, unsigned deployment plan, policy/owner/budget and UI release are
separate acceptance work. These verification results authorize no mainnet broadcast.
