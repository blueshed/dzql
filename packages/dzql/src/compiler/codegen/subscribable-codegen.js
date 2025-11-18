/**
 * Subscribable Code Generator
 * Generates PostgreSQL functions for live query subscriptions
 *
 * For each subscribable, generates:
 * 1. get_<name>(params, user_id) - Query function that builds the document
 * 2. <name>_affected_documents(table, op, old, new) - Determines which subscription instances are affected
 * 3. <name>_can_subscribe(user_id, params) - Access control check
 */

import { PathParser } from '../parser/path-parser.js';

export class SubscribableCodegen {
  constructor(subscribable) {
    this.name = subscribable.name;
    this.permissionPaths = subscribable.permissionPaths || {};
    this.paramSchema = subscribable.paramSchema || {};
    this.rootEntity = subscribable.rootEntity;
    this.relations = subscribable.relations || {};
    this.parser = new PathParser();
  }

  /**
   * Generate all functions for this subscribable
   * @returns {string} SQL for all subscribable functions
   */
  generate() {
    const sections = [];

    // Header comment
    sections.push(this._generateHeader());

    // 1. Access control function
    sections.push(this._generateAccessControlFunction());

    // 2. Query function (builds the document)
    sections.push(this._generateQueryFunction());

    // 3. Affected documents function (determines which subscriptions to update)
    sections.push(this._generateAffectedDocumentsFunction());

    return sections.join('\n\n');
  }

  /**
   * Generate header comment
   * @private
   */
  _generateHeader() {
    return `-- ============================================================================
-- Subscribable: ${this.name}
-- Root Entity: ${this.rootEntity}
-- Generated: ${new Date().toISOString()}
-- ============================================================================`;
  }

  /**
   * Generate access control function
   * @private
   */
  _generateAccessControlFunction() {
    let subscribePaths = this.permissionPaths.subscribe || [];

    // Ensure it's an array
    if (!Array.isArray(subscribePaths)) {
      subscribePaths = [subscribePaths];
    }

    // If no paths, it's public
    if (subscribePaths.length === 0) {
      return `CREATE OR REPLACE FUNCTION ${this.name}_can_subscribe(
  p_user_id INT,
  p_params JSONB
) RETURNS BOOLEAN AS $$
BEGIN
  RETURN TRUE; -- Public access
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;`;
    }

    // Generate permission check logic
    const checks = subscribePaths.map(path => {
      const ast = this.parser.parse(path);
      return this._generatePathCheck(ast, 'p_params', 'p_user_id');
    });

    const checkSQL = checks.join(' OR\n    ');

    return `CREATE OR REPLACE FUNCTION ${this.name}_can_subscribe(
  p_user_id INT,
  p_params JSONB
) RETURNS BOOLEAN AS $$
BEGIN
  RETURN (
    ${checkSQL}
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;`;
  }

  /**
   * Generate path check SQL from AST
   * @private
   */
  _generatePathCheck(ast, recordVar, userIdVar) {
    // Handle direct field reference: @owner_id
    if (ast.type === 'field_ref') {
      return `(${recordVar}->>'${ast.field}')::int = ${userIdVar}`;
    }

    // Handle traversal with steps: @org_id->acts_for[org_id=$]{active}.user_id
    if (ast.type === 'traversal' && ast.steps) {
      const fieldRef = ast.steps[0];  // First step is the field reference
      const tableRef = ast.steps[1];   // Second step is the table reference

      if (!fieldRef || !tableRef || tableRef.type !== 'table_ref') {
        return 'FALSE';
      }

      const startField = fieldRef.field;
      const targetTable = tableRef.table;
      const targetField = tableRef.targetField;

      const startValue = `(${recordVar}->>'${startField}')::int`;

      // Build WHERE clause
      const whereClauses = [];

      // Add filter conditions from the table_ref
      if (tableRef.filter && tableRef.filter.length > 0) {
        for (const filterCondition of tableRef.filter) {
          const field = filterCondition.field;
          if (filterCondition.value.type === 'param') {
            // Parameter reference: org_id=$
            whereClauses.push(`${targetTable}.${field} = ${startValue}`);
          } else {
            // Literal value
            whereClauses.push(`${targetTable}.${field} = '${filterCondition.value}'`);
          }
        }
      }

      // Add temporal marker if present
      if (tableRef.temporal) {
        whereClauses.push(`${targetTable}.valid_to IS NULL`);
      }

      return `EXISTS (
      SELECT 1 FROM ${targetTable}
      WHERE ${whereClauses.join('\n        AND ')}
        AND ${targetTable}.${targetField} = ${userIdVar}
    )`;
    }

    return 'FALSE';
  }

