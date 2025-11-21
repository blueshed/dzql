/**
 * Entity Definition Parser
 * Parses entity registration calls and extracts configuration
 */

export class EntityParser {
  /**
   * Parse a dzql.register_entity() call from SQL
   * @param {string} sql - SQL containing register_entity call
   * @param {number} startOffset - Optional starting position in SQL
   * @returns {Object} Parsed entity configuration with custom functions
   */
  parseFromSQL(sql, startOffset = 0) {
    // Extract the register_entity call
    const searchSql = sql.substring(startOffset);
    const registerMatch = searchSql.match(/dzql\.register_entity\s*\(([\s\S]*?)\);/i);
    if (!registerMatch) {
      throw new Error('No register_entity call found in SQL');
    }

    const params = this._parseParameters(registerMatch[1]);
    const config = this._buildEntityConfig(params);

    // Extract custom functions after this register_entity call
    const registerEndPos = startOffset + registerMatch.index + registerMatch[0].length;
    config.customFunctions = this._extractCustomFunctions(sql, registerEndPos);

    return config;
  }

  /**
   * Parse parameters from register_entity call
   * @private
   */
  _parseParameters(paramsString) {
    // Split by commas that are not inside quotes, parentheses, or brackets
    const params = [];
    let currentParam = '';
    let depth = 0;
    let inString = false;
    let stringChar = null;

    for (let i = 0; i < paramsString.length; i++) {
      const char = paramsString[i];
      const prevChar = i > 0 ? paramsString[i - 1] : '';

      if ((char === "'" || char === '"') && prevChar !== '\\') {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          inString = false;
          stringChar = null;
        }
      }

      if (!inString) {
        if (char === '(' || char === '{' || char === '[') depth++;
        if (char === ')' || char === '}' || char === ']') depth--;

        if (char === ',' && depth === 0) {
          params.push(currentParam.trim());
          currentParam = '';
          continue;
        }
      }

      currentParam += char;
    }

    if (currentParam.trim()) {
      params.push(currentParam.trim());
    }

