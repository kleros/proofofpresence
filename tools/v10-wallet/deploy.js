const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const hex = (value) => "0x" + BigInt(value).toString(16);
const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
const FRAMEWORK = Object.freeze({
  manager: "0xdb9b1e94b5b69df7e401ddbede43491141047db3",
  delegate: "0x63c0c19a282a1b52b07dd5a65b58948a07dae32b",
  nativeBalanceEnforcer: "0xbd7b277507723490cd50b12eaafe87c616be6880",
});
const designation = "0xef0100" + FRAMEWORK.delegate.slice(2);
const FIXED_WALLET = "0x2bb03593892724d225071068e59ab1e48af05b55";
function walletPins(review, prepared) {
  const proof = prepared.proof?.walletCompatibility;
  check(
    proof && ["eoa", "reviewed-delegated-direct-create"].includes(proof.kind),
    "The current account review is unavailable.",
  );
  if (proof.kind === "eoa") {
    check(
      proof.walletCode === "0x" && proof.framework.length === 0,
      "The EOA review differs.",
    );
    return proof;
  }
  const facts = review.delegatedCreateReview?.facts;
  check(
    facts?.scope === "four-direct-type2-create-infrastructure-only" &&
      facts.applicationFinancialSupport === false &&
      facts.wrappedExecutionSupported === false &&
      same(proof.walletCode, designation) &&
      same(facts.walletDesignation, designation) &&
      Array.isArray(facts.framework) &&
      facts.framework.length === 3 &&
      Object.entries(FRAMEWORK).every(
        ([name, address]) =>
          facts.framework.filter(
            (item) =>
              item.name === name &&
              same(item.address, address) &&
              /^0x(?:[0-9a-f]{2})+$/i.test(item.code),
          ).length === 1,
      ) &&
      JSON.stringify(proof.framework) === JSON.stringify(facts.framework),
    "The delegated direct-CREATE review or framework pins differ.",
  );
  return proof;
}
async function pinnedWalletCheck(provider, review, prepared, tag) {
  const pins = walletPins(review, prepared);
  const codes = await Promise.all([
    provider.request({
      method: "eth_getCode",
      params: [review.plan.deployer, tag],
    }),
    ...pins.framework.map((item) =>
      provider.request({ method: "eth_getCode", params: [item.address, tag] }),
    ),
  ]);
  check(
    same(codes[0], pins.walletCode) &&
      pins.framework.every((item, index) => same(codes[index + 1], item.code)),
    "The wallet designation or a reviewed framework runtime changed. No wallet request was made.",
  );
}
export const savedHashKey = (review, step) =>
  `v10-mainnet-setup:${review.planSha256}:${review.plan.deployer.toLowerCase()}:${step}`;
