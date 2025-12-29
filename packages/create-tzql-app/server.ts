import { WebSocketServer, Database, loadManifest } from "tzql";
import { readFileSync } from "fs";
import { resolve } from "path";

// Load environment variables
const config = {
  port: parseInt(process.env.PORT || "3000"),
  database: {
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432"),
    database: process.env.DB_NAME || "tzql",
    user: process.env.DB_USER || "tzql",
    password: process.env.DB_PASSWORD || "tzql",
  },
  jwtSecret: process.env.JWT_SECRET || "change-me-in-production",
};

// Load the compiled manifest
const manifestPath = resolve(import.meta.dir, "dist/runtime/manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
loadManifest(manifest);

// Initialize database connection
const db = new Database(config.database);

// Initialize WebSocket server
const wsServer = new WebSocketServer(db);

// Start server
const server = Bun.serve({
  port: config.port,

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

console.log(`Server running at http://localhost:${config.port}`);
console.log(`WebSocket endpoint: ws://localhost:${config.port}/ws`);
