// JavaScript Custom Function Registry
// Allows registering JS/Bun functions that can be called via RPC

export interface JsFunctionContext {
  userId: number | null;
  params: any;
  db: {
    query(sql: string, params?: any[]): Promise<any[]>;
  };
}

export type JsFunctionHandler = (ctx: JsFunctionContext) => Promise<any>;

// Registry of JS function handlers
const jsHandlers: Map<string, JsFunctionHandler> = new Map();

/**
 * Register a JavaScript function that can be called via RPC.
 * JS functions take precedence over SQL functions with the same name.
 *
 * @param name - The function name (used in RPC calls)
 * @param handler - Async function that receives context and returns result
 *
 * @example
 * registerJsFunction('calculate_stats', async (ctx) => {
 *   const { userId, params, db } = ctx;
 *   const rows = await db.query('SELECT COUNT(*) as cnt FROM venues WHERE org_id = $1', [params.org_id]);
 *   return { venue_count: rows[0].cnt };
 * });
 */
export function registerJsFunction(name: string, handler: JsFunctionHandler): void {
  jsHandlers.set(name, handler);
  console.log(`[Runtime] Registered JS function: ${name}`);
}

/**
 * Get a registered JS function handler by name.
 * @returns The handler function or undefined if not registered
 */
export function getJsFunction(name: string): JsFunctionHandler | undefined {
  return jsHandlers.get(name);
}

/**
 * Check if a JS function is registered.
 */
export function hasJsFunction(name: string): boolean {
  return jsHandlers.has(name);
}

/**
 * Clear all registered JS functions (useful for testing).
 */
export function clearJsFunctions(): void {
  jsHandlers.clear();
}

/**
 * Get all registered JS function names.
 */
export function getJsFunctionNames(): string[] {
  return Array.from(jsHandlers.keys());
}
