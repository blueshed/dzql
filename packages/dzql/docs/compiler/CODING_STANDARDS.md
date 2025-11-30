# DZQL Compiler - Coding Standards

This document defines the coding standards that the DZQL Compiler enforces when generating PostgreSQL functions.

## Function Naming Conventions

### 1. Parameter Naming

**All parameters MUST use the `p_` prefix:**

```sql
-- ✅ CORRECT
CREATE FUNCTION get_users(
  p_user_id INT,
  p_id INT,
  p_on_date TIMESTAMPTZ DEFAULT NULL
)

-- ❌ WRONG
CREATE FUNCTION get_users(
  user_id INT,
  id INT,
  on_date TIMESTAMPTZ DEFAULT NULL
)
```

### 2. Parameter Ordering

**`p_user_id INT` MUST be the first parameter in ALL functions:**

This is a critical security requirement from the DZQL framework - the authenticated user ID must always be the first parameter.

```sql
-- ✅ CORRECT - p_user_id first
CREATE FUNCTION get_users(p_user_id INT, p_id INT, ...)
CREATE FUNCTION save_users(p_user_id INT, p_data JSONB)
CREATE FUNCTION delete_users(p_user_id INT, p_id INT)
CREATE FUNCTION lookup_users(p_user_id INT, p_filter TEXT, ...)
CREATE FUNCTION search_users(p_user_id INT, p_filters JSONB, ...)

-- ❌ WRONG - p_user_id not first
CREATE FUNCTION get_users(p_id INT, p_user_id INT, ...)
CREATE FUNCTION save_users(p_data JSONB, p_user_id INT)
```

### 3. Helper Function Prefixes

**Helper functions MUST start with underscore `_` to prevent direct websocket access:**

Helper functions are internal implementation details that should not be callable by websocket clients.

```sql
-- ✅ CORRECT - Helper functions with underscore
CREATE FUNCTION _graph_users_on_create(p_user_id INT, p_record JSONB)
CREATE FUNCTION _resolve_notification_paths_users(p_user_id INT, p_record JSONB)

-- ❌ WRONG - Helper functions without underscore (publicly callable!)
CREATE FUNCTION graph_users_on_create(p_record JSONB, p_user_id INT)
CREATE FUNCTION resolve_notification_paths_users(p_record JSONB)
```

**Public API functions do NOT use underscore prefix:**

```sql
-- ✅ CORRECT - Public API functions
CREATE FUNCTION can_view_users(p_user_id INT, p_record JSONB)
CREATE FUNCTION can_create_users(p_user_id INT, p_record JSONB)
CREATE FUNCTION get_users(p_user_id INT, p_id INT, ...)
CREATE FUNCTION save_users(p_user_id INT, p_data JSONB)
CREATE FUNCTION delete_users(p_user_id INT, p_id INT)
CREATE FUNCTION lookup_users(p_user_id INT, p_filter TEXT, ...)
CREATE FUNCTION search_users(p_user_id INT, p_filters JSONB, ...)
```

## JSON vs JSONB for Function Parameters

### External API Parameters: Use JSON

When defining function parameters that accept JSON from external callers (API boundary), use `JSON` type (text-based) rather than `JSONB`. This allows callers to pass `JSON.stringify(options)` as a plain string without needing special serialization like `sql.json()`.

```sql
-- ✅ CORRECT - JSON for external input parameters
CREATE FUNCTION register_user(
  p_email TEXT,
  p_password TEXT,
  p_options JSON DEFAULT NULL  -- Accepts plain JSON string from API
)

-- ❌ WRONG - JSONB requires special serialization from clients
CREATE FUNCTION register_user(
  p_email TEXT,
  p_password TEXT,
  p_options JSONB DEFAULT NULL  -- Harder to call from JavaScript
)
```

### Internal Operations: Cast to JSONB

Inside the function, cast to JSONB if you need JSONB operators (`->`, `->>`, `-`, `||`, `?`, etc.):

```sql
CREATE FUNCTION register_user(p_email TEXT, p_password TEXT, p_options JSON DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
  v_insert_data JSONB;
BEGIN
  v_insert_data := jsonb_build_object('email', p_email);
  
  IF p_options IS NOT NULL THEN
    -- Cast to JSONB for internal operations
    v_insert_data := (p_options::jsonb - 'id' - 'password') || v_insert_data;
  END IF;
  
  -- ...
END;
$$ LANGUAGE plpgsql;
```

