// @ts-check
import { ethers } from "ethers";
import {
  localChain,
  deployEvent,
  contractFor,
  chainState,
  DAY,
} from "./chain.mjs";
import { importCsv } from "./imports.mjs";
import { createImportPreviewService } from "./import-preview.mjs";
import { projectPayments } from "./payments.mjs";
import { v8DepositCredits } from "./v8-deposits.mjs";
import { testnetChain, testnetStateStore } from "./testnet-runtime.mjs";
import {
  hash,
  id,
  json,
  lower,
  requireThat,
  text,
  email,
  associations,
} from "./utils.mjs";
import { pairReturns, depKey } from "../references/kickback/scripts/lib.mjs";

const names = [
  "organizer-a",
  "organizer-b",
  "staff-a",
  "alice",
  "bob",
  "carol",
];
const labels = [
  "Organizer A · Maya",
  "Organizer B · Arun",
  "Door staff · Event A",
  "Alice · participant",
  "Bob · participant",
  "Carol · participant",
];
const ownerActions = new Set([
  "register",
  "reject",
  "postAttendance",
  "addAttendees",
  "cancel",
  "refund",
  "sweep",
  "transferOwnership",
]);

export async function createWorkbench({
  rpcPort = 0,
  contractVersion = "truth-pays-v7",
  testnet = null,
} = {}) {
  requireThat(
    ["truth-pays-v7", "kleros-event-v8"].includes(contractVersion),
    "Unsupported contract version",
  );
  const external = !!testnet;
  const chain = external
    ? await testnetChain(testnet.manifest, testnet.rpcUrl)
    : await localChain(rpcPort);
  const store = external
    ? testnetStateStore(testnet.stateFile, testnet.manifest)
    : null;
  const events = new Map(),
    drafts = new Map(),
    locks = new Set();
  const identities = await Promise.all(
    (external ? [] : names).map(async (name, i) => ({
      id: name,
      label: labels[i],
      wallet: await chain.signers[i].getAddress(),
      mode: "demo",
      signer: chain.signers[i],
    })),
  );
  const session = (identity) => {
    const found = identities.find((x) => x.id === identity);
    requireThat(found, "Unknown demo identity");
    return found;
  };
  function authenticated(s) {
    requireThat(
      s?.wallet && ethers.isAddress(s.wallet),
      "Sign in first",
      "UNAUTHENTICATED",
      401,
    );
  }
  function record(eventId, s) {
    const r = events.get(eventId);
    requireThat(r, "Unknown event", "NOT_FOUND", 404);
    if (
      r.definition.visibility === "private" ||
      r.definition.editorialStatus === "draft"
    )
      requireThat(
        s &&
          [
            r.definition.organizers,
            r.definition.staff,
            [...r.participants.values()].map((p) => p.wallet),
            r.financialAccess ?? [],
          ]
            .flat()
            .some((x) => lower(x) === lower(s.wallet)),
        "Private or unpublished event",
        "FORBIDDEN",
        403,
      );
    return r;
  }
  const contract = (eventId) => {
    const r = events.get(eventId);
    requireThat(r, "Unknown event", "NOT_FOUND", 404);
    return contractFor(chain, r.deployment);
  };
  const state = async (eventId) => {
    const r = events.get(eventId);
    requireThat(r, "Unknown event", "NOT_FOUND", 404);
    const result = await chainState(chain, r);
    r.financialAccess = [result.owner, result.pendingOwner];
    return result;
  };
  async function owner(eventId, s) {
    authenticated(s);
    await state(eventId);
    const r = record(eventId, s);
    requireThat(
      lower(await contractFor(chain, r.deployment).owner()) === lower(s.wallet),
      "Only this event’s current contract owner can do that",
      "NOT_OWNER",
      403,
    );
    return r;
  }
  async function staff(eventId, s) {
    authenticated(s);
    await state(eventId);
    const r = record(eventId, s);
    requireThat(
      r.definition.staff.some((x) => lower(x) === lower(s.wallet)) ||
        lower(await contractFor(chain, r.deployment).owner()) ===
          lower(s.wallet),
      "Staff access is scoped to this event",
      "NOT_STAFF",
      403,
    );
    return r;
  }
  function participantFor(r, s, participantId) {
    const p = participantId
      ? r.participants.get(participantId)
      : [...r.participants.values()].find(
          (x) => lower(x.wallet) === lower(s.wallet),
        );
    requireThat(p, "Register a linked participant first", "UNKNOWN_IDENTITY");
    return p;
  }
  async function createEvent(s, input, seedId) {
    authenticated(s);
    requireThat(
      !external && s.mode === "demo",
      "New deployments are local demo only",
      "DEMO_ONLY",
      403,
    );
    const title = text(input.title, 160, 2),
      slug = text(input.slug, 80, 2);
    requireThat(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) &&
        ![...events.values()].some((r) => r.definition.slug === slug),
      "Slug must be unique lowercase words",
    );
    const startsAt = text(input.startsAt, 40, 1),
      endsAt = text(input.endsAt, 40, 1);
    const start = Date.parse(startsAt) / 1000,
      end = Date.parse(endsAt) / 1000;
    const now = (await chain.provider.getBlock("latest")).timestamp;
    requireThat(
      Number.isInteger(start) &&
        end > start &&
        start > now &&
        /(Z|[+-]\d\d:\d\d)$/.test(startsAt) &&
        /(Z|[+-]\d\d:\d\d)$/.test(endsAt),
      "Schedule must have explicit timezone and start in local chain future",
    );
    const timezone = text(input.timezone, 100, 1);
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone });
    } catch {
      requireThat(false, "Use an IANA timezone");
    }
    let depositWei;
    try {
      depositWei = ethers.parseEther(String(input.depositEth));
    } catch {
      requireThat(false, "Invalid ETH deposit");
    }
    requireThat(
      depositWei > 0n && depositWei <= ethers.parseEther("1"),
      "Local deposit must be >0 and <=1 ETH",
    );
    requireThat(
      !Object.hasOwn(input, "_seedId") &&
        !Object.hasOwn(input, "id") &&
        !Object.hasOwn(input, "eventId"),
      "Stable event IDs are assigned by the registry",
      "RESERVED_EVENT_ID",
      403,
    );
    const eventId = seedId ?? id();
    requireThat(
      !events.has(eventId),
      "Event identity already exists",
      "DUPLICATE_EVENT",
      409,
    );
    const definition = {
      id: eventId,
      slug,
      title,
      description: text(input.description ?? "", 2000),
      startsAt,
      endsAt,
      timezone,
      location: text(input.location, 200, 1),
      visibility: input.visibility === "private" ? "private" : "public",
      editorialStatus: "published",
      registrationStatus: "open",
      organizers: [s.wallet],
      staff: [],
      ...associations(input),
    };
    const financial = await deployEvent(
      chain,
      definition,
      s.signer,
      depositWei,
      start,
      end + 14 * DAY,
      { contractVersion },
    );
    const r = {
      definition,
      ...financial,
      financialAccess: [s.wallet],
      participants: new Map(),
      observations: [],
      batches: [],
      personal: new Map(),
      publications: new Map(),
      transactions: [],
      nonces: new Set(),
      revision: 0,
    };
    events.set(eventId, r);
    return {
      ...definition,
      ...financial.deployment,
      financialPhase: "Open",
      depositWei: String(depositWei),
    };
  }
  const initial = (await chain.provider.getBlock("latest")).timestamp;
  for (const [i, eventId] of (external
    ? []
    : ["event-a", "event-b"]
  ).entries()) {
    const start = initial + (i + 1) * 3600;
    await createEvent(
      identities[i],
      {
        title: i ? "Open Justice Workshop" : "Proof of Presence",
        slug: i ? "open-justice-workshop" : "proof-of-presence",
        description: i
          ? "A hands-on workshop on dispute resolution. An independent event with its own organizer and deposit pool."
          : "Meet the people building fairer systems. Choose a free request or a refundable committed spot.",
        startsAt: new Date(start * 1000).toISOString(),
        endsAt: new Date((start + 4 * 3600) * 1000).toISOString(),
        timezone: i ? "Asia/Bangkok" : "Asia/Kolkata",
        location: i
          ? "Studio B · Bangkok (synthetic)"
          : "Forum A · Mumbai (synthetic)",
        depositEth: i ? "0.02" : "0.01",
      },
      eventId,
    );
    const r = events.get(eventId);
    if (!i) r.definition.staff = [identities[2].wallet];
    for (const p of identities.slice(3))
      r.participants.set(`${eventId}-${p.id}`, {
        id: `${eventId}-${p.id}`,
        eventId,
        name: p.id[0].toUpperCase() + p.id.slice(1),
        email: `${p.id}@example.test`,
        wallet: p.wallet,
        identityVerified: true,
        identitySource: "local-demo-signer",
        admission: "pending",
        deposit: null,
      });
  }
  if (external) {
    for (const initial of testnet.manifest.events) {
      const eventId = initial.definition.id;
      requireThat(!events.has(eventId), "Duplicate testnet event ID");
      events.set(eventId, {
        ...initial,
        financialAccess: [],
        participants: new Map(),
        observations: [],
        batches: [],
        personal: new Map(),
        publications: new Map(),
        transactions: [],
        nonces: new Set(),
        revision: 0,
      });
    }
    const saved = store.load();
    if (saved) {
      for (const item of saved.events) {
        const r = events.get(item.eventId);
        requireThat(
          r && item.definition.id === item.eventId,
          "Persisted event identity mismatch",
        );
        requireThat(item.definition.title === r.definition.title &&
          item.definition.startsAt === r.definition.startsAt &&
          item.definition.endsAt === r.definition.endsAt,
          "Persisted event schedule or title differs from its manifest");
        const definition = { ...r.definition };
        for (const key of ["description", "location", "visibility", "editorialStatus", "registrationStatus", "lumaEventId", "lumaUrl", "contentEventId", "contentUrl"])
          if (Object.hasOwn(item.definition, key)) definition[key] = item.definition[key];
        Object.assign(r, {
          definition, revision: item.revision, observations: item.observations,
          batches: item.batches, transactions: item.transactions,
          participants: new Map(item.participants),
          personal: new Map(item.personal),
          publications: new Map(item.publications),
          nonces: new Set(item.nonces),
        });
      }
      for (const [key, value] of saved.drafts) drafts.set(key, value);
    }
  }
  async function summary(r, s) {
    const st = await chainState(chain, r);
    const role =
      s && lower(s.wallet) === lower(st.owner)
        ? "organizer"
        : s && r.definition.staff.some((x) => lower(x) === lower(s.wallet))
          ? "staff"
          : "participant";
    return {
      ...r.definition,
      depositWei: r.deployment.depositWei,
      contract: r.deployment.contract,
      chainId: r.deployment.chainId,
      deploymentBlock: r.deployment.deploymentBlock,
      contractVersion: r.deployment.contractVersion,
      abiVersion: r.deployment.abiVersion,
      claimDeadline: r.deployment.claimDeadline,
      policyURI: r.deployment.policyURI,
      templateHash: r.deployment.templateHash,
      depositOpensAt: r.deployment.depositOpensAt,
      depositDeadline: r.deployment.depositDeadline,
      resolver: r.deployment.resolver,
      arbitrator: r.deployment.arbitrator,
      financialPhase: st.phase,
      role,
    };
  }
  async function bootstrap(s) {
    await Promise.all(
      [...events.values()]
        .filter(
          (r) =>
            r.definition.visibility === "private" ||
            r.definition.editorialStatus === "draft",
        )
        .map((r) => state(r.definition.id)),
    );
    const visible = [...events.values()].filter((r) => {
      try {
        record(r.definition.id, s);
        return true;
      } catch {
        return false;
      }
    });
    return {
      mode: external ? "testnet" : "local-demo",
      identities: identities.map(({ signer, ...x }) => x),
      session: s ? { wallet: s.wallet, label: s.label, mode: s.mode } : null,
      events: await Promise.all(visible.map((r) => summary(r, s))),
      chain: external
        ? testnet.manifest.chain
        : {
            chainId: Number((await chain.provider.getNetwork()).chainId),
            rpcUrl: chain.rpcUrl,
            name: "Local demo",
            nativeCurrency: { name: "Demo Ether", symbol: "ETH", decimals: 18 },
          },
      contractVersion: external ? "kleros-event-v8" : contractVersion,
      ...(external
        ? {
            arbitration: {
              mode: "controlled",
              notice: "Controlled test arbitrator; no independent jury",
            },
          }
        : {}),
      now: (await chain.provider.getBlock("latest")).timestamp,
    };
  }
  async function detail(eventId, s) {
    const st = await state(eventId),
      r = record(eventId, s),
      event = await summary(r, s);
    const privileged = event.role !== "participant";
    const participants = await Promise.all(
      [...r.participants.values()]
        .filter((p) => privileged || (s && lower(p.wallet) === lower(s.wallet)))
        .map(async (p) => {
          const status = Number(await contract(eventId).status(p.wallet));
          let verificationState = p.deposit ? "current" : "missing",
            verificationError = null;
          if (p.deposit)
            try {
              await verifyReceipt(eventId, p, p.deposit.txHash, true);
            } catch (e) {
              verificationState =
                e.code === "RETURNED_DEPOSIT" ? "returned" : "unavailable";
              verificationError = e.code ?? "VERIFICATION_UNAVAILABLE";
            }
          return {
            ...p,
            status,
            registrationState: ["unregistered", "active", "paid", "rejected"][
              status
            ],
            deposit: p.deposit
              ? {
                  ...p.deposit,
                  receiptVerified: true,
                  verified: verificationState === "current",
                  verificationState,
                  verificationError,
                }
              : null,
            registered: [1, 2].includes(status),
            attended: await contract(eventId).attended(p.wallet),
            owedWei: String(await contract(eventId).owed(p.wallet)),
            ...(r.deployment.contractVersion === "kleros-event-v8"
              ? {
                  pendingCreditWei: st.pendingCredits?.[lower(p.wallet)] ?? "0",
                }
              : {}),
          };
        }),
    );
    const deposits = privileged ? await depositLedger(eventId) : [];
    return {
      event,
      state: st,
      payments: await projectPayments(chain, r, { blockTag: st.blockNumber }),
      participants,
      deposits,
      unmatched: deposits.filter((x) => BigInt(x.unallocatedWei) > 0n),
      imports: privileged ? r.batches : [],
      attendance: privileged
        ? r.observations
        : r.observations.filter((o) =>
            participants.some((p) => p.id === o.participantId),
          ),
      personal: s ? (r.personal.get(lower(s.wallet)) ?? null) : null,
      transactions: r.transactions.filter(
        (t) => privileged || (s && lower(t.wallet) === lower(s.wallet)),
      ),
      permissions: {
        owner: event.role === "organizer",
        staff: privileged,
        authenticated: !!s,
      },
      now: st.now,
    };
  }
  async function depositLedger(eventId) {
    const r = events.get(eventId),
      c = contract(eventId),
      from = r.deployment.deploymentBlock;
    const [deposited, rejected, refunded] = await Promise.all([
      c.queryFilter(c.filters.Deposited(), from),
      c.queryFilter(c.filters.Rejected(), from),
      c.queryFilter(c.filters.Refunded(), from),
    ]);
    if (r.deployment.contractVersion === "kleros-event-v8") {
      const credits = await v8DepositCredits(c, r.deployment);
      return Promise.all(
        [...credits.values()].map(async (e) => {
          const pending = await c.pendingDeposits(e.wallet);
          const projected = e.lots.reduce((sum, lot) => sum + lot.pending, 0n);
          requireThat(
            pending === projected,
            "v8 credit projection differs from contract",
            "CREDIT_HISTORY",
            409,
          );
          const received = e.lots.reduce((sum, lot) => sum + lot.amount, 0n);
          const committed = e.lots.reduce(
            (sum, lot) => sum + lot.committed,
            0n,
          );
          const p = [...r.participants.values()].find(
            (p) => lower(p.wallet) === lower(e.wallet),
          );
          return {
            eventId,
            wallet: e.wallet,
            participantId: p?.id ?? null,
            receivedWei: String(received),
            returnedWei: String(received - pending - committed),
            allocatedWei: String(committed),
            unallocatedWei: String(pending),
            pendingCreditWei: String(pending),
            linked: !!p?.deposit,
            transactions: e.lots.map((lot) => ({
              txHash: lot.txHash,
              logIndex: lot.logIndex,
              amountWei: String(lot.amount),
            })),
            note: "Unused credit belongs to this payer and can be recovered directly; it is never organizer spare ETH.",
          };
        }),
      );
    }
    /** @type {Map<string,{wallet:string,received:bigint,returned:bigint,transactions:object[]}>} */
    const ledger = new Map();
    const entry = (wallet) => {
      const key = lower(wallet);
      if (!ledger.has(key))
        ledger.set(key, {
          wallet,
          received: 0n,
          returned: 0n,
          transactions: [],
        });
      return ledger.get(key);
    };
    for (const l of deposited) {
      if (!("args" in l)) continue;
      const e = entry(l.args.from);
      e.received += l.args.amount;
      e.transactions.push({
        txHash: l.transactionHash,
        logIndex: l.index,
        amountWei: String(l.args.amount),
      });
    }
    for (const l of rejected) {
      if ("args" in l) entry(l.args.wallet).returned += l.args.refunded;
    }
    for (const l of refunded) {
      if ("args" in l) entry(l.args.to).returned += l.args.amount;
    }
    return Promise.all(
      [...ledger.values()].map(async (e) => {
        const status = Number(await c.status(e.wallet)),
          allocated = [1, 2].includes(status)
            ? BigInt(r.deployment.depositWei)
            : 0n;
        const unallocated = e.received - e.returned - allocated;
        const p = [...r.participants.values()].find(
          (p) => lower(p.wallet) === lower(e.wallet),
        );
        return {
          eventId,
          wallet: e.wallet,
          participantId: p?.id ?? null,
          receivedWei: String(e.received),
          returnedWei: String(e.returned),
          allocatedWei: String(allocated),
          unallocatedWei: String(unallocated > 0n ? unallocated : 0n),
          linked: !!p?.deposit,
          transactions: e.transactions,
          note: !p
            ? "No verified participant identity is linked"
            : !p.deposit
              ? "Receipt is not yet linked to this participant"
              : status === 0
                ? "Admission/registration still required"
                : "Registered principal excluded from spare returns",
        };
      }),
    );
  }
  async function registerParticipant(eventId, s, input) {
    authenticated(s);
    const r = record(eventId, s);
    requireThat(
      r.definition.registrationStatus === "open",
      "Registration is closed",
    );
    requireThat(
      ![...r.participants.values()].some(
        (p) => lower(p.wallet) === lower(s.wallet),
      ),
      "This wallet is already linked",
      "DUPLICATE_IDENTITY",
      409,
    );
    const contact = email(input.email);
    requireThat(
      ![...r.participants.values()].some((p) => p.email === contact),
      "Email is already linked in this event",
      "DUPLICATE_IDENTITY",
      409,
    );
    const p = {
      id: id(),
      eventId,
      name: text(input.name, 100, 1),
      email: contact,
      wallet: ethers.getAddress(s.wallet),
      identityVerified: true,
      identitySource:
        s.mode === "demo" ? "local-demo-signer" : "signed-wallet-nonce",
      admission: "pending",
      deposit: null,
    };
    r.participants.set(p.id, p);
    r.revision++;
    return p;
  }
  async function admit(eventId, s, participantId, admission) {
    const r = await owner(eventId, s);
    requireThat(
      ["pending", "approved", "declined", "free"].includes(admission),
      "Invalid admission",
    );
    const p = participantFor(r, s, participantId);
    requireThat(
      (await state(eventId)).phase === "Open",
      "Admission is closed after attendance posting",
    );
    p.admission = admission;
    r.revision++;
    return p;
  }
  async function verifyReceipt(eventId, p, txHash, allowLinked = false) {
    requireThat(
      /^0x[0-9a-fA-F]{64}$/.test(txHash ?? ""),
      "A transaction hash is required",
    );
    const r = events.get(eventId),
      d = r.deployment,
      c = contract(eventId);
    requireThat(
      Number((await chain.provider.getNetwork()).chainId) === d.chainId,
      "Wrong chain",
      "WRONG_CHAIN",
      409,
    );
    const receipt = await chain.provider.getTransactionReceipt(txHash);
    requireThat(
      receipt && receipt.status === 1,
      "Deposit is pending, missing, or failed",
      "DEPOSIT_UNCONFIRMED",
      409,
    );
    const receiptBlock = await chain.provider.getBlock(receipt.blockNumber);
    requireThat(
      receipt.blockNumber >= d.deploymentBlock &&
        receiptBlock?.hash === receipt.blockHash,
      "Deposit is not canonical for this deployment",
      "DEPOSIT_REORG",
      409,
    );
    requireThat(
      receiptBlock.timestamp >= d.depositOpensAt &&
        receiptBlock.timestamp < d.depositDeadline,
      "Deposit is outside this event’s registration window; organizer must review its return",
      "OUTSIDE_DEPOSIT_WINDOW",
      409,
    );
    const logs = receipt.logs
      .filter((l) => lower(l.address) === lower(d.contract))
      .map((l) => {
        try {
          return { log: l, parsed: c.interface.parseLog(l) };
        } catch {
          return null;
        }
      })
      .filter(
        (l) =>
          l?.parsed?.name === "Deposited" &&
          lower(l.parsed.args.from) === lower(p.wallet),
      );
    requireThat(
      logs.length === 1,
      "Receipt has no unique deposit from this participant to this contract",
      "WRONG_DEPOSIT",
      409,
    );
    const log = logs[0];
    requireThat(
      log.parsed.args.amount >= BigInt(d.depositWei),
      "Deposit amount is too small",
      "SHORT_DEPOSIT",
      409,
    );
    if (d.contractVersion === "kleros-event-v8") {
      const person = (await v8DepositCredits(c, d)).get(lower(p.wallet));
      const lot = person?.lots.find(
        (lot) =>
          lower(lot.txHash) === lower(txHash) && lot.logIndex === log.log.index,
      );
      const committed =
        person?.lots.reduce((sum, item) => sum + item.committed, 0n) ?? 0n;
      requireThat(
        lot &&
          (lot.pending >= BigInt(d.depositWei) ||
            (lot.committed > 0n && committed === BigInt(d.depositWei))),
        "This deposit credit was recovered or refunded and cannot be reused",
        "RETURNED_DEPOSIT",
        409,
      );
      const pending = person.lots.reduce((sum, lot) => sum + lot.pending, 0n);
      requireThat(
        pending === (await c.pendingDeposits(p.wallet)),
        "v8 credit history differs from contract",
        "CREDIT_HISTORY",
        409,
      );
    } else {
      // Preserve historical v7 pairing: spare returns do not erase held principal.
      const [deposited, rejected, refunded, registered] = await Promise.all([
        c.queryFilter(c.filters.Deposited(p.wallet), d.deploymentBlock),
        c.queryFilter(c.filters.Rejected(p.wallet), d.deploymentBlock),
        c.queryFilter(c.filters.Refunded(p.wallet), d.deploymentBlock),
        c.queryFilter(c.filters.StakerRegistered(p.wallet), d.deploymentBlock),
      ]);
      const deposits = deposited
        .filter((x) => "args" in x)
        .map((x) => ({
          tx: x.transactionHash,
          from: p.wallet,
          amount: /** @type {import('ethers').EventLog} */ (x).args.amount,
          block: x.blockNumber,
          logIndex: x.index,
        }));
      const returnEvents = [...rejected, ...refunded, ...registered]
        .filter((x) => "args" in x)
        .map((x) => {
          const l = /** @type {import('ethers').EventLog} */ (x);
          return {
            type: l.eventName,
            wallet: p.wallet,
            amount: l.eventName === "StakerRegistered" ? 0n : l.args[1],
            block: l.blockNumber,
            logIndex: l.index,
            tx: l.transactionHash,
          };
        });
      const status = Number(await c.status(p.wallet));
      const paired = pairReturns(deposits, returnEvents, {
        deposit: BigInt(d.depositWei),
        prefer: new Set(
          [...r.participants.values()]
            .map((x) => lower(x.deposit?.txHash))
            .concat(lower(txHash)),
        ),
        stakers: new Set([1, 2].includes(status) ? [lower(p.wallet)] : []),
      });
      const held = paired.byDeposit.get(depKey(txHash, p.wallet));
      requireThat(
        held && held.remaining >= BigInt(d.depositWei),
        "Deposit principal was returned and cannot be reused",
        "RETURNED_DEPOSIT",
        409,
      );
    }
    const used = [...r.participants.values()].find(
      (x) =>
        x.deposit &&
        lower(x.deposit.txHash) === lower(txHash) &&
        x.deposit.logIndex === log.log.index,
    );
    requireThat(
      !used || (allowLinked && used.id === p.id),
      "Deposit log is already claimed",
      "DUPLICATE_EVIDENCE",
      409,
    );
    return {
      eventId,
      chainId: d.chainId,
      contract: d.contract,
      txHash,
      logIndex: log.log.index,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      amountWei: String(log.parsed.args.amount),
      wallet: p.wallet,
      verified: true,
    };
  }
  async function linkDeposit(eventId, s, input) {
    authenticated(s);
    const r = record(eventId, s);
    if (input.participantId) await owner(eventId, s);
    const p = participantFor(r, s, input.participantId);
    p.deposit = await verifyReceipt(eventId, p, input.txHash);
    const submitted = r.transactions.find(
      (t) =>
        lower(t.hash) === lower(input.txHash) &&
        t.action === "deposit" &&
        lower(t.wallet) === lower(p.wallet),
    );
    if (submitted) {
      submitted.status = "confirmed";
      submitted.blockNumber = p.deposit.blockNumber;
      const draft = drafts.get(submitted.draftId);
      if (draft) {
        draft.used = true;
        draft.confirmedHash = input.txHash;
      }
    }
    r.revision++;
    return p;
  }
  async function checkin(eventId, s, input) {
    const r = await staff(eventId, s),
      p = participantFor(r, s, input.participantId);
    requireThat(p.identityVerified, "Participant wallet must be verified");
    requireThat(
      input.source === "staff-door",
      "Only authenticated door observations can use this endpoint",
      "UNTRUSTED_SOURCE",
    );
    const nonce = text(input.nonce, 100, 8);
    requireThat(
      !r.nonces.has(nonce),
      "Check-in nonce was already used",
      "REPLAY",
      409,
    );
    const timestamp = (await chain.provider.getBlock("latest")).timestamp;
    requireThat(
      timestamp >= Date.parse(r.definition.startsAt) / 1000 &&
        timestamp <= Date.parse(r.definition.endsAt) / 1000,
      "Door check-in is outside event hours",
      "ATTENDANCE_TIME_MISMATCH",
      409,
    );
    requireThat(
      !r.observations.some((o) => o.participantId === p.id),
      "Participant already checked in",
      "DUPLICATE_CHECKIN",
      409,
    );
    const o = {
      id: id(),
      eventId,
      participantId: p.id,
      source: "staff-door",
      reviewer: s.wallet,
      timestamp,
      nonce,
      note: text(input.note ?? "", 500),
    };
    r.observations.push(o);
    r.nonces.add(nonce);
    r.revision++;
    return o;
  }
  function personal(eventId, s, input) {
    authenticated(s);
    const r = record(eventId, s);
    r.personal.set(lower(s.wallet), {
      attended: input.attended === true,
      source: "self-reported",
    });
    return r.personal.get(lower(s.wallet));
  }

  async function actionSpec(eventId, s, action, params, st) {
    authenticated(s);
    const r = record(eventId, s),
      c = contract(eventId);
    if (ownerActions.has(action)) await owner(eventId, s);
    let target = c,
      method,
      args = [],
      value = 0n,
      summaryText;
    const wallet = () => ethers.getAddress(params.wallet ?? s.wallet);
    const to = () => ethers.getAddress(params.to ?? s.wallet);
    const eligible = async (admission) => {
      const candidates = [...r.participants.values()].filter(
        (p) => p.admission === admission && p.deposit && p.identityVerified,
      );
      const result = [];
      for (const p of candidates) {
        const status = Number(await c.status(p.wallet));
        if (
          (admission === "approved" && status === 1) ||
          (admission === "declined" && status === 3)
        )
          continue;
        await verifyReceipt(eventId, p, p.deposit.txHash, true);
        result.push(p.wallet);
      }
      if (params.wallets) {
        requireThat(
          Array.isArray(params.wallets) && params.wallets.length > 0,
          "Select wallets",
        );
        return params.wallets.map((w) => {
          requireThat(
            result.some((x) => lower(x) === lower(w)),
            "Wallet lacks approved verified evidence",
            "UNVERIFIED_STAKER",
            403,
          );
          return ethers.getAddress(w);
        });
      }
      return result;
    };
    switch (action) {
      case "deposit": {
        requireThat(
          !r.transactions.some(
            (t) =>
              t.action === "deposit" &&
              lower(t.wallet) === lower(s.wallet) &&
              ["pending", "mined"].includes(t.status),
          ),
          "An earlier deposit is submitted; verify its receipt before preparing another",
          "PENDING_DEPOSIT",
          409,
        );
        requireThat(
          st.now >= r.deployment.depositOpensAt &&
            st.now < r.deployment.depositDeadline,
          "Committed deposits close at the event start",
          "OUTSIDE_DEPOSIT_WINDOW",
          409,
        );
        const p = participantFor(r, s);
        if (p.deposit) {
          let returned = false;
          try {
            await verifyReceipt(eventId, p, p.deposit.txHash, true);
          } catch (e) {
            if (e.code === "RETURNED_DEPOSIT") returned = true;
            else throw e;
          }
          requireThat(
            returned,
            "An existing deposit is already linked",
            "DUPLICATE_DEPOSIT",
            409,
          );
        }
        requireThat(
          r.definition.registrationStatus === "open",
          "Registration closed",
        );
        method = "deposit";
        value = BigInt(r.deployment.depositWei);
        summaryText =
          "Send exactly this event’s refundable ETH deposit. Admission remains an organizer decision.";
        break;
      }
      case "register":
        method = "registerStakers";
        args = [await eligible("approved")];
        requireThat(
          args[0].length > 0,
          "No approved, verified unregistered participants",
        );
        summaryText =
          "Register only wallets with confirmed unreturned deposit evidence and approved admission.";
        break;
      case "reject":
        method = "rejectAndRefund";
        args = [await eligible("declined")];
        requireThat(args[0].length > 0, "No declined deposits to refund");
        summaryText =
          "Return one deposit to each declined wallet. Failed transfers become claimable owed balances.";
        break;
      case "postAttendance": {
        for (const p of r.participants.values())
          if (
            p.deposit &&
            p.admission !== "approved" &&
            Number(await c.status(p.wallet)) !== 3
          )
            requireThat(
              false,
              "Resolve pending/free/declined paid registrations and refunds before posting",
              "UNRESOLVED_ADMISSION",
              409,
            );
        const list = [
          ...new Set(
            r.observations
              .map((o) => r.participants.get(o.participantId)?.wallet)
              .filter(Boolean),
          ),
        ].filter((w) => st.activeStakers.some((x) => lower(x) === lower(w)));
        requireThat(
          list.length > 0,
          "No registered trusted attendees; use cancellation or no-list recovery for zero attendance",
          "NO_ATTENDEES",
        );
        method = "postAttendance";
        args = [list, BigInt(st.poolWei) / BigInt(list.length)];
        summaryText =
          "Post reviewed trusted attendance and open the one-day challenge window. Personal history and merch have no effect.";
        break;
      }
      case "challenge":
        method = "challenge";
        value = BigInt(st.challengeDepositWei);
        summaryText =
          "Challenge your omission. A separate one-day matching period starts; unmatched expired challenges count as attended.";
        break;
      case "match": {
        const ch = await c.challenges(wallet());
        method = "matchChallenge";
        args = [wallet()];
        value = ch.deposit;
        summaryText =
          "Match this challenge to open a local mock V1 Court case. One provisional share may be reserved during payouts.";
        break;
      }
      case "addAttendees": {
        requireThat(
          Array.isArray(params.wallets) && params.wallets.length,
          "Select attendees",
        );
        const eligibleWallets = r.observations.map(
          (o) => r.participants.get(o.participantId)?.wallet,
        );
        requireThat(
          params.wallets.every((w) =>
            eligibleWallets.some((x) => lower(x) === lower(w)),
          ),
          "Corrections need a trusted reviewed observation",
          "UNVERIFIED_ATTENDANCE",
        );
        method = "addAttendees";
        args = [params.wallets];
        summaryText =
          "Correct trusted omitted attendees before matching. Already matched cases require evidence and a final ruling.";
        break;
      }
      case "resolve":
        method = "resolveChallenge";
        args = [wallet()];
        summaryText =
          "Apply an expired unmatched challenge or final resolver ruling. Ruling 0 excludes and splits remaining challenge deposits.";
        break;
      case "release":
        method = "releasePayouts";
        summaryText =
          "Pay established attendees now, reserving a complete provisional share for each open matched case.";
        break;
      case "cancel":
        method = "cancel";
        summaryText =
          "Cancel while Open and within the posting deadline; return each registered deposit. Unregistered payers need separate returns.";
        break;
      case "emergencyWithdraw":
        method = "emergencyWithdraw";
        args = [to()];
        summaryText =
          "Withdraw your registered deposit only after the posting deadline if no attendance list was posted.";
        break;
      case "claim":
        method = "claim";
        args = [to()];
        summaryText =
          "Collect your owed failed payment at this destination. This is separate from ordinary batch payouts.";
        break;
      case "withdrawPending": {
        requireThat(
          r.deployment.contractVersion === "kleros-event-v8",
          "Independent unused-credit recovery requires v8",
          "WRONG_VERSION",
          409,
        );
        const amount = BigInt(params.amountWei ?? "0");
        const credit = await c.pendingDeposits(s.wallet);
        requireThat(
          amount > 0n && amount <= credit,
          "Choose an amount within your unused deposit credit",
          "INSUFFICIENT_CREDIT",
          409,
        );
        method = "withdrawPending";
        args = [to(), amount];
        summaryText =
          "Recover your own unused deposit credit to this address. This does not withdraw an admitted commitment or anyone else's funds.";
        break;
      }
      case "refund":
        method = "refund";
        args = [to(), BigInt(params.amountWei)];
        summaryText =
          "Return spare ETH only. Registered pool, held shares, owed payments and challenge escrow remain reserved.";
        break;
      case "sweep":
        method = "sweep";
        args = [to()];
        summaryText =
          "Collect available rounding dust after settlement, preserving all reserves.";
        break;
      case "transferOwnership":
        method = "transferOwnership";
        args = [to()];
        summaryText =
          "Begin two-step ownership transfer; new wallet must accept.";
        break;
      case "acceptOwnership":
        method = "acceptOwnership";
        summaryText = "Accept pending ownership from this wallet.";
        break;
      case "passPeriod":
      case "deliverRuling": {
        const ch = await c.challenges(wallet());
        requireThat(
          Number(ch.state) === 2,
          "A matched unresolved case is required",
        );
        target = chain.liquid;
        method = action === "passPeriod" ? "passPeriod" : "executeRuling";
        args = [ch.arbitratorDisputeID];
        summaryText =
          action === "passPeriod"
            ? "Advance the arbitrator after its appeal deadline. Only the arbitrator case ID is used; no vote or resolver ruling is overridden."
            : "Deliver the final arbitrator vote to the V1 resolver. Its one-sided appeal funding override still determines the final ruling; event settlement remains a separate action.";
        break;
      }
      case "evidence":
      case "fundAppeal":
      case "appealRewards": {
        const ch = await c.challenges(wallet());
        requireThat(
          Number(ch.state) >= 2 &&
            lower(ch.matcher) !== lower(ethers.ZeroAddress),
          "A matched Court case is required",
          "NOT_MATCHED_CASE",
          409,
        );
        target = chain.resolver;
        const localId = ch.localDisputeID;
        if (action === "evidence") {
          requireThat(
            /^\/(ipfs|local-evidence)\/[A-Za-z0-9/._-]+$/.test(
              params.uri ?? "",
            ),
            "Evidence must use an IPFS or local evidence URI",
          );
          method = "submitEvidence";
          args = [localId, params.uri];
          summaryText =
            "Submit evidence under the resolver LOCAL ID from your own wallet.";
        }
        if (action === "fundAppeal") {
          requireThat(
            [0, 1, 2].includes(Number(params.side)),
            "Invalid appeal side",
          );
          method = "fundAppeal";
          args = [localId, Number(params.side)];
          value = BigInt(params.amountWei);
          requireThat(value > 0n, "Appeal contribution must be positive");
          summaryText =
            "Contribute directly from your wallet to the resolver. Ruling 0 funded alone can win and counts as excluded.";
        }
        if (action === "appealRewards") {
          requireThat(
            Array.isArray(params.sides) &&
              params.sides.every((x) => [0, 1, 2].includes(x)),
            "Invalid sides",
          );
          method = "withdrawFeesAndRewardsForAllRounds";
          args = [localId, s.wallet, params.sides];
          summaryText =
            "Collect your resolver appeal refunds/rewards, separately from the event pool.";
        }
        break;
      }
      default:
        requireThat(false, "Unsupported action", "UNKNOWN_ACTION");
    }
    return { target, method, args, value, summary: summaryText };
  }
  async function createDraft(eventId, s, { action, params = {} }) {
    const st = await state(eventId),
      r = record(eventId, s);
    const spec = await actionSpec(eventId, s, action, params, st);
    const tx = {
      to: spec.target.target,
      from: s.wallet,
      data: spec.target.interface.encodeFunctionData(spec.method, spec.args),
      value: spec.value,
      chainId: r.deployment.chainId,
    };
    try {
      await chain.provider.call(tx);
    } catch (e) {
      throw Object.assign(
        new Error(
          `Contract refused ${spec.method}: ${e.revert?.name ?? e.shortMessage ?? "invalid current state"}`,
        ),
        { code: "SIMULATION_FAILED", status: 409 },
      );
    }
    const draft = {
      id: id(),
      eventId,
      action,
      params,
      wallet: s.wallet,
      sessionId: s.id,
      chainId: r.deployment.chainId,
      contract: r.deployment.contract,
      abiVersion: r.deployment.abiVersion,
      contractVersion: r.deployment.contractVersion,
      valueWei: String(spec.value),
      method: spec.method,
      args: JSON.parse(json(spec.args)),
      summary: spec.summary,
      createdAt: Date.now(),
      reviewBlock: st.blockNumber,
      expiresAt: Date.now() + 300_000,
      snapshot: st.fingerprint,
      revision: r.revision,
      registryHash: hash(r.deployment),
      transaction: JSON.parse(json(tx)),
      used: false,
    };
    drafts.set(draft.id, draft);
    return { ...draft };
  }
  async function validateDraft(eventId, s, draftId) {
    authenticated(s);
    const r = record(eventId, s),
      d = drafts.get(draftId);
    requireThat(
      d &&
        d.eventId === eventId &&
        lower(d.wallet) === lower(s.wallet) &&
        d.sessionId === s.id,
      "Draft belongs to a different event or wallet",
      "DRAFT_SCOPE",
      409,
    );
    requireThat(
      !d.used && !d.submittedHash && d.expiresAt > Date.now(),
      "Draft expired or already consumed",
      "STALE_DRAFT",
      409,
    );
    const st = await state(eventId);
    requireThat(
      d.registryHash === hash(r.deployment) &&
        d.snapshot === st.fingerprint &&
        d.revision === r.revision,
      "Authoritative event state changed; review a fresh draft",
      "STALE_DRAFT",
      409,
    );
    const spec = await actionSpec(eventId, s, d.action, d.params, st);
    requireThat(
      spec.target.interface.encodeFunctionData(spec.method, spec.args) ===
        d.transaction.data && String(spec.value) === d.valueWei,
      "Transaction terms changed",
      "STALE_DRAFT",
      409,
    );
    await chain.provider.call(d.transaction);
    return { d, spec, r };
  }
  async function executeDraft(eventId, s, draftId) {
    requireThat(
      !locks.has(eventId),
      "Another event action is in flight",
      "BUSY",
      409,
    );
    locks.add(eventId);
    try {
      const { d, spec, r } = await validateDraft(eventId, s, draftId);
      requireThat(
        s.mode === "demo" && s.signer,
        "A browser wallet must sign this transaction",
        "WALLET_SIGNATURE_REQUIRED",
        409,
      );
      d.used = true;
      const estimate = await chain.provider.estimateGas(d.transaction);
      const gasLimit = (estimate * 130n) / 100n;
      requireThat(
        gasLimit <= 16_777_216n,
        "Transaction exceeds tested gas limit",
      );
      const sent = await s.signer.sendTransaction({
        ...d.transaction,
        gasLimit,
      });
      d.submittedHash = sent.hash;
      const tx = {
        hash: sent.hash,
        status: "pending",
        action: d.action,
        wallet: s.wallet,
        eventId,
        draftId: d.id,
      };
      r.transactions.push(tx);
      const receipt = await sent.wait().catch((error) => {
        if (error.receipt?.status === 0) {
          tx.status = "failed";
          tx.blockNumber = error.receipt.blockNumber;
        }
        throw error;
      });
      requireThat(receipt.status === 1, "Transaction failed", "TX_FAILED", 409);
      tx.status = "confirmed";
      d.confirmedHash = sent.hash;
      tx.blockNumber = receipt.blockNumber;
      r.revision++;
      if (["transferOwnership", "acceptOwnership"].includes(d.action))
        await state(eventId);
      if (d.action === "deposit")
        await linkDeposit(eventId, s, { txHash: sent.hash });
      return { ...tx };
    } finally {
      locks.delete(eventId);
    }
  }
  async function confirmDraft(eventId, s, draftId, txHash) {
    // External wallets can only confirm the exact reviewed transaction, with a canonical successful receipt.
    authenticated(s);
    const r = record(eventId, s),
      d = drafts.get(draftId);
    requireThat(
      d &&
        d.eventId === eventId &&
        d.sessionId === s.id &&
        lower(d.wallet) === lower(s.wallet) &&
        !d.used,
      "Invalid draft",
      "DRAFT_SCOPE",
      409,
    );
    requireThat(
      d.expiresAt > Date.now() &&
        d.registryHash === hash(r.deployment) &&
        d.revision === r.revision,
      "Review expired or event metadata changed",
      "STALE_DRAFT",
      409,
    );
    requireThat(
      !d.submittedHash || lower(d.submittedHash) === lower(txHash),
      "Confirmation differs from the submitted hash",
      "TX_MISMATCH",
      409,
    );
    requireThat(
      !r.transactions.some(
        (t) => lower(t.hash) === lower(txHash) && t.status === "confirmed",
      ),
      "This transaction was already recorded",
      "DUPLICATE_TRANSACTION",
      409,
    );
    const tx = await chain.provider.getTransaction(txHash),
      receipt = await chain.provider.getTransactionReceipt(txHash);
    requireThat(
      tx &&
        receipt?.status === 1 &&
        lower(tx.from) === lower(s.wallet) &&
        lower(tx.to) === lower(d.transaction.to) &&
        tx.data === d.transaction.data &&
        String(tx.value) === d.valueWei &&
        Number(tx.chainId) === d.chainId,
      "Transaction does not match reviewed draft",
      "TX_MISMATCH",
      409,
    );
    requireThat(
      receipt.blockNumber > d.reviewBlock,
      "Transaction predates this review",
      "TX_PREDATES_REVIEW",
      409,
    );
    requireThat(
      (await chain.provider.getBlock(receipt.blockNumber)).hash ===
        receipt.blockHash,
      "Noncanonical transaction",
    );
    d.used = true;
    d.confirmedHash = txHash;
    r.revision++;
    const result = {
      hash: txHash,
      status: "confirmed",
      action: d.action,
      wallet: s.wallet,
      eventId,
      blockNumber: receipt.blockNumber,
    };
    const pending = r.transactions.find((t) => lower(t.hash) === lower(txHash));
    if (pending) Object.assign(pending, result);
    else r.transactions.push(result);
    if (d.action === "deposit") await linkDeposit(eventId, s, { txHash });
    return result;
  }
  async function recordSubmitted(eventId, s, draftId, txHash) {
    authenticated(s);
    const r = record(eventId, s),
      d = drafts.get(draftId);
    requireThat(
      d &&
        d.eventId === eventId &&
        d.sessionId === s.id &&
        lower(d.wallet) === lower(s.wallet) &&
        !d.used,
      "Submission belongs to another review or wallet",
      "DRAFT_SCOPE",
      409,
    );
    requireThat(
      /^0x[0-9a-fA-F]{64}$/.test(txHash ?? ""),
      "Invalid transaction hash",
    );
    requireThat(
      d.expiresAt > Date.now(),
      "Review expired; preserve the submitted hash and verify its receipt",
      "STALE_DRAFT",
      409,
    );
    requireThat(
      !d.submittedHash || lower(d.submittedHash) === lower(txHash),
      "This review already has another submitted transaction",
      "SUBMITTED_DRAFT",
      409,
    );
    const tx = await chain.provider.getTransaction(txHash);
    if (tx)
      requireThat(
        lower(tx.from) === lower(d.wallet) &&
          lower(tx.to) === lower(d.transaction.to) &&
          tx.data === d.transaction.data &&
          String(tx.value) === d.valueWei &&
          Number(tx.chainId) === d.chainId,
        "Submitted transaction differs from the reviewed transaction",
        "TX_MISMATCH",
        409,
      );
    const existing = r.transactions.find(
      (t) => lower(t.hash) === lower(txHash),
    );
    if (existing) {
      requireThat(
        existing.draftId === draftId,
        "Transaction hash is already recorded",
        "DUPLICATE_TRANSACTION",
        409,
      );
      return { ...existing };
    }
    d.submittedHash = txHash;
    const entry = {
      hash: txHash,
      status: "pending",
      action: d.action,
      wallet: d.wallet,
      eventId,
      draftId,
      chainId: d.chainId,
      contract: d.contract,
      submittedAt: Date.now(),
    };
    r.transactions.push(entry);
    return { ...entry };
  }
  async function submissionStatus(eventId, s, txHash) {
    authenticated(s);
    const r = record(eventId, s),
      entry = r.transactions.find((t) => lower(t.hash) === lower(txHash));
    requireThat(
      entry && lower(entry.wallet) === lower(s.wallet),
      "No submission for this wallet/event",
      "NOT_FOUND",
      404,
    );
    const receipt = await chain.provider.getTransactionReceipt(txHash);
    if (!receipt) return { ...entry, receiptStatus: "pending" };
    requireThat(
      (await chain.provider.getBlock(receipt.blockNumber))?.hash ===
        receipt.blockHash,
      "Receipt is not canonical",
      "TX_REORG",
      409,
    );
    if (entry.status !== "confirmed")
      entry.status = receipt.status === 1 ? "mined" : "failed";
    return {
      ...entry,
      receiptStatus: receipt.status === 1 ? "confirmed" : "failed",
      blockNumber: receipt.blockNumber,
    };
  }
  async function reconcileSubmission(eventId, s, draftId, txHash) {
    // This records an already-signed on-chain fact. It never revives signing authority.
    authenticated(s);
    const r = record(eventId, s),
      d = drafts.get(draftId);
    requireThat(
      d && d.eventId === eventId && lower(d.wallet) === lower(s.wallet),
      "No review for this wallet/event",
      "DRAFT_SCOPE",
      409,
    );
    requireThat(
      /^0x[0-9a-fA-F]{64}$/.test(txHash ?? ""),
      "Invalid transaction hash",
    );
    requireThat(
      d.registryHash === hash(r.deployment),
      "Deployment identity changed",
      "DEPLOYMENT_MISMATCH",
      409,
    );
    requireThat(
      !d.submittedHash || lower(d.submittedHash) === lower(txHash),
      "Another hash belongs to this review",
      "TX_MISMATCH",
      409,
    );
    requireThat(
      !d.used || lower(d.confirmedHash ?? d.submittedHash) === lower(txHash),
      "Consumed review cannot record another transaction",
      "DRAFT_SCOPE",
      409,
    );
    const [tx, receipt] = await Promise.all([
      chain.provider.getTransaction(txHash),
      chain.provider.getTransactionReceipt(txHash),
    ]);
    requireThat(
      tx &&
        lower(tx.from) === lower(s.wallet) &&
        lower(tx.to) === lower(d.transaction.to) &&
        tx.data === d.transaction.data &&
        String(tx.value) === d.valueWei &&
        Number(tx.chainId) === d.chainId,
      "Transaction differs from the original reviewed terms",
      "TX_MISMATCH",
      409,
    );
    let status = "pending";
    if (receipt) {
      requireThat(
        receipt.blockNumber > d.reviewBlock,
        "Transaction predates this review",
        "TX_PREDATES_REVIEW",
        409,
      );
      requireThat(
        (await chain.provider.getBlock(receipt.blockNumber))?.hash ===
          receipt.blockHash,
        "Receipt is not canonical",
        "TX_REORG",
        409,
      );
      status = receipt.status === 1 ? "confirmed" : "failed";
    }
    d.submittedHash = txHash;
    const entry = r.transactions.find(
      (t) => lower(t.hash) === lower(txHash),
    ) ?? {
      hash: txHash,
      action: d.action,
      eventId,
      wallet: d.wallet,
      draftId,
      chainId: d.chainId,
      contract: d.contract,
    };
    Object.assign(entry, {
      status,
      recovered: true,
      ...(receipt ? { blockNumber: receipt.blockNumber } : {}),
    });
    if (!r.transactions.includes(entry)) r.transactions.push(entry);
    if (receipt) {
      d.used = true;
      d.confirmedHash = txHash;
    }
    if (status === "confirmed" && d.action === "deposit") {
      const p = [...r.participants.values()].find(
        (p) => lower(p.wallet) === lower(s.wallet),
      );
      let mayLink =
        p && (!p.deposit || lower(p.deposit.txHash) === lower(txHash));
      if (p && !mayLink)
        try {
          await verifyReceipt(eventId, p, p.deposit.txHash, true);
        } catch (error) {
          if (error.code === "RETURNED_DEPOSIT") mayLink = true;
        }
      if (p && mayLink)
        try {
          const evidence = await verifyReceipt(eventId, p, txHash, true);
          if (!p.deposit || lower(p.deposit.txHash) !== lower(txHash)) {
            p.deposit = evidence;
            r.revision++;
          }
        } catch (error) {
          entry.verificationError = error.code ?? "VERIFICATION_UNAVAILABLE";
        }
    }
    return { ...entry };
  }
  async function advance(seconds) {
    requireThat(
      !external,
      "Public testnet time cannot be advanced",
      "TESTNET_TIME",
      403,
    );
    requireThat(
      Number.isInteger(seconds) && seconds > 0 && seconds <= 30 * DAY,
      "Advance 1 second to 30 days",
    );
    await chain.provider.send("evm_increaseTime", [seconds]);
    await chain.provider.send("evm_mine", []);
    return { now: (await chain.provider.getBlock("latest")).timestamp };
  }
  async function mockRuling(eventId, s, wallet, ruling) {
    requireThat(
      !external,
      "Testnet rulings require a reviewed wallet transaction",
      "WALLET_REQUIRED",
      403,
    );
    await owner(eventId, s);
    requireThat([0, 1, 2].includes(ruling), "Invalid ruling");
    const c = await contract(eventId).challenges(wallet);
    requireThat(Number(c.state) === 2, "Only matched cases can be ruled");
    await (
      await chain.liquid.connect(s.signer).getFunction("giveFinalRuling")(
        c.arbitratorDisputeID,
        ruling,
        { gasLimit: 600_000 },
      )
    ).wait();
    return {
      ruling,
      localDisputeID: String(c.localDisputeID),
      arbitratorDisputeID: String(c.arbitratorDisputeID),
    };
  }
  async function mockAppeal(eventId, s, wallet, ruling, duration = 3600) {
    requireThat(
      !external,
      "Testnet arbitration requires a reviewed wallet transaction",
      "WALLET_REQUIRED",
      403,
    );
    await owner(eventId, s);
    requireThat(
      [0, 1, 2].includes(ruling) &&
        Number.isInteger(duration) &&
        duration > 0 &&
        duration <= 7 * DAY,
      "Invalid mock appeal",
    );
    const c = await contract(eventId).challenges(wallet);
    requireThat(Number(c.state) === 2, "Matched case required");
    await (
      await chain.liquid.connect(s.signer).getFunction("startAppealPeriod")(
        c.arbitratorDisputeID,
        ruling,
        duration,
        { gasLimit: 600_000 },
      )
    ).wait();
    return { ruling, duration };
  }
  async function publish(eventId, s, wallet) {
    authenticated(s);
    const r = record(eventId, s),
      c = await contract(eventId).challenges(wallet);
    requireThat(
      Number(c.state) >= 2 && lower(c.matcher) !== lower(ethers.ZeroAddress),
      "Matched Court case required",
      "NOT_MATCHED_CASE",
      409,
    );
    const [content, uri] = await contract(eventId).caseMetaEvidence(wallet);
    const publication = {
      uri,
      status: "local-only",
      sha256: hash(content),
      content,
      at: Date.now(),
    };
    r.publications.set(lower(wallet), publication);
    return publication;
  }
  const w = {
    chain,
    events,
    provider: chain.provider,
    session,
    record,
    contract,
    state,
    owner,
    bootstrap,
    detail,
    createEvent,
    registerParticipant,
    admit,
    verifyReceipt,
    linkDeposit,
    checkin,
    personal,
    createDraft,
    validateDraft,
    executeDraft,
    confirmDraft,
    recordSubmitted,
    submissionStatus,
    reconcileSubmission,
    advance,
    mockRuling,
    mockAppeal,
    publish,
    close: async () => {
      store?.save(events, drafts);
      await chain.close();
    },
    persist: () => store?.save(events, drafts),
  };
  w.importCsv = (eventId, s, input) => importCsv(w, eventId, s, input);
  const previews = createImportPreviewService(w);
  w.previewImport = previews.preview;
  w.commitImport = previews.commit;
  if (store)
    for (const name of [
      "registerParticipant",
      "admit",
      "linkDeposit",
      "checkin",
      "personal",
      "createDraft",
      "executeDraft",
      "confirmDraft",
      "recordSubmitted",
      "reconcileSubmission",
      "publish",
      "importCsv",
      "commitImport",
    ]) {
      const original = w[name];
      w[name] = async (...args) => {
        try {
          return await original(...args);
        } finally {
          store.save(events, drafts);
        }
      };
    }
  return w;
}
