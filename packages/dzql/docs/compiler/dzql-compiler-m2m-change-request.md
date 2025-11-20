# DZQL Compiler Change Request: M2M Junction Table Sync in Compiled Save Functions

## Summary
The DZQL compiler needs to generate M2M (many-to-many) junction table synchronization logic in compiled `save_*` functions when an entity has `many_to_many` configuration in its `graph_rules`.

## Current Behavior
Currently, the compiler generates standard CRUD functions from entity definitions, but does **NOT** include M2M junction table sync logic in the `save_*` function. The M2M support only works when using the runtime `generic_save()` operation.

### Current Generated Code (save_resources)
```sql
CREATE OR REPLACE FUNCTION save_resources(
  p_user_id INT,
  p_data JSONB
) RETURNS JSONB AS $$
DECLARE
  v_result resources%ROWTYPE;
  -- ... other variables
BEGIN
  -- Permission checks
  -- Insert or update the main record
  -- Apply field defaults on INSERT
  -- Return the result
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Problem**: When client sends `tag_ids: [1, 2, 3]`, it tries to insert into the `resources` table which fails because `tag_ids` is not a column.

## Desired Behavior
When an entity has M2M configuration, the compiler should:

1. **Detect M2M configuration** in `graph_rules.many_to_many`
2. **Extract the `id_field`** from configuration (e.g., `tag_ids`)
3. **Generate junction table sync logic** in the `save_*` function
4. **Handle the M2M field separately** from regular columns

### Entity Configuration Example
```sql
SELECT dzql.register_entity(
  'resources',
  'title',
  ARRAY['title'],
  '{}',     -- fk_includes
  false,    -- soft_delete
  '{}',     -- temporal_fields
  '{}',     -- notification_paths
  '{}',     -- permission_paths
  '{
    "many_to_many": {
      "tags": {
        "junction_table": "resource_tags",
        "local_key": "resource_id",
        "foreign_key": "tag_id",
        "target_entity": "tags",
        "id_field": "tag_ids",
        "expand": true
      }
    }
  }',       -- graph_rules with M2M
  '{
    "owner_id": "@user_id"
  }'        -- field_defaults
);
```

### Expected Generated Code (save_resources with M2M)
```sql
CREATE OR REPLACE FUNCTION save_resources(
  p_user_id INT,
  p_data JSONB
) RETURNS JSONB AS $$
DECLARE
  v_result resources%ROWTYPE;
  v_existing resources%ROWTYPE;
  v_output JSONB;
  v_is_insert BOOLEAN := false;
  v_notify_users INT[];
  v_id INT;
  -- M2M variables
  v_tag_ids INT[];  -- Extract from M2M config