### Table Columns: Use JSONB

Table columns should still use `JSONB` for efficient storage and indexing:

```sql
-- ✅ CORRECT - JSONB for table columns
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  metadata JSONB DEFAULT '{}'  -- Efficient storage & indexing
);
```

### Summary

| Context | Type | Reason |
|---------|------|--------|
| Function input parameters | `JSON` | Easy to pass from JavaScript (`JSON.stringify()`) |
| Internal function operations | `::jsonb` cast | Access to JSONB operators |
| Table columns | `JSONB` | Efficient storage and indexing |

This pattern - **JSON for input parameters, JSONB for storage** - eliminates serialization confusion at the API boundary.

## Function Categories

### Public API Functions (No underscore)

These are directly callable via the DZQL websocket API:

1. **Permission Check Functions** - `can_{operation}_{table}`
   - `can_view_{table}(p_user_id INT, p_record JSONB)`
   - `can_create_{table}(p_user_id INT, p_record JSONB)`
   - `can_update_{table}(p_user_id INT, p_record JSONB)`
   - `can_delete_{table}(p_user_id INT, p_record JSONB)`

2. **CRUD Operation Functions**
   - `get_{table}(p_user_id INT, p_id INT, p_on_date TIMESTAMPTZ DEFAULT NULL)`
   - `save_{table}(p_user_id INT, p_data JSONB)`
   - `delete_{table}(p_user_id INT, p_id INT)`
   - `lookup_{table}(p_user_id INT, p_filter TEXT DEFAULT NULL, p_limit INT DEFAULT 50)`
   - `search_{table}(p_user_id INT, p_filters JSONB DEFAULT '{}', ...)`

### Helper Functions (With underscore)

These are internal and NOT directly callable via websocket:

1. **Graph Rule Functions** - `_graph_{table}_{trigger}`
   - `_graph_{table}_on_create(p_user_id INT, p_record JSONB)`
   - `_graph_{table}_on_update(p_user_id INT, p_old_record JSONB, p_new_record JSONB)`
   - `_graph_{table}_on_delete(p_user_id INT, p_old_record JSONB)`

2. **Notification Resolution Functions** - `_resolve_notification_paths_{table}`
   - `_resolve_notification_paths_{table}(p_user_id INT, p_record JSONB)`

## Standard Permission Functions

**ALL entities MUST have all 4 permission check functions generated:**

Even if an entity has no permission restrictions (public access), all 4 functions must exist:

```sql
-- Public access - returns true
CREATE FUNCTION can_view_users(p_user_id INT, p_record JSONB)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN true;  -- Public access
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Restricted access - checks permissions
CREATE FUNCTION can_update_users(p_user_id INT, p_record JSONB)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM acts_for
    WHERE acts_for.org_id = (p_record->>'org_id')::int
      AND acts_for.user_id = p_user_id
      AND acts_for.valid_to IS NULL
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
```

## Variable Naming

### Local Variables

**Use `v_` prefix for all local variables:**

```sql
DECLARE
  v_result users%ROWTYPE;           -- ✅ CORRECT
  v_existing users%ROWTYPE;         -- ✅ CORRECT
  v_is_insert BOOLEAN := false;     -- ✅ CORRECT
  v_notify_users INT[];             -- ✅ CORRECT
BEGIN
  -- ...
END;
```

## SQL Style

### Keywords

**All SQL keywords should be UPPERCASE:**

```sql
-- ✅ CORRECT
CREATE OR REPLACE FUNCTION get_users(...)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT * INTO v_result FROM users WHERE id = p_id;
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ❌ WRONG
create or replace function get_users(...)
returns jsonb as $$
declare
  v_result jsonb;
begin
  select * into v_result from users where id = p_id;
  return v_result;
end;
$$ language plpgsql security definer;
```

### Function Attributes

**All functions MUST have:**
- `LANGUAGE plpgsql` (or `LANGUAGE sql`)
- `SECURITY DEFINER` - Runs with privileges of the function owner

