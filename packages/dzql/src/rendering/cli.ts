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
  refusedLine,
  savedServer,
  serverOfLink,
  signIn,
  signInByLink,
} from "./cli/commands";
import { appDir } from "./names";
import { cookieNameForUrl } from "./scope";

/** The app's CLI, over its socket: `bun run cli <command>` runs it; `dzql model <verb>` calls it with the model's verbs. */
export async function main(argv: string[]): Promise<void> {
  const aliasFile = `${appDir(process.env.ETA_EXAMPLE)}/cli.ts`;
  // The kernel knows only doc-agnostic commands (inspect/watch/undo/write); an
  // example's own short verbs (chat's `name`, `room`, ...) live in its own
  // cli.ts and are loaded here only if that file exists -- a from-scratch
  // example doesn't have to write one.
  const aliases: Aliases = existsSync(aliasFile) ? (await import(aliasFile)).aliases : {};

  const { sessionFile, rest: afterSession } = extractSessionFile(argv);
  const { value: limitFlag, rest } = extractFlag(afterSession, "--limit");
  const limit = Number(limitFlag) || undefined;
  // the server: ETA_URL, else the one the CLI's sign-in link came from, else the app on :3000
  const server = (process.env.ETA_URL ?? savedServer(sessionFile) ?? "ws://localhost:3000").replace(/\/+$/, "");
  const url = `${server}/ws`;

  // `login <link>` or `login <email> <password>`: signs in, and keeps the session it is given
  if (rest[0] === "login") {
    // a sign-in link (`dzql model` prints one for each keeper), or the email and password the form takes
    const link = rest[1]?.startsWith("http") ? rest[1] : undefined;
    const session = link ? await signInByLink(link) : await signIn(url, { email: rest[1] ?? "", password: rest[2] ?? "" });
    if (!session) {
      console.error(link ? "refused: that link is not one this server gave, or it is used or has run out (each signs in once: print a fresh one)" : "refused: that email and password do not match");
      process.exit(1);
    }
    writeFileSync(sessionFile, session);
    const to = link ? serverOfLink(link) : server;
    if (link) writeFileSync(`${sessionFile}.url`, to); // from now on the CLI talks to the server it signed in to
    console.log(`signed in to ${to}, as ${sessionFile}`);
    process.exit(0);
  }

  const command = parseCommand(rest, aliases);
  if (!command) {
    const commands = ["login <link | email password>", "inspect", "watch", "undo", "redo", "write <doc> <op> <path> [value]", ...Object.keys(aliases)];
    console.error(`Usage: bun run cli <${commands.join("|")}> [--session <file>] [--limit <n>]`);
    process.exit(1);
  }

  const cookie = loadOrCreateSessionCookie(sessionFile, cookieNameForUrl(url)); // the app's own cookie, under its path
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
    if (inspection.refused) console.error(refusedLine(inspection.refused.reason, server));
    console.log(formatInspection(inspection));
    ws.close();
    if (inspection.refused) process.exitCode = 1;
  }
}

if (import.meta.main) await main(process.argv.slice(2));
