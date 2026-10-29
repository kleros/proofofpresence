# Kleros Events: source inventory for the redesign

## Evidence boundary and snapshot

All findings labelled **OBSERVED (SOURCE)** below come from static files in `weiwei-ooi/kleros-events`, default branch `main`, pinned commit `fa732b8ea20e57648516b6e46e1076c0bf2ab434` (commit timestamp 2026-10-28T10:49:03Z, “Security fixes from the 28 October review”). No browser, rendered screenshot, installed dependencies, build, runtime test, database or production configuration was inspected by this inventory agent. **ESTIMATE** denotes design interpretation rather than a measured rendered fact. Source-recorded deployment URLs are not evidence of live availability.

## Public URLs and route inventory

**OBSERVED (SOURCE):** [README](https://github.com/weiwei-ooi/kleros-events/blob/fa732b8ea20e57648516b6e46e1076c0bf2ab434/README.md), [deployment guide](https://github.com/weiwei-ooi/kleros-events/blob/fa732b8ea20e57648516b6e46e1076c0bf2ab434/docs/deploy-netlify.md), [site constants](https://github.com/weiwei-ooi/kleros-events/blob/fa732b8ea20e57648516b6e46e1076c0bf2ab434/src/lib/kleros.ts), and [Next configuration](https://github.com/weiwei-ooi/kleros-events/blob/fa732b8ea20e57648516b6e46e1076c0bf2ab434/next.config.ts).

| Exact URL | What the source establishes |
| --- | --- |
| https://events.kleros.io | Intended primary custom domain; also recorded in deployment/auth configuration instructions. Live state unverified here. |
| https://kleros-events.vercel.app | Recorded previous/parallel host and repository homepage. Deployment guide recommends retaining it because existing share links or QR codes may use it. |
| https://kleros-events.netlify.app | Example hostname in instructions; do not present it as a verified deployment. |
| https://luma.com/user/kleros_io | Global external Luma profile link. |
| http://localhost:3000 | Final development fallback for the site URL. |

Site URL selection is `NEXT_PUBLIC_SITE_URL`, then `NETLIFY_SITE_URL`, then the HTTPS `NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL`, then localhost. Netlify configuration maps its build `URL` into `NETLIFY_SITE_URL`. HTTPS Supabase image hosts are permitted in Next image configuration. The deployment guide says the Vercel and Netlify deployments share a Supabase database; this is a source assertion, not independently verified infrastructure.

Source routes include `/`, `/events`, `/events/[slug]`, `/talks`, `/talks/[id]`, `/me`, `/login`, `/admin`, `/admin/events/new`, `/admin/events/[id]`, `/admin/access`, `/admin/team`, `/admin/recordings`, `/events/[slug]/host`, `/events/[slug]/live`, `/events/[slug]/screen`, `/q/[slug]`, and `/record`. Dynamic routes require actual identifiers and may require authentication. No deposit, payout-claim, or dispute-management route was identified in this repository.

## Typography and tokens

**OBSERVED (SOURCE):** [root layout](https://github.com/weiwei-ooi/kleros-events/blob/fa732b8ea20e57648516b6e46e1076c0bf2ab434/src/app/layout.tsx) imports three Google fonts through `next/font/google`: Instrument Serif, Geist and Geist Mono. Instrument Serif is declared at weight 400, normal and italic, assigned to `--font-display`; Geist to `--font-body`; Geist Mono at weights 400/500/600 to `--font-mono`. All request the Latin subset. The source comments call these Kleros house faces; that is repository design intent rather than independently checked brand policy.

The [global stylesheet](https://github.com/weiwei-ooi/kleros-events/blob/fa732b8ea20e57648516b6e46e1076c0bf2ab434/src/app/globals.css) declares:

| Role | Source declaration |
| --- | --- |
| Body | Geist, system-ui, sans-serif; 17px / 1.6 |
| h1 | Instrument Serif, Georgia, serif; weight 400; `clamp(2rem, 4.4vw, 3.1rem)` / 1.1 |
| Hero title | `clamp(2.4rem, 5vw, 3.7rem)` / 1.04 |
| Section heading | Display serif; 1.85rem / 1.15 |
| Default h2/h3 | Body sans; weight 600; 1.25rem / 1.02rem; negative 0.015em tracking |
| Card title | Sans; 1.08rem / 1.3 |
| Eyebrow | 0.75rem, weight 500, uppercase, 0.08em tracking |
| Numeric/technical labels | Geist Mono; tabular numbers |

Exact CSS colors:

```css
--bg: #17131F;
--bg-deep: #120F19;
--surface: #201A2B;
--sunk: #2A2336;
--line: #352D44;
--fg: #E6E1EE;
--white: #F2EEF7;
--muted: #A69FB5;
--accent: #A78BFA;
--accent-ink: #17131F;
--accent-soft: rgb(167 139 250 / 0.16);
--lavender: #C4B5FD;
--stroke: #A78BFA;
--cyan: #7DD3E8;
--blue: #7DD3E8;
--blue-soft: rgb(125 211 232 / 0.12);
--good: #86D9B4;
--good-soft: rgb(134 217 180 / 0.12);
--warn: #F0C08A;
--warn-soft: rgb(240 192 138 / 0.12);
--rec: #F07A8A;
--stage: #120F19;
--stage-fg: #ECE7F3;
--gold: #C4B5FD;
```

The stylesheet sets `color-scheme: dark`. Spacing steps are 4, 8, 12, 16, 24, 32, 48 and 64px. Default/small radii are 14/8px. The main wrapper caps at 1180px, with 16px side padding and safe-area handling. Header height token is 57px. Focus-visible uses a 2px accent outline with 2px offset. Primary buttons use the accent fill, dark ink, weight 600 and 8px radius. These are declarations, not measurements of actual pixels or accessibility pass results.

## Layout, navigation and browsing

**OBSERVED (SOURCE):** [SiteHeader](https://github.com/weiwei-ooi/kleros-events/blob/fa732b8ea20e57648516b6e46e1076c0bf2ab434/src/components/SiteHeader.tsx), [NavLinks](https://github.com/weiwei-ooi/kleros-events/blob/fa732b8ea20e57648516b6e46e1076c0bf2ab434/src/components/NavLinks.tsx), [SiteFooter](https://github.com/weiwei-ooi/kleros-events/blob/fa732b8ea20e57648516b6e46e1076c0bf2ab434/src/components/SiteFooter.tsx), [EventBrowser](https://github.com/weiwei-ooi/kleros-events/blob/fa732b8ea20e57648516b6e46e1076c0bf2ab434/src/components/EventBrowser.tsx), and the global stylesheet.

The header is sticky, uses a translucent dark background with blur and a bottom border, and contains the white Kleros logo, a separator and italic lavender “Events”. Its links are Events, Talks, external Luma, conditional Team, then My events or Sign in depending on authentication. Active links use `aria-current` and an accent-soft background. The inspected implementation wraps navigation; no hamburger control was identified. The root shell also includes a footer and an Ask launcher. Footer groups include Events, Kleros, Follow, and a short protocol description.

Hero CSS specifies a two-column 1.25fr/1fr composition with a 48px gap, display heading, featured-event area, violet radial gradients and a faint symbol. Browser rendering has not been verified.

The event browser provides All/Upcoming/Past and List/Calendar segmented controls, search by name/city/topic, topic and format selects, result counts and a clear-filters action. Calendar mode disables the timeline control, displays Monday-first weekdays, supports month navigation and links its cells to events; matching cards follow. Empty states can link to Luma. Only the timeline/view selections are persisted in URL query parameters; search/topic/format are not. The card grid declares three columns, two at widths at or below 960px, and one at or below 600px.

## Cards and event detail

**OBSERVED (SOURCE):** [EventCard](https://github.com/weiwei-ooi/kleros-events/blob/fa732b8ea20e57648516b6e46e1076c0bf2ab434/src/components/EventCard.tsx), [event detail page](https://github.com/weiwei-ooi/kleros-events/blob/fa732b8ea20e57648516b6e46e1076c0bf2ab434/src/app/events/%5Bslug%5D/page.tsx), and [AttendanceButtons](https://github.com/weiwei-ooi/kleros-events/blob/fa732b8ea20e57648516b6e46e1076c0bf2ab434/src/components/AttendanceButtons.tsx).

An entire card links to its event. Cards have a 16:9 cover, using supplied media or a generated city/event-type cover with the Kleros symbol. A date tile appears at top left, with one status tag at top right. Status priority is Private, Draft, Happening now, then Example. Body content includes date range, a two-line title, role/type pills, two-line description and optional recommendation/personal indicators. Footer content combines location with a talk, material or going count. Host/cohost roles use violet; participating roles use cyan. Cards have a surface fill, thin border, 14px corners and a 2px upward hover translation. No commitment amount, asset, verified check-in status, payout or dispute indicator appears in the inspected card.

Event details contain breadcrumbs, title, date/time/timezone, venue, role/type/status pills and a hero cover. Upcoming external ticket links are labelled “RSVP on Luma” when their URL contains `luma` or `lu.ma`; other URLs use “Get tickets”. Authorized team/private collaborators can see Run this event, Record session and Edit actions. Section anchors can include About, Talks, Slides & links, Agenda, Kleros team, Ask the speaker and Meet Kleros. The sidebar includes selected content/attendance counts, Save/Going/I was there controls, private notes and event metadata. The Meet Kleros form is omitted for private events because its inbox is team-wide. Signed-out unknown and private URLs use an indistinguishable sign-in gate; authorized data lookup uses RLS.

“I was there” is self-declared attendance and is unsuitable as payout authorization. Existing Court/Escrow links are product promotions; they do not establish integrated escrow or arbitration in this app.

## Administration and financial integration gap

**OBSERVED (SOURCE):** [admin desk](https://github.com/weiwei-ooi/kleros-events/blob/fa732b8ea20e57648516b6e46e1076c0bf2ab434/src/app/admin/page.tsx), [admin stylesheet](https://github.com/weiwei-ooi/kleros-events/blob/fa732b8ea20e57648516b6e46e1076c0bf2ab434/src/app/styles/admin.css), [LumaSync](https://github.com/weiwei-ooi/kleros-events/blob/fa732b8ea20e57648516b6e46e1076c0bf2ab434/src/components/admin/LumaSync.tsx), and [types](https://github.com/weiwei-ooi/kleros-events/blob/fa732b8ea20e57648516b6e46e1076c0bf2ab434/src/lib/types.ts).

The team-gated “Events desk” has Add event, Luma sync status/action, and Upcoming/Past/Drafts/Private/Meeting requests tabs. Rows show date, event title, role/location, status tags, going/material counts, and Run live/Edit/View. CSS sets desktop row columns to 170px / flexible / 130px / auto; at 860px it changes to two columns with full-width date/actions. Editor headers are sticky on desktop and static below that breakpoint; narrow forms cap at 860px and editor bodies at 980px.

There are no inspected admin actions for funding totals, verified check-in reconciliation, attendance proposals, claims, disputes or chain/contract selection. Event types represent content and coordination rather than a financial state machine. Luma sync imports public event metadata; it does not establish a guest-to-wallet or guest-to-deposit identity. Editorial permissions must not silently become financial settlement authority.

## Exact source assets saved for mockups

**OBSERVED (SOURCE):** The original [white logo SVG](https://github.com/weiwei-ooi/kleros-events/blob/fa732b8ea20e57648516b6e46e1076c0bf2ab434/public/kleros-logo.svg) and [white symbol SVG](https://github.com/weiwei-ooi/kleros-events/blob/fa732b8ea20e57648516b6e46e1076c0bf2ab434/public/kleros-symbol.svg) were copied without transformation to `../assets/kleros-logo.svg` and `../assets/kleros-symbol.svg`. See `../assets/ASSET_PROVENANCE.md` for hashes and licensing limitations. The complete, non-truncated recursive Git tree contains no committed `.woff`, `.woff2`, `.ttf`, `.otf` or `.eot` font assets. The app relies on Next's font loader. Do not claim offline mockups use the exact web fonts unless those fonts have actually been supplied and loaded.

## Interpretation and unresolved visual checks

**ESTIMATE:** The source implies a dark violet event/content directory with serif display headings, compact sans-serif controls and calendar/card discovery. These assets and tokens are a useful starting point; the user's permission to rebuild means they are not mandatory constraints. A future event commitment panel could sit beside the event's registration/attendance actions, but that placement is a design proposal, not existing functionality.

Rendered spacing, actual font loading, live page contents, responsive overflow, keyboard flow, tap targets, contrast, overlays and authenticated admin views remain unverified. The browser owner should capture explicit desktop/mobile viewports and label any inaccessible screens as source-based reconstructions. Preserve or deliberately migrate/link private events, media, talks, Q&A and historical URLs when selecting a new product foundation. Do not derive attendee financial eligibility from Luma metadata, editorial roles or the existing self-reported attendance controls.


## Packaging update

The source-only inventory above records its original scope. Exact fonts were subsequently retrieved from the observed live deployment for the redesign. See `../assets/FONT_PROVENANCE.json` and `../assets/ASSET_PROVENANCE.md` for those later observations, hashes, and bundled license notices.
