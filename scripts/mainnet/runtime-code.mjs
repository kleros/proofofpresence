import { ethers } from "ethers";

/** Materialize compiler-declared immutables only after verifying artifacts against source. */
export function v9RuntimeCode(artifact, implementation, timelockCodeHash) {
  if (!ethers.isAddress(implementation) || BigInt(implementation) === 0n || !/^0x[0-9a-f]{64}$/i.test(timelockCodeHash))
    throw new Error("Invalid implementation or timelock hash");
  const code = ethers.getBytes(artifact.deployedBytecode), occupied = new Set();
  const references = artifact.immutableReferences ?? {}, values = artifact.immutableValues ?? {};
  if (Object.keys(references).sort().join() !== Object.keys(values).sort().join())
    throw new Error("Incomplete immutable metadata");
  for (const [id, locations] of Object.entries(references)) {
    const value = values[id];
    const encoded = value?.name === "__self" && value.type === "address" && value.value === "implementation-address"
      ? ethers.zeroPadValue(implementation, 32)
      : value?.name === "_timelockCodeHash" && value.type === "bytes32" && value.value?.toLowerCase() === timelockCodeHash.toLowerCase()
        ? timelockCodeHash : null;
    if (!encoded || !Array.isArray(locations) || !locations.length) throw new Error("Unknown immutable metadata");
    for (const { start, length } of locations) {
      if (!Number.isSafeInteger(start) || start < 0 || length !== 32 || start + length > code.length)
        throw new Error("Invalid immutable location");
      for (let i = start; i < start + length; i++) {
        if (occupied.has(i) || code[i] !== 0) throw new Error("Overlapping or nonzero immutable template");
        occupied.add(i);
      }
      code.set(ethers.getBytes(encoded), start);
    }
  }
  return ethers.hexlify(code);
}