    // Strip SQL comments (-- ...) from each parameter
    return params.map(param => {
      // Remove everything after -- (SQL line comment)
      return param.split('\n').map(line => {
        const commentIndex = line.indexOf('--');
        if (commentIndex !== -1) {
          return line.substring(0, commentIndex);
        }
        return line;
      }).join('\n').trim();
    });
  }

  /**
   * Build entity configuration from parsed parameters
   * @private
   */
  _buildEntityConfig(params) {
    const graphRules = params[8] ? this._parseJSON(params[8]) : {};

    // Extract many_to_many from graph_rules if present
    const manyToMany = graphRules.many_to_many || {};

    const config = {
      tableName: this._cleanString(params[0]),
      labelField: this._cleanString(params[1]),
      searchableFields: this._parseArray(params[2]),
      fkIncludes: params[3] ? this._parseJSON(params[3]) : {},
      softDelete: params[4] ? this._parseBoolean(params[4]) : false,
      temporalFields: params[5] ? this._parseJSON(params[5]) : {},
      notificationPaths: params[6] ? this._parseJSON(params[6]) : {},
      permissionPaths: params[7] ? this._parseJSON(params[7]) : {},
      graphRules: graphRules,
      fieldDefaults: params[9] ? this._parseJSON(params[9]) : {},
      manyToMany: manyToMany
    };

    return config;
  }

  /**
   * Clean a string parameter (remove quotes)
   * @private
   */
  _cleanString(str) {
    if (!str) return '';
    // Remove SQL comments first, then outer quotes
    let cleaned = str.replace(/--[^\n]*/g, '');     // Remove SQL comments
    cleaned = cleaned.trim();                        // Remove whitespace
    cleaned = cleaned.replace(/^['"]|['"]$/g, '');  // Remove outer quotes
    return cleaned;
  }

  /**
   * Parse an array parameter
   * @private
   */
  _parseArray(str) {
    if (!str || str === 'array[]::text[]') return [];

    // Handle array['item1', 'item2'] format
    // Use greedy match to get everything up to the last ] before optional ::type
    const match = str.match(/array\[(.*)\](?:::.*)?$/i);
    if (!match) return [];

    // Split on commas that are not inside brackets or quotes
    const items = [];
    let current = '';
    let depth = 0;
    let inString = false;
    let stringChar = null;

    for (let i = 0; i < match[1].length; i++) {
      const char = match[1][i];
      const prev = i > 0 ? match[1][i - 1] : '';

      if ((char === "'" || char === '"') && prev !== '\\') {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          inString = false;
          stringChar = null;
        }
      }

      if (!inString) {
        if (char === '[') depth++;
        if (char === ']') depth--;

        if (char === ',' && depth === 0) {
          items.push(current.trim().replace(/^['"]|['"]$/g, ''));
          current = '';
          continue;
        }
      }

      current += char;
    }

    if (current.trim()) {
      items.push(current.trim().replace(/^['"]|['"]$/g, ''));
    }

    return items.filter(item => item.length > 0);
  }

  /**
   * Parse a JSONB parameter
   * @private
   */
  _parseJSON(str) {
    if (!str || str === '{}' || str === "'{}'") return {};

    // Strip SQL comments before parsing
    str = str.replace(/--[^\n]*/g, '').trim();

    // Handle jsonb_build_object(...) calls
    if (str.includes('jsonb_build_object')) {
      return this._parseJSONBuildObject(str);
    }

    // Handle JSON string literals
    if (str.startsWith("'") && str.endsWith("'")) {
      try {
        // Remove outer quotes and unescape SQL quotes
        const jsonStr = str.slice(1, -1).replace(/''/g, "'");
        return JSON.parse(jsonStr);
      } catch (e) {
        console.warn('Failed to parse JSON:', str.substring(0, 100) + '...', e);
        return {};
      }
    }

    return {};
  }

  /**
   * Parse jsonb_build_object(...) calls recursively
   * @private
   */
  _parseJSONBuildObject(str) {
    // Extract the content between jsonb_build_object( and )
    const match = str.match(/jsonb_build_object\s*\(([\s\S]*)\)/i);
    if (!match) return {};

    const content = match[1];
    const params = this._parseParameters(content);
    const result = {};

    // Process key-value pairs
    for (let i = 0; i < params.length; i += 2) {
      if (i + 1 >= params.length) break;

      const key = this._cleanString(params[i]);
      const value = params[i + 1];

      // Handle nested jsonb_build_object
      if (value.includes('jsonb_build_object')) {
        result[key] = this._parseJSONBuildObject(value);
      }
      // Handle jsonb_build_array
      else if (value.includes('jsonb_build_array')) {
        result[key] = this._parseJSONBuildArray(value);
      }
      // Handle array literal
      else if (value.startsWith('array[')) {
        result[key] = this._parseArray(value);
      }
      // Handle simple values
      else {
        const cleanValue = this._cleanString(value);
        result[key] = cleanValue;
      }
    }

    return result;
  }

  /**
   * Parse jsonb_build_array(...) calls
   * @private
   */
  _parseJSONBuildArray(str) {
    const match = str.match(/jsonb_build_array\s*\(([\s\S]*)\)/i);
    if (!match) return [];

    const content = match[1];
    const params = this._parseParameters(content);

    return params.map(param => {
      if (param.includes('jsonb_build_object')) {
        return this._parseJSONBuildObject(param);
      }
      return this._cleanString(param);
    });
  }

  /**
   * Parse boolean value
   * @private
   */
  _parseBoolean(str) {
    const cleaned = str.trim().toLowerCase();
    return cleaned === 'true' || cleaned === 't';
  }

  /**
   * Extract custom functions defined after register_entity() call
   * @private
   * @param {string} sql - Full SQL content
   * @param {number} startPos - Position after register_entity call
   * @returns {Array<string>} Array of custom function SQL statements
   */
  _extractCustomFunctions(sql, startPos) {
    // Find the next register_entity call or end of file
    const nextEntityMatch = sql.substring(startPos).match(/dzql\.register_entity\s*\(/i);
    const endPos = nextEntityMatch ? startPos + nextEntityMatch.index : sql.length;

    // Extract the SQL between this entity and the next
    const customSql = sql.substring(startPos, endPos).trim();
    if (!customSql) return [];

    const functions = [];

    // Extract CREATE [OR REPLACE] FUNCTION statements
    // Match from CREATE to the final semicolon of the function (including $$ delimiters)
    const functionPattern = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+[\s\S]*?(?:\$\$|\$[A-Za-z_][A-Za-z0-9_]*\$)\s*(?:LANGUAGE|;)[\s\S]*?;/gi;
    let match;
    while ((match = functionPattern.exec(customSql)) !== null) {
      functions.push(match[0].trim());
    }

    // Extract INSERT INTO dzql.registry statements
    const registryPattern = /INSERT\s+INTO\s+dzql\.registry\s+[\s\S]*?;/gi;
    while ((match = registryPattern.exec(customSql)) !== null) {
      functions.push(match[0].trim());
    }

    // Extract SELECT dzql.register_function() calls
    const registerFunctionPattern = /SELECT\s+dzql\.register_function\s*\([\s\S]*?\)\s*;/gi;
    while ((match = registerFunctionPattern.exec(customSql)) !== null) {
      functions.push(match[0].trim());
    }

    return functions;
  }

  /**
   * Parse entity definition from JS object (for programmatic use)
   * @param {Object} entity - Entity definition object
   * @returns {Object} Normalized entity configuration
   */
  parseFromObject(entity) {
    const graphRules = entity.graphRules || {};
    const manyToMany = entity.manyToMany || graphRules.many_to_many || {};

    return {
      tableName: entity.tableName || entity.table,
      labelField: entity.labelField || 'name',
      searchableFields: entity.searchableFields || [],
      fkIncludes: entity.fkIncludes || {},
      softDelete: entity.softDelete || false,
      temporalFields: entity.temporalFields || {},
      notificationPaths: entity.notificationPaths || {},
      permissionPaths: entity.permissionPaths || {},
      graphRules: graphRules,
      fieldDefaults: entity.fieldDefaults || {},
      manyToMany: manyToMany,
      customFunctions: entity.customFunctions || []
    };
  }
}

/**
 * Parse all entities from a SQL file
 * @param {string} sql - SQL file content
 * @returns {Array} Array of parsed entity configurations
 */
export function parseEntitiesFromSQL(sql) {
  const parser = new EntityParser();
  const entities = [];

  // Find all register_entity calls with their positions
  const registerPattern = /dzql\.register_entity\s*\(/gi;
  let match;
  let currentPos = 0;

  while ((match = registerPattern.exec(sql)) !== null) {
    try {
      const entity = parser.parseFromSQL(sql, match.index);
      entities.push(entity);
      currentPos = match.index + 1; // Move past this match
    } catch (error) {
      console.warn('Failed to parse entity:', error.message);
    }
  }

  return entities;
}
