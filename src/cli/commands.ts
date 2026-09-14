import { readFileSync, writeFileSync } from "node:fs";
import type { PatchOp } from "../json-patch";

export type Command =
  | { kind: "write"; doc: string; ops: PatchOp[] }
  | { kind: "inspect" }
  | { kind: "watch" };

/**
 * An example's own short verbs (e.g. chat's `name`, `room`, `send`), mapping
 * a command's remaining argv to the wire write it means. Loaded dynamically
 * by src/cli.ts from that example's own cli.ts (see ETA_EXAMPLE) when that file exists -- the
 * kernel itself knows only the doc-agnostic commands below.
 */
export type Aliases = Record<string, (args: string[]) => { doc: string; ops: PatchOp[] }>;

const OPS = new Set<PatchOp["op"]>(["add", "replace", "remove"]);

function isPatchOpKind(value: string): value is PatchOp["op"] {
  return OPS.has(value as PatchOp["op"]);
}

/** `write <doc> <op> <path> [value]` -- a write names a document and a JSON Pointer path, never a function name, same as the wire protocol itself. */
function parseWrite(rest: string[]): Command | undefined {
  const [doc, op, path, ...valueParts] = rest;
  if (!doc || !op || !path || !isPatchOpKind(op)) return undefined;
  const value = valueParts.length > 0 ? valueParts.join(" ") : undefined;
  const ops: PatchOp[] = value !== undefined ? [{ op, path, value }] : [{ op, path }];
  return { kind: "write", doc, ops };
}

// The one write every example shares, since it's not a domain concern: undo
// is a remove on the ledger's own cursor document (see concepts/ledger.ts),
// not a per-example verb.
const undo = (): Command => ({ kind: "write", doc: "ledger", ops: [{ op: "remove", path: "/latest" }] });

/** Maps a CLI invocation's argv (after the script name) to a wire command. */
export function parseCommand(argv: string[], aliases: Aliases = {}): Command | undefined {
  const [name, ...rest] = argv;
  if (name === "inspect") return { kind: "inspect" };
  if (name === "watch") return { kind: "watch" };
  if (name === "undo") return undo();
  if (name === "write") return parseWrite(rest);
  if (name && name in aliases) {
    const { doc, ops } = aliases[name]!(rest);
    return { kind: "write", doc, ops };
  }
  return undefined;
}

export const DEFAULT_SESSION_FILE = ".eta-session";

/**
 * Pulls a `--session <file>` (or `--session=<file>`) flag out of argv,
 * wherever it appears, so separate invocations can act as separate people --
 * e.g. `watch` as one identity in one terminal, commands as another elsewhere.
 */
export function extractSessionFile(argv: string[]): { sessionFile: string; rest: string[] } {
  const rest: string[] = [];
  let sessionFile = DEFAULT_SESSION_FILE;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--session") sessionFile = argv[++i] ?? sessionFile;
    else if (arg.startsWith("--session=")) sessionFile = arg.slice("--session=".length);
    else rest.push(arg);
  }

  return { sessionFile, rest };
}

function opText(op: PatchOp): string {
  return op.value !== undefined ? `${op.op} ${op.path} ${JSON.stringify(op.value)}` : `${op.op} ${op.path}`;
}

export type Inspection = {
  docs: { doc: string; version: number; head?: { ops: PatchOp[] } }[];
};

/** Renders an inspect response as the CLI's plain-text output -- ops, not HTML, and generic over whatever docs this example's concepts report. */
export function formatInspection(inspection: Inspection): string {
  return inspection.docs
    .map((doc) => {
      const last = doc.head ? `  last: ${doc.head.ops.map(opText).join(", ")}` : "";
      return `${doc.doc.padEnd(8)} v${doc.version}${last}`;
    })
    .join("\n");
}

/** Reuses a session id saved at `file` across invocations, minting one on first use -- a cookie jar of one. */
export function loadOrCreateSessionCookie(file: string): string {
  try {
    return `session_id=${readFileSync(file, "utf8").trim()}`;
  } catch {
    const id = crypto.randomUUID();
    writeFileSync(file, id);
    return `session_id=${id}`;
  }
}

export function connectCli(url: string, cookie: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    // tsconfig's DOM lib doesn't know about Bun's runtime-only `headers` option.
    // @ts-expect-error
    const ws: WebSocket = new WebSocket(url, { headers: { Cookie: cookie } });
    ws.addEventListener("open", () => resolve(ws), { once: true });
    ws.addEventListener("error", () => reject(new Error(`could not connect to ${url}`)), { once: true });
  });
}

/** Sends a command (if it writes) followed by an inspect request, and resolves with that inspection. */
export function runCommand(ws: WebSocket, command: Command): Promise<Inspection> {
  return new Promise((resolve) => {
    ws.addEventListener("message", function onMessage(event) {
      const message = JSON.parse(String(event.data));
      if (message.type !== "inspect") return;
      ws.removeEventListener("message", onMessage);
      resolve(message);
    });

    if (command.kind === "write") ws.send(JSON.stringify({ doc: command.doc, ops: command.ops }));
    ws.send(JSON.stringify({ type: "inspect" }));
  });
}

/** Streams every patch this connection sees to `onPatch`, until the socket closes. */
export function watch(ws: WebSocket, onPatch: (line: string) => void): void {
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.type === "patch") onPatch(`${message.doc} v${message.version}  ${message.ops.map(opText).join(", ")}`);
  });
}
