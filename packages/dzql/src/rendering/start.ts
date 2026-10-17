import { createServer } from "./server";
import { appDir } from "./names";

const { example } = await import(`${appDir(process.env.ETA_EXAMPLE)}/index.ts`);

const server = createServer(example);
console.log(`Listening on ${server.url}`);
