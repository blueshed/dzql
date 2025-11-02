import { spawn } from "bun";
import { fileURLToPath } from "url";
import { dirname } from "path";

// Get the directory of this test file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Test server utility for consistent server spawning and health checking
 */
class TestServer {
  constructor(port = 3000) {
    this.port = port;
    this.server = null;
    this.isHealthy = false;
  }

  /**
   * Start the server and wait for it to be healthy
   */
  async start() {
    if (this.server) {
      throw new Error("Server is already running");
    }

    // Spawn the server process from the package directory
    this.server = spawn(["bun", "server/index.js"], {
      cwd: dirname(__dirname), // Go up from tests/ to package root
      stdout: "inherit",
      stderr: "inherit",
      env: { ...process.env, NODE_ENV: "test", PORT: this.port.toString() },
    });

    // Wait for HTTP server to be healthy
    await this.waitForHealth();

    // Wait for WebSocket server to be ready
    await this.waitForWebSocketHealth();
  }

  /**
   * Stop the server
   */
  async stop() {
    if (this.server) {
      this.server.kill();
      this.server = null;
      this.isHealthy = false;

      // Small delay to ensure clean shutdown
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  /**
   * Wait for server to respond to health checks
   */
  async waitForHealth(timeoutMs = 10000, intervalMs = 100) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await fetch(`http://localhost:${this.port}/health`);
        if (response.ok) {
          this.isHealthy = true;
          return;
        }
      } catch (error) {
        // Server not ready yet, continue waiting
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(
      `Server failed to become healthy within ${timeoutMs}ms on port ${this.port}`,
    );
  }

  /**
   * Wait for WebSocket server to be ready
   */
  async waitForWebSocketHealth(timeoutMs = 5000, intervalMs = 100) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      try {
        // Use Bun's built-in WebSocket to test connection
        const ws = new WebSocket(this.getWebSocketUrl());

        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            ws.close();
            reject(new Error("WebSocket connection timeout"));
          }, 1000);

          ws.onopen = () => {
            clearTimeout(timeout);
            ws.close();
            resolve();
          };

          ws.onerror = (error) => {
            clearTimeout(timeout);
            reject(error);
          };
        });

        // If we get here, WebSocket is ready
        return;
      } catch (error) {
        // WebSocket not ready yet, continue waiting
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(
      `WebSocket server failed to become ready within ${timeoutMs}ms on port ${this.port}`,
    );
  }

  /**
   * Get WebSocket URL for this server
   */
  getWebSocketUrl(token = null) {
    let url = `ws://localhost:${this.port}/ws`;
    if (token) {
      url += `?token=${encodeURIComponent(token)}`;
    }
    return url;
  }

  /**
   * Get HTTP URL for this server
   */
  getHttpUrl(path = "") {
    return `http://localhost:${this.port}${path}`;
  }

  /**
   * Check if server is running and healthy
   */
  async checkHealth() {
    try {
      const response = await fetch(this.getHttpUrl("/health"));
      return response.ok;
    } catch (error) {
      return false;
    }
  }
}

/**
 * Create a test server instance
 */
export function createTestServer(port = 3000) {
  return new TestServer(port);
}

/**
 * Helper function for test suites that need a server
 * Usage in beforeAll:
 *   server = await setupTestServer();
 * Usage in afterAll:
 *   await teardownTestServer(server);
 */
export async function setupTestServer(port = 3000) {
  const server = createTestServer(port);
  await server.start();
  return server;
}

export async function teardownTestServer(server) {
  if (server) {
    await server.stop();
  }
}
