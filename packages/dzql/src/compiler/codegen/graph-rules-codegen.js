/**
 * Graph Rules Code Generator
 * Generates PostgreSQL functions for graph rule execution
 */

export class GraphRulesCodegen {
  constructor(tableName, graphRules, primaryKey = ['id']) {
    this.tableName = tableName;
    this.graphRules = graphRules;
    this.primaryKey = Array.isArray(primaryKey) ? primaryKey : [primaryKey];
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

    const ruleBlocks = [];

    // Process each rule
    for (const [ruleName, ruleConfig] of Object.entries(rules)) {
      const description = ruleConfig.description || ruleName;
      const condition = ruleConfig.condition;
      const actions = Array.isArray(ruleConfig.actions)
        ? ruleConfig.actions
        : (ruleConfig.actions ? [ruleConfig.actions] : []);

      const actionBlocks = [];
      for (const action of actions) {
        const actionSQL = this._generateAction(action, ruleName, description);
        if (actionSQL) {
          actionBlocks.push(actionSQL);
        }
      }

      if (actionBlocks.length === 0) {
        continue;  // Skip rules with no actions
      }

      // Wrap actions in condition IF block if condition is present
      if (condition) {
        const conditionSQL = this._generateCondition(condition, operation);
        const ruleBlock = `  -- Rule: ${ruleName}
  IF ${conditionSQL} THEN
${actionBlocks.join('\n\n')}
  END IF;`;
        ruleBlocks.push(ruleBlock);
      } else {
        // No condition - add actions directly
        ruleBlocks.push(...actionBlocks);
      }
    }

    if (ruleBlocks.length === 0) {
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
${ruleBlocks.join('\n\n')}
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

      case 'notify':
        return this._generateNotifyAction(action, comment);

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
   * Generate jsonb_build_object for primary key columns from a JSONB record variable
   * Supports composite primary keys
   * @param {string} recordVar - The JSONB record variable name (e.g., 'p_record')
   * @private
   */
  _generatePKBuildObject(recordVar = 'p_record') {
    // Build jsonb_build_object with all primary key columns
    // e.g., jsonb_build_object('id', (p_record->>'id')::int)
    // or    jsonb_build_object('template_id', (p_record->>'template_id')::int, 'depends_on_template_id', (p_record->>'depends_on_template_id')::int)
    const pairs = this.primaryKey.map(col => `'${col}', (${recordVar}->>'${col}')::int`);
    return `jsonb_build_object(${pairs.join(', ')})`;
  }

  /**
   * Generate NOTIFY action
   * Creates an event that will be broadcast to specified users
   * @private
   */
  _generateNotifyAction(action, comment) {
    const users = action.users || [];
    const message = action.message || '';
    const data = action.data || {};

    // Build user ID array resolution
    let userIdSQL = 'ARRAY[]::INT[]';

    if (users.length > 0) {
      // Users can be paths like "@post_id->posts.author_id" or direct field refs like "@author_id"
      const userPaths = [];

      for (const userPath of users) {
        if (userPath.startsWith('@') && !userPath.includes('->')) {
          // Simple field reference: @author_id
          const fieldName = userPath.substring(1);
          userPaths.push(`(p_record->>'${fieldName}')::int`);
        } else if (userPath.startsWith('@') && userPath.includes('->')) {
          // Complex path: @post_id->posts.author_id - use runtime resolver
          userPaths.push(`dzql.resolve_notification_path('${this.tableName}', p_record, '${userPath}')`);
        } else {
          // Literal user ID
          userPaths.push(`${userPath}`);
        }
      }

      if (userPaths.length === 1 && !userPaths[0].includes('resolve_notification_path')) {
        // Single simple field - wrap in array
        userIdSQL = `ARRAY[${userPaths[0]}]`;
      } else if (userPaths.length === 1) {
        // Single path resolution (already returns array)
        userIdSQL = userPaths[0];
      } else {
        // Multiple paths - need to combine arrays
        userIdSQL = `(${userPaths.map(p =>
          p.includes('resolve_notification_path')
            ? p
            : `ARRAY[${p}]`
        ).join(' || ')})`;
      }
    }

    // Build notification data object
    const dataFields = [];
    dataFields.push(`'type', 'graph_rule_notification'`);
    dataFields.push(`'table', '${this.tableName}'`);

    if (message) {
      dataFields.push(`'message', ${this._resolveValue(message)}`);
    }

    // Add custom data fields
    for (const [key, value] of Object.entries(data)) {
      dataFields.push(`'${key}', ${this._resolveValue(value)}`);
    }

    const dataSQL = dataFields.length > 0
      ? `jsonb_build_object(${dataFields.join(', ')})`
      : "'{}'::jsonb";

    const pkBuildObject = this._generatePKBuildObject('p_record');

    return `${comment}
  -- Create notification event
  INSERT INTO dzql.events (
    table_name,
    op,
    pk,
    data,
    user_id,
    notify_users
  ) VALUES (
    '${this.tableName}',
    'notify',
    ${pkBuildObject},
    ${dataSQL},
    p_user_id,
    ${userIdSQL}
  );`;
  }

  /**
   * Generate condition SQL from condition string
   * Supports @before.field, @after.field, @user_id, @id
   * @private
   */
  _generateCondition(condition, operation) {
    let conditionSQL = condition;

    // Replace @before.field references (for update/delete)
    conditionSQL = conditionSQL.replace(/@before\.(\w+)/g, (match, field) => {
      return `(p_old_record->>'${field}')`;
    });

    // Replace @after.field references (for update)
    conditionSQL = conditionSQL.replace(/@after\.(\w+)/g, (match, field) => {
      if (operation === 'update') {
        return `(p_new_record->>'${field}')`;
      } else {
        return `(p_record->>'${field}')`;
      }
    });

    // Replace @field references (current record)
    conditionSQL = conditionSQL.replace(/@(\w+)(?!\w)/g, (match, field) => {
      if (field === 'user_id') {
        return 'p_user_id';
      } else if (field === 'id') {
        // Use appropriate record based on operation
        if (operation === 'update') {
          return `(p_new_record->>'id')`;
        } else if (operation === 'delete') {
          return `(p_old_record->>'id')`;
        } else {
          return `(p_record->>'id')`;
        }
      } else {
        // Field from current record
        if (operation === 'update') {
          return `(p_new_record->>'${field}')`;
        } else if (operation === 'delete') {
          return `(p_old_record->>'${field}')`;
        } else {
          return `(p_record->>'${field}')`;
        }
      }
    });

    return conditionSQL;
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
 * @param {Array<string>} primaryKey - Primary key column(s) (defaults to ['id'])
 * @returns {string} SQL for graph rule functions
 */
export function generateGraphRuleFunctions(tableName, graphRules, primaryKey = ['id']) {
  const codegen = new GraphRulesCodegen(tableName, graphRules, primaryKey);
  return codegen.generate();
}
