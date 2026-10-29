import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SANDBOX_MODES,
  TESTNET_MODES,
  PRODUCTION_MODES,
  classifyEnvironment,
  isSandboxMode,
  isTestnetMode,
  isProductionMode,
  isPublicMode,
  networkLabel,
  nativeCurrencySymbol,
  productionContextIssue,
} from "../public/environment.js";
import {
  PRODUCTION_CONTRACT_VERSION as V,
  isVerifiedProductionProfile,
  isVerifiedProductionEvent,
  contractProfileForEvent,
  supportsBatchJournalProfile,
} from "../public/contract-profiles.js";

const a = (n) => "0x" + n.repeat(40),
  h = (n) => "0x" + n.repeat(64);
const profile = () => ({
  contractVersion: V,
  abiVersion: V,
  version: 9,
  financialModel: "v8",
  upgradeable: true,
  testOnly: false,
  verified: true,
  chainId: 1,
  challengeWindowSeconds: 86400,
  matchWindowSeconds: 86400,
});
function context() {
  const bootstrap = {
    mode: "hosted-production",
    instanceId: "synthetic-server-one",
    contractVersion: V,
    contractProfile: profile(),
    environment: { production: true, network: "ethereum-mainnet", chainId: 1 },
    chain: {
      chainId: 1,
      name: "Ethereum",
      rpcUrl: "https://ethereum.example.invalid",
      nativeCurrency: { symbol: "ETH", decimals: 18 },
    },
    capabilities: {
      production: true,
      browserWallet: true,
      walletTransactions: true,
      serverSigning: false,
      financialInterface: "kleros-native-v1",
      transactionsReady: true,
      supportedAccountTypes: ["eoa"],
      contractWallets: false,
      erc1271: false,
      eip7702: false,
      sharedDemo: false,
      reset: false,
      timeTravel: false,
      mockRulings: false,
    },
    arbitration: {
      mode: "kleros-v1",
      verified: true,
      label: "Kleros V1",
      notice: "Real Kleros",
      resolver: a("6"),
      arbitrator: a("7"),
    },
    walletSupport: {
      type: "eoa-only",
      eoa: true,
      erc1271: false,
      eip7702: false,
      notice: "Standard wallets only",
    },
    session: { mode: "wallet", wallet: a("1") },
  };
  const detail = {
    event: {
      id: "synthetic-event",
      contract: a("4"),
      chainId: 1,
      contractVersion: V,
      abiVersion: V,
      contractProfile: profile(),
      resolver: a("6"),
      arbitrator: a("7"),
    },
    deploymentTrust: { status: "verified" },
    upgrade: {
      kind: "uups",
      verified: true,
      implementation: a("a"),
      implementationCodeHash: h("b"),
      version: 9,
      authority: a("8"),
      multisig: a("9"),
      delaySeconds: 172800,
      pending: null,
    },
  };
  return { bootstrap, detail };
}
const ready = ({ bootstrap, detail }) =>
  productionContextIssue(bootstrap, detail, {
    requireTransactions: true,
    requireWallet: true,
  });

test("only exact modes classify; network and version cannot elevate a sandbox", () => {
  for (const mode of SANDBOX_MODES) {
    assert.equal(classifyEnvironment(mode), "sandbox");
    assert.equal(isSandboxMode(mode), true);
    assert.equal(isPublicMode(mode), false);
  }
  for (const mode of TESTNET_MODES) {
    assert.equal(classifyEnvironment(mode), "testnet");
    assert.equal(isTestnetMode(mode), true);
    assert.equal(isPublicMode(mode), true);
  }
  assert.equal(classifyEnvironment("hosted-production"), "production");
  assert.equal(isProductionMode("hosted-production"), true);
  for (const mode of [
    undefined,
    null,
    {},
    1,
    "production",
    "mainnet",
    "hosted-production-x",
    " hosted-production",
    "__proto__",
  ])
    assert.equal(classifyEnvironment(mode), "unknown");
  const c = context();
  c.bootstrap.mode = "hosted-demo";
  assert.ok(ready(c));
  for (const modes of [SANDBOX_MODES, TESTNET_MODES, PRODUCTION_MODES])
    assert.throws(() => modes.push("other"));
});

