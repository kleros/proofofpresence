// Optional public display hints. These are never transaction or role authority.
import { ethers } from "ethers";
import { verifyV10ArtifactSources, loadV10UpgradeableArtifacts } from "./v10-upgrade-artifacts.mjs";
import { v10RuntimeCode } from "../scripts/mainnet/v10-runtime-code.mjs";
import { v10ReadBatch, v10CodeHashBatch } from "./v10-read-batch.mjs";

const VERSION = "kleros-event-v10-uups";
const SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const PHASES = ["Open", "Listed", "Finalized", "Cancelled"];
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const address = value => typeof value === "string" && ethers.isAddress(value) && !same(value, ethers.ZeroAddress);
const bytes32 = value => typeof value === "string" && ethers.isHexString(value, 32) && value !== ethers.ZeroHash;
const integer = (value, zero = false) => Number.isSafeInteger(value) && value >= (zero ? 0 : 1);
const uint = value => typeof value === "string" && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) <= ethers.MaxUint256;
const check = value => { if (!value) throw Object.assign(Error("Optional public event state unavailable."), { code: "PUBLIC_EVENT_STATE_UNAVAILABLE" }); };
const object = value => value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const keys = (value, names) => object(value) && Reflect.ownKeys(value).every(key => typeof key === "string" && names.includes(key) &&
  Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value")) && names.every(key => Object.hasOwn(value, key));
function seconds(value) {
  const number = typeof value === "bigint" ? Number(value) : value;
  check(integer(number, true) && (typeof value !== "bigint" || BigInt(number) === value));
  return number;
}
function terms(record) {
  const d = record?.deployment, definition = record?.definition;
  const endsAt = Date.parse(definition?.endsAt) / 1000;
  check(d?.chainId === 1 && d.contractVersion === VERSION && d.abiVersion === VERSION &&
    integer(d.eventStart) && integer(d.claimDeadline) && d.claimDeadline > d.eventStart &&
    Date.parse(definition?.startsAt) / 1000 === d.eventStart && integer(endsAt) &&
    endsAt > d.eventStart && endsAt < d.claimDeadline);
  return { eventStart: d.eventStart, endsAt, claimDeadline: d.claimDeadline };
}

/** Strict optional JSONB projection. Invalid hints are omitted; receipts survive.
 * No unlisted keys, contact fields, permissions or eligibility enter the DTO. */
export function publicFirstEventState(value, record) {
  try {
    if (value === undefined) return null;
    const fixed = terms(record), names = ["phase", "owner", "eventStart", "endsAt", "claimDeadline", "challengeEndsAt", "challengeDepositWei", "stakers"];
    if (Object.hasOwn(value ?? {}, "chainTimestamp")) names.push("chainTimestamp");
    check(keys(value, names) && PHASES.includes(value.phase) && address(value.owner) &&
      value.eventStart === fixed.eventStart && value.endsAt === fixed.endsAt && value.claimDeadline === fixed.claimDeadline &&
      integer(value.challengeEndsAt, true) && uint(value.challengeDepositWei) &&
      (!Object.hasOwn(value, "chainTimestamp") || integer(value.chainTimestamp, true)) &&
      Array.isArray(value.stakers) && value.stakers.length <= 150 && Object.keys(value.stakers).length === value.stakers.length);
    const seen = new Set();
    const stakers = value.stakers.map(row => {
      check(keys(row, ["wallet", "status", "attended", "challenge"]) && address(row.wallet) &&
        !seen.has(row.wallet.toLowerCase()) && Number.isInteger(row.status) && row.status >= 0 && row.status <= 3 && typeof row.attended === "boolean");
      seen.add(row.wallet.toLowerCase());
      const c = row.challenge;
      check(keys(c, ["state", "depositWei", "matchDeadline", "localId"]) && Number.isInteger(c.state) && c.state >= 0 && c.state <= 3 &&
        uint(c.depositWei) && integer(c.matchDeadline, true) && uint(c.localId) &&
        (c.state !== 0 || (c.depositWei === "0" && c.matchDeadline === 0 && c.localId === "0")));
      return { wallet: ethers.getAddress(row.wallet), status: row.status, attended: row.attended,
        challenge: { state: c.state, depositWei: c.depositWei, matchDeadline: c.matchDeadline, localId: c.localId } };
    });
    return { phase: value.phase, owner: ethers.getAddress(value.owner), ...fixed, challengeEndsAt: value.challengeEndsAt,
      challengeDepositWei: value.challengeDepositWei, ...(Object.hasOwn(value, "chainTimestamp") ? { chainTimestamp: value.chainTimestamp } : {}), stakers };
  } catch { return null; }
}

/** Optional same-block settlement counters. Historical deposits and a Paid enum
 * never establish the current reward pool or successful payment delivery. */
export function publicFirstEventPayoutState(value, record, { eventState, blockNumber, blockHash } = {}) {
  try {
    if (value === undefined) return null;
    const state = publicFirstEventState(eventState, record), d = record?.deployment;
    check(state && integer(blockNumber) && bytes32(blockHash) &&
      keys(value, ["schemaVersion", "kind", "eventId", "chainId", "contract", "blockNumber", "blockHash", "depositWei",
        "stakerCount", "attendeeCount", "payoutShareWei", "heldBackWei", "cases"]) &&
      value.schemaVersion === 1 && value.kind === "first-event-payout-state" &&
      value.eventId === record.definition.id && value.chainId === 1 && same(value.contract, d.contract) &&
      value.blockNumber === blockNumber && same(value.blockHash, blockHash) &&
      uint(value.depositWei) && value.depositWei === d.depositWei && BigInt(value.depositWei) > 0n &&
      integer(value.stakerCount, true) && value.stakerCount <= 150 &&
      integer(value.attendeeCount, true) && value.attendeeCount <= value.stakerCount &&
      uint(value.payoutShareWei) && uint(value.heldBackWei) &&
      Array.isArray(value.cases) && value.cases.length <= 150 && Object.keys(value.cases).length === value.cases.length);
    const registered = state.stakers.filter(row => state.phase === "Cancelled" ? row.status === 2 :
      row.status === 1 || (state.phase === "Finalized" && row.status === 2));
    const attended = state.stakers.filter(row => row.attended);
    check(value.stakerCount === registered.length && value.attendeeCount === attended.length &&
      attended.every(row => [1, 2].includes(row.status)));
    const disputed = state.stakers.filter(row => row.challenge.state === 2), waiting = state.stakers.filter(row => row.challenge.state === 1), seen = new Set();
    const cases = [];
    for (const item of value.cases) {
      check(keys(item, ["wallet", "arbitratorDisputeId", "heldShareWei"]) && address(item.wallet) &&
        !seen.has(item.wallet.toLowerCase()) && uint(item.arbitratorDisputeId) && uint(item.heldShareWei));
      const row = disputed.find(row => same(row.wallet, item.wallet));
      check(row && row.status === 1 && !row.attended);
      seen.add(item.wallet.toLowerCase());
      cases.push({ wallet: ethers.getAddress(item.wallet), arbitratorDisputeId: item.arbitratorDisputeId, heldShareWei: item.heldShareWei });
    }
    check(cases.length === disputed.length && cases.length + waiting.length + value.attendeeCount <= value.stakerCount &&
      waiting.every(row => row.status === 1 && !row.attended));
    const pool = BigInt(value.depositWei) * BigInt(value.stakerCount), held = BigInt(value.heldBackWei);
    check(pool <= ethers.MaxUint256 && held <= pool &&
      cases.reduce((total, item) => total + BigInt(item.heldShareWei), 0n) === held);
    if (state.phase === "Open" || state.phase === "Cancelled") {
      check(value.attendeeCount === 0 && cases.length === 0 && waiting.length === 0 && value.payoutShareWei === "0" && value.heldBackWei === "0" &&
        (state.phase !== "Cancelled" || state.stakers.every(row => row.status !== 1)));
    } else if (state.phase === "Listed") {
      check(value.attendeeCount > 0 && value.payoutShareWei === "0" && value.heldBackWei === "0");
    } else {
      check(value.attendeeCount > 0 && waiting.length === 0 && BigInt(value.payoutShareWei) >= BigInt(value.depositWei) &&
        BigInt(value.payoutShareWei) * BigInt(value.attendeeCount) + held <= pool &&
        cases.every(item => BigInt(item.heldShareWei) >= BigInt(value.payoutShareWei)));
    }
    return { schemaVersion: 1, kind: "first-event-payout-state", eventId: record.definition.id, chainId: 1,
      contract: ethers.getAddress(d.contract), blockNumber, blockHash,
      depositWei: value.depositWei, stakerCount: value.stakerCount, attendeeCount: value.attendeeCount,
      payoutShareWei: value.payoutShareWei, heldBackWei: value.heldBackWei, cases };
  } catch { return null; }
}

/** Bounded background-worker read at the SAME canonical receipt checkpoint.
 * No historical provenance scan, bootstrap, private access or action execution.
 * @param {{provider:any,chain:any,record:any,block:any,signal?:AbortSignal,assertCurrent?:()=>any}} options */
async function collectState({ provider, chain, record, block, signal, assertCurrent = () => {} }, includePayoutState) {
  const fixed = terms(record), d = record.deployment, governance = chain?.governance;
  check(chain?.production === true && chain.chainId === 1 && keys(governance, ["kind", "initialOwner", "upgradeDelaySeconds", "renounceable"]) &&
    governance.kind === "single-owner-immediate" && same(governance.initialOwner, d.initialUpgradeOwner) &&
    governance.upgradeDelaySeconds === 0 && governance.renounceable === true &&
    integer(block?.number) && integer(block.timestamp, true) && bytes32(block.hash));
  const pinNames = ["chainId", "contractVersion", "abiVersion", "depositWei", "contract", "factory", "implementation", "factoryImplementation", "upgradeAuthority", "initialUpgradeOwner",
    "codeHash", "factoryCodeHash", "implementationCodeHash", "factoryImplementationCodeHash", "upgradeAuthorityCodeHash"];
  const context = selected => JSON.stringify([pinNames.map(key => selected?.deployment?.[key]),
    selected?.deployment?.eventStart, selected?.deployment?.claimDeadline, selected?.definition?.startsAt, selected?.definition?.endsAt,
    chain.governance, chain.manifest?.provenance]);
  const captured = context(record);
  const guard = () => { signal?.throwIfAborted(); const latest = assertCurrent(); check(context(latest?.record ?? record) === captured); };
  guard();
  verifyV10ArtifactSources(chain.manifest?.provenance);
  const a = loadV10UpgradeableArtifacts(), controllerHash = ethers.keccak256(a.controller.deployedBytecode);
  const targets = [[d.contract, a.proxy.deployedBytecode, d.codeHash], [d.factory, a.proxy.deployedBytecode, d.factoryCodeHash],
    [d.implementation, v10RuntimeCode(a.event, d.implementation, controllerHash), d.implementationCodeHash],
    [d.factoryImplementation, v10RuntimeCode(a.factory, d.factoryImplementation, controllerHash), d.factoryImplementationCodeHash],
    [d.upgradeAuthority, a.controller.deployedBytecode, d.upgradeAuthorityCodeHash]];
  check(targets.every(([target, code, pin]) => address(target) && bytes32(pin) && same(ethers.keccak256(code), pin)) &&
    new Set(targets.map(([target]) => target.toLowerCase())).size === 5);
  const [codes, eventSlot, factorySlot] = await Promise.all([
    v10CodeHashBatch(provider, targets.map(([target]) => target), block.number),
    provider.send("eth_getStorageAt", [d.contract, SLOT, ethers.toQuantity(block.number)]),
    provider.send("eth_getStorageAt", [d.factory, SLOT, ethers.toQuantity(block.number)]),
  ]); guard();
  check(codes.every((code, i) => same(code, targets[i][2])) &&
    same(eventSlot, ethers.zeroPadValue(d.implementation, 32)) && same(factorySlot, ethers.zeroPadValue(d.factoryImplementation, 32)));
  const event = new ethers.Contract(d.contract, a.event.abi, provider), factory = new ethers.Contract(d.factory, a.factory.abi, provider),
    controller = new ethers.Contract(d.upgradeAuthority, a.controller.abi, provider);
  const eventKeys = ["VERSION", "UPGRADE_FAMILY", "implementationRevision", "storageSchema", "upgradeAuthority", "eventStart", "claimDeadline",
    "depositAmount", "owner", "phase", "challengeEndsAt", "challengeDeposit", "stakers", "CHALLENGE_PERIOD", "MATCH_PERIOD",
    ...(includePayoutState ? ["stakerCount", "attendeeCount", "payoutShare", "heldBack", "pendingChallenges"] : [])];
  const identityKeys = ["VERSION", "UPGRADE_FAMILY", "implementationRevision", "storageSchema", "upgradeAuthority"];
  const controllerKeys = ["VERSION", "UPGRADE_DELAY_SECONDS", "owner", "pendingOwner", "upgradesDisabled"];
  const specs = (contract, names) => names.map(method => ({ contract, method, args: [] }));
  const values = await v10ReadBatch(provider, [...specs(event, eventKeys), ...specs(factory, identityKeys), ...specs(controller, controllerKeys)], block.number); guard();
  const raw = Object.fromEntries(eventKeys.map((key, i) => [key, values[i]])), f = values.slice(eventKeys.length, eventKeys.length + identityKeys.length),
    g = values.slice(eventKeys.length + identityKeys.length);
  check(raw.VERSION === 10n && same(raw.UPGRADE_FAMILY, ethers.id("kleros.event.v10.uups")) && raw.implementationRevision === 1n &&
    same(raw.storageSchema, ethers.id("kleros.event.v10.storage.1")) && same(raw.upgradeAuthority, d.upgradeAuthority) &&
    seconds(raw.eventStart) === fixed.eventStart && seconds(raw.claimDeadline) === fixed.claimDeadline &&
    typeof raw.depositAmount === "bigint" && raw.depositAmount.toString() === d.depositWei && raw.CHALLENGE_PERIOD === 86400n && raw.MATCH_PERIOD === 86400n &&
    f[0] === 10n && same(f[1], ethers.id("kleros.factory.v10.uups")) && f[2] === 1n && same(f[3], ethers.id("kleros.factory.v10.storage.1")) && same(f[4], d.upgradeAuthority) &&
    g[0] === 10n && g[1] === 0n && ethers.isAddress(g[2]) && ethers.isAddress(g[3]) && typeof g[4] === "boolean" &&
    g[4] === same(g[2], ethers.ZeroAddress) && (!g[4] || same(g[3], ethers.ZeroAddress)));
  check(Array.isArray(raw.stakers) && raw.stakers.length <= 150 && raw.stakers.every(address) &&
    new Set(raw.stakers.map(wallet => wallet.toLowerCase())).size === raw.stakers.length);
  // ethers Result's Array species produces [0] for an empty flatMap. Keep the
  // validated decoded addresses in an ordinary array before deriving requests.
  const stakers = [...raw.stakers];
  const rows = await v10ReadBatch(provider, stakers.flatMap(wallet => ["status", "attended", "challenges"].map(method => ({ contract: event, method, args: [wallet] }))), block.number); guard();
  const phase = seconds(raw.phase);
  const result = publicFirstEventState({ phase: PHASES[phase], owner: raw.owner, ...fixed,
    challengeEndsAt: seconds(raw.challengeEndsAt), challengeDepositWei: String(raw.challengeDeposit), chainTimestamp: block.timestamp,
    stakers: stakers.map((wallet, i) => { const challenge = rows[i * 3 + 2]; return {
      wallet, status: seconds(rows[i * 3]), attended: rows[i * 3 + 1],
      challenge: { state: seconds(challenge.state), depositWei: String(challenge.deposit), matchDeadline: seconds(challenge.matchEndsAt), localId: String(challenge.localDisputeID) },
    }; }) }, record);
  check(result); guard();
  if (!includePayoutState) return result;
  check(seconds(raw.pendingChallenges) === result.stakers.filter(row => [1, 2].includes(row.challenge.state)).length);
  const payoutState = publicFirstEventPayoutState({ schemaVersion: 1, kind: "first-event-payout-state",
    eventId: record.definition.id, chainId: 1, contract: d.contract, blockNumber: block.number, blockHash: block.hash,
    depositWei: String(raw.depositAmount), stakerCount: seconds(raw.stakerCount), attendeeCount: seconds(raw.attendeeCount),
    payoutShareWei: String(raw.payoutShare), heldBackWei: String(raw.heldBack),
    cases: stakers.flatMap((wallet, i) => {
      const challenge = rows[i * 3 + 2];
      return seconds(challenge.state) === 2 ? [{ wallet, arbitratorDisputeId: String(challenge.arbitratorDisputeID),
        heldShareWei: String(challenge.heldShare) }] : [];
    }) }, record, { eventState: result, blockNumber: block.number, blockHash: block.hash });
  check(payoutState); guard(); return { eventState: result, payoutState };
}

// Existing callers and stored eventState retain their exact original shape.
export async function collectFirstEventState(options) { return collectState(options, false); }
export async function collectFirstEventDisplayState(options) { return collectState(options, true); }
