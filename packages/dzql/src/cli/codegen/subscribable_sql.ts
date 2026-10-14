/**
 * Subscribable SQL Code Generator
 * Generates PostgreSQL functions for live query subscriptions
 *
 * For each subscribable, generates:
 * 1. get_<name>(p_params, p_user_id) - Query function that builds the document
 * 2. <name>_can_subscribe(p_user_id, p_params) - Access control check
 * 3. <name>_affected_keys(p_table, p_op, p_data) - Determines which subscriptions are affected
 */

import type { SubscribableIR, IncludeIR, EntityIR } from "../../shared/ir.js";
import { parsePath, PathCompileError } from "../compiler/paths.js";
import { compileRuleList } from "../compiler/permissions.js";

export function generateSubscribableSQL(name: string, sub: SubscribableIR, entities: Record<string, EntityIR> = {}): string {
  // Validate: if root.key is set, it must exist in params or start with '@'
  const rootKey = sub.root.key;
  const paramNames = Object.keys(sub.params);
  if (rootKey && !rootKey.startsWith('@') && !paramNames.includes(rootKey)) {
    throw new Error(
      `[Compiler] Subscribable '${name}' has root.key='${rootKey}' but no matching param. ` +
      `Either add '${rootKey}' to params, use '@user_id' for user-scoped subscribables, ` +
      `or remove the key for list subscribables.`
    );
  }

  const sections: string[] = [];

  sections.push(generateHeader(name, sub));
  sections.push(generateCanSubscribeFunction(name, sub));
  sections.push(generateGetFunction(name, sub, entities));
  sections.push(generateCanReceiveFunction(name, sub, entities));
  sections.push(generateAffectedKeysFunction(name, sub));

  return sections.join('\n\n');
}

function generateHeader(name: string, sub: SubscribableIR): string {
  return `-- ============================================================================
-- Subscribable: ${name}
-- Root Entity: ${sub.root.entity}
-- Scope Tables: ${sub.scopeTables.join(', ')}
-- Generated: ${new Date().toISOString()}
-- ============================================================================`;
}

function generateCanSubscribeFunction(name: string, sub: SubscribableIR): string {
  const rules = sub.canSubscribe || [];
  const rootKey = sub.root.key;
  const isList = !rootKey; // No key means it's a list subscribable

  const header = `CREATE OR REPLACE FUNCTION dzql_v2.${name}_can_subscribe(
  p_user_id INT,
  p_params JSONB
) RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$`;

  // No rules: nobody may subscribe. Use TRUE for public, AUTHENTICATED for any signed-in user.
  if (rules.length === 0) {
    return `${header}
BEGIN
  RETURN FALSE; -- canSubscribe is empty: nobody may subscribe
END;
$$;`;
  }

  // A list subscribable has no root row for a path to start from, so only
  // literal rules (TRUE, FALSE, AUTHENTICATED) can be enforced. Anything else is
  // a build error rather than a silent fallback.
  if (isList) {
    for (const rule of rules) {
      if (!parsePath(rule).literal) {
        throw new PathCompileError(
          `${name}.canSubscribe: a list subscribable has no root row to follow a path from; use TRUE, FALSE or AUTHENTICATED`,
          rule
        );
      }
    }
    return `${header}
BEGIN
  RETURN (${compileRuleList(name, rules)});
END;
$$;`;
  }

  // Single-entity subscribable: rules are checked against the root row (v_root).
  // A rule's reference to the key param means the root's id.
  const fieldMap: Record<string, string> = rootKey.startsWith('@') ? {} : { [rootKey]: 'id' };
  const checks = compileRuleList(name, rules, { kind: 'row', name: 'v_root', fieldMap });

  // Extract params
  const paramNames = Object.keys(sub.params);
  const paramDecls = paramNames.map(p => `  v_${p} ${sub.params[p]};`).join('\n');
  const paramExtracts = paramNames.map(p =>
    `  v_${p} := (p_params->>'${p}')::${sub.params[p]};`
  ).join('\n');

  // Determine how to reference the root key in the WHERE clause
  const rootKeyExpr = rootKey.startsWith('@')
    ? `p_${rootKey.slice(1)}`  // @user_id -> p_user_id
    : `v_${rootKey}`;          // venue_id -> v_venue_id

  return `${header}
DECLARE
${paramDecls}
  v_root RECORD;
BEGIN
  -- Extract parameters
${paramExtracts}

  -- Fetch root entity
  SELECT * INTO v_root
  FROM ${sub.root.entity}
  WHERE id = ${rootKeyExpr};

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Check permissions
  RETURN (
    ${checks}
  );
END;
$$;`;
}

