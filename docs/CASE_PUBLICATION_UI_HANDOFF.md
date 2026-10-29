# Explicit case publication UI handoff

29 October2026. Isolated branch codex/kleros-ui-ux-speed-audit at
/Users/hashmanansala/.codex/worktrees/kleros-ui-ux-speed-audit/Kleros projects.
Base613c79a7474ca366eb0694f7d89d392ccfb72e32; Core owns final integration/hosting/signing.
Reviewed app SHA2566aef1590d728f746ef300274e0be4f3b540c6146290125ccf53567736a5e5de4;
helper SHA256488354b0e9b0de7b80eaca34e1d88300b291333d1fc40f683b2588d2fb8375ca.

## Changes and interfaces

Production-only advanced case details now offer exact JSON review/download, explicit permanent
public-upload consent and a separate availability check. Waiting challenges can export; evidence
and appeal controls retain their existing matching gates. Legacy local-server-copy UI is preserved.
No contract, financial rule, backend API, wallet sender, external service or scheduled job was changed.
The isolated src/server.mjs diff serves only the new /case-publication.js static asset; keep Core's
newer server and add that asset, never copy this old backend wholesale.

POST /api/events/:eventId/cases/:challenger/{artifact,publish,availability} returns the same
{artifact,currentCase,publication} envelope. Artifact and availability bodies are{}, publish body is
{sha256,scopeHash}. Artifact contains exactly version1,scope,scopeHash,content,sha256,byteLength,uri.
content is the original serialized JSON string; downloads do not parse/reserialize it. Browser checks
UTF8 byte length, content SHA256, original scope SHA256 and the contract's UnixFS/DAG-PB CIDv0.
Hashes are lowercase64hex without0x. URI is /ipfs/Qm... .

Both scope objects have exactly environment,instanceId,chainId,contractVersion,eventId,contract,wallet,
blockNumber,blockHash,matched,localDisputeID,arbitratorDisputeID. They require production/chain1/v9.
Original artifact scope may retain an old instance and Waiting/null IDs; currentCase must match the
fresh selected server/event/child/challenger context. Matched decimal IDs include valid0; previously
matched IDs cannot change. The signed-in reviewer is pinned separately from the challenged wallet.

Publication status is exported,published-unverified,upload-uncertain,verified,availability-unconfirmed
or integrity-mismatch, with matching uri,sha256,scopeHash,byteLength and optional reason,lastCheckedAt.
Authoritative complementary boolean flags uploadAttempted/canPublish determine readiness. Upload
requires canPublish===true,uploadAttempted===false and nonverified supported status. Missing or
inconsistent flags block upload while preserving review/download/verification. A failed availability
check before any attempt may remain publishable; an attempted or uncertain upload cannot be repeated.
No upload acknowledgement establishes availability. All network actions require a separate click.

Each review pins its original endpoint, event, child, actor, challenger, instance and view. Context
changes close/drop the review and stale responses cannot publish into a new context. Synchronous
request locking handles double clicks; ambiguous outcomes stay verify-only. Publication failures
leave existing financial recovery and case rights available. JSON is escaped rather than rendered.
No contact evidence or new user-upload endpoint was added.

## Actual verification

- node test/case-publication.e2e.mjs --self-test:26 offline guards PASS.
- node test/case-publication.e2e.mjs --run-loopback:9 browser groups PASS; synthetic HTTP only,
  zero actual uploads, gateway/RPC/provider/public requests, page errors or forbidden requests.
- node test/luma-launch.e2e.mjs --run-loopback:full26 existing groups PASS after the new shared
  dialog hooks, using the same two fake wallet attempts/one literal submitted hash as before.
- Existing pure Luma guards12/12, typecheck and node scripts/build.mjs PASS. A checkbox target
  type error was found and fixed before final typecheck passed.
- Local v7 simple UI13 and v8 simple UI18 browser checks PASS, including actual synthetic-chain
  deposit/unused-credit recovery; no public services were used.
- Independent source review PASS on exact final reviewed hashes. Preview verifier94 offline guards
  PASS; new module observation is required when present in the explicit selected Git source.

Proof is in artifacts/case-publication/ and artifacts/luma-launch/final-publication-regression.log
with their exact source manifests. Initial failed wording assertion is retained separately, never
counted as a pass. These fixtures do not prove real publication-service transport or mainnet behavior.
Core/contract owns the final actual local financial flow plus read-only real-backend export/download.
No actual publication or mainnet transaction occurred in this UI chat.

## Integration and narrowly separate follow-up

Copy public/app.js and new public/case-publication.js together; add the static asset allowlist.
Test sources are test/case-publication.e2e.mjs and test/fixtures/case-publication-fixture.mjs, which
import existing test/fixtures/luma-launch-fixture.mjs and production-ui-fixture.mjs. Preserve current
Core backend, canonical brain, runtime, deployment inputs, signing journals and financial operators.

Selectors: [data-case-artifact=review][data-case-wallet=challenger], native summary Advanced · exact
case artifact; dialog [data-case-publication-review], JSON[data-case-publication-json], download
[data-case-publication=download], consent[data-case-publication-consent], publication/availability
[data-case-publication=publish|availability]. Actual local financial runner must not click upload or
availability; external fetch is denied there. Core publication boundary tests mock HTTP separately.

A later isolated markup-only annotation adds tabindex0/aria-label Exact case JSON to the scrollable
JSON pre for explicit keyboard scrolling. It was applied before Core's freeze notice arrived but is
NOT part of the reviewed6aef publication checkpoint or its9/26 executed proof. It remains a separate
working diff for focused mobile/keyboard validation after Core releases the actual-flow freeze.
Do not silently claim the earlier proof ran on that later hash, and do not repeat financial operations
merely for an accessibility attribute. Public policy configuration and hosting remain Core-owned gates.
