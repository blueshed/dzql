/**
 * Drop Semantics Code Generator
 * Generates a JSON manifest describing valid drag-and-drop interactions for a canvas UI
 *
 * Terminology clarification:
 * - "source" = the entity being dragged
 * - "target" = the entity being dropped onto
 *
 * Derivation rules:
 * 1. FK on entity A pointing to entity B (e.g., tasks.group_id REFERENCES task_groups):
 *    - A.droppable_on.B: drag A onto B → update A.group_id = B.id
 *    - A.accepts.B: drag B onto A → update A.group_id = B.id (same operation, different drag direction)
 *
 * 2. Junction table (M2M):
 *    - Both entities are droppable_on each other via junction insert
 *    - Both entities accept each other
 *
 * 3. Self-referential FK:
 *    - Entity is droppable on itself
 *
 * Visual semantics:
 * - "containment": node moves inside container (tree structures, folders)
 * - "frame": visual bounding box around members (sets, collections)
 * - "edge": arrow drawn between nodes (dependencies, relationships)
 * - "badge": tag/chip displayed on node (assignments, references)
 */

export class DropSemanticsCodegen {
  /**
   * @param {Object} entities - Map of tableName -> entityConfig
   */
  constructor(entities) {
    this.entities = entities;
  }

  /**
   * Generate the complete drop semantics manifest
   * @returns {Object} Drop semantics JSON structure
   */
  generate() {
    // Initialize result structure for all entities
    const semantics = {};
    for (const tableName of Object.keys(this.entities)) {
      semantics[tableName] = {
        droppable_on: {},
        accepts: {}
      };
    }

    // Process all FK relationships (adds to source's droppable_on and accepts)
    for (const [tableName, config] of Object.entries(this.entities)) {
      this._processFKRelationships(tableName, config, semantics);
    }

    // Process all M2M relationships (adds to source's droppable_on and accepts)
    for (const [tableName, config] of Object.entries(this.entities)) {
      this._processM2MRelationships(tableName, config, semantics);
    }

    // Second pass: populate target's accepts from source's droppable_on
    // This ensures that if posts.droppable_on.tags exists, tags.accepts.posts also exists
    this._populateTargetAccepts(semantics);

    // Filter out entities with no semantics
    const result = { entities: {} };
    for (const [tableName, sem] of Object.entries(semantics)) {
      if (Object.keys(sem.droppable_on).length > 0 || Object.keys(sem.accepts).length > 0) {
        result.entities[tableName] = sem;
      }
    }

    return result;
  }

  /**
   * Populate target's accepts from source's droppable_on
   * If A.droppable_on.B exists, then B.accepts.A should also exist
   * @private
   */
  _populateTargetAccepts(semantics) {
    for (const [sourceTable, sem] of Object.entries(semantics)) {
      for (const [targetTable, actions] of Object.entries(sem.droppable_on)) {
        // Skip if target doesn't exist in our entities
        if (!semantics[targetTable]) continue;

        // For each droppable_on action, create a corresponding accepts entry
        for (const action of actions) {
          if (!semantics[targetTable].accepts[sourceTable]) {
            semantics[targetTable].accepts[sourceTable] = [];
          }

          // Check if this exact relation already exists (avoid duplicates)
          const exists = semantics[targetTable].accepts[sourceTable].some(
            a => a.relation === action.relation && a.type === action.type
          );

          if (!exists) {
            // Create the inverse action - swap source and target in params
            const inverseAction = this._createInverseAction(action, sourceTable, targetTable);
            semantics[targetTable].accepts[sourceTable].push(inverseAction);
          }
        }
      }
    }
  }

