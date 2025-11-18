# DZQL Compiler Bug Report

**Date:** 2025-11-17  
**DZQL Version:** 0.1.5  
**Project:** FullCalendar application (hump)

## Bug: Compiler generates calls to missing graph functions when graph_rules is empty

### Issue Description

When compiling entities with empty graph_rules (`'{}'`), the DZQL compiler generates `save_` functions that call `_graph_{entity}_on_create()` functions, but these functions are never generated in the compiled output. This causes runtime errors when attempting to save records.

### Steps to Reproduce

1. Define an entity with empty graph_rules in `entities/calendar.sql`:

```sql
SELECT dzql.register_entity(
  'events',
  'title',
  ARRAY['title', 'description'],
  '{"resource": "resources"}',
  false,
  '{}',
  '{"ownership": ["@owner_id"]}',
  '{
    "view": [],
    "create": [],
    "update": ["@owner_id"],
    "delete": ["@owner_id"]
  }',
  '{}'  -- Empty graph_rules
);
```

2. Compile the entity:
```bash
bun run compile
```

3. Reset the database:
```bash
bun run db
```

4. Attempt to save a record using the compiled `save_events()` function

### Actual Behavior

The compiled `save_events()` function in `init_db/events.sql` contains:

```sql
-- Line ~158
IF v_is_insert THEN
  PERFORM _graph_events_on_create(p_user_id, to_jsonb(v_result));
END IF;
```

However, the `_graph_events_on_create()` function is **never generated** in the compiled output.

### Runtime Error

```
PostgresError: function _graph_events_on_create(integer, jsonb) does not exist
```

### Expected Behavior

The compiler should handle empty graph_rules in one of two ways:

**Option 1:** Skip the graph function call entirely when graph_rules is empty:
```sql
-- IF v_is_insert THEN
--   PERFORM _graph_events_on_create(p_user_id, to_jsonb(v_result));
-- END IF;
-- (commented out or omitted)
```

**Option 2:** Generate a stub function that does nothing:
```sql
CREATE OR REPLACE FUNCTION _graph_events_on_create(
  p_user_id INT,
  p_record JSONB
) RETURNS VOID AS $$
BEGIN
  -- No graph rules defined
  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Workaround

Manually add stub graph functions to each compiled entity SQL file:

```sql
-- Add to init_db/events.sql
CREATE OR REPLACE FUNCTION _graph_events_on_create(
  p_user_id INT,
  p_record JSONB
) RETURNS VOID AS $$
BEGIN
  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add to init_db/resources.sql
CREATE OR REPLACE FUNCTION _graph_resources_on_create(
  p_user_id INT,
  p_record JSONB
) RETURNS VOID AS $$
BEGIN
  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Affected Entities

- `events` entity
- `resources` entity
- Any entity with `graph_rules: '{}'`

### Impact

High - Prevents any INSERT operations on entities with empty graph_rules, making the compiled CRUD operations non-functional until workaround is applied.

### Additional Context

- The compiler is version 0.1.5
- Database: PostgreSQL (via Docker Compose)
- Compilation command: `bun node_modules/dzql/src/compiler/cli/index.js entities/calendar.sql -o init_db/`

### Recommendation

Prefer **Option 1** (skip the call) for cleaner generated code, with **Option 2** (stub function) as a fallback if graph function calls are required for framework consistency.
