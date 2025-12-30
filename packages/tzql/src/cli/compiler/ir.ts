import type {
  DomainConfig,
  EntityConfig,
  SubscribableConfig,
  IncludeConfig,
  GraphRuleActionConfig,
  GraphRuleConfig,
  ManyToManyConfig,
  DomainIR,
  EntityIR,
  SubscribableIR,
  IncludeIR,
  CustomFunctionIR,
  ManyToManyIR,
  GraphRuleIR
} from "../../shared/ir.js";

/**
 * Parses a graph rule config into IR format.
 * Handles both formats:
 * 1. Direct: { actions: [...] }
 * 2. Named: { rule_name: { description, condition, actions } }
 */
function parseGraphRules(rules: Record<string, GraphRuleConfig> | { actions: GraphRuleActionConfig[] } | undefined): GraphRuleIR[] {
  if (!rules) return [];

  const allActions: GraphRuleIR[] = [];

  // Helper to extract target from action config
  const getTarget = (action: GraphRuleActionConfig): string => {
    // For validate/execute, use 'function'; for delete/update use 'target'; for create use 'entity'; for reactor use 'name'
    return action.function || action.target || action.entity || action.name || '';
  };

  // Helper to build a GraphRuleIR from an action config
  const buildRuleIR = (
    action: GraphRuleActionConfig,
    ruleName?: string,
    ruleDescription?: string,
    ruleCondition?: string
  ): GraphRuleIR => {
    return {
      trigger: 'create', // Will be set by caller
      action: action.type as 'create' | 'update' | 'delete' | 'reactor' | 'validate' | 'execute',
      target: getTarget(action),
      ruleName,
      description: ruleDescription,
      condition: ruleCondition,
      params: action.params || action.data || {},
      match: action.match,
      error_message: action.error_message
    };
  };

  // Case 1: Direct rule (has 'actions' at top level)
  if ('actions' in rules && Array.isArray(rules.actions)) {
    for (const action of rules.actions) {
      allActions.push(buildRuleIR(action));
    }
    return allActions;
  }

  // Case 2: Named rules (iterate values)
  for (const [ruleName, ruleConfig] of Object.entries(rules)) {
    if (ruleConfig && typeof ruleConfig === 'object' && 'actions' in ruleConfig && Array.isArray(ruleConfig.actions)) {
      for (const action of ruleConfig.actions) {
        allActions.push(buildRuleIR(
          action,
          ruleName,
          ruleConfig.description,
          ruleConfig.condition
        ));
      }
    }
  }

  return allActions;
}

/**
 * Parses include config (handles both string shorthand and full object)
 */
function parseIncludes(rawIncludes: Record<string, string | IncludeConfig> | undefined): Record<string, IncludeIR> {
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
      parsed[key] = {
        relation: key,
        entity: val.entity || key,
        filter: val.filter,
        includes: parseIncludes(val.includes as Record<string, string | IncludeConfig> | undefined)
      };
    }
  }
  return parsed;
}

/**
 * Generates IR from a typed domain configuration
 */
export function generateIR(domain: DomainConfig): DomainIR {
  const entities: Record<string, EntityIR> = {};

  // --- ENTITIES ---
  for (const [name, config] of Object.entries(domain.entities)) {
    const columns: Array<{ name: string; type: string; isArray: boolean }> = [];
    const pk: string[] = [];

    // Parse Schema
    for (const [colName, colType] of Object.entries(config.schema)) {
      columns.push({
        name: colName,
        type: colType,
        isArray: colType.includes('[]')
      });

      if (colType.toUpperCase().includes('PRIMARY KEY')) {
        pk.push(colName);
      }
    }

    // Check for explicit primaryKey array in config (for composite PKs)
    if (config.primaryKey && Array.isArray(config.primaryKey) && config.primaryKey.length > 0) {
      pk.length = 0; // Clear any auto-detected PKs
      pk.push(...config.primaryKey);
    }

    // Default PK if none found
    if (pk.length === 0 && columns.some(c => c.name === 'id')) {
      pk.push('id');
    }

    // Parse permissions
    const rawPerms = config.permissions || {};
    const permissions = {
      view: rawPerms.view || [],
      create: rawPerms.create || [],
      update: rawPerms.update || [],
      delete: rawPerms.delete || []
    };

    // Parse Graph Rules
    const rawRules = config.graphRules || {};

    const onCreateRules = parseGraphRules(rawRules.on_create);
    onCreateRules.forEach(r => r.trigger = 'create');

    const onUpdateRules = parseGraphRules(rawRules.on_update);
    onUpdateRules.forEach(r => r.trigger = 'update');

    const onDeleteRules = parseGraphRules(rawRules.on_delete);
    onDeleteRules.forEach(r => r.trigger = 'delete');

    // Parse M2M relationships
    const rawM2M = config.manyToMany || {};
    const manyToMany: Record<string, ManyToManyIR> = {};
    for (const [relationKey, m2mConfig] of Object.entries(rawM2M)) {
      manyToMany[relationKey] = {
        junctionTable: m2mConfig.junctionTable,
        localKey: m2mConfig.localKey,
        foreignKey: m2mConfig.foreignKey,
        targetEntity: m2mConfig.targetEntity,
        idField: m2mConfig.idField,
        expand: m2mConfig.expand || false
      };
    }

    entities[name] = {
      name,
      table: name,
      primaryKey: pk,
      columns,
      labelField: config.label || 'id',
      softDelete: config.softDelete || false,
      managed: config.managed !== false, // Default to true, only false if explicitly set
      hidden: config.hidden || [],
      fieldDefaults: config.fieldDefaults || {},
      permissions,
      relationships: {},
      manyToMany,
      graphRules: {
        onCreate: onCreateRules,
        onUpdate: onUpdateRules,
        onDelete: onDeleteRules
      }
    };
  }

  // --- SUBSCRIBABLES ---
  const subscribables: Record<string, SubscribableIR> = {};

  if (domain.subscribables) {
    for (const [name, config] of Object.entries(domain.subscribables)) {
      subscribables[name] = {
        name,
        params: config.params || {},
        root: config.root || { entity: '', key: '' },
        includes: parseIncludes(config.includes as Record<string, string | IncludeConfig> | undefined),
        scopeTables: config.scopeTables || [],
        canSubscribe: config.canSubscribe || []
      };
    }
  }

  // --- CUSTOM FUNCTIONS ---
  const customFunctions: CustomFunctionIR[] = [];

  if (domain.customFunctions) {
    for (const fn of domain.customFunctions) {
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
