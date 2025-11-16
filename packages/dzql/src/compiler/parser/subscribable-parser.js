/**
 * Subscribable Definition Parser
 * Parses register_subscribable() calls and extracts configuration
 */

export class SubscribableParser {
  /**
   * Parse a dzql.register_subscribable() call from SQL
   * @param {string} sql - SQL containing register_subscribable call
   * @returns {Object} Parsed subscribable configuration
   */
  parseFromSQL(sql) {
    // Extract the register_subscribable call
    const registerMatch = sql.match(/dzql\.register_subscribable\s*\(([\s\S]*?)\);/i);
    if (!registerMatch) {
      throw new Error('No register_subscribable call found in SQL');
    }

    const params = this._parseParameters(registerMatch[1]);

    return this._buildSubscribableConfig(params);
  }

  /**
   * Parse parameters from register_subscribable call
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

    return params;
  }

  /**
   * Build subscribable configuration from parsed parameters
   * register_subscribable(name, permission_paths, param_schema, root_entity, relations)
   * @private
   */
  _buildSubscribableConfig(params) {
    const config = {
      name: this._cleanString(params[0]),
      permissionPaths: params[1] ? this._parseJSON(params[1]) : {},
      paramSchema: params[2] ? this._parseJSON(params[2]) : {},
      rootEntity: this._cleanString(params[3]),
      relations: params[4] ? this._parseJSON(params[4]) : {}
    };

    return config;
  }

  /**
   * Parse from JavaScript object (for programmatic usage)
   * @param {Object} obj - Subscribable configuration object
   * @returns {Object} Normalized configuration
   */
  parseFromObject(obj) {
    return {
      name: obj.name,
      permissionPaths: obj.permissionPaths || obj.permissions || {},
      paramSchema: obj.paramSchema || obj.params || {},
      rootEntity: obj.rootEntity || obj.root,
      relations: obj.relations || {}
    };
  }

  /**
   * Parse multiple subscribables from SQL file
   * @param {string} sql - SQL file content
   * @returns {Array} Array of subscribable configurations
   */
  parseAllFromSQL(sql) {
    const subscribables = [];
    const regex = /dzql\.register_subscribable\s*\(([\s\S]*?)\);/gi;
    let match;

    while ((match = regex.exec(sql)) !== null) {
      try {
        const params = this._parseParameters(match[1]);
        const config = this._buildSubscribableConfig(params);
        subscribables.push(config);
      } catch (error) {
        console.error('Failed to parse subscribable:', error.message);
      }
    }

    return subscribables;
  }

  /**
   * Clean a string parameter (remove quotes)
   * @private
   */
  _cleanString(str) {
    if (!str) return '';
    // Remove outer quotes, SQL comments, then any remaining quotes and whitespace
    let cleaned = str.replace(/^['"]|['"]$/g, '');  // Remove outer quotes
    cleaned = cleaned.replace(/--[^\n]*/g, '');     // Remove SQL comments
    cleaned = cleaned.replace(/['"\s]+$/g, '');     // Remove trailing quotes/whitespace
    return cleaned.trim();
  }

  /**
   * Parse JSONB object parameter
   * @private
   */
  _parseJSON(str) {
    if (!str || str === '{}' || str === "'{}'::jsonb") {
      return {};
    }

    // Handle jsonb_build_object() syntax
    if (str.includes('jsonb_build_object')) {
      return this._parseJSONBuildObject(str);
    }

    // Handle plain JSON string
    try {
      // Remove ::jsonb cast
      let cleaned = str.replace(/::jsonb$/i, '');
      // Remove outer quotes if it's a string literal
      cleaned = cleaned.replace(/^'(.*)'$/, '$1');
      // Unescape internal quotes
      cleaned = cleaned.replace(/''/g, "'");

      return JSON.parse(cleaned);
    } catch (error) {
      console.error('Failed to parse JSON:', str, error);
      return {};
    }
  }

  /**
   * Parse jsonb_build_object() calls
   * @private
   */
  _parseJSONBuildObject(str) {
    const result = {};

    // Extract content between jsonb_build_object( and )
    const match = str.match(/jsonb_build_object\s*\(([\s\S]*)\)/i);
    if (!match) return result;

    // Parse key-value pairs
    const params = this._parseParameters(match[1]);

    for (let i = 0; i < params.length; i += 2) {
      if (i + 1 < params.length) {
        const key = this._cleanString(params[i]);
        let value = params[i + 1];

        // Check if value is nested jsonb_build_object or array
        if (value.includes('jsonb_build_object')) {
          value = this._parseJSONBuildObject(value);
        } else if (value.includes('jsonb_build_array')) {
          value = this._parseJSONBArray(value);
        } else if (value.includes('ARRAY[')) {
          value = this._parseArray(value);
        } else {
          value = this._cleanString(value);
        }

        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Parse jsonb_build_array() calls
   * @private
   */
  _parseJSONBArray(str) {
    const match = str.match(/jsonb_build_array\s*\(([\s\S]*)\)/i);
    if (!match) return [];

    const params = this._parseParameters(match[1]);
    return params.map(p => {
      if (p.includes('jsonb_build_object')) {
        return this._parseJSONBuildObject(p);
      }
      return this._cleanString(p);
    });
  }

  /**
   * Parse ARRAY[...] syntax
   * @private
   */
  _parseArray(str) {
    if (!str || str === 'ARRAY[]::text[]') {
      return [];
    }

    // Extract content between ARRAY[ and ]
    const match = str.match(/ARRAY\[(.*?)\]/i);
    if (!match) return [];

    // Split by comma and clean each element
    return match[1]
      .split(',')
      .map(s => this._cleanString(s))
      .filter(s => s.length > 0);
  }
}
