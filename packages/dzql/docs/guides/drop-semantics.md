# Drop Semantics

Compile-time manifest describing valid drag-and-drop interactions for canvas UIs.

## Overview

When you compile entity definitions, DZQL generates a `drop-semantics.json` file that describes all valid drag-and-drop relationships between entities. This allows canvas UIs to:

- Know which entities can be dropped onto which targets
- Display appropriate visual feedback (containment, frames, edges, badges)
- Execute the correct database operation for each drop
- Provide unlink/remove functionality

**Key benefit:** The canvas never interprets SQL - it reads a static manifest and knows exactly what connections are valid.

## Quick Start

```bash
dzql compile entities/domain.sql -o compiled/
# Outputs:
#   compiled/entities.sql
#   compiled/drop-semantics.json   ← Canvas consumes this
#   compiled/checksums.json
```

## Output Format

```json
{
  "entities": {
    "tasks": {
      "droppable_on": {
        "task_groups": [{
          "relation": "group_id",
          "type": "fk",
          "action": "move",
          "visual": "containment",
          "label": "Move to group",
          "operation": {
            "method": "save",
            "entity": "tasks",
            "params": { "id": "@source.id", "group_id": "@target.id" }
          },
          "removable": true,
          "remove_operation": {
            "method": "save",
            "entity": "tasks",
            "params": { "id": "@source.id", "group_id": null }
          }
        }],
        "users": [{
          "relation": "assigned_to_user_id",
          "type": "fk",
          "action": "move",
          "visual": "badge",
          "label": "Move to user",
          "primary_direction": "accepts",
          "operation": { ... }
        }]
      },
      "accepts": {
        "users": [{
          "relation": "assigned_to_user_id",
          "type": "fk",
          "action": "assign",
          "visual": "badge",
          "label": "Assign user",
          "operation": {
            "method": "save",
            "entity": "tasks",
            "params": { "id": "@target.id", "assigned_to_user_id": "@source.id" }
          },
          "removable": true,
          "remove_operation": {
            "method": "save",
            "entity": "tasks",
            "params": { "id": "@target.id", "assigned_to_user_id": null }
          }
        }]
      }
    }
  }
}
```

### Primary Direction Hint

Some relationships have a natural gesture direction. For example, you typically drop a *user* onto a *task* to assign them, not the other way around. When `primary_direction: "accepts"` is present, the canvas should prioritize the `accepts` entry for UI affordances (drop zones, visual hints).

```json
{
  "relation": "assigned_to_user_id",
  "primary_direction": "accepts"
}
```

The compiler infers this from naming patterns like `assigned_to_*`, `created_by_*`, `author`, `owner`, etc.

## Terminology

- **source** - The entity being dragged
- **target** - The entity being dropped onto
- **droppable_on** - What THIS entity can be dropped onto
- **accepts** - What can be dropped onto THIS entity

## Derivation Rules

The compiler derives drop semantics from your schema relationships:

### 1. Foreign Key Relationships

```sql
-- tasks.group_id REFERENCES task_groups
```

Generates:

| Perspective | Entry | Meaning |
|-------------|-------|---------|
| `tasks.droppable_on.task_groups` | action: "move" | Drag task onto group → update task.group_id |
| `tasks.accepts.task_groups` | action: "assign" | Drag group onto task → update task.group_id |

### 2. Many-to-Many (Junction Tables)

```sql
-- post_tags(post_id, tag_id)
```

Generates:

| Perspective | Entry | Meaning |
|-------------|-------|---------|
| `posts.droppable_on.tags` | action: "link" | Drag post onto tag → insert junction |
| `posts.accepts.tags` | action: "link" | Drag tag onto post → insert junction |

### 3. Self-Referential FK

```sql
-- categories.parent_id REFERENCES categories
```

Generates:

| Perspective | Entry | Meaning |
|-------------|-------|---------|
| `categories.droppable_on.categories` | action: "reparent" | Drag category onto another → set parent |

### 4. Self-Referential Junction (Dependencies)

```sql
-- task_dependencies(task_id, depends_on_task_id)
```

Generates:

| Perspective | Entry | Meaning |
|-------------|-------|---------|
| `tasks.droppable_on.tasks` | action: "link", visual: "edge" | Drag task onto task → create dependency edge |

## Visual Types

The `visual` field tells the canvas how to render each relationship:

| Visual | Meaning | When Used |
|--------|---------|-----------|
| `containment` | Node moves inside container | Tree structures (folders, groups) |
| `frame` | Visual bounding box around members | Sets, collections |
| `edge` | Arrow drawn between nodes | Dependencies, relationships |
| `badge` | Tag/chip displayed on node | Assignments, references |

### Automatic Visual Inference

The compiler infers visual type using these rules (in order):

