/**
 * Permission Code Generator
 * Generates PostgreSQL permission check functions from path ASTs
 */

import { PathParser } from '../parser/path-parser.js';

export class PermissionCodegen {
  constructor(tableName, permissionPaths) {
    this.tableName = tableName;
    this.permissionPaths = permissionPaths;
    this.parser = new PathParser();
  }

  /**
   * Generate all permission check functions
   * @returns {string} SQL for permission functions
   */
  generate() {
    const functions = [];

    // Always generate the 4 standard permission functions
    const standardOperations = ['view', 'create', 'update', 'delete'];

    for (const operation of standardOperations) {
      // Clean the operation name (remove any comments or special characters)
      const cleanOperation = this._cleanOperationName(operation);

      // Get paths for this operation (checking both clean and original keys)
      const paths = this.permissionPaths[operation]
                    || this.permissionPaths[cleanOperation]
                    || this._findPathsByPartialMatch(operation);

      if (!paths || paths.length === 0) {
        // Public access - always returns true
        functions.push(this._generatePublicPermission(cleanOperation));
      } else {
        functions.push(this._generatePermissionFunction(cleanOperation, paths));
      }
    }

    return functions.join('\n\n');
  }

  /**
   * Clean operation name - remove comments, quotes, newlines
   * @private
   */
  _cleanOperationName(operation) {
    if (!operation || typeof operation !== 'string') {
      return 'unknown';
    }

    // Remove SQL comments (-- ... to end of line)
    let clean = operation.replace(/--[^\n]*/g, '');

    // Remove quotes
    clean = clean.replace(/['"]/g, '');

    // Remove newlines and extra whitespace
    clean = clean.replace(/\s+/g, ' ').trim();

    // Extract just the operation name (view, create, update, delete)
    // Match common patterns
    if (clean.includes('view')) return 'view';
    if (clean.includes('create')) return 'create';
    if (clean.includes('update')) return 'update';
    if (clean.includes('delete')) return 'delete';

    // If no match, return the first word
    const firstWord = clean.split(/\s+/)[0].toLowerCase();
    return firstWord || 'unknown';
  }

  /**
   * Find paths by partial match in permission keys
   * Handles cases where keys might have comments embedded
   * @private
   */
  _findPathsByPartialMatch(operation) {
    for (const [key, paths] of Object.entries(this.permissionPaths)) {
      const cleanKey = this._cleanOperationName(key);
      if (cleanKey === operation) {
        return paths;
      }
    }
    return null;
  }

  /**
   * Generate a permission function for an operation
   * @private
   */
  _generatePermissionFunction(operation, paths) {
    const functionName = `can_${operation}_${this.tableName}`;
    const checks = [];

    for (const path of paths) {
      const ast = this.parser.parse(path);
      const sql = this._generatePathSQL(ast);
      if (sql) {
        checks.push(sql);
      }
    }

    // Combine checks with OR logic
    const checkSQL = checks.length > 0
      ? checks.join('\n      OR ')
      : 'false';

    return `-- Permission check: ${operation} on ${this.tableName}
CREATE OR REPLACE FUNCTION can_${operation}_${this.tableName}(
  p_user_id INT,
  p_record JSONB
) RETURNS BOOLEAN AS $$
BEGIN
  RETURN (
    ${checkSQL}
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;`;
  }

  /**
   * Generate public permission (always true)
   * @private
   */
  _generatePublicPermission(operation) {
    return `-- Permission check: ${operation} on ${this.tableName} (public access)
CREATE OR REPLACE FUNCTION can_${operation}_${this.tableName}(
  p_user_id INT,
  p_record JSONB
) RETURNS BOOLEAN AS $$
BEGIN
  RETURN true;  -- Public access
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;`;
  }

  /**
   * Generate SQL for a path AST
   * @private
   */
  _generatePathSQL(ast) {
    switch (ast.type) {
      case 'empty':
        return 'true';  // No restriction

      case 'direct_field':
        return this._generateDirectFieldCheck(ast);

      case 'traversal':
        return this._generateTraversalCheck(ast);

      case 'dot_path':
        return this._generateDotPathCheck(ast);

      default:
        console.warn('Unknown AST type:', ast.type);
        return 'false';
    }
  }

  /**
   * Generate direct field check: @owner_id
   * @private
   */
  _generateDirectFieldCheck(ast) {
    return `(p_record->>'${ast.field}')::int = p_user_id`;
  }

  /**
   * Generate traversal check: @org_id->acts_for[org_id=$]{active}.user_id
   * Supports multi-hop paths like: @product_id->products.organisation_id->acts_for[organisation_id=$].user_id
   * @private
   */
  _generateTraversalCheck(ast) {
    const steps = ast.steps;

    // First step should be the source field reference
    if (steps.length === 0 || steps[0].type !== 'field_ref') {
      return 'false';
    }

    const sourceField = steps[0].field;

    // Collect all table_ref steps (these are the hops)
    const tableSteps = steps.filter(s => s.type === 'table_ref');

    if (tableSteps.length === 0) {
      return 'false';
    }

    // Build the value expression that resolves through intermediate tables
    // Start with the record's source field
    let valueExpr = `(p_record->>'${sourceField}')::int`;

    // Process intermediate hops (all but the last table_ref)
    // Each intermediate hop needs a subquery to resolve to the next field
    for (let i = 0; i < tableSteps.length - 1; i++) {
      const hop = tableSteps[i];
      const table = hop.table;
      const targetField = hop.targetField;

      if (!targetField) {
        // If no target field specified, assume 'id' for the lookup
        // This shouldn't normally happen in well-formed paths
        continue;
      }

      // Build subquery: (SELECT targetField FROM table WHERE id = previousValue)
      valueExpr = `(SELECT ${targetField} FROM ${table} WHERE id = ${valueExpr})`;
    }

    // The last table_ref is where we do the EXISTS check
    const finalStep = tableSteps[tableSteps.length - 1];
    const targetTable = finalStep.table;
    const targetField = finalStep.targetField;
    const filters = finalStep.filter || [];
    const temporal = finalStep.temporal || false;

    // Build WHERE conditions for the final EXISTS query
    const conditions = [];

    // Add filter conditions
    for (const filter of filters) {
      if (filter.operator === '=' && filter.value.type === 'param') {
        // field=$ means match the resolved value from the path
        conditions.push(`${targetTable}.${filter.field} = ${valueExpr}`);
      } else if (filter.operator === '=') {
        const value = this._formatValue(filter.value);
        conditions.push(`${targetTable}.${filter.field} = ${value}`);
      }
    }

    // Add temporal condition
    if (temporal) {
      conditions.push(`${targetTable}.valid_from <= NOW()`);
      conditions.push(`(${targetTable}.valid_to > NOW() OR ${targetTable}.valid_to IS NULL)`);
    }

    // Add user_id check (final target)
    if (targetField) {
      conditions.push(`${targetTable}.${targetField} = p_user_id`);
    }

    // Build EXISTS query
    const whereClause = conditions.length > 0
      ? 'WHERE ' + conditions.join('\n          AND ')
      : '';

    return `EXISTS (
        SELECT 1 FROM ${targetTable}
        ${whereClause}
      )`;
  }

  /**
   * Generate filter condition SQL
   * @private
   */
  _generateFilterCondition(condition, tableAlias) {
    const field = `${tableAlias}.${condition.field}`;
    const value = this._formatValue(condition.value);

    switch (condition.operator) {
      case '=':
        if (condition.value.type === 'param') {
          // Special case: field=$ means use the record's value
          return `${field} = (p_record->>'${condition.field}')::int`;
        }
        return `${field} = ${value}`;

      default:
        return `${field} ${condition.operator} ${value}`;
    }
  }

  /**
   * Format a value for SQL
   * @private
   */
  _formatValue(value) {
    switch (value.type) {
      case 'literal':
        return `'${value.value}'`;
      case 'number':
        return value.value;
      case 'field':
        return `(p_record->>'${value.value}')`;
      case 'param':
        return '?';  // Will be replaced by caller
      default:
        return 'NULL';
    }
  }

  /**
   * Generate dot path check (less common)
   * @private
   */
  _generateDotPathCheck(ast) {
    // For now, treat as a field reference to the last field
    const lastField = ast.fields[ast.fields.length - 1];
    return `(p_record->>'${lastField}')::int = p_user_id`;
  }
}

/**
 * Generate permission check functions for an entity
 * @param {string} tableName - Table name
 * @param {Object} permissionPaths - Permission paths object
 * @returns {string} SQL for permission functions
 */
export function generatePermissionFunctions(tableName, permissionPaths) {
  const codegen = new PermissionCodegen(tableName, permissionPaths);
  return codegen.generate();
}
