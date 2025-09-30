import { sql } from './db.js';

export function metaRoute() {
  return async (req) => {
    try {
      // Get entity metadata from dzql.entities
      const entities = await sql`
        SELECT table_name, label_field, searchable_fields,
               fk_includes, notification_paths, permission_paths
        FROM dzql.entities
        ORDER BY table_name
      `;

      // Analyze foreign key relationships to determine relationship types
      const foreignKeys = await sql`
        SELECT
          tc.table_name,
          kcu.column_name,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name
        FROM
          information_schema.table_constraints AS tc
          JOIN information_schema.key_column_usage AS kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          JOIN information_schema.constraint_column_usage AS ccu
            ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public'
        ORDER BY tc.table_name, kcu.column_name
      `;

      // Get complete table schema information
      const schemaInfo = await sql`
        SELECT
          table_name,
          column_name,
          data_type,
          is_nullable,
          column_default,
          character_maximum_length,
          numeric_precision,
          numeric_scale,
          ordinal_position
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ANY(${entities.map(e => e.table_name)})
        ORDER BY table_name, ordinal_position
      `;

      // Find junction tables for many-to-many relationships
      const junctionTables = new Set();
      const entityNames = new Set(entities.map(e => e.table_name));

      // Group foreign keys by table to identify junction tables
      const fksByTable = {};
      foreignKeys.forEach(fk => {
        if (!entityNames.has(fk.table_name)) return;
        if (!fksByTable[fk.table_name]) fksByTable[fk.table_name] = [];
        fksByTable[fk.table_name].push(fk);
      });

      // Identify junction tables (2+ foreign keys, minimal other fields)
      Object.keys(fksByTable).forEach(tableName => {
        const fks = fksByTable[tableName];
        if (fks.length >= 2) {
          const entity = entities.find(e => e.table_name === tableName);
          const searchableFields = entity?.searchable_fields || [];
          const nonFkFields = searchableFields.filter(field =>
            !fks.some(fk => fk.column_name === field)
          );
          if (nonFkFields.length <= 1) {
            junctionTables.add(tableName);
          }
        }
      });

      // Build relations array
      const relations = [];

      // Add foreign key relationships (both directions)
      foreignKeys.forEach(fk => {
        if (!entityNames.has(fk.table_name) || !entityNames.has(fk.foreign_table_name)) return;

        // Skip junction tables - they'll be handled as many-to-many
        if (junctionTables.has(fk.table_name)) return;

        // Many-to-one: child.foreign_key → parent.primary_key
        relations.push({
          type: 'many_to_one',
          from: `${fk.table_name}.${fk.column_name}`,
          to: `${fk.foreign_table_name}.${fk.foreign_column_name}`
        });

        // One-to-many: parent.primary_key ← child.foreign_key
        relations.push({
          type: 'one_to_many',
          from: `${fk.foreign_table_name}.${fk.foreign_column_name}`,
          to: `${fk.table_name}.${fk.column_name}`
        });
      });

      // Add many-to-many relationships through junction tables
      junctionTables.forEach(tableName => {
        const fks = fksByTable[tableName];
        // For each pair of foreign keys in the junction table
        for (let i = 0; i < fks.length; i++) {
          for (let j = i + 1; j < fks.length; j++) {
            const fk1 = fks[i];
            const fk2 = fks[j];

            // Both directions of many-to-many
            relations.push({
              type: 'many_to_many',
              from: `${fk1.foreign_table_name}.${fk1.foreign_column_name}`,
              to: `${fk2.foreign_table_name}.${fk2.foreign_column_name}`,
              via: `${tableName}.${fk1.column_name}.${fk2.column_name}`
            });

            relations.push({
              type: 'many_to_many',
              from: `${fk2.foreign_table_name}.${fk2.foreign_column_name}`,
              to: `${fk1.foreign_table_name}.${fk1.foreign_column_name}`,
              via: `${tableName}.${fk2.column_name}.${fk1.column_name}`
            });
          }
        }
      });

      // Build schema object grouped by table
      const schema = {};
      schemaInfo.forEach(col => {
        if (!schema[col.table_name]) {
          schema[col.table_name] = [];
        }
        schema[col.table_name].push({
          column_name: col.column_name,
          data_type: col.data_type,
          is_nullable: col.is_nullable === 'YES',
          column_default: col.column_default,
          character_maximum_length: col.character_maximum_length,
          numeric_precision: col.numeric_precision,
          numeric_scale: col.numeric_scale,
          ordinal_position: col.ordinal_position
        });
      });

     // Build navigation graph from user starting point
     const navigationGraph = buildNavigationGraph(entities, relations, schema);

     const metadata = {
        entities: entities,
        relations: relations,
        schema: schema,
        navigationGraph: navigationGraph,
        operations: ['get', 'save', 'delete', 'lookup', 'search'],
        timestamp: new Date().toISOString()
      };

      return new Response(JSON.stringify(metadata, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  };
}

function buildNavigationGraph(entities, relations, schema) {
  const graph = {};

  // Helper to detect UI patterns from schema
  function getUiHints(entityName) {
    const entitySchema = schema[entityName] || [];
    const hints = { primary_view: 'table', alternate_view: 'form', temporal_fields: [], geo_fields: [] };

    entitySchema.forEach(col => {
      if (col.data_type.includes('date') || col.data_type.includes('time')) {
        hints.temporal_fields.push(col.column_name);
      }
      if (col.column_name.toLowerCase().includes('address') ||
          col.column_name.toLowerCase().includes('location')) {
        hints.geo_fields.push(col.column_name);
        hints.primary_view = 'map';
      }
    });

    if (hints.temporal_fields.length > 0) {
      hints.alternate_view = 'calendar';
    }

    return hints;
  }

  // Build navigation paths starting from user
  function buildPathsFrom(currentEntity, currentPath, visited, maxDepth) {
    if (maxDepth <= 0 || visited.has(currentEntity)) return;

    visited.add(currentEntity);
    const pathKey = currentPath.join('→');

    if (!graph[pathKey]) {
      const entity = entities.find(e => e.table_name === currentEntity);
      graph[pathKey] = {
        path: pathKey,
        current_entity: currentEntity,
        available_actions: entity ? Object.keys(entity.permission_paths) : [],
        navigation_options: [],
        ui_hints: getUiHints(currentEntity),
        breadcrumb: currentPath.map(p => p.split('.')[0])
      };
    }

    // Find all outgoing relations from current entity
    relations.forEach(rel => {
      const fromEntity = rel.from.split('.')[0];
      const toEntity = rel.to.split('.')[0];

      if (fromEntity === currentEntity && !visited.has(toEntity)) {
        graph[pathKey].navigation_options.push({
          to: toEntity,
          via: `${rel.from}→${rel.to}`,
          relationship: rel.type
        });

        // Recursively build paths
        const newPath = [...currentPath, rel.to];
        buildPathsFrom(toEntity, newPath, new Set(visited), maxDepth - 1);
      }
    });

    visited.delete(currentEntity);
  }

  // Start building from user
  const userRelations = relations.filter(rel => rel.from.startsWith('users.') || rel.to.startsWith('users.'));
  if (userRelations.length === 0) {
    // If no direct user relations, start from all entities
    entities.forEach(entity => {
      buildPathsFrom(entity.table_name, [entity.table_name + '.id'], new Set(), 3);
    });
  } else {
    buildPathsFrom('users', ['users.id'], new Set(), 4);
  }

  return graph;
}
