import { prepareRuntimeVolume } from "./runtime-volume.mjs";

// Railway mounts volumes as root. Prepare only the fixed environment mount, then
// drop all root credentials before loading application or network code.
const runtimeState = prepareRuntimeVolume();
const { startServer } = await import("./server.mjs");
const app = await startServer();
console.log(
  JSON.stringify({
    status: "listening",
    ...runtimeState,
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
