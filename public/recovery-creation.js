import { mountSetupProgress } from "./setup-progress.js";

const validHash = (v) => typeof v === "string" && /^0x[0-9a-f]{64}$/i.test(v);
const validAddress = (v) =>
  typeof v === "string" && /^0x[0-9a-f]{40}$/i.test(v);
const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.toLowerCase() === b.toLowerCase();
const escape = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

/** Separate read-only authentication; never enters the ordinary app or signing APIs. */
export function mountCreationRecovery(
  host,
  { provider = () => window.ethereum } = {},
) {
  const $ = (selector) => host.querySelector(selector);
  let alive = true,
    epoch = 0,
    busy = false,
    scope = null,
    panel = null,
    walletProvider = null;
  const controllers = new Set();
  const current = (generation) =>
    alive && host.isConnected && generation === epoch;
  const status = (message) => {
    if (alive) $("[data-recovery-status]").textContent = message;
  };
  const error = (message) => {
    if (alive) {
      $("[data-recovery-error]").textContent = message;
      $("[data-recovery-error]").hidden = !message;
    }
  };
  const lock = (value) => {
    busy = value;
    $("[data-recovery-connect]").disabled = value || scope !== null;
    $("[data-recovery-check]").disabled = value;
    $("[data-recovery-signout]").disabled = value;
    $("[name=transaction]").readOnly = value || scope !== null;
  };
  const request = async (
    path,
    body,
    method = body === undefined ? "GET" : "POST",
  ) => {
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 35000);
    try {
      const response = await fetch(path, {
        method,
        credentials: "same-origin",
        signal: controller.signal,
        ...(method === "GET"
          ? {}
          : {
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body ?? {}),
            }),
      });
      const value = await response.json();
      if (!response.ok)
        throw Object.assign(
          new Error(
            typeof value.error === "string"
              ? value.error
              : "The original transaction could not be checked.",
          ),
          { code: value.code },
        );
      return value;
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
    }
  };
  const clearView = () => {
    panel?.dispose();
    panel = null;
    $("[data-recovery-facts]").replaceChildren();
    $("[data-recovery-facts]").hidden = true;
  };
  const invalidate = () => {
    epoch++;
    scope = null;
    busy = false;
    for (const controller of controllers) controller.abort();
    clearView();
    lock(false);
    $("[data-recovery-check]").hidden = true;
    $("[data-recovery-signout]").hidden = true;
    status(
      "The wallet or network changed. Sign in again to inspect the original transaction.",
    );
  };
  const listen = (next) => {
    if (walletProvider === next) return;
    walletProvider?.removeListener?.("accountsChanged", invalidate);
    walletProvider?.removeListener?.("chainChanged", invalidate);
    walletProvider = next;
    next.on?.("accountsChanged", invalidate);
    next.on?.("chainChanged", invalidate);
  };
  const show = (value, generation) => {
    if (!current(generation)) return;
    if (
      value?.schemaVersion !== 1 ||
      value.kind !== "factory-creation-recovery" ||
      value.mode !== "hosted-production" ||
      value.instanceId !== scope?.instanceId ||
      value.session?.mode !== "recovery-only" ||
      !same(value.session.wallet, scope.wallet) ||
      !same(value.wallet, scope.wallet) ||
      !same(value.hash, scope.hash) ||
      value.chainId !== 1 ||
      value.provenance !== "not-verified" ||
      !value.capabilities ||
      Object.values(value.capabilities).some((v) => v !== false) ||
      ![
        "transaction-not-found",
        "transaction-pending",
        "original-transaction-confirmed",
        "original-transaction-reverted",
      ].includes(value.status)
    )
      throw Error(
        "The recovery response belongs to a different wallet, transaction or server. Sign out and check the original transaction again.",
      );
    const confirmed = value.transactionConfirmed === true;
    const matched = value.originalReviewMatches === true;
    if (
      value.status === "original-transaction-confirmed" &&
      (!confirmed ||
        value.transactionSucceeded !== true ||
        value.canonical !== true ||
        !matched ||
        !validAddress(value.child))
    )
      throw Error(
        "The confirmed transaction has no complete original-review proof. Preserve its transaction ID.",
      );
    panel ??= mountSetupProgress($("[data-recovery-progress]"), {
      isCurrent: () => current(generation) && scope !== null,
      onCopy: (hash) => navigator.clipboard.writeText(hash),
      onCheck: ({ hash }) => {
        if (scope && same(hash, scope.hash)) return inspect();
      },
    });
    const message =
      value.status === "original-transaction-confirmed"
        ? "Your transaction is confirmed and its factory call matches the original review. The event page remains unavailable while full contract provenance and wallet compatibility are reviewed. Keep this original transaction; do not create it again."
        : value.status === "original-transaction-reverted"
          ? "The original transaction reverted. No event page is enabled by this recovery check."
          : "The original transaction has no confirmed result yet. Use Check original transaction to read the same transaction again.";
    panel.update({
      phase: confirmed
        ? value.transactionSucceeded === false
          ? "reverted"
          : "verification-failed"
        : "confirmations",
      hash: scope.hash,
      chainId: 1,
      transactionConfirmed: confirmed,
      ...(Number.isSafeInteger(value.confirmations)
        ? { confirmations: value.confirmations }
        : {}),
      message,
    });
    const facts = $("[data-recovery-facts]");
    facts.hidden = false;
    facts.innerHTML = `<h2>${escape(value.title || "Original event")}</h2><dl class="luma-setup-terms"><dt>Event ID</dt><dd><code>${escape(value.eventId)}</code></dd><dt>Transaction</dt><dd><code>${escape(scope.hash)}</code></dd><dt>Wallet</dt><dd><code>${escape(scope.wallet)}</code></dd>${value.child ? `<dt>Created contract</dt><dd><code>${escape(value.child)}</code></dd>` : ""}${confirmed ? `<dt>Canonical block</dt><dd>${escape(value.blockNumber)}</dd>` : ""}<dt>Original reviewed call</dt><dd>${matched ? "Matches exactly" : "Not yet confirmed"}</dd><dt>Event page</dt><dd>Not enabled by this read-only check</dd></dl>`;
    status(
      confirmed
        ? "Original transaction checked. No transaction was sent."
        : "Original transaction is still awaiting a confirmed result.",
    );
  };
  const inspect = async () => {
    if (busy || !scope || !alive) return;
    const generation = epoch;
    lock(true);
    error("");
    status("Checking the original transaction and saved review…");
    try {
      const result = await request("/api/recovery/original-creation");
      if (current(generation)) show(result, generation);
    } catch (cause) {
      if (current(generation)) {
        clearView();
        error(cause.message);
        status("Check stopped. Your original transaction ID is retained.");
      }
    } finally {
      if (current(generation)) lock(false);
    }
  };
  const connect = async (event) => {
    event.preventDefault();
    if (busy || !alive || scope) return;
    const hash = $("[name=transaction]").value.trim();
    if (!validHash(hash)) {
      error("Enter the complete original transaction ID.");
      return;
    }
    const generation = ++epoch;
    lock(true);
    error("");
    const assertCurrent = () => {
      if (!current(generation)) throw Error("Wallet recovery context changed.");
    };
    try {
      const p = provider();
      if (!p?.request)
        throw Error("Open this page with your browser wallet available.");
      listen(p);
      await request("/api/session", {}, "DELETE");
      assertCurrent();
      status("Choose the wallet that created this transaction.");
      const accounts = await p.request({ method: "eth_requestAccounts" });
      assertCurrent();
      if (!validAddress(accounts?.[0]))
        throw Error("Select the original event wallet.");
      const chain = await p.request({ method: "eth_chainId" });
      assertCurrent();
      if (BigInt(chain) !== 1n)
        throw Error("Select Ethereum Mainnet to inspect this transaction.");
      const challenge = await request("/api/recovery/auth/challenge", {
        wallet: accounts[0],
        hash,
      });
      assertCurrent();
      if (
        challenge.purpose !== "factory-creation-recovery" ||
        challenge.chainId !== 1 ||
        typeof challenge.instanceId !== "string" ||
        !challenge.instanceId ||
        typeof challenge.message !== "string" ||
        !challenge.message.includes(`URI: ${location.origin}\n`) ||
        !challenge.message.includes(
          `Original transaction: ${hash.toLowerCase()}\n`,
        ) ||
        !challenge.message.includes(
          "Purpose: Read only; no financial authority\n",
        )
      )
        throw Error(
          "The recovery sign-in message has a different purpose or origin.",
        );
      status(
        "Sign the read-only recovery message in your wallet. No transaction is requested.",
      );
      const hex =
        "0x" +
        [...new TextEncoder().encode(challenge.message)]
          .map((x) => x.toString(16).padStart(2, "0"))
          .join("");
      const signature = await p.request({
        method: "personal_sign",
        params: [hex, accounts[0]],
      });
      assertCurrent();
      const ack = await request("/api/recovery/auth/verify", {
        nonce: challenge.nonce,
        signature,
      });
      assertCurrent();
      if (
        ack.mode !== "recovery-only" ||
        ack.instanceId !== challenge.instanceId ||
        !same(ack.wallet, accounts[0]) ||
        !same(ack.hash, hash) ||
        !ack.capabilities ||
        Object.values(ack.capabilities).some((v) => v !== false)
      )
        throw Error(
          "The read-only session was not acknowledged for this wallet and transaction.",
        );
      scope = Object.freeze({
        wallet: ack.wallet,
        hash: hash.toLowerCase(),
        instanceId: ack.instanceId,
      });
      $("[data-recovery-check]").hidden = false;
      $("[data-recovery-signout]").hidden = false;
      status(
        "Read-only ownership verified. Checking the original transaction…",
      );
      const result = await request("/api/recovery/original-creation");
      assertCurrent();
      show(result, generation);
    } catch (cause) {
      if (current(generation)) {
        error(
          cause.code === 4001
            ? "Read-only sign-in was cancelled."
            : cause.message,
        );
        status(
          "No transaction was sent. Your original transaction ID is retained.",
        );
      }
    } finally {
      if (current(generation)) lock(false);
    }
  };
  const signout = async () => {
    if (busy || !alive) return;
    invalidate();
    error("");
    const generation = epoch;
    lock(true);
    try {
      await request("/api/session", {}, "DELETE");
      if (current(generation))
        status("Signed out. Your transaction ID is retained.");
    } catch {
      if (current(generation))
        error(
          "Sign-out could not be confirmed. Sign in again before inspecting another transaction.",
        );
    } finally {
      if (current(generation)) lock(false);
    }
  };
  const form = $("[data-recovery-form]");
  form.addEventListener("submit", connect);
  $("[data-recovery-check]").addEventListener("click", inspect);
  $("[data-recovery-signout]").addEventListener("click", signout);
  const initial = new URLSearchParams(location.hash.slice(1)).get(
    "transaction",
  );
  if (validHash(initial)) $("[name=transaction]").value = initial;
  return {
    dispose() {
      alive = false;
      epoch++;
      clearView();
      for (const c of controllers) c.abort();
      walletProvider?.removeListener?.("accountsChanged", invalidate);
      walletProvider?.removeListener?.("chainChanged", invalidate);
      form.removeEventListener("submit", connect);
      $("[data-recovery-check]").removeEventListener("click", inspect);
      $("[data-recovery-signout]").removeEventListener("click", signout);
    },
  };
}
const host =
  typeof document === "object"
    ? document.querySelector("[data-creation-recovery]")
    : null;
if (host) mountCreationRecovery(host);
