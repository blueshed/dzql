# DZQL Change Requests

## Status: Proposal
**Date:** 2025-11-20
**Reporter:** hump calendar project
**Priority:** High
**Category:** Feature Enhancements

---

## Executive Summary

Three related enhancements to reduce boilerplate and improve DZQL's completeness:

| Request | Problem | Solution | Impact |
|---------|---------|----------|--------|
| **1. Field Defaults** | Must manually send `owner_id` in every save | Auto-populate fields from `p_user_id` and other variables | Eliminates 1 field per save call, prevents errors |
| **2. Custom Function Pass-through** | Compiler ignores custom functions, requires manual duplication | Copy custom functions from entities to compiled output | Single source of truth, no manual syncing |
| **3. Many-to-Many Support** | M2M requires custom functions and N+1 API calls | Include M2M in `get_`/`search_` + accept ID arrays in `save_` | Single atomic save, tags in all queries |

**Combined Benefit:** Create tagged resources in 1 call (not 3+), with automatic ownership, and maintain functions in one place.

---

## Request 1: Auto-populate Fields from p_user_id

### Problem Statement

Every entity with an `owner_id` field requires the client to manually send it:

```javascript
// Client must explicitly set owner_id
await api.save_tags({
  data: {
    name: "Important",
    owner_id: user.id  // ← Manual, error-prone
  }
})
```

**Issues:**
- Verbose and repetitive
- Easy to forget
- Can't be enforced (client could send wrong owner_id)
- NOT NULL constraint failures if forgotten

### Current Workaround

Graph rules with "set_owner" name don't actually work:

```sql
'{
  "on_create": {
    "set_owner": {
      "description": "Set owner_id to current user",
      "actions": []  -- Empty actions do nothing!
    }
  }
}'
```

Client must send owner_id explicitly.

### Proposed Solution

**Add field defaults in entity registration:**

```sql
SELECT dzql.register_entity(
  'tags',
  'name',
  ARRAY['name'],
  '{}',
  false,
  '{}',
  '{
    "ownership": ["@owner_id"]
  }',
  '{
    "view": [],
    "create": [],
    "update": ["@owner_id"],
    "delete": ["@owner_id"]
  }',
  '{
    "field_defaults": {
      "owner_id": "@user_id"
    }
  }'  -- ← NEW: Auto-populate fields
);
```

**Generated save_tags() behavior:**

```sql
-- In save_tags() BEFORE the INSERT:
IF v_is_insert THEN
  -- Auto-populate defaults for new records
  IF p_data ? 'owner_id' = FALSE THEN
    p_data := p_data || jsonb_build_object('owner_id', p_user_id);
  END IF;
END IF;
```

**Client API becomes cleaner:**

```javascript
// owner_id automatically set to current user!
await api.save_tags({
  data: { name: "Important" }
})
```

### Benefits

