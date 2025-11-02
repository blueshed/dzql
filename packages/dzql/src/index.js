// ZeroQL Framework - Main Entry Point
export { createServer } from './server/index.js';

// Re-export client utilities
export { WebSocketManager, useWs } from './client/ws.js';

// Re-export UI framework
export { mount, state, Component } from './client/ui.js';
export { loadUI, loadEntityUI } from './client/ui-loader.js';

// Re-export database utilities for tests and custom functions
export { sql, listen_sql, db } from './server/db.js';
export { createWebSocketHandlers, verify_jwt_token } from './server/ws.js';

// Re-export meta route for applications
export { metaRoute } from './server/meta-route.js';

// Re-export MCP route for Claude Code integration
export { createMCPRoute } from './server/mcp.js';
