import { existsSync, writeFileSync } from "node:fs";
import {
  connectCli,
  extractFlag,
  extractSessionFile,
  formatHistory,
  formatInspection,
  loadOrCreateSessionCookie,
  parseCommand,
  runCommand,
  watch,
  type Aliases,
  signIn,
} from "./cli/commands";
import { appDir } from "./names";

const aliasFile = `${appDir(process.env.ETA_EXAMPLE)}/cli.ts`;
// The kernel knows only doc-agnostic commands (inspect/watch/undo/write); an
// example's own short verbs (chat's `name`, `room`, ...) live in its own
// cli.ts and are loaded here only if that file exists -- a from-scratch
// example doesn't have to write one.
const aliases: Aliases = existsSync(aliasFile) ? (await import(aliasFile)).aliases : {};

const { sessionFile, rest: afterSession } = extractSessionFile(process.argv.slice(2));
const { value: limitFlag, rest } = extractFlag(afterSession, "--limit");
const limit = Number(limitFlag) || undefined;
const url = `${(process.env.ETA_URL ?? "ws://localhost:3000").replace(/\/+$/, "")}/ws`;

// `login <email> <password>`: signs in by the app's own form, and keeps the session it is given
if (rest[0] === "login") {
  // a sign-in link (`dzql model` prints one for each keeper), or the email and password the form takes
  const link = rest[1]?.startsWith("http") ? await fetch(rest[1], { redirect: "manual" }) : undefined;
  const session = link ? /session_id=([^;]+)/.exec(link.headers.get("set-cookie") ?? "")?.[1] : await signIn(url, { email: rest[1] ?? "", password: rest[2] ?? "" });
  if (!session) {
    console.error("refused: that email and password do not match");
    process.exit(1);
  }
  writeFileSync(sessionFile, session);
  console.log(`signed in, as ${sessionFile}`);
  process.exit(0);
}

const command = parseCommand(rest, aliases);
if (!command) {
  const commands = ["login <email> <password>", "inspect", "watch", "undo", "redo", "write <doc> <op> <path> [value]", ...Object.keys(aliases)];
  console.error(`Usage: eta <${commands.join("|")}> [--session <file>] [--limit <n>]`);
  process.exit(1);
}

const cookie = loadOrCreateSessionCookie(sessionFile);
const ws = await connectCli(url, cookie, process.env.ETA_TOKEN); // a token: the app says who it is (Example.identify)

if (command.kind === "watch") {
  // Catches up on each doc's recent history before following live patches, so joining a watch
  // late doesn't mean starting blind -- `--limit` (default: just the latest) says how far back.
  const inspection = await runCommand(ws, { kind: "inspect" }, limit);
  for (const doc of inspection.docs) for (const line of formatHistory(doc)) console.log(line);
  console.log(`watching ${url} as ${sessionFile} (ctrl-c to stop)`);
  watch(ws, (line) => console.log(line));
} else {
  const inspection = await runCommand(ws, command, limit);
  // a refusal with no reason is a write to nothing this session sees: most often, it is signed out
  if (inspection.refused) console.error(`refused: ${inspection.refused.reason ?? "nothing this session can see was written; is it still signed in? (login <your link>)"}`);
  console.log(formatInspection(inspection));
  ws.close();
  if (inspection.refused) process.exitCode = 1;
}
