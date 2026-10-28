# Two-event local demonstration

Start fresh with `npm run build && npm run demo`, then open `http://127.0.0.1:3000`.
Restart resets synthetic state. Amounts below are valueless local ETH. All financial balances are
read from v7 contracts. Court votes/finality are driven by explicitly labeled mocks.

1. Choose **Alice**. Review and confirm a 0.01 ETH deposit in **Proof of Presence (A)**. Open
   **Open Justice Workshop (B)** and confirm 0.02 ETH. Verify different contract identities and receipts.
   Repeat **Bob** in A for the challenged participant. Optional: Carol in A for mixed outcomes.
2. As **Organizer A**, approve Alice/Bob (and Carol if used), then review/register the verified
   stakers. As **Organizer B**, independently approve/register Alice. Free guests remain outside pools.
3. Advance one hour, then check in Alice A as **Door staff A**. Staff A has no B authority.
   For CSV demonstration use A's fixture after its start: importing without the explicit origin
   review is refused; review the export source and retry. An A-stamped file imported into B is
   always refused, including with a manual review.
4. Organizer A reviews and posts Alice's attendance. As Bob, challenge the omission; as another
   wallet, review/match Bob's challenge before its separate one-day deadline.
5. Advance one day + one second. As any authenticated identity, release A's normal payouts.
   Alice receives a normal share; Bob's provisional share remains in `heldBack`. Inspect the
   separate resolver local ID, arbitrator ID and challenge escrow.
6. B remains independent: after its own start, Organizer B can import a reviewed historical check-in
   timestamp within B's schedule, post attendance and finish B while A's case is unresolved.
   If the door is still open, authenticated B staff/owner can use live check-in instead.
7. Organizer A's **Local Court mock controls** can finalize Attended, Absent or Refused. Then
   explicitly review/settle the case through the original event contract. Attended gets the entire
   accumulated held share; absent/refused redistributes it. Refusal also splits remaining challenge
   deposits. No real Court case or IPFS upload occurs.
8. Inspect evidence/appeal controls, local publication status, reserve accounting and recovery actions.
   Early cancellation/no-list withdrawal/duplicate claims are refused by their actual contract rules.
   Create a third fresh local event to explore cancellation or advance beyond its deadline for no-list
   recovery. Automated tests also exercise failing contract recipients and alternate-address claims.

Optional real browser wallet: connect, sign the local nonce, explicitly fund with the **local** faucet,
register contact interest and review an early deposit. The UI rechecks chain/account/state immediately
before requesting the wallet transaction. Never import a real private key into this project.

The browser suite automates a comparable flow and saves `artifacts/demo-desktop.png` and
`artifacts/demo-mobile.png`. Mixed late winner/loser orders and integer rounding are verified in EVM
tests, not simulated with hardcoded interface values.
