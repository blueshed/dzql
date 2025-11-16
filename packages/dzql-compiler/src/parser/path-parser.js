/**
 * Permission/Notification Path Parser
 * Parses DZQL path DSL into AST for code generation
 *
 * Path Grammar:
 * - Direct field: @field_name
 * - FK traversal: @field->table.target_field
 * - Conditional: @field->table[condition]{temporal}.target_field
 * - Complex: field1.field2->table[filter].target
 */

export class PathParser {
  /**
   * Parse a permission/notification path into an AST
   * @param {string} path - Path string to parse
   * @returns {Object} AST representation
   */
  parse(path) {
    if (!path || path.trim() === '') {
      return { type: 'empty' };
    }

    // Direct field reference: @owner_id
    if (path.match(/^@\w+$/)) {
      return {
        type: 'direct_field',
        field: path.substring(1)
      };
    }

    // Complex path with traversal
    if (path.includes('->')) {
      return this._parseTraversalPath(path);
    }

    // Field path with dot notation: field1.field2
    if (path.includes('.') && !path.includes('->')) {
      return this._parseDotPath(path);
    }

    // Unknown format
    return {
      type: 'unknown',
      path
    };
  }

  /**
   * Parse a traversal path (contains ->)
   * @private
   */
  _parseTraversalPath(path) {
    const steps = [];
    const parts = path.split('->');

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();

      if (i === 0) {
        // First part: source field(s)
        steps.push(this._parseSourceField(part));
      } else if (i === parts.length - 1) {
        // Last part: target field
        steps.push(this._parseTargetField(part));
      } else {
        // Middle part: table with optional condition
        steps.push(this._parseTableReference(part));
      }
    }

    return {
      type: 'traversal',
      steps
    };
  }

  /**
   * Parse source field (can be @field or field.subfield)
   * @private
   */
  _parseSourceField(part) {
    if (part.startsWith('@')) {
      return {
        type: 'field_ref',
        field: part.substring(1)
      };
    }

    if (part.includes('.')) {
      const fields = part.split('.');
      return {
        type: 'dot_path',
        fields
      };
    }

    return {
      type: 'field_ref',
      field: part
    };
  }

  /**
   * Parse table reference with optional filter and temporal marker
   * Example: acts_for[org_id=$,role='admin']{active}
   * @private
   */
  _parseTableReference(part) {
    const result = {
      type: 'table_ref',
      table: null,
      filter: null,
      temporal: false,
      targetField: null
    };

    // Extract temporal marker {active}
    if (part.includes('{active}')) {
      result.temporal = true;
      part = part.replace('{active}', '');
    }

    // Extract filter [condition]
    const filterMatch = part.match(/([a-z_]+)\[(.*?)\](\.(.+))?/i);
    if (filterMatch) {
      result.table = filterMatch[1];
      result.filter = this._parseFilter(filterMatch[2]);
      result.targetField = filterMatch[4] || null;
      return result;
    }

    // Simple table.field reference
    const dotMatch = part.match(/([a-z_]+)\.(.+)/i);
    if (dotMatch) {
      result.table = dotMatch[1];
      result.targetField = dotMatch[2];
      return result;
    }

    // Just table name
    result.table = part;
    return result;
  }

  /**
   * Parse filter conditions
   * Example: org_id=$,role='admin'
   * @private
   */
  _parseFilter(filterStr) {
    const conditions = [];
    const parts = filterStr.split(',');

    for (const part of parts) {
      const trimmed = part.trim();

      // Handle various comparison operators
      if (trimmed.includes('=')) {
        const [field, value] = trimmed.split('=').map(s => s.trim());
        conditions.push({
          field,
          operator: '=',
          value: value === '$' ? { type: 'param' } : this._parseValue(value)
        });
      }
    }

    return conditions;
  }

  /**
   * Parse a value (string literal, number, param reference)
   * @private
   */
  _parseValue(value) {
    // String literal
    if (value.startsWith("'") && value.endsWith("'")) {
      return {
        type: 'literal',
        value: value.slice(1, -1)
      };
    }

    // Number
    if (/^\d+$/.test(value)) {
      return {
        type: 'number',
        value: parseInt(value)
      };
    }

    // Field reference
    if (value.startsWith('@')) {
      return {
        type: 'field',
        value: value.substring(1)
      };
    }

    return {
      type: 'literal',
      value
    };
  }

  /**
   * Parse target field (last part of path)
   * Example: user_id or users.user_id
   * @private
   */
  _parseTargetField(part) {
    // Remove temporal marker if present
    part = part.replace('{active}', '');

    // Check for table[filter].field pattern
    const filterMatch = part.match(/([a-z_]+)\[(.*?)\]\.(.+)/i);
    if (filterMatch) {
      return {
        type: 'table_ref',
        table: filterMatch[1],
        filter: this._parseFilter(filterMatch[2]),
        temporal: part.includes('{active}'),
        targetField: filterMatch[3]
      };
    }

    // Simple field reference
    if (!part.includes('.')) {
      return {
        type: 'field_ref',
        field: part
      };
    }

    // Dot notation
    const fields = part.split('.');
    return {
      type: 'dot_path',
      fields
    };
  }

  /**
   * Parse dot path (field.subfield.subsubfield)
   * @private
   */
  _parseDotPath(path) {
    const fields = path.split('.').map(f => f.trim());
    return {
      type: 'dot_path',
      fields
    };
  }

  /**
   * Parse multiple paths (used in permission arrays)
   * @param {Array<string>} paths - Array of path strings
   * @returns {Array<Object>} Array of ASTs
   */
  parseMultiple(paths) {
    if (!Array.isArray(paths)) {
      return [];
    }

    return paths.map(path => this.parse(path));
  }
}

/**
 * Utility function to parse a single path
 * @param {string} path - Path to parse
 * @returns {Object} AST
 */
export function parsePath(path) {
  const parser = new PathParser();
  return parser.parse(path);
}

/**
 * Utility function to parse multiple paths
 * @param {Array<string>} paths - Paths to parse
 * @returns {Array<Object>} ASTs
 */
export function parsePaths(paths) {
  const parser = new PathParser();
  return parser.parseMultiple(paths);
}
