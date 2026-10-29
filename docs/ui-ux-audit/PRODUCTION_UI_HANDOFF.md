# Production UI guards and recovery handoff

29 October 2026 · local validation complete; ready for primary integration review.
No mainnet deployment or Netlify publish occurred in this worktree.

## Branch and source

- Branch: `codex/kleros-ui-ux-speed-audit`.
- Worktree: `/Users/hashmanansala/.codex/worktrees/kleros-ui-ux-speed-audit/Kleros projects`.
- Original starting commit: `3332f67abd1e8364891feba7b250c1ec87e257bc`.
- Production UI starting checkpoint: `e6377816f21ab91ab57b0e3ce2f8260a4a2db1d4`.
- Primary owns final backend integration, release source and deployment. Contract chat owns v9,
  governance, real Court verification and unsigned deployment tooling. Mainnet deployment is forbidden.

The human directly approved production UI guard changes and local tests in this chat. This resolved
an earlier automatic-review block; no approval was inferred from elapsed time and no rejected write
was routed around review. The old incomplete `/private/tmp/kleros-production-ui-review-20261029/`
export is historical review data and is superseded by this validated source.

The reviewed performance source remains `8fd010c7dba27434e8e861178848529614121d09`. The optional D
optimized publish was deferred under the later production-readiness priority. No optimized public
before/after speed result is claimed. Older A/B and C financial jobs retain their frozen assets,
independent state and once-only journals.

## Changes and files

| Files | Change |
| --- | --- |
| `public/app.js` | Explicit production presentation and wallet/signing gates; sandbox-only controls; exact draft scope; upgrade/account disclosures; finality-aware reward quotes; URI-only production evidence; manual known-hash recovery after detail trust errors. |
| `public/index.html` | Stable short help label before hydration, matching the hydrated label to prevent mobile wrapping. |
| `public/environment.js` | Strict production bootstrap/detail metadata, EOA support, credential-free HTTPS RPC and governance checks. Copied exactly from the independently reviewed parent implementation. |
| `public/contract-profiles.js` | Exact verified v9-uups profile with v8 financial model; chain1 batch journals require that profile and production mode. Parent-reviewed implementation copied exactly. |
| `public/batch-pending.js` | Production batch scopes include explicit mode and server instance. Historical1337/10200 serialization is unchanged. |
| `public/batch-actions.js` | Preserves mode through the actual production controller and checks it on restored markers; legacy scope shape stays unchanged. |
| `src/server.mjs` | Isolated test server adds `/environment.js` to its existing static allowlist. Primary already owns its corresponding addition; do not overwrite its newer server. |
| `test/environment.test.mjs`, `test/production-batch-pending.test.mjs` | Parent-reviewed malformed-context, exact profile and production journal isolation regressions. |
| `test/production-ui.e2e.mjs`, `test/fixtures/production-ui-fixture.mjs` | Synthetic loopback UI, malformed metadata, nullable quotes, contradictory modes, evidence, keyboard, mobile and known-hash recovery checks. |
| `test/production-batch-controller.e2e.mjs` | Actual controller plus actual journal with synthetic off-chain response-loss and reload cases. |
| `ui-registry.md`, `UI_HANDOFF.md`, this report | Disclosure/recovery patterns and concrete integration handoff. |

The generic transaction journal and submission helper are unchanged. No financial rules, Solidity,
policy snapshots, authorization policy, database migration, signing files or financial operators were
changed here. No automatic resend, new financial cache, optimistic payment success or financial API
redesign was introduced.

## Interfaces and data assumptions

Production is only `mode: "hosted-production"`, with `environment.production: true`,
`environment.network: "ethereum-mainnet"` and chain1. Bootstrap advertises production, browserWallet,
walletTransactions, `financialInterface: "kleros-native-v1"`, boolean transactionsReady and
`supportedAccountTypes: ["eoa"]`; serverSigning, contractWallets, erc1271, eip7702, sharedDemo,
reset, timeTravel and mockRulings are false. Other feature capabilities remain independent.

Canonical version and ABI are `kleros-event-v9-uups`, numeric version9, financialModel v8,
upgradeable true, testOnly false, verified true and both86400-second windows. Bootstrap and each event
must supply their matching contractProfile. Ethereum metadata is native ETH with18 decimals.
Neither chain1, a version prefix nor an authenticated session alone grants production signing.
Contradictory demo/testnet modes with chain1 or v9 fail before draft preparation and before sending.
Historical v7, normal v8 and Chiado test15m retain explicit dispatch.

The verified real arbitration pair and provider text come from bootstrap. Supplied event resolver and
arbitrator must agree. Wallet support is EOA only; core freshly enforces this at auth and draft
creation/validation with HTTP422 `UNSUPPORTED_WALLET`. The UI displays that reason without duplicating
the server's RPC wallet classifier. Contract, ERC1271 and delegated EIP7702 accounts are unsupported.

Detail trust is `detail.deploymentTrust.status` (verified, unavailable or changed). Governance is
`detail.upgrade`: kind uups, verified true, implementation, implementationCodeHash, version9,
authority, multisig, delaySeconds of at least172800, and an own pending field. Pending is null or
{operationId,newImplementation,eligibleAt,status}; eligibleAt is Unix seconds. Only complete verified
facts are presented as verified. The review delay is not a guaranteed withdrawal window: upgrade
authority can change custody logic. Each event owns an independent proxy; factory defaults apply
to future events.

Production cases supply case.rewardsReady and appeal.rewardsReady/withdrawableWei when available.
A null amount remains unavailable, while an actual final actor quote of zero is shown as zero.
Conflicting readiness flags fail closed. Reward review requires a supported final resolver result
plus explicit readiness. Backend finality, fee/amount quotes and fresh simulation stay authoritative.
Admission, trusted check-in, financial attendance, held shares, owed credits and successful payment
records retain separate meanings. A Finalized phase describes ordinary processing, not global success.

