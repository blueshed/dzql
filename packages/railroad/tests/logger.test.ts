import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test";
import { createLogger, setLogLevel, getLogLevel, loggedRequest } from "../src/logger";

describe("logger", () => {
  let logSpy: ReturnType<typeof spyOn>;
  let warnSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    setLogLevel("info");
  });

  test("getLogLevel returns current level", () => {
    setLogLevel("debug");
    expect(getLogLevel()).toBe("debug");
    setLogLevel("warn");
    expect(getLogLevel()).toBe("warn");
  });

  test("info logs at info level", () => {
    setLogLevel("info");
    const log = createLogger("[test]");
    log.info("hello");
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain("[test]");
    expect(logSpy.mock.calls[0][0]).toContain("hello");
  });

  test("debug logs at debug level", () => {
    setLogLevel("debug");
    const log = createLogger("[test]");
    log.debug("detail");
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain("detail");
  });

  test("debug suppressed at info level", () => {
    setLogLevel("info");
    const log = createLogger("[test]");
    log.debug("hidden");
    expect(logSpy).not.toHaveBeenCalled();
  });

  test("warn logs at warn level", () => {
    setLogLevel("warn");
    const log = createLogger("[test]");
    log.warn("caution");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("caution");
  });

  test("warn suppressed at error level", () => {
    setLogLevel("error");
    const log = createLogger("[test]");
    log.warn("hidden");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("error logs at error level", () => {
    setLogLevel("error");
    const log = createLogger("[test]");
    log.error("fail");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain("fail");
  });

  test("silent suppresses everything", () => {
    setLogLevel("silent");
    const log = createLogger("[test]");
    log.debug("a");
    log.info("b");
    log.warn("c");
    log.error("d");
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test("an unknown level falls back to info instead of silencing everything", () => {
    // Simulates a typo'd LOG_LEVEL env value reaching setLogLevel.
    setLogLevel("verbose" as any);
    expect(getLogLevel()).toBe("info");
    const log = createLogger("[test]");
    log.info("still visible");
    log.error("errors still visible");
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  test("output includes timestamp and level", () => {
    setLogLevel("info");
    const log = createLogger("[srv]");
    log.info("started");
    const output = logSpy.mock.calls[0][0];
    expect(output).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}/);
    expect(output).toContain("INFO");
    expect(output).toContain("[srv]");
  });
});

describe("logger: LOG_LEVEL from the environment", () => {
  test("LOG_LEVEL=warn hides info and shows warn", () => {
    const script = `const { createLogger } = await import("../src/logger.ts");
      const log = createLogger("[t]"); log.info("info line"); log.warn("warn line");`;
    const run = Bun.spawnSync([process.execPath, "-e", script], {
      cwd: import.meta.dir,
      env: { ...process.env, LOG_LEVEL: "warn" },
    });
    expect(run.stdout.toString()).not.toContain("info line");
    expect(run.stderr.toString()).toContain("warn line");
  });
});

describe("loggedRequest", () => {
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    setLogLevel("info");
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    setLogLevel("info");
  });

  test("logs method, path, status, and timing", async () => {
    const handler = loggedRequest("[api]", () => new Response("ok", { status: 200 }));
    const res = await handler(new Request("http://localhost/hello"));
    expect(res.status).toBe(200);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const output = logSpy.mock.calls[0][0];
    expect(output).toContain("GET");
    expect(output).toContain("/hello");
    expect(output).toContain("200");
    expect(output).toMatch(/\d+\.\d+ms/);
  });

  test("logs error and rethrows", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const handler = loggedRequest("[api]", () => { throw new Error("boom"); });
    expect(handler(new Request("http://localhost/fail"))).rejects.toThrow("boom");
    await Bun.sleep(10);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const output = errorSpy.mock.calls[0]![0];
    expect(output).toContain("boom");
    expect(output).toContain("/fail");
    errorSpy.mockRestore();
  });

  // It took (req: Request) => Response and passed the handler the request alone, so a Bun
  // route's typed req.params was read back by a cast and its server argument was lost (#11).
  test("passes on every argument, and keeps the handler's types", async () => {
    type Routed = Request & { params: { id: string } };
    type Server = { upgrade(req: Request): boolean };
    const server: Server = { upgrade: () => false };
    const handler = loggedRequest("[api]", (req: Routed, s: Server) =>
      Response.json({ id: req.params.id, upgraded: s.upgrade(req) }));
    const req = Object.assign(new Request("http://localhost/api/jobs/7"), { params: { id: "7" } });
    expect(await (await handler(req, server)).json()).toEqual({ id: "7", upgraded: false });
    // the wrapper takes what the handler takes: a request with params (checked, never run)
    // @ts-expect-error -- a plain Request has no params
    const _untyped = () => handler(new Request("http://localhost/api/jobs/7"), server);
    // A handler of a plain Request still wraps as it did
    const plain: (req: Request) => Promise<Response> = loggedRequest("[api]", () => new Response("ok"));
    expect((await plain(new Request("http://localhost/x"))).status).toBe(200);
  });
});

describe("logger: color", () => {
  test("does not emit ANSI escapes when stdout is not a TTY", () => {
    // bun test runs piped (non-TTY); colors must be suppressed so piped logs and
    // log files stay clean. Skip if running in an interactive terminal.
    if ((process as any).stdout?.isTTY) return;
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    setLogLevel("info");
    createLogger("[t]").info("plain");
    expect(String(logSpy.mock.calls[0]![0])).not.toContain("\x1b[");
    logSpy.mockRestore();
    setLogLevel("info");
  });
});
