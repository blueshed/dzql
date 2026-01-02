import { createServer, metaRoute, createMCPRoute } from 'dzql';
import path from 'path';
import { fileURLToPath } from 'url';
import client from "../client/index.html"

// Get the directory of the current file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import custom API functions for venues app
const customApi = await import('./api.js');

// Start the DZQL server with venues-specific configuration
const server = createServer({
  port: process.env.PORT || 3000,
  customApi,

  // Standard routes
  routes: {
    "/": client,
    "/meta": metaRoute(),
  },

  // onReady callback receives broadcast function and current routes
  // Use this to set up routes that need access to real-time broadcasting
  onReady: async (broadcast) => {
    return {
      "/mcp": createMCPRoute(broadcast)
    };
  }
});

console.log(`🚀 Venues app running on port ${server.port}`);
