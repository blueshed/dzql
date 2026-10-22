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
import { running } from "./file";

/** What an app is to the server: its routes and resources, never a server of its own. */
export interface App<R extends string = string> {
  /** The app's routes, as Bun.serve takes them (typed params, a handler per method): its page ("/"), its HTTP resources. A route of its own on "/ws" wins over delta's. */
  routes: Bun.Serve.RoutesWithUpgrade<any, R>;
  /** delta's socket (`createWs()`): served on its path, and told the server so a change reaches every page. */
  ws?: WsServer;
  /** A socket of the app's own instead (Bun's handler), its upgrade one of `routes`. */
  websocket?: Bun.WebSocketHandler<any>;
  /** What the resources opened (a database, a listener), closed in this order once the server stops. */
  close?: (() => void | Promise<void>)[];
  /**
   * Whether the app can serve: its store answers (a `SELECT 1` on its pool, say). `/health` answers
   * 200 `ok` while it says true, 503 `unhealthy` when it says false or throws, and 503 `draining`
   * once the server is stopping. Without it, `/health` is ok while the server serves.
   */
  health?: HealthCheck;
  /**
   * Resolves once what the app has set going is done -- work its own socket handler queued, which
   * `serve` cannot see. A graceful stop waits for it (after the requests and socket messages in
   * flight), before closing the sockets.
   */
  idle?: () => Promise<void>;
}

/** An app's health check (`App.health`): true while it can serve. */
export type HealthCheck = () => boolean | Promise<boolean>;

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
  /**
   * Stop serving, then close what the resources opened. Gracefully (no `force`): no new
   * connection is taken; once the requests and socket messages in flight are answered and the
   * app is idle (`App.idle`), each socket is closed going away (1001) and what is left (an idle
   * connection, HMR's socket) dropped. An idle socket holds nothing up. `force` drops every
   * connection at once, as Bun's `stop(true)` does.
   */
  stop(force?: boolean): Promise<void>;
}

/** Serves `app`: its routes, delta's socket on its path, `/health` for a platform's check (the app's `health`, 503 while stopping), and 404 for the rest. */
export function serve<R extends string>(app: App<R>, { port = Number(process.env.PORT ?? 3000), dev = process.env.NODE_ENV !== "production" }: ServeOptions = {}): Served {
  const { ws } = app;
  let draining = false;
  // What a graceful stop waits for besides the requests Bun counts: each socket's message being
  // handled; and the sockets open, closed once nothing is.
  const handling = new Set<Promise<unknown>>();
  const sockets = new Set<Bun.ServerWebSocket<any>>();
  const handler = (app.websocket ?? ws?.websocket) as Bun.WebSocketHandler<any> | undefined;
  const websocket: Bun.WebSocketHandler<any> | undefined = handler && {
    ...handler,
    open(socket) {
      sockets.add(socket);
      return handler.open?.(socket);
    },
    message(socket, message) {
      const handled = handler.message(socket, message) as unknown;
      if (handled instanceof Promise) {
        handling.add(handled);
        void handled.finally(() => handling.delete(handled)).catch(() => {});
      }
      return handled as void;
    },
    close(socket, code, reason) {
      sockets.delete(socket);
      return handler.close?.(socket, code, reason);
    },
  };
  const unwell = (why: "unhealthy" | "draining") => new Response(why, { status: 503 });
  const health = async () => {
    if (draining) return unwell("draining");
    let ok: boolean;
    try {
      ok = app.health ? await app.health() : true;
    } catch {
      ok = false;
    }
    if (draining) return unwell("draining");
    return ok ? new Response("ok") : unwell("unhealthy");
  };
  const server = Bun.serve({
    port,
    development: dev && { hmr: true, console: true },
    routes: {
      "/health": health,
      ...(ws ? { [ws.path]: ws.upgrade } : {}),
      ...app.routes,
    } as Record<string, any>,
    websocket: websocket as Bun.WebSocketHandler<any>,
    fetch: () => new Response("Not found", { status: 404 }),
  });
  ws?.setServer(server);
  const closing = [...(app.close ?? [])];
  const close = async () => {
    for (const done of closing.splice(0)) await done();
  };
  /** Until nothing is in flight: no request being answered, no socket message being handled, the app idle. */
  const settled = async () => {
    for (;;) {
      if (handling.size) await Promise.allSettled([...handling]);
      else if (server.pendingRequests > 0) await Bun.sleep(10);
      else {
        await app.idle?.();
        if (!handling.size && server.pendingRequests === 0) return;
      }
    }
  };
  return {
    url: server.url,
    port: server.port!,
    server,
    close,
    async stop(force?: boolean) {
      draining = true;
      if (!force) {
        const stopping = server.stop();   // no new connection; Bun's own wait never ends while a socket is open
        void stopping.catch(() => {});
        await settled();
        for (const socket of sockets) socket.close(1001, "server stopping");
        for (let i = 0; sockets.size && i < 100; i++) await Bun.sleep(10);   // their close handshake, briefly
      }
      await server.stop(true);   // what is left: an idle connection, HMR's socket
      await close();
    },
  };
}

