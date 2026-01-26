/**
 * SQL Code Generation Module
 *
 * This module generates PostgreSQL functions for DZQL entities.
 * Split into focused files for maintainability:
 *
 * - core.ts: Core schema, auth functions
 * - save.ts: Save/upsert functions (including temporal)
 * - delete.ts: Delete functions (including temporal)
 * - get.ts: Get and history functions
 * - search.ts: Search function with filters
 * - utils.ts: Shared utilities
 * - types.ts: Type definitions
 */

export { generateCoreSQL, generateAuthSQL, generateSchemaSQL } from "./core.js";
export { generateSaveFunction } from "./save.js";
export { generateDeleteFunction } from "./delete.js";
export { generateGetFunction, generateHistoryFunction } from "./get.js";
export { generateSearchFunction } from "./search.js";
export { buildVisibleJsonb, getCastForType, stripFKReferences } from "./utils.js";
export type { ColumnInfo, EntityIR, ManyToManyIR, IncludeIR } from "./types.js";

import type { EntityIR } from "./types.js";
import { generateSaveFunction } from "./save.js";
import { generateDeleteFunction } from "./delete.js";
import { generateGetFunction, generateHistoryFunction } from "./get.js";
import { generateSearchFunction } from "./search.js";

// === AGGREGATE GENERATOR ===
export function generateEntitySQL(name: string, entityIR: EntityIR): string {
  // Import here to avoid circular dependency
  const { generateNotificationFunction } = require('../notification.js');

  const functions = [
    generateNotificationFunction(name, entityIR),
    generateSaveFunction(name, entityIR),
    generateDeleteFunction(name, entityIR),
    generateGetFunction(name, entityIR),
    generateSearchFunction(name, entityIR)
  ];

  // Add history function for temporal entities with refField
  if (entityIR.temporal?.refField) {
    functions.push(generateHistoryFunction(name, entityIR));
  }

  return functions.join('\n');
}
