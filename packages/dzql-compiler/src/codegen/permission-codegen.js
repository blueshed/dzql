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

    // Generate for each operation
    for (const [operation, paths] of Object.entries(this.permissionPaths)) {
      if (!paths || paths.length === 0) {
        // Public access - always returns true
        functions.push(this._generatePublicPermission(operation));
      } else {
        functions.push(this._generatePermissionFunction(operation, paths));
      }
    }

    return functions.join('\n\n');
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
   * @private
   */
  _generateTraversalCheck(ast) {
    const steps = ast.steps;

    // Extract components from the path
    let sourceField = null;
    let targetTable = null;
    let targetField = null;
    let filters = [];
    let temporal = false;

    for (const step of steps) {
      if (step.type === 'field_ref') {
        if (!sourceField) {
          // First field reference is the source
          sourceField = step.field;
        } else {
          // Last field reference is the target
          targetField = step.field;
        }
      } else if (step.type === 'table_ref') {
        targetTable = step.table;

        // Collect filter conditions
        if (step.filter) {
          filters = step.filter;
        }

        // Check for temporal marker
        if (step.temporal) {
          temporal = true;
        }

        // Get target field if specified in table ref
        if (step.targetField) {
          targetField = step.targetField;
        }
      }
    }

    // Build WHERE conditions
    const conditions = [];

    // Add filter conditions
    for (const filter of filters) {
      if (filter.operator === '=' && filter.value.type === 'param') {
        // field=$ means match the record's field value
        conditions.push(`${targetTable}.${filter.field} = (p_record->>'${sourceField}')::int`);
      } else if (filter.operator === '=') {
        const value = this._formatValue(filter.value);
        conditions.push(`${targetTable}.${filter.field} = ${value}`);
      }
    }

    // Add temporal condition
    if (temporal) {
      conditions.push(`${targetTable}.valid_to IS NULL`);
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