BEGIN
  -- Extract M2M fields from p_data (don't try to insert into main table)
  IF p_data ? 'tag_ids' THEN
    v_tag_ids := ARRAY(SELECT jsonb_array_elements_text(p_data->'tag_ids')::int);
    p_data := p_data - 'tag_ids';  -- Remove from data to be inserted
  END IF;

  -- Check if insert or update
  IF p_data ? 'id' THEN
    v_id := (p_data->>'id')::int;
    SELECT * INTO v_existing FROM resources WHERE id = v_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Record not found: resources with id=%', v_id;
    END IF;
    v_is_insert := false;
  ELSE
    v_is_insert := true;
  END IF;

  -- Apply field defaults on INSERT
  IF v_is_insert THEN
    -- Apply field defaults: owner_id = @user_id
    IF NOT (p_data ? 'owner_id') THEN
      p_data := p_data || jsonb_build_object('owner_id', p_user_id);
    END IF;
  END IF;

  -- Permission checks
  IF v_is_insert THEN
    IF NOT can_create_resources(p_user_id, p_data) THEN
      RAISE EXCEPTION 'Permission denied: create on resources';
    END IF;
  ELSE
    IF NOT can_update_resources(p_user_id, to_jsonb(v_existing)) THEN
      RAISE EXCEPTION 'Permission denied: update on resources';
    END IF;
  END IF;

  -- Insert or update main record
  IF v_is_insert THEN
    INSERT INTO resources
    SELECT * FROM jsonb_populate_record(NULL::resources, p_data)
    RETURNING * INTO v_result;
    v_id := v_result.id;
  ELSE
    UPDATE resources
    SET
      title = COALESCE((p_data->>'title'), title),
      color = COALESCE((p_data->>'color'), color),
      icon = COALESCE((p_data->>'icon'), icon),
      parent_id = COALESCE((p_data->>'parent_id')::int, parent_id)
    WHERE id = v_id
    RETURNING * INTO v_result;
  END IF;

  -- ============================================================================
  -- M2M: Sync junction table for "tags" relationship
  -- ============================================================================
  IF v_tag_ids IS NOT NULL THEN
    -- Delete tags not in the new list
    DELETE FROM resource_tags
    WHERE resource_id = v_id
      AND (tag_id <> ALL(v_tag_ids) OR v_tag_ids = '{}');

    -- Insert new tags (ON CONFLICT DO NOTHING for idempotency)
    IF array_length(v_tag_ids, 1) > 0 THEN
      INSERT INTO resource_tags (resource_id, tag_id)
      SELECT v_id, unnest(v_tag_ids)
      ON CONFLICT (resource_id, tag_id) DO NOTHING;
    END IF;
  END IF;

  -- Build output with M2M fields included
  v_output := to_jsonb(v_result);

  -- Add tag_ids to output
  SELECT COALESCE(jsonb_agg(tag_id ORDER BY tag_id), '[]'::jsonb)
  INTO v_output
  FROM resource_tags
  WHERE resource_id = v_id;

  v_output := v_output || jsonb_build_object('tag_ids',
    (SELECT COALESCE(jsonb_agg(tag_id ORDER BY tag_id), '[]'::jsonb)
     FROM resource_tags WHERE resource_id = v_id)
  );

  -- Optionally expand full tag objects if expand=true
  IF true THEN  -- Read from M2M config
    v_output := v_output || jsonb_build_object('tags',
      (SELECT COALESCE(jsonb_agg(to_jsonb(t.*) ORDER BY t.id), '[]'::jsonb)
       FROM resource_tags rt
       JOIN tags t ON t.id = rt.tag_id
       WHERE rt.resource_id = v_id)
    );
  END IF;

  -- Resolve notification paths and create event
  v_notify_users := _resolve_notification_paths_resources(p_user_id, v_output);

  INSERT INTO dzql.events (table_name, op, pk, before, after, user_id, notify_users)
  VALUES (
    'resources',
    CASE WHEN v_is_insert THEN 'insert' ELSE 'update' END,
    jsonb_build_object('id', v_id),
    CASE WHEN v_is_insert THEN NULL ELSE to_jsonb(v_existing) END,
    v_output,
    p_user_id,
    v_notify_users
  );

  -- Remove sensitive fields
  v_output := v_output - 'password_hash' - 'password' - 'secret' - 'token';

  RETURN v_output;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

## Implementation Requirements

### 1. Compiler Detection
The compiler needs to detect M2M configuration in the entity's `graph_rules`:
```javascript
const manyToMany = entity.graphRules?.many_to_many || {};
const hasManyToMany = Object.keys(manyToMany).length > 0;
```

### 2. Code Generation Changes
File: `src/compiler/codegen/operation-codegen.js` (or similar)

For each M2M relationship, generate:

**A. Variable declarations** (in DECLARE section):
```sql
v_{id_field} INT[];  -- e.g., v_tag_ids INT[];
```

**B. Extract M2M fields from input** (before INSERT/UPDATE):
```sql
IF p_data ? '{id_field}' THEN
  v_{id_field} := ARRAY(SELECT jsonb_array_elements_text(p_data->'{id_field}')::int);
  p_data := p_data - '{id_field}';
END IF;
```

**C. Junction table sync** (after main record save):
```sql
IF v_{id_field} IS NOT NULL THEN
  DELETE FROM {junction_table}
  WHERE {local_key} = v_id
    AND ({foreign_key} <> ALL(v_{id_field}) OR v_{id_field} = '{}');

  IF array_length(v_{id_field}, 1) > 0 THEN
    INSERT INTO {junction_table} ({local_key}, {foreign_key})
    SELECT v_id, unnest(v_{id_field})
    ON CONFLICT ({local_key}, {foreign_key}) DO NOTHING;
  END IF;
END IF;
```

**D. Include M2M fields in output** (before RETURN):
```sql
-- Add ID array
v_output := v_output || jsonb_build_object('{id_field}',
  (SELECT COALESCE(jsonb_agg({foreign_key} ORDER BY {foreign_key}), '[]'::jsonb)
   FROM {junction_table} WHERE {local_key} = v_id)
);

-- Optionally expand full objects if expand=true
IF {expand} THEN
  v_output := v_output || jsonb_build_object('{relationship_name}',
    (SELECT COALESCE(jsonb_agg(to_jsonb(t.*) ORDER BY t.id), '[]'::jsonb)
     FROM {junction_table} jt
     JOIN {target_entity} t ON t.id = jt.{foreign_key}
     WHERE jt.{local_key} = v_id)
  );
END IF;
```

### 3. GET Operation Enhancement
The `get_*` function should also include M2M fields in its output:
```sql
-- After fetching the main record
v_result := to_jsonb(v_record);

-- Add M2M fields
v_result := v_result || jsonb_build_object('tag_ids',
  (SELECT COALESCE(jsonb_agg(tag_id ORDER BY tag_id), '[]'::jsonb)
   FROM resource_tags WHERE resource_id = v_id)
);
```

### 4. SEARCH Operation Enhancement
Include M2M fields for each record in search results.

## Testing Requirements

### Test Case 1: Create with Tags
```javascript
const resource = await api.save_resources({
  title: "Room A",
  color: "#3788d8",
  tag_ids: [1, 2, 3]
});

// Expected result:
{
  id: 1,
  title: "Room A",
  color: "#3788d8",
  owner_id: 42,  // from field defaults
  tag_ids: [1, 2, 3],
  tags: [  // if expand=true
    { id: 1, name: "Important", color: "#FF0000" },
    { id: 2, name: "Urgent", color: "#FFA500" },
    { id: 3, name: "Review", color: "#00FF00" }
  ]
}
```

### Test Case 2: Update Tags
```javascript
await api.save_resources({
  id: 1,
  tag_ids: [2, 3, 4]  // Remove 1, keep 2&3, add 4
});

// Expected: Junction table updated atomically
```

### Test Case 3: Remove All Tags
```javascript
await api.save_resources({
  id: 1,
  tag_ids: []  // Clear all tags
});

// Expected: All junction table entries removed
```

### Test Case 4: Null/Undefined Handling
```javascript
await api.save_resources({
  id: 1,
  title: "Updated Title"
  // tag_ids not included - should leave tags unchanged
});

// Expected: Tags remain the same
```

## Edge Cases to Handle

1. **Empty array** (`tag_ids: []`) - Delete all relationships
2. **Null/undefined** - Don't touch relationships
3. **Invalid IDs** - Foreign key constraints should handle (or validate)
4. **Concurrent updates** - Use transaction isolation
5. **Multiple M2M relationships** - Process each independently

## Files to Modify

Based on DZQL compiler structure:
1. `src/compiler/codegen/operation-codegen.js` - Main save function generation
2. `src/compiler/compiler.js` - Entity processing and M2M detection
3. Possibly `src/compiler/parser/entity-parser.js` - If M2M parsing needs enhancement

## Success Criteria

- [ ] Compiled `save_*` functions accept M2M `id_field` arrays
- [ ] Junction tables sync atomically with main record
- [ ] GET operations return M2M fields
- [ ] SEARCH operations include M2M fields
- [ ] All test cases pass
- [ ] No breaking changes to existing compiled functions
- [ ] Field defaults still work correctly
- [ ] Backward compatible (entities without M2M work as before)

## Additional Notes

- This is similar to how **field defaults** were added - another enhancement to the save function generation
- The runtime `generic_save()` already has this logic - compiler should generate equivalent code
- M2M sync should happen **within the same transaction** as the main record save
- Consider performance: for entities with many M2M relationships, minimize query count

## Reference Implementation

The runtime implementation can be found in:
- `node_modules/dzql/src/database/migrations/003_operations.sql` - `generic_save()` function
- Look for the M2M sync logic in the `generic_save` function for the reference implementation

---

**Priority**: High
**Impact**: Enables full M2M support in compiled functions, making compiled entities feature-complete with generic operations
**Complexity**: Medium - Similar scope to field defaults feature