/** What `run` needs of a server: where it is, how it stops, and what to close (a `Served`, or a Bun server). */
export type Runnable = { url: URL; stop(force?: boolean): Promise<void> | void; close?(): Promise<void> };

/** Where the pid file is: `$PID_FILE`, else `.server.pid` where the command runs. */
export const pidFile = (): string => process.env.PID_FILE ?? `${process.cwd()}/.server.pid`;

/** A pid file's process, still running: an empty or garbage file names none (kill(0) would hit our process group). */
const isAlive = (pid: number): boolean => pid > 0 && running(pid);

declare global {
  var __deltaShutdown: (() => Promise<void>) | undefined;
  var __deltaClose: (() => Promise<void>) | undefined;
}

/**
 * The process around a server: refuses to start over a live one (the pid file), serves what
 * `start` gives, and stops on SIGINT or SIGTERM as soon as what is in flight is done (a `Served`'s
 * graceful `stop`: an idle socket holds nothing up), five seconds at most, then closing what the
 * resources opened. Under `bun --hot` the entry runs again in the
 * same process: what the last run opened is closed first, so this run can open it again.
 */
export async function run<S extends Runnable>(start: () => S | Promise<S>, { file = pidFile() }: { file?: string } = {}): Promise<S> {
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
  globalThis.__deltaClose = () => served.close?.() ?? Promise.resolve();
  await Bun.write(file, String(process.pid));

  globalThis.__deltaShutdown = async () => {
    // a graceful stop waits for what is in flight, and no longer; the grace is its upper bound (a
    // request that never ends, an app never idle, a Bun server's own stop held by an open socket)
    await Promise.race([served.stop(), Bun.sleep(5_000)]);
    // what stop had not got to, if the wait ran out; a close that hangs never keeps the process
    await Promise.race([served.close?.(), Bun.sleep(2_000)]);
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

/** Stops the server the pid file names (`delta stop`): what it did, as a line. `grace`: how long it is given to stop when asked before it is killed. */
export async function stop(file = pidFile(), { grace = 10_000 } = {}): Promise<string> {
  const f = Bun.file(file);
  if (!(await f.exists())) return "not running";
  const pid = Number(await f.text());
  try {
    if (!(pid > 0)) throw new Error("no pid");
    process.kill(pid, "SIGTERM");
    // gone when it says so: a server waits at most seven seconds on itself, inside the grace; one still there is killed
    for (const end = Date.now() + grace; Date.now() < end; await Bun.sleep(100)) if (!isAlive(pid)) return `stopped ${pid}`;
    process.kill(pid, "SIGKILL");
    await f.delete();
    return `killed ${pid}: it did not stop when asked`;
  } catch {
    await f.delete();
    return "removed stale pid file";
  }
}
