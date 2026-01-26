import type { EntityIR, ManyToManyIR, IncludeIR } from "../../../shared/ir.js";

/** Column info from EntityIR */
export interface ColumnInfo {
  name: string;
  type: string;
  isArray: boolean;
}

/** Re-export types for convenience */
export type { EntityIR, ManyToManyIR, IncludeIR };
