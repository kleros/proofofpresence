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

/** Bounded background-worker read at the SAME canonical receipt checkpoint.
 * No historical provenance scan, bootstrap, private access or action execution.
 * @param {{provider:any,chain:any,record:any,block:any,signal?:AbortSignal,assertCurrent?:()=>any}} options */
export async function collectFirstEventState({ provider, chain, record, block, signal, assertCurrent = () => {} }) {
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
    "depositAmount", "owner", "phase", "challengeEndsAt", "challengeDeposit", "stakers", "CHALLENGE_PERIOD", "MATCH_PERIOD"];
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
  check(result); guard(); return result;
}
