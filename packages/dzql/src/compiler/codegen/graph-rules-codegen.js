/**
 * Graph Rules Code Generator
 * Generates PostgreSQL functions for graph rule execution
 */

export class GraphRulesCodegen {
  constructor(tableName, graphRules) {
    this.tableName = tableName;
    this.graphRules = graphRules;
  }

  /**
   * Generate all graph rule functions
   * @returns {string} SQL for graph rule functions
   */
  generate() {
    if (!this.graphRules || Object.keys(this.graphRules).length === 0) {
      return '';  // No functions if no rules
    }

    const functions = [];

    // Generate function for each trigger (on_create, on_update, on_delete)
    for (const [trigger, rules] of Object.entries(this.graphRules)) {
      const functionSQL = this._generateTriggerFunction(trigger, rules);
      if (functionSQL) {
        functions.push(functionSQL);
      }
    }

    return functions.join('\n\n');
  }

  /**
   * Generate function for a specific trigger
   * @private
   */
  _generateTriggerFunction(trigger, rules) {
    const operation = trigger.replace('on_', '');  // on_create -> create
    const functionName = `_graph_${this.tableName}_${trigger}`;

    const actionBlocks = [];

    // Process each rule
    for (const [ruleName, ruleConfig] of Object.entries(rules)) {
      const description = ruleConfig.description || ruleName;
      const actions = Array.isArray(ruleConfig.actions)
        ? ruleConfig.actions
        : (ruleConfig.actions ? [ruleConfig.actions] : []);

      for (const action of actions) {
        const actionSQL = this._generateAction(action, ruleName, description);
        if (actionSQL) {
          actionBlocks.push(actionSQL);
        }
      }
    }

    if (actionBlocks.length === 0) {
      return null;  // No actions, no function
    }

    // Determine parameters based on operation - p_user_id ALWAYS FIRST
    const params = operation === 'delete'
      ? `p_user_id INT,\n  p_old_record JSONB`
      : operation === 'update'
      ? `p_user_id INT,\n  p_old_record JSONB,\n  p_new_record JSONB`
      : `p_user_id INT,\n  p_record JSONB`;

    return `-- Graph rules: ${trigger} on ${this.tableName}
CREATE OR REPLACE FUNCTION ${functionName}(
  ${params}
) RETURNS VOID AS $$
BEGIN
${actionBlocks.join('\n\n')}
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;`;
  }

  /**
   * Generate SQL for a single action
   * @private
   */
  _generateAction(action, ruleName, description) {
    const comment = `  -- ${description}`;

    switch (action.type) {
      case 'create':
        return this._generateCreateAction(action, comment);

      case 'update':
        return this._generateUpdateAction(action, comment);

      case 'delete':
        return this._generateDeleteAction(action, comment);

      case 'validate':
        return this._generateValidateAction(action, comment);

      case 'execute':
        return this._generateExecuteAction(action, comment);

      default:
        console.warn('Unknown action type:', action.type);
        return null;
    }
  }

  /**
   * Generate CREATE action
   * @private
   */
  _generateCreateAction(action, comment) {
    const entity = action.entity;
    const data = action.data;

    const fields = [];
    const values = [];

    for (const [field, value] of Object.entries(data)) {
      fields.push(field);
      values.push(this._resolveValue(value));
    }

    return `${comment}
  INSERT INTO ${entity} (${fields.join(', ')})
  VALUES (${values.join(', ')});`;
  }

  /**
   * Generate UPDATE action
   * @private
   */
  _generateUpdateAction(action, comment) {
    const entity = action.entity;
    const data = action.data;
    const match = action.match;

    const setClauses = [];
    for (const [field, value] of Object.entries(data)) {
      setClauses.push(`${field} = ${this._resolveValue(value)}`);
    }

    const whereClauses = [];
    for (const [field, value] of Object.entries(match)) {
      whereClauses.push(`${field} = ${this._resolveValue(value)}`);
    }

    return `${comment}
  UPDATE ${entity}
  SET ${setClauses.join(', ')}
  WHERE ${whereClauses.join(' AND ')};`;
  }

  /**
   * Generate DELETE action
   * @private
   */
  _generateDeleteAction(action, comment) {
    const entity = action.entity;
    const match = action.match;

    const whereClauses = [];
    for (const [field, value] of Object.entries(match)) {
      whereClauses.push(`${field} = ${this._resolveValue(value)}`);
    }

    return `${comment}
  DELETE FROM ${entity}
  WHERE ${whereClauses.join(' AND ')};`;
  }

  /**
   * Generate VALIDATE action
   * @private
   */
  _generateValidateAction(action, comment) {
    const functionName = action.function;
    const params = action.params || {};
    const errorMessage = action.error_message || 'Validation failed';

    const paramList = [];
    for (const [key, value] of Object.entries(params)) {
      paramList.push(`${key} => ${this._resolveValue(value)}`);
    }

    const paramSQL = paramList.length > 0 ? paramList.join(', ') : '';

    return `${comment}
  IF NOT ${functionName}(${paramSQL}) THEN
    RAISE EXCEPTION '${errorMessage}';
  END IF;`;
  }

  /**
   * Generate EXECUTE action
   * @private
   */
  _generateExecuteAction(action, comment) {
    const functionName = action.function;
    const params = action.params || {};

    const paramList = [];
    for (const [key, value] of Object.entries(params)) {
      paramList.push(`${key} => ${this._resolveValue(value)}`);
    }

    const paramSQL = paramList.length > 0 ? paramList.join(', ') : '';

    return `${comment}
  PERFORM ${functionName}(${paramSQL});`;
  }

  /**
   * Resolve a value (variable reference or literal)
   * @private
   */
  _resolveValue(value) {
    if (typeof value !== 'string') {
      // Number or other type
      return value;
    }

    // Handle special variables
    if (value.startsWith('@')) {
      const varName = value.substring(1);

      // Special keywords
      switch (varName) {
        case 'user_id':
          return 'p_user_id';

        case 'today':
          return 'CURRENT_DATE';

        case 'now':
          return 'NOW()';

        default:
          // Field reference from record
          return `(p_record->>'${varName}')`;
      }
    }

    // String literal
    return `'${value}'`;
  }
}

/**
 * Generate graph rule functions for an entity
 * @param {string} tableName - Table name
 * @param {Object} graphRules - Graph rules object
 * @returns {string} SQL for graph rule functions
 */
export function generateGraphRuleFunctions(tableName, graphRules) {
  const codegen = new GraphRulesCodegen(tableName, graphRules);
  return codegen.generate();
}
