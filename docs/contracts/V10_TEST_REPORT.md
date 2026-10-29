# V10 local candidate verification — 29 October2026

Isolated branch `codex/instant-upgrades-v10`, base `09ac3a9134fc0cf04cd0179774154df5cfe08df4`.
Historical V9 Solidity and its published policy are unchanged. No new public network call,
mainnet transaction, policy upload, website rollout or existing event/journal mutation occurred.

## Commands actually run

| Command | Final result | Scope |
| --- | --- | --- |
| `node scripts/compile-contracts-v10.mjs` | PASS | Separate V10 build,19 inline sources; code-size and immutable metadata checks |
| `node --test --test-concurrency=1 test/event-v10.test.mjs` | 5/5 PASS,13.05s | Immediate upgrades, two-event isolation, ownership/freeze, funded held/pending/ruling1 and ruling0 |
| `node --test --test-concurrency=1 test/event-v10-security.test.mjs` | 8/8 PASS,29.406s | Independent initializer/target/implementation gates, nested callbacks/rollback, shared finalization, recovery and Bob settlement |
| `node --test test/mainnet-v10-release.test.mjs` | 7/7 PASS,7.906s | Unsigned config/artifact guards and exact local four-CREATE bundle |
| `node --check scripts/mainnet/prepare-v10-release.mjs` and corresponding test | PASS | Syntax |
| `npm run typecheck` | PASS | Root TypeScript |
| `npm run build` | PASS | Existing build plus new V10 compilation; static app and pinned v7 artifact checks |
| `node scripts/mainnet/prepare-v10-release.mjs` | PASS | Offline instructions, zero requests/signatures/broadcasts |
| `git diff --check` | PASS | Tracked changes; staged new files checked again before commit |

The20 focused tests were executed in separate bounded lanes; a combined suite was not rerun merely
to produce another count. A separate read-only planner review also passed17 pure nonce/fee/budget
boundary probes. Root independently verified proof and policy hashes and deterministic build pins.

Preliminary security runs stopped on a concurrent comment-only rebuild and then a test snapshot's
nested ethers Result normalization. The fixture was corrected before the final8/8 run. The initial
release test reached all deployment assertions but could not save its public proof under sandbox
permissions; a bounded permitted rerun completed7/7 and saved the proof. These were test environment/
fixture failures, not passing results silently discarded or observed contract-state differences.

## Evidence and limits

`artifacts/v10-release/local-verification.json` binds all candidate source/test/package/policy files
and final compiler inputs. Exact deployment evidence:
`artifacts/v10-release/local-setup-measured-2026-10-29T16-07-19-937Z.json`, SHA256
`3a56bce25315ac1fe36cbcbccbc4663ba9e3753dac99e9baafe095a7df78a11f`.

The synthetic chain1 Shanghai rehearsal used7194866gas: controller669197, event implementation4641208,
factory implementation1654634 and atomic factory proxy229827. These are local measurements, not a
current mainnet-fork estimate, quote or approved spending cap. No guest event or automatic finalization
was included in that deployment bundle. Other focused tests exercised actual local deposit/dispute/
payout execution; only Court adjudication was mocked. They confirmed the same Bob receives his held
attendance payment plus remaining collateral after finalization, with pending/owed reserves protected.

An explicit adversarial fixture demonstrates that malicious authorized code can bypass a frozen
controller despite matching family/schema/version metadata. Renunciation finality is therefore stated
only for the reviewed current implementations and authority inventory. No independent external audit,
new V10 production browser integration, public jury cycle or mainnet payment is claimed here.

Next: Core integrates VERSION10 explicitly, preserves V9, binds a newly published V10 policy when
separately authorized, and prepares fresh canonical account/nonce/envelope/fee/balance preflight and
an exact deployment bundle with a newly approved cap. See `V10_IMMEDIATE_UPGRADES_HANDOFF.md`.
