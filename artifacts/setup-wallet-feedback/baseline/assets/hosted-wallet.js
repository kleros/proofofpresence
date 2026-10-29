// A chain ID alone does not distinguish a hosted sandbox from another local1337.
export async function assertDemoChainInstance(provider, marker, rpcUrl) {
  if (
    !Number.isSafeInteger(marker?.blockNumber) ||
    marker.blockNumber < 0 ||
    !/^0x[0-9a-f]{64}$/i.test(marker?.blockHash ?? "")
  )
    throw new Error(
      "The hosted demo chain identity is unavailable. Refresh before connecting or signing.",
    );
  let block;
  try {
    block = await provider.request({
      method: "eth_getBlockByNumber",
      params: [`0x${marker.blockNumber.toString(16)}`, false],
    });
  } catch {}
  if (block?.hash?.toLowerCase() !== marker.blockHash.toLowerCase())
    throw new Error(
      `Your wallet is connected to a different chain1337 instance. Set its sandbox RPC URL to ${rpcUrl}, then reconnect. No transaction was requested.`,
    );
}
