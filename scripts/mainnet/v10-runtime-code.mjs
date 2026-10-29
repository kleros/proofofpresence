import { ethers } from "ethers";

// Compiler-free: hosted builds never import the unsigned planner or solc.
export function v10RuntimeCode(artifact, implementation, controllerCodeHash) {
  if (
    !ethers.isAddress(implementation) ||
    BigInt(implementation) === 0n ||
    !/^0x[0-9a-f]{64}$/i.test(controllerCodeHash)
  )
    throw new Error("Invalid V10 immutable inputs");
  const code = ethers.getBytes(artifact.deployedBytecode),
    occupied = new Set(),
    refs = artifact.immutableReferences ?? {},
    values = artifact.immutableValues ?? {};
  if (Object.keys(refs).sort().join() !== Object.keys(values).sort().join())
    throw new Error("Incomplete V10 immutable metadata");
  for (const [id, locations] of Object.entries(refs)) {
    const value = values[id],
      encoded =
        value?.name === "__self" &&
        value.type === "address" &&
        value.value === "implementation-address"
          ? ethers.zeroPadValue(implementation, 32)
          : value?.name === "_controllerCodeHash" &&
              value.type === "bytes32" &&
              value.value?.toLowerCase() === controllerCodeHash.toLowerCase()
            ? controllerCodeHash
            : null;
    if (!encoded || !Array.isArray(locations) || !locations.length)
      throw new Error("Unknown V10 immutable metadata");
    for (const location of locations) {
      const { start, length } = location;
      if (
        Object.keys(location).sort().join() !== "length,start" ||
        !Number.isSafeInteger(start) ||
        start < 0 ||
        length !== 32 ||
        start + length > code.length
      )
        throw new Error("Invalid V10 immutable location");
      for (let i = start; i < start + length; i++) {
        if (occupied.has(i) || code[i] !== 0)
          throw new Error("Overlapping or nonzero V10 immutable template");
        occupied.add(i);
      }
      code.set(ethers.getBytes(encoded), start);
    }
  }
  return ethers.hexlify(code);
}
