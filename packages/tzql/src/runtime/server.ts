import { resolveFunction, getManifest } from "./manifest_loader.js";
import { mapDatabaseError } from "./errors.js";
import { getJsFunction, hasJsFunction } from "./js_functions.js";

// Mock DB client interface
interface DBClient {
  query(text: string, params: any[]): Promise<any>;
}

export async function handleRequest(
  db: DBClient,
  method: string,
  params: any,
  userId: number
) {
  // 1. Check for JS function handler first (takes precedence)
  if (hasJsFunction(method)) {
    const handler = getJsFunction(method)!;
    console.log(`[Runtime] Executing JS function: ${method}`);

    try {
      const result = await handler({
        userId,
        params,
        db: {
          query: (sql: string, sqlParams?: any[]) => db.query(sql, sqlParams || [])
        }
      });
      return result;
    } catch (err: any) {
      console.error(`[Runtime] JS Error executing ${method}:`, err);
      throw err;
    }
  }

  // 2. Strict Allowlist Check (O(1) Lookup)
  const manifest = getManifest();
  const fnDef = manifest.functions[method];

  if (!fnDef) {
    throw new Error(`[Runtime] Method '${method}' not found in manifest.`);
  }

  const qualifiedName = `${fnDef.schema}.${fnDef.name}`;

  // 3. Argument Validation (Basic)
  // We assume all functions take (p_user_id, p_data/p_pk) for now
  // In reality, we'd check manifest.functions[method].args

  // 4. Secure Execution
  console.log(`[Runtime] Executing ${qualifiedName}`);

  try {
    // Construct params array based on manifest definition
    // args: ["p_user_id", "p_data"] -> [$1, $2]
    // args: ["p_params"] -> [$2] (since $2 is the data param)
    // We map: p_user_id -> userId ($1), p_data/p_pk/p_params -> params ($2)

    const dbParams = [];
    const sqlArgs = [];

    // We strictly map our known runtime values (userId, params) to the function signature
    // This assumes the function signature follows our conventions
    for (const arg of fnDef.args) {
        if (arg === 'p_user_id') {
            dbParams.push(userId);
            sqlArgs.push(`$${dbParams.length}`);
        } else if (arg === 'p_data' || arg === 'p_pk' || arg === 'p_query' || arg === 'p_params') {
            dbParams.push(params);
            sqlArgs.push(`$${dbParams.length}`);
        } else {
            // Unknown arg? Pass null
            dbParams.push(null);
            sqlArgs.push(`$${dbParams.length}`);
        }
    }

    const sql = `SELECT ${qualifiedName}(${sqlArgs.join(', ')}) as result`;
    const rows = await db.query(sql, dbParams);
    return rows[0].result;
  } catch (err: any) {
    // 5. Error Sanitization
    console.error(`[Runtime] DB Error executing ${method}:`, err);
    const appError = mapDatabaseError(err);
    throw appError;
  }
}