1. **Self-referential junction** → `edge`
2. **Self-referential FK** → `containment`
3. **Target has self-referential FK** (is a tree) → `containment`
4. **Name ends with `_groups`, `_folders`, `_categories`** → `containment`
5. **Name ends with `_sets`, `_collections`, `_lists`** → `frame`
6. **Default** → `badge`

### Edge Direction

For `edge` visuals (self-referential junctions), the output includes direction:

```json
{
  "visual": "edge",
  "direction": "source_to_target",
  "self_referential": true
}
```

The canvas can use this to draw arrows in the correct direction.

## Remove Operations

Every relationship includes remove semantics:

### FK Relationships

```json
{
  "removable": true,
  "remove_operation": {
    "method": "save",
    "entity": "tasks",
    "params": { "id": "@source.id", "group_id": null }
  }
}
```

Setting the FK to `null` unlinks the relationship.

### Junction Relationships

```json
{
  "removable": true,
  "remove_operation": {
    "method": "delete",
    "entity": "post_tags",
    "params": { "post_id": "@source.id", "tag_id": "@target.id" }
  }
}
```

Deleting the junction record removes the link.

## Composite Primary Keys

Entities with composite primary keys include all key fields in params:

```json
{
  "operation": {
    "method": "save",
    "entity": "org_items",
    "params": {
      "org_id": "@source.org_id",
      "item_code": "@source.item_code",
      "category_id": "@target.id"
    }
  }
}
```

## Canvas Integration

### Checking Valid Drops

```javascript
function canDrop(sourceEntity, sourceId, targetEntity, targetId) {
  const semantics = dropSemantics.entities[sourceEntity];
  if (!semantics) return false;
  
  return semantics.droppable_on[targetEntity]?.length > 0;
}
```

### Executing Drop

```javascript
async function executeDrop(ws, sourceEntity, sourceData, targetEntity, targetData, relationIndex = 0) {
  const action = dropSemantics.entities[sourceEntity].droppable_on[targetEntity][relationIndex];
  
  const params = resolveParams(action.operation.params, sourceData, targetData);
  
  if (action.operation.method === 'save') {
    await ws.api.save[action.operation.entity](params);
  } else if (action.operation.method === 'delete') {
    await ws.api.delete[action.operation.entity](params);
  }
}

function resolveParams(template, sourceData, targetData) {
  const params = {};
  for (const [key, value] of Object.entries(template)) {
    if (typeof value === 'string' && value.startsWith('@source.')) {
      params[key] = sourceData[value.replace('@source.', '')];
    } else if (typeof value === 'string' && value.startsWith('@target.')) {
      params[key] = targetData[value.replace('@target.', '')];
    } else {
      params[key] = value;
    }
  }
  return params;
}
```

### Getting Visual Hint

```javascript
function getDropVisual(sourceEntity, targetEntity) {
  const action = dropSemantics.entities[sourceEntity]?.droppable_on[targetEntity]?.[0];
  return action?.visual || null;
}
```

### Multiple Relations Picker

When multiple relations exist between the same entities (e.g., task→task could be "depends on" or "blocks"), show a picker:

```javascript
function getDropOptions(sourceEntity, targetEntity) {
  const actions = dropSemantics.entities[sourceEntity]?.droppable_on[targetEntity] || [];
  return actions.map((action, index) => ({
    index,
    label: action.label,
    visual: action.visual,
    relation: action.relation
  }));
}

// In Vue component
<template>
  <div v-if="dropOptions.length > 1" class="relation-picker">
    <button 
      v-for="option in dropOptions" 
      :key="option.index"
      @click="executeDrop(option.index)"
    >
      {{ option.label }}
    </button>
  </div>
</template>
```

## Example: Complete Task Management

### Schema

```sql
-- Groups with hierarchy
CREATE TABLE task_groups (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id INT REFERENCES task_groups(id)
);

-- Tasks
CREATE TABLE tasks (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  group_id INT REFERENCES task_groups(id),
  assigned_to_user_id INT REFERENCES users(id)
);

-- Task sets (for batch operations)
CREATE TABLE task_sets (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE task_set_members (
  task_id INT REFERENCES tasks(id) ON DELETE CASCADE,
  set_id INT REFERENCES task_sets(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, set_id)
);

-- Task dependencies
CREATE TABLE task_dependencies (
  task_id INT REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id INT REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_task_id)
);

-- Entity registrations
SELECT dzql.register_entity('task_groups', 'name', ARRAY['name'],
  jsonb_build_object('parent', 'task_groups'),
  false, '{}', '{}',
  jsonb_build_object('view', ARRAY[]::text[], 'create', ARRAY[]::text[], 
                     'update', ARRAY[]::text[], 'delete', ARRAY[]::text[])
);

SELECT dzql.register_entity('tasks', 'title', ARRAY['title'],
  jsonb_build_object('group', 'task_groups', 'assigned_to_user', 'users'),
  false, '{}', '{}',
  jsonb_build_object('view', ARRAY[]::text[], 'create', ARRAY[]::text[], 
                     'update', ARRAY[]::text[], 'delete', ARRAY[]::text[]),
  jsonb_build_object(
    'many_to_many', jsonb_build_object(
      'sets', jsonb_build_object(
        'junction_table', 'task_set_members',
        'local_key', 'task_id',
        'foreign_key', 'set_id',
        'target_entity', 'task_sets',
        'id_field', 'set_ids'
      ),
      'dependencies', jsonb_build_object(
        'junction_table', 'task_dependencies',
        'local_key', 'task_id',
        'foreign_key', 'depends_on_task_id',
        'target_entity', 'tasks',
        'id_field', 'dependency_ids'
      )
    )
  )
);
```

