import {
  makeLumaLaunchFixture,
  LUMA_LAUNCH_EVENT_ID,
} from "./luma-launch-fixture.mjs";
import { FIXTURE_WALLET } from "./production-ui-fixture.mjs";

// TEST ONLY. Public catalog and authorized-owner summaries contain no live event data.
export const PUBLIC_SEARCH_TITLE =
  'Alpha <img id="public-event-search-xss" src="invalid" onerror="alert(1)"> workshop';
export const PUBLIC_SEARCH_A = LUMA_LAUNCH_EVENT_ID;
export const PUBLIC_SEARCH_B = "public-search-event-b";
export const PRIVATE_SEARCH_TITLES = [
  "PRIVATE OWNER EVENT",
  "OWNER DRAFT EVENT",
  "MISSING VISIBILITY EVENT",
  "MISSING PUBLICATION EVENT",
  "MALFORMED ID EVENT",
  "WRONG PROFILE EVENT",
  "WRONG CHAIN EVENT",
];
export function makePublicEventSearchFixture({
  signedOwner = false,
  empty = false,
} = {}) {
  const root = makeLumaLaunchFixture("root");
  const details = {};
  for (const [id, date, phase, contract] of [
    [
      PUBLIC_SEARCH_A,
      "2027-01-15T09:00:00.000Z",
      "Open",
      "0x" + "4".repeat(40),
    ],
    [
      PUBLIC_SEARCH_B,
      "2027-01-16T09:00:00.000Z",
      "Finalized",
      "0x" + "8".repeat(40),
    ],
  ]) {
    const fixture = makeLumaLaunchFixture(signedOwner ? "ready" : "anonymous", {
      eventId: id,
      lumaUrl: "https://luma.com/" + id,
    });
    Object.assign(fixture.detail.event, {
      title: PUBLIC_SEARCH_TITLE,
      visibility: "public",
      editorialStatus: "published",
      startsAt: date,
      endsAt: new Date(Date.parse(date) + 2 * 3600000).toISOString(),
      timezone: "UTC",
      financialPhase: phase,
      contract,
    });
    fixture.detail.state.phase = phase;
    fixture.detail.payments.contract = contract;
    if (fixture.detail.ownWallet) {
      fixture.detail.ownWallet.deposit.contract = contract;
      if (phase === "Finalized")
        fixture.detail.ownWallet.depositAction = {
          eligible: false,
          amountWei: "0",
          reasonCode: "EVENT_NOT_OPEN",
          reason: "Synthetic event is finalized",
        };
    }
    details[id] = fixture.detail;
  }
  const a = structuredClone(details[PUBLIC_SEARCH_A].event);
  const unsafe = (id, title, patch) => ({
    ...structuredClone(a),
    id,
    title,
    role: "owner",
    ...patch,
  });
  const missingVisibility = unsafe(
    "missing-visibility",
    PRIVATE_SEARCH_TITLES[2],
    {},
  );
  delete missingVisibility.visibility;
  const missingPublication = unsafe(
    "missing-publication",
    PRIVATE_SEARCH_TITLES[3],
    {},
  );
  delete missingPublication.editorialStatus;
  root.bootstrap.events = empty
    ? []
    : [
        {
          ...a,
          organizerEmail: "SHOULD_NOT_PROJECT@example.test",
          privateNotes: "SHOULD_NOT_PROJECT",
        },
        structuredClone(details[PUBLIC_SEARCH_B].event),
        unsafe("private-owner", PRIVATE_SEARCH_TITLES[0], {
          visibility: "private",
        }),
        unsafe("owner-draft", PRIVATE_SEARCH_TITLES[1], {
          editorialStatus: "draft",
        }),
        missingVisibility,
        missingPublication,
        unsafe("bad-id/#view=organizer", PRIVATE_SEARCH_TITLES[4], {}),
        unsafe("wrong-profile", PRIVATE_SEARCH_TITLES[5], {
          contractVersion: "kleros-event-v8",
          abiVersion: "kleros-event-v8",
        }),
        unsafe("wrong-chain", PRIVATE_SEARCH_TITLES[6], { chainId: 10200 }),
      ];
  if (signedOwner)
    root.bootstrap.session = {
      wallet: FIXTURE_WALLET,
      label: "Synthetic owner",
      mode: "wallet",
    };
  root.detail = details[PUBLIC_SEARCH_A];
  return { ...root, publicDetails: details };
}
