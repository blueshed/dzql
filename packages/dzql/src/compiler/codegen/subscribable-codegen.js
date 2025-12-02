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

    // Check if any path references root entity fields (needs database lookup)
    const needsEntityLookup = subscribePaths.some(path => {
      const ast = this.parser.parse(path);
      return ast.type === 'direct_field' || ast.type === 'field_ref';
    });

    // Generate permission check logic
    const checks = subscribePaths.map(path => {
      const ast = this.parser.parse(path);
      return this._generatePathCheck(ast, needsEntityLookup ? 'entity' : 'p_params', 'p_user_id');
    });

    const checkSQL = checks.join(' OR\n    ');

    // If we need entity lookup, fetch it first
    if (needsEntityLookup) {
      const params = Object.keys(this.paramSchema);
      const paramDeclarations = params.map(p => `  v_${p} ${this.paramSchema[p]};`).join('\n');
      const paramExtractions = params.map(p =>
        `  v_${p} := (p_params->>'${p}')::${this.paramSchema[p]};`
      ).join('\n');

      const rootFilter = this._generateRootFilter();

      return `CREATE OR REPLACE FUNCTION ${this.name}_can_subscribe(
  p_user_id INT,
  p_params JSONB
) RETURNS BOOLEAN AS $$
DECLARE
${paramDeclarations}
  entity RECORD;
BEGIN
  -- Extract parameters
${paramExtractions}

  -- Fetch entity
  SELECT * INTO entity
  FROM ${this.rootEntity} root
  WHERE ${rootFilter};

  -- Entity not found
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Check permissions
  RETURN (
    ${checkSQL}
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;`;
    }

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
    if (ast.type === 'direct_field' || ast.type === 'field_ref') {
      // If recordVar is 'entity' (RECORD type), access directly
      if (recordVar === 'entity') {
        return `${recordVar}.${ast.field} = ${userIdVar}`;
      }
      // Otherwise it's p_params (JSONB type)
      return `(${recordVar}->>'${ast.field}')::int = ${userIdVar}`;
    }

    // Handle traversal with steps: @org_id->acts_for[org_id=$]{active}.user_id
    if (ast.type === 'traversal' && ast.steps) {
      const fieldRef = ast.steps[0];  // First step is the field reference
      const tableRef = ast.steps[1];   // Second step is the table reference

      if (!fieldRef || !tableRef || tableRef.type !== 'table_ref') {
        return 'FALSE';
      }

      const targetTable = tableRef.table;
      const targetField = tableRef.targetField;

      // Build WHERE clause
      const whereClauses = [];

      // Add filter conditions from the table_ref
      if (tableRef.filter && tableRef.filter.length > 0) {
        for (const filterCondition of tableRef.filter) {
          const field = filterCondition.field;
          if (filterCondition.value.type === 'param') {
            // Parameter reference: org_id=$ means use the filter field name as the param key
            // e.g., acts_for[organisation_id=$] -> (p_params->>'organisation_id')::int
            const paramValue = `(${recordVar}->>'${field}')::int`;
            whereClauses.push(`${targetTable}.${field} = ${paramValue}`);
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

    // Build schema with path mapping and scope tables (baked in at compile time)
    const pathMapping = this.buildPathMapping();
    const scopeTables = this.extractScopeTables();
    const schemaJson = JSON.stringify({
      root: this.rootEntity,
      paths: pathMapping,
      scopeTables: scopeTables
    });

    return `CREATE OR REPLACE FUNCTION get_${this.name}(
  p_params JSONB,
  p_user_id INT
) RETURNS JSONB AS $$
DECLARE
${paramDeclarations}
  v_data JSONB;
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
  INTO v_data
  FROM ${this.rootEntity} root
  WHERE ${rootFilter};

  -- Return data with embedded schema for atomic updates
  RETURN jsonb_build_object(
    'data', v_data,
    'schema', '${schemaJson}'::jsonb
  );
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
      const relVia = typeof relConfig === 'object' ? relConfig.via : null;

      // Build nested includes if any
      let nestedSelect = 'row_to_json(rel.*)';
      if (relIncludes) {
        const nestedFields = Object.entries(relIncludes).map(([nestedName, nestedEntity]) => {
          return `'${nestedName}', (
          SELECT COALESCE(jsonb_agg(row_to_json(nested.*)), '[]'::jsonb)
          FROM ${nestedEntity} nested
          WHERE nested.${relEntity}_id = rel.id
        )`;
        }).join(',\n        ');

        nestedSelect = `jsonb_build_object(
        '${relEntity}', row_to_json(rel.*),
        ${nestedFields}
      )`;
      }

      // Handle via relations with JOINs
      if (relVia) {
        const { joinClause, whereClause } = this._generateViaJoin(relConfig);
        return `,
    '${relName}', COALESCE((
      SELECT jsonb_agg(${nestedSelect})
      FROM ${relEntity} rel
      ${joinClause}
      WHERE ${whereClause}
    ), '[]'::jsonb)`;
      }

      // Direct relation (no via)
      let filterSQL = this._generateRelationFilter(relFilter, relEntity, relConfig);

      return `,
    '${relName}', COALESCE((
      SELECT jsonb_agg(${nestedSelect})
      FROM ${relEntity} rel
      WHERE ${filterSQL}
    ), '[]'::jsonb)`;
    }).join('');

    return selects;
  }

  /**
   * Generate JOIN clause for via relations
   * Handles multi-hop via chains by looking up each intermediate table
   * @private
   * @param {Object} relConfig - Relation config with via property
   * @returns {Object} { joinClause, whereClause }
   */
  _generateViaJoin(relConfig) {
    const via = relConfig.via;
    const fk = relConfig.foreignKey;

    // Parse via: "products.id" -> table: products, column: id
    const [viaTable, viaColumn] = via.split('.');

    // Build the join chain by following via references
    const joinClauses = [];
    const viaChain = this._buildViaChain(viaTable);

    // First join: rel -> first via table
    joinClauses.push(`JOIN ${viaTable} via_${viaTable} ON rel.${fk} = via_${viaTable}.${viaColumn}`);

    // Additional joins for multi-hop
    for (let i = 0; i < viaChain.length; i++) {
      const current = viaChain[i];
      const next = viaChain[i + 1];

      if (next) {
        // Join current via table to next via table
        joinClauses.push(`JOIN ${next.table} via_${next.table} ON via_${current.table}.${current.fk} = via_${next.table}.${next.column}`);
      }
    }

    // Final WHERE clause connects to root
    const lastVia = viaChain.length > 0 ? viaChain[viaChain.length - 1] : { table: viaTable };
    const params = Object.keys(this.paramSchema);
    const rootFK = params[0] || `${this.rootEntity}_id`;
    const whereClause = `via_${lastVia.table}.${rootFK} = root.id`;

    return { joinClause: joinClauses.join('\n      '), whereClause };
  }

  /**
   * Build the via chain from a starting table back to root
   * @private
   * @param {string} startTable - The table to start from
   * @returns {Array} Chain of {table, fk, column} objects
   */
  _buildViaChain(startTable) {
    const chain = [];
    let currentTable = startTable;

    // Find the relation config for this table
    const findRelConfig = (tableName) => {
      for (const [relName, relConfig] of Object.entries(this.relations)) {
        if (typeof relConfig === 'object' && relConfig.entity === tableName) {
          return relConfig;
        }
        if (relName === tableName && typeof relConfig === 'object') {
          return relConfig;
        }
      }
      return null;
    };

    // Follow via chain until we reach a table without via (direct to root)
    let relConfig = findRelConfig(currentTable);
    while (relConfig && relConfig.via) {
      const [nextTable, nextColumn] = relConfig.via.split('.');
      chain.push({
        table: currentTable,
        fk: relConfig.foreignKey,
        column: nextColumn
      });
      currentTable = nextTable;
      relConfig = findRelConfig(currentTable);
    }

    // Add final table (direct connection to root)
    if (currentTable !== startTable) {
      const finalConfig = findRelConfig(currentTable);
      chain.push({
        table: currentTable,
        fk: finalConfig ? finalConfig.foreignKey : `${this.rootEntity}_id`,
        column: 'id'
      });
    }

    return chain;
  }

  /**
   * Generate filter for relation subquery
   * @private
   * @param {string|null} filter - Optional filter expression
   * @param {string} relEntity - Related entity table name
   * @param {Object} relConfig - Full relation config (may contain foreignKey)
   */
  _generateRelationFilter(filter, relEntity, relConfig) {
    if (!filter) {
      // Use explicit foreignKey from config, or default to root_id
      const fk = (typeof relConfig === 'object' && relConfig.foreignKey)
        ? relConfig.foreignKey
        : `${this.rootEntity}_id`;
      return `rel.${fk} = root.id`;
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
  p_data JSONB
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
        jsonb_build_object('${firstParam}', (p_data->>'id')::int)
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
    const relVia = typeof relConfig === 'object' ? relConfig.via : null;

    const params = Object.keys(this.paramSchema);
    const firstParam = params[0] || 'id';

    // Check if this is a nested relation (has parent FK)
    const nestedIncludes = typeof relConfig === 'object' ? relConfig.include : null;

    // Handle via relations: need to traverse via path to root
    if (relVia) {
      const [viaTable, viaColumn] = relVia.split('.');
      const viaChain = this._buildViaChain(viaTable);

      // Build multi-hop join chain for affected documents
      if (viaChain.length > 1) {
        // Multi-hop: need to join through intermediate tables
        const joins = [];
        const pathDesc = [relEntity, ...viaChain.map(v => v.table), this.rootEntity].join(' -> ');

        // First table in chain
        let prevAlias = 'via_0';
        joins.push(`FROM ${viaTable} ${prevAlias}`);

        // Join through chain
        for (let i = 0; i < viaChain.length - 1; i++) {
          const current = viaChain[i];
          const next = viaChain[i + 1];
          const nextAlias = `via_${i + 1}`;
          joins.push(`JOIN ${next.table} ${nextAlias} ON ${prevAlias}.${current.fk} = ${nextAlias}.${next.column}`);
          prevAlias = nextAlias;
        }

        return `-- Via relation (${relEntity} via chain) changed
    WHEN '${relEntity}' THEN
      -- Traverse via path: ${pathDesc}
      SELECT ARRAY_AGG(DISTINCT jsonb_build_object('${firstParam}', ${prevAlias}.${firstParam}))
      INTO v_affected
      ${joins.join('\n      ')}
      WHERE via_0.${viaColumn} = (p_data->>'${relFK}')::int;`;
      }

      // Single-hop via
      return `-- Via relation (${relEntity} via ${viaTable}) changed
    WHEN '${relEntity}' THEN
      -- Traverse via path: ${relEntity} -> ${viaTable} -> ${this.rootEntity}
      SELECT ARRAY_AGG(DISTINCT jsonb_build_object('${firstParam}', via_tbl.${firstParam}))
      INTO v_affected
      FROM ${viaTable} via_tbl
      WHERE via_tbl.${viaColumn} = (p_data->>'${relFK}')::int;`;
    }

    if (nestedIncludes) {
      // Nested relation: need to traverse up to root
      return `-- Nested relation (${relEntity}) changed
    WHEN '${relEntity}' THEN
      -- Find parent and then root
      SELECT ARRAY_AGG(jsonb_build_object('${firstParam}', parent.${this.rootEntity}_id))
      INTO v_affected
      FROM ${relEntity} rel
      JOIN ${Object.keys(nestedIncludes)[0]} parent ON parent.id = rel.${Object.keys(nestedIncludes)[0]}_id
      WHERE rel.id = (p_data->>'id')::int;`;
    }

    return `-- Related entity (${relEntity}) changed
    WHEN '${relEntity}' THEN
      v_affected := ARRAY[
        jsonb_build_object('${firstParam}', (p_data->>'${relFK}')::int)
      ];`;
  }

  /**
   * Extract all tables in scope for this subscribable
   * Used for efficient event filtering - only events from these tables need consideration
   * @returns {string[]} Array of table names
   */
  extractScopeTables() {
    const tables = new Set([this.rootEntity]);

    const extractFromRelations = (relations) => {
      for (const [relName, relConfig] of Object.entries(relations || {})) {
        const entity = typeof relConfig === 'string' ? relConfig : relConfig.entity;
        if (entity) tables.add(entity);

        // Extract table from via path: "products.id" -> "products"
        if (typeof relConfig === 'object' && relConfig.via) {
          const viaTable = relConfig.via.split('.')[0];
          tables.add(viaTable);
        }

        // Handle nested relations (include or relations)
        if (typeof relConfig === 'object') {
          if (relConfig.include) {
            extractFromRelations(relConfig.include);
          }
          if (relConfig.relations) {
            extractFromRelations(relConfig.relations);
          }
        }
      }
    };

    extractFromRelations(this.relations);
    return Array.from(tables);
  }

  /**
   * Build path mapping for client-side patching
   * Maps table names to their path in the document structure
   * @returns {Object} Map of table name -> document path
   */
  buildPathMapping() {
    const paths = {};

    // Root entity maps to top level
    paths[this.rootEntity] = '.';

    const buildPaths = (relations, parentPath = '') => {
      for (const [relName, relConfig] of Object.entries(relations || {})) {
        const entity = typeof relConfig === 'string' ? relConfig : relConfig.entity;
        const currentPath = parentPath ? `${parentPath}.${relName}` : relName;

        if (entity) {
          paths[entity] = currentPath;
        }

        // Handle nested relations
        if (typeof relConfig === 'object') {
          if (relConfig.include) {
            buildPaths(relConfig.include, currentPath);
          }
          if (relConfig.relations) {
            buildPaths(relConfig.relations, currentPath);
          }
        }
      }
    };

    buildPaths(this.relations);
    return paths;
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

/**
 * Extract scope tables from subscribable config
 * @param {Object} subscribable - Subscribable configuration
 * @returns {string[]} Array of table names in scope
 */
export function extractScopeTables(subscribable) {
  const codegen = new SubscribableCodegen(subscribable);
  return codegen.extractScopeTables();
}

/**
 * Build path mapping from subscribable config
 * @param {Object} subscribable - Subscribable configuration
 * @returns {Object} Map of table name -> document path
 */
export function buildPathMapping(subscribable) {
  const codegen = new SubscribableCodegen(subscribable);
  return codegen.buildPathMapping();
}
