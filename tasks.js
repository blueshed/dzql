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
}
