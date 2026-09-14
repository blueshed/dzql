import {
  connectCli,
  extractSessionFile,
  formatInspection,
  loadOrCreateSessionCookie,
  parseCommand,
  runCommand,
  watch,
} from "./cli/commands";

const { sessionFile, rest } = extractSessionFile(process.argv.slice(2));
const command = parseCommand(rest);
if (!command) {
  console.error("Usage: eta <name|room|leave|logout|send|undo> <value> | inspect | watch [--session <file>]");
  process.exit(1);
}

const url = `${(process.env.ETA_URL ?? "ws://localhost:3000").replace(/\/+$/, "")}/ws`;
const cookie = loadOrCreateSessionCookie(sessionFile);
const ws = await connectCli(url, cookie);

if (command.kind === "watch") {
  console.log(`watching ${url} as ${sessionFile} (ctrl-c to stop)`);
  watch(ws, (line) => console.log(line));
} else {
  console.log(formatInspection(await runCommand(ws, command)));
  ws.close();
}
