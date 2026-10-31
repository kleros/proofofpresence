# Deposit page presentation patterns

Updated 31 October 2026. This document records UI patterns; deployment and
financial-flow verification have separate checks.

Files: `public/first-event/index.html`, `public/first-event/styles.css`.

| Property | Pattern |
| --- | --- |
| Surfaces | Existing `--paper`, `--surface`, and inset `--deep`; restrained `--raised` countdown and step markers |
| Border | 1px `--line`; receipt confirmation uses existing green with explicit text status |
| Radius | Existing 14px cards, 8px controls, 10px inset reward example/receipt |
| Text | Instrument Serif section headings; Geist body, metadata, and tabular numeric amounts; monospace wrapping hashes |
| Color | `--heading`/`--ink` primary, `--muted` explanatory text, `--purple` links, `--teal` kickback result |
| Spacing | 28px desktop/22px mobile cards; 13px numbered-step gaps; 18–24px between related groups |
| Controls | Existing minimum 44px targets and 3px lavender keyboard focus; compact trust links retain normal text labels |

The commitment summary sits directly below the event date/timezone. Unique depositor
wallets and cumulative received ETH are historical receipt facts; they are neither
confirmed registration nor the current reward balance. Keep the exact contract and
chain explicit. Unavailable values use an em dash without blocking initial display.

Keep the payment action ahead of education. The admission card distinguishes payment,
organizer registration, and financial attendance. A receipt must show its explicit
pending/recorded/confirmed/failed label; the full hash wraps, with a copy control and
an explorer link. Saved facts never become transaction authority.

The example explains possible no-show redistribution, not promised yield. The event
timeline separates event time, attendance posting and its 24-hour challenge window,
and organizer finalization/payout release. Payouts are sent to wallets; recovery of a
failed delivery is separate. Open cases hold only disputed shares. Do not invent a
fixed payout date from the event end or label the safety-net deadline as payout start.

The reward equation becomes a stacked total on narrow screens. Statuses always use
text, and countdown ticks should not repeatedly announce through an ARIA live region.

Audit simplification: combine the three-step explanation and countdown timeline in
one journey card. Keep the event schedule in the first step, posted attendance
deadlines in the second, and automatic payout/recovery status in the third. The
no-show example follows those steps; do not repeat the journey in a second card.

The main wallet action stays ahead of education. QR/address transfer is an optional
native details control, with a minimum 44px summary and existing keyboard focus.
The exact address and QR remain inside that disclosure; the compact Contract trust
link stays visible outside it. Completed payment states hide the whole manual
option. Keep prior-event recovery in a secondary native disclosure without changing
its original event/contract destination.

## Shared event pages

Home, event setup, Manage Event and deposit recovery use `public/luma-launch.css`
with the same palette and local fonts as the deposit page. Keep page headings in
Instrument Serif, supporting text in Geist, and wallet addresses in wrapped mono.
Use 14px surface cards with 28px padding (22px on phones), 8px input/button radii,
cyan primary actions and lavender focus outlines. Functional dashboards may be
wider than the guest deposit card.

Manage Event uses an unboxed event heading and a compact facts strip. Its wallet
bar precedes the guest list in both visual and keyboard order. Guest rows retain
separate admission, door check-in and owner attendance states; on phones they
become labeled cards. Receipt and address links remain fully available.

Owner attendance review follows the guests. Team and ownership settings and
participant tools use native disclosures to keep the initial page focused.
Pending ownership acceptance opens the team disclosure automatically. Hidden and
disabled controls retain their existing permissions and transaction safeguards.