export function readSavedHash(storage, review, step, serverRow = {}) {
  let value;
  try {
    const raw = storage.getItem(savedHashKey(review, step));
    if (!raw) return null;
    value = JSON.parse(raw);
  } catch {
    return { invalid: true };
  }
  const tx = review.plan.transactions[step - 1];
  if (
    !tx ||
    value.planSha256 !== review.planSha256 ||
    !same(value.wallet, review.plan.deployer) ||
    value.chainId !== 1 ||
    value.step !== step ||
    value.nonce !== tx.nonce ||
    !/^0x[a-f0-9]{64}$/i.test(value.hash ?? "")
  )
    return { invalid: true };
  return {
    ...value,
    conflict: !!serverRow.hash && !same(serverRow.hash, value.hash),
  };
}
export function assertPrepared(review, step, prepared) {
  const expected = review.plan.transactions[step - 1];
  check(
    prepared.planSha256 === review.planSha256 &&
      prepared.approvalHash === review.approvalHash &&
      prepared.step === step &&
      Number.isSafeInteger(prepared.validUntil) &&
      prepared.validUntil > Date.now() &&
      prepared.validUntil <= Date.now() + 60000 &&
      expected &&
      JSON.stringify(prepared.transaction) === JSON.stringify(expected),
    "The prepared request differs from the reviewed plan.",
  );
  return expected;
}
export async function handoffOne({
  api,
  provider,
  review,
  step,
  saveHash = () => {},
  isCurrent = () => true,
}) {
  check(
    review.signingEnabled === true &&
      isCurrent() &&
      same(review.plan.deployer, FIXED_WALLET) &&
      review.plan.chainId === 1 &&
      review.plan.contractVersion === "kleros-event-v10-uups" &&
      review.terms?.upgradeDelaySeconds === 0,
    "Wallet signing is not enabled for this reviewed plan.",
  );
  const [chain, accounts] = await Promise.all([
    provider.request({ method: "eth_chainId" }),
    provider.request({ method: "eth_accounts" }),
  ]);
  check(
    BigInt(chain) === 1n &&
      accounts.length === 1 &&
      same(accounts[0], review.plan.deployer),
    "Select the approved wallet on Ethereum mainnet.",
  );
  const prepared = await api.prepare({ step, wallet: accounts[0], chainId: 1 });
  let hash;
  try {
    const tx = assertPrepared(review, step, prepared);
    check(isCurrent(), "The selected wallet context changed.");
    const block = await provider.request({
      method: "eth_getBlockByNumber",
      params: ["latest", false],
    });
    check(
      block &&
        /^0x[0-9a-f]{64}$/i.test(block.hash ?? "") &&
        /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(block.number ?? ""),
      "A fresh canonical wallet head is required.",
    );
    const tag = block.number;
    const [latestChain, latestAccounts, pending, balance, code, targetNonce] =
      await Promise.all([
        provider.request({ method: "eth_chainId" }),
        provider.request({ method: "eth_accounts" }),
        provider.request({
          method: "eth_getTransactionCount",
          params: [tx.from, tag],
        }),
        provider.request({
          method: "eth_getBalance",
          params: [tx.from, "pending"],
        }),
        provider.request({
          method: "eth_getCode",
          params: [tx.predictedAddress, tag],
        }),
        provider.request({
          method: "eth_getTransactionCount",
          params: [tx.predictedAddress, tag],
        }),
      ]);
    check(
      BigInt(latestChain) === 1n &&
        latestAccounts.length === 1 &&
        same(latestAccounts[0], tx.from) &&
        BigInt(pending) === BigInt(tx.nonce) &&
        code === "0x" &&
        BigInt(targetNonce) === 0n,
      "Wallet, nonce or predicted address changed. Stop this handoff.",
    );
    await pinnedWalletCheck(provider, review, prepared, tag);
    const remaining = review.plan.transactions
      .slice(step - 1)
      .reduce(
        (sum, item) =>
          sum + BigInt(item.gasLimit) * BigInt(item.maxFeePerGasWei),
        0n,
      );
    check(
      BigInt(balance) >= remaining &&
        block.baseFeePerGas &&
        BigInt(block.baseFeePerGas) + BigInt(tx.maxPriorityFeePerGasWei) <=
          BigInt(tx.maxFeePerGasWei),
      "Balance or current fee no longer fits the approved ceiling.",
    );
    await pinnedWalletCheck(provider, review, prepared, tag);
    const [closing, closingChain, closingAccounts, closingNonce] =
      await Promise.all([
        provider.request({
          method: "eth_getBlockByNumber",
          params: [tag, false],
        }),
        provider.request({ method: "eth_chainId" }),
        provider.request({ method: "eth_accounts" }),
        provider.request({
          method: "eth_getTransactionCount",
          params: [tx.from, "pending"],
        }),
      ]);
    check(
      isCurrent() &&
        same(closing?.hash, block.hash) &&
        BigInt(closingChain) === 1n &&
        closingAccounts.length === 1 &&
        same(closingAccounts[0], tx.from) &&
        BigInt(closingNonce) === BigInt(tx.nonce),
      "The wallet or canonical check changed before handoff.",
    );
    check(
      prepared.validUntil > Date.now(),
      "The prepared review expired before wallet handoff.",
    );
    hash = await provider.request({
      method: "eth_sendTransaction",
      params: [
        {
          from: tx.from,
          chainId: "0x1",
          type: "0x2",
          nonce: hex(tx.nonce),
          value: "0x0",
          data: tx.data,
          gas: hex(tx.gasLimit),
          maxFeePerGas: hex(tx.maxFeePerGasWei),
          maxPriorityFeePerGas: hex(tx.maxPriorityFeePerGasWei),
        },
      ],
    });
    check(
      typeof hash === "string" && /^0x[a-f0-9]{64}$/i.test(hash),
      "Wallet result is uncertain. Preserve its original hash.",
    );
    // Synchronous local preservation happens before any subsequent await or RPC read.
    try {
      saveHash({
        planSha256: review.planSha256,
        wallet: tx.from,
        chainId: 1,
        nonce: tx.nonce,
        step,
        hash,
      });
    } catch {
      /* Still record the known hash server-side immediately. */
    }
    await api.submitted({ step, capability: prepared.capability, hash });
    return { status: "submitted", hash };
  } catch (error) {
    if (hash) return { status: "submitted-record-unavailable", hash };
    try {
      await api.walletError({
        step,
        capability: prepared.capability,
        code: error?.code === 4001 ? 4001 : null,
      });
    } catch {
      /* The existing prepared journal already prevents resending. */
    }
    if (error?.code === 4001) return { status: "rejected" };
    throw new Error(
      "The prepared handoff stopped without a known hash. Do not resend. Inspect the wallet and recover its original hash.",
    );
  }
}

