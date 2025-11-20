# Many-to-Many Relationships

First-class support for many-to-many relationships with automatic junction table management.

## Overview

DZQL provides built-in support for many-to-many (M2M) relationships through junction tables. Define the relationship once in your entity configuration, and DZQL handles:

- Junction table synchronization
- Atomic updates in single API calls
- Automatic expansion in get/search operations
- Real-time broadcasts with complete state

## Benefits

- **Single API Call** - No more N+1 calls for relationship management
- **Atomic Operations** - All changes in one transaction
- **Consistent API** - Works like regular fields
- **Less Boilerplate** - No custom toggle functions needed
- **Performance Control** - Optional expansion (off by default)

## Generic vs Compiled Operations

M2M support works in **both** modes:

### Generic Operations (Runtime)
- Uses `dzql.generic_save()` and dynamic SQL
- Interprets M2M config at runtime (~5-10ms overhead per relationship)
- Works immediately after `register_entity()` call
- Good for development and entities with simple M2M

### Compiled Operations (v0.3.1+) - RECOMMENDED
- Generates **static SQL** at compile time
- **50-100x faster** - zero interpretation overhead
- All table/column names are literals (PostgreSQL optimizes fully)
- Recommended for production and complex M2M scenarios

See [Compiler Guide](../compiler/README.md) for compilation workflow.

## Quick Example

### Setup

```sql
-- Create tables
CREATE TABLE brands (
  id serial PRIMARY KEY,
  org_id integer REFERENCES organisations(id),
  name text NOT NULL
);

CREATE TABLE tags (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  color text
);

-- Junction table
CREATE TABLE brand_tags (
  brand_id integer REFERENCES brands(id) ON DELETE CASCADE,
  tag_id integer REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (brand_id, tag_id)
);

-- Register with M2M support
SELECT dzql.register_entity(
  'brands',
  'name',
  ARRAY['name'],
  '{}', false, '{}', '{}', '{}',
  '{
    "many_to_many": {
      "tags": {
        "junction_table": "brand_tags",
        "local_key": "brand_id",
        "foreign_key": "tag_id",
        "target_entity": "tags",
        "id_field": "tag_ids",
        "expand": false
      }
    }
  }',
  '{}'
);
```

### Client Usage

```javascript
// Create brand with tags in one call
const brand = await api.save_brands({
  data: {
    name: "Premium Brand",
    org_id: 1,
    tag_ids: [1, 2, 3]  // Junction table synced automatically!
  }
})

// Response includes tag IDs
console.log(brand.tag_ids)  // [1, 2, 3]

// Get brand - tag_ids always included
const retrieved = await api.get_brands({ id: brand.id })
console.log(retrieved.tag_ids)  // [1, 2, 3]

// Update tags - single atomic operation
await api.save_brands({
  data: {
    id: brand.id,
    tag_ids: [2, 3, 4]  // Removes 1, keeps 2&3, adds 4
  }
})

// Remove all tags
await api.save_brands({
  data: {
    id: brand.id,
    tag_ids: []  // Clears all tags
  }
})
```

## Configuration

M2M relationships are configured in the `graph_rules` parameter (9th parameter) of `register_entity()`:

```sql
SELECT dzql.register_entity(
  'table_name',
  'label_field',
  ARRAY['searchable_fields'],
  '{}',  -- fk_includes
  false, -- soft_delete
  '{}',  -- temporal_fields
  '{}',  -- notification_paths
  '{}',  -- permission_paths
  '{
    "many_to_many": {
      "relationship_name": {
        "junction_table": "table_name",
        "local_key": "local_fk_column",
        "foreign_key": "foreign_fk_column",
        "target_entity": "target_table",
        "id_field": "field_name_for_ids",
        "expand": false
      }
    }
  }',
  '{}'   -- field_defaults
);
```

### Configuration Options

| Option | Required | Description | Example |
|--------|----------|-------------|---------|
| `junction_table` | Yes | Name of junction table | `"brand_tags"` |
| `local_key` | Yes | FK column pointing to this entity | `"brand_id"` |
| `foreign_key` | Yes | FK column pointing to target entity | `"tag_id"` |
| `target_entity` | Yes | Name of target entity table | `"tags"` |
| `id_field` | Yes | Field name for ID array in API | `"tag_ids"` |
| `expand` | No | Include full objects (default: false) | `false` or `true` |

