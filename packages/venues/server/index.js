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
// Note: We can't add MCP route yet because we need the broadcast function
const server = createServer({
  port: process.env.PORT || 3000,
  customApi,
  // staticPath: path.join(__dirname, '../client'),
  routes: {
    "/": client,
    "/meta": metaRoute(),
    // MCP route will be created with a wrapper that captures broadcast
    "/mcp": async (req) => {
      // Lazy initialization of MCP route handler
      if (!server._mcpHandler) {
        server._mcpHandler = await createMCPRoute(server.broadcast);
      }
      return server._mcpHandler(req);
    }
  }
});

console.log(`🚀 Venues app running on port ${server.port}`);