/**
 * <name>_can_receive(p_user_id, p_params, p_table, p_op, p_data): may this
 * subscriber be pushed this change? The runtime calls it before every push.
 * Returns 'row' (send the change), 'pk' (send only its key: a delete), or
 * NULL (send nothing).
 *
 * - Nobody who fails can_subscribe receives anything.
 * - A single-document subscription: canSubscribe is the whole gate.
 * - A list: canSubscribe can only be a literal, so rows are filtered here, the
 *   same way the list query filters them. A root row needs the root's view
 *   rules; an included row must appear in one of the subscriber's documents.
 *   An included row that was deleted is in no document any more, so its
 *   delete goes to every subscriber as its key alone, which is all a client
 *   uses to remove it.
 */
function generateCanReceiveFunction(name: string, sub: SubscribableIR, entities: Record<string, EntityIR>): string {
  const isList = !sub.root.key;
  const header = `CREATE OR REPLACE FUNCTION dzql_v2.${name}_can_receive(
  p_user_id INT,
  p_params JSONB,
  p_table TEXT,
  p_op TEXT,
  p_data JSONB
) RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
BEGIN
  IF NOT dzql_v2.${name}_can_subscribe(p_user_id, p_params) THEN
    RETURN NULL;
  END IF;
`;
  const kind = `CASE WHEN p_op = 'delete' THEN 'pk' ELSE 'row' END`;

  if (!isList) {
    return `${header}
  RETURN ${kind};
END;
$$;`;
  }

  const root = sub.root.entity;
  const viewRules = compileRuleList(root, entities[root]?.permissions?.view, { kind: 'jsonb', name: 'p_data' });

  // Where each included table sits in a list document: root columns || { rel: ... }
  const pathsByTable: Record<string, string[]> = {};
  const collect = (incl: Record<string, IncludeIR>, prefix: string) => {
    for (const [rel, cfg] of Object.entries(incl || {})) {
      const path = `${prefix}."${rel}"`;
      (pathsByTable[cfg.entity] ??= []).push(path);
      if (cfg.includes) collect(cfg.includes, path);
    }
  };
  collect(sub.includes, '$');
  delete pathsByTable[root];

  const includeCases = Object.entries(pathsByTable).map(([table, paths]) => {
    const shown = paths
      .map(path => `jsonb_path_exists(d, '${path} ? (@.id == $id)', jsonb_build_object('id', p_data->'id'))`)
      .join(' OR ');
    return `  IF p_table = '${table}' THEN
    IF p_op = 'delete' THEN
      RETURN 'pk';
    END IF;
    IF EXISTS (SELECT 1 FROM dzql_v2.get_${name}(p_params, p_user_id) d WHERE ${shown}) THEN
      RETURN 'row';
    END IF;
    RETURN NULL;
  END IF;
`;
  }).join('\n');

  return `${header}
  IF p_table = '${root}' THEN
    IF ${viewRules} THEN
      RETURN ${kind};
    END IF;
    RETURN NULL;
  END IF;

${includeCases}
  RETURN NULL;
END;
$$;`;
}

/** Column info from EntityIR */
interface ColumnInfo {
  name: string;
  type: string;
  isArray: boolean;
}

/**
 * Build a SQL expression to select visible columns (excluding hidden) from a table.
 * Returns row_to_json(alias.*) if no hidden fields, otherwise builds explicit jsonb_build_object.
 */