  /**
   * Generate filter SQL
   * @private
   */
  _generateFilterSQL(filter, tableAlias) {
    const conditions = [];
    for (const [key, value] of Object.entries(filter)) {
      if (value === '$') {
        // Placeholder - will be replaced with actual value
        conditions.push(`${tableAlias}.${key} = ${tableAlias}.${key}`);
      } else {
        conditions.push(`${tableAlias}.${key} = '${value}'`);
      }
    }
    return conditions.join(' AND ');
  }

  /**
   * Generate query function that builds the document
   * @private
   */
  _generateQueryFunction() {
    const params = Object.keys(this.paramSchema);
    const paramDeclarations = params.map(p => `  v_${p} ${this.paramSchema[p]};`).join('\n');
    const paramExtractions = params.map(p =>
      `  v_${p} := (p_params->>'${p}')::${this.paramSchema[p]};`
    ).join('\n');

    // Build root WHERE clause based on params
    const rootFilter = this._generateRootFilter();

    // Build relation subqueries
    const relationSelects = this._generateRelationSelects();

    return `CREATE OR REPLACE FUNCTION get_${this.name}(
  p_params JSONB,
  p_user_id INT
) RETURNS JSONB AS $$
DECLARE
${paramDeclarations}
  v_result JSONB;
BEGIN
  -- Extract parameters
${paramExtractions}

  -- Check access control
  IF NOT ${this.name}_can_subscribe(p_user_id, p_params) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  -- Build document with root and all relations
  SELECT jsonb_build_object(
    '${this.rootEntity}', row_to_json(root.*)${relationSelects}
  )
  INTO v_result
  FROM ${this.rootEntity} root
  WHERE ${rootFilter};

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;`;
  }

  /**
   * Generate root filter based on params
   * @private
   */
  _generateRootFilter() {
    const params = Object.keys(this.paramSchema);

    // Assume first param is the root entity ID
    // TODO: Make this more flexible based on param naming conventions
    if (params.length > 0) {
      const firstParam = params[0];
      // Convention: venue_id -> id, org_id -> id, etc.
      return `root.id = v_${firstParam}`;
    }

    return 'TRUE';
  }

  /**
   * Generate relation subqueries
   * @private
   */
  _generateRelationSelects() {
    if (Object.keys(this.relations).length === 0) {
      return '';
    }

    const selects = Object.entries(this.relations).map(([relName, relConfig]) => {
      const relEntity = typeof relConfig === 'string' ? relConfig : relConfig.entity;
      const relFilter = typeof relConfig === 'object' ? relConfig.filter : null;
      const relIncludes = typeof relConfig === 'object' ? relConfig.include : null;

      // Build filter condition
      let filterSQL = this._generateRelationFilter(relFilter, relEntity);

      // Build nested includes if any
      let nestedSelect = 'row_to_json(rel.*)';
      if (relIncludes) {
        const nestedFields = Object.entries(relIncludes).map(([nestedName, nestedEntity]) => {
          return `'${nestedName}', (
          SELECT jsonb_agg(row_to_json(nested.*))
          FROM ${nestedEntity} nested
          WHERE nested.${relEntity}_id = rel.id
        )`;
        }).join(',\n        ');

        nestedSelect = `jsonb_build_object(
        '${relEntity}', row_to_json(rel.*),
        ${nestedFields}
      )`;
      }

      return `,
    '${relName}', (
      SELECT jsonb_agg(${nestedSelect})
      FROM ${relEntity} rel
      WHERE ${filterSQL}
    )`;
    }).join('');

    return selects;
  }

