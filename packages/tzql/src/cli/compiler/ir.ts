import { DomainIR, EntityIR, SubscribableIR, IncludeIR, CustomFunctionIR } from "../../shared/ir.js";

export function generateIR(rawDomain: any): DomainIR {
  const entities: Record<string, EntityIR> = {};

  // --- ENTITIES ---
  for (const [name, config] of Object.entries(rawDomain.entities)) {
    const rawSchema = (config as any).schema || {};
    const columns = [];
    const pk: string[] = [];

    // Parse Schema
    for (const [colName, colType] of Object.entries(rawSchema)) {
      const typeStr = colType as string;
      columns.push({
        name: colName,
        type: typeStr,
        isArray: typeStr.includes('[]')
      });

      if (typeStr.toUpperCase().includes('PRIMARY KEY')) {
        pk.push(colName);
      }
    }

    // Check for explicit primaryKey array in config (for composite PKs)
    const explicitPK = (config as any).primaryKey;
    if (explicitPK && Array.isArray(explicitPK) && explicitPK.length > 0) {
      pk.length = 0; // Clear any auto-detected PKs
      pk.push(...explicitPK);
    }

    // Default PK if none found (Postgres usually defaults to 'id' but we should be explicit)
    if (pk.length === 0 && columns.some(c => c.name === 'id')) {
        pk.push('id');
    }

    const rawPerms = (config as any).permissions || {};
    const permissions = {
      view: rawPerms.view || [],
      create: rawPerms.create || [],
      update: rawPerms.update || [],
      delete: rawPerms.delete || []
    };

    // Parse Graph Rules
    const rawRules = (config as any).graphRules || {};
    const parseRules = (rules: any) => {
        if (!rules) return [];
        // Case 1: Direct rule (has actions)
        if (rules.actions && Array.isArray(rules.actions)) return rules.actions;

        // Case 2: Map of rules (iterate values)
        const allActions = [];
        for (const key in rules) {
            const ruleConfig = rules[key];
            if (ruleConfig && ruleConfig.actions && Array.isArray(ruleConfig.actions)) {
                allActions.push(...ruleConfig.actions);
            }
        }
        return allActions;
    };

    // Parse M2M relationships
    const rawM2M = (config as any).manyToMany || {};
    const manyToMany: Record<string, any> = {};
    for (const [relationKey, m2mConfig] of Object.entries(rawM2M)) {
      const m2m = m2mConfig as any;
      manyToMany[relationKey] = {
        junctionTable: m2m.junctionTable,
        localKey: m2m.localKey,
        foreignKey: m2m.foreignKey,
        targetEntity: m2m.targetEntity,
        idField: m2m.idField,
        expand: m2m.expand || false
      };
    }

    entities[name] = {
      name,
      table: name,
      primaryKey: pk,
      columns,
      labelField: (config as any).label || 'id',
      softDelete: (config as any).softDelete || false,
      managed: (config as any).managed !== false, // Default to true, only false if explicitly set
      hidden: (config as any).hidden || [],
      fieldDefaults: (config as any).fieldDefaults || {},
      permissions,
      relationships: {},
      manyToMany,
      graphRules: {
        onCreate: parseRules(rawRules.on_create),
        onUpdate: parseRules(rawRules.on_update),
        onDelete: parseRules(rawRules.on_delete)
      }
    };
  }

  // --- SUBSCRIBABLES ---
  const subscribables: Record<string, SubscribableIR> = {};

  if (rawDomain.subscribables) {
    for (const [name, config] of Object.entries(rawDomain.subscribables)) {
      const raw = config as any;

      const parseIncludes = (rawIncludes: any): Record<string, IncludeIR> => {
        const parsed: Record<string, IncludeIR> = {};
        if (!rawIncludes) return parsed;

        for (const [key, val] of Object.entries(rawIncludes)) {
          // Handle shorthand string: "org": "organisations"
          if (typeof val === 'string') {
            parsed[key] = {
              relation: key,
              entity: val,
              includes: {}
            };
          } else {
            // Handle full object: "sites": { entity: "sites", ... }
            const obj = val as any;
            parsed[key] = {
              relation: key,
              entity: obj.entity || key, // Fallback to key if entity missing (e.g. sites: { filter... })
              filter: obj.filter,
              includes: parseIncludes(obj.includes)
            };
          }
        }
        return parsed;
      };

      subscribables[name] = {
        name,
        params: raw.params || {},
        root: raw.root || { entity: '', key: '' },
        includes: parseIncludes(raw.includes),
        scopeTables: raw.scopeTables || [], // Could perform auto-discovery here too
        canSubscribe: raw.canSubscribe || []
      };
    }
  }

  // --- CUSTOM FUNCTIONS ---
  const customFunctions: CustomFunctionIR[] = [];

  if (rawDomain.customFunctions) {
    for (const fn of rawDomain.customFunctions) {
      customFunctions.push({
        name: fn.name,
        sql: fn.sql,
        args: fn.args || ['p_user_id', 'p_params']
      });
    }
  }

  return {
    entities,
    subscribables,
    customFunctions
  };
}