  /**
   * Create an inverse action for accepts (swap source/target perspective)
   * @private
   */
  _createInverseAction(action, sourceTable, targetTable) {
    // For the inverse, @source becomes what was @target and vice versa
    const swapRefs = (params) => {
      const swapped = {};
      for (const [key, value] of Object.entries(params)) {
        if (typeof value === 'string') {
          swapped[key] = value
            .replace('@source.', '@__tmp__.')
            .replace('@target.', '@source.')
            .replace('@__tmp__.', '@target.');
        } else {
          swapped[key] = value;
        }
      }
      return swapped;
    };

    // For inverse (accepts), visual is typically badge unless it's an edge
    let inverseVisual = 'badge';
    if (action.visual === 'edge') {
      inverseVisual = 'edge';  // Edges are bidirectional visually
    }

    const result = {
      ...action,
      action: action.type === 'fk' ? 'assign' : action.action,
      visual: inverseVisual,
      label: action.type === 'fk'
        ? this._generateLabel(action.relation, 'assign')
        : action.label,
      operation: {
        ...action.operation,
        params: swapRefs(action.operation.params)
      },
      remove_operation: action.remove_operation ? {
        ...action.remove_operation,
        params: swapRefs(action.remove_operation.params)
      } : undefined
    };

    // For edge visual, swap direction
    if (action.direction === 'source_to_target') {
      result.direction = 'target_to_source';
    }

    return result;
  }

  /**
   * Process FK relationships for an entity
   * @private
   */
  _processFKRelationships(tableName, config, semantics) {
    const fkIncludes = config.fkIncludes || {};
    const primaryKey = config.primaryKey || ['id'];

    for (const [alias, targetTable] of Object.entries(fkIncludes)) {
      // Skip reverse FKs (child arrays) - indicated when alias === targetTable
      if (alias === targetTable) {
        continue;
      }

      const fkColumn = alias.endsWith('_id') ? alias : `${alias}_id`;
      const isSelfReferential = targetTable === tableName;

      // 1. Source (tableName) can be dropped onto target
      // e.g., tasks.droppable_on.task_groups - drag task onto group
      if (!semantics[tableName].droppable_on[targetTable]) {
        semantics[tableName].droppable_on[targetTable] = [];
      }

      const action = isSelfReferential ? this._getSelfReferentialAction(fkColumn) : 'move';
      const visual = this._inferVisual('fk', targetTable, isSelfReferential);

      // Determine if this is primarily an "accepts" relationship (assign pattern)
      // e.g., tasks.assigned_to_user_id - natural gesture is to drop user onto task
      const isAssignPattern = this._isAssignPattern(alias);

      semantics[tableName].droppable_on[targetTable].push({
        relation: fkColumn,
        type: 'fk',
        action: action,
        visual: visual,
        label: this._generateLabel(fkColumn, action),
        ...(isAssignPattern && { primary_direction: 'accepts' }),
        operation: {
          method: 'save',
          entity: tableName,
          params: this._buildPKParams(primaryKey, '@source', { [fkColumn]: '@target.id' })
        },
        removable: true,
        remove_operation: {
          method: 'save',
          entity: tableName,
          params: this._buildPKParams(primaryKey, '@source', { [fkColumn]: null })
        }
      });

      // 2. Source (tableName) accepts target being dropped on it
      // e.g., tasks.accepts.users - drag user onto task to assign
      // This only makes sense for non-self-referential FKs
      if (!isSelfReferential && this.entities[targetTable]) {
        if (!semantics[tableName].accepts[targetTable]) {
          semantics[tableName].accepts[targetTable] = [];
        }

        // For accepts, visual is always badge (something is being attached to this entity)
        semantics[tableName].accepts[targetTable].push({
          relation: fkColumn,
          type: 'fk',
          action: 'assign',
          visual: 'badge',
          label: this._generateLabel(alias, 'assign'),
          operation: {
            method: 'save',
            entity: tableName,  // Update the entity with the FK
            params: this._buildPKParams(primaryKey, '@target', { [fkColumn]: '@source.id' })
          },
          removable: true,
          remove_operation: {
            method: 'save',
            entity: tableName,
            params: this._buildPKParams(primaryKey, '@target', { [fkColumn]: null })
          }
        });
      }
    }
  }