function buildVisibleRowJson(alias: string, entityName: string, entities: Record<string, EntityIR>): string {
  const entity = entities[entityName];
  const hidden = entity?.hidden || [];

  if (hidden.length === 0) {
    return `row_to_json(${alias}.*)`;
  }

  // Build explicit column list excluding hidden fields
  const columns: ColumnInfo[] = entity?.columns || [];
  const visibleCols = columns.filter((c: ColumnInfo) => !hidden.includes(c.name));

  if (visibleCols.length === 0) {
    return `row_to_json(${alias}.*)`;
  }

  const pairs = visibleCols.map((c: ColumnInfo) => `'${c.name}', ${alias}.${c.name}`).join(', ');
  return `jsonb_build_object(${pairs})`;
}

function generateGetFunction(name: string, sub: SubscribableIR, entities: Record<string, EntityIR> = {}): string {
  const paramNames = Object.keys(sub.params);
  const paramDecls = paramNames.map(p => `  v_${p} ${sub.params[p]};`).join('\n');
  const paramExtracts = paramNames.map(p =>
    `  v_${p} := (p_params->>'${p}')::${sub.params[p]};`
  ).join('\n');

  // Handle special @ prefixed root keys (e.g., @user_id -> p_user_id)
  const rootKey = sub.root.key;
  const isList = !rootKey; // No key means it's a list subscribable
  const isSpecialKey = rootKey?.startsWith('@') ?? false;

  // Build root select expression excluding hidden fields
  const rootSelectExpr = buildVisibleRowJson('root', sub.root.entity, entities);

  // Build relation subqueries, passing param names and entities for reference resolution
  const relationSelects = generateRelationSelects(sub.includes, sub.root.entity, 'root', paramNames, entities);

  // Build schema with path mapping and scope tables
  const pathMapping = buildPathMapping(sub.root.entity, sub.includes);
  const schemaJson = JSON.stringify({
    root: sub.root.entity,
    paths: pathMapping,
    scopeTables: sub.scopeTables
  }).replace(/'/g, "''"); // Escape single quotes for SQL

  // Build WHERE clause based on root filter and key
  const whereConditions: string[] = [];
  if (rootKey) {
    const rootWhereValue = isSpecialKey ? `p_${rootKey.slice(1)}` : `v_${rootKey}`;
    whereConditions.push(`root.id = ${rootWhereValue}`);
  }
  if (sub.root.filter) {
    for (const [field, value] of Object.entries(sub.root.filter)) {
      if (typeof value === 'boolean') {
        whereConditions.push(`root.${field} = ${value}`);
      } else if (typeof value === 'string') {
        whereConditions.push(`root.${field} = '${value}'`);
      } else {
        whereConditions.push(`root.${field} = ${value}`);
      }
    }
  }
  if (isList) {
    // canSubscribe on a list can only be a literal, so it can't tell rows apart.
    // Return just the rows the subscriber may view: the root's view rules,
    // checked against each root row ([] shows nobody any row).
    const viewRules = entities[sub.root.entity]?.permissions?.view;
    whereConditions.push(`(${compileRuleList(sub.root.entity, viewRules, { kind: 'row', name: 'root' })})`);
  }
  const whereClause = whereConditions.length > 0
    ? `WHERE ${whereConditions.join(' AND ')}`
    : '';

  if (isList) {
    // List subscribable - return set of documents (STREAMING compatible)
    // The Runtime will aggregate these or stream them.
    // Schema metadata should be attached by the Runtime from the manifest.
    return `CREATE OR REPLACE FUNCTION dzql_v2.get_${name}(
  p_params JSONB,
  p_user_id INT
) RETURNS SETOF JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
${paramDecls}
BEGIN
  -- Extract parameters
${paramExtracts}

  -- Check access control
  IF NOT dzql_v2.${name}_can_subscribe(p_user_id, p_params) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  -- Return stream of documents (root projected to visible columns; ::jsonb so
  -- the || merge works even when the projection is row_to_json)
  RETURN QUERY
  SELECT (${rootSelectExpr})::jsonb || jsonb_build_object(${relationSelects ? relationSelects.slice(1) : ''})
  FROM ${sub.root.entity} root
  ${whereClause};
END;
$$;`;
  } else {
    // Single record subscribable - return single JSONB
    return `CREATE OR REPLACE FUNCTION dzql_v2.get_${name}(
  p_params JSONB,
  p_user_id INT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
${paramDecls}
  v_data JSONB;
BEGIN
  -- Extract parameters
${paramExtracts}

  -- Check access control
  IF NOT dzql_v2.${name}_can_subscribe(p_user_id, p_params) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  -- Build document with root and all relations
  SELECT jsonb_build_object(
    '${sub.root.entity}', ${rootSelectExpr}${relationSelects}
  )
  INTO v_data
  FROM ${sub.root.entity} root
  ${whereClause};

  -- Return data
  RETURN v_data;
END;
$$;`;
  }
}

function singularize(name: string): string {
  // Simple singularization: remove trailing 's'
  if (name.endsWith('ies')) return name.slice(0, -3) + 'y';
  if (name.endsWith('s') && !name.endsWith('ss')) return name.slice(0, -1);
  return name;
}

function generateRelationSelects(
  includes: Record<string, IncludeIR>,
  rootEntity: string,
  parentAlias: string = 'root',
  paramNames: string[] = [],
  entities: Record<string, EntityIR> = {}
): string {
  if (!includes || Object.keys(includes).length === 0) {
    return '';
  }

  const selects = Object.entries(includes).map(([relName, relConfig]) => {
    const relEntity = relConfig.entity;
    const filter = relConfig.filter || {};
    const hasNestedIncludes = relConfig.includes && Object.keys(relConfig.includes).length > 0;

    // Detect relation type:
    // - If relation name != entity name (e.g., "org" vs "organisations"), it's a PARENT relation
    // - If relation name == entity name (e.g., "sites" == "sites"), it's a CHILD collection
    // Parent relations use FK like root.org_id -> organisations.id
    // Child relations use FK like sites.venue_id -> root.id
    const isParentRelation = relName !== relEntity && !hasNestedIncludes && Object.keys(filter).length === 0;

    // Build WHERE clause from filter
    const whereClauses: string[] = [];
    for (const [field, value] of Object.entries(filter)) {
      if (value.startsWith('@')) {
        const refName = value.substring(1);
        // Check if this is a param reference or parent field reference
        if (paramNames.includes(refName) || refName === 'user_id') {
          // Param reference: use v_param_name or p_user_id
          const varName = refName === 'user_id' ? 'p_user_id' : `v_${refName}`;
          whereClauses.push(`rel.${field} = ${varName}`);
        } else {
          // Parent field reference: @id -> root.id
          whereClauses.push(`rel.${field} = ${parentAlias}.${refName}`);
        }
      } else {
        whereClauses.push(`rel.${field} = '${value}'`);
      }
    }

    // Default FK based on relation type
    if (whereClauses.length === 0) {
      if (isParentRelation) {
        // Parent relation: root.{relName}_id = rel.id
        whereClauses.push(`rel.id = ${parentAlias}.${relName}_id`);
      } else {
        // Child relation: rel.{singularRoot}_id = root.id
        const singularRoot = singularize(rootEntity);
        whereClauses.push(`rel.${singularRoot}_id = ${parentAlias}.id`);
      }
    }

    const whereSQL = whereClauses.join(' AND ');

    // Build select expression excluding hidden fields
    const relSelectExpr = buildVisibleRowJson('rel', relEntity, entities);

    // Handle nested includes recursively
    let nestedSelects = '';
    if (relConfig.includes) {
      nestedSelects = generateNestedSelects(relConfig.includes, relEntity, entities);
    }

    if (isParentRelation) {
      // Parent relation returns single object, not array
      return `,
    '${relName}', (
      SELECT ${relSelectExpr}
      FROM ${relEntity} rel
      WHERE ${whereSQL}
    )`;
    }

    if (nestedSelects) {
      // Flatten: merge entity fields with nested includes into one object
      // Use to_jsonb() for consistent jsonb types (row_to_json returns json, not jsonb)
      const relSelectJsonb = relSelectExpr.replace('row_to_json', 'to_jsonb');
      return `,
    '${relName}', COALESCE((
      SELECT jsonb_agg(
        ${relSelectJsonb} || jsonb_build_object(${nestedSelects.substring(1)})
      )
      FROM ${relEntity} rel
      WHERE ${whereSQL}
    ), '[]'::jsonb)`;
    }

    return `,
    '${relName}', COALESCE((
      SELECT jsonb_agg(${relSelectExpr})
      FROM ${relEntity} rel
      WHERE ${whereSQL}
    ), '[]'::jsonb)`;
  });

  return selects.join('');
}

function generateNestedSelects(
  includes: Record<string, IncludeIR>,
  parentEntity: string,
  entities: Record<string, EntityIR> = {}
): string {
  if (!includes || Object.keys(includes).length === 0) {
    return '';
  }

  const selects = Object.entries(includes).map(([relName, relConfig]) => {
    const relEntity = relConfig.entity;
    const filter = relConfig.filter || {};
    const hasNestedIncludes = relConfig.includes && Object.keys(relConfig.includes).length > 0;

    // Detect relation type: parent (single FK lookup) vs child (array)
    // Parent: relation name != entity name (e.g., "org" vs "organisations")
    // Child: relation name == entity name (e.g., "allocations" == "allocations")
    const isParentRelation = relName !== relEntity && !hasNestedIncludes && Object.keys(filter).length === 0;

    // Build WHERE clause
    const whereClauses: string[] = [];
    for (const [field, value] of Object.entries(filter)) {
      if (value.startsWith('@')) {
        const parentField = value.substring(1);
        whereClauses.push(`nested.${field} = rel.${parentField}`);
      } else {
        whereClauses.push(`nested.${field} = '${value}'`);
      }
    }

    if (whereClauses.length === 0) {
      if (isParentRelation) {
        // Parent relation: rel.{relName}_id = nested.id
        whereClauses.push(`nested.id = rel.${relName}_id`);
      } else {
        // Child relation: FK is singular form of parent entity
        const singularParent = singularize(parentEntity);
        whereClauses.push(`nested.${singularParent}_id = rel.id`);
      }
    }

    // Build select expression excluding hidden fields
    const nestedSelectExpr = buildVisibleRowJson('nested', relEntity, entities);

    if (isParentRelation) {
      // Parent relation returns single object
      return `,
          '${relName}', (
            SELECT ${nestedSelectExpr}
            FROM ${relEntity} nested
            WHERE ${whereClauses.join(' AND ')}
          )`;
    }

    return `,
          '${relName}', COALESCE((
            SELECT jsonb_agg(${nestedSelectExpr})
            FROM ${relEntity} nested
            WHERE ${whereClauses.join(' AND ')}
          ), '[]'::jsonb)`;
  });

  return selects.join('');
}

function generateAffectedKeysFunction(name: string, sub: SubscribableIR): string {
  const cases: string[] = [];
  const paramKey = sub.root.key;
  const hasParams = Object.keys(sub.params).length > 0;

  // Root entity case
  // For subscribables with no params (list feeds), just return the subscribable name
  // For subscribables with params, include the root entity's id
  if (hasParams) {
    cases.push(`    WHEN '${sub.root.entity}' THEN
      RETURN ARRAY['${name}:' || (p_data->>'id')];`);
  } else {
    cases.push(`    WHEN '${sub.root.entity}' THEN
      RETURN ARRAY['${name}'];`);
  }

  // Get singular form of root entity for FK fields
  const singularRootEntity = singularize(sub.root.entity);

  // Related entity cases
  // Track FK relationships: parentEntity -> { childEntity: { fkOnParent, fkOnChild } }
  const relationships: Record<string, Record<string, { fkOnParent: string }>> = {};

  const addRelationCase = (relName: string, relConfig: IncludeIR, parentEntity: string) => {
    const relEntity = relConfig.entity;
    const filter = relConfig.filter || {};

    // Find the FK field on parent that points to child
    // For includes like `org: 'organisations'`, the FK is `org_id` on the parent
    // For includes like `{ entity: 'comments', filter: { post_id: '@id' } }`, the FK is on child
    let fkOnParent = `${relName}_id`; // Default: relation name + _id (e.g., org -> org_id)

    // Check if filter references @id - if so, the FK is on the child pointing to parent
    let fkOnChild: string | null = null;
    for (const [field, value] of Object.entries(filter)) {
      if (value === '@id' || value === `@${paramKey}`) {
        fkOnChild = field; // e.g., user_id, venue_id
        break;
      }
    }

    // Store relationship for nested lookups
    if (!relationships[parentEntity]) relationships[parentEntity] = {};
    relationships[parentEntity][relEntity] = { fkOnParent };

    // For nested relations, we need to traverse up via the FK on parent
    if (parentEntity !== sub.root.entity) {
      // Get the FK that parent uses to reference this child entity
      const parentRel = relationships[parentEntity]?.[relEntity];
      const fkField = parentRel?.fkOnParent || `${relName}_id`;

      if (hasParams) {
        cases.push(`    WHEN '${relEntity}' THEN
      -- Nested: traverse via ${parentEntity}.${fkField}
      SELECT ARRAY_AGG('${name}:' || parent.${singularRootEntity}_id)
      INTO v_keys
      FROM ${parentEntity} parent
      WHERE parent.${fkField} = (p_data->>'id')::int;
      RETURN COALESCE(v_keys, ARRAY[]::text[]);`);
      } else {
        // No params - just return the subscribable name
        cases.push(`    WHEN '${relEntity}' THEN
      RETURN ARRAY['${name}'];`);
      }
    } else {
      // Direct child of root - use the FK on child that points to root
      const keyField = fkOnChild || `${singularRootEntity}_id`;
      if (hasParams) {
        cases.push(`    WHEN '${relEntity}' THEN
      RETURN ARRAY['${name}:' || (p_data->>'${keyField}')];`);
      } else {
        // No params - just return the subscribable name
        cases.push(`    WHEN '${relEntity}' THEN
      RETURN ARRAY['${name}'];`);
      }
    }

    // Recurse for nested includes
    if (relConfig.includes) {
      for (const [nestedName, nestedConfig] of Object.entries(relConfig.includes)) {
        addRelationCase(nestedName, nestedConfig, relEntity);
      }
    }
  };

  for (const [relName, relConfig] of Object.entries(sub.includes)) {
    addRelationCase(relName, relConfig, sub.root.entity);
  }

  return `CREATE OR REPLACE FUNCTION dzql_v2.${name}_affected_keys(
  p_table TEXT,
  p_op TEXT,
  p_data JSONB
) RETURNS TEXT[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_keys TEXT[];
BEGIN
  CASE p_table
${cases.join('\n')}
    ELSE
      RETURN ARRAY[]::text[];
  END CASE;
END;
$$;`;
}

/**
 * Generate the central compute_affected_keys function that aggregates all subscribable affected keys.
 * This is called from save/delete functions to compute all affected subscription keys at write time.
 */
export function generateComputeAffectedKeysFunction(subscribableNames: string[]): string {
  if (subscribableNames.length === 0) {
    return `-- No subscribables defined, empty compute_affected_keys function
CREATE OR REPLACE FUNCTION dzql_v2.compute_affected_keys(
  p_table TEXT,
  p_op TEXT,
  p_data JSONB
) RETURNS TEXT[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN ARRAY[]::text[];
END;
$$;`;
  }

  const calls = subscribableNames.map(name =>
    `dzql_v2.${name}_affected_keys(p_table, p_op, p_data)`
  ).join(' || ');

  return `-- Central function to compute all affected subscription keys
-- Called from save/delete functions at write time
CREATE OR REPLACE FUNCTION dzql_v2.compute_affected_keys(
  p_table TEXT,
  p_op TEXT,
  p_data JSONB
) RETURNS TEXT[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN ${calls};
END;
$$;`;
}

function buildPathMapping(
  rootEntity: string,
  includes: Record<string, IncludeIR>,
  parentPath: string = ''
): Record<string, string> {
  const paths: Record<string, string> = {};

  // Root entity maps to top level
  paths[rootEntity] = '.';

  const buildPaths = (incl: Record<string, IncludeIR>, parent: string) => {
    for (const [relName, relConfig] of Object.entries(incl)) {
      const currentPath = parent ? `${parent}.${relName}` : relName;
      paths[relConfig.entity] = currentPath;

      if (relConfig.includes) {
        buildPaths(relConfig.includes, currentPath);
      }
    }
  };

  buildPaths(includes, '');
  return paths;
}