function eth(wei) {
  const n = BigInt(wei),
    whole = n / 10n ** 18n,
    part = (n % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return whole + (part ? "." + part : "");
}
async function boot() {
  const $ = (id) => document.getElementById(id),
    message = (text) => {
      $("message").textContent = text;
    };
  const request = async (url, value) => {
    const response = await fetch(
      url,
      value === undefined
        ? {}
        : {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(value),
          },
    );
    const data = await response.json();
    if (!response.ok) throw new Error(`${data.code}: ${data.message}`);
    return data;
  };
  const review = await request("/api/plan");
  let state = await request("/api/state"),
    connected = false,
    busy = false;
  $("budget").textContent =
    `${eth(review.plan.maxTotalGasCostWei)} ETH maximum total gas cost`;
  $("owner").textContent =
    `Deployment wallet and initial upgrade owner: ${review.plan.deployer}`;
  $("approval").textContent = review.signingEnabled
    ? "Exact plan and budget approval supplied. Each transaction still requires your separate wallet confirmation."
    : "Review-only: wallet signing is disabled until separate approval of this exact plan and ETH ceiling.";
  $("sources").textContent = JSON.stringify(
    {
      planSha256: review.planSha256,
      approvalHash: review.approvalHash,
      bridgeSourceSha256: review.bridgeSourceSha256,
      bridgeSources: review.bridgeSources,
      provenance: review.plan.provenance,
      delegatedCreateReview: review.delegatedCreateReview,
      sourceHashes: review.plan.compilation.sourceHashes,
    },
    null,
    2,
  );
  const api = {
    prepare: (v) => request("/api/prepare-step", v),
    submitted: (v) => request("/api/record-submitted", v),
    walletError: (v) => request("/api/wallet-error", v),
  };
  const titles = [
    "Deploy immediate upgrade controller",
    "Deploy event implementation",
    "Deploy factory implementation",
    "Deploy and initialize factory proxy",
  ];
  const providers = new Map();
  let selectedProvider = null;
  function addProvider(provider, name) {
    if (
      !provider ||
      [...providers.values()].some((entry) => entry.provider === provider)
    )
      return;
    const key = String(providers.size + 1),
      option = document.createElement("option");
    name ??= provider.isBraveWallet
      ? "Brave Wallet"
      : provider.isMetaMask
        ? "MetaMask"
        : "Injected browser wallet";
    providers.set(key, { provider, name });
    option.value = key;
    option.textContent = name;
    $("provider").append(option);
    for (const event of ["accountsChanged", "chainChanged"])
      provider.on?.(event, () => {
        if (selectedProvider === provider) {
          connected = false;
          $("consent").checked = false;
          render();
        }
      });
  }
  window.addEventListener("eip6963:announceProvider", (event) =>
    addProvider(event.detail?.provider, event.detail?.info?.name),
  );
  for (const provider of window.ethereum?.providers ??
    (window.ethereum ? [window.ethereum] : []))
    addProvider(provider);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  $("provider").onchange = () => {
    connected = false;
    selectedProvider = null;
    $("consent").checked = false;
    $("wallet").textContent =
      "Reconnect and verify the approved account in the selected provider.";
    render();
  };
  async function refresh() {
    state = await request("/api/state");
    render();
  }
  function render() {
    $("steps").replaceChildren();
    $("provider").disabled = busy;
    $("connect").disabled = busy;
    const restored = new Map(
      state.steps.map((row) => [
        row.step,
        readSavedHash(localStorage, review, row.step, row),
      ]),
    );
    const conflict = [...restored.values()].some(
      (value) => value?.conflict || value?.invalid,
    );
    $("setup").textContent =
      state.setup?.status === "verified"
        ? `All four setup receipts and factory / owner / immediate controller governance were last verified at block ${state.setup.anchor.number}. Event creation is a separate action.`
        : state.steps.every((row) => row.state === "confirmed")
          ? "Four receipts are confirmed. Final factory and governance verification is still required."
          : "";
    for (const tx of review.plan.transactions) {
      const row = state.steps.find((r) => r.step === tx.step),
        section = document.createElement("section");
      section.className = "step";
      const heading = document.createElement("h2");
      heading.textContent = `${tx.step}. ${titles[tx.step - 1]}`;
      section.append(heading);
      const facts = document.createElement("dl");
      facts.className = "facts";
      for (const [label, value] of [
        ["State", row.state],
        ["CREATE nonce", tx.nonce],
        ["Predicted address", tx.predictedAddress],
        ["Gas limit", tx.gasLimit],
        ["Max fee / gas", `${tx.maxFeePerGasWei} wei`],
        ["Priority fee / gas", `${tx.maxPriorityFeePerGasWei} wei`],
        [
          "Step ETH ceiling",
          `${eth(BigInt(tx.gasLimit) * BigInt(tx.maxFeePerGasWei))} ETH`,
        ],
        ["Expected runtime", tx.expectedRuntimeCodeHash],
        ...(row.originalHash
          ? [["First preserved hash", row.originalHash]]
          : []),
        ...(row.hash ? [["Current receipt hash", row.hash]] : []),
      ]) {
        const dt = document.createElement("dt"),
          dd = document.createElement("dd");
        dt.textContent = label;
        dd.textContent = String(value);
        facts.append(dt, dd);
      }
      section.append(facts);
      const saved = restored.get(tx.step);
      if (saved?.conflict || saved?.invalid) {
        const warning = document.createElement("p");
        warning.className = "status";
        warning.textContent = saved.invalid
          ? "Browser hash metadata does not match this plan. Sending is paused; inspect it before any new handoff."
          : `Hash conflict: browser ${saved.hash}; server ${row.hash}. Sending is paused. Verify both original-nonce candidates; no hash will be overwritten automatically.`;
        section.append(warning);
        if (
          (saved.conflict || saved.invalid) &&
          row.state === "confirmed" &&
          row.receipt
        ) {
          const acknowledge = document.createElement("button");
          acknowledge.textContent =
            "Acknowledge server-verified canonical receipt";
          acknowledge.onclick = () => {
            localStorage.setItem(
              savedHashKey(review, tx.step),
              JSON.stringify({
                planSha256: review.planSha256,
                wallet: review.plan.deployer,
                chainId: 1,
                step: tx.step,
                nonce: tx.nonce,
                hash: row.hash,
              }),
            );
            render();
          };
          section.append(acknowledge);
        }
      }
      if (row.candidates?.length > 1) {
        const candidates = document.createElement("pre");
        candidates.textContent = row.candidates
          .map((entry) => `${entry.hash} · ${entry.state}`)
          .join("\n");
        section.append(candidates);
      }
      const inspect = document.createElement("button");
      inspect.textContent = "Check current read-only preflight";
      inspect.disabled =
        busy || !["not-prepared", "rejected"].includes(row.state);
      inspect.onclick = async () => {
        busy = true;
        render();
        try {
          const proof = await request(`/api/check?step=${tx.step}`);
          message(
            `Step ${tx.step}: read-only preflight passed at block ${proof.block.number}. ${eth(proof.remainingMaxCostWei)} ETH remaining ceiling.`,
          );
        } catch (e) {
          message(e.message);
        } finally {
          busy = false;
          await refresh();
        }
      };
      section.append(inspect);
      const send = document.createElement("button");
      send.className = "send";
      send.textContent =
        row.state === "rejected"
          ? "New review and one wallet request"
          : "Send one wallet CREATE request";
      send.disabled =
        busy ||
        conflict ||
        !connected ||
        !review.signingEnabled ||
        !$("consent").checked ||
        !["not-prepared", "rejected"].includes(row.state) ||
        state.steps.some((r) => r.step < tx.step && r.state !== "confirmed");
      send.onclick = async () => {
        busy = true;
        render();
        message(
          "Preparing one request; confirm its exact details in your wallet.",
        );
        try {
          const handoffProvider = selectedProvider;
          const result = await handoffOne({
            api,
            provider: selectedProvider,
            review,
            step: tx.step,
            isCurrent: () =>
              connected &&
              selectedProvider === handoffProvider &&
              $("consent").checked,
            saveHash: (value) => {
              localStorage.setItem(
                savedHashKey(review, tx.step),
                JSON.stringify(value),
              );
              message(`Original transaction hash: ${value.hash}`);
            },
          });
          message(
            result.hash
              ? `Preserved original hash ${result.hash}. Use receipt recovery before the next step.`
              : "Wallet rejected. A fresh explicit review is required.",
          );
        } catch (e) {
          message(e.message);
        } finally {
          busy = false;
          $("consent").checked = false;
          await refresh();
        }
      };
      section.append(send);
      if (
        [
          "prepared",
          "uncertain",
          "submitted",
          "confirmed",
          "human-review",
        ].includes(row.state)
      ) {
        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = "Original transaction hash from your wallet";
        input.setAttribute(
          "aria-label",
          `Original transaction hash for step ${tx.step}`,
        );
        input.value = saved && !saved.invalid ? saved.hash : (row.hash ?? "");
        input.readOnly = !!saved && !saved.invalid;
        const recover = document.createElement("button");
        recover.textContent = "Recover / check original receipt";
        recover.disabled = busy;
        recover.onclick = async () => {
          busy = true;
          render();
          try {
            const proof = await request("/api/recover-candidate", {
              step: tx.step,
              hash: input.value.trim(),
            });
            message(
              `Step ${tx.step}: ${proof.status}. No wallet request was made.`,
            );
          } catch (e) {
            message(e.message);
          } finally {
            busy = false;
            await refresh();
          }
        };
        section.append(input, recover);
        const replacement = document.createElement("input");
        replacement.type = "text";
        replacement.placeholder =
          "Replacement or corrected hash for this same CREATE nonce";
        replacement.setAttribute(
          "aria-label",
          `Candidate transaction hash for step ${tx.step}`,
        );
        const verify = document.createElement("button");
        verify.textContent = "Verify candidate hash · read-only";
        verify.disabled = busy;
        verify.onclick = async () => {
          busy = true;
          render();
          try {
            const proof = await request("/api/recover-candidate", {
              step: tx.step,
              hash: replacement.value.trim(),
            });
            message(
              `Candidate: ${proof.status}. Only an exact original-nonce CREATE within the approved caps can be adopted.`,
            );
          } catch (e) {
            message(e.message);
          } finally {
            busy = false;
            await refresh();
          }
        };
        section.append(replacement, verify);
      }
      $("steps").append(section);
    }
  }
  $("connect").onclick = async () => {
    try {
      const selected = providers.get($("provider").value);
      check(selected, "Install or select your browser wallet provider.");
      selectedProvider = selected.provider;
      const accounts = await selectedProvider.request({
        method: "eth_requestAccounts",
      });
      const chain = await selectedProvider.request({ method: "eth_chainId" });
      check(
        accounts.length === 1 &&
          same(accounts[0], review.plan.deployer) &&
          BigInt(chain) === 1n,
        "Select the exact approved wallet on Ethereum mainnet manually.",
      );
      connected = true;
      $("wallet").textContent =
        `${selected.name}: ${accounts[0]} · Ethereum chain1`;
      render();
    } catch (e) {
      connected = false;
      message(e.message);
      render();
    }
  };
  $("consent").onchange = render;
  render();
}
if (typeof document !== "undefined")
  boot().catch(() => {
    document.getElementById("message").textContent =
      "Local review unavailable. No wallet request was made.";
  });
