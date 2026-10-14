/**
 * SQL Code Generation
 *
 * This file re-exports from the modular sql/ directory for backwards compatibility.
 * The actual implementation is split into focused files:
 *
 * - sql/core.ts: Core schema, auth functions
 * - sql/save.ts: Save/upsert functions (including temporal)
 * - sql/delete.ts: Delete functions (including temporal)
 * - sql/get.ts: Get and history functions
 * - sql/search.ts: Search function with filters
 * - sql/utils.ts: Shared utilities
 * - sql/types.ts: Type definitions
 */

export {
  generateCoreSQL,
  generateAuthSQL,
  generateSchemaSQL,
  generateSaveFunction,
  generateDeleteFunction,
  generateGetFunction,
  generateHistoryFunction,
  generateSearchFunction,
  generateEntitySQL,
  buildVisibleJsonb,
  getCastForType,
  stripFKReferences
} from "./sql/index.js";

export type { ColumnInfo, EntityIR, ManyToManyIR, IncludeIR } from "./sql/index.js";
