import { createServer } from "./server";

const exampleName = process.env.ETA_EXAMPLE ?? "chat";
const { example } = await import(`${import.meta.dir}/../examples/${exampleName}/index.ts`);

const server = createServer(example);
console.log(`Listening on ${server.url}`);
