// Cancellation follows only the originating background read; never closes a shared provider.
import { AsyncLocalStorage } from "node:async_hooks";
const reads = new AsyncLocalStorage();
export function withReadJobScope(signal, fn) {
  if (!(signal instanceof AbortSignal) || typeof fn !== "function") throw new TypeError("Use a trusted read job signal and callback.");
  signal.throwIfAborted();
  return reads.run(signal, fn);
}
export function readJobSignal() { return reads.getStore(); }