**Permission functions should additionally have:**
- `STABLE` - Indicates function doesn't modify the database

```sql
-- Permission function
CREATE FUNCTION can_view_users(...)
RETURNS BOOLEAN AS $$
  -- ...
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Operation function
CREATE FUNCTION save_users(...)
RETURNS JSONB AS $$
  -- ...
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

## Complete Example

Here's a complete example showing all coding standards:

```sql
-- ============================================================================
-- Permission Functions (Public API - no underscore)
-- ============================================================================

-- Permission check: view on organisations
CREATE OR REPLACE FUNCTION can_view_organisations(
  p_user_id INT,
  p_record JSONB
) RETURNS BOOLEAN AS $$
BEGIN
  RETURN true;  -- Public access
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================================
-- CRUD Operations (Public API - no underscore)
-- ============================================================================

-- GET operation for organisations
CREATE OR REPLACE FUNCTION get_organisations(
  p_user_id INT,
  p_id INT,
  p_on_date TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
  v_record organisations%ROWTYPE;
BEGIN
  -- Fetch the record
  SELECT * INTO v_record FROM organisations WHERE id = p_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Record not found: % with id=%', 'organisations', p_id;
  END IF;
  
  -- Convert to JSONB
  v_result := to_jsonb(v_record);
  
  -- Check view permission
  IF NOT can_view_organisations(p_user_id, v_result) THEN
    RAISE EXCEPTION 'Permission denied: view on organisations';
  END IF;
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- SAVE operation for organisations
CREATE OR REPLACE FUNCTION save_organisations(
  p_user_id INT,
  p_data JSONB
) RETURNS JSONB AS $$
DECLARE
  v_result organisations%ROWTYPE;
  v_is_insert BOOLEAN;
BEGIN
  -- Perform UPSERT
  -- ... implementation ...
  
  -- Call graph rules helper
  IF v_is_insert THEN
    PERFORM _graph_organisations_on_create(p_user_id, to_jsonb(v_result));
  END IF;
  
  RETURN to_jsonb(v_result);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Helper Functions (Internal - with underscore)
-- ============================================================================

-- Graph rules: on_create on organisations
CREATE OR REPLACE FUNCTION _graph_organisations_on_create(
  p_user_id INT,
  p_record JSONB
) RETURNS VOID AS $$
BEGIN
  -- Creator becomes owner
  INSERT INTO acts_for (user_id, org_id, valid_from)
  VALUES (p_user_id, (p_record->>'id'), CURRENT_DATE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Notification path resolution for organisations
CREATE OR REPLACE FUNCTION _resolve_notification_paths_organisations(
  p_user_id INT,
  p_record JSONB
) RETURNS INT[] AS $$
DECLARE
  v_users INT[] := ARRAY[]::INT[];
BEGIN
  -- Resolve notification recipients
  -- ... implementation ...
  
  RETURN ARRAY(SELECT DISTINCT unnest(v_users));
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
```

## Why These Standards Matter

### Security

1. **`p_user_id` first** - Ensures user context is always explicit and hard to forget
2. **Helper functions with `_`** - Prevents direct websocket access to internal functions
3. **SECURITY DEFINER** - Ensures proper privilege execution

### Consistency

1. **Predictable parameter order** - Makes all functions follow the same pattern
2. **Standard naming** - Makes generated code easy to read and maintain
3. **All 4 permission functions** - Ensures complete access control coverage

### WebSocket Safety

The underscore prefix prevents clients from directly calling helper functions:

```javascript
// ✅ These work - public API
await ws.api.get.users({id: 1});
await ws.api.save.users({name: 'John'});

// ❌ These DON'T work - helper functions blocked
await ws.api._graph_users_on_create({...});  // Blocked!
await ws.api._resolve_notification_paths_users({...});  // Blocked!
```

## Validation

The DZQL Compiler enforces these standards automatically. All generated code is validated by comprehensive tests that verify:

- ✅ Parameter naming and ordering
- ✅ Function prefixes (helper vs public)
- ✅ All 4 permission functions exist
- ✅ SQL syntax correctness
- ✅ SECURITY DEFINER attribute presence
- ✅ Uppercase SQL keywords

See `tests/sql-validation.test.js` for complete validation suite.
