import { existsSync } from "node:fs";
import {
  connectCli,
  extractLimit,
  extractSessionFile,
  formatHistory,
  formatInspection,
  loadOrCreateSessionCookie,
  parseCommand,
  runCommand,
  watch,
  type Aliases,
} from "./cli/commands";

const exampleName = process.env.ETA_EXAMPLE ?? "chat";
const aliasFile = `${import.meta.dir}/../examples/${exampleName}/cli.ts`;
// The kernel knows only doc-agnostic commands (inspect/watch/undo/write); an
// example's own short verbs (chat's `name`, `room`, ...) live in its own
// cli.ts and are loaded here only if that file exists -- a from-scratch
// example doesn't have to write one.
const aliases: Aliases = existsSync(aliasFile) ? (await import(aliasFile)).aliases : {};

const { sessionFile, rest: afterSession } = extractSessionFile(process.argv.slice(2));
const { limit, rest } = extractLimit(afterSession);
const command = parseCommand(rest, aliases);
if (!command) {
  const commands = ["inspect", "watch", "undo", "redo", "write <doc> <op> <path> [value]", ...Object.keys(aliases)];
  console.error(`Usage: eta <${commands.join("|")}> [--session <file>] [--limit <n>]`);
  process.exit(1);
}

const url = `${(process.env.ETA_URL ?? "ws://localhost:3000").replace(/\/+$/, "")}/ws`;
const cookie = loadOrCreateSessionCookie(sessionFile);
const ws = await connectCli(url, cookie);

if (command.kind === "watch") {
  // Catches up on each doc's recent history before following live patches, so joining a watch
  // late doesn't mean starting blind -- `--limit` (default: just the latest) says how far back.
  const inspection = await runCommand(ws, { kind: "inspect" }, limit);
  for (const doc of inspection.docs) for (const line of formatHistory(doc)) console.log(line);
  console.log(`watching ${url} as ${sessionFile} (ctrl-c to stop)`);
  watch(ws, (line) => console.log(line));
} else {
  console.log(formatInspection(await runCommand(ws, command, limit)));
  ws.close();
}
