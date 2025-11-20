# Custom Functions

Add custom business logic to your entities with automatic compilation support.

## Overview

DZQL's compiler now automatically includes custom SQL functions defined after entity registration. This eliminates the need to manually maintain functions in multiple locations.

## Benefits

- **Single Source of Truth** - Define functions once in entity files
- **No Manual Syncing** - Compiler handles everything
- **Functions Stay With Entities** - Clear organization
- **Automatic Registration** - Registry entries included

## How It Works

### Before (Manual Duplication)

You had to maintain functions in two places:

```sql
-- entities/calendar.sql (source)
SELECT dzql.register_entity('tags', ...);

CREATE FUNCTION toggle_resource_tag(...) RETURNS JSONB AS $$ ... $$;
INSERT INTO dzql.registry (fn_regproc) VALUES ('toggle_resource_tag'::regproc);
```

Then manually copy to:

```sql
-- init_db/002_schema.sql (deployment)
CREATE FUNCTION toggle_resource_tag(...) RETURNS JSONB AS $$ ... $$;
INSERT INTO dzql.registry (fn_regproc) VALUES ('toggle_resource_tag'::regproc);
```

**Problems:**
- Functions exist in two places
- Easy to forget to sync
- Unclear which is source of truth

### After (Automatic Pass-through)

Just define functions once after entity registration:

```sql
-- entities/calendar.sql
SELECT dzql.register_entity('tags', 'name', ...);

-- Custom function - automatically passed through by compiler!
CREATE OR REPLACE FUNCTION toggle_resource_tag(
  p_user_id INT,
  p_resource_id INT,
  p_tag_id INT
) RETURNS JSONB AS $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM resource_tags
    WHERE resource_id = p_resource_id AND tag_id = p_tag_id
  ) INTO v_exists;

  IF v_exists THEN
    DELETE FROM resource_tags
    WHERE resource_id = p_resource_id AND tag_id = p_tag_id;
  ELSE
    INSERT INTO resource_tags (resource_id, tag_id)
    VALUES (p_resource_id, p_tag_id);
  END IF;

  RETURN jsonb_build_object('success', true, 'exists', NOT v_exists);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Register for RPC access
INSERT INTO dzql.registry (fn_regproc)
VALUES ('toggle_resource_tag'::regproc);
```

After `dzql compile`, the custom function automatically appears in:
- `init_db/tags.sql` under "Custom Functions" section

## What Gets Passed Through

The compiler extracts:

1. **CREATE FUNCTION statements**
   ```sql
   CREATE FUNCTION my_function(...) RETURNS ... AS $$ ... $$;
   CREATE OR REPLACE FUNCTION my_function(...) RETURNS ... AS $$ ... $$;
   ```

2. **Registry registrations**
   ```sql
   INSERT INTO dzql.registry (fn_regproc) VALUES ('my_function'::regproc);
   ```

3. **Alternative registration syntax** (if you use it)
   ```sql
   SELECT dzql.register_function('my_function');
   ```

## Scope

Custom functions are extracted from **after** the entity registration until:
- The next `dzql.register_entity()` call, OR
- End of file

```sql
-- Entity 1
SELECT dzql.register_entity('users', ...);
CREATE FUNCTION user_helper() ...;  -- Included with users entity

-- Entity 2
SELECT dzql.register_entity('posts', ...);
CREATE FUNCTION post_helper() ...;  -- Included with posts entity
```

Each entity gets its own custom functions isolated in the compiled output.

## Compiled Output Format

```sql
-- ============================================================================
-- DZQL Compiled Functions for: tags
-- Generated: 2025-11-20T15:00:00.000Z
-- ============================================================================

-- [Generated CRUD functions: get_tags, save_tags, delete_tags, etc.]

-- ============================================================================
-- Custom Functions for: tags
-- Pass-through from entity definition
-- ============================================================================

CREATE OR REPLACE FUNCTION toggle_resource_tag(...) ...;

INSERT INTO dzql.registry (fn_regproc) VALUES ('toggle_resource_tag'::regproc);
```

## Use Cases

### Toggle Relationships

```sql
CREATE OR REPLACE FUNCTION toggle_favorite(
  p_user_id INT,
  p_item_id INT
) RETURNS JSONB AS $$
  -- Toggle logic here
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Computed Fields

```sql
CREATE OR REPLACE FUNCTION calculate_item_score(
  p_user_id INT,
  p_item_id INT
) RETURNS JSONB AS $$
  -- Scoring logic here
$$ LANGUAGE plpgsql;
```

### Bulk Operations

```sql
CREATE OR REPLACE FUNCTION bulk_assign_tags(
  p_user_id INT,
  p_resource_ids INT[],
  p_tag_id INT
) RETURNS JSONB AS $$
  -- Bulk assignment here
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Complex Business Logic