test("canonical production metadata permits explicit financial review and read-only staging", () => {
  const c = context();
  assert.equal(ready(c), null);
  c.bootstrap.capabilities.transactionsReady = false;
  assert.equal(productionContextIssue(c.bootstrap), null);
  assert.equal(productionContextIssue(c.bootstrap, c.detail), null);
  assert.ok(ready(c));
  c.bootstrap.capabilities.transactionsReady = true;
  assert.ok(
    productionContextIssue(c.bootstrap, null, { requireTransactions: true }),
  );
  c.bootstrap.session = null;
  assert.equal(productionContextIssue(c.bootstrap, c.detail), null);
  assert.ok(ready(c));
});

test("profile version, ABI, windows and every production fact are explicit", () => {
  assert.equal(isVerifiedProductionProfile(profile()), true);
  for (const [key, bad] of Object.entries({
    version: 8,
    financialModel: "unknown",
    upgradeable: false,
    testOnly: true,
    verified: false,
    chainId: 10200,
    challengeWindowSeconds: 900,
    matchWindowSeconds: 900,
    contractVersion: "kleros-event-v9",
    abiVersion: "kleros-event-v8",
  })) {
    const c = context();
    c.bootstrap.contractProfile[key] = bad;
    assert.ok(ready(c), key);
    assert.equal(
      isVerifiedProductionProfile(c.bootstrap.contractProfile),
      false,
      key,
    );
    const event = context().detail.event;
    event.contractProfile[key] = bad;
    assert.equal(isVerifiedProductionEvent(event), false, key);
    assert.equal(contractProfileForEvent(event), null, key);
  }
  for (const key of ["contractVersion", "abiVersion", "chainId"]) {
    const c = context();
    c.detail.event[key] = "invalid";
    assert.ok(ready(c), key);
  }
  for (const change of [
    (c) => delete c.bootstrap.contractProfile,
    (c) => (c.bootstrap.contractVersion = "kleros-event-v8"),
    (c) => (c.bootstrap.abiVersion = "kleros-event-v8"),
    (c) => delete c.detail.event.contractProfile,
  ]) {
    const c = context();
    change(c);
    assert.ok(ready(c));
  }
});

test("environment, capabilities, currency and RPC metadata fail closed", () => {
  const mutations = [
    (c) => (c.bootstrap.instanceId = ""),
    (c) => (c.bootstrap.environment.production = false),
    (c) => (c.bootstrap.environment.network = "chiado"),
    (c) => (c.bootstrap.environment.chainId = 10200),
    (c) => (c.bootstrap.chain.chainId = 10200),
    (c) => (c.bootstrap.chain.nativeCurrency.symbol = "XDAI"),
    (c) => (c.bootstrap.chain.nativeCurrency.decimals = 6),
    (c) => c.bootstrap.capabilities.supportedAccountTypes.push("smart"),
    (c) => (c.bootstrap.capabilities.financialInterface = "unknown"),
    (c) => (c.bootstrap.capabilities.transactionsReady = "true"),
  ];
  for (const key of ["production", "browserWallet", "walletTransactions"])
    mutations.push((c) => (c.bootstrap.capabilities[key] = false));
  for (const key of [
    "serverSigning",
    "contractWallets",
    "erc1271",
    "eip7702",
    "sharedDemo",
    "reset",
    "timeTravel",
    "mockRulings",
  ])
    mutations.push((c) => (c.bootstrap.capabilities[key] = true));
  for (const value of [
    undefined,
    "",
    "not a URL",
    "http://example.invalid",
    "javascript:alert(1)",
    "https://user:secret@example.invalid",
    "https://example.invalid#secret",
  ])
    mutations.push((c) => (c.bootstrap.chain.rpcUrl = value));
  for (const change of mutations) {
    const c = context();
    change(c);
    assert.ok(ready(c));
  }
});

