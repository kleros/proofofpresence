// Actual in-process V9 execution for local tests only. Court adjudication and the
// strict public-runtime bootstrap are injected; source/proxy/governance proofs
// still run against the real contracts. No public endpoint or key file is used.
import assert from "node:assert/strict";
import fs from "node:fs";
import ganache from "ganache";
import { ethers } from "ethers";
import { createWorkbench } from "../../src/workbench.mjs";
import { hash } from "../../src/utils.mjs";
import {
  UPGRADEABLE_VERSION,
  V9_MAINNET_SCOPE,
  loadUpgradeableArtifacts,
  verifyV9FactoryDeployment,
} from "../../src/upgrade-verification.mjs";

export const LUMA_LOCAL_DEPOSIT_WEI = 1000000000000n;
export const LUMA_LOCAL_DAY = 86400;
export const LUMA_LOCAL_GAS = Object.freeze({ gasLimit: 8000000 });
const lower = (value) => String(value).toLowerCase();
const same = (a, b) => lower(a) === lower(b);
const send = async (promise) => (await promise).wait();

// Ethers Wallet instances and their privateKey getters never leave this module.
class LocalActor extends ethers.AbstractSigner {
  #wallet;
  constructor(wallet, provider) {
    super(provider);
    this.#wallet = wallet;
    this.address = wallet.address;
  }
  async getAddress() {
    return this.address;
  }
  async signMessage(message) {
    return this.#wallet.signMessage(message);
  }
  async signTypedData() {
    throw new Error("Typed-data signing is outside this fixture");
  }
  async signTransaction() {
    throw new Error("Raw signed transactions are not exported by this fixture");
  }
  connect(provider) {
    assert.equal(
      provider,
      this.provider,
      "Synthetic actors cannot connect to another provider",
    );
    return this;
  }
  async sendTransaction(request) {
    assert.equal(BigInt(await this.provider.send("eth_chainId", [])), 1n);
    if (request.chainId != null) assert.equal(BigInt(request.chainId), 1n);
    return this.#wallet.sendTransaction(request);
  }
}

function transactionOf(tx) {
  assert(tx && ethers.isAddress(tx.to) && ethers.isAddress(tx.from));
  assert.equal(BigInt(tx.chainId), 1n);
  assert(ethers.isHexString(tx.data ?? "0x"));
  return {
    to: lower(tx.to),
    from: lower(tx.from),
    data: lower(tx.data ?? "0x"),
    value: BigInt(tx.value ?? 0).toString(),
    chainId: 1,
  };
}

