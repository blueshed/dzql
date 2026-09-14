import { unlinkSync } from "node:fs";
import index from "./index.html";

const PID_FILE = "server.pid";

await Bun.write(PID_FILE, `${process.pid}`);

process.on("exit", () => {
  try {
    unlinkSync(PID_FILE);
  } catch {}
});
process.on("SIGINT", () => process.exit());
process.on("SIGTERM", () => process.exit());

const server = Bun.serve({
  port: process.env.PORT ?? 3000,
  routes: {
    "/": index,
    "/api/health": () => Response.json({ ok: true }),
  },
  development: process.env.NODE_ENV !== "production",
});

console.log(`Listening on ${server.url}`);