test("Court and account support must agree with verified event metadata", () => {
  for (const change of [
    (c) => (c.bootstrap.arbitration.verified = false),
    (c) => (c.bootstrap.arbitration.mode = "controlled"),
    (c) => (c.bootstrap.walletSupport.erc1271 = true),
    (c) => (c.bootstrap.walletSupport.eip7702 = true),
    (c) => (c.bootstrap.walletSupport.type = "smart"),
    (c) => (c.detail.event.resolver = a("8")),
    (c) => (c.detail.event.arbitrator = a("8")),
    (c) => (c.detail.event.resolver = "0x0"),
    (c) => (c.detail.deploymentTrust.status = "changed"),
    (c) => (c.detail.deploymentTrust.status = "unavailable"),
  ]) {
    const c = context();
    change(c);
    assert.ok(ready(c));
  }
  const c = context();
  c.detail.event.resolver = c.detail.event.resolver
    .toUpperCase()
    .replace("0X", "0x");
  assert.equal(ready(c), null);
});

test("governance details and queued upgrade facts cannot be omitted or malformed", () => {
  for (const [key, value] of Object.entries({
    kind: "beacon",
    verified: false,
    implementation: "0x0",
    implementationCodeHash: h("0"),
    version: 8,
    authority: a("0"),
    multisig: "missing",
    delaySeconds: 900,
    pending: undefined,
  })) {
    const c = context();
    c.detail.upgrade[key] = value;
    assert.ok(ready(c), key);
  }
  const c = context();
  delete c.detail.upgrade.pending;
  assert.ok(ready(c));
  const pending = {
    operationId: h("c"),
    newImplementation: a("d"),
    eligibleAt: 1800000000,
    status: "waiting",
  };
  c.detail.upgrade.pending = pending;
  assert.equal(ready(c), null);
  for (const [key, value] of Object.entries({
    operationId: "0x0",
    newImplementation: a("0"),
    eligibleAt: 0,
    status: "",
  })) {
    const bad = context();
    bad.detail.upgrade.pending = { ...pending, [key]: value };
    assert.ok(ready(bad), key);
  }
});

test("production batch support requires chain1 and exact production mode; legacy profiles remain", () => {
  for (const contractVersion of [
    "truth-pays-v7",
    "kleros-event-v8",
    "kleros-event-v8-test15m",
  ])
    for (const mode of [undefined, "hosted-production", "hosted-testnet"])
      assert.equal(
        supportsBatchJournalProfile({ contractVersion, chainId: 1, mode }),
        false,
      );
  assert.equal(
    supportsBatchJournalProfile({
      contractVersion: V,
      chainId: 1,
      mode: "hosted-production",
    }),
    true,
  );
  for (const scope of [
    { contractVersion: V, chainId: 1 },
    { contractVersion: V, chainId: 10200, mode: "hosted-production" },
    { contractVersion: V, chainId: 1, mode: "hosted-testnet" },
  ])
    assert.equal(supportsBatchJournalProfile(scope), false);
  assert.equal(
    contractProfileForEvent({ contractVersion: "truth-pays-v7" })
      .financialInterface,
    "v7",
  );
  assert.equal(
    contractProfileForEvent({ contractVersion: "kleros-event-v8" })
      .financialInterface,
    "v8",
  );
});

test("neutral network labels reject controls and do not infer monetary value", () => {
  assert.equal(networkLabel({ name: " Ethereum " }), "Ethereum");
  assert.equal(
    nativeCurrencySymbol({ nativeCurrency: { symbol: " ETH " } }),
    "ETH",
  );
  for (const name of [undefined, "", "Bad\u0000name", "x".repeat(121), 1])
    assert.equal(networkLabel({ name }), "Network unavailable");
  assert.equal(
    nativeCurrencySymbol({ nativeCurrency: { symbol: "BAD\nTOKEN" } }),
    "native token",
  );
  const c = context(),
    before = JSON.stringify(c);
  assert.equal(ready(c), null);
  assert.equal(JSON.stringify(c), before);
});
