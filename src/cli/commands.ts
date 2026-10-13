import { readFileSync, writeFileSync } from "node:fs";
import { isVerb, type PatchOp } from "../json-patch";

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

/** `write <doc> <op> <path> [value]` -- a write names a document and a JSON Pointer path, never a function name, same as the wire protocol itself. */
function parseWrite(rest: string[]): Command | undefined {
  const [doc, op, path, ...valueParts] = rest;
  if (!doc || !op || !path || !isVerb(op)) return undefined;
  const value = valueParts.length > 0 ? valueParts.join(" ") : undefined;
  const ops: PatchOp[] = value !== undefined ? [{ op, path, value }] : [{ op, path }];
  return { kind: "write", doc, ops };
}

// The one write every example shares, since it's not a domain concern: undo
// is a remove on the ledger's own cursor document (see compartments/ledger.ts),
// not a per-example verb.
const undo = (): Command => ({ kind: "write", doc: "ledger", ops: [{ op: "remove", path: "/latest" }] });
const redo = (): Command => ({ kind: "write", doc: "ledger", ops: [{ op: "add", path: "/latest" }] });

/** Maps a CLI invocation's argv (after the script name) to a wire command. */
export function parseCommand(argv: string[], aliases: Aliases = {}): Command | undefined {
  const [name, ...rest] = argv;
  if (name === "inspect") return { kind: "inspect" };
  if (name === "watch") return { kind: "watch" };
  if (name === "undo") return undo();
  if (name === "redo") return redo();
  if (name === "write") return parseWrite(rest);
  if (name && name in aliases) {
    const { doc, ops } = aliases[name]!(rest);
    return { kind: "write", doc, ops };
  }
  return undefined;
}

export const DEFAULT_SESSION_FILE = ".eta-session";

/**
 * Pulls a `--<name> <value>` (or `--<name>=<value>`) flag out of argv, wherever it appears: its
 * last value, and the argv without it. `--session <file>` lets separate invocations act as separate
 * people; `--limit <n>` is how many ledger entries per doc `inspect` reports, or `watch` catches up on.
 */
export function extractFlag(argv: string[], flag: string): { value: string | undefined; rest: string[] } {
  const rest: string[] = [];
  let value: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === flag) value = argv[++i] ?? value;
    else if (arg.startsWith(`${flag}=`)) value = arg.slice(flag.length + 1);
    else rest.push(arg);
  }

  return { value, rest };
}

/** `--session <file>`, defaulting to the shared session file. */
export function extractSessionFile(argv: string[]): { sessionFile: string; rest: string[] } {
  const { value, rest } = extractFlag(argv, "--session");
  return { sessionFile: value ?? DEFAULT_SESSION_FILE, rest };
}

function opText(op: PatchOp): string {
  return op.value !== undefined ? `${op.op} ${op.path} ${JSON.stringify(op.value)}` : `${op.op} ${op.path}`;
}

export type Inspection = {
  docs: { doc: string; version: number; entries?: { ops: PatchOp[] }[] }[];
  /** The command's write was refused, and why when the refusal says. */
  refused?: { reason?: string };
};

/** Renders an inspect response as the CLI's plain-text output -- ops, not HTML, and generic over whatever docs this example's compartments report. Only the most recent entry shows on this line; `formatHistory` lists the rest. */
export function formatInspection(inspection: Inspection): string {
  return inspection.docs
    .map((doc) => {
      const head = doc.entries?.[0];
      const last = head ? `  last: ${head.ops.map(opText).join(", ")}` : "";
      return `${doc.doc.padEnd(8)} v${doc.version}${last}`;
    })
    .join("\n");
}

/** One doc's entries, oldest first, one line each -- what a `watch` catching up prints before it starts following live patches. */
export function formatHistory(doc: { doc: string; entries?: { ops: PatchOp[] }[] }): string[] {
  return [...(doc.entries ?? [])].reverse().map((entry) => `${doc.doc}  ${entry.ops.map(opText).join(", ")}`);
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

/**
 * Signs in as a browser does, by posting the app's sign-in form (`/login`, from the app's own
 * page) to the server `url` names (its `ws:` as `http:`): the session the answer's cookie names, to
 * keep in the session file; none when the form was refused. So the CLI is a person of the app, as a
 * page is, and no password crosses the socket.
 */
export async function signIn(url: string, form: Record<string, string>): Promise<string | undefined> {
  const at = new URL("/login", url.replace(/^ws/, "http"));
  const res = await fetch(at, { method: "POST", body: new URLSearchParams(form), redirect: "manual", headers: { origin: at.origin } });
  return /session_id=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1];
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

/** The id the CLI's one write goes with, so its refusal, if it is refused, is told by it. */
const WRITE_ID = 1;

/**
 * Sends a command (if it writes) followed by an inspect request, and resolves with that inspection
 * -- and, when the write was refused, that it was and why when the refusal says: the server
 * answers a refused write by its id before the inspect. `limit` asks for that many ledger entries
 * per doc instead of just the latest.
 */
export function runCommand(ws: WebSocket, command: Command, limit?: number): Promise<Inspection> {
  return new Promise((resolve) => {
    let refused: Inspection["refused"];
    ws.addEventListener("message", function onMessage(event) {
      const message = JSON.parse(String(event.data));
      if (message.type === "refused" && message.id === WRITE_ID) refused = message.reason === undefined ? {} : { reason: message.reason };
      if (message.type !== "inspect") return;
      ws.removeEventListener("message", onMessage);
      resolve(refused ? { ...message, refused } : message);
    });

    if (command.kind === "write") ws.send(JSON.stringify({ id: WRITE_ID, doc: command.doc, ops: command.ops }));
    ws.send(JSON.stringify({ type: "inspect", limit }));
  });
}

/** Streams every patch this connection sees to `onPatch`, until the socket closes. */
export function watch(ws: WebSocket, onPatch: (line: string) => void): void {
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.type === "patch") onPatch(`${message.doc} v${message.version}  ${message.ops.map(opText).join(", ")}`);
  });
}
