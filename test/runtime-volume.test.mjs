// Pure injected adapters: no real mount, chown, root, application or network access.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { prepareRuntimeVolume } from "../src/runtime-volume.mjs";

function fixture(mode = "hosted-production") {
  const calls = [];
  let uid = 0,
    gid = 0,
    groups = [0];
  const env = {
    MODE: mode,
    RAILWAY_VOLUME_MOUNT_PATH: "/data",
    [mode === "hosted-production"
      ? "MAINNET_STATE_FILE"
      : "TESTNET_STATE_FILE"]: "/data/workbench-state.json",
  };
  const filesystem = {
    lstatSync: (name) => {
      calls.push(["lstat", name]);
      return { isDirectory: () => true, isSymbolicLink: () => false };
    },
    chownSync: (...args) => calls.push(["chown", ...args]),
    chmodSync: (...args) => calls.push(["chmod", ...args]),
  };
  const runtime = {
    env,
    getuid: () => uid,
    getgid: () => gid,
    getgroups: () => groups,
    setgroups: (value) => {
      calls.push(["setgroups", value]);
      groups = value;
    },
    setgid: (value) => {
      calls.push(["setgid", value]);
      gid = value;
    },
    setuid: (value) => {
      calls.push(["setuid", value]);
      uid = value;
    },
  };
  return { filesystem, runtime, calls };
}
const invalid = (error) => error.code === "RUNTIME_VOLUME_INVALID";

test("production and Chiado bootstrap only the fixed mount, then drop all root credentials in order", () => {
  for (const mode of ["hosted-production", "hosted-testnet"]) {
    const f = fixture(mode),
      result = prepareRuntimeVolume(f);
    assert.deepEqual(f.calls, [
      ["lstat", "/data"],
      ["chown", "/data", 1000, 1000],
      ["chmod", "/data", 0o700],
      ["setgroups", []],
      ["setgid", 1000],
      ["setuid", 1000],
    ]);
    assert.equal(result.uid, 1000);
    assert.equal(result.mode, mode);
    assert.equal(result.durableTestnetState, mode === "hosted-testnet");
    assert.equal(
      result.durableStateEnvironment,
      mode === "hosted-production" ? "ethereum-mainnet" : "chiado-testnet",
    );
  }
});

test("mixed namespaces, wrong modes and any nonliteral mount/state path reject before mutation", () => {
  for (const mutate of [
    (e) => (e.TESTNET_MANIFEST = "/not/mainnet.json"),
    (e) => (e.TESTNET_RPC_URL = "https://example.invalid"),
    (e) => (e.MODE = "hosted-demo"),
    (e) => (e.MODE = "local-demo"),
    (e) => (e.MODE = "hosted-testnet"),
    (e) => (e.RAILWAY_VOLUME_MOUNT_PATH = "/"),
    (e) => (e.RAILWAY_VOLUME_MOUNT_PATH = "/data/"),
    (e) => (e.RAILWAY_VOLUME_MOUNT_PATH = "/data/../data"),
    (e) => (e.MAINNET_STATE_FILE = "/workbench-state.json"),
    (e) => (e.MAINNET_STATE_FILE = "/data/../workbench-state.json"),
    (e) => (e.MAINNET_STATE_FILE = "/data/nested/workbench-state.json"),
    (e) => delete e.MAINNET_STATE_FILE,
  ]) {
    const f = fixture();
    mutate(f.runtime.env);
    assert.throws(() => prepareRuntimeVolume(f), invalid);
    assert.deepEqual(f.calls, []);
  }
});

test("symlink, missing and non-directory mounts fail before ownership or privilege changes", () => {
  for (const kind of ["symlink", "missing", "file"]) {
    const f = fixture();
    f.filesystem.lstatSync = (name) => {
      f.calls.push(["lstat", name]);
      if (kind === "missing") throw Error("private local path diagnostics");
      return {
        isDirectory: () => kind !== "file",
        isSymbolicLink: () => kind === "symlink",
      };
    };
    assert.throws(
      () => prepareRuntimeVolume(f),
      (error) => invalid(error) && !error.message.includes("private"),
    );
    assert.deepEqual(f.calls, [["lstat", "/data"]]);
  }
});

test("incomplete credential drop fails closed and cannot reach application loading", () => {
  for (const method of ["setgroups", "setgid", "setuid"]) {
    const f = fixture();
    f.runtime[method] = () => {};
    assert.throws(() => prepareRuntimeVolume(f), invalid);
  }
  const f = fixture();
  f.runtime.setgroups = () => {
    throw Error("simulated OS refusal");
  };
  assert.throws(() => prepareRuntimeVolume(f), /OS refusal/);
  assert.equal(
    f.calls.some(([kind]) => kind === "setuid"),
    false,
  );
});

test("Node effective gid reporting is accepted while any retained foreign group is rejected", () => {
  const f = fixture();
  f.runtime.getgroups = () => [f.runtime.getgid()];
  assert.equal(prepareRuntimeVolume(f).uid, 1000);
  const unsafe = fixture();
  unsafe.runtime.getgroups = () => [1000, 20];
  assert.throws(() => prepareRuntimeVolume(unsafe), invalid);
});

test("nonroot startup never touches mount ownership, and diagnostics preserve environment separation", () => {
  for (const mode of [
    "hosted-production",
    "hosted-testnet",
    "local-demo",
    "hosted-demo",
  ]) {
    const f = fixture(mode);
    f.runtime.getuid = () => 1000;
    if (["local-demo", "hosted-demo"].includes(mode))
      delete f.runtime.env.TESTNET_STATE_FILE;
    const result = prepareRuntimeVolume(f);
    assert.deepEqual(f.calls, []);
    assert.equal(result.uid, 1000);
    assert.equal(
      result.durableStateEnvironment,
      mode === "hosted-production"
        ? "ethereum-mainnet"
        : mode === "hosted-testnet"
          ? "chiado-testnet"
          : null,
    );
  }
  const f = fixture("hosted-testnet");
  f.runtime.getuid = () => 1000;
  f.runtime.env.MAINNET_MANIFEST = "/conflicting-production.json";
  assert.throws(() => prepareRuntimeVolume(f), invalid);
});

test("container prepares privileges before its dynamic server import and reports bound diagnostics", () => {
  const source = fs.readFileSync(
    new URL("../src/container.mjs", import.meta.url),
    "utf8",
  );
  assert.ok(
    source.indexOf("prepareRuntimeVolume()") <
      source.indexOf('await import("./server.mjs")'),
  );
  assert.ok(source.includes("...runtimeState"));
  assert.equal(source.includes("chownSync"), false);
});