### The `expand` Flag

Controls whether full related objects are included in responses:

**`expand: false`** (default - recommended for performance):
```javascript
{
  id: 1,
  name: "My Brand",
  tag_ids: [1, 2, 3]  // Just IDs
}
```

**`expand: true`** (for detail views):
```javascript
{
  id: 1,
  name: "My Brand",
  tag_ids: [1, 2, 3],        // IDs included
  tags: [                     // Full objects included
    { id: 1, name: "Premium", color: "#FFD700" },
    { id: 2, name: "Popular", color: "#3B82F6" },
    { id: 3, name: "New", color: "#8B5CF6" }
  ]
}
```

**Performance Impact:**
- `expand: false` - Single query for ID array (fast)
- `expand: true` - Additional JOIN per relationship (slower)

**Recommendation:** Use `false` for list views, `true` for detail views (or fetch tags separately when needed).

## Junction Table Requirements

Your junction table must have:

1. **Two foreign key columns** pointing to the related tables
2. **Composite primary key** or unique constraint on both columns
3. **ON DELETE CASCADE** (recommended) for automatic cleanup

```sql
CREATE TABLE brand_tags (
  brand_id integer NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  tag_id integer NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (brand_id, tag_id)  -- Composite PK prevents duplicates
);

-- Index for reverse lookups (optional but recommended)
CREATE INDEX idx_brand_tags_tag_id ON brand_tags(tag_id);
```

## API Operations

### Create with Relationships

```javascript
// Create brand with tags in single call
const brand = await api.save_brands({
  data: {
    name: "New Brand",
    tag_ids: [1, 2, 3]
  }
})

// Response
{
  id: 5,
  name: "New Brand",
  tag_ids: [1, 2, 3]
}
```

### Update Relationships

```javascript
// Add and remove tags atomically
await api.save_brands({
  data: {
    id: 5,
    tag_ids: [2, 3, 4, 5]  // Remove 1, keep 2&3, add 4&5
  }
})
```

### Remove All Relationships

```javascript
// Empty array removes all
await api.save_brands({
  data: {
    id: 5,
    tag_ids: []  // Clears all tags
  }
})
```

### Leave Relationships Unchanged

```javascript
// Omit the field to not touch relationships
await api.save_brands({
  data: {
    id: 5,
    name: "Updated Name"
    // tag_ids not included - tags unchanged
  }
})
```

### Get with Relationships

```javascript
// Get always includes tag_ids
const brand = await api.get_brands({ id: 5 })

console.log(brand.tag_ids)  // [2, 3, 4, 5]

// If expand: true in config
console.log(brand.tags)     // [{id: 2, ...}, {id: 3, ...}, ...]
```

### Search with Relationships

```javascript
// Search includes tag_ids for each result
const results = await api.search_brands({ limit: 10 })

results.data.forEach(brand => {
  console.log(brand.tag_ids)  // Array of IDs
})
```

## Multiple M2M Relationships

You can define multiple M2M relationships on a single entity:

```sql
SELECT dzql.register_entity(
  'resources',
  'title',
  ARRAY['title'],
  '{}', false, '{}', '{}', '{}',
  '{
    "many_to_many": {
      "tags": {
        "junction_table": "resource_tags",
        "local_key": "resource_id",
        "foreign_key": "tag_id",
        "target_entity": "tags",
        "id_field": "tag_ids",
        "expand": false
      },
      "collaborators": {
        "junction_table": "resource_collaborators",
        "local_key": "resource_id",
        "foreign_key": "user_id",
        "target_entity": "users",
        "id_field": "collaborator_ids",
        "expand": true
      },
      "categories": {
        "junction_table": "resource_categories",
        "local_key": "resource_id",
        "foreign_key": "category_id",
        "target_entity": "categories",
        "id_field": "category_ids",
        "expand": false
      }
    }
  }',
  '{}'
);
```

Client usage:

```javascript
await api.save_resources({
  data: {
    title: "My Resource",
    tag_ids: [1, 2],
    collaborator_ids: [10, 20],
    category_ids: [5]
  }
})

// All three relationships synced atomically!
```

## Implementation Details