  /**
   * Process M2M relationships for an entity
   * @private
   */
  _processM2MRelationships(tableName, config, semantics) {
    const manyToMany = config.manyToMany || {};

    for (const [relationKey, m2mConfig] of Object.entries(manyToMany)) {
      const { junction_table, local_key, foreign_key, target_entity } = m2mConfig;

      if (!junction_table || !local_key || !foreign_key || !target_entity) {
        continue;
      }

      const isSelfReferential = target_entity === tableName;
      const visual = this._inferVisual('junction', target_entity, isSelfReferential);

      // 1. Source (tableName) can be dropped onto target
      if (!semantics[tableName].droppable_on[target_entity]) {
        semantics[tableName].droppable_on[target_entity] = [];
      }

      const baseEntry = {
        relation: junction_table,
        type: 'junction',
        action: 'link',
        visual: visual,
        label: this._generateLabel(junction_table, 'link'),
        operation: {
          method: 'save',
          entity: junction_table,
          params: {
            [local_key]: '@source.id',
            [foreign_key]: '@target.id'
          }
        },
        removable: true,
        remove_operation: {
          method: 'delete',
          entity: junction_table,
          params: {
            [local_key]: '@source.id',
            [foreign_key]: '@target.id'
          }
        },
        ...(isSelfReferential && { self_referential: true })
      };

      // For edge visual (self-referential), add direction hint
      if (visual === 'edge') {
        baseEntry.direction = 'source_to_target';
      }

      semantics[tableName].droppable_on[target_entity].push(baseEntry);

      // 2. Source (tableName) accepts target being dropped on it
      // For M2M, the operation is symmetric but params swap
      if (!isSelfReferential && this.entities[target_entity]) {
        if (!semantics[tableName].accepts[target_entity]) {
          semantics[tableName].accepts[target_entity] = [];
        }

        // For accepts on M2M, use frame if target is a set, otherwise badge
        const acceptVisual = this._matchesSetPattern(target_entity) ? 'frame' : 'badge';

        semantics[tableName].accepts[target_entity].push({
          relation: junction_table,
          type: 'junction',
          action: 'link',
          visual: acceptVisual,
          label: this._generateLabel(junction_table, 'link'),
          operation: {
            method: 'save',
            entity: junction_table,
            params: {
              [local_key]: '@target.id',   // target is the entity with the M2M config
              [foreign_key]: '@source.id'  // source is what's being dropped
            }
          },
          removable: true,
          remove_operation: {
            method: 'delete',
            entity: junction_table,
            params: {
              [local_key]: '@target.id',
              [foreign_key]: '@source.id'
            }
          }
        });
      }
    }
  }

  /**
   * Build params object with primary key fields
   * @private
   */
  _buildPKParams(primaryKey, refPrefix, additionalParams) {
    const params = {};

    for (const pkField of primaryKey) {
      params[pkField] = `${refPrefix}.${pkField}`;
    }

    Object.assign(params, additionalParams);
    return params;
  }

  /**
   * Infer the visual representation type for a relationship
   * @private
   * @param {string} type - 'fk' or 'junction'
   * @param {string} targetTable - The target entity name
   * @param {boolean} isSelfReferential - Whether this is a self-referential relation
   * @returns {string} Visual type: 'containment', 'frame', 'edge', or 'badge'
   */
  _inferVisual(type, targetTable, isSelfReferential) {
    // Rule 1: Self-referential junction → edge (arrows between same entity type)
    if (type === 'junction' && isSelfReferential) {
      return 'edge';
    }

    // Rule 2: Self-referential FK → containment (tree/hierarchy)
    if (type === 'fk' && isSelfReferential) {
      return 'containment';
    }

    // Rule 3: Target entity has self-referential FK → it's a tree/container
    if (this._isTreeEntity(targetTable)) {
      return 'containment';
    }

    // Rule 4: Naming convention fallback
    if (this._matchesContainerPattern(targetTable)) {
      return 'containment';
    }

    if (this._matchesSetPattern(targetTable)) {
      return 'frame';
    }

    // Default: badge (tag/chip on node)
    return 'badge';
  }

