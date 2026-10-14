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
export { generateLookupFunction } from "./lookup.js";
export { buildVisibleJsonb, getCastForType, stripFKReferences } from "./utils.js";
export type { ColumnInfo, EntityIR, ManyToManyIR, IncludeIR } from "./types.js";

import type { EntityIR } from "./types.js";
import { generateSaveFunction } from "./save.js";
import { generateDeleteFunction } from "./delete.js";
import { generateGetFunction, generateHistoryFunction } from "./get.js";
import { generateSearchFunction } from "./search.js";
import { generateLookupFunction } from "./lookup.js";

// === AGGREGATE GENERATOR ===
export function generateEntitySQL(name: string, entityIR: EntityIR, entities: Record<string, EntityIR> = {}): string {
  // Import here to avoid circular dependency
  const { generateNotificationFunction } = require('../notification.js');

  // entities lets FK/M2M expansion project related rows through the TARGET
  // entity's visible columns instead of to_jsonb(t.*), so a related object
  // never leaks the target's hidden fields (e.g. author.password_hash).
  const functions = [
    generateNotificationFunction(name, entityIR),
    generateSaveFunction(name, entityIR, entities),
    generateDeleteFunction(name, entityIR),
    generateGetFunction(name, entityIR, entities),
    generateSearchFunction(name, entityIR, entities),
    generateLookupFunction(name, entityIR)
  ];

  // Add history function for temporal entities with refField
  if (entityIR.temporal?.refField) {
    functions.push(generateHistoryFunction(name, entityIR));
  }

  return functions.join('\n');
}
