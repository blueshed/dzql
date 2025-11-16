/**
 * Notification Path Code Generator
 * Generates PostgreSQL notification resolution functions from path ASTs
 */

import { PathParser } from '../parser/path-parser.js';

export class NotificationCodegen {
  constructor(tableName, notificationPaths) {
    this.tableName = tableName;
    this.notificationPaths = notificationPaths;
    this.parser = new PathParser();
  }

  /**
   * Generate notification path resolution function
   * @returns {string} SQL for notification function
   */
  generate() {
    if (!this.notificationPaths || Object.keys(this.notificationPaths).length === 0) {
      return this._generateEmptyFunction();
    }

    const pathCollectors = [];

    // Generate SQL for each notification path
    for (const [pathName, paths] of Object.entries(this.notificationPaths)) {
      if (!paths || paths.length === 0) continue;

      for (const path of paths) {
        const ast = this.parser.parse(path);
        const sql = this._generatePathSQL(ast);
        if (sql) {
          pathCollectors.push(`
  -- ${pathName} notification path
  v_users := v_users || ARRAY(${sql});`);
        }
      }
    }

    const pathSQL = pathCollectors.length > 0
      ? pathCollectors.join('\n')
      : '  -- No notification paths configured';

    return `-- Notification path resolution for ${this.tableName}
CREATE OR REPLACE FUNCTION _resolve_notification_paths_${this.tableName}(
  p_user_id INT,
  p_record JSONB
) RETURNS INT[] AS $$
DECLARE
  v_users INT[] := ARRAY[]::INT[];
BEGIN
${pathSQL}

  -- Return unique user IDs
  RETURN ARRAY(SELECT DISTINCT unnest(v_users));
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;`;
  }

  /**
   * Generate empty function (no notifications)
   * @private
   */
  _generateEmptyFunction() {
    return `-- Notification path resolution for ${this.tableName}
CREATE OR REPLACE FUNCTION _resolve_notification_paths_${this.tableName}(
  p_user_id INT,
  p_record JSONB
) RETURNS INT[] AS $$
BEGIN
  RETURN ARRAY[]::INT[];  -- No notification paths configured
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
        return null;  // No users

      case 'direct_field':
        return this._generateDirectFieldQuery(ast);

      case 'traversal':
        return this._generateTraversalQuery(ast);

      case 'dot_path':
        return this._generateDotPathQuery(ast);

      default:
        console.warn('Unknown AST type for notification:', ast.type);
        return null;
    }
  }

  /**
   * Generate direct field query: @owner_id
   * Returns single user ID
   * @private
   */
  _generateDirectFieldQuery(ast) {
    return `
    SELECT (p_record->>'${ast.field}')::int
    WHERE (p_record->>'${ast.field}') IS NOT NULL
  `;
  }

  /**
   * Generate traversal query: @org_id->acts_for[org_id=$]{active}.user_id
   * Returns array of user IDs
   * @private
   */
  _generateTraversalQuery(ast) {
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
          sourceField = step.field;
        } else {
          targetField = step.field;
        }
      } else if (step.type === 'table_ref') {
        targetTable = step.table;

        if (step.filter) {
          filters = step.filter;
        }

        if (step.temporal) {
          temporal = true;
        }

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

    // Build WHERE clause
    const whereClause = conditions.length > 0
      ? 'WHERE ' + conditions.join('\n        AND ')
      : '';

    return `
    SELECT ${targetTable}.${targetField}
    FROM ${targetTable}
    ${whereClause}
  `;
  }

  /**
   * Generate dot path query
   * @private
   */
  _generateDotPathQuery(ast) {
    const lastField = ast.fields[ast.fields.length - 1];
    return `
    SELECT (p_record->>'${lastField}')::int
    WHERE (p_record->>'${lastField}') IS NOT NULL
  `;
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
        return '?';
      default:
        return 'NULL';
    }
  }
}

/**
 * Generate notification path resolution function for an entity
 * @param {string} tableName - Table name
 * @param {Object} notificationPaths - Notification paths object
 * @returns {string} SQL for notification function
 */
export function generateNotificationFunction(tableName, notificationPaths) {
  const codegen = new NotificationCodegen(tableName, notificationPaths);
  return codegen.generate();
}
