# Setup progress and owned-event presentation handoff

29 October 2026. **Pure components ready; production wiring and live recovery remain with Core.**

The human reported a successful Ethereum transaction followed by a portal mismatch, unclear progress,
a MetaMask malicious alert, and a missing event in the directory. They also requested their organized
events after wallet connection. These components address presentation; they do not establish receipt
canonicality, adopt an event, resolve a security alert or authenticate a delegated wallet.

## Branch and source

- Branch: `codex/kleros-ui-ux-speed-audit`.
- Worktree: `/Users/hashmanansala/.codex/worktrees/kleros-ui-ux-speed-audit/Kleros projects`.
- This bounded change starts at `ea35a1b7aa23b34ce4233cd983537bd28a5aef03`.
- Core reported the preceding lean-startup optimization published from `73cf9b2` to
  https://kleros-luma-ethereum.netlify.app/ . Its matching AFTER timing check is deferred during
  urgent recovery. This is not evidence that these new components are published.

## Changed files

| File | Change |
| --- | --- |
| `public/setup-progress.js` | Pure mounted progress panel with explicit stages, persistent exact transaction ID, caller-supplied status, optional user-action callbacks and verified event links. |
| `public/owned-events.js` | Pure context-bound projection and escaped renderer for canonical organizer summaries. |
| `public/luma-launch.css` | Scoped progress card, stages, responsive controls and readable wrapping using existing palette tokens. |
| `test/setup-progress.e2e.mjs` | Static loopback component tests only; no backend or wallet fixture behavior. |
| `test/owned-events.test.mjs` | Pure synthetic authoritative-bootstrap projection tests. |
| `artifacts/setup-progress/`, `artifacts/owned-events/` | Source-bound local results, screenshots and explicit limitations. |
| `ui-registry.md`, `UI_HANDOFF.md`, this file | Presentation patterns and integration handoff. |

No app/entry/public-home/widget/auth/transaction/contract/backend source is changed by this addition.
The dirty local `src/server.mjs` two-path static allowlist patch is excluded: Core already owns the
matching backend change. Other old dirty audit artifacts are unrelated and excluded.

## Progress adapter

```js
import { mountSetupProgress } from './setup-progress.js';
const panel = mountSetupProgress(host, {
  isCurrent: () => /* caller's current actor, instance and operation generation */ true,
  onCopy: (hash) => /* explicit clipboard action owned by caller */ {},
  onCheck: ({ hash, chainId }) => /* check original known transaction only */ {},
});
panel.update({
  phase: 'confirmations', hash, chainId: 1,
  transactionConfirmed: false,
  // Supply confirmation counts only when reported by the authoritative service.
});
// panel.dispose() on scope loss or teardown.
```

Supported phases: preparing, validating, wallet-review, submitted, confirmations, portal-verification,
ready, cancelled, reverted, verification-failed, unavailable. They distinguish transaction confirmation
from event-page verification. Ready requires explicit `transactionConfirmed: true`,
`event: {id, verified: true, depositUrl, manageUrl}` and both exact same-origin native event URLs with
matching participant/organizer views. Invalid ready data fails closed. Neither hashes nor counts can
promote an event to ready. External messages use text nodes, not HTML.

The module contains no network, provider, storage, clipboard, timer or sender operation. Its optional
copy/check callbacks are invoked only by user action. It does not poll, reload, clear journals or offer
a second transaction. Unknown counts remain unknown. Focus and the exact hash input survive updates;
stale/disposed scopes suppress updates and callbacks. A confirmed-but-unverified state preserves its
transaction and does not advertise a deposit link.

Core owns the complete `luma-setup.js` adapter, original-hash watcher, jobs and recovery. Do not poll a
terminal ready job whose result is still pending: its immutable result cannot advance. A live
original-draft/hash status boundary is needed, with bounded backoff and current-session guards.
Never create a new review, replay the send or change hashes to manufacture an update.

## Owned events adapter

