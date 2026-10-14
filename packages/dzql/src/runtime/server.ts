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
  userId: number | null
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
    // args: ["p_email", "p_password"] -> extract from params object
    // We map: p_user_id -> userId, p_data/p_pk/p_params -> params (jsonb), individual args -> params[key]

    const dbParams = [];
    const sqlArgs = [];

    // We strictly map our known runtime values (userId, params) to the function signature
    // This assumes the function signature follows our conventions
    for (const arg of fnDef.args) {
        if (arg === 'p_user_id') {
            dbParams.push(userId);
            sqlArgs.push(`$${dbParams.length}`);
        } else if (arg === 'p_data' || arg === 'p_pk' || arg === 'p_query' || arg === 'p_params') {
            // Pass entire params object as jsonb
            dbParams.push(params);
            sqlArgs.push(`$${dbParams.length}`);
        } else if (arg.startsWith('p_')) {
            // Individual param: extract from params object by field name
            // e.g., p_email -> params.email, p_password -> params.password, p_options -> params.options
            const fieldName = arg.slice(2); // Remove 'p_' prefix
            const value = params?.[fieldName];
            dbParams.push(value !== undefined ? value : null);
            sqlArgs.push(`$${dbParams.length}`);
        } else {
            // Unknown arg? Pass null
            dbParams.push(null);
            sqlArgs.push(`$${dbParams.length}`);
        }
    }

    const sql = `SELECT ${qualifiedName}(${sqlArgs.join(', ')}) as result`;
    const rows = await db.query(sql, dbParams);

    // 5. Post-Processing & Schema Attachment (for Subscribables)
    const subName = method.startsWith('get_') ? method.slice(4) : null;
    const subscribable = subName ? manifest.subscribables[subName] : null;

    if (subscribable) {
      // ... (existing code) ...
      // It's a subscribable getter!
      const pathMapping: Record<string, string> = {};
      pathMapping[subscribable.root.entity] = '.';
      
      const buildPaths = (incl: any, parent: string) => {
        for (const [relName, relConfig] of Object.entries(incl || {})) {
          const currentPath = parent ? `${parent}.${relName}` : relName;
          pathMapping[(relConfig as any).entity] = currentPath;
          if ((relConfig as any).includes) buildPaths((relConfig as any).includes, currentPath);
        }
      };
      buildPaths(subscribable.includes, '');

      const schema = {
        root: subscribable.root.entity,
        paths: pathMapping,
        scopeTables: subscribable.scopeTables
      };

      let data: any;
      if (!subscribable.root.key) {
        // List Subscribable: Aggregate rows in Bun
        const items = rows.map((r: any) => r.result).filter((i: any) => i !== null);
        data = { [subscribable.root.entity]: items };
      } else {
        // Single Item Subscribable
        data = rows[0]?.result || null;
      }

      return { data, schema };
    }

    // 6. Handle Search/Lookup (List results)
    if (method.startsWith('search_') || method.startsWith('lookup_')) {
        console.log(`[Runtime] Handling search/lookup: ${method}, rows:`, rows.length);
        const results = rows.map((r: any) => r.result).filter((i: any) => i !== null);
        console.log(`[Runtime] Mapped results type:`, Array.isArray(results) ? 'Array' : typeof results);
        return results;
    }

    // Standard CRUD (get/save/delete) -> return single row result
    return rows[0]?.result;

  } catch (err: any) {
    // 5. Error Sanitization
    console.error(`[Runtime] DB Error executing ${method}:`, err);
    const appError = mapDatabaseError(err);
    throw appError;
  }
}
