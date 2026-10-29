import fs from "node:fs";

const MOUNT = "/data";
const STATE = "/data/workbench-state.json";
const CONFIG_KEYS = ["MANIFEST", "STATE_FILE", "RPC_URL"];
const check = (ok, message) => {
  if (!ok)
    throw Object.assign(new Error(message), { code: "RUNTIME_VOLUME_INVALID" });
};

/** Fixed privileged mount bootstrap. Injected adapters are for isolated tests only. */
export function prepareRuntimeVolume({
  filesystem = fs,
  runtime = process,
} = {}) {
  const env = runtime.env;
  const mode = env.MODE ?? "local-demo";
  const production = mode === "hosted-production";
  const testnet = mode === "hosted-testnet";
  const configured = (prefix) =>
    CONFIG_KEYS.some((key) => env[`${prefix}_${key}`] !== undefined);
  check(
    !(configured("MAINNET") && configured("TESTNET")),
    "Production and testnet runtime configuration must be separate",
  );
  check(
    !configured("MAINNET") || production,
    "Mainnet runtime configuration requires hosted-production mode",
  );
  check(
    !configured("TESTNET") || testnet || mode === "testnet",
    "Testnet runtime configuration requires testnet mode",
  );
  if (runtime.getuid?.() === 0) {
    check(
      (production || testnet) &&
        env.RAILWAY_VOLUME_MOUNT_PATH === MOUNT &&
        env[production ? "MAINNET_STATE_FILE" : "TESTNET_STATE_FILE"] === STATE,
      "Root startup requires the dedicated fixed environment data mount",
    );
    let mount;
    try {
      mount = filesystem.lstatSync(MOUNT);
    } catch {
      check(false, "Dedicated runtime data mount is unavailable");
    }
    check(
      mount.isDirectory() && !mount.isSymbolicLink(),
      "Dedicated runtime data mount must be a regular directory",
    );
    // No recursive ownership changes, state-file rewrites or arbitrary path handling.
    filesystem.chownSync(MOUNT, 1000, 1000);
    filesystem.chmodSync(MOUNT, 0o700);
    runtime.setgroups([]);
    runtime.setgid(1000);
    runtime.setuid(1000);
    check(
      runtime.getuid() === 1000 &&
        runtime.getgid() === 1000 &&
        // Node may include the effective gid even after supplementary groups are empty.
        runtime.getgroups().every((group) => group === 1000),
      "Runtime privileges were not fully dropped",
    );
  }
  return {
    mode,
    uid: runtime.getuid?.(),
    durableTestnetState: testnet,
    durableStateEnvironment: production
      ? "ethereum-mainnet"
      : testnet
        ? "chiado-testnet"
        : null,
  };
}
