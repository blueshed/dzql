import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWs } from "../src/server/server";
import { pidFile, serve, stop } from "../src/server/serve";

// The one server: an app's routes and resources, served; the process around them (`run`): the pid
// file, the signals, closing what the resources opened; and `stop`, the other side of the pid file.

const dir = mkdtempSync(join(tmpdir(), "delta-serve-"));
const file = join(dir, ".server.pid");
const entry = join(import.meta.dir, "helpers/serve-entry.ts");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function readUntil(proc: Bun.Subprocess<"ignore", "pipe", "pipe">, pattern: RegExp): Promise<RegExpMatchArray> {
  const reader = proc.stdout.getReader();
  let out = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`exited before saying ${pattern}:\n${out}`);
      out += new TextDecoder().decode(value);
      const match = out.match(pattern);
      if (match) return match;
    }
  } finally {
    reader.releaseLock();
  }
}

const start = (env: Record<string, string> = {}) =>
  Bun.spawn([process.execPath, entry], { cwd: dir, env: { ...process.env, PORT: "0", PID_FILE: file, ...env }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });

describe("serve", () => {
  test("serves the app's routes, delta's socket on its path, /health, and 404 for the rest", async () => {
    const ws = createWs();
    const served = serve({ ws, routes: { "/": new Response("home") } }, { port: 0, dev: false });
    try {
      expect(await (await fetch(served.url)).text()).toBe("home");
      expect(await (await fetch(new URL("/health", served.url))).text()).toBe("ok");
      expect((await fetch(new URL("/nope", served.url))).status).toBe(404);
      const socket = new WebSocket(new URL(ws.path, served.url.href.replace("http", "ws")));
      await new Promise((resolve, reject) => ((socket.onopen = resolve), (socket.onerror = reject)));
      socket.close();
    } finally {
      await served.stop(true);
    }
  });

  test("stop closes what the resources opened, in order, once", async () => {
    const closed: string[] = [];
    const served = serve({ routes: {}, close: [() => void closed.push("listener"), async () => void closed.push("pool")] }, { port: 0, dev: false });
    await served.stop(true);
    await served.close();
    expect(closed).toEqual(["listener", "pool"]);
  });

  test("an app's own route wins over delta's", async () => {
    const served = serve({ ws: createWs(), routes: { "/ws": new Response("mine"), "/health": new Response("busy") } }, { port: 0, dev: false });
    try {
      expect(await (await fetch(new URL("/ws", served.url))).text()).toBe("mine");
      expect(await (await fetch(new URL("/health", served.url))).text()).toBe("busy");
    } finally {
      await served.stop(true);
    }
  });
});

describe("run and stop", () => {
  test("the pid file is .server.pid where the command runs, unless PID_FILE says", () => {
    const { PID_FILE, ...rest } = process.env;
    process.env = rest;
    try {
      expect(pidFile()).toBe(`${process.cwd()}/.server.pid`);
    } finally {
      process.env.PID_FILE = PID_FILE;
      if (PID_FILE === undefined) delete process.env.PID_FILE;
    }
  });

  test("a second start is refused, stop stops the server, and the pid file goes with it", async () => {
    const proc = start();
    const url = (await readUntil(proc, /Listening on (\S+)/))[1]!;
    expect(await (await fetch(url)).text()).toBe("home");
    expect(Number(await Bun.file(file).text())).toBe(proc.pid);

    const second = start();
    expect(await second.exited).toBe(1);
    expect(await new Response(second.stderr).text()).toContain("Already running");

    expect(await stop(file)).toBe(`stopped ${proc.pid}`);
    expect(await proc.exited).toBe(0);
    expect(await Bun.file(file).exists()).toBe(false);
    expect(await stop(file)).toBe("not running");
  });

  test("an empty pid file doesn't block a start, and stop removes one", async () => {
    await Bun.write(file, "");
    const proc = start();
    await readUntil(proc, /Listening on/);
    proc.kill();
    await proc.exited;
    expect(await Bun.file(file).exists()).toBe(false); // removed on the way out

    await Bun.write(file, "");
    expect(await stop(file)).toBe("removed stale pid file");
  });

  test("`delta stop` is stop, at the command line", async () => {
    const proc = start();
    await readUntil(proc, /Listening on/);
    const cli = Bun.spawn([process.execPath, join(import.meta.dir, "../cli.ts"), "stop"], { cwd: dir, env: { ...process.env, PID_FILE: file }, stdout: "pipe" });
    expect((await new Response(cli.stdout).text()).trim()).toBe(`stopped ${proc.pid}`);
    expect(await proc.exited).toBe(0);
  });
});
