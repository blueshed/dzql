/**
 * Logger — colored, timestamped, level-gated console output.
 *
 * Usage:
 *   import { createLogger, setLogLevel, loggedRequest } from "@blueshed/railroad";
 *
 *   const log = createLogger("[server]");
 *   log.info("listening on :3000");   // 12:34:56.789 INFO  [server] listening on :3000
 *   log.debug("tick");                // only shown when level is "debug"
 *   log.warn("slow query");           // yellow
 *   log.error("connection failed");   // red, always shown
 *
 *   setLogLevel("debug");             // show everything
 *
 *   const handler = loggedRequest("[api]", myHandler);  // wrap a route with access logging
 *
 * loggedRequest is generic over the handler's arguments, a Request first: what
 * the handler takes, the wrapper takes and passes on, so a Bun route keeps its
 * typed `req.params` and its server argument (with no Bun type named here).
 * The handler says its request's type (TypeScript infers it from the handler,
 * not from where the wrapper goes):
 *   loggedRequest("[api]", (req: BunRequest<"/api/jobs/:id">, server: Server) => …)
 */

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

const LEVELS: Record<LogLevel, number> = { silent: -1, error: 0, warn: 1, info: 2, debug: 3 };

// A typo'd LOG_LEVEL would otherwise make LEVELS[current] undefined and silence
// every log (including errors), so coerce unknown values back to "info".
function normalizeLevel(level: string | undefined | null): LogLevel {
  return level != null && level in LEVELS ? (level as LogLevel) : "info";
}

// Read env without depending on Bun's ambient global type. This file ships as
// .ts, so a consumer's tsc type-checks it directly — referencing `globalThis.Bun`
// would force every consumer to install @types/bun (TS7017 otherwise). The cast
// keeps it portable across Bun, Node, and the browser.
const env: Record<string, string | undefined> =
  (globalThis as { Bun?: { env?: Record<string, string | undefined> } }).Bun?.env ??
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ??
  {};

let current: LogLevel = normalizeLevel(env.LOG_LEVEL);

export function setLogLevel(level: LogLevel) {
  current = normalizeLevel(level);
}

export function getLogLevel(): LogLevel {
  return current;
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[current] >= LEVELS[level];
}

// === Colors ===

// Emit ANSI colors only to an interactive terminal. Respects NO_COLOR
// (https://no-color.org) and stays plain when piped, redirected to a file, or
// running in a browser — contexts where raw escape codes corrupt the output.
const colorEnabled: boolean = (() => {
  if (env.NO_COLOR != null && env.NO_COLOR !== "") return false;
  const stdout = (globalThis as { process?: { stdout?: { isTTY?: boolean } } })
    .process?.stdout;
  return stdout?.isTTY === true;
})();

const wrap = (code: string) => (s: string) =>
  colorEnabled ? `\x1b[${code}m${s}\x1b[0m` : s;
const gray = wrap("90");
const yellow = wrap("33");
const red = wrap("31");
const dim = wrap("2");

const color: Record<Exclude<LogLevel, "silent">, (s: string) => string> = {
  error: red,
  warn: yellow,
  info: gray,
  debug: dim,
};

function timestamp() {
  return new Date().toISOString().slice(11, 23);
}

function fmt(level: keyof typeof color, tag: string, msg: string) {
  return `${gray(timestamp())} ${color[level](level.toUpperCase().padEnd(5))} ${tag} ${msg}`;
}

/** Create a tagged logger instance. */
export function createLogger(tag: string) {
  return {
    info: (msg: string) => { if (shouldLog("info")) console.log(fmt("info", tag, msg)); },
    warn: (msg: string) => { if (shouldLog("warn")) console.warn(fmt("warn", tag, msg)); },
    error: (msg: string) => { if (shouldLog("error")) console.error(fmt("error", tag, msg)); },
    debug: (msg: string) => { if (shouldLog("debug")) console.log(fmt("debug", tag, msg)); },
  };
}

/** Wrap a route handler with access logging: the wrapper takes the handler's
 *  arguments (a Request first, then whatever else it is given, a server say)
 *  and passes them all on. */
export function loggedRequest<A extends [Request, ...unknown[]]>(
  tag: string,
  handler: (...args: A) => Response | Promise<Response>,
): (...args: A) => Promise<Response> {
  const log = createLogger(tag);
  return async (...args: A) => {
    const [req] = args;
    const start = performance.now();
    try {
      const res = await handler(...args);
      const ms = (performance.now() - start).toFixed(1);
      log.info(
        `${req.method} ${new URL(req.url).pathname} → ${res.status} (${ms}ms)`,
      );
      return res;
    } catch (err: unknown) {
      const ms = (performance.now() - start).toFixed(1);
      const msg = err instanceof Error ? err.message : String(err);
      log.error(
        `${req.method} ${new URL(req.url).pathname} threw (${ms}ms): ${msg}`,
      );
      throw err;
    }
  };
}
