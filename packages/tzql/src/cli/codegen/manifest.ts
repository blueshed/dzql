import { DomainIR, EntityIR, SubscribableIR, AuthIR, CustomFunctionIR } from "../../shared/ir.js";

export interface Manifest {
  version: string;
  functions: Record<string, FunctionDef>;
  entities: Record<string, EntityIR>;
  subscribables: Record<string, SubscribableIR>;
  auth?: AuthIR;
  customFunctions?: CustomFunctionIR[];
}

export interface FunctionDef {
  oid?: number; // Resolved at runtime
  schema: string;
  name: string;
  args: string[];
  returnType: string;
  isSubscription?: boolean; // Marks subscribe_* functions for client generation
}

export function generateManifest(ir: DomainIR): Manifest {
  const functions: Record<string, FunctionDef> = {
    // Built-in Auth Functions
    login_user: { schema: 'dzql_v2', name: 'login_user', args: ['p_params'], returnType: 'jsonb' },
    register_user: { schema: 'dzql_v2', name: 'register_user', args: ['p_params'], returnType: 'jsonb' }
  };

  for (const [name, entity] of Object.entries(ir.entities)) {
    // Skip unmanaged entities (junction tables, etc.)
    if (entity.managed === false) {
      continue;
    }

    // Generate standard CRUD functions
    const operations = ['get', 'save', 'delete', 'search', 'lookup'];

    for (const op of operations) {
      const funcName = `${op}_${name}`;
      functions[funcName] = {
        schema: 'dzql_v2',
        name: funcName,
        args: op === 'get' || op === 'delete'
            ? ['p_user_id', 'p_pk']
            : op === 'save'
                ? ['p_user_id', 'p_data']
                : ['p_user_id', 'p_query'],
        returnType: 'jsonb'
      };
    }
  }

  for (const [subName, subIR] of Object.entries(ir.subscribables)) {
      console.log(`[Manifest] Adding subscribable: ${subName}`);

      // get_<name> - snapshot function
      functions[`get_${subName}`] = {
          schema: 'dzql_v2',
          name: `get_${subName}`,
          args: ['p_params', 'p_user_id'],
          returnType: 'jsonb'
      };

      // <name>_can_subscribe - access control
      functions[`${subName}_can_subscribe`] = {
          schema: 'dzql_v2',
          name: `${subName}_can_subscribe`,
          args: ['p_user_id', 'p_params'],
          returnType: 'boolean'
      };

      // subscribe_<name> - virtual method handled by runtime
      functions[`subscribe_${subName}`] = {
          schema: 'dzql_v2',
          name: `subscribe_${subName}`,
          args: ['p_params'],
          returnType: 'jsonb',
          isSubscription: true // Mark as subscription for special handling
      };
  }

  // Add custom functions to allowlist
  for (const fn of ir.customFunctions || []) {
    functions[fn.name] = {
      schema: 'dzql_v2',
      name: fn.name,
      args: fn.args || ['p_user_id', 'p_params'],
      returnType: 'jsonb'
    };
  }

  return {
    version: "2.0.0",
    functions,
    entities: ir.entities, // Pass through for client generator
    subscribables: ir.subscribables,
    auth: ir.auth,
    customFunctions: ir.customFunctions
  };
}
