# Fix 7: compile each contract family once during root verification

Local follow-on to `c02d7c4` on `codex/selected-event-loading`. The human requested removing
duplicate contract compilation during verification. Only build configuration and documentation
change; no runtime, contract, compiler, dependency, lockfile or CI source changes are included.

Previously `verify` ran `build` and then `test`, each of which prepared all five contract families.
The package scripts now centralize that preparation in `compile:all`, preserving the exact order:
historical v7, v8, test15m, v9 and v10. Standalone `build` and `test` still compile fresh artifacts.

The new `test:compiled` entry retains the exact existing Node command and file glob. `verify` runs
it after the fresh build and typecheck, so the five preparation compiler entries run once instead
of twice: **10 entries become 5**. Every existing Node/browser gate remains in the same order,
with the same fail-fast `&&` chaining. The standalone test wrapper includes `--` so arguments
passed through `npm test -- ...` still reach the Node command.

`test:compiled` is a lower-level entry that requires current build artifacts; use `npm test` to
prepare them first. There is no persistent compiler cache, environment bypass flag or newly trusted
artifact source. Security/provenance tests that compile fixtures or independently reproduce saved
inputs retain those checks. The separate historical compatibility suite retains its own compilation.
This change removes duplicate standard preparation from root `verify`, not every compiler invocation
from the entire CI job.

## Actual verification

- One actual `npm run build` passed with each of the five compiler entries invoked exactly once,
  followed by the unchanged static/pinned-v7 build checks. All **40** artifact hashes matched their
  preceding canonical outputs and remained unchanged after focused tests.
- `npm run typecheck` and authored diff checks passed.
- `MAINNET_KLEROS_FORK=0 MAINNET_KLEROS_V9_FORK=0 node --test --test-concurrency=1
  test/payments.test.mjs test/event-factory.test.mjs test/v8-test15m-chain.test.mjs
  test/upgrade-artifacts.test.mjs test/mainnet-v10-release.test.mjs` passed **27/27**, no failures
  or skips, in43612.580208ms. The checks consume the prepared artifacts and cover actual local v7
  payouts, v8 factory isolation, test15m behavior, V9 source pins and V10 release provenance.
- An isolated temporary package fixture passed **12 routing cases**, executing the actual npm alias structure with simulated
  compiler/test/browser leaf commands. Parent verification invokes the five compiler entries twice;
  the candidate invokes them once. Standalone build/test still prepare artifacts; `test:compiled`
  invokes no preparation compiler. Noncompiler arguments/order and failure propagation are checked,
  including forwarded test arguments. These are wiring checks, not real suite/compiler passes.
- Independent source review found no issue after preserving nested npm argument forwarding.

During that review an argument diagnostic inadvertently started a broader test run. Its three
identified processes were stopped, it did not complete and is not counted as passed. No source
changes resulted, and all40build artifact hashes were rechecked afterward. The npm fixture's first
shim also needed a local symlink-path correction; earlier evidence remains retained. Ganache used
its JavaScript native-binding fallback in the real local tests.

The complete Node suite and full `npm run verify` were not executed for this script-only change.
Browser stages remain unchanged and were checked as command wiring; no new browser pass is claimed.
Exact commands, source hashes, simulated traces, real build/test logs and artifact hashes are saved
in `artifacts/compile-once/proof.json` and the retained local evidence folder.

All activity was local/synthetic. The primary product source, live RPC/wallet/transactions, private
signing files/journals, hosting and upstream remain untouched. Core owns integration/publication
under the existing acceptance gate. This removes redundant preparation; no wall-clock or live
performance improvement is claimed.
