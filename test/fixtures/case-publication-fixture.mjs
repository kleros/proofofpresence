import { createHash } from "node:crypto";
import { makeLumaLaunchFixture } from "./luma-launch-fixture.mjs";
import {
  makeProductionFixture,
  FIXTURE_WALLET,
} from "./production-ui-fixture.mjs";

// TEST ONLY. The byte/CID fixture follows Core's reviewed pure contentURI helper
// src/mainnet-case-publication.mjs SHA256 612ae4bcb11046ab95afbe6f518fb4ed83b231c672a062b8eb9409d5bedfde5e.
// No Core runtime, transport, uploader or gateway is imported or invoked here.
export const CORE_PUBLICATION_SOURCE_SHA256 =
  "612ae4bcb11046ab95afbe6f518fb4ed83b231c672a062b8eb9409d5bedfde5e";
export const CASE_EVENT_ID = "publication-synthetic-event";
export const CASE_CHILD = "0x" + "4".repeat(40);
export const CASE_CHALLENGER = FIXTURE_WALLET;
export const CASE_INSTANCE = "production-ui-loopback-only";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const digest = (bytes) => createHash("sha256").update(bytes).digest();
function varint(value) {
  const bytes = [];
  do {
    bytes.push((value & 127) | (value >= 128 ? 128 : 0));
    value = Math.floor(value / 128);
  } while (value);
  return Buffer.from(bytes);
}
function base58(bytes) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = BigInt("0x" + bytes.toString("hex")),
    result = "";
  while (number) {
    result = alphabet[Number(number % 58n)] + result;
    number /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    result = "1" + result;
  }
  return result;
}
export function fixtureContentUri(content) {
  const bytes = Buffer.from(content, "utf8"),
    size = varint(bytes.length);
  const file = Buffer.concat([
    Buffer.from([8, 2, 18]),
    size,
    bytes,
    Buffer.from([24]),
    size,
  ]);
  const node = Buffer.concat([Buffer.from([10]), varint(file.length), file]);
  return (
    "/ipfs/" + base58(Buffer.concat([Buffer.from([18, 32]), digest(node)]))
  );
}
export function caseScope({
  eventId = CASE_EVENT_ID,
  contract = CASE_CHILD,
  wallet = CASE_CHALLENGER,
  instanceId = CASE_INSTANCE,
  matched = true,
  blockNumber = 110,
  blockHash = "0x" + "c".repeat(64),
  localDisputeID = "0",
  arbitratorDisputeID = "0",
} = {}) {
  // Exact Core normalized scope order is significant for scopeHash.
  return {
    environment: "production",
    instanceId,
    chainId: 1,
    contractVersion: "kleros-event-v9-uups",
    eventId,
    contract,
    wallet,
    blockNumber,
    blockHash,
    matched,
    localDisputeID: matched ? localDisputeID : null,
    arbitratorDisputeID: matched ? arbitratorDisputeID : null,
  };
}
export function makeCaseEnvelope({
  status = "exported",
  historical = true,
  current = null,
  original = null,
  content = null,
  uploadAttempted = status !== "exported",
} = {}) {
  const currentCase = current ?? caseScope();
  const scope =
    original ??
    caseScope({
      ...currentCase,
      instanceId: historical ? "original-case-server" : currentCase.instanceId,
      matched: historical ? false : currentCase.matched,
      blockNumber: historical ? 100 : currentCase.blockNumber,
    });
  const exactContent =
    content ??
    JSON.stringify(
      {
        title:
          'Synthetic case <img id="publication-escape-probe" src="invalid" onerror="alert(1)">',
        description: "Exact Unicode bytes — €; <script>not executable</script>",
        caseScope: scope,
        testOnly: true,
      },
      null,
      2,
    ) + "\n";
  const artifact = {
    version: 1,
    scope,
    scopeHash: sha(JSON.stringify(scope)),
    content: exactContent,
    sha256: sha(Buffer.from(exactContent, "utf8")),
    byteLength: Buffer.byteLength(exactContent, "utf8"),
    uri: fixtureContentUri(exactContent),
  };
  return {
    artifact,
    currentCase,
    publication: {
      status,
      uri: artifact.uri,
      sha256: artifact.sha256,
      scopeHash: artifact.scopeHash,
      byteLength: artifact.byteLength,
      uploadAttempted,
      canPublish: !uploadAttempted,
    },
  };
}
export function expectedCaseContext(scope = caseScope()) {
  return {
    mode: "hosted-production",
    instanceId: scope.instanceId,
    chainId: 1,
    contractVersion: scope.contractVersion,
    eventId: scope.eventId,
    contract: scope.contract,
    wallet: scope.wallet,
  };
}
export function makePublicationAppFixture({
  stage = "matched",
  eventId = CASE_EVENT_ID,
  contract = CASE_CHILD,
  instanceId = CASE_INSTANCE,
  actorWallet = CASE_CHALLENGER,
  publication = { status: "unpublished" },
  legacy = false,
} = {}) {
  const value = makeLumaLaunchFixture("unsettled", {
    eventId,
    walletAddress: actorWallet,
    instanceId,
  });
  const source = makeProductionFixture(
    stage === "waiting" ? "waiting" : "matched-unruled",
  );
  value.detail.state = source.detail.state;
  value.detail.payments = source.detail.payments;
  value.detail.event.contract = contract;
  value.detail.payments.contract = contract;
  value.detail.ownWallet.pendingCreditWei = "5000000000000000";
  value.detail.state.pendingTotalWei = "5000000000000000";
  value.detail.state.balanceWei = (
    BigInt(value.detail.state.balanceWei) + 5000000000000000n
  ).toString();
  value.detail.state.reservedWei = (
    BigInt(value.detail.state.reservedWei) + 5000000000000000n
  ).toString();
  const item = value.detail.state.cases[0];
  Object.assign(item, { wallet: CASE_CHALLENGER, publication });
  if (stage !== "waiting")
    Object.assign(item, { localDisputeID: "0", arbitratorDisputeID: "0" });
  if (stage === "none") {
    value.detail.state.cases = [];
    value.detail.state.phase = "Listed";
    value.detail.state.challengeEndsAt = value.detail.now + 3600;
  }
  if (legacy) {
    value.bootstrap.mode = "hosted-testnet";
    value.bootstrap.chain.chainId = 10200;
    value.bootstrap.chain.name = "Chiado";
    value.bootstrap.chain.nativeCurrency = {
      name: "Chiado xDAI",
      symbol: "XDAI",
      decimals: 18,
    };
    value.detail.event.chainId = 10200;
    value.detail.event.contractVersion = "kleros-event-v8";
    value.detail.event.abiVersion = "kleros-event-v8";
    delete value.detail.event.contractProfile;
    value.bootstrap.capabilities.lumaDepositPortal = false;
    value.bootstrap.capabilities.walletFirstDeposits = false;
  }
  value.bootstrap.events = [structuredClone(value.detail.event)];
  value.bootstrap.selectedEvent = {
    eventId,
    instanceId,
    wallet: actorWallet,
    detail: value.detail,
    error: null,
  };
  return value;
}
