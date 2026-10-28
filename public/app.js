// @ts-check
/** @param {string} selector @param {ParentNode} [parent] @returns {any} DOM selectors have element types determined by their HTML IDs. */
const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [
  ...parent.querySelectorAll(selector),
];
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const short = (value) =>
  value ? `${String(value).slice(0, 7)}…${String(value).slice(-5)}` : "—";
const same = (a, b) =>
  a && b && String(a).toLowerCase() === String(b).toLowerCase();
const addressList = (value) =>
  String(value ?? "")
    .split(/[\s,;]+/)
    .filter(Boolean);
const eth = (value) => {
  try {
    const n = BigInt(value ?? 0);
    const w = n / 1000000000000000000n;
    const fraction = (n % 1000000000000000000n)
      .toString()
      .padStart(18, "0")
      .replace(/0+$/, "");
    return `${w}${fraction ? `.${fraction}` : ""}`;
  } catch {
    return "—";
  }
};
const toWei = (value) => {
  if (!/^\d+(\.\d{1,18})?$/.test(value))
    throw new Error("Enter an ETH amount with at most 18 decimal places.");
  const [whole, fraction = ""] = value.split(".");
  return String(
    BigInt(whole) * 1000000000000000000n + BigInt(fraction.padEnd(18, "0")),
  );
};
const formatDate = (value, timezone, options = {}) => {
  if (!value) return "Not set";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: timezone ?? "UTC",
      ...options,
    }).format(
      new Date(
        typeof value === "number"
          ? value > 1e12
            ? value
            : value * 1000
          : value,
      ),
    );
  } catch {
    return String(value);
  }
};
const formatTime = (value, timezone) =>
  formatDate(value, timezone, {
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
const badge = (text, style = "") =>
  `<span class="badge ${style}">${escape(text)}</span>`;
const phaseName = (value) =>
  typeof value === "number"
    ? (["Open", "Listed", "Finalized", "Cancelled"][value] ?? String(value))
    : String(value ?? "Unknown");
const phaseStyle = (value) =>
  ({ Open: "green", Listed: "amber", Finalized: "purple", Cancelled: "red" })[
    phaseName(value)
  ] ?? "";
const actionNames = {
  deposit: "Make a deposit",
  register: "Register verified stakers",
  reject: "Reject and refund",
  postAttendance: "Post attendance list",
  challenge: "Challenge an omission",
  match: "Match attendance challenge",
  addAttendees: "Correct attendance",
  resolve: "Settle final ruling",
  release: "Release payouts",
  cancel: "Cancel event",
  emergencyWithdraw: "Emergency withdrawal",
  claim: "Claim failed transfer",
  refund: "Return unmatched ETH",
  sweep: "Sweep spare ETH",
  transferOwnership: "Start ownership transfer",
  acceptOwnership: "Accept ownership",
  passPeriod: "Advance expired appeal period",
  deliverRuling: "Deliver final Court ruling",
  evidence: "Submit evidence",
  fundAppeal: "Contribute to appeal",
  appealRewards: "Claim appeal rewards",
};
const app = {
  bootstrap: null,
  detail: null,
  route: { eventId: null, view: "participant" },
  generation: 0,
  draft: null,
  busy: false,
};
let toastTimer;

async function api(path, options = {}) {
  const result = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  let data;
  try {
    data = await result.json();
  } catch {
    throw new Error(`The local server returned ${result.status}.`);
  }
  if (!result.ok)
    throw Object.assign(
      new Error(data.error ?? `Request failed (${result.status})`),
      { code: data.code },
    );
  return data;
}
const post = (path, data) =>
  api(path, { method: "POST", body: JSON.stringify(data) });
const eventPath = (suffix) =>
  `/api/events/${encodeURIComponent(app.route.eventId)}${suffix}`;
function toast(message, error = false) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").classList.toggle("error", error);
  $("#toast").hidden = false;
  toastTimer = setTimeout(
    () => {
      $("#toast").hidden = true;
    },
    error ? 11000 : 6500,
  );
}
function invalidateDraft() {
  app.draft = null;
  const dialog = $("#review-dialog");
  if (dialog.open) dialog.close();
}
function navigate(eventId, view = "participant") {
  location.hash = eventId
    ? new URLSearchParams({ event: eventId, view }).toString()
    : "";
}
function readRoute() {
  const params = new URLSearchParams(location.hash.slice(1));
  return {
    eventId: params.get("event"),
    view: ["participant", "organizer", "cases"].includes(params.get("view"))
      ? params.get("view")
      : "participant",
  };
}
function currentIdentity() {
  return app.bootstrap?.session ?? null;
}
function isOwner() {
  return same(currentIdentity()?.wallet, app.detail?.state?.owner);
}
function isStaff() {
  return (
    isOwner() ||
    app.detail?.event?.role === "staff" ||
    app.detail?.permissions?.staff === true
  );
}
function ownParticipant() {
  return app.detail?.participants?.find((person) =>
    same(person.wallet, currentIdentity()?.wallet),
  );
}
function isIn(list, wallet) {
  return (list ?? []).some((item) =>
    same(typeof item === "string" ? item : item.wallet, wallet),
  );
}
function showDialog(html) {
  $("#dialog-body").innerHTML = html;
  const dialog = $("#review-dialog");
  if (!dialog.open) dialog.showModal();
}

function identityOptions() {
  const session = currentIdentity();
  return `<option value="">Select a local demo identity</option>${session?.mode === "wallet" ? `<option value="connected-wallet" selected>Connected wallet · ${escape(short(session.wallet))}</option>` : ""}${(app.bootstrap?.identities ?? []).map((identity) => `<option value="${escape(identity.id)}" ${same(identity.wallet, session?.wallet) ? "selected" : ""}>${escape(identity.label)} · ${escape(short(identity.wallet))}</option>`).join("")}`;
}
function sidebar() {
  const events = app.bootstrap?.events ?? [];
  $("#event-count").textContent = events.length;
  $("#all-events-link").classList.toggle("active", !app.route.eventId);
  $("#sidebar-events").innerHTML = events
    .map(
      (event) =>
        `<a class="sidebar-event ${event.id === app.route.eventId ? "selected" : ""}" href="#${new URLSearchParams({ event: event.id, view: "participant" })}">${escape(event.title)}</a>`,
    )
    .join("");
  $("#breadcrumb").innerHTML = app.route.eventId
    ? `Workspace <span>/</span> <a href="#">Events</a> <span>/</span> <strong>${escape(app.detail?.event.title ?? "Loading")}</strong>`
    : "Workspace <span>/</span> <strong>All events</strong>";
  let identity = $("#top-identity");
  if (!identity) {
    identity = document.createElement("button");
    identity.id = "top-identity";
    identity.type = "button";
    identity.className = "button button-small button-secondary";
    $(".topbar-actions").insertBefore(identity, $("#refresh"));
  }
  identity.textContent = currentIdentity()?.label ?? "Choose identity";
  identity.onclick = showIdentityDialog;
}
function showIdentityDialog() {
  invalidateDraft();
  showDialog(
    `<div class="dialog-eyebrow">Local demonstration</div><h2 class="dialog-title" id="dialog-title">Choose a demo identity</h2><p class="dialog-body-text">Each demo identity controls a funded wallet on the isolated local chain. This selector simulates authentication. Or connect your browser wallet and prove ownership with a nonce signature.</p><label for="dialog-identity">Act as</label><select id="dialog-identity" data-identity>${identityOptions()}</select><div class="notice">Organizers A and B have separate authority. Alice, Bob and Carol can participate in both events. Staff A can check in only Event A.</div><div class="button-row"><button class="button button-secondary" data-connect-wallet>Connect browser wallet to local chain</button>${currentIdentity()?.mode === "wallet" ? '<button class="button button-secondary" data-fund-wallet>Receive 1 local ETH</button>' : ""}</div><p class="field-help">Browser wallets must use local chain 1337. Funding and all transactions use local ETH with no monetary value.</p><div class="dialog-buttons"><button class="button button-secondary" data-close>Close</button>${currentIdentity() ? '<button class="button button-quiet" data-logout>Sign out</button>' : ""}</div>`,
  );
}
async function switchIdentity(id) {
  if (id === "connected-wallet") return;
  invalidateDraft();
  if (!id) await api("/api/session", { method: "DELETE" });
  else await post("/api/session", { identity: id });
  await load();
  toast(
    id
      ? "Demo identity changed. Previous transaction drafts were cleared."
      : "Signed out.",
  );
}

function walletProvider() {
  const provider = /** @type {any} */ (window).ethereum;
  if (!provider?.request)
    throw new Error(
      "No browser wallet was found. Use a demo identity or open this local app in a browser with a wallet extension.",
    );
  return provider;
}
async function connectWallet() {
  invalidateDraft();
  const provider = walletProvider();
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!accounts?.[0]) throw new Error("No wallet account was selected.");
  let chain = await provider.request({ method: "eth_chainId" });
  if (Number(BigInt(chain)) !== 1337) {
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x539" }],
      });
    } catch (error) {
      if (error.code !== 4902) throw error;
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: "0x539",
            chainName: "Kleros isolated local demo",
            rpcUrls: [app.bootstrap.chain.rpcUrl],
            nativeCurrency: {
              name: "Local Ether",
              symbol: "ETH",
              decimals: 18,
            },
          },
        ],
      });
    }
  }
  chain = await provider.request({ method: "eth_chainId" });
  if (Number(BigInt(chain)) !== 1337)
    throw new Error("Select local chain 1337 before authenticating.");
  const { nonce, message } = await post("/api/auth/challenge", {
    wallet: accounts[0],
  });
  const messageHex = `0x${[...new TextEncoder().encode(message)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  const signature = await provider.request({
    method: "personal_sign",
    params: [messageHex, accounts[0]],
  });
  await post("/api/auth/verify", { nonce, signature });
  await load({ silent: true });
  if (provider.on && !provider.__klerosListeners) {
    provider.__klerosListeners = true;
    const invalidateSession = async () => {
      if (currentIdentity()?.mode !== "wallet") return;
      invalidateDraft();
      await api("/api/session", { method: "DELETE" });
      await load({ silent: true });
      toast(
        "Wallet account or network changed. Authenticate again before signing.",
        true,
      );
    };
    provider.on("accountsChanged", invalidateSession);
    provider.on("chainChanged", invalidateSession);
  }
  toast(
    "Wallet ownership verified by a one-use nonce signature. Use “Choose identity” to receive local demo ETH if needed.",
  );
}

async function load({ silent = false } = {}) {
  const generation = ++app.generation;
  invalidateDraft();
  app.route = readRoute();
  if (!silent) {
    $("#loading").hidden = false;
    $("#content").hidden = true;
  }
  try {
    const bootstrap = await api("/api/bootstrap");
    if (generation !== app.generation) return;
    app.bootstrap = bootstrap;
    app.detail = app.route.eventId
      ? await api(`/api/events/${encodeURIComponent(app.route.eventId)}`)
      : null;
    if (generation !== app.generation) return;
    sidebar();
    $("#content").innerHTML = app.detail ? renderEvent() : renderHome();
    $("#loading").hidden = true;
    $("#content").hidden = false;
    document.title = app.detail
      ? `${app.detail.event.title} · Kleros`
      : "Kleros · Events & commitments";
  } catch (error) {
    if (generation !== app.generation) return;
    $("#loading").hidden = true;
    $("#content").hidden = false;
    $("#content").innerHTML =
      `<div class="page-header"><div><div class="eyebrow">Event workbench</div><h1>We couldn’t load this view.</h1></div></div><div class="error-panel">${escape(error.message)}</div><div class="button-row"><button class="button button-primary" data-reload>Try again</button><a href="#" class="button button-secondary">All events</a></div>`;
  }
}

function renderHome() {
  const events = app.bootstrap.events;
  return `<div class="page-header"><div><div class="eyebrow">GOOD EVENTS. KEPT PROMISES.</div><h1>Events, with commitment.</h1><p class="intro">Bring people together. Make attendance verifiable.<br>Manage deposits and disputes with a clear view of every event.</p></div><div class="header-actions"><button class="button button-primary" data-create-event><span aria-hidden="true">＋</span> Create local event</button></div></div>
    <div class="stats-strip"><div class="stat"><span class="stat-label">Independent events</span><div class="stat-value">${events.length}</div><div class="stat-note">Each with its own contract</div></div><div class="stat"><span class="stat-label">Open for participation</span><div class="stat-value">${events.filter((event) => phaseName(event.financialPhase) === "Open").length}</div><div class="stat-note">Free or committed spots</div></div><div class="stat"><span class="stat-label">Network</span><div class="stat-value">Local <small>ETH</small></div><div class="stat-note">Chain ${escape(app.bootstrap.chain.chainId)}</div></div><div class="stat"><span class="stat-label">Settlement</span><div class="stat-value">Court <small>V1</small></div><div class="stat-note">Held shares protect open cases</div></div></div>
    <div class="section-heading"><h2>Your event directory</h2><span class="small">${events.length} events · stable, independent identities</span></div>
    <div class="event-grid">${events.map((event, index) => `<article class="event-card"><div class="event-visual theme-${index % 4}"><span class="visual-kicker">KLEROS / COMMUNITY</span><div class="visual-title">${escape(event.title)}</div><span class="event-sequence">${String(index + 1).padStart(2, "0")} / ${String(events.length).padStart(2, "0")}</span></div><div class="card-body"><div class="card-meta">${badge(phaseName(event.financialPhase), phaseStyle(event.financialPhase))}<span class="tiny-label">${escape(event.visibility ?? "public").toUpperCase()} · ${escape(event.editorialStatus ?? "published").toUpperCase()}</span></div><h3>${escape(event.title)}</h3><p>${escape(event.description ?? "")}</p><div class="event-facts"><span><i class="fact-icon" aria-hidden="true">◷</i>${escape(formatTime(event.startsAt, event.timezone))}</span><span><i class="fact-icon" aria-hidden="true">⌖</i>${escape(event.location ?? "Location to be announced")}</span><span><i class="fact-icon" aria-hidden="true">◇</i>Independent v7 contract · ${escape(short(event.contract))}</span></div><div class="card-footer"><div class="price">${eth(event.depositWei)} ETH<small>Optional commitment · free entry available</small></div><a href="#${new URLSearchParams({ event: event.id, view: "participant" })}" class="button button-secondary">View event <span class="icon-arrow" aria-hidden="true">↗</span></a></div></div></article>`).join("")}</div>
    <div class="trust-strip"><div class="trust-icon" aria-hidden="true">◇</div><div><strong>Attendance people can trust. Outcomes everyone can verify.</strong><p>Deposits stay in separate event contracts. Trusted check-in and a challenge period determine attendance. Normal payouts can continue while disputed shares remain reserved.</p></div></div>
    ${renderDemoControls()}`;
}

function renderEvent() {
  const { event, state } = app.detail;
  const phase = phaseName(state.phase);
  return `<a class="back-link" href="#">← All events</a><div class="event-heading"><div><div class="eyebrow">${escape(event.id)} / EVENTS & COMMITMENTS</div><h1>${escape(event.title)}</h1><div class="event-subtitle"><span>◷ ${escape(formatTime(event.startsAt, event.timezone))}</span><span>⌖ ${escape(event.location ?? "")}</span></div></div><div class="badges">${badge(phase, phaseStyle(phase))}${badge("LOCAL DEMO", "purple")}</div></div>
    <div class="event-layout"><div class="event-main"><div class="tabs" role="tablist" aria-label="Event view">${[
      ["participant", "Your participation"],
      ["organizer", "Organizer desk"],
      ["cases", "Cases & settlement"],
    ]
      .map(
        ([key, title]) =>
          `<button class="tab ${key === app.route.view ? "active" : ""}" role="tab" aria-selected="${key === app.route.view}" data-view="${key}">${title}</button>`,
      )
      .join(
        "",
      )}</div>${app.route.view === "organizer" ? renderOrganizer() : app.route.view === "cases" ? renderCases() : renderParticipant()}</div><aside class="event-aside">${renderAside()}</aside></div>${renderDemoControls()}`;
}
function renderAside() {
  const { event, state, now } = app.detail;
  const contractVersion = event.contractVersion ?? event.version ?? "v7";
  return `<section class="panel identity-panel"><label for="identity-select">LOCAL DEMO IDENTITY</label><select id="identity-select" data-identity>${identityOptions()}</select><div class="identity-address mono">${escape(currentIdentity()?.wallet ?? "No wallet selected")}</div><div class="identity-hint">Demo identities use funded local accounts; connected wallets prove ownership with a nonce signature. A change of identity clears every pending transaction draft.</div></section>
    <section class="panel"><div class="aside-title">Event contract</div><dl class="details-list"><div><dt>Deposit</dt><dd><strong>${eth(state.depositWei ?? event.depositWei)} ETH</strong></dd></div><div><dt>Network</dt><dd>Local · ${escape(event.chainId)}</dd></div><div><dt>Contract</dt><dd><code>${escape(short(event.contract))}</code></dd></div><div><dt>Version</dt><dd>${escape(contractVersion)} · native ETH</dd></div><div><dt>Organizer</dt><dd><code>${escape(short(state.owner))}</code></dd></div>${state.pendingOwner && !/^0x0{40}$/i.test(state.pendingOwner) ? `<div><dt>Pending owner</dt><dd><code>${escape(short(state.pendingOwner))}</code></dd></div>` : ""}<div><dt>Registered</dt><dd>${escape(state.stakerCount)}</dd></div><div><dt>Attendees</dt><dd>${escape(state.attendeeCount)}</dd></div></dl><details class="disclosure"><summary>Inspect immutable terms</summary><p>Contract: <span class="mono">${escape(event.contract)}</span></p><p>Owner: <span class="mono">${escape(state.owner)}</span></p><p>Deployment block: ${escape(event.deploymentBlock ?? "See registry")}<br>Timezone: ${escape(event.timezone)}<br>Attendance-list deadline: ${escape(formatTime(event.claimDeadline ?? event.attendanceDeadline ?? state.claimDeadline, event.timezone))}</p><p>Policy: ${escape(event.policyURI ?? event.policyUri ?? "Local event policy; exact bytes linked by contract")}<br>ABI: ${escape(event.abiVersion ?? "kickback-v7")}</p></details></section>
    <section class="panel"><div class="aside-title">Keep the context</div><a class="aside-link" href="/finance/${encodeURIComponent(event.id)}/guest/" target="_blank" rel="noopener">Advanced participant tools ↗</a>${isOwner() ? `<a class="aside-link" href="/finance/${encodeURIComponent(event.id)}/console/" target="_blank" rel="noopener">Advanced organizer console ↗</a>` : ""}${safeLink(event.contentUrl) ? `<a class="aside-link" href="${escape(event.contentUrl)}" target="_blank" rel="noopener">Event content & materials ↗</a>` : ""}${safeLink(event.lumaUrl) ? `<a class="aside-link" href="${escape(event.lumaUrl)}" target="_blank" rel="noopener">Luma registration ↗</a>` : ""}<p class="small muted">Recordings, personal event history and booth merch remain separate from financial attendance.</p></section>
    <section class="panel"><div class="aside-title">Demo chain time</div><p class="mono small">${escape(formatTime(now ?? app.bootstrap.now, event.timezone))}</p><p class="small">Time advances only on this local chain. Refresh to read authoritative balances and deadlines.</p></section>`;
}
function safeLink(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    return ["https:", "http:"].includes(
      new URL(value, location.origin).protocol,
    );
  } catch {
    return false;
  }
}

function renderParticipant() {
  const { event, state, personal } = app.detail;
  const identity = currentIdentity();
  const person = ownParticipant();
  const registered =
    !!person?.registered || isIn(state.stakers, identity?.wallet);
  const attended =
    !!person?.attended || isIn(state.attendees, identity?.wallet);
  const deposit = person?.deposit;
  const phase = phaseName(state.phase);
  const depositWindowOpen =
    phase === "Open" &&
    Number(app.detail.now) < Date.parse(event.startsAt) / 1000;
  const ownCase = state.cases?.find((item) =>
    same(item.wallet, identity?.wallet),
  );
  const owed = person?.owedWei ?? state.owedWei ?? "0";
  const progress = [!!person, !!deposit?.verified, registered, attended];
  const current = progress.findIndex((value) => !value);
  return `<section class="panel"><div class="panel-header"><div><h2>Your place at this event</h2><p>Free participation. Optional financial commitment.</p></div>${person ? badge(person.admission ?? "pending", person.admission === "approved" ? "green" : "amber") : badge("Not registered")}</div><p>${escape(event.description ?? "")}</p><div class="process">${["Link identity", "Verify deposit", "Admission", "Attendance"].map((text, index) => `<div class="process-step ${progress[index] ? "complete" : current === index ? "current" : ""}"><span class="process-number">${progress[index] ? "✓" : index + 1}</span><span class="process-label">${text}</span></div>`).join("")}</div>
    ${!identity ? `<div class="notice">Choose a local demo identity to view your independent participation in this event.</div><button class="button button-primary" data-choose-identity>Choose demo identity</button>` : !person ? `<form data-form="registration"><div class="form-grid"><div><label for="reg-name">Name</label><input id="reg-name" name="name" required maxlength="120" autocomplete="name" placeholder="Your name"></div><div><label for="reg-email">Email</label><input id="reg-email" name="email" type="email" required maxlength="254" autocomplete="email" placeholder="you@example.invalid"></div></div><p class="field-help">Your authenticated wallet is linked explicitly to this registration. The organizer approves admission.</p><div class="button-row"><button class="button button-primary" type="submit">Register interest</button></div></form>` : `<div class="status-grid"><div class="status-box"><span>Deposit evidence</span><strong>${deposit?.verified ? "✓ Confirmed on chain" : "No verified deposit"}</strong><p>${deposit?.verified ? `${eth(deposit.amountWei)} ETH · ${escape(short(deposit.txHash))}` : "A transfer alone does not approve admission."}</p></div><div class="status-box"><span>Admission</span><strong>${registered ? "✓ Registered staker" : escape(person.admission ?? "pending")}</strong><p>${registered ? "Included in this event’s financial pool." : person.admission === "free" ? "Free participation stays outside the reward pool." : "The organizer reviews verified deposits."}</p></div><div class="status-box"><span>Financial attendance</span><strong>${attended ? "✓ On-chain attendee" : ownCase ? "Attendance under challenge" : "Not yet established"}</strong><p>Trusted evidence and the contract determine this status.</p></div><div class="status-box"><span>Failed-transfer credit</span><strong>${eth(owed)} ETH owed</strong><p>Claim to this or an alternate destination.</p></div></div>`}
    <div class="amount-block"><div><small>OPTIONAL COMMITTED SPOT</small><strong>${eth(state.depositWei ?? event.depositWei)} <span>ETH</span></strong></div><button class="button button-primary" data-tx="deposit" ${!identity || !person || deposit?.verified || !depositWindowOpen ? "disabled" : ""}>${deposit?.verified ? "Deposit verified" : "Review deposit"} <span aria-hidden="true">↗</span></button></div><p class="small">The v7 contract accepts ETH without automatically registering your wallet. Admission follows organizer verification. Approved free guests stay outside the deposited reward pool.</p>
    ${deposit?.verified ? `<div class="tx-line"><span class="tx-state"></span>Confirmed receipt <code>${escape(short(deposit.txHash))}</code></div>` : ""}
    ${identity && person ? `<details class="disclosure"><summary>Verify an existing local deposit receipt</summary><form data-form="receipt"><label for="receipt-hash">Transaction hash</label><input id="receipt-hash" name="txHash" required pattern="0x[a-fA-F0-9]{64}" placeholder="0x…"><div class="button-row"><button class="button button-secondary button-small">Verify receipt</button></div></form></details>` : ""}</section>
    <section class="panel"><div class="panel-header"><div><h2>Your next available actions</h2><p>The contract validates each action again before signing.</p></div></div><div class="button-row">${same(state.pendingOwner, identity?.wallet) ? '<button class="button button-primary" data-tx="acceptOwnership">Accept pending ownership</button>' : ""}<button class="button button-secondary" data-tx="challenge" ${!identity || !registered || attended || ownCase || phase !== "Listed" || Number(app.detail.now) > Number(state.challengeEndsAt) ? "disabled" : ""}>Challenge omission</button><button class="button button-secondary" data-tx="emergencyWithdraw" ${!identity || !registered || phase !== "Open" || Number(app.detail.now) <= Number(event.claimDeadline) ? "disabled" : ""}>No-list recovery</button><button class="button button-secondary" data-recovery="claim" ${!identity || BigInt(owed) === 0n ? "disabled" : ""}>Claim failed transfer</button></div><div class="notice">An omitted registered attendee has one day to challenge after attendance is posted, followed by a separate one-day matching period. Unmatched expired challenges count as attended. Open matched cases keep their reserved share while other payouts proceed.</div>${ownCase ? `<a class="button button-secondary button-small" href="#${new URLSearchParams({ event: event.id, view: "cases" })}">View your attendance case →</a>` : ""}</section>
    <section class="panel"><div class="panel-header"><div><h2>Your personal event history</h2><p>A private reminder, independent of deposits and trusted attendance.</p></div></div><button class="button button-secondary button-small" data-personal ${!identity ? "disabled" : ""}>${personal?.attended ? "✓ Marked as personally attended" : "I was there"}</button><p class="field-help">This self-reported record, newsletter consent and merch state have no financial effect.</p></section>`;
}

function renderOrganizer() {
  const {
    state,
    participants = [],
    attendance = [],
    imports = [],
  } = app.detail;
  const owner = isOwner();
  const staff = isStaff();
  if (!currentIdentity())
    return `<div class="panel"><h2>Organizer desk</h2><p>Select Organizer A, Organizer B or Staff A to explore event-specific authority.</p><button class="button button-primary" data-choose-identity>Choose demo identity</button></div>`;
  if (!owner && !staff)
    return `<div class="panel"><h2>This identity cannot manage this event.</h2><p>Financial actions belong to the selected event’s contract owner. Trusted door check-in requires an event-specific staff role.</p><div class="notice">Current wallet: <span class="mono">${escape(currentIdentity().wallet)}</span><br>Event owner: <span class="mono">${escape(state.owner)}</span></div><button class="button button-secondary" data-choose-identity>Switch demo identity</button></div>`;
  return `<div class="access-banner"><span aria-hidden="true">◇</span><span>${owner ? "You are the contract owner for this event. Every financial action uses a fresh on-chain review." : "You are authorized door staff for this event. Financial signing remains with its contract owner."}</span></div>
    <section class="panel"><div class="panel-header"><div><div class="step-label">01 / Admission & verified deposits</div><h2>People, with evidence</h2><p>Only approved, verified commitments can become registered stakers.</p></div><span class="pill-note">${participants.length} people</span></div>${participants.length ? `<div class="table-scroll"><table><thead><tr><th>Participant</th><th>Deposit</th><th>Admission</th><th>Check-in</th></tr></thead><tbody>${participants.map((person) => `<tr><td class="person-cell"><strong>${escape(person.name)}</strong><small>${escape(short(person.wallet))}</small></td><td>${person.deposit?.verified ? `<strong>${eth(person.deposit.amountWei)} ETH</strong><br><span class="small muted">${escape(short(person.deposit.txHash))}</span>` : '<span class="muted">Not verified</span>'}${person.registered ? '<br><span class="badge green">Staker</span>' : ""}</td><td>${owner ? `<select aria-label="Admission for ${escape(person.name)}" data-admission="${escape(person.id)}">${["pending", "approved", "declined", "free"].map((admission) => `<option value="${admission}" ${person.admission === admission ? "selected" : ""}>${admission}</option>`).join("")}</select>` : badge(person.admission)}</td><td>${attendance.some((record) => record.participantId === person.id || same(record.wallet, person.wallet)) ? badge("Observed", "green") : `<button class="button button-secondary button-small" data-checkin="${escape(person.id)}">Check in</button>`}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty"><span class="empty-icon">◉</span>No linked participants yet.</div>'}<div class="button-row"><button class="button button-primary" data-tx="register" ${!owner ? "disabled" : ""}>Review staker registration</button><button class="button button-secondary" data-tx="reject" ${!owner ? "disabled" : ""}>Review rejection / refunds</button></div><p class="field-help">Changing admission alone does not write to the contract. Registration checks the successful receipt, exact event, linked wallet and duplicate financial evidence.</p></section>
    ${renderDepositReview()}
    ${owner ? `<section class="panel"><div class="panel-header"><div><div class="step-label">02 / Source review</div><h2>Import guests or attendance</h2><p>Source hashes detect substitution. They do not prove which event an export came from.</p></div></div><form data-form="import"><div class="form-grid"><div><label for="import-kind">Import type</label><select id="import-kind" name="kind"><option value="attendance">Trusted attendance</option><option value="guests">Guest / deposit review</option></select></div><div><label for="import-event">Source event identity</label><input id="import-event" name="sourceEventId" value="${escape(app.route.eventId)}" placeholder="Stable source event ID"></div><div class="full"><label for="import-file">Choose a CSV (optional)</label><input id="import-file" type="file" accept=".csv,text/csv" data-csv-file><p class="field-help"><a href="${eventPath("/fixture?kind=attendance")}" download>Download this event’s synthetic attendance CSV</a> · <a href="${eventPath("/fixture?kind=guests")}" download>Guest fixture</a></p></div><div class="full"><label for="import-csv">CSV contents</label><textarea id="import-csv" name="csv" required spellcheck="false" placeholder="event_id,chain_id,contract,participant_id,email,wallet,checked_in_at,tx_hash,admission"></textarea></div></div><label class="checkbox-label"><input type="checkbox" name="reviewConfirmed"><span>I have reviewed the source event and export. If its origin cannot be verified automatically, record my provenance review. This cannot override a known event, contract or chain mismatch.</span></label><label for="review-note">Provenance review note</label><input id="review-note" name="reviewNote" placeholder="Where this export came from and how you verified it" maxlength="1000"><div class="button-row"><button class="button button-secondary" type="submit">Validate & review import</button></div></form><div id="import-result"></div>${imports.length ? `<details class="disclosure"><summary>${imports.length} recorded import ${imports.length === 1 ? "batch" : "batches"}</summary>${imports.map((batch) => `<p><strong>${escape(batch.kind ?? "import")}</strong> · ${escape(batch.status ?? batch.reviewStatus ?? "reviewed")}<br><span class="mono">${escape(batch.sourceHash ?? batch.sha256 ?? batch.id)}</span></p>`).join("")}</details>` : ""}</section>` : ""}
    <section class="panel"><div class="panel-header"><div><div class="step-label">03 / Attendance & payout review</div><h2>Publish the attendance proposal</h2><p>Only registered wallets with trusted observations enter this list.</p></div></div><div class="result-summary"><div><span>Trusted observations</span><strong>${attendance.length}</strong></div><div><span>Registered stakers</span><strong>${escape(state.stakerCount)}</strong></div><div><span>Registered pool</span><strong>${eth(state.poolWei)} <small>ETH</small></strong></div></div><div class="button-row"><button class="button button-primary" data-tx="postAttendance" ${!owner ? "disabled" : ""}>Review attendance & share</button><button class="button button-secondary" data-correction ${!owner ? "disabled" : ""}>Correct an omission</button></div><p class="field-help">Posting starts the one-day omission challenge window. The preview validates current contract state and expected per-attendee share. An empty list is refused.</p></section>
    ${owner ? renderRecovery() : ""}`;
}

function renderDepositReview() {
  const records = app.detail.deposits ?? [];
  return `<section class="panel"><div class="panel-header"><div><h2>Deposit reconciliation</h2><p>Successful receipts, returned amounts and current allocation, scoped to this contract.</p></div></div>${records.length ? `<div class="table-scroll"><table><thead><tr><th>Wallet</th><th>Received</th><th>Returned</th><th>Unallocated</th></tr></thead><tbody>${records.map((record) => `<tr><td class="person-cell"><strong class="mono">${escape(short(record.wallet))}</strong><small>${record.linked ? "Linked participant" : "Unmatched payer"}</small></td><td>${eth(record.receivedWei)} ETH</td><td>${eth(record.returnedWei)} ETH</td><td><strong>${eth(record.unallocatedWei)} ETH</strong></td></tr>`).join("")}</tbody></table></div>` : "<p>No deposit logs found for this event.</p>"}<dl class="details-list" style="margin-top:15px"><div><dt>Contract balance</dt><dd>${eth(app.detail.state.balanceWei)} ETH</dd></div><div><dt>Reserved</dt><dd>${eth(app.detail.state.reservedWei)} ETH</dd></div><div><dt>Spare, before a return</dt><dd>${eth(app.detail.state.spareWei)} ETH</dd></div></dl><p class="field-help">Unallocated ETH can include an unregistered payer or excess payment. Review original receipts and any previous returns before preparing a refund. A pooled v7 contract does not prove per-wallet deposit ownership.</p>${isOwner() ? '<div class="button-row"><button class="button button-secondary button-small" data-recovery="refund">Review unmatched ETH return</button></div>' : ""}</section>`;
}

function renderCases() {
  const { state, event } = app.detail;
  const cases = state.cases ?? [];
  const owner = isOwner();
  return `<div class="panel"><div class="panel-header"><div><h2>Settlement, without losing the details</h2><p>Live contract accounting for ${escape(event.title)}.</p></div>${badge(phaseName(state.phase), phaseStyle(state.phase))}</div><div class="status-grid"><div class="status-box"><span>Established attendees</span><strong>${escape(state.attendeeCount)} wallets</strong><p>Current on-chain attendee set</p></div><div class="status-box"><span>Open held shares</span><strong>${eth(state.heldBackWei)} ETH</strong><p>Reserved while matched cases remain open</p></div><div class="status-box"><span>Failed-transfer credits</span><strong>${eth(state.owedTotalWei)} ETH</strong><p>Claimable by the credited wallet</p></div><div class="status-box"><span>Total reserved</span><strong>${eth(state.reservedWei)} ETH</strong><p>Includes pool / held shares, credits and escrow</p></div></div><div class="details-list"><div><dt>Contract balance</dt><dd>${eth(state.balanceWei)} ETH</dd></div><div><dt>Challenge escrow</dt><dd>${eth(state.challengeEscrowWei)} ETH</dd></div><div><dt>Challenge window ends</dt><dd>${escape(formatTime(state.challengeEndsAt, event.timezone))}</dd></div></div><div class="button-row"><button class="button button-primary" data-tx="release" ${!currentIdentity() ? "disabled" : ""}>Review normal payouts</button><button class="button button-secondary" data-recovery="claim" ${!currentIdentity() ? "disabled" : ""}>Claim failed transfer</button></div><p class="field-help">After challenges and pending matches close, established attendees can be paid while each unresolved matched case retains a full provisional share. Later losses redistribute top-ups; later winners receive their accumulated held share. Integer rounding remains in the contract.</p></div>
    <section class="panel"><div class="panel-header"><div><h2>Attendance cases</h2><p>Resolver local IDs and arbitrator dispute IDs are separate.</p></div><span class="pill-note">${cases.length} ${cases.length === 1 ? "case" : "cases"}</span></div>${cases.length ? cases.map(renderCase).join("") : '<div class="empty"><span class="empty-icon">◇</span><h3>No attendance cases</h3><p>Omitted registered participants can challenge after the attendance list is posted.</p></div>'}<div class="button-row"><button class="button button-secondary button-small" data-tx="challenge" ${!currentIdentity() ? "disabled" : ""}>Challenge my omission</button></div></section>
    ${owner ? renderRecovery() : ""}
    <section class="panel"><div class="panel-header"><div><h2>Transaction activity</h2><p>Success appears only after a confirmed receipt.</p></div></div>${renderTransactions()}</section>`;
}
function renderCase(item) {
  const owner = isOwner();
  const state =
    typeof item.state === "number"
      ? (["None", "Awaiting match", "Matched", "Resolved"][item.state] ??
        String(item.state))
      : item.state;
  const caseWallet = escape(item.wallet);
  const publication =
    typeof item.publication === "object"
      ? item.publication.status
      : item.publication;
  return `<article class="case-card"><div class="panel-header"><div><strong class="case-title">${escape(short(item.wallet))}</strong><span class="small muted">Participant attendance challenge</span></div>${badge(state ?? "Challenge", /resolved/i.test(state) ? "green" : "amber")}</div><dl class="details-list"><div><dt>Matching deadline</dt><dd>${escape(formatTime(item.matchEndsAt, app.detail.event.timezone))}</dd></div><div><dt>Challenge deposit</dt><dd>${eth(item.depositWei)} ETH</dd></div><div><dt>Reserved share</dt><dd>${eth(item.heldShareWei)} ETH</dd></div><div><dt>Resolver local ID</dt><dd><code>${escape(item.localDisputeID ?? "—")}</code></dd></div><div><dt>Arbitrator dispute ID</dt><dd><code>${escape(item.arbitratorDisputeID ?? "—")}</code></dd></div><div><dt>Final ruling</dt><dd>${item.finalRuling === null || item.finalRuling === undefined ? "Not final" : escape(["0 · Refused / excluded", "1 · Attended", "2 · Absent"][Number(item.finalRuling)] ?? item.finalRuling)}</dd></div></dl><div class="button-row"><button class="button button-secondary button-small" data-tx="match" data-wallet="${caseWallet}" ${!currentIdentity() ? "disabled" : ""}>Review matching</button><button class="button button-primary button-small" data-tx="resolve" data-wallet="${caseWallet}" ${!currentIdentity() ? "disabled" : ""}>Settle final / unmatched case</button></div><div class="button-row"><button class="button button-secondary button-small" data-tx="passPeriod" data-wallet="${caseWallet}" ${!currentIdentity() ? "disabled" : ""}>Advance expired appeal</button><button class="button button-secondary button-small" data-tx="deliverRuling" data-wallet="${caseWallet}" ${!currentIdentity() ? "disabled" : ""}>Deliver final ruling</button></div><details class="disclosure"><summary>Evidence, publication & appeals</summary><p>Case metaevidence: <span class="mono">${escape(item.caseURI ?? "Not created")}</span><br>Publication: <strong>${escape(publication ?? "Not published")}</strong>. A computed CID does not establish IPFS availability.</p><div class="button-row"><button class="button button-secondary button-small" data-publish="${caseWallet}">${publication ? "Retry / verify local publication" : "Publish exact bytes locally"}</button></div><form data-form="evidence" data-wallet="${caseWallet}"><label>Store an evidence file locally (optional)</label><input type="file" data-evidence-file><p class="field-help">Maximum 256 KiB. Stored only in this local server; no IPFS upload occurs.</p><label style="margin-top:12px">Evidence URI</label><input name="uri" required maxlength="2000" placeholder="/ipfs/CID/evidence.json"><div class="button-row"><button class="button button-secondary button-small" ${!currentIdentity() ? "disabled" : ""}>Review evidence submission</button></div></form><form data-form="appeal" data-wallet="${caseWallet}"><div class="form-grid"><div><label>Ruling side</label><select name="side"><option value="1">1 · Attended</option><option value="2">2 · Absent</option><option value="0">0 · Refused</option></select></div><div><label>Contribution (ETH)</label><input name="amount" inputmode="decimal" required value="0.001"></div></div><div class="button-row"><button class="button button-secondary button-small" ${!currentIdentity() ? "disabled" : ""}>Review direct appeal contribution</button><button class="button button-secondary button-small" type="button" data-tx="appealRewards" data-wallet="${caseWallet}" ${!currentIdentity() ? "disabled" : ""}>Review appeal rewards</button></div><p class="field-help">Contributions go directly from this wallet to the V1 resolver. Current appeal status: ${escape(typeof item.appeal === "object" ? JSON.stringify(item.appeal) : (item.appeal ?? "No open appeal reported"))}.</p></form></details>${owner ? `<details class="disclosure"><summary>Local Court mock controls</summary><p>Only the local mock arbitrator can be driven here. A final mock ruling still requires settlement through the real v7 event contract.</p><div class="button-row">${[1, 2, 0].map((ruling) => `<button class="button button-secondary button-small" data-ruling="${ruling}" data-wallet="${caseWallet}">${["Refuse", "Attended", "Absent"][ruling]}</button>`).join("")}<button class="button button-secondary button-small" data-open-appeal="${caseWallet}">Open mock appeal period</button></div></details>` : ""}</article>`;
}

function renderRecovery() {
  return `<section class="panel"><div class="panel-header"><div><h2>Recovery & administration</h2><p>Each operation is simulated and reviewed against current contract rules.</p></div></div><div class="button-row"><button class="button button-secondary button-small" data-edit-event>Edit event settings</button><button class="button button-danger button-small" data-tx="cancel">Review cancellation</button><button class="button button-secondary button-small" data-recovery="refund">Return unmatched ETH</button><button class="button button-secondary button-small" data-recovery="sweep">Sweep spare ETH</button><button class="button button-secondary button-small" data-recovery="transferOwnership">Transfer ownership</button><button class="button button-secondary button-small" data-tx="acceptOwnership">Accept ownership</button></div><p class="field-help">Cancellation is available only while Open under the contract’s deadline rules. No-list withdrawal is available only after the attendance-posting deadline when no list was posted. Neither bypasses an unresolved matched dispute. Reserved pool, held shares, owed balances and challenge escrow cannot be swept.</p></section>`;
}
function renderTransactions() {
  const transactions = app.detail.transactions ?? [];
  if (!transactions.length)
    return '<div class="empty">No confirmed local actions for this event yet.</div>';
  return `<ul class="transaction-log">${transactions
    .slice()
    .reverse()
    .slice(0, 12)
    .map(
      (tx) =>
        `<li><strong>${escape(actionNames[tx.action] ?? tx.action ?? "Transaction")}</strong> · ${escape(tx.status ?? "confirmed")}<br><span class="mono">${escape(tx.hash ?? tx.txHash ?? "")}</span>${tx.blockNumber ? ` · block ${escape(tx.blockNumber)}` : ""}</li>`,
    )
    .join("")}</ul>`;
}
function renderDemoControls() {
  return `<details class="disclosure" style="margin-top:28px"><summary>Local demo controls & walkthrough</summary><div class="notice"><strong>Isolated development only.</strong> These controls advance the local chain and use funded synthetic accounts. No ETH, court case, guest data or message is sent to a production service.<br>Chain time: ${escape(formatTime(app.detail?.now ?? app.bootstrap.now, "UTC"))}</div><div class="button-row"><button class="button button-secondary button-small" data-advance="3600">Advance 1 hour</button><button class="button button-secondary button-small" data-advance="86401">Advance 1 day + 1 second</button><button class="button button-secondary button-small" data-advance="1296000">Advance 15 days</button><button class="button button-quiet button-small" data-demo-help>Open walkthrough</button></div></details>`;
}

async function prepareTransaction(action, params = {}) {
  if (!currentIdentity()) {
    showIdentityDialog();
    return;
  }
  invalidateDraft();
  const eventId = app.route.eventId;
  const generation = app.generation;
  toast("Preparing transaction: checking current chain state and authority…");
  const draft = await post(eventPath("/drafts"), { action, params });
  const fresh = await api(eventPath(""));
  if (eventId !== app.route.eventId || generation !== app.generation)
    throw new Error(
      "The event or identity changed. Prepare the transaction again.",
    );
  if (fresh.state.fingerprint !== draft.snapshot)
    throw new Error(
      "The contract state changed while preparing this review. Refresh and prepare a fresh transaction.",
    );
  app.detail = fresh;
  app.draft = draft;
  const event = app.detail.event;
  showDialog(
    `<div class="dialog-eyebrow">Transaction review / local chain</div><h2 class="dialog-title" id="dialog-title">${escape(actionNames[action] ?? action)}</h2><p class="dialog-body-text">${escape(typeof draft.summary === "string" ? draft.summary : JSON.stringify(draft.summary))}</p><div class="review-list"><dl class="details-list"><div><dt>Event</dt><dd><strong>${escape(event.title)}</strong><br>${escape(draft.eventId)}</dd></div>${action === "postAttendance" ? `<div><dt>Proposed attendees</dt><dd><strong>${draft.args[0].length} registered wallets</strong></dd></div><div><dt>Initial share</dt><dd><strong>${eth(draft.args[1])} ETH</strong></dd></div><div><dt>Registered pool</dt><dd>${eth(app.detail.state.poolWei)} ETH</dd></div>` : ""}${action === "register" || action === "reject" ? `<div><dt>Reviewed wallets</dt><dd><strong>${draft.args[0].length} verified participants</strong></dd></div>` : ""}<div><dt>Network</dt><dd>Local chain · ${escape(draft.chainId)}</dd></div><div><dt>Event contract</dt><dd class="mono">${escape(draft.contract)}</dd></div>${!same(draft.contract, draft.transaction.to) ? `<div><dt>Transaction recipient</dt><dd class="mono">${escape(draft.transaction.to)}</dd></div>` : ""}<div><dt>Signing wallet</dt><dd class="mono">${escape(draft.wallet)}</dd></div><div><dt>Value</dt><dd><strong>${eth(draft.valueWei)} ETH</strong><br><span class="small mono">${escape(draft.valueWei)} wei</span></dd></div><div><dt>Method</dt><dd><code>${escape(draft.method)}</code></dd></div><div><dt>Policy</dt><dd>${escape(event.policyURI ?? event.policyUri ?? "Immutable local event policy")}</dd></div><div><dt>Review expires</dt><dd>${escape(formatTime(draft.expiresAt, "UTC"))}</dd></div></dl></div><details class="disclosure"><summary>Inspect calldata and arguments</summary><pre class="review-code">${escape(JSON.stringify({ args: draft.args, transaction: draft.transaction, snapshot: draft.snapshot }, null, 2))}</pre></details>${action === "release" ? releaseBreakdown() : ""}<div class="notice warning">Confirming sends a transaction from the selected wallet on the isolated local chain. The server checks this state snapshot again and rejects an expired or stale draft. Changing event or wallet clears the review.</div><div id="transaction-status" role="status"></div><div class="dialog-buttons"><button class="button button-secondary" data-close>Cancel</button><button class="button button-primary" id="execute-transaction" data-execute>Confirm local transaction</button></div>`,
  );
}
function releaseBreakdown() {
  const state = app.detail.state;
  const open = (state.cases ?? []).filter(
    (item) => item.state === "Disputed" || item.state === 2,
  ).length;
  const accepted = (state.cases ?? []).filter(
    (item) =>
      (item.state === "Waiting" || item.state === 1) &&
      Number(app.detail.now) > Number(item.matchEndsAt),
  ).length;
  const attendees = Number(state.attendeeCount) + accepted;
  const count = attendees + open;
  if (!count) return "";
  const share = BigInt(state.poolWei) / BigInt(count);
  return `<div class="notice"><strong>Reviewed v7 payout calculation</strong><br>${escape(state.attendeeCount)} established attendees${accepted ? ` + ${accepted} expired unmatched challenges accepted automatically` : ""} · ${open} unresolved matched cases.<br>Provisional share: ${eth(share)} ETH each.<br>Normal attendee payments: ${eth(share * BigInt(attendees))} ETH.<br>Held-share reserve: ${eth(share * BigInt(open))} ETH.<br>Integer division remainder remains protected by the contract’s reserve rules.</div>`;
}
async function executeTransaction() {
  const draft = app.draft;
  if (!draft || draft.eventId !== app.route.eventId)
    throw new Error("This transaction review is no longer valid.");
  const button = $("#execute-transaction");
  button.disabled = true;
  button.textContent = "Submitting…";
  $("#transaction-status").innerHTML =
    '<div class="notice"><span class="spinner" style="width:12px;height:12px;vertical-align:middle;margin-right:7px"></span>Submitting to the local chain. Waiting for a confirmed receipt…</div>';
  try {
    let result;
    if (currentIdentity()?.mode === "wallet") {
      const provider = walletProvider();
      const tx = await post(
        eventPath(`/drafts/${encodeURIComponent(draft.id)}/validate`),
        {},
      );
      const [accounts, chain] = await Promise.all([
        provider.request({ method: "eth_accounts" }),
        provider.request({ method: "eth_chainId" }),
      ]);
      if (
        Number(BigInt(chain)) !== 1337 ||
        !same(accounts?.[0], draft.wallet) ||
        app.draft?.id !== draft.id
      )
        throw new Error(
          "Wallet, network or event changed. Prepare a fresh review.",
        );
      $("#transaction-status").innerHTML =
        '<div class="notice">Awaiting your wallet signature on local chain 1337…</div>';
      const hash = await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            to: tx.to,
            from: tx.from,
            data: tx.data,
            value: `0x${BigInt(tx.value).toString(16)}`,
            chainId: "0x539",
          },
        ],
      });
      if (app.draft?.id !== draft.id)
        throw new Error(
          `Wallet submitted ${hash}. Refresh the original event to inspect its receipt before preparing another action.`,
        );
      $("#transaction-status").innerHTML =
        `<div class="notice">Submitted ${escape(short(hash))}. Verifying the exact transaction and confirmed receipt…</div>`;
      for (let attempt = 0; attempt < 15; attempt++) {
        try {
          result = await post(
            eventPath(`/drafts/${encodeURIComponent(draft.id)}/confirm`),
            { hash },
          );
          break;
        } catch (error) {
          if (attempt === 14) throw error;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    } else
      result = await post(
        eventPath(`/drafts/${encodeURIComponent(draft.id)}/execute`),
        {},
      );
    if (result.status !== "confirmed")
      throw new Error(
        `Transaction is ${result.status ?? "unconfirmed"}. Refresh to verify its receipt.`,
      );
    app.draft = null;
    await load({ silent: true });
    toast(
      `Confirmed ${actionNames[result.action ?? draft.action] ?? draft.action}. Block ${result.blockNumber} · ${short(result.hash)}`,
    );
  } catch (error) {
    app.draft = null;
    if ($("#transaction-status"))
      $("#transaction-status").innerHTML =
        `<div class="error-panel">${escape(error.message)}<br>This review is invalidated. Close it and prepare a fresh transaction.</div>`;
    if (button?.isConnected) button.textContent = "Review invalidated";
    throw error;
  }
}

function showCreateEvent() {
  if (!currentIdentity()) {
    showIdentityDialog();
    return;
  }
  if (currentIdentity().mode !== "demo") {
    toast(
      "Choose a local demo organizer identity to deploy a new demonstration contract. Connected wallets can register and sign their own participant actions.",
      true,
    );
    return;
  }
  const now = Number(app.bootstrap.now) || Math.floor(Date.now() / 1000);
  const iso = (seconds) => new Date(seconds * 1000).toISOString().slice(0, 16);
  showDialog(
    `<div class="dialog-eyebrow">New local event</div><h2 class="dialog-title" id="dialog-title">Create an independent event</h2><p class="dialog-body-text">Deploy a separate v7 contract on the local chain. Your selected wallet becomes its organizer. Existing events and their balances stay independent.</p><form data-form="create-event"><div class="form-grid"><div class="full"><label for="event-title">Event title</label><input id="event-title" name="title" required maxlength="120" placeholder="An event worth showing up for"></div><div><label for="event-slug">Display slug</label><input id="event-slug" name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="community-workshop"></div><div><label for="event-deposit">Optional commitment (ETH)</label><input id="event-deposit" name="depositEth" required value="0.01" inputmode="decimal"></div><div class="full"><label for="event-description">Description</label><textarea id="event-description" name="description" required maxlength="2000" placeholder="Who is this event for?"></textarea></div><div><label for="event-start">Starts (UTC)</label><input id="event-start" name="startsAt" type="datetime-local" required value="${iso(now + 7200)}"></div><div><label for="event-end">Ends (UTC)</label><input id="event-end" name="endsAt" type="datetime-local" required value="${iso(now + 14400)}"></div><div><label for="event-timezone">Display timezone</label><input id="event-timezone" name="timezone" required value="Asia/Bangkok"></div><div><label for="event-location">Location</label><input id="event-location" name="location" required maxlength="250" placeholder="Venue or online"></div></div><div class="dialog-buttons"><button class="button button-secondary" type="button" data-close>Cancel</button><button class="button button-primary" type="submit">Create & deploy locally</button></div></form>`,
  );
}
function showRecovery(action) {
  showDialog(
    `<div class="dialog-eyebrow">${escape(actionNames[action])}</div><h2 class="dialog-title" id="dialog-title">Choose the destination</h2><p class="dialog-body-text">The contract applies its exact eligibility and reserve rules. Review the selected event, destination and consequences before signing.</p><form data-form="recovery" data-action="${escape(action)}"><label for="recovery-to">Destination wallet</label><input id="recovery-to" name="to" required pattern="0x[a-fA-F0-9]{40}" value="${escape(currentIdentity()?.wallet ?? "")}" placeholder="0x…">${action === "refund" ? '<label for="recovery-amount" style="margin-top:15px">Amount (ETH)</label><input id="recovery-amount" name="amount" required inputmode="decimal" placeholder="0.01">' : ""}<div class="dialog-buttons"><button class="button button-secondary" type="button" data-close>Cancel</button><button class="button button-primary">Prepare review</button></div></form>`,
  );
}
function showCorrection() {
  showDialog(
    `<div class="dialog-eyebrow">Organizer correction</div><h2 class="dialog-title" id="dialog-title">Add omitted attendees</h2><p class="dialog-body-text">Available during the challenge window, for registered wallets that are not in a matched dispute. This operation changes the contract’s attendee set.</p><form data-form="correction"><label for="correction-wallets">Wallets (one per line or comma separated)</label><textarea id="correction-wallets" name="wallets" required spellcheck="false" placeholder="0x…"></textarea><div class="dialog-buttons"><button class="button button-secondary" type="button" data-close>Cancel</button><button class="button button-primary">Prepare correction</button></div></form>`,
  );
}
function showEventSettings() {
  const { event } = app.detail;
  showDialog(
    `<div class="dialog-eyebrow">Event management</div><h2 class="dialog-title" id="dialog-title">Editorial & registration settings</h2><p class="dialog-body-text">Visibility and registration are separate from the financial phase. Financial dates, deposit, contract, stable identity and immutable policy remain fixed.</p><form data-form="event-settings"><label for="settings-description">Description</label><textarea id="settings-description" name="description" required maxlength="2000">${escape(event.description)}</textarea><div class="form-grid" style="margin-top:15px"><div><label for="settings-visibility">Visibility</label><select id="settings-visibility" name="visibility">${["public", "private"].map((value) => `<option ${event.visibility === value ? "selected" : ""}>${value}</option>`).join("")}</select></div><div><label for="settings-editorial">Editorial status</label><select id="settings-editorial" name="editorialStatus">${["published", "draft"].map((value) => `<option ${event.editorialStatus === value ? "selected" : ""}>${value}</option>`).join("")}</select></div><div class="full"><label for="settings-registration">Registration</label><select id="settings-registration" name="registrationStatus">${["open", "closed"].map((value) => `<option ${event.registrationStatus === value ? "selected" : ""}>${value}</option>`).join("")}</select></div></div>${renderAssociationFields(event)}<div class="notice">Private visibility uses event membership on the server. Publishing content does not reopen a cancelled or finalized financial contract.</div><div class="dialog-buttons"><button class="button button-secondary" type="button" data-close>Cancel</button><button class="button button-primary">Save event settings</button></div></form>`,
  );
}
function renderAssociationFields(event = {}) {
  return `<details class="disclosure"><summary>Optional content & Luma associations</summary><p>These links map the event to retained services. Public Luma metadata, content history and booth records do not verify financial attendance or grant access to private materials.</p><div class="form-grid"><div><label for="settings-luma-id">Luma event ID</label><input id="settings-luma-id" name="lumaEventId" value="${escape(event.lumaEventId ?? "")}" maxlength="100" placeholder="evt-…"></div><div><label for="settings-content-id">Content event ID</label><input id="settings-content-id" name="contentEventId" value="${escape(event.contentEventId ?? "")}" maxlength="100" placeholder="Existing content UUID"></div><div class="full"><label for="settings-luma-url">Explicit Luma event URL</label><input id="settings-luma-url" name="lumaUrl" type="url" value="${escape(event.lumaUrl ?? "")}" placeholder="https://luma.com/your-event" maxlength="1000"></div><div class="full"><label for="settings-content-url">Content & materials URL</label><input id="settings-content-url" name="contentUrl" type="url" value="${escape(event.contentUrl ?? "")}" placeholder="https://events.example/events/your-event" maxlength="1000"></div></div></details>`;
}
function showCheckin(participantId) {
  const person = app.detail.participants.find(
    (person) => person.id === participantId,
  );
  showDialog(
    `<div class="dialog-eyebrow">Trusted staff observation</div><h2 class="dialog-title" id="dialog-title">Check in ${escape(person?.name ?? participantId)}</h2><p class="dialog-body-text">Record a door observation for this event and linked participant. The staff identity, evidence source and replay-safe nonce are recorded. This alone does not post the financial attendance list.</p><div class="review-list"><dl class="details-list"><div><dt>Event</dt><dd>${escape(app.detail.event.title)}</dd></div><div><dt>Participant wallet</dt><dd class="mono">${escape(person?.wallet)}</dd></div><div><dt>Reviewer</dt><dd>${escape(currentIdentity()?.label)}</dd></div></dl></div><form data-form="checkin" data-participant="${escape(participantId)}"><label for="checkin-note">Door evidence note</label><input id="checkin-note" name="note" required maxlength="1000" value="Verified participant present at the local demo door"><div class="dialog-buttons"><button class="button button-secondary" type="button" data-close>Cancel</button><button class="button button-primary">Record trusted check-in</button></div></form>`,
  );
}
function showDemoHelp() {
  showDialog(
    `<div class="dialog-eyebrow">Two events. One independent participant.</div><h2 class="dialog-title" id="dialog-title">Walk through a complete local flow</h2><p class="dialog-body-text">All balances and outcomes come from real v7 contracts on an isolated Ganache chain. Court rulings come from an explicit V1 mock. Demo identities simulate authentication.</p><ol class="dialog-body-text"><li>Choose Alice. Open Event A and deposit, then do the same in Event B.</li><li>Switch to each event’s organizer. Approve Alice and review staker registration. Repeat with Bob and Carol for a dispute scenario.</li><li>Advance local time past the event start. Use trusted staff check-in or an event-bound CSV, then review and post attendance.</li><li>Omit a registered participant, switch to them and challenge. Another wallet can match before its separate deadline.</li><li>Advance past the challenge and matching windows. The owner can release normal payouts with a held share reserved for the open case.</li><li>Event B continues independently. Use the local Court controls in A, then settle the real contract’s final outcome.</li></ol><div class="notice">The advanced guest and organizer links preserve evidence, appeal, ownership and recovery tools. Content recordings and booth marketing remain separate services. Mainnet deployment and external publication require a later authorized rollout.</div><div class="dialog-buttons"><button class="button button-primary" data-close>Start exploring</button></div>`,
  );
}

document.addEventListener("change", async (event) => {
  const target = event.target;
  if (
    !(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)
  )
    return;
  try {
    if (target.matches("[data-identity]")) {
      await switchIdentity(target.value);
    }
    if (target.matches("[data-admission]")) {
      const select = target;
      select.disabled = true;
      await api(
        eventPath(
          `/participants/${encodeURIComponent(select.dataset.admission)}`,
        ),
        { method: "PATCH", body: JSON.stringify({ admission: select.value }) },
      );
      await load({ silent: true });
      toast(
        "Admission decision saved. Contract registration remains a separate reviewed action.",
      );
    }
    if (
      target instanceof HTMLInputElement &&
      target.matches("[data-csv-file]") &&
      target.files[0]
    ) {
      if (target.files[0].size > 2 * 1024 * 1024)
        throw new Error("Use a CSV smaller than 2 MB.");
      $("#import-csv").value = await target.files[0].text();
    }
    if (
      target instanceof HTMLInputElement &&
      target.matches("[data-evidence-file]") &&
      target.files[0]
    ) {
      if (target.files[0].size > 256 * 1024)
        throw new Error("Local evidence is limited to a single 256 KiB block.");
      const body = new FormData();
      body.set("data", target.files[0]);
      const response = await fetch("/local-upload", {
        method: "POST",
        body,
        credentials: "same-origin",
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Local evidence storage failed.");
      const form = target.closest("form");
      if (form) $('[name="uri"]', form).value = result.path;
      toast(
        "Evidence file stored locally. Review the resolver transaction to submit its URI.",
      );
    }
  } catch (error) {
    toast(error.message, true);
    if (target.matches("[data-admission]")) await load({ silent: true });
  }
});

document.addEventListener("click", async (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest("button");
  if (!button || button.disabled) return;
  const data = button.dataset;
  try {
    if ("close" in data) {
      invalidateDraft();
      return;
    }
    if ("reload" in data) {
      await load();
      return;
    }
    if ("chooseIdentity" in data) {
      showIdentityDialog();
      return;
    }
    if ("connectWallet" in data) {
      button.disabled = true;
      await connectWallet();
      return;
    }
    if ("fundWallet" in data) {
      button.disabled = true;
      const result = await post("/api/demo/fund", {});
      await load({ silent: true });
      toast(
        `Received 1 local ETH. Confirmed local faucet transaction ${short(result.hash)}.`,
      );
      return;
    }
    if ("logout" in data) {
      await switchIdentity("");
      return;
    }
    if ("createEvent" in data) {
      showCreateEvent();
      return;
    }
    if ("view" in data) {
      navigate(app.route.eventId, data.view);
      return;
    }
    if ("demoHelp" in data) {
      showDemoHelp();
      return;
    }
    if ("execute" in data) {
      await executeTransaction();
      return;
    }
    if ("recovery" in data) {
      showRecovery(data.recovery);
      return;
    }
    if ("correction" in data) {
      showCorrection();
      return;
    }
    if ("editEvent" in data) {
      showEventSettings();
      return;
    }
    if ("checkin" in data) {
      showCheckin(data.checkin);
      return;
    }
    if ("tx" in data) {
      await prepareTransaction(data.tx, {
        ...(data.wallet ? { wallet: data.wallet } : {}),
        ...(data.tx === "appealRewards" ? { sides: [0, 1, 2] } : {}),
      });
      return;
    }
    if ("personal" in data) {
      button.disabled = true;
      await post(eventPath("/personal"), { attended: true });
      await load({ silent: true });
      toast("Personal attendance saved. Financial eligibility is unchanged.");
      return;
    }
    if ("advance" in data) {
      invalidateDraft();
      button.disabled = true;
      await post("/api/demo/advance", { seconds: Number(data.advance) });
      await load({ silent: true });
      toast("Local chain time advanced. Transaction drafts cleared.");
      return;
    }
    if ("publish" in data) {
      button.disabled = true;
      const result = await post(
        eventPath(`/cases/${encodeURIComponent(data.publish)}/publish`),
        {},
      );
      await load({ silent: true });
      toast(
        `Exact case bytes verified and stored locally (${result.status}). IPFS network publication is not enabled.`,
      );
      return;
    }
    if ("ruling" in data) {
      button.disabled = true;
      await post(eventPath("/demo/ruling"), {
        wallet: data.wallet,
        ruling: Number(data.ruling),
      });
      await load({ silent: true });
      toast(
        "Mock Court ruling recorded. Review “Settle final / unmatched case” to apply it to the event contract.",
      );
      return;
    }
    if ("openAppeal" in data) {
      button.disabled = true;
      await post(eventPath("/demo/appeal"), {
        wallet: data.openAppeal,
        ruling: 1,
        duration: 3600,
      });
      await load({ silent: true });
      toast("Mock appeal period opened for one local hour.");
    }
  } catch (error) {
    toast(error.message, true);
    if (!button.matches("[data-execute]")) button.disabled = false;
  }
});

document.addEventListener("submit", async (event) => {
  if (!(event.target instanceof Element)) return;
  const form = event.target.closest("form[data-form]");
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  const submit = $("[type=submit],button:not([type])", form);
  if (submit) submit.disabled = true;
  try {
    switch (form.dataset.form) {
      case "registration":
        await post(eventPath("/participants"), values);
        await load({ silent: true });
        toast(
          "Registration linked to your authenticated local wallet. Organizer admission is pending.",
        );
        break;
      case "receipt":
        await post(eventPath("/deposits"), values);
        await load({ silent: true });
        toast("Receipt and deposit log verified against this event.");
        break;
      case "checkin":
        await post(eventPath("/checkins"), {
          participantId: form.dataset.participant,
          nonce: crypto.randomUUID(),
          source: "staff-door",
          note: values.note,
        });
        await load({ silent: true });
        toast("Trusted event check-in recorded with reviewer and nonce.");
        break;
      case "import": {
        const result = await post(eventPath("/imports"), {
          kind: values.kind,
          csv: values.csv,
          ...(values.sourceEventId
            ? { sourceEventId: values.sourceEventId }
            : {}),
          ...(values.reviewConfirmed
            ? { review: { confirmed: true, note: values.reviewNote } }
            : {}),
        });
        const batch = result.batch ?? {};
        const resultHTML = `<div class="notice success"><strong>Import validated</strong><br>${Array.isArray(result.rows) ? result.rows.length : (result.rows ?? 0)} rows reviewed. ${escape(result.limitation ?? "")}</div>${result.errors?.length ? `<div class="notice warning">${escape(JSON.stringify(result.errors))}</div>` : ""}<div class="source-hash">Source hash: ${escape(batch.sourceHash ?? batch.sha256 ?? "Recorded by server")}<br>Batch: ${escape(batch.id ?? "Recorded")}</div>`;
        await load({ silent: true });
        if ($("#import-result")) $("#import-result").innerHTML = resultHTML;
        toast("Import reviewed and bound to the selected event.");
        break;
      }
      case "recovery":
        await prepareTransaction(form.dataset.action, {
          to: values.to,
          ...(values.amount ? { amountWei: toWei(values.amount) } : {}),
        });
        break;
      case "event-settings":
        await api(eventPath(""), {
          method: "PATCH",
          body: JSON.stringify(values),
        });
        await load({ silent: true });
        toast(
          "Event settings saved. Financial terms remain bound to their original deployment.",
        );
        break;
      case "correction":
        await prepareTransaction("addAttendees", {
          wallets: addressList(values.wallets),
        });
        break;
      case "evidence":
        await prepareTransaction("evidence", {
          wallet: form.dataset.wallet,
          uri: values.uri,
        });
        break;
      case "appeal":
        await prepareTransaction("fundAppeal", {
          wallet: form.dataset.wallet,
          side: Number(values.side),
          amountWei: toWei(values.amount),
        });
        break;
      case "create-event": {
        const created = await post("/api/events", {
          ...values,
          startsAt: new Date(`${values.startsAt}:00Z`).toISOString(),
          endsAt: new Date(`${values.endsAt}:00Z`).toISOString(),
        });
        invalidateDraft();
        toast("Independent local event and v7 contract created.");
        navigate(created.id ?? created.event?.id);
        break;
      }
    }
  } catch (error) {
    toast(error.message, true);
  } finally {
    if (submit?.isConnected) submit.disabled = false;
  }
});

$("#review-dialog").addEventListener("close", () => {
  app.draft = null;
});
$("#refresh").addEventListener("click", () => load());
$("#demo-help").addEventListener("click", showDemoHelp);
window.addEventListener("hashchange", () => {
  invalidateDraft();
  load();
  window.scrollTo({ top: 0 });
});
load();
