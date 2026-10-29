import { ethers } from "ethers";
import { CHIADO, sha256, publicJson } from "../src/testnet-config.mjs";
import { loadV8Artifacts } from "../src/contracts-v8.mjs";
import { UI_D, prepareUiDPlan } from "../scripts/testnet-ui-d-scenario.mjs";
export const addr = n => ethers.getAddress("0x" + n.toString(16).padStart(40, "0"));
export const copy = x => JSON.parse(publicJson(x));
export function dFixture() {
  const event = loadV8Artifacts(UI_D.contractVersion);
  const artifacts = { [UI_D.eventArtifact]: event.event, [UI_D.factoryArtifact]: event.factory };
  const source = { environment: "testnet", chain: CHIADO, publicOrigin: "https://ab.example.invalid",
    planFingerprint: "protected-ab", factory: addr(20), factoryCodeHash: ethers.id("legacy-factory"),
    arbitration: { mode: "controlled", resolver: addr(21), arbitrator: addr(22), notice: "Controlled; no independent jury" },
    policy: { uri: "https://ab.example.invalid/policies/v8-testnet.md", sha256: "a".repeat(64) },
    rehearsalAddresses: { ownerA: addr(1), ownerB: addr(2), alice: addr(3), bob: addr(4), carol: addr(5) },
    events: [addr(40), addr(41)].map(contract => ({ deployment: { chainId: 10200, contractVersion: "kleros-event-v8", contract } })) };
  const protectedC = { ...copy(source), publicOrigin: "https://c.example.invalid", planFingerprint: "protected-c",
    rehearsalAddresses: { owner: addr(10), alice: addr(11), bob: addr(12) },
    events: [{ deployment: { chainId: 10200, contractVersion: "kleros-event-v8", contract: addr(42) } }] };
  const provenance = { sources: { "synthetic-pure-profile-fixture.sol": sha256("not a deployment provenance") },
    creationCodeHashes: Object.fromEntries(Object.entries(artifacts).map(([n, a]) => [n, ethers.keccak256(a.bytecode)])) };
  const stack = { anchors: [20, 21, 22].map(n => ({ contract: addr(n), codeHash: ethers.id(String(n)) })),
    feeForJurorWei: "10000000000", arbitrationCostWei: "30000000000" };
  const policyText = "Synthetic fast D policy: CHALLENGE_PERIOD900; MATCH_PERIOD900; ruling1 attended.\n";
  const input = { source, protectedC, artifacts, provenance, stack,
    addresses: { owner: addr(30), alice: addr(31), bob: addr(32) },
    publicOrigin: "https://d.example.invalid", policy: { uri: "https://d.example.invalid/policies/v8-test15m.md", sha256: sha256(policyText) },
    maxFeePerGas: 200000n, now: 1793235000 };
  return { ...input, policyText, plan: prepareUiDPlan(input) };
}
