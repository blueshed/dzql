/**
 * The one server: an app gives its routes and what its resources opened, and this serves them,
 * with delta's socket on `/ws`. `serve` is the server (a test starts one on port 0); `run` is the
 * process around it: a pid file that refuses a second start, `bun --hot`, the signals that stop it,
 * and closing what the resources opened. `stop` is the other side of the pid file (`delta stop`).
 *
 *   // src/main.ts
 *   import { run, serve } from "@blueshed/delta/serve";
 *   import { app } from "./app";
 *   await run(async () => serve(await app()));
 */
import { rmSync } from "node:fs";
import type { WsServer } from "./server";

type Route = Bun.Serve.BaseRouteValue | ((req: Bun.BunRequest, server: Bun.Server<any>) => Response | undefined | Promise<Response | undefined>);

/** What an app is to the server: its routes and resources, never a server of its own. */
export interface App {
  /** The app's routes: its page ("/"), its HTTP resources. A route of its own on "/ws" wins over delta's. */
  routes: Record<string, Route>;
  /** delta's socket (`createWs()`): served on its path, and told the server so a change reaches every page. */
  ws?: WsServer;
  /** A socket of the app's own instead (Bun's handler), its upgrade one of `routes`. */
  websocket?: Bun.WebSocketHandler<any>;
  /** What the resources opened (a database, a listener), closed in this order once the server stops. */
  close?: (() => void | Promise<void>)[];
}

export interface ServeOptions {
  /** Default `$PORT`, else 3000; 0 for any free port. */
  port?: number;
  /** HMR and the browser's console in the terminal. Default: unless `NODE_ENV` is "production". */
  dev?: boolean;
}

/** A served app: where it is, and how it stops. */
export interface Served {
  url: URL;
  port: number;
  /** The Bun server, for what an app does beyond its routes (`server.publish`). */
  server: Bun.Server<any>;
  /** Close what the resources opened; once only (`bun --hot` serves again in the same process). */
  close(): Promise<void>;
  /** Stop serving (`force` drops open connections, as Bun's `stop` does), then close what the resources opened. */
  stop(force?: boolean): Promise<void>;
}

/** Serves `app`: its routes, delta's socket on its path, `/health` for a platform's check, and 404 for the rest. */
export function serve(app: App, { port = Number(process.env.PORT ?? 3000), dev = process.env.NODE_ENV !== "production" }: ServeOptions = {}): Served {
  const { ws } = app;
  const server = Bun.serve({
    port,
    development: dev && { hmr: true, console: true },
    routes: {
      "/health": new Response("ok"),
      ...(ws ? { [ws.path]: ws.upgrade } : {}),
      ...app.routes,
    } as Record<string, any>,
    websocket: (app.websocket ?? ws?.websocket) as Bun.WebSocketHandler<any>,
    fetch: () => new Response("Not found", { status: 404 }),
  });
  ws?.setServer(server);
  const closing = [...(app.close ?? [])];
  const close = async () => {
    for (const done of closing.splice(0)) await done();
  };
  return {
    url: server.url,
    port: server.port!,
    server,
    close,
    async stop(force?: boolean) {
      await server.stop(force);
      await close();
    },
  };
}

/** Where the pid file is: `$PID_FILE`, else `.server.pid` where the command runs. */
export const pidFile = (): string => process.env.PID_FILE ?? `${process.cwd()}/.server.pid`;

function isAlive(pid: number): boolean {
  if (!(pid > 0)) return false; // an empty or garbage file: kill(0) would hit our process group
  try {
    process.kill(pid, 0); // signal 0: does it exist
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"; // it exists, and is not ours
  }
}

declare global {
  var __deltaShutdown: (() => Promise<void>) | undefined;
  var __deltaClose: (() => Promise<void>) | undefined;
}

/**
 * The process around a server: refuses to start over a live one (the pid file), serves what
 * `start` gives, and stops on SIGINT or SIGTERM, waiting at most five seconds for what is in
 * flight, then closing what the resources opened. Under `bun --hot` the entry runs again in the
 * same process: what the last run opened is closed first, so this run can open it again.
 */
export async function run(start: () => Served | Promise<Served>, { file = pidFile() }: { file?: string } = {}): Promise<Served> {
  const pid = Bun.file(file);
  if (await pid.exists()) {
    const other = Number(await pid.text());
    if (other !== process.pid && isAlive(other)) {
      console.error(`Already running (pid ${other}). Run: bun run stop`);
      process.exit(1);
    }
  }
  const firstRun = !globalThis.__deltaShutdown;
  await globalThis.__deltaClose?.();
  const served = await start();
  globalThis.__deltaClose = served.close;
  await Bun.write(file, String(process.pid));

  globalThis.__deltaShutdown = async () => {
    // a graceful stop waits for what is in flight; an open socket (HMR's in dev) could hold it for ever
    await Promise.race([served.stop(), Bun.sleep(5_000)]);
    await served.close(); // what stop had not got to, if the wait ran out
    process.exit(0);
  };
  if (firstRun) {
    process.on("SIGINT", () => globalThis.__deltaShutdown!());
    process.on("SIGTERM", () => globalThis.__deltaShutdown!());
    // on every way out, a crash too; synchronous, so node:fs
    process.on("exit", () => rmSync(file, { force: true }));
  }
  // last, so a signal sent as soon as this appears finds the handlers in place
  console.log(`Listening on ${served.url}`);
  return served;
}

/** Stops the server the pid file names (`delta stop`): what it did, as a line. */
export async function stop(file = pidFile()): Promise<string> {
  const f = Bun.file(file);
  if (!(await f.exists())) return "not running";
  const pid = Number(await f.text());
  try {
    if (!(pid > 0)) throw new Error("no pid");
    process.kill(pid, "SIGTERM");
    return `stopped ${pid}`;
  } catch {
    await f.delete();
    return "removed stale pid file";
  }
}