```sql
CREATE OR REPLACE FUNCTION approve_workflow(
  p_user_id INT,
  p_document_id INT
) RETURNS JSONB AS $$
  -- Multi-step approval logic
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

## Best Practices

### 1. Keep Functions Close to Entities

Define functions right after the related entity registration:

```sql
SELECT dzql.register_entity('documents', ...);

-- Related custom functions
CREATE FUNCTION approve_document(...) ...;
CREATE FUNCTION reject_document(...) ...;
```

### 2. Always Register Functions

Don't forget to register for RPC access:

```sql
CREATE FUNCTION my_function(...) ...;

-- Required for client access!
INSERT INTO dzql.registry (fn_regproc) VALUES ('my_function'::regproc);
```

### 3. Use SECURITY DEFINER Carefully

Only use `SECURITY DEFINER` when the function needs elevated privileges:

```sql
-- Needs elevated privileges (good use of SECURITY DEFINER)
CREATE FUNCTION admin_delete_user(...)
RETURNS void AS $$ ... $$
LANGUAGE plpgsql SECURITY DEFINER;

-- User operates on own data (use SECURITY INVOKER or default)
CREATE FUNCTION update_profile(...)
RETURNS jsonb AS $$ ... $$
LANGUAGE plpgsql;  -- SECURITY INVOKER is default
```

### 4. Include Permission Checks

Custom functions should validate permissions:

```sql
CREATE OR REPLACE FUNCTION custom_operation(
  p_user_id INT,
  p_item_id INT
) RETURNS JSONB AS $$
BEGIN
  -- Always check permission first!
  IF NOT dzql.check_permission(p_user_id, 'update', 'items',
    (SELECT to_jsonb(items.*) FROM items WHERE id = p_item_id)
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  -- Business logic here
  ...
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

## Limitations

### Functions Not Related to Entities

If you have utility functions not tied to a specific entity, you have two options:

**Option 1:** Create a dedicated entity file
```sql
-- entities/utils.sql
-- No entity registration, just functions

CREATE FUNCTION general_utility(...) ...;
INSERT INTO dzql.registry (fn_regproc) VALUES ('general_utility'::regproc);
```

**Option 2:** Keep in manual migration file
```sql
-- init_db/002_utilities.sql
CREATE FUNCTION general_utility(...) ...;
```

### Detection Logic

The compiler extracts SQL between entity registrations. Only these patterns are recognized:

- `CREATE FUNCTION ...` or `CREATE OR REPLACE FUNCTION ...`
- `INSERT INTO dzql.registry ...`
- `SELECT dzql.register_function(...)`

Other SQL (like `CREATE TYPE`, `CREATE INDEX`) is **not** automatically passed through.

## Migration

### For Existing Projects

If you already have custom functions duplicated:

1. **Keep functions in entity files** (e.g., `entities/calendar.sql`)
2. **Remove from manual migration files** (e.g., `init_db/002_schema.sql`)
3. **Recompile:** `dzql compile entities/*.sql`
4. **Deploy:** Updated compiled functions

Your entity files become the single source of truth!

## Example: Complete Entity with Custom Functions

```sql
-- entities/resources.sql

-- Create table
CREATE TABLE resources (
  id serial PRIMARY KEY,
  org_id integer REFERENCES organisations(id),
  title text NOT NULL,
  description text,
  owner_id integer REFERENCES users(id)
);

-- Register entity
SELECT dzql.register_entity(
  'resources',
  'title',
  ARRAY['title', 'description'],
  '{"org": "organisations"}',
  false,
  '{}',
  '{}',
  '{"view": [], "create": [], "update": ["@owner_id"], "delete": ["@owner_id"]}',
  '{}',
  '{"owner_id": "@user_id"}'
);

-- Custom function (automatically passed through)
CREATE OR REPLACE FUNCTION assign_resource_to_user(
  p_user_id INT,
  p_resource_id INT,
  p_target_user_id INT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Check permission
  IF NOT dzql.check_permission(p_user_id, 'update', 'resources',
    (SELECT to_jsonb(resources.*) FROM resources WHERE id = p_resource_id)
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  -- Update owner
  UPDATE resources
  SET owner_id = p_target_user_id
  WHERE id = p_resource_id;

  -- Return updated resource
  RETURN (SELECT to_jsonb(resources.*) FROM resources WHERE id = p_resource_id);
END;
$$;

-- Register for RPC access
INSERT INTO dzql.registry (fn_regproc)
VALUES ('assign_resource_to_user'::regproc);
```

After compilation, everything is in `init_db/resources.sql` - no manual copying needed!

## See Also

- [Many-to-Many Support](./many-to-many.md) - M2M relationships eliminate many toggle functions
- [Field Defaults](./field-defaults.md) - Auto-populate fields
- [Graph Rules](../reference/api.md#graph-rules) - Automatic relationship management