```js
import { projectOwnedEvents, renderOwnedEvents } from './owned-events.js';
const view = projectOwnedEvents(newlyReceivedBootstrap, {
  mode: 'hosted-production', instanceId: currentInstanceId, wallet: acknowledgedWallet,
});
container.innerHTML = renderOwnedEvents(view);
```

Only a newly received authoritative bootstrap in the caller's current generation is acceptable.
The projection requires the exact session-wallet/mode/instance, Ethereum production chain/profile,
canonical `role: 'organizer'` and verified production event. It accepts authorized private/draft rows
only after those guards; creator addresses, organizers arrays, local markers and public catalog entries
are not ownership evidence. It returns frozen six-field records or `null` (unavailable), distinguished
from a verified empty array. Links open a fresh guarded organizer view; the list grants no financial
permission. The caller must clear private content on actor/scope loss before another response arrives.

The current live human wallet is delegated. This module supports the existing ordinary wallet-session
DTO; it does not solve EIP-7702 authentication. Core has explicitly held MyEvents route/auth wiring
pending a reviewed backend boundary. Do not bypass that hold with a client flag or mock session.

## Validation and evidence

- Six focused static component browser groups passed: stage/status semantics, unknown counts,
  confirmed-but-unverified recovery, exact ready links, explicit callbacks, stale/disposed guards,
  focus preservation, desktop/mobile targets and reduced motion.
- Four pure owned-event Node tests passed: fail-closed context before private-field access,
  canonical organizer-only rows including authorized private/draft, excluded unsupported/duplicate/
  creator-only rows, immutable minimal projection and escaped links, unavailable versus empty.
- Typecheck, both module imports without browser globals, syntax, formatting and diff checks passed.
- Independent bounded source reviews passed. Root inspected the desktop and mobile screenshots;
  the mobile step label was shortened to avoid a midword wrap and the final proof was rerun.
- Component effect probes remained zero; only static loopback fixture assets were fetched. No
  RPC, auth, wallet, financial, upload, live account or production route operation was tested.
- Earlier failed harness expectations remain archived and explained in final provenance.

Final source-bound provenance: `artifacts/setup-progress/2026-10-29T15-05-47.346Z/final-provenance.json`.
Progress SHA256: `ada969fc9d86c145fd01e87cfd453cbf165797c500f7c505714c869962b01209`.
Owned module: `4f57dbd42a55cdc5ccbc805e8f95eec64910781f1494d858581b1771c96ef286`.
CSS: `c6ee592c6c2d1bbd1be1207ae186bb1a281e0f1a635ffdf1c88974032e5b523d`.
The final label-only browser rerun retains the earlier four owned-unit results without claiming a rerun.
This is not a security audit,
full accessibility certification, delegated-account support test or live publication proof.

## Core integration checklist

1. Review/copy only this bounded file set or its commit; preserve your newer widget/backend and
   primary project memory. Do not copy the older complete UI worktree over Core.
2. Wire progress into your own widget after phase/status semantics and original-hash watcher are
   settled. Keep receipt/share content mounted while inventory refreshes; avoid forced reload.
3. Wire owned events only after current actor/auth requirements are resolved. Do not make cold public
   home load a heavy authenticated bootstrap; use an explicit authenticated route/action.
4. Preserve public search inclusion: explicit public + published + supported summaries only. A created
   but unadopted event cannot be advertised. Private/draft titles never enter the public catalog.
5. Fix the duplicate empty-directory copy in your owned `public-home.js`: both publicResultStatus and
   renderPublicResults currently say No public events yet. A count/status plus one explanatory empty
   paragraph is sufficient. This file stays untouched here under Core's hold.
6. Run combined widget/current-actor browser checks against the actual DTO and recovery boundary.
   Include known hash, background refresh, failure, cancellation, stale wallet/server, privacy and no
   resend assertions. Then publish and source-verify through Core's normal hosting path.

The actual transaction's wrapped execution and original saved review still need Core's canonical
comparison before adoption. The MetaMask malicious classification remains unresolved. No transaction
or successful receipt alone proves that alert is a false positive. Do not instruct users to bypass it.
The retired A/B/C financial schedules remain paused and untouched.