### How Junction Sync Works

When you call `save_entity()` with an M2M ID field:

1. **INSERT/UPDATE** the main entity
2. **DELETE** relationships not in new list
3. **INSERT** new relationships (ON CONFLICT DO NOTHING)
4. **QUERY** final state and return with ID arrays

All in a single transaction - atomic!

### SQL Generated

For `save_brands()` with `tag_ids: [1, 2, 3]`:

```sql
-- 1. Insert/update brand
INSERT INTO brands (...) VALUES (...);

-- 2. Delete tags not in [1,2,3]
DELETE FROM brand_tags
WHERE brand_id = 5
  AND tag_id <> ALL(ARRAY[1,2,3]);

-- 3. Insert new tags
INSERT INTO brand_tags (brand_id, tag_id)
VALUES (5, 1), (5, 2), (5, 3)
ON CONFLICT DO NOTHING;

-- 4. Fetch final state
SELECT jsonb_agg(tag_id) FROM brand_tags WHERE brand_id = 5;
```

### Null Handling

| Input | Behavior |
|-------|----------|
| `tag_ids: [1, 2]` | Sync to exactly [1, 2] |
| `tag_ids: []` | Remove all relationships |
| `tag_ids: null` | Leave unchanged (same as omitted) |
| Field omitted | Leave unchanged |

## Comparison to Manual Approach

### Before DZQL M2M Support

**Database:**
```sql
-- Custom toggle function (40+ lines)
CREATE FUNCTION toggle_resource_tag(
  p_user_id INT,
  p_resource_id INT,
  p_tag_id INT
) RETURNS JSONB AS $$ ... $$;
```

**Client:**
```javascript
// 1. Save resource
const resource = await api.save_resources({
  data: { title: "Room A" }
})

// 2. Calculate delta
const toAdd = [1, 2, 3]
const toRemove = [4]

// 3. Make N API calls
for (const tagId of toAdd) {
  await api.toggle_resource_tag({
    p_resource_id: resource.id,
    p_tag_id: tagId
  })
}
```

**Issues:**
- N+1 API calls
- Not atomic
- Custom function required
- Verbose client code

### After DZQL M2M Support

**Database:**
```sql
-- Just entity registration
SELECT dzql.register_entity(
  'resources',
  ...,
  '{"many_to_many": {"tags": {...}}}'
);
```

**Client:**
```javascript
// Single atomic call
const resource = await api.save_resources({
  data: {
    title: "Room A",
    tag_ids: [1, 2, 3]
  }
})
```

**Benefits:**
- 1 API call
- Atomic
- No custom function
- Clean code

## Common Patterns

### Tags

```sql
"tags": {
  "junction_table": "resource_tags",
  "local_key": "resource_id",
  "foreign_key": "tag_id",
  "target_entity": "tags",
  "id_field": "tag_ids",
  "expand": false
}
```

### Collaborators/Team Members

```sql
"collaborators": {
  "junction_table": "project_collaborators",
  "local_key": "project_id",
  "foreign_key": "user_id",
  "target_entity": "users",
  "id_field": "collaborator_ids",
  "expand": true  // Probably want full user objects
}
```

### Categories/Taxonomies

```sql
"categories": {
  "junction_table": "item_categories",
  "local_key": "item_id",
  "foreign_key": "category_id",
  "target_entity": "categories",
  "id_field": "category_ids",
  "expand": false
}
```

### Permissions/Roles

```sql
"roles": {
  "junction_table": "user_roles",
  "local_key": "user_id",
  "foreign_key": "role_id",
  "target_entity": "roles",
  "id_field": "role_ids",
  "expand": true
}
```

## Advanced Usage

### Fetching Tags Separately

When using `expand: false`, fetch related entities when needed:

```javascript
// Get brands (with tag IDs only)
const brands = await api.search_brands({ limit: 10 })

// For a specific brand, fetch full tag details
const brand = brands.data[0]
const tags = await api.search_tags({
  p_filters: { id: { in: brand.tag_ids } }
})
```

### Filtering by M2M Relationships

To find all brands with a specific tag:

```javascript
// Custom SQL or use raw query
const brandsWithTag = await sql`
  SELECT b.*
  FROM brands b
  JOIN brand_tags bt ON bt.brand_id = b.id
  WHERE bt.tag_id = 5
