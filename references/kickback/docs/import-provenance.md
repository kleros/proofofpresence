# Event-bound imports

Use the unified application's authenticated organiser workflow where available. These local tools
preserve Luma CSV/manual-door-list operation and never submit guest records to Luma.

New event configs need a stable `eventId`, `abiVersion: "v7"`, `contractVersion: "v7"`, chain, contract,
deposit, deployBlock, schedule/timezone and their own policy/template. Set `lumaEventId` and `lumaUrl`
explicitly if used. A display slug/title is not identity. Historical configs derive identity from
chain+contract and retain their historical policy/template. Keep separate private output directories
per environment/event. Never commit guest exports or generated private lists.

Export registrations from the selected event and inspect its event selection and metadata. Record
who reviewed the source origin and how. This is an organiser trust assumption: hashes identify bytes,
not provider origin. Available conflicting event/chain/contract/Luma metadata always causes rejection.

```sh
node scripts/review-import.mjs --config events/event-a.json \
  --guests private/event-a-guests.csv --reviewer "Event A organiser" \
  --reason "Exported from Event A's Luma guest page and checked available event metadata" \
  --out private/event-a-registration-review.json
node scripts/verify-deposits.mjs --config events/event-a.json \
  --guests private/event-a-guests.csv --out out-event-a \
  --provenance-review private/event-a-registration-review.json
```

Review issues, pending admissions, duplicates, overpayments, prior returns and unmatched deposits.
Approve/decline in Luma, re-export/review/reverify, then review the registration/refund proposal in
the selected event console. A deposit log alone is not admission. Never relabel a conflicting artifact.

After the event review check-in export origin and reconcile any manual door list. Preserve the
verified/claims CSV sidecars; they are mandatory even for empty intermediate CSVs.

```sh
node scripts/review-import.mjs --config events/event-a.json \
  --checkins private/event-a-after.csv --manual private/event-a-door.csv \
  --reviewer "Event A door lead" \
  --reason "Reviewed the event-scoped export and reconciled the door list; raw origin is not cryptographically verifiable" \
  --out private/event-a-attendance-review.json
node scripts/build-payout.mjs --config events/event-a.json \
  --checkins private/event-a-after.csv --extra-checkins private/event-a-door.csv \
  --out out-event-a --provenance-review private/event-a-attendance-review.json
```

Omit `--manual`/`--extra-checkins` when no manual list is used. Review the proposed list and payout
summary before signing. Personal attended history, booth visits, merch state and marketing consent
cannot authorize financial attendance. Unknown stakers require explicit reconciliation; `--allow-missing`
retains its existing warning and must not silently turn unmatched identities into no-shows.

Action plans bind source/config hashes, schema/parser version, snapshot block/hash, owner and registered
staker set. CLI and event-aware console refresh authoritative state before signing. Rebuild after a
change; manual review cannot override a stale plan. Static Safe files cannot refresh themselves:
regenerate and compare with current checked state before signing. Legacy unbound intermediates must
be regenerated. Local review files are operator records, not signatures from Luma; protect them with
OS permissions and use authenticated unified routes for multi-user operation.

Known metadata headers include event IDs, Luma IDs/URLs, chain IDs and contract addresses, normalized
for case/spaces. A CSV can omit all of them. Explicit review remains mandatory even when metadata
agrees, because locally editable labels are not provider attestations.

Guest pages now take their event title, schedule, venue, hosts, network and optional Luma URL from
config. New configs with `eventId` default to `metaevidence.event-v1.template.json`; historical configs
keep the original template. Source edits cannot alter any already-deployed immutable policy/template.
