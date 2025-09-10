import { createServer } from 'dzql';
import path from 'path';
import { fileURLToPath } from 'url';
import client from "../client/index.html"

// Get the directory of the current file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import custom API functions for venues app
const customApi = await import('./api.js');

// Start the DZQL server with venues-specific configuration
const server = await createServer({
  port: process.env.PORT || 3000,
  customApi,
  // staticPath: path.join(__dirname, '../client'),
  routes: {
    "/": client
  }
});

console.log(`🚀 Venues app running on port ${server.port}`);