### Generated Drop Semantics

```json
{
  "entities": {
    "task_groups": {
      "droppable_on": {
        "task_groups": [{
          "relation": "parent_id",
          "type": "fk",
          "action": "reparent",
          "visual": "containment",
          "label": "Set parent",
          "operation": { ... },
          "removable": true,
          "remove_operation": { ... }
        }]
      },
      "accepts": {
        "tasks": [{ ... }]
      }
    },
    "tasks": {
      "droppable_on": {
        "task_groups": [{
          "relation": "group_id",
          "type": "fk",
          "action": "move",
          "visual": "containment",
          "label": "Move to group",
          "operation": { ... }
        }],
        "users": [{
          "relation": "assigned_to_user_id",
          "type": "fk",
          "action": "move",
          "visual": "badge",
          "label": "Move to assigned to user",
          "operation": { ... }
        }],
        "task_sets": [{
          "relation": "task_set_members",
          "type": "junction",
          "action": "link",
          "visual": "frame",
          "label": "Add task set member",
          "operation": { ... }
        }],
        "tasks": [{
          "relation": "task_dependencies",
          "type": "junction",
          "action": "link",
          "visual": "edge",
          "direction": "source_to_target",
          "label": "Add task dependency",
          "operation": { ... },
          "self_referential": true
        }]
      },
      "accepts": {
        "users": [{
          "relation": "assigned_to_user_id",
          "type": "fk",
          "action": "assign",
          "visual": "badge",
          "label": "Assign assigned to user",
          "operation": { ... }
        }],
        "task_sets": [{ ... }],
        "tasks": [{
          "visual": "edge",
          "direction": "target_to_source"
        }]
      }
    }
  }
}
```

### Canvas Interpretation

| Drop | Visual | Result |
|------|--------|--------|
| Task → Group | containment | Task node moves inside group container |
| Task → Task | edge | Arrow drawn from source to target |
| User → Task | badge | User chip appears on task node |
| Task → Set | frame | Task included in set's visual boundary |
| Group → Group | containment | Group nests inside another group |

## Relationship Types Summary

| Schema Pattern | Type | Action | Default Visual |
|----------------|------|--------|----------------|
| `A.fk_id REFERENCES B` | `fk` | `move` | `badge` or `containment`* |
| `A.fk_id REFERENCES A` | `fk` | `reparent` | `containment` |
| Junction(A, B) | `junction` | `link` | `badge` or `frame`* |
| Junction(A, A) | `junction` | `link` | `edge` |

*Visual depends on target entity name and structure

## Canvas Position Storage

The drop-semantics manifest covers relationships but not node positions. For canvas x/y coordinates, consider:

### Option A: JSON Column on Entity

Simple approach for single-user or shared layouts:

```sql
ALTER TABLE tasks ADD COLUMN canvas JSONB DEFAULT '{}';

-- Store position
UPDATE tasks SET canvas = jsonb_build_object('x', 100, 'y', 200) WHERE id = 1;

-- Or include in entity definition for automatic handling
```

### Option B: Separate Positions Table

For multi-user layouts or per-project views:

```sql
CREATE TABLE canvas_positions (
  entity TEXT NOT NULL,
  record_id INT NOT NULL,
  user_id INT REFERENCES users(id),
  project_id INT,  -- Optional: per-project layouts
  x FLOAT NOT NULL,
  y FLOAT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (entity, record_id, COALESCE(user_id, 0), COALESCE(project_id, 0))
);

CREATE INDEX idx_canvas_positions_lookup 
  ON canvas_positions(entity, user_id, project_id);
```

### Option C: Client-Side Storage

For personal layouts that don't need server persistence:

```javascript
// localStorage per user
const positions = JSON.parse(localStorage.getItem('canvas_positions') || '{}');
positions[`${entity}:${id}`] = { x, y };
localStorage.setItem('canvas_positions', JSON.stringify(positions));
```

## See Also

- [Many-to-Many](./many-to-many.md) - Junction table configuration
- [Compiler Guide](../compiler/README.md) - Full compilation workflow
- [Custom Functions](./custom-functions.md) - Extending with business logic
