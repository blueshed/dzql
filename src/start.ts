import { removePidFile, writePidFile } from "./pid";
import { createServer } from "./server";

await writePidFile();
process.on("exit", removePidFile);
process.on("SIGINT", () => process.exit());
process.on("SIGTERM", () => process.exit());

const server = createServer();
console.log(`Listening on ${server.url}`);
