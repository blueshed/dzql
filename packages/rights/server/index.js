import { createServer } from 'zeroql';
import path from 'path';
import { fileURLToPath } from 'url';
// import client from "../zclient/index.html"

// Get the directory of the current file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import custom API functions for venues app
const customApi = await import('./api.js');

// Start the ZeroQL server with venues-specific configuration
const server = await createServer({
  port: process.env.PORT || 3000,
  customApi,
  staticPath: path.join(__dirname, '../../client/dist'),
  // routes: {
  //   "/": client
  // }
});

console.log(`🚀 Rights app running on port ${server.port}`);
