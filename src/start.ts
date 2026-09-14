import { removePidFile, writePidFile } from "./pid";
import { createServer } from "./server";

const exampleName = process.env.ETA_EXAMPLE ?? "chat";
const { example } = await import(`${import.meta.dir}/../examples/${exampleName}/index.ts`);

await writePidFile();
process.on("exit", removePidFile);
process.on("SIGINT", () => process.exit());
process.on("SIGTERM", () => process.exit());

const server = createServer(example);
console.log(`Listening on ${server.url}`);
