import type { GraphRuleIR } from "../../shared/ir.js";

/**
 * Parses params that may be a string or object into a normalized object.
 * String format: "field1=source1,field2,field3=source3"
 * - "field=source" maps field to @source
 * - "field" alone maps field to @field (or @id for the new record's id)
 */
function parseParams(params: Record<string, string | null> | string | undefined): Record<string, string | null> {
  if (!params) return {};

  if (typeof params === 'object') {
    return params;
  }

  // Parse string format: "org_id=@id,user_id=@user_id" or "organisation_id=sponsor_id,campaign_id"
  const result: Record<string, string> = {};
  for (const part of params.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    if (trimmed.includes('=')) {
      const [field, source] = trimmed.split('=').map(s => s.trim());
      // Ensure source starts with @ for variable references
      result[field] = source.startsWith('@') ? source : `@${source}`;
    } else {
      // Field alone means use @field as source (or @id for 'id')
      result[trimmed] = `@${trimmed}`;
    }
  }
  return result;
}

/**
 * Resolves a value reference (like @id, @user_id, @before.field, @after.field)
 * into the appropriate SQL expression based on the trigger context.
 * @param value - The value to resolve (may be @variable or literal)
 * @param trigger - The trigger context ('create', 'update', 'delete')
 * @param castToInt - Whether to cast the result to integer (for FK columns)
 */
function resolveValue(value: string | null, trigger: string, castToInt: boolean = false): string {
  if (value === null) {
    return 'NULL';
  }

  if (typeof value !== 'string') {
    return String(value);
  }

  if (!value.startsWith('@')) {
    // Literal string value
    return `'${value}'`;
  }

  const varName = value.substring(1);
  const intCast = castToInt ? '::int' : '';

  // Special @before.field references (for update/delete triggers)
  if (varName.startsWith('before.')) {
    const field = varName.substring(7);
    return `(v_old_data->>'${field}')${intCast}`;
  }

  // Special @after.field references (for update triggers)
  if (varName.startsWith('after.')) {
    const field = varName.substring(6);
    return `(v_result->>'${field}')${intCast}`;
  }

  // Handle special keywords
  switch (varName) {
    case 'user_id':
      return 'p_user_id';
    case 'today':
      return 'CURRENT_DATE';
    case 'now':
      return 'NOW()';
    default:
      // Generic field reference - use appropriate record based on trigger
      if (trigger === 'delete') {
        return `(v_old_data->>'${varName}')${intCast}`;
      } else {
        return `(v_result->>'${varName}')${intCast}`;
      }
  }
}

/**
 * Resolves a condition string, replacing @before.field, @after.field, etc.
 * with the appropriate SQL expressions.
 */
function resolveCondition(condition: string, trigger: string): string {
  let sql = condition;

  // Replace @before.field references
  sql = sql.replace(/@before\.(\w+)/g, (_match, field) => {
    return `(v_old_data->>'${field}')`;
  });

  // Replace @after.field references
  sql = sql.replace(/@after\.(\w+)/g, (_match, field) => {
    if (trigger === 'update' || trigger === 'create') {
      return `(v_result->>'${field}')`;
    }
    return `(v_result->>'${field}')`;
  });

  // Replace @field references (current record)
  sql = sql.replace(/@(\w+)(?!\w)/g, (_match, field) => {
    if (field === 'user_id') {
      return 'p_user_id';
    } else if (field === 'id') {
      if (trigger === 'delete') {
        return `(p_pk->>'id')`;
      } else {
        return `(v_result->>'id')`;
      }
    } else {
      if (trigger === 'delete') {
        return `(v_old_data->>'${field}')`;
      } else {
        return `(v_result->>'${field}')`;
      }
    }
  });

  return sql;
}