1. ✅ Less client code
2. ✅ Prevents mistakes (can't forget owner_id)
3. ✅ Enforces security (can't set wrong owner_id)
4. ✅ Clear in entity definition
5. ✅ Works for any field (not just owner_id)

### Additional Use Cases

```jsonb
{
  "field_defaults": {
    "owner_id": "@user_id",           // Set owner to current user
    "created_by": "@user_id",         // Track creator
    "created_at": "@now",             // Auto-timestamp
    "status": "draft",                // Default status
    "org_id": "@user.default_org_id"  // From user context
  }
}
```

---

## Request 2: Pass-through Custom Functions in Compilation

### Problem Statement

When developers add custom functions to `entities/*.sql`, the DZQL compiler **ignores them**:

```sql
-- entities/calendar.sql
CREATE TABLE tags (...);
SELECT dzql.register_entity('tags', ...);

-- Custom function right after entity registration
CREATE FUNCTION toggle_resource_tag(...)
RETURNS JSONB AS $$ ... $$;

SELECT dzql.register_function('toggle_resource_tag');
```

**After `dzql compile`:**
- ✅ `init_db/tags.sql` is generated (CRUD functions)
- ❌ `toggle_resource_tag()` is NOT copied to output
- ❌ Function registration is NOT copied

**Result:** Developers must **manually maintain two copies** of custom functions:
- `entities/calendar.sql` (source of truth)
- `init_db/002_schema.sql` (manually copied for dev database)

### Current Workaround

**Two-step manual process:**

1. Define function in `entities/calendar.sql` (not used by compiler)
2. Copy same function to `init_db/002_schema.sql` (actually loaded)

**Problems:**
- Functions exist in two places
- Easy to forget to sync
- Unclear which is source of truth
- Manual copy-paste is error-prone

### Proposed Solution

**DZQL compiler should pass through custom functions:**

```sql
-- entities/calendar.sql
CREATE TABLE tags (...);
SELECT dzql.register_entity('tags', ...);

-- Custom function - should be copied to output!
CREATE OR REPLACE FUNCTION toggle_resource_tag(
  p_user_id INT,
  p_resource_id INT,
  p_tag_id INT
) RETURNS JSONB AS $$ ... $$;

-- Registration - should be copied to output!
INSERT INTO dzql.registry (fn_regproc)
VALUES ('toggle_resource_tag'::regproc);
```

**After `dzql compile`:**
- ✅ `init_db/tags.sql` contains CRUD functions (generated)
- ✅ `init_db/custom_functions.sql` contains custom functions (passed through)
- OR: ✅ Custom functions appended to end of entity's compiled file

### Implementation Options

**Option A: Separate Output File**
```
init_db/
  tags.sql              ← Generated CRUD
  custom_functions.sql  ← Pass-through (all custom functions)
```

**Option B: Append to Entity File**
```
init_db/
  tags.sql              ← Generated CRUD + custom functions appended
```

**Option C: Dedicated Section**
```sql
-- init_db/tags.sql

-- Generated DZQL CRUD Functions
CREATE FUNCTION get_tags(...) ...
CREATE FUNCTION save_tags(...) ...

-- Custom Functions (pass-through from entities)
CREATE FUNCTION toggle_resource_tag(...) ...
```

**Recommendation:** Option C (single file with clear sections)

### Detection Logic

Compiler should detect:

1. **CREATE FUNCTION statements** after entity registration
2. **INSERT INTO dzql.registry** statements
3. **SELECT dzql.register_function()** calls (if that function exists)

Pass all through to compiled output.

### Benefits

1. ✅ Single source of truth (`entities/*.sql`)
2. ✅ No manual syncing required
3. ✅ Functions stay with related entities
4. ✅ Clear in compiled output
5. ✅ Migrations include custom functions automatically

### Edge Cases

**Q:** What if custom function uses variables from entity?
**A:** Already works - custom functions are PostgreSQL, not templates

**Q:** What about functions NOT related to an entity?
**A:** Put in separate SQL file (e.g., `entities/utils.sql`) or keep in `init_db/002_schema.sql`

**Q:** Should all SQL be passed through?
**A:** Only after entity registration, before next entity or EOF

---

## Request 3: Many-to-Many Relationship Support

### Problem Statement

DZQL currently lacks first-class support for many-to-many relationships. When developers need M2M relationships (e.g., resources ↔ tags), they must:

1. Create junction tables manually
2. Write custom functions for relationship management
3. Make multiple API calls to save complete entities
4. Handle relationship changes in a non-atomic way

This breaks DZQL's core promise: **define your data model once, get everything else generated**.

---

## Current Workaround (Reference Implementation)

### Database Schema

```sql
-- Tags table
CREATE TABLE tags (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL,
    color VARCHAR(7),
    owner_id INTEGER REFERENCES users(id)
);

-- Junction table (not managed by DZQL)
CREATE TABLE resource_tags (
    resource_id INTEGER REFERENCES resources(id) ON DELETE CASCADE,
    tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (resource_id, tag_id)
);
```

### Custom Function Required

```sql
CREATE OR REPLACE FUNCTION toggle_resource_tag(
  p_user_id INT,
  p_resource_id INT,
  p_tag_id INT
) RETURNS JSONB AS $$
-- 40+ lines of boilerplate
-- Permission checks
-- Toggle logic
-- Broadcast events manually
-- Return updated resource
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

SELECT dzql.register_function('toggle_resource_tag');
```

### Client-Side Complexity

```javascript
// 1. Save the resource
const savedResource = await api.save_resources({ data: { title, color } })

// 2. Calculate tag delta
const tagsToAdd = currentTags.filter(t => !originalTags.find(o => o.id === t.id))
const tagsToRemove = originalTags.filter(t => !currentTags.find(c => c.id === t.id))

// 3. Make N additional API calls
for (const tag of [...tagsToAdd, ...tagsToRemove]) {
  await api.toggle_resource_tag({
    p_resource_id: savedResource.id,
    p_tag_id: tag.id
  })
}

// Result: N+1 API calls, N+1 broadcasts, not atomic
```

---

## Proposed Solution

### Entity Registration Enhancement

Extend `graph_rules` parameter to accept many-to-many definitions:

```sql
SELECT dzql.register_entity(
  'resources',
  'title',
  ARRAY['title'],
  '{"resource": "resources"}',  -- Existing FK expansion
  false,
  '{}',
  '{
    "ownership": ["@owner_id"]
  }',
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
        "id_field": "tag_ids"
      }
    }
  }'  -- ← NEW: Many-to-many expansion rules
);
```

### Generated API Enhancement

**Client can now send M2M IDs in save:**
```javascript
await api.save_resources({
  data: {
    title: "Conference Room A",
    color: "#ff0000",
    tag_ids: [1, 2, 3]  // ← Array of tag IDs
  }
})

// Single call, single broadcast, atomic!
```

**Client receives expanded M2M in get/search:**
```javascript
const resource = await api.get_resources({ id: 1 })

// Response automatically includes tags:
{
  id: 1,
  title: "Conference Room A",
  color: "#ff0000",
  tags: [                    // ← Full tag objects expanded
    { id: 1, name: "Meeting", color: "#3788d8" },
    { id: 2, name: "Important", color: "#ff6b6b" }
  ],
  tag_ids: [1, 2]           // ← Also include IDs for easy comparison
}
```

**Search results include M2M:**
```javascript
const result = await api.search_resources({ limit: 10 })

// Each resource in result.data includes tags:
result.data = [
  { id: 1, title: "Room A", tags: [...], tag_ids: [...] },
  { id: 2, title: "Room B", tags: [...], tag_ids: [...] }
]
```

### Compiler Changes

**In `save_<entity>()` function generation**, after INSERT/UPDATE:

```sql
-- Auto-generated by DZQL compiler when many_to_many is defined

-- Sync many-to-many: tags
IF p_data ? 'tag_ids' THEN
  -- Delete tags not in new list
  DELETE FROM resource_tags
  WHERE resource_id = v_result.id
    AND tag_id NOT IN (
      SELECT value::int
      FROM jsonb_array_elements_text(p_data->'tag_ids')
    );

  -- Insert new tags
  INSERT INTO resource_tags (resource_id, tag_id)
  SELECT v_result.id, value::int
  FROM jsonb_array_elements_text(p_data->'tag_ids')
  ON CONFLICT DO NOTHING;
END IF;
```

**In `get_<entity>()` and `search_<entity>()` generation:**

```sql
-- Auto-expand many-to-many relationships
v_result := v_result || jsonb_build_object(
  'tags',
  COALESCE(
    (SELECT jsonb_agg(to_jsonb(t.*))
     FROM resource_tags rt
     JOIN tags t ON t.id = rt.tag_id
     WHERE rt.resource_id = v_result.id),
    '[]'::jsonb
  )
);

-- Also expand tag_ids for easy comparison
v_result := v_result || jsonb_build_object(
  'tag_ids',
  COALESCE(
    (SELECT jsonb_agg(tag_id)
     FROM resource_tags
     WHERE resource_id = v_result.id),
    '[]'::jsonb
  )
);
```

---

## Benefits

### For Developers

1. ✅ **Single API call** - No manual relationship syncing
2. ✅ **Atomic operations** - All in one transaction
3. ✅ **Consistent API** - Works like regular fields
4. ✅ **Less boilerplate** - No custom toggle functions
5. ✅ **Works for new entities** - Can set relationships on creation
6. ✅ **Cancel-friendly** - Don't save = relationships not changed

### For DZQL

1. ✅ **More complete framework** - Handles common use case
2. ✅ **Consistent with FK expansion** - Same pattern, different cardinality
3. ✅ **Maintains real-time** - Still broadcasts complete entity
4. ✅ **No breaking changes** - Opt-in via graph_rules

---

## Implementation Details

### 1. Entity Registration Schema

Extend `dzql.entities` table:

```sql
ALTER TABLE dzql.entities
ADD COLUMN many_to_many JSONB DEFAULT '{}';
```

### 2. Compiler Changes

**File: `dzql/src/compiler/generators/save.js`** (or similar)

After main INSERT/UPDATE:

```javascript
// Check if entity has many_to_many relationships defined
if (entity.many_to_many) {
  for (const [relationName, config] of Object.entries(entity.many_to_many)) {
    const idField = config.id_field // e.g., "tag_ids"
    const junctionTable = config.junction_table // e.g., "resource_tags"
    const localKey = config.local_key // e.g., "resource_id"
    const foreignKey = config.foreign_key // e.g., "tag_id"

    // Generate sync SQL
    sql += `
    IF p_data ? '${idField}' THEN
      DELETE FROM ${junctionTable}
      WHERE ${localKey} = v_result.id
        AND ${foreignKey} NOT IN (
          SELECT value::int FROM jsonb_array_elements_text(p_data->'${idField}')
        );

      INSERT INTO ${junctionTable} (${localKey}, ${foreignKey})
      SELECT v_result.id, value::int
      FROM jsonb_array_elements_text(p_data->'${idField}')
      ON CONFLICT DO NOTHING;
    END IF;
    `
  }
}
```

**File: `dzql/src/compiler/generators/get.js`**

After main record fetch:

```javascript
if (entity.many_to_many) {
  for (const [relationName, config] of Object.entries(entity.many_to_many)) {
    sql += `
    v_result := v_result || jsonb_build_object(
      '${relationName}',
      (SELECT COALESCE(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb)
       FROM ${config.junction_table} jt
       JOIN ${config.target_entity} t ON t.id = jt.${config.foreign_key}
       WHERE jt.${config.local_key} = v_result.id)
    );
    `
  }
}
```

### 3. Migration Path

**For existing DZQL projects:**

No migration needed - this is opt-in via `graph_rules`. Existing entities continue to work unchanged.

**To adopt:**

1. Update entity registration with `many_to_many` config
2. Recompile: `dzql compile entities.sql`
3. Deploy updated functions
4. Update client to send `tag_ids` array

---

## Edge Cases & Considerations

### 1. Permissions

**Question:** Should tag assignment respect permissions?

**Answer:** Use entity's update permission. If user can update the resource, they can change its tags.

### 2. Non-existent Tag IDs

**Question:** What if `tag_ids` contains IDs that don't exist?

**Options:**
- **A.** Skip invalid IDs (silent ignore)
- **B.** Raise error (fail the save)
- **C.** Filter to valid IDs only

**Recommendation:** Option C with a warning log.

### 3. Null vs Empty Array

- `tag_ids: null` → Don't touch tags (leave unchanged)
- `tag_ids: []` → Remove all tags
- Field omitted → Don't touch tags

### 4. Circular References

Not applicable - many-to-many can't create cycles at the relationship level.

### 5. Performance

For large tag arrays (100+ tags per resource):
- Use bulk INSERT with `unnest()` (already in proposed SQL)
- Index junction table properly (standard practice)
- Consider limits on array size

---

## Example: Before vs After

### Before (Current Workaround)

**Server Side:**
```sql
-- Custom function (40+ lines)
CREATE FUNCTION toggle_resource_tag(...) ...

-- Must register manually
SELECT dzql.register_function('toggle_resource_tag');
```

**Client Side:**
```javascript
// N+1 calls
const resource = await api.save_resources({ data: { title: "Room A" } })
await api.toggle_resource_tag({ p_resource_id: resource.id, p_tag_id: 1 })
await api.toggle_resource_tag({ p_resource_id: resource.id, p_tag_id: 2 })
await api.toggle_resource_tag({ p_resource_id: resource.id, p_tag_id: 3 })
```

### After (With DZQL Enhancement)

**Server Side:**
```sql
-- Just entity registration
SELECT dzql.register_entity(
  'resources',
  ...
  '{
    "many_to_many": {
      "tags": {
        "junction_table": "resource_tags",
        "local_key": "resource_id",
        "foreign_key": "tag_id",
        "id_field": "tag_ids"
      }
    }
  }'
);

-- DZQL generates everything else automatically
```

**Client Side:**
```javascript
// Single call
await api.save_resources({
  data: {
    title: "Room A",
    tag_ids: [1, 2, 3]
  }
})

// Response includes expanded tags:
// { id: 1, title: "Room A", tags: [...], tag_ids: [1, 2, 3] }
```

---

## Similar Frameworks

### ActiveRecord (Rails)
```ruby
resource.tag_ids = [1, 2, 3]
resource.save  # Atomically updates junction table
```

### Django ORM
```python
resource.tags.set([tag1, tag2, tag3])  # One call
```

### Prisma
```javascript
await prisma.resource.update({
  where: { id: 1 },
  data: {
    tags: {
      set: [{ id: 1 }, { id: 2 }, { id: 3 }]
    }
  }
})
```

DZQL should provide similar ergonomics.

---

## Implementation Phases

### Phase 1: Core Compiler Support (MVP)

- Accept `many_to_many` in graph_rules
- Generate junction table sync in save_*()
- Generate array expansion in get_*()
- Support `<relation>_ids` field pattern

### Phase 2: Enhanced Features

- Support nested creates: `{ tags: [{ name: "New" }, { id: 2 }] }`
- Support `connect`/`disconnect` operations
- Validation for FK existence
- Cascade delete handling

### Phase 3: Introspection

- Auto-detect junction tables in schema
- Generate graph_rules from database constraints
- `dzql introspect` command

---

## Reference Implementation

**Location:** `hump` calendar project
**Files:**
- `entities/calendar.sql` - Shows workaround with toggle function
- `client/src/components/CalendarDrawer.vue:653-687` - Client-side delta sync
- `migrations/002_add_resource_tags.sql` - Migration pattern

**Usage:**
See this project as proof-of-concept for what DZQL should automate.

---

## Open Questions for DZQL Maintainers

1. **Naming:** `tag_ids`, `tags_ids`, or configurable via `id_field`?
2. **Null handling:** Skip sync, or clear all relationships?
3. **Validation:** Error on invalid IDs, or silently filter?
4. **Ordering:** Support order in junction table (e.g., `position` column)?
5. **Self-referential:** Support M2M to same table (e.g., tags → related_tags)?
6. **Through attributes:** Support extra fields on junction table?

---

## Benefits Summary

**Developer Experience:**
- Single save call (not N+1)
- Atomic operations
- Less boilerplate

**Framework Completeness:**
- Handles common pattern (M2M is everywhere)
- Consistent with FK expansion
- No custom functions needed

**Real-time Integrity:**
- Single broadcast with complete entity
- No partial state updates
- Cleaner client code

---

## Backwards Compatibility

**Breaking Changes:** None

This is **purely additive**:
- Opt-in via `graph_rules`
- Existing entities continue to work unchanged
- Projects can migrate incrementally

---

## Alternative: Do Nothing

**Consequences if NOT implemented:**

1. Every DZQL project with M2M relationships will reinvent this
2. Code duplication across projects
3. Inconsistent patterns in ecosystem
4. DZQL remains incomplete for common use cases

**Current workarounds:**
- Custom toggle functions (verbose)
- TEXT[] columns (can't enforce referential integrity)
- JSONB arrays (can't query efficiently)
- Accept N+1 calls (performance penalty)

None are ideal - proper M2M support is needed.

---

## Success Criteria

Feature is successful if:

1. ✅ Developer can define M2M in entity registration
2. ✅ Compiler generates junction table sync in save_*()
3. ✅ Get/search operations auto-expand relationships
4. ✅ Single save call updates both entity and relationships
5. ✅ Broadcasts include complete entity state
6. ✅ No custom functions required
7. ✅ Works for new and existing entities
8. ✅ Documentation shows M2M example
9. ✅ Tests cover M2M scenarios
10. ✅ Migration guide for existing projects

---

## Appendix: graph_rules Parameter Spec

### Current Support (FK Expansion)

```json
{
  "resource": "resources"  // Expands resource_id FK
}
```

### Proposed Addition (M2M Expansion)

```json
{
  "many_to_many": {
    "<relationship_name>": {
      "junction_table": "string",    // Required: junction table name
      "local_key": "string",          // Required: FK to this entity
      "foreign_key": "string",        // Required: FK to target entity
      "target_entity": "string",      // Required: target entity name
      "id_field": "string",           // Optional: field name for ID array (default: <name>_ids)
      "expand": boolean,              // Optional: include full objects (default: true)
      "order_by": "string"            // Optional: ORDER BY clause for expansion
    }
  }
}
```

### Example with Multiple M2M

```json
{
  "many_to_many": {
    "tags": {
      "junction_table": "resource_tags",
      "local_key": "resource_id",
      "foreign_key": "tag_id",
      "target_entity": "tags",
      "id_field": "tag_ids"
    },
    "collaborators": {
      "junction_table": "resource_collaborators",
      "local_key": "resource_id",
      "foreign_key": "user_id",
      "target_entity": "users",
      "id_field": "collaborator_ids"
    }
  }
}
```

---

## Impact Assessment

**Effort:** Medium (estimated 2-3 days)

**Files to Modify:**
- `src/compiler/entity-parser.js` - Parse many_to_many config
- `src/compiler/generators/save.js` - Add junction sync
- `src/compiler/generators/get.js` - Add expansion
- `src/compiler/generators/search.js` - Add expansion
- `src/database/core.sql` - Update dzql.entities schema
- `docs/` - Add M2M examples

**Tests to Add:**
- M2M entity registration
- Save with ID arrays
- Get/search with expansion
- Null/empty array handling
- Permission checks
- Real-time broadcasts

**Documentation Needed:**
- Entity registration guide
- M2M examples
- Migration guide for existing projects
- Best practices

---

---

## Combined Example: Both Features Together

### Entity Registration

```sql
SELECT dzql.register_entity(
  'resources',
  'title',
  ARRAY['title'],
  '{}',
  false,
  '{}',
  '{
    "ownership": ["@owner_id"]
  }',
  '{
    "view": [],
    "create": [],
    "update": ["@owner_id"],
    "delete": ["@owner_id"]
  }',
  '{
    "field_defaults": {
      "owner_id": "@user_id"
    },
    "many_to_many": {
      "tags": {
        "junction_table": "resource_tags",
        "local_key": "resource_id",
        "foreign_key": "tag_id",
        "target_entity": "tags",
        "id_field": "tag_ids"
      }
    }
  }'
);
```

### Client API (Clean & Simple)

```javascript
// Create resource with tags - single call!
const resource = await api.save_resources({
  data: {
    title: "Conference Room A",
    color: "#ff0000",
    tag_ids: [1, 2, 3]
    // owner_id auto-populated from p_user_id
  }
})

// Response includes everything:
{
  id: 1,
  title: "Conference Room A",
  color: "#ff0000",
  owner_id: 123,              // Auto-populated
  tags: [                     // Auto-expanded
    { id: 1, name: "Meeting", color: "#3788d8" },
    { id: 2, name: "Important", color: "#ff6b6b" },
    { id: 3, name: "VIP", color: "#51cf66" }
  ],
  tag_ids: [1, 2, 3]         // Also included
}

// Search also includes tags
const results = await api.search_resources({})
// Each resource has tags array populated
```

### What Developers Currently Must Do (Workaround)

**Database:**
```sql
-- Custom function to fetch tags
CREATE FUNCTION get_resource_tags(p_user_id INT, p_resource_id INT) ...

-- Custom function to toggle tags
CREATE FUNCTION toggle_resource_tag(p_user_id INT, p_resource_id INT, p_tag_id INT) ...

-- Register both functions
INSERT INTO dzql.registry ...
```

**Client:**
```javascript
// 1. Save resource with explicit owner_id
const resource = await api.save_resources({
  data: {
    title: "Room A",
    owner_id: user.id  // Must send explicitly
  }
})

// 2. Fetch resource tags separately
const tags = await api.get_resource_tags({
  resource_id: resource.id
})

// 3. Toggle each tag individually
for (const tagId of [1, 2, 3]) {
  await api.toggle_resource_tag({
    resource_id: resource.id,
    tag_id: tagId
  })
}

// 4. Resources from search don't include tags
const results = await api.search_resources({})
// Must fetch tags separately for each resource!
```

**Issues:**
- ❌ 3+ API calls per resource with tags
- ❌ Not atomic
- ❌ Custom functions required
- ❌ Verbose client code
- ❌ Easy to forget owner_id

---

## Recommendation

**Implement all three features.**

These enhancements address fundamental pain points discovered in production use:

1. **Field Defaults** - Every entity with ownership needs this
2. **Custom Function Pass-through** - Required for any entity with custom logic
3. **Many-to-Many** - Extremely common pattern (tags, categories, permissions, etc.)

Together, they eliminate massive boilerplate while maintaining DZQL's real-time and security guarantees.

The proposed APIs are:
- Clean and intuitive
- Consistent with DZQL's philosophy
- Non-breaking (opt-in features)
- Well-scoped (MVP is clear)
- Proven in production (this project)

---

## Implementation Priority

**Phase 1: Custom Function Pass-through** (Easiest, Immediate Value)
- Simplest to implement (just copy SQL statements)
- Eliminates manual duplication
- No API changes required
- **Estimated:** 1 day

**Phase 2: Field Defaults** (Easy, High Impact)
- Simple compiler changes in save_*()
- Immediate benefit for all entities with owner_id
- Small change, big impact
- **Estimated:** 1-2 days

**Phase 3: Many-to-Many** (Complex, Highest Value)
- More complex compiler changes
- Requires junction table sync in save_*()
- Requires expansion in get_*() and search_*()
- Handles extremely common use case
- **Estimated:** 3-5 days

**Total Estimated Effort:** 1-2 weeks for all three features

**Recommended Order:** 1 → 2 → 3 (builds incrementally)

---

## Contact

For questions about this proposal or the reference implementation:
- Project: `hump` DZQL calendar
- Files: See "Reference Implementation" sections above
- Migrations: 001 (locations) and 002 (tags) show both patterns
- Live demonstration: Available on request