export async function createLumaLaunchRuntime({
  eventIds = [],
  depositWei = LUMA_LOCAL_DEPOSIT_WEI,
} = {}) {
  const raw = ganache.provider({
    logging: { quiet: true },
    chain: { chainId: 1, hardfork: "shanghai" },
    miner: { blockGasLimit: 60000000 },
    wallet: { totalAccounts: 6, defaultBalance: 1000 },
  });
  const provider = new ethers.BrowserProvider(raw, undefined, {
    cacheTimeout: -1,
  });
  provider.pollingInterval = 10;
  try {
    const wallets = Object.values(raw.getInitialAccounts()).map(
      (account) =>
        new LocalActor(
          new ethers.Wallet(account.secretKey, provider),
          provider,
        ),
    );
    const actors = Object.freeze({
      upgradeOwner: wallets[0],
      organizer: wallets[1],
      payer: wallets[2],
      alice: wallets[2],
      bob: wallets[3],
      credit: wallets[4],
      other: wallets[5],
    });
    const artifacts = loadUpgradeableArtifacts();
    const reads = [],
      forbiddenBackendCalls = [],
      workbenches = new Set();
    const race = { wallet: null, provenanceReads: 0, triggered: false },
      trustFault = { contract: null },
      stats = { persisted: 0 };
    let saved = null,
      closed = false;
    const deploy = async (artifact, ...args) => {
      const contract = await new ethers.ContractFactory(
        artifact.abi,
        artifact.bytecode,
        actors.upgradeOwner,
      ).deploy(...args, { gasLimit: 16000000 });
      await contract.waitForDeployment();
      return contract;
    };
    const compiledFixture = (name) =>
      JSON.parse(
        fs.readFileSync(
          new URL(
            `../../references/kickback/build/${name}.json`,
            import.meta.url,
          ),
        ),
      );
    const timelock = await deploy(
      artifacts.timelock,
      actors.upgradeOwner.address,
    );
    const eventImplementation = await deploy(artifacts.event),
      factoryImplementation = await deploy(artifacts.factory);
    const proxy = await deploy(
      artifacts.proxy,
      factoryImplementation.target,
      factoryImplementation.interface.encodeFunctionData("initialize", [
        eventImplementation.target,
        timelock.target,
      ]),
    );
    const factory = new ethers.Contract(
      proxy.target,
      artifacts.factory.abi,
      actors.organizer,
    );
    const liquid = await deploy(compiledFixture("MockKlerosLiquid"));
    const resolver = await deploy(
      compiledFixture("MockArbitrableProxy"),
      liquid.target,
    );
    const factoryBirth = await proxy.deploymentTransaction().wait(),
      timelockBirth = await timelock.deploymentTransaction().wait();
    const factoryDeployment = {
      contractVersion: UPGRADEABLE_VERSION,
      abiVersion: UPGRADEABLE_VERSION,
      chainId: 1,
      factory: factory.target,
      factoryCodeHash: ethers.keccak256(await provider.getCode(factory.target)),
      implementation: eventImplementation.target,
      implementationCodeHash: ethers.keccak256(
        await provider.getCode(eventImplementation.target),
      ),
      factoryImplementation: factoryImplementation.target,
      factoryImplementationCodeHash: ethers.keccak256(
        await provider.getCode(factoryImplementation.target),
      ),
      initialImplementation: eventImplementation.target,
      initialFactoryImplementation: factoryImplementation.target,
      initialUpgradeOwner: actors.upgradeOwner.address,
      upgradeAuthority: timelock.target,
      upgradeAuthorityCodeHash: ethers.keccak256(
        await provider.getCode(timelock.target),
      ),
      factoryDeploymentTxHash: factoryBirth.hash,
      factoryDeploymentBlock: factoryBirth.blockNumber,
      timelockDeploymentTxHash: timelockBirth.hash,
      timelockDeploymentBlock: timelockBirth.blockNumber,
    };
    // Publication is a synthetic approved-policy DTO in this local fixture;
    // production publication/availability has separate release checks.
    const policyText =
      "Synthetic local V9 policy only. Attendance, disputes and held-share payments follow the unchanged V8 financial rules. No public publication is claimed.";
    Object.assign(factoryDeployment, {
      resolver: resolver.target,
      arbitrator: liquid.target,
      arbitratorExtraData: ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "uint256"],
        [0, 3],
      ),
      policyStatus: "published",
      policy: {
        uri: "https://production-fixture.example.invalid/policies/synthetic-v9",
        text: policyText,
        sha256: hash(policyText),
      },
    });
    const manifest = {
      environment: "production",
      chain: {
        chainId: 1,
        name: "Ethereum",
        rpcUrl: "https://synthetic.invalid",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      },
      provenance: {
        v9BuildManifestSha256: hash(
          JSON.parse(
            fs.readFileSync(
              new URL(
                "../../build/contracts-v9/manifest.json",
                import.meta.url,
              ),
            ),
          ),
        ),
        v9StandardInputSha256: hash(
          JSON.parse(
            fs.readFileSync(
              new URL(
                "../../build/contracts-v9/standard-input.json",
                import.meta.url,
              ),
            ),
          ),
        ),
      },
      arbitration: {
        mode: "kleros-v1",
        resolver: resolver.target,
        arbitrator: liquid.target,
      },
      governance: {
        kind: "single-owner-timelock",
        initialOwner: actors.upgradeOwner.address,
        minimumDelaySeconds: 172800,
      },
      factoryDeployment,
      events: [],
    };
    const backendProvider = new Proxy(provider, {
      get(target, key) {
        if (["broadcastTransaction", "getSigner", "listAccounts"].includes(key))
          return async () => {
            forbiddenBackendCalls.push(key);
            throw new Error("Backend must remain keyless");
          };
        if (key === "send")
          return async (method, params) => {
            reads.push({
              method,
              address: method === "eth_getCode" ? params[0] : null,
            });
            assert(
              !/^(eth_send|eth_sign|personal_|evm_)/.test(method),
              "No mutable runtime RPC",
            );
            return provider.send(method, params);
          };
        if (key === "getLogs")
          return async (filter) => {
            const logs = await provider.getLogs(filter);
            if (
              race.wallet &&
              Array.isArray(filter.address) &&
              ++race.provenanceReads === 2
            ) {
              await raw.request({
                method: "evm_setAccountCode",
                params: [race.wallet, "0x00"],
              });
              race.triggered = true;
            }
            return logs;
          };
        if (key === "getCode")
          return async (address, tag) =>
            same(address, trustFault.contract)
              ? "0x00"
              : provider.getCode(address, tag);
        const value = target[key];
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const runtime = {
      provider: backendProvider,
      chainId: 1,
      production: true,
      financialModel: "v8",
      governance: manifest.governance,
      arbitration: manifest.arbitration,
      manifest,
      rpcUrl: manifest.chain.rpcUrl,
      signers: [],
      eventVerification: new Map(),
      factoryDeployment,
      verifiedFactory: false,
      factoryTrust: null,
      resolver: new ethers.Contract(
        resolver.target,
        resolver.interface,
        backendProvider,
      ),
      liquid: new ethers.Contract(
        liquid.target,
        liquid.interface,
        backendProvider,
      ),
      close: async () => {},
    };
    async function runtimeFactory() {
      assert(!closed);
      runtime.factoryTrust = await verifyV9FactoryDeployment(
        runtime,
        factoryDeployment,
        V9_MAINNET_SCOPE,
      );
      runtime.verifiedFactory = true;
      return runtime;
    }
    const storeFactory = () => ({
      load: () => (saved ? structuredClone(saved) : null),
      save: (events, drafts) => {
        assert(events instanceof Map && drafts instanceof Map);
        // Match the real store's DTO encoding; structural validation of real
        // mainnet manifests/files belongs to its separate strict store tests.
        saved = structuredClone({
          events: [...events].map(([eventId, record]) => ({
            ...(!manifest.events.some((item) => item.definition.id === eventId)
              ? {
                  dynamic: true,
                  deployment: record.deployment,
                  policy: record.policy,
                  pieces: record.pieces,
                  slots: record.slots,
                }
              : {}),
            eventId,
            definition: record.definition,
            revision: record.revision,
            observations: record.observations,
            batches: record.batches,
            transactions: record.transactions,
            participants: [...record.participants],
            personal: [...record.personal],
            publications: [...record.publications],
            nonces: [...record.nonces],
          })),
          drafts: [...drafts],
        });
        stats.persisted++;
      },
    });
    const productionConfig = {
      manifest,
      stateFile: "/synthetic-in-memory-only",
    };
    async function makeWorkbench(
      options = {},
      { productionStore = storeFactory } = {},
    ) {
      assert.equal(typeof productionStore, "function");
      assert(
        options.serverInstanceId === undefined ||
          (typeof options.serverInstanceId === "string" &&
            options.serverInstanceId.length > 0),
      );
      const w = await createWorkbench(
        {
          contractVersion: UPGRADEABLE_VERSION,
          production: productionConfig,
          ...(options.serverInstanceId !== undefined
            ? { serverInstanceId: options.serverInstanceId }
            : {}),
        },
        { productionRuntime: runtimeFactory, productionStore },
      );
      workbenches.add(w);
      return w;
    }
    async function seedEvent(
      eventId,
      {
        organizer = actors.organizer,
        amountWei = depositWei,
        startOffset = 3600,
      } = {},
    ) {
      assert(!closed && Object.values(actors).includes(organizer));
      assert(/^[a-zA-Z0-9_-]+$/.test(eventId));
      assert(
        !manifest.events.some((record) => record.definition.id === eventId),
      );
      const now = (await provider.getBlock("latest")).timestamp;
      const definition = {
        id: eventId,
        title: `Synthetic ${eventId}`,
        slug: eventId,
        description: "In-process fixture only",
        location: "Synthetic local fixture",
        lumaUrl: `https://luma.com/synthetic-${eventId}`,
        timezone: "UTC",
        visibility: "public",
        editorialStatus: "published",
        registrationStatus: "open",
        organizers: [organizer.address],
        staff: [],
        startsAt: new Date((now + startOffset) * 1000).toISOString(),
        endsAt: new Date((now + 12 * 3600) * 1000).toISOString(),
      };
      const pieces = ['{"wallet":"', '","contract":"', '","organizer":"', '"}'],
        slots = "0x010204";
      const policy = "https://example.invalid/local-production-policy",
        key = ethers.id(eventId);
      const config = {
        depositAmount: amountWei,
        eventName: definition.title,
        eventStart: now + startOffset,
        claimDeadline: now + 8 * LUMA_LOCAL_DAY,
        arbitration: {
          disputeResolver: resolver.target,
          extraData: ethers.AbiCoder.defaultAbiCoder().encode(
            ["uint256", "uint256"],
            [0, 3],
          ),
          metaEvidenceTemplate: pieces,
          metaEvidenceSlots: slots,
          policyURI: policy,
        },
      };
      const receipt = await send(
        factory.connect(organizer).createEvent(key, config, LUMA_LOCAL_GAS),
      );
      const created = receipt.logs
        .filter((log) => same(log.address, factory.target))
        .map((log) => factory.interface.parseLog(log))
        .find((log) => log?.name === "EventCreated");
      assert(created);
      const deployment = {
        ...factoryDeployment,
        eventId,
        creator: organizer.address,
        owner: organizer.address,
        contract: created.args.eventContract,
        codeHash: ethers.keccak256(
          await provider.getCode(created.args.eventContract),
        ),
        implementationRevision: 1,
        factoryImplementationRevision: 1,
        deploymentTxHash: receipt.hash,
        deploymentBlock: receipt.blockNumber,
        eventKey: key,
        factoryEventId: created.args.eventId,
        configurationHash: created.args.configurationHash,
        depositWei: String(amountWei),
        eventName: definition.title,
        eventStart: config.eventStart,
        claimDeadline: config.claimDeadline,
        depositOpensAt: now,
        depositDeadline: config.eventStart,
        resolver: resolver.target,
        arbitrator: liquid.target,
        arbitratorExtraData: config.arbitration.extraData,
        policyURI: policy,
        templateHash: hash([pieces, slots]),
      };
      const record = {
        definition,
        deployment,
        pieces,
        slots,
        policy: "Synthetic immutable policy",
      };
      manifest.events.push(record);
      return record;
    }
    for (const eventId of eventIds) await seedEvent(eventId);

    const rpc = Object.freeze({
      request: async ({ method, params = [] }) => {
        assert(
          [
            "evm_setTime",
            "evm_increaseTime",
            "evm_mine",
            "evm_setAccountCode",
            "evm_snapshot",
            "evm_revert",
          ].includes(method),
          "Only explicit local test administration is exposed",
        );
        return raw.request({ method, params });
      },
    });
    async function advance(seconds) {
      assert(Number.isSafeInteger(seconds) && seconds >= 0);
      await rpc.request({ method: "evm_increaseTime", params: [seconds] });
      await rpc.request({ method: "evm_mine", params: [] });
    }
    function walletProvider(
      actor,
      {
        getAuthChallenge = () => null,
        getReviewedDraft = () => null,
        isCurrentContext = null,
      } = {},
    ) {
      assert(
        Object.values(actors).includes(actor),
        "Use the exact fixture actor object",
      );
      const calls = [],
        sent = [],
        used = new Set();
      return {
        calls,
        sent,
        async request({ method, params = [] }) {
          calls.push({ method });
          assert.equal(
            typeof isCurrentContext,
            "function",
            "Supply an explicit current-context guard",
          );
          assert(await isCurrentContext(), "Fixture wallet context changed");
          if (["eth_accounts", "eth_requestAccounts"].includes(method))
            return [actor.address];
          if (method === "eth_chainId") return "0x1";
          if (method === "personal_sign") {
            const challenge = getAuthChallenge();
            assert(
              challenge &&
                typeof challenge.message === "string" &&
                typeof challenge.origin === "string",
            );
            const bytes = ethers.getBytes(params[0]),
              message = ethers.toUtf8String(bytes);
            assert.equal(message, challenge.message);
            assert(same(params[1], actor.address));
            const origin = new URL(challenge.origin);
            assert.equal(origin.origin, challenge.origin);
            assert.equal(origin.protocol, "https:");
            const authSnapshot = JSON.stringify({
              message: challenge.message,
              nonce: challenge.nonce,
              origin: challenge.origin,
            });
            assert(message.startsWith("Kleros Ethereum mainnet workbench\n"));
            assert(
              message.includes(
                `\nDomain: ${origin.host}\nURI: ${origin.origin}\nChain ID: 1\nWallet: ${actor.address}\n`,
              ),
            );
            assert(message.includes(`\nNonce: ${challenge.nonce}\n`));
            assert.equal(
              getAuthChallenge(),
              challenge,
              "Auth challenge object changed",
            );
            assert(await isCurrentContext(), "Fixture wallet context changed");
            assert.equal(
              getAuthChallenge(),
              challenge,
              "Auth challenge object changed",
            );
            assert.equal(
              JSON.stringify({
                message: challenge.message,
                nonce: challenge.nonce,
                origin: challenge.origin,
              }),
              authSnapshot,
              "Auth challenge mutated",
            );
            return actor.signMessage(message);
          }
          assert.equal(
            method,
            "eth_sendTransaction",
            "No raw signing, RPC or administrative wallet methods exist",
          );
          assert.equal(params.length, 1);
          const review = getReviewedDraft();
          assert(
            review &&
              typeof review.id === "string" &&
              review.id &&
              typeof review.eventId === "string" &&
              review.eventId,
          );
          const expected = transactionOf(review.transaction),
            submitted = transactionOf(params[0]);
          const reviewId = review.id,
            reviewEventId = review.eventId;
          assert(
            same(review.wallet, actor.address) &&
              expected.from === lower(actor.address),
          );
          assert.deepEqual(submitted, expected);
          assert.equal(Number(review.chainId), 1);
          const reviewSnapshot = () =>
            JSON.stringify({
              id: review.id,
              eventId: review.eventId,
              wallet: review.wallet,
              chainId: review.chainId,
              mode: review.mode,
              instanceId: review.instanceId,
              abiVersion: review.abiVersion,
              contractVersion: review.contractVersion,
              factory: review.factory,
              contract: review.contract,
              snapshot: review.snapshot,
              expiresAt: review.expiresAt,
              transaction: transactionOf(review.transaction),
            });
          const snapshot = reviewSnapshot();
          assert(
            !used.has(reviewId),
            "A reviewed fixture transaction may be submitted only once",
          );
          assert.equal(BigInt(await provider.send("eth_chainId", [])), 1n);
          assert.equal(
            getReviewedDraft(),
            review,
            "Reviewed draft object changed",
          );
          assert.equal(reviewSnapshot(), snapshot, "Reviewed draft mutated");
          assert(await isCurrentContext(), "Fixture wallet context changed");
          assert.equal(
            getReviewedDraft(),
            review,
            "Reviewed draft object changed",
          );
          assert.equal(reviewSnapshot(), snapshot, "Reviewed draft mutated");
          used.add(reviewId);
          const tx = await actor.sendTransaction({
            to: submitted.to,
            data: submitted.data,
            value: BigInt(submitted.value),
            chainId: 1,
            ...LUMA_LOCAL_GAS,
          });
          sent.push({
            draftId: reviewId,
            eventId: reviewEventId,
            hash: tx.hash,
          });
          return tx.hash;
        },
      };
    }
    async function close() {
      if (closed) return;
      closed = true;
      for (const w of workbenches) await w.close();
      provider.destroy();
      await raw.disconnect();
    }
    return {
      provider,
      rpc,
      actors,
      artifacts,
      timelock,
      factory,
      liquid,
      resolver,
      manifest,
      factoryDeployment,
      productionConfig,
      runtime,
      chain: runtime,
      runtimeFactory,
      storeFactory,
      createWorkbench: makeWorkbench,
      seedEvent,
      walletProvider,
      advance,
      close,
      reads,
      forbiddenBackendCalls,
      race,
      trustFault,
      stats,
    };
  } catch (error) {
    provider.destroy();
    await raw.disconnect();
    throw error;
  }
}
