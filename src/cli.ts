import { connectCli, formatInspection, loadOrCreateSessionCookie, parseCommand, runCommand, watch } from "./cli/commands";

const command = parseCommand(process.argv.slice(2));
if (!command) {
  console.error("Usage: eta <name|room|leave|logout|send|undo> <value> | inspect | watch");
  process.exit(1);
}

const url = `${(process.env.ETA_URL ?? "ws://localhost:3000").replace(/\/+$/, "")}/ws`;
const cookie = loadOrCreateSessionCookie(".eta-session");
const ws = await connectCli(url, cookie);

if (command.kind === "watch") {
  console.log(`watching ${url} (ctrl-c to stop)`);
  watch(ws, (line) => console.log(line));
} else {
  console.log(formatInspection(await runCommand(ws, command)));
  ws.close();
}
