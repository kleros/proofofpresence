# Original creation recovery checkpoint

29 October2026, Asia/Bangkok. Core owns integration and the only live operator.
Branch `codex/core-application`; pure presentation handoff bdddf4e integrated as f96ebdf.
The prior lean release73cf is live; the recovery release below is being verified locally.

## Actual original transaction

Transaction `0xef60cbf9c65883eb3a1daf6f250bd6cc8328ba655270e897ba17870b1d8a06dc`
succeeded in canonical Ethereum block26298864. The factory emitted one exact EventCreated for
child `0x4542D9b3De78a59d74cbbfe2166e3ef054E42A69`, version9. The outer type4 transaction
uses redeemDelegations at `0xdb9b1e94b5b69df7e401ddbede43491141047db3`; its one zero-value
execution calls the configured factory. Approved matching-draft inspection established exact inner
calldata equality, original eventKey/configuration/policy and a receipt after the original review.
See `artifacts/mainnet-release/original-ef60cbf9-review-comparison.json` and its hash-bound inputs.

The saved pending draft and original hash remain unchanged. No new creation, adoption, journal reset,
deadline edit or financial broadcast occurred. The separately approved temporary SSH credential was
revoked, confirmed absent, its isolated agent killed and private files deleted; cleanup proof is
`original-ef60cbf9-temporary-access-attempt3.json`. Two failed registrations never obtained access.

## Interfaces in this bounded repair

- `POST /api/recovery/auth/challenge` accepts wallet+originalhash. It issues a purpose-specific
  read-only nonce without exposing whether a draft exists. It grants no financial authority.
- `POST /api/recovery/auth/verify` requires the actual wallet's ECDSA signature, then finds exactly
  one matching saved submitted creation and binds its immutable digest to a NEW recovery-only
  session. Nonce purpose cannot cross into normal wallet authentication in either direction.
- `GET /api/recovery/original-creation` has no selectable query/body. It reads only that session's
  exact original scope, checks canonical transaction/receipt/review/head anchors and exact reviewed
  direct or one-call wrapped intent plus EventCreated. It never saves, adopts or returns calldata.
  The response is marked provenance:not-verified and every financial capability is false.
- An early server default-deny boundary rejects every other API/RPC/private/financial/mutation
  route for recovery-only sessions. Only scoped inspection, logout and static/public metadata are
  accessible. The session is rechecked before and after awaited inspection.
- `/recovery.html#transaction=<originalhash>` is a separate read-only wallet view. It retains the
  original ID through errors, checks exact actor/hash/instance acknowledgements, clears stale facts
  on wallet/network changes and requests only authentication signatures. It has no deposit/manage
  links and cannot make an Ethereum transaction.
- Ordinary setup now displays explicit review/wallet/confirmation/event-page stages. A validated
  pending result for the exact already-returned wallet hash can start up to six further factual
  checks with backoff and a three-minute budget. Lost acknowledgements retain their job identity
  for GET-only recovery; unknown errors stop automatic advancement. Pause/disposal/context changes
  cancel waiting without clearing financial journals. No financial send/validation guard changes.
- A fresh ordinary wallet bootstrap projects canonical role:organizer summaries below setup.
  After canonical creation, only this inventory refreshes; receipt/share content stays mounted.
  Current owner checks, private visibility and actor/mode/instance binding remain authoritative.

## Explicit remaining blocker

The real wrapped child is still unadopted and does not have a portal deposit page. Exact original
intent equality is established; full child source/history/governance provenance has not been
verified. The production financial account policy remains EOA-only; the real wallet now has
delegation code. The recovery session therefore cannot manage events or use financial actions.
Inspection is a mitigation and diagnosis, not completion of general wrapped-transaction support.

Completing that broader path requires a separately reviewed compatibility change across creation
birth verification, financial receipt proofs, fresh account checks, operational owner eligibility
and once-only adoption of this existing hash. It must preserve exact sender/target/value/calldata,
source/history/canonical proofs, event isolation and all v9 economics. Do not loosen only the first
TX_MISMATCH check, fake provider transactions, auto-adopt an EventCreated log or create a replacement.

The screenshot shows a Blockaid-powered malicious interaction alert and Added protection enabled.
Neither successful execution nor exact inner-call equality proves the warning a false positive.
MetaMask documents enforced simulation and EIP7702 integration; a vendor classification review is
separate. No security report was sent and no protection setting was changed. Preserve the prepared
public-only vendor packet without submitting it unless the human explicitly authorizes that action.

Official references: https://support.metamask.io/manage-crypto/transactions/simulations/ and
https://github.com/MetaMask/delegation-framework/blob/main/documents/DelegationManager.md .

## Validation actually performed

Root combined actual local service+HTTP+existing production boundaries:41/41 PASS. New service9,
new HTTP6 and existing productionHTTP26. Synthetic providers and real local ECDSA only; no financial
chain execution is claimed. Unit widget/watch checks are recorded separately with their exact source.
Standalone UI4 groups PASS with mocked transport/inspection DTOs and actual synthetic auth signature,
two screenshots; actual server/cookie/canonical reader are tested separately. Root full-app feedback
10 groups PASS against current modules; typecheck, static build and diff checks PASS. No unchanged
financial/contract/fork suite was rerun. Hosted publication/readback will be recorded separately.

Evidence: creation-recovery-ui/2026-10-29T15-19-52-692Z-c2c75333-4f6e-4847-8583-a921a6f2561c/proof.json,
setup-wallet-feedback/final-2026-10-29T15-21-57.415Z/results.json, plus the immutable original comparison.
The first HTTP attempt could not listen in the sandbox (EPERM) before behavior executed; the same
command passed with local listener permission. This was not a product failure.

A/B/C remain retired incomplete/PAUSED; D complete; E unused. No billing upgrade, upstream push,
IPFS upload, contract change, real guest write or new financial transaction belongs to this repair.