export function compileGraphRules(entity: string, trigger: string, rules: GraphRuleIR[]): string {
  if (!rules || rules.length === 0) return "";

  let sql = "";

  // Group rules by condition for efficient IF block generation
  // For now, handle each rule individually (can optimize later for same conditions)
  for (const rule of rules) {
    const comment = rule.description || rule.ruleName || rule.action;
    let actionSql = "";

    // === REACTOR ===
    if (rule.action === 'reactor') {
      const name = rule.target;
      const params = parseParams(rule.params);

      // Build JSON object using jsonb_build_object
      const jsonArgs: string[] = [];
      for (const [key, val] of Object.entries(params)) {
        const valueExpr = resolveValue(val, trigger);
        jsonArgs.push(`'${key}', ${valueExpr}`);
      }

      const dataJson = jsonArgs.length > 0
        ? `jsonb_build_object(${jsonArgs.join(', ')})`
        : `'{}'::jsonb`;

      actionSql = `
  -- Graph Rule: Reactor ${name}
  INSERT INTO dzql_v2.events (commit_id, table_name, op, pk, data, user_id)
  VALUES (
    v_commit_id,
    '${entity}',
    'reactor:${name}',
    jsonb_build_object('id', ${trigger === 'delete' ? "(p_pk->>'id')::text" : "(v_result->>'id')::text"}),
    ${dataJson},
    p_user_id
  );`;
    }

    // === CREATE SIDE EFFECT ===
    if (rule.action === 'create') {
      const target = rule.target;
      const data = parseParams(rule.params);
      const cols: string[] = [];
      const vals: string[] = [];

      for (const [key, val] of Object.entries(data)) {
        cols.push(key);
        // Cast to int for columns that look like FK or ID columns
        const needsIntCast = key.endsWith('_id') || key === 'id';
        vals.push(resolveValue(val, trigger, needsIntCast));
      }

      actionSql = `
  -- Graph Rule: Create ${target}
  INSERT INTO ${target} (${cols.join(', ')})
  VALUES (${vals.join(', ')});`;
    }

    // === UPDATE SIDE EFFECT ===
    if (rule.action === 'update') {
      const target = rule.target;
      const data = parseParams(rule.params);
      const match = parseParams(rule.match);

      const setClauses: string[] = [];
      for (const [key, val] of Object.entries(data)) {
        const needsIntCast = key.endsWith('_id') || key === 'id';
        setClauses.push(`${key} = ${resolveValue(val, trigger, needsIntCast)}`);
      }

      const whereClauses: string[] = [];
      for (const [key, val] of Object.entries(match)) {
        const needsIntCast = key.endsWith('_id') || key === 'id';
        whereClauses.push(`${key} = ${resolveValue(val, trigger, needsIntCast)}`);
      }

      const whereClause = whereClauses.length > 0 ? whereClauses.join(' AND ') : 'TRUE';

      actionSql = `
  -- Graph Rule: Update ${target}
  UPDATE ${target}
  SET ${setClauses.join(', ')}
  WHERE ${whereClause};`;
    }

    // === DELETE CASCADE ===
    if (rule.action === 'delete') {
      const target = rule.target;
      // Try match first, fall back to params
      let match = parseParams(rule.match);
      if (Object.keys(match).length === 0) {
        match = parseParams(rule.params);
      }
      const whereClauses: string[] = [];

      for (const [key, val] of Object.entries(match)) {
        const needsIntCast = key.endsWith('_id') || key === 'id';
        whereClauses.push(`${key} = ${resolveValue(val, trigger, needsIntCast)}`);
      }

      const whereClause = whereClauses.length > 0 ? whereClauses.join(' AND ') : 'TRUE';

      actionSql = `
  -- Graph Rule: Delete ${target}
  DELETE FROM ${target} WHERE ${whereClause};`;
    }

    // === VALIDATE ===
    if (rule.action === 'validate') {
      const functionName = rule.target;
      const params = parseParams(rule.params);
      const errorMessage = rule.error_message || 'Validation failed';

      const paramList: string[] = [];
      for (const [key, val] of Object.entries(params)) {
        paramList.push(`${key} => ${resolveValue(val, trigger)}`);
      }

      const paramSQL = paramList.length > 0 ? paramList.join(', ') : '';

      actionSql = `
  -- Graph Rule: Validate (${comment})
  IF NOT ${functionName}(${paramSQL}) THEN
    RAISE EXCEPTION '${errorMessage}';
  END IF;`;
    }

    // === EXECUTE ===
    if (rule.action === 'execute') {
      const functionName = rule.target;
      const params = parseParams(rule.params);

      const paramList: string[] = [];
      for (const [key, val] of Object.entries(params)) {
        paramList.push(`${key} => ${resolveValue(val, trigger)}`);
      }

      const paramSQL = paramList.length > 0 ? paramList.join(', ') : '';

      actionSql = `
  -- Graph Rule: Execute ${functionName}
  PERFORM ${functionName}(${paramSQL});`;
    }

    // Wrap in condition IF block if condition is present
    if (rule.condition && actionSql) {
      const conditionSQL = resolveCondition(rule.condition, trigger);
      sql += `
  -- Condition: ${rule.condition}
  IF ${conditionSQL} THEN${actionSql}
  END IF;
`;
    } else if (actionSql) {
      sql += actionSql + '\n';
    }
  }

  return sql;
}
