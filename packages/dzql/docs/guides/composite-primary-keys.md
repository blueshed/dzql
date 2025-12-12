# Composite Primary Keys

DZQL supports tables with composite (compound) primary keys. This guide explains how to register entities with composite keys and how the generated CRUD functions work.

## When to Use Composite Keys

Composite primary keys are useful for:

- **Junction tables** with additional data (beyond simple M2M)
- **Position/state tables** keyed by entity type and ID
- **Multi-tenant tables** keyed by tenant + entity
- **Versioned records** keyed by ID + version

## Registering an Entity with a Composite Key

To register an entity with a composite primary key, add `primary_key` to the `graph_rules` parameter:

```sql
-- Create a table with composite primary key
CREATE TABLE canvas_positions (
  entity_type VARCHAR(50) NOT NULL,
  entity_id INTEGER NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  width INTEGER DEFAULT 100,
  height INTEGER DEFAULT 100,
  PRIMARY KEY (entity_type, entity_id)
);

-- Register with DZQL using composite key
SELECT dzql.register_entity(
  'canvas_positions',                          -- table_name
  'entity_type',                               -- label_field
  array['x', 'y', 'width', 'height'],          -- searchable_fields
  '{}',                                        -- fk_includes
  false,                                       -- soft_delete
  '{}',                                        -- temporal_fields
  '{}',                                        -- notification_paths
  jsonb_build_object(                          -- permission_paths
    'view', array[]::text[],
    'create', array[]::text[],
    'update', array[]::text[],
    'delete', array[]::text[]
  ),
  jsonb_build_object(                          -- graph_rules
    'primary_key', array['entity_type', 'entity_id']
  )
);
```

The `primary_key` array specifies the columns that form the composite key, in order.

## Generated Function Signatures

When you compile an entity with a composite primary key, the generated functions have different signatures:

### GET Function

```sql
-- Accepts JSONB with all PK fields
SELECT get_canvas_positions(
  1,                                           -- user_id
  '{"entity_type": "node", "entity_id": 42}'   -- composite PK as JSONB
);
```

### SAVE Function

```sql
-- Insert: provide all PK fields plus data
SELECT save_canvas_positions(
  1,                                           -- user_id
  '{"entity_type": "node", "entity_id": 42, "x": 100, "y": 200}'
);

-- Update: same signature, existing record detected by PK
SELECT save_canvas_positions(
  1,
  '{"entity_type": "node", "entity_id": 42, "x": 150, "y": 250}'
);
```

The save function determines insert vs update by checking if a record with the composite key exists.

### DELETE Function

```sql
-- Accepts JSONB with all PK fields
SELECT delete_canvas_positions(
  1,                                           -- user_id
  '{"entity_type": "node", "entity_id": 42}'   -- composite PK as JSONB
);
```

### SEARCH Function

Search works the same as simple PK entities - it returns paginated results with all fields.

## Type Casting

DZQL automatically determines type casting for PK columns:

- Columns named `id` or ending with `_id` are cast to `::int`
- Other columns (like `entity_type`) are left as text

This means for a key like `(entity_type, entity_id)`:
- `entity_type` is compared as text
- `entity_id` is cast to integer

## Events and Notifications

Events for composite PK entities include the full composite key in the `pk` field:

```json
{
  "table_name": "canvas_positions",
  "op": "insert",
  "pk": {"entity_type": "node", "entity_id": 42},
  "data": {"entity_type": "node", "entity_id": 42, "x": 100, "y": 200}
}
```

## Limitations

- **M2M relationships**: Tables with composite PKs can have M2M relationships, but this is an advanced use case. The M2M sync uses the first PK column for junction table lookups.
- **Auto-increment**: Composite keys don't support auto-increment. All PK values must be provided on insert.

## Example: Template Dependencies

A practical example - tracking dependencies between templates:

```sql
CREATE TABLE template_dependencies (
  template_id INTEGER NOT NULL REFERENCES templates(id),
  depends_on_template_id INTEGER NOT NULL REFERENCES templates(id),
  dependency_type VARCHAR(20) DEFAULT 'requires',
  PRIMARY KEY (template_id, depends_on_template_id)
);

SELECT dzql.register_entity(
  'template_dependencies',
  'dependency_type',
  array['dependency_type'],
  '{"template": "templates", "depends_on": "templates"}',
  false,
  '{}',
  '{}',
  jsonb_build_object(
    'view', array[]::text[],
    'create', array[]::text[],
    'update', array[]::text[],
    'delete', array[]::text[]
  ),
  jsonb_build_object(
    'primary_key', array['template_id', 'depends_on_template_id']
  )
);
```
