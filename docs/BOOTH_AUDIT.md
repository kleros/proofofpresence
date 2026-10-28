# Booth boundary audit

Inspected 28 October 2026. Checkout: `references/booth`, clean `main`, commit `169220bb41787b8aabdec5190ab85379328f143f`. This matches the supplied snapshot. No production endpoint, Sheet, Ghost, Telegram, credential, or personal record was accessed. Source inspection and three offline VM tests are the evidence below; live deployment behavior remains unverified.

## Retain as a separate marketing module

The static booth app remains a linked service at its existing URL. This delivery does not migrate its lead/consent data, rehost its live configuration, or repurpose merch tickets as attendance credentials. The new financial check-in path must accept only event-bound trusted staff/manual/Luma evidence linked to verified participants. Neither a booth lead, its `Claim`/`Tier`, newsletter confirmation nor the events app's personal history may create a staker or payout list.

This preserves the existing public QR destination, Apps Script/Sheet records, research matching, follow-up requests and optional newsletter consent without introducing their trust model into custody. No booth source changes were made.

## Confirmed findings

| Finding | Current source evidence | Consequence / transition boundary |
|---|---|---|
| Live writes in committed configuration | `site/config.js` contains a live Apps Script `/exec`; `Code.gs` also records it as `WEB_APP_URL` | Never run the retained site with its committed config during development. Local financial UI does not load this file. |
| Global state | `site/index.html:771` uses `kleros_devcon_self`, `kleros_devcon_queue`, `kleros_devcon_demo_leads`; `connect.html:166` shares the identity and global Connect queue | Tickets and queued records are not scoped to edition/environment. A future migration must quarantine legacy keys before enabling a different endpoint. |
| Demo newsletter queue remains eligible for future delivery | Submission (`index.html:1545`) adds opted-in email to `K_BLOG` even with blank endpoint; `flushBlog` (`:924`) merely returns while endpoint is blank | Reproduced offline: switching the endpoint later causes the actual legacy function to perform its token GET and magic-link POST via mocked fetch. A hash or demo label does not prevent delivery. |
| Demo Connect queue remains eligible for future delivery | `connect.html:211` returns with the queued records while endpoint is blank; same queue is flushed after endpoint changes | Reproduced offline using the actual function and mocked fetch. Keep the legacy site outside the local demo origin/profile. |
| Financial attendance is absent | `Code.gs` has no `registerStakers`, `postAttendance`, `resolveChallenge` or contract client; client ticket and `verify_` operate on marketing records | No existing integration makes a merch ticket valid financial attendance. This separation must remain explicit. |
| Server check-in validation is weaker than the form | `checkIn_` (`Code.gs:486`) requires truthy id/ticket/name/company; interests are joined without a type check; email/event provenance are not validated | If migrated, require typed bounded fields, canonical stable event identity, authenticated staff updates, and event-scoped uniqueness. |
| Cross-event uniqueness | `claim_` (`:778`) scans emails/Claim through the full Sheet; `tgUpdate_` (`:878`) scans all Telegram rows without Event; Connect email lookup also ignores Event | One email/account can be marked already claimed in another edition. Do not use this lookup to match financial participants. |
| Dashboard drops Event | `fromRaw`/`fromRow` (`admin.html:182`) and CSV columns (`:408`) omit Event | A future authorized export must include the original Event column and stable ID mapping, rather than treating dashboard CSV as complete provenance. |
| Merch conflates newsletter in dashboard | `setMerch` (`admin.html:402`) sets `lead.newsletter = 'Confirmed'` after successful handover | Server permits handover to opt-outs or with gate disabled; client display can falsely claim consent confirmation. Preserve raw consent values on any migration and store handover separately. |
| Shared bearer authorization | `authorised_` (`Code.gs:407`), dashboard localStorage key (`admin.html:173`) and `GET ?action=merch...&key=` (`:399`) | This is a separate operational access model, not a role source for financial organizer/staff authority. No key value was read. |
| Packaging mutates source | `scripts/apps-script-bundle.sh` copies `site/matching.js` into `apps-script/Matching.gs`; package script runs it | Packaging is not read-only. Neither script was executed. |

## Intentional trust assumptions

The optional newsletter box starts unchecked. `verify_` allows newsletter `No` through and `gateOn_` controls waiting for opted-in users. Documentation records the gate as off for Devcon, but live Script Properties were not inspected. Early README setup prose still says everyone must wait; later sections and source supersede it.

X/LinkedIn are counted on tap. `verify_` accepts client-reported quiz completion and social taps; `tier_` derives Teal/Purple/Gold. This is the recorded promotional design, not evidence of physical presence or wallet ownership. Telegram membership is separately checked by the bot, but still does not prove attendance at a financial event. Public static QR visits and the ticking visual ticket are not signed individual attendance credentials.

The backend already uses script locks for check-in/Connect writes and first email claims; do not report it as lacking all concurrency control. `verify_` and merch updates still deserve targeted concurrency testing before a booth migration. A lost-update exploit was not reproduced.

## Offline verification

Executed `node --test test/legacy-boundaries.test.mjs` on Node 25.8.1: **3 passed, 0 failed**. Tests execute unchanged legacy queue/tier functions inside a VM; `fetch` is an injected mock with no networking. They demonstrate two existing queue-transition risks and the promotional nature of merch state. Passing here means the documented risk was reproduced, not repaired or production-certified.

No dependency installation or browser startup was needed for this read-only audit. No live emails/messages/records were sent.

## Architecture assessment

| Option | Assessment from the booth boundary |
|---|---|
| A: adapters across three apps | Preserves operations, but adds another release/auth/config boundary and makes wrong-event transport easier. A separate booth link is useful; a financial attendance adapter is unsafe without a staff/identity redesign. |
| B: events app foundation | Reuses content and private-event access. It also requires Supabase setup and careful role separation before a clean synthetic demo. Booth migration remains independent and is not a reason to expand this app. |
| C: clean modular finance shell, retained compatibility modules | Best bounded path for the first coherent two-event finance/check-in experience, provided v7 contract/ABI/settlement and original content/private access remain intact. A local chain can exercise real financial behavior while linked content/booth services retain existing data and URLs. |

Recommend C with separate per-event unchanged v7 contracts and an explicit trusted deployment catalog. Preserve content/media/Q&A as linked module and booth as a separate marketing service. Production integration of the booth requires a separately authorized export, event-ID mapping, consent reconciliation, queue quarantine and authenticated staff service; it is deferred, not claimed implemented.