`

// Or create a custom function for this pattern
```

### Junction Tables with Extra Fields

DZQL's M2M currently supports simple junction tables. For junction tables with additional fields (e.g., `position`, `added_at`):

**Option 1:** Model junction as entity
```sql
-- Register the junction table as its own entity
SELECT dzql.register_entity(
  'resource_tags',
  'id',
  ARRAY[],
  '{
    "resource": "resources",
    "tag": "tags"
  }',
  ...
);

-- Then use regular FK relationships
```

**Option 2:** Use custom function
```sql
CREATE FUNCTION add_tag_with_position(
  p_user_id INT,
  p_resource_id INT,
  p_tag_id INT,
  p_position INT
) RETURNS JSONB AS $$ ... $$;
```

## Permissions

M2M operations respect the entity's update permissions:

```sql
SELECT dzql.register_entity(
  'resources',
  'title',
  ARRAY['title'],
  '{}', false, '{}', '{}',
  '{
    "view": [],
    "create": [],
    "update": ["@owner_id"],  -- User must own resource to change tags
    "delete": ["@owner_id"]
  }',
  '{
    "many_to_many": {
      "tags": { ... }
    }
  }'
);
```

If a user can update the resource, they can change its tags. No separate permission check for M2M.

## Error Handling

### Non-existent IDs

If you provide tag IDs that don't exist:

```javascript
await api.save_brands({
  data: {
    id: 1,
    tag_ids: [1, 999, 3]  // 999 doesn't exist
  }
})
```

**Behavior:** `ON CONFLICT DO NOTHING` silently skips invalid IDs. Only valid relationships are created.

**Recommendation:** Validate IDs client-side or use lookup APIs.

### Foreign Key Violations

Junction table foreign keys enforce referential integrity:

```sql
CREATE TABLE brand_tags (
  brand_id integer REFERENCES brands(id) ON DELETE CASCADE,
  tag_id integer REFERENCES tags(id) ON DELETE CASCADE,
  ...
);
```

- ✅ Deleting a brand cascades to junction table
- ✅ Deleting a tag cascades to junction table
- ✅ Database ensures data integrity

## Real-time Updates

M2M changes are broadcast via DZQL's event system:

```javascript
// User A saves brand with new tags
await api.save_brands({
  data: { id: 1, tag_ids: [1, 2, 3] }
})

// User B listening to brands entity receives:
{
  op: "update",
  table_name: "brands",
  after: {
    id: 1,
    name: "Brand Name",
    tag_ids: [1, 2, 3]  // Complete state
  }
}
```

Broadcasts include complete state, so subscribers always have consistent data.

## Performance Considerations

### Search Performance

With `expand: false` (default):
- **Fast** - One additional query per record for ID array
- Recommended for list views

With `expand: true`:
- **Slower** - Additional JOIN per record per relationship
- Use sparingly, or only for detail views

### Optimization Tips

1. **Index junction tables:**
   ```sql
   CREATE INDEX idx_brand_tags_brand_id ON brand_tags(brand_id);
   CREATE INDEX idx_brand_tags_tag_id ON brand_tags(tag_id);
   ```

2. **Limit array sizes** - Consider max tags per entity (e.g., 50)

3. **Use expand: false** for listings, fetch full objects only when needed

4. **Cache tag definitions** client-side if tags are static

## Example: Complete Implementation

