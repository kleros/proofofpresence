# Contract deposit inbox

The organizer inbox indexes the selected event contract directly. It requires no
external guest service, subscription, API key or guest-list upload. Unknown payers
remain wallets with no name or email until a verified participant record exists
for that exact wallet and stable event. Reading or refreshing the inbox never
registers, approves, admits, refunds or broadcasts anything.

`GET /api/events/:id/deposit-inbox` reads the current status. `POST` to
`/api/events/:id/deposit-inbox/refresh` accepts only `{}` and requests a refresh.
Both routes require the **current on-chain owner**, including on cache hits.
Participants, staff and the owner of a different event cannot read the inbox.
The v8 bootstrap advertises `capabilities.contractInbox: true`; v7 bootstrap
capability shapes remain unchanged.

The response identifies `source: "contract"`, stable event, chain, contract and
version. `indexedBlock` contains the number, canonical hash and timestamp used
for all indexed amounts. `latestBlock` is the most recently observed chain head.
`lastSyncedAt`, `nextRefreshAt`, `stale`, `error`, counts and rows describe the
read-only projection. Cache reuse lasts at most 30 seconds; explicit refreshes have
a 5 second minimum interval. Concurrent requests share one verification/index
attempt. A timed-out client stops new batches while the actual underlying read
remains singleflight until it ends; another poll cannot start an overlapping job.
The cache is memory-only and bound to the server instance, deployment
mode and full deployment registry identity. It is never used by financial drafts.

Each row has a wallet, registration status, optional verified participant contacts
and canonical deposit transactions. `linked` means an identity-verified
participant for that wallet/event exists; `receiptLinked` separately indicates an
explicit receipt link. A deposit transaction never establishes a person's name,
email, admission or wallet ownership by itself.

| Amount                  | Meaning at the indexed block                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `pendingCreditWei`      | Authoritative v8 payer-owned unused credit; `null` for v7.                                                                                   |
| `committedPrincipalWei` | One active registered deposit while Open/Listed; zero after the ordinary payout batch or cancellation.                                       |
| `registrationBasisWei`  | Historical admission provenance retained by the existing receipt ledger; not a current recoverable balance.                                  |
| `receivedWei`           | Sum of canonical `Deposited` lots from this payer.                                                                                           |
| `returnedWei`           | Successfully delivered direct principal/spare refunds and pending-credit withdrawals; excludes attendance payments and fungible owed claims. |
| `unallocatedWei`        | v8 pending credit. For v7, the existing aggregate-spare ledger allocation, not a payer-owned withdrawal entitlement.                         |
| `owedWei`               | Current authoritative fungible owed balance. A failed refund appears here, not as a completed return.                                        |
| `heldShareWei`          | The challenge's current set-aside share.                                                                                                     |
| `attendancePaidWei`     | Successful explicit attendance payouts, including top-ups.                                                                                   |
| `creditWithdrawnWei`    | Successful v8 pending-credit withdrawals, also included in `returnedWei`.                                                                    |
| `claimsPaidWei`         | Successful fungible owed claims to any chosen recipient, kept separate from direct refunds and attendance payments.                          |

Every deposit transaction includes hash, log index, amount, block number/hash and
observed confirmation count. Two or more observed confirmations are labeled
`confirmed`; one is `confirming`. Neither label promises finality. Identity is the
event's canonical `Deposited.from`, which may be a contract wallet making an
internal call. A wrapper's outer transaction sender, target and value need not
match that inner payer. Exact successful receipt/log membership and canonical
block checks still apply; direct deposit/receive calls also require matching
outer payer/value. Unlogged forced native currency cannot invent a deposit row.

Each reuse verifies deployment/chain/code provenance and the indexed canonical
block anchor. V8 additionally retains its existing verified factory creation
proof. A changed indexed anchor triggers a rebuild. History is limited to 50,000
blocks, read in 5,000 block chunks, at most 1,000 payers, 2,000 deposit lots and 20,000
event logs. RPC, receipt, accounting, timeout or bound failures preserve the last
good still-canonical snapshot with `stale: true`, an error, and `actionable: false`
on the response and every row. A **proven orphaned anchor** instead invalidates
its rows immediately; a failed rebuild returns no rows and `indexedBlock: null`.
Ownership is checked again before final disclosure. If current ownership cannot
be freshly verified, the route returns
503 without disclosing cached contacts. An initial indexing failure returns an
empty stale status. A failed or partial index never replaces a good snapshot.

The inbox is informational. All existing financial actions still build and
validate fresh canonical drafts independently. Historical v7 ledger economics,
v8 credit replay, held-share payouts and ruling0 behavior are preserved.

Local verification uses `test/deposit-inbox.test.mjs` and
`test/deposit-inbox-integration.test.mjs`, with isolated Ganache/HTTP listeners.
The integration covers plain transfers without profiles, partial/excess credit,
rejection/readmission, smart-wallet deposits, refused refunds and alternate
claims, payout semantics, current-owner transfer, A/B isolation and read-only
refreshes. No public guest service or public-chain transaction is part of these
tests.