  /**
   * Check if an entity has a self-referential FK (making it a tree structure)
   * @private
   */
  _isTreeEntity(tableName) {
    const config = this.entities[tableName];
    if (!config) return false;

    const fkIncludes = config.fkIncludes || {};
    for (const [alias, target] of Object.entries(fkIncludes)) {
      if (target === tableName) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if entity name matches container patterns
   * @private
   */
  _matchesContainerPattern(tableName) {
    const patterns = ['_groups', '_folders', '_categories', '_containers', '_parents'];
    return patterns.some(p => tableName.endsWith(p));
  }

  /**
   * Check if entity name matches set/collection patterns
   * @private
   */
  _matchesSetPattern(tableName) {
    const patterns = ['_sets', '_collections', '_lists', '_pools', '_batches'];
    return patterns.some(p => tableName.endsWith(p));
  }

  /**
   * Determine action type for self-referential FK
   * @private
   */
  _getSelfReferentialAction(fkColumn) {
    if (fkColumn.includes('parent')) {
      return 'reparent';
    }
    if (fkColumn.includes('depends') || fkColumn.includes('dependency')) {
      return 'link';
    }
    return 'nest';
  }

  /**
   * Check if an FK alias represents an "assign" pattern
   * where the natural gesture is to drop the target onto the source
   * e.g., "assigned_to_user" - you drop user onto task, not task onto user
   * @private
   */
  _isAssignPattern(alias) {
    const assignPatterns = [
      /^assigned_to_/,
      /^created_by_/,
      /^updated_by_/,
      /^owned_by_/,
      /^approved_by_/,
      /^reviewed_by_/,
      /^managed_by_/,
      /^author$/,
      /^owner$/,
      /^assignee$/,
      /^reviewer$/,
      /^approver$/
    ];

    return assignPatterns.some(pattern => pattern.test(alias));
  }

  /**
   * Generate human-readable label from relation name
   * @private
   */
  _generateLabel(relationName, action) {
    // Remove common suffixes and extract the core noun
    let name = relationName
      .replace(/_id$/, '')
      .replace(/^fk_/, '');

    // Strip preposition patterns to get the core entity name
    // "assigned_to_user" → "user"
    // "depends_on_task" → "task" (but keep "depends on" for special handling)
    // "created_by_user" → "user"
    // "owner_org" → "org"
    const prepositionPatterns = [
      /^assigned_to_/,
      /^created_by_/,
      /^updated_by_/,
      /^owned_by_/,
      /^belongs_to_/,
      /^managed_by_/,
      /^approved_by_/,
      /^reviewed_by_/
    ];

    let strippedName = name;
    for (const pattern of prepositionPatterns) {
      if (pattern.test(name)) {
        strippedName = name.replace(pattern, '');
        break;
      }
    }

    // Convert snake_case to Title Case
    const words = strippedName.split('_').map(word =>
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    );

    // Map action to verb
    const verbs = {
      'move': 'Move to',
      'assign': 'Assign',
      'link': 'Add',
      'nest': 'Set as child of',
      'reparent': 'Set parent'
    };

    const verb = verbs[action] || '';

    // Special handling for junction tables (link action)
    if (action === 'link') {
      const singularName = this._singularize(words.join(' '));
      return `Add ${singularName.toLowerCase()}`;
    }

    return `${verb} ${words.join(' ').toLowerCase()}`.trim();
  }

  /**
   * Simple singularization
   * @private
   */
  _singularize(word) {
    if (word.endsWith('ies')) {
      return word.slice(0, -3) + 'y';
    }
    if (word.endsWith('es') && !word.endsWith('ses')) {
      return word.slice(0, -2);
    }
    if (word.endsWith('s') && !word.endsWith('ss')) {
      return word.slice(0, -1);
    }
    return word;
  }
}

/**
 * Generate drop semantics from parsed entities
 * @param {Array|Object} entities - Array of entity configs or map of tableName -> config
 * @returns {Object} Drop semantics manifest
 */
export function generateDropSemantics(entities) {
  // Convert array to map if needed
  let entityMap = entities;
  if (Array.isArray(entities)) {
    entityMap = {};
    for (const entity of entities) {
      entityMap[entity.tableName] = entity;
    }
  }

  const gen = new DropSemanticsCodegen(entityMap);
  return gen.generate();
}
