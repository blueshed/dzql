// server.ts - DZQL Runtime Server
import { createServer } from "dzql";

const server = createServer({
  manifestPath: "./dist/runtime/manifest.json",
  jwtSecret: process.env.JWT_SECRET || "dev-secret-change-in-production",
});

const port = process.env.PORT || 3000;

console.log(`DZQL Server running at http://localhost:${port}`);
console.log(`WebSocket endpoint: ws://localhost:${port}/ws`);

export default {
  port,
  fetch: server.fetch,
  websocket: server.websocket,
};