## Recovery when verification fails

`UPGRADE_TRUST_MISMATCH` and optimized `SELECTED_EVENT_UNAVAILABLE` errors retain recorded transaction
hashes through an exact manifest-summary journal context: event, wallet, chain, contract, ABI, mode
and server instance. Known captured actor/mode/instance changes reject recovery. The error view does
not restore signing authority or automatically send any recovery request.

An explicit user action may call the existing authenticated endpoint:

`POST /api/events/:stableId/submissions/reconcile` with `{draftId,hash}`.

Core serves this before the detail trust check and validates the original reviewed transaction plus
canonical receipt. The UI requires matching hash, draft, event, wallet, chain, contract, optional
recorded action, recovered:true, known status and a valid terminal block before updating the captured
journal. Unknown/malformed/foreign responses preserve the original hash. Late results update only
the original journal; authorization failure removes the visible panel. A confirmed receipt does not
claim payment delivery or restored event verification. No new draft, wallet send or replay occurs.

## Tests actually run

- `npm run build`: PASS, including pinned v7, v8 and test15m compilation. Solidity source unchanged.
- Final `npm run typecheck` and `node scripts/build.mjs`: PASS.
- `node --test test/environment.test.mjs test/production-batch-pending.test.mjs test/batch-pending.test.mjs test/transaction-context.test.mjs test/selected-event.test.mjs`: PASS60 after the final helper amendment.
- `node test/production-batch-controller.e2e.mjs`: PASS4 groups, actual controller and durable journal;
  marker before synthetic off-chain commit, response-loss retention, reload without replay,
  backend-instance isolation and unchanged legacy scope shape. No network API writes or wallet access.
- `node test/production-ui.e2e.mjs --self-test`: PASS24 fixture checks, zero browser/network calls.
- `node test/production-ui.e2e.mjs --run-loopback`: final PASS19 groups. Covers all eight malformed
  production contexts, exact zero/nonzero/null actor quotes, conflicting readiness, EOA422, nonce auth,
  keyboard, URI-only evidence, authenticated contradictory-mode prepare denial, both detail trust
  error codes, durable hash retention, no automatic reconciliation and exact explicit receipt recovery.
  Includes390px mobile recovery and actual doubled text without overflow. Zero forbidden/external
  requests, page errors, wallet transaction methods or real RPC calls. Only synthetic auth and explicit
  receipt-reconciliation POSTs are served by the local fixture.
- `node test/simple-ui.e2e.mjs`: final PASS13 on actual local v7.
- `CONTRACT_VERSION=kleros-event-v8 node test/simple-ui.e2e.mjs`: final PASS18 on actual local v8,
  including verified deposit and independent unused-credit withdrawal. No public chain operations.
- `node test/ui-ux-fixes.e2e.mjs`: PASS27 after the stable help-label fix. Its earlier failure is
  preserved in `artifacts/production-ui/regression-failures/ux-help-wrap-cls.json`. Two controlled
  current mobile CLS samples0.0963418246 versus frozen baseline0.3718804380; header77px before/after.
  These are cold loopback samples, not field performance or public release measurements. Later
  production guard/recovery edits were checked by the final production suite, not another CLS rerun.
- Earlier unchanged transaction/binding/reconciliation focused run PASS57; not added to the60 count.
- Offline release checker PASS81 guards, zero network/browser launches. No new public D checks.
- Source whitespace, syntax and formatting checks PASS. Root inspected final desktop recovery and
  mobile captures; the browser agent also inspected doubled-text and recovery captures.

Evidence: `artifacts/production-ui/results.json`, `final-run.log`, `final-provenance.json` and PNGs. Initial
partial passes and fixture-only failures remain marked separately. The broad financial/Node suite is
owned by primary and was not rerun or claimed as a new production suite in this UI worktree. These
UI tests do not prove mainnet deployment, real-wallet extension behavior, contract economics,
governance security, live Court finality, send-time execution or public payment delivery.

## Integration instructions and remaining dependencies

1. Review this bounded source against production start e6377816. Primary should integrate only the
   intended public modules and focused tests, preserving its newer backend, contracts, manifests,
   signing files, runtime state, operator proofs and canonical brain. Do not merge this branch wholesale.
2. Parent-owned environment and profiles are already identical by hash. Preserve that exact behavior;
   do not replace them with the earlier incomplete export. Add app/index/batch-actions/batch-pending
   and both browser harnesses/fixtures to the final source checkpoint.
3. Confirm each actual v9 event summary/detail includes canonical verified contractProfile, the new
   helper is served with JS MIME, recovery endpoints precede detail trust failures, and the real signed
   session plus nullable actor rewards match the interface above. Core owns these API guarantees.
4. Run primary's combined production backend/proxy and regression checks on the integrated source.
   This UI pass is a local integration handoff, not a declaration that the entire app is production ready.
5. Deployment remains with primary after its release decision. No source-only test changes the older
   A/B/C schedules or permits a mainnet/production hosting deployment. The optional D publish is paused.

Read-only final schedule check on29October: both jobs ACTIVE, exact prior configuration hashes:

- finish-kleros-testnet-kickbacks, daily00:20Bangkok:
  `9ac2647729ccc9650f1869ea2c5a43f30c220b356effec96a6197d79d8d62d83`.
- finish-kleros-ui-testnet-flow-c, daily05:02Bangkok:
  `610c6d7c27ca031c4f0a6586d40b0da1ac00a90a4d838a46acbeb2efaaadb599`.