```sql
-- ============================================================================
-- Tags & Resources with M2M
-- ============================================================================

-- Tags table
CREATE TABLE tags (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  color text,
  description text
);

-- Resources table
CREATE TABLE resources (
  id serial PRIMARY KEY,
  org_id integer REFERENCES organisations(id),
  title text NOT NULL,
  description text,
  owner_id integer REFERENCES users(id)
);

-- Junction table
CREATE TABLE resource_tags (
  resource_id integer NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  tag_id integer NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (resource_id, tag_id)
);

CREATE INDEX idx_resource_tags_tag_id ON resource_tags(tag_id);

-- Register tags entity (public, simple)
SELECT dzql.register_entity(
  'tags',
  'name',
  ARRAY['name', 'description'],
  '{}', false, '{}', '{}',
  '{
    "view": [],
    "create": [],
    "update": [],
    "delete": []
  }',
  '{}',
  '{}'
);

-- Register resources entity with M2M tags
SELECT dzql.register_entity(
  'resources',
  'title',
  ARRAY['title', 'description'],
  '{"org": "organisations"}',
  false,
  '{}',
  '{}',
  '{
    "view": [],
    "create": [],
    "update": ["@owner_id"],
    "delete": ["@owner_id"]
  }',
  '{
    "many_to_many": {
      "tags": {
        "junction_table": "resource_tags",
        "local_key": "resource_id",
        "foreign_key": "tag_id",
        "target_entity": "tags",
        "id_field": "tag_ids",
        "expand": false
      }
    }
  }',
  '{"owner_id": "@user_id", "created_at": "@now"}'
);

-- Sample tags
INSERT INTO tags (name, color, description) VALUES
  ('Important', '#EF4444', 'High priority items'),
  ('In Progress', '#F59E0B', 'Currently being worked on'),
  ('Completed', '#10B981', 'Finished items')
ON CONFLICT (name) DO NOTHING;
```

**Client usage:**

```javascript
// Create resource with tags - single call!
const resource = await api.save_resources({
  data: {
    title: "Conference Room A",
    description: "Main conference room",
    tag_ids: [1, 2]  // Important + In Progress
    // owner_id auto-populated from field defaults
    // created_at auto-populated from field defaults
  }
})

// Response
{
  id: 1,
  title: "Conference Room A",
  description: "Main conference room",
  owner_id: 123,
  created_at: "2025-11-20T15:00:00Z",
  tag_ids: [1, 2]
}

// Update status by changing tags
await api.save_resources({
  data: {
    id: 1,
    tag_ids: [3]  // Change to Completed
  }
})
```

## Migration Guide

### From Manual M2M to DZQL M2M

If you're currently using custom toggle functions:

**Step 1:** Create junction table (if you haven't)
```sql
CREATE TABLE resource_tags (
  resource_id integer REFERENCES resources(id) ON DELETE CASCADE,
  tag_id integer REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (resource_id, tag_id)
);
```

**Step 2:** Update entity registration to include M2M config

**Step 3:** Remove custom toggle functions (optional - both can coexist)

**Step 4:** Update client code to use `tag_ids` array instead of toggle calls

**Step 5:** Deploy updated functions

## Comparison to Other ORMs

DZQL's M2M support is similar to:

### Rails ActiveRecord
```ruby
resource.tag_ids = [1, 2, 3]
resource.save  # Junction table synced
```

### Django ORM
```python
resource.tags.set([tag1, tag2, tag3])
```

### Prisma
```javascript
await prisma.resource.update({
  where: { id: 1 },
  data: {
    tags: { set: [{ id: 1 }, { id: 2 }] }
  }
})
```

DZQL provides similar ergonomics with the added benefit of real-time synchronization and row-level security.

## Known Limitations

1. **Composite Primary Keys** - Currently assumes single PK (uses first PK column)
2. **Junction Table Fields** - No support for extra fields on junction table
3. **Ordering** - No built-in support for position/order in relationships

For these advanced cases, model the junction table as its own entity or use custom functions.

## Troubleshooting

### IDs not appearing in response

**Check:** Is M2M configured in entity registration?
```sql
SELECT many_to_many FROM dzql.entities WHERE table_name = 'brands';
```

### Junction table not syncing

**Check:** Is the `id_field` spelled correctly?
```javascript
// Config says "tag_ids"
"id_field": "tag_ids"

// Client must use same name
tag_ids: [1, 2, 3]  // ✅ Correct
tags: [1, 2, 3]     // ❌ Wrong field name
```

### Foreign key violations

**Check:** Do the IDs exist in the target table?
```sql
SELECT id FROM tags WHERE id IN (1, 2, 3);
```

### Performance issues in search

**Check:** Is `expand: true` on a heavily queried entity?

**Solution:** Change to `expand: false` and fetch full objects separately when needed.

## See Also

- [Field Defaults](./field-defaults.md) - Auto-populate ownership and timestamps
- [Custom Functions](./custom-functions.md) - Advanced business logic
- [Graph Rules](../reference/api.md#graph-rules) - Automatic relationship management
