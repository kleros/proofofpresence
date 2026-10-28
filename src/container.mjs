import fs from "node:fs";

// Railway mounts volumes as root. Prepare only the fixed testnet mount, then
// drop all root credentials before loading application or network code.
if (process.getuid?.() === 0) {
  if (
    process.env.MODE !== "hosted-testnet" ||
    process.env.RAILWAY_VOLUME_MOUNT_PATH !== "/data" ||
    process.env.TESTNET_STATE_FILE !== "/data/workbench-state.json" ||
    !fs.lstatSync("/data").isDirectory() ||
    fs.lstatSync("/data").isSymbolicLink()
  ) {
    throw new Error(
      "Root startup requires the dedicated mounted testnet data directory",
    );
  }
  fs.chownSync("/data", 1000, 1000);
  fs.chmodSync("/data", 0o700);
  process.setgroups([]);
  process.setgid(1000);
  process.setuid(1000);
}
const { startServer } = await import("./server.mjs");
const app = await startServer();
console.log(
  JSON.stringify({
    status: "listening",
    mode: process.env.MODE ?? "local-demo",
    uid: process.getuid?.(),
    durableTestnetState: process.env.MODE === "hosted-testnet",
  }),
);
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    await app.close();
    process.exit(0);
  });