  /**
   * Generate filter for relation subquery
   * @private
   */
  _generateRelationFilter(filter, relEntity) {
    if (!filter) {
      // Default: foreign key to root
      return `rel.${this.rootEntity}_id = root.id`;
    }

    // Parse filter expression like "venue_id=$venue_id"
    // Replace $param with v_param variable
    return filter.replace(/\$(\w+)/g, 'v_$1');
  }

  /**
   * Generate affected documents function
   * @private
   */
  _generateAffectedDocumentsFunction() {
    const cases = [];

    // Case 1: Root entity changed
    cases.push(this._generateRootAffectedCase());

    // Case 2: Related entities changed
    for (const [relName, relConfig] of Object.entries(this.relations)) {
      cases.push(this._generateRelationAffectedCase(relName, relConfig));
    }

    const casesSQL = cases.join('\n\n    ');

    return `CREATE OR REPLACE FUNCTION ${this.name}_affected_documents(
  p_table_name TEXT,
  p_op TEXT,
  p_old JSONB,
  p_new JSONB
) RETURNS JSONB[] AS $$
DECLARE
  v_affected JSONB[];
BEGIN
  CASE p_table_name
    ${casesSQL}

    ELSE
      v_affected := ARRAY[]::JSONB[];
  END CASE;

  RETURN v_affected;
END;
$$ LANGUAGE plpgsql IMMUTABLE;`;
  }

  /**
   * Generate case for root entity changes
   * @private
   */
  _generateRootAffectedCase() {
    const params = Object.keys(this.paramSchema);
    const firstParam = params[0] || 'id';

    return `-- Root entity (${this.rootEntity}) changed
    WHEN '${this.rootEntity}' THEN
      v_affected := ARRAY[
        jsonb_build_object('${firstParam}', COALESCE((p_new->>'id')::int, (p_old->>'id')::int))
      ];`;
  }

  /**
   * Generate case for related entity changes
   * @private
   */
  _generateRelationAffectedCase(relName, relConfig) {
    const relEntity = typeof relConfig === 'string' ? relConfig : relConfig.entity;
    const relFK = typeof relConfig === 'object' && relConfig.foreignKey
      ? relConfig.foreignKey
      : `${this.rootEntity}_id`;

    const params = Object.keys(this.paramSchema);
    const firstParam = params[0] || 'id';

    // Check if this is a nested relation (has parent FK)
    const nestedIncludes = typeof relConfig === 'object' ? relConfig.include : null;

    if (nestedIncludes) {
      // Nested relation: need to traverse up to root
      return `-- Nested relation (${relEntity}) changed
    WHEN '${relEntity}' THEN
      -- Find parent and then root
      SELECT ARRAY_AGG(jsonb_build_object('${firstParam}', parent.${this.rootEntity}_id))
      INTO v_affected
      FROM ${relEntity} rel
      JOIN ${Object.keys(nestedIncludes)[0]} parent ON parent.id = rel.${Object.keys(nestedIncludes)[0]}_id
      WHERE rel.id = COALESCE((p_new->>'id')::int, (p_old->>'id')::int);`;
    }

    return `-- Related entity (${relEntity}) changed
    WHEN '${relEntity}' THEN
      v_affected := ARRAY[
        jsonb_build_object('${firstParam}', COALESCE((p_new->>'${relFK}')::int, (p_old->>'${relFK}')::int))
      ];`;
  }
}

/**
 * Generate subscribable functions from config
 * @param {Object} subscribable - Subscribable configuration
 * @returns {string} Generated SQL
 */
export function generateSubscribable(subscribable) {
  const codegen = new SubscribableCodegen(subscribable);
  return codegen.generate();
}
