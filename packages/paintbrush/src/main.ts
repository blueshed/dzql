import { rmSync } from "node:fs";
import { startServer } from "./server";

// Project root; tests point this elsewhere
const PID_FILE = process.env.PID_FILE ?? `${import.meta.dir}/../.server.pid`;

function isAlive(pid: number) {
  if (!(pid > 0)) return false; // empty/garbage file: kill(0) would hit our process group
  try {
    process.kill(pid, 0); // signal 0 = existence check only
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"; // exists, not ours
  }
}

// Refuse to start over a live server. Under `bun --hot` this module re-runs
// in the same process, so our own pid is not a conflict.
const pidFile = Bun.file(PID_FILE);
if (await pidFile.exists()) {
  const pid = Number(await pidFile.text());
  if (pid !== process.pid && isAlive(pid)) {
    console.error(`Already running (pid ${pid}). Run: bun run stop`);
    process.exit(1);
  }
}

// Signal handlers are registered once; each hot reload swaps in a fresh
// shutdown function that closes over the current server.
declare global {
  var __shutdown: (() => Promise<void>) | undefined;
  var __close: (() => Promise<void>) | undefined;
}
const firstRun = !globalThis.__shutdown;

// Under `bun --hot` this module runs again and Bun.serve gives the same server
// the new routes; what the last run's resources opened (a database) is closed
// first, so this run can open it again.
await globalThis.__close?.();
const server = await startServer();
globalThis.__close = server.close;
await Bun.write(PID_FILE, String(process.pid));

globalThis.__shutdown = async () => {
  // Graceful stop waits for in-flight requests; open websockets (including
  // the HMR socket in dev) could hold it forever, so cap the wait.
  await Promise.race([server.stop(), Bun.sleep(5_000)]);
  await server.close(); // what stop had not got to, if the wait ran out
  process.exit(0);
};

if (firstRun) {
  process.on("SIGINT", () => globalThis.__shutdown!());
  process.on("SIGTERM", () => globalThis.__shutdown!());
  // Runs on every exit path, including crashes. Must be synchronous,
  // which is why this uses node:fs rather than Bun.file().delete().
  process.on("exit", () => rmSync(PID_FILE, { force: true }));
}

// Last, so a signal sent as soon as this appears finds the handlers in place
console.log(`Listening on ${server.url}`);
