// Set production mode for CLI to suppress logging
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "production";
}

import { DzqlNamespace } from "./packages/dzql/src/server/namespace.js";

/**
 * Main tasks class for invokej
 *
 * Other projects can use:
 * import { DzqlNamespace } from 'dzql/namespace';
 *
 * export class Tasks {
 *   constructor() {
 *     this.dzql = new DzqlNamespace();
 *   }
 * }
 */
export class Tasks {
  constructor() {
    this.dzql = new DzqlNamespace();
  }

  async publish(c) {
    await c.run("cd packages/dzql && bun publish --access public");
  }
}
