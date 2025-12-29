import { WebSocketServer, Database, loadManifest } from "tzql";
import { readFileSync } from "fs";
import { resolve } from "path";

// Configuration from environment
const port = parseInt(process.env.PORT || "3000");
const databaseUrl = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/my-tzql-app";

// Load the compiled manifest
const manifestPath = resolve(import.meta.dir, "dist/runtime/manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
loadManifest(manifest);

// Initialize database connection
const db = new Database(databaseUrl);

// Initialize WebSocket server
const wsServer = new WebSocketServer(db);

// Start server
const server = Bun.serve({
  port,

  fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (url.pathname === "/ws") {
      const token = url.searchParams.get("token");
      const success = server.upgrade(req, {
        data: { token },
      });
      if (success) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // Health check
    if (url.pathname === "/health") {
      return new Response("OK");
    }

    // Serve static files from public directory
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(Bun.file("public/index.html"));
    }

    // Default: try to serve from public
    const filePath = `public${url.pathname}`;
    const file = Bun.file(filePath);
    return new Response(file);
  },

  websocket: wsServer.handlers,
});

console.log(`Server running at http://localhost:${port}`);
console.log(`WebSocket endpoint: ws://localhost:${port}/ws`);
