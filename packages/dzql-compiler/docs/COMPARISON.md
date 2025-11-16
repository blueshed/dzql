# Runtime vs Compiled DZQL - Side-by-Side Comparison

This document shows the architectural differences between the current runtime-interpreted DZQL and the new compiled approach.

## Entity Registration

### Runtime (Current)

**Entity definition is stored as JSON in database:**

```sql
-- Stored in dzql.entities table
INSERT INTO dzql.entities (
  table_name,
  label_field,
  searchable_fields,
  fk_includes,
  permission_paths,
  notification_paths,
  graph_rules
) VALUES (
  'venues',
  'name',
  ARRAY['name', 'address'],
  '{"org": "organisations"}'::jsonb,
  '{"update": ["@org_id->acts_for[org_id=$]{active}.user_id"]}'::jsonb,
  '{"ownership": ["@org_id->acts_for[org_id=$]{active}.user_id"]}'::jsonb,
  '{"on_create": {...}}'::jsonb
);
```

**Every operation parses this JSON at runtime:**

```sql
SELECT dzql.generic_exec('save', 'venues', '{"name": "MSG"}'::jsonb, 42);
  ↓
dzql.generic_save('venues', ...)
  ↓
1. Fetch entity config from dzql.entities (JSONB parse)
2. Parse permission_paths JSON
3. Evaluate paths dynamically
4. Parse graph_rules JSON
5. Execute rules via dynamic SQL
6. Parse notification_paths JSON
7. Resolve paths dynamically
8. Finally execute the save
```

**Cost per request:**
- 1 table lookup (`dzql.entities`)
- 3-5 JSONB parse operations
- Dynamic SQL generation
- Path resolution interpretation
- Graph rule interpretation

---

### Compiled (New)

**Entity definition compiles to native functions:**

```sql
-- Permission check (pre-compiled)
CREATE OR REPLACE FUNCTION can_update_venues(p_user_id INT, p_record JSONB)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM acts_for
    WHERE org_id = (p_record->>'org_id')::int
      AND user_id = p_user_id
      AND valid_to IS NULL  -- {active}
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Save operation (pre-compiled)
CREATE OR REPLACE FUNCTION save_venues(p_data JSONB, p_user_id INT)
RETURNS JSONB AS $$
DECLARE
  v_result venues%ROWTYPE;
BEGIN
  -- Check permission (direct function call)
  IF NOT can_update_venues(p_user_id, p_data) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  -- Perform save
  INSERT INTO venues (...) VALUES (...)
  ON CONFLICT (id) DO UPDATE SET ...
  RETURNING * INTO v_result;

  -- Execute graph rules (pre-compiled)
  -- ...

  -- Resolve notifications (pre-compiled)
  -- ...

  RETURN to_jsonb(v_result);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Direct function call:**

```sql
SELECT save_venues('{"name": "MSG"}'::jsonb, 42);
  ↓
save_venues(...)
  ↓
1. can_update_venues() - optimized SQL
2. INSERT/UPDATE - direct
3. Graph rules - pre-compiled
4. Notifications - pre-compiled
5. Done
```

**Cost per request:**
- 0 JSON config lookups
- 0 dynamic SQL generation
- 0 path interpretation
- Just the actual work

---

## Performance Comparison

### GET Operation

#### Runtime (Current)

```sql
SELECT dzql.generic_exec('get', 'venues', '{"id": 1}'::jsonb, 42);
```

**Execution path:**
1. Call `dzql.generic_exec()`
2. Route to `dzql.generic_get()`
3. `SELECT * FROM dzql.entities WHERE table_name = 'venues'` ← **lookup**
4. Parse `fk_includes` JSONB ← **parse**
5. Parse `permission_paths` JSONB ← **parse**
6. Build permission query dynamically ← **generate SQL**
7. Check permission via `dzql.check_permission()` ← **interpret path**
8. Fetch record: `SELECT * FROM venues WHERE id = 1`
9. Loop through `fk_includes` JSONB ← **interpret**
10. For each FK, call `dzql.resolve_direct_fk()` ← **dynamic SQL**
11. Return result

**Total:** ~11 steps, 3 JSONB parses, 2 dynamic SQL generations

---

#### Compiled (New)

```sql
SELECT get_venues(1, 42);
```

**Execution path:**
1. Call `get_venues()`
2. Check permission via `can_view_venues()` ← **pre-compiled**
3. Fetch record: `SELECT * FROM venues WHERE id = 1`
4. Expand FK: `SELECT * FROM organisations WHERE id = v.org_id` ← **pre-compiled**
5. Expand children: `SELECT * FROM sites WHERE venue_id = 1` ← **pre-compiled**
6. Return result

**Total:** ~6 steps, 0 JSONB parses, 0 dynamic SQL

**Speedup:** ~2-3x faster, more consistent query plans

---

## Permission Checking

### Runtime (Current)

```sql
-- Permission path stored as JSON string
permission_paths: {
  "update": ["@org_id->acts_for[org_id=$]{active}.user_id"]
}
```

**At runtime:**

```plpgsql
-- In dzql.check_permission()
l_paths := entity_config.permission_paths->operation;  -- JSONB parse

FOR l_path IN SELECT * FROM jsonb_array_elements_text(l_paths)
LOOP
  -- Parse path string: "@org_id->acts_for[org_id=$]{active}.user_id"
  l_result := dzql.resolve_path(table_name, record, l_path);
  -- Dynamically build and execute SQL:
  -- SELECT user_id FROM acts_for WHERE org_id = ... AND valid_to IS NULL

  IF l_result @> to_jsonb(user_id) THEN
    RETURN true;
  END IF;
END LOOP;
```

**Problems:**
- Path parsed every time
- SQL built dynamically
- Hard to optimize
- No query plan caching

---

### Compiled (New)

```sql
CREATE OR REPLACE FUNCTION can_update_venues(p_user_id INT, p_record JSONB)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM acts_for
    WHERE org_id = (p_record->>'org_id')::int
      AND user_id = p_user_id
      AND valid_to IS NULL
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
```

**Benefits:**
- Path pre-compiled to SQL
- PostgreSQL can plan and cache it
- Can use indexes effectively
- Easy to debug with EXPLAIN
- Consistent performance

---

## Notification Resolution

### Runtime (Current)

```sql
-- Notification path stored as JSON
notification_paths: {
  "ownership": ["@org_id->acts_for[org_id=$]{active}.user_id"]
}
```

**At runtime:**

```plpgsql
-- In dzql.resolve_notification_paths()
l_paths := entity_config.notification_paths;  -- JSONB parse

FOR l_path_name, l_path IN SELECT * FROM jsonb_each(l_paths)
LOOP
  FOR l_path_str IN SELECT * FROM jsonb_array_elements_text(l_path)
  LOOP
    -- Parse and resolve each path dynamically
    l_users := l_users || dzql.resolve_notification_path(table_name, record, l_path_str);
  END LOOP;
END LOOP;

-- Insert into events table with dynamic user list
INSERT INTO dzql.events (notify_users) VALUES (l_users);
```

**Problems:**
- Multiple JSONB parses
- Multiple path resolutions
- Hard to optimize
- Can't use indexes well

---

### Compiled (New)

```sql
CREATE OR REPLACE FUNCTION resolve_notification_paths_venues(p_record JSONB)
RETURNS INT[] AS $$
BEGIN
  RETURN ARRAY(
    SELECT DISTINCT user_id
    FROM acts_for
    WHERE org_id = (p_record->>'org_id')::int
      AND valid_to IS NULL
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
```

**Called in save_venues:**

```plpgsql
-- Resolve notifications (direct function call)
v_notify_users := resolve_notification_paths_venues(to_jsonb(v_result));

-- Insert event
INSERT INTO dzql.events (notify_users) VALUES (v_notify_users);
```

**Benefits:**
- Single function call
- Pre-optimized SQL
- Can use indexes
- Consistent query plan

---

## Graph Rules Execution

### Runtime (Current)

```sql
-- Graph rules stored as nested JSON
graph_rules: {
  "on_create": {
    "establish_ownership": {
      "actions": [
        {
          "type": "create",
          "entity": "acts_for",
          "data": {
            "user_id": "@user_id",
            "org_id": "@id"
          }
        }
      ]
    }
  }
}
```

**At runtime:**

```plpgsql
-- In dzql.execute_graph_rules()
l_rules := entity_config.graph_rules->trigger;  -- JSONB parse

FOR l_rule_name, l_rule_config IN SELECT * FROM jsonb_each(l_rules)
LOOP
  FOR l_action IN SELECT * FROM jsonb_array_elements(l_rule_config->'actions')
  LOOP
    l_action_type := l_action->>'type';  -- JSONB parse

    CASE l_action_type
      WHEN 'create' THEN
        l_entity := l_action->>'entity';  -- JSONB parse
        l_data := dzql.resolve_graph_data(l_action->'data', record, user_id);  -- JSONB parse + resolution
        PERFORM dzql.execute_graph_insert(l_entity, l_data, user_id);  -- Dynamic INSERT
      WHEN 'update' THEN
        -- Similar dynamic execution
    END CASE;
  END LOOP;
END LOOP;
```

**Problems:**
- Multiple levels of JSONB parsing
- Dynamic SQL for every action
- Hard to debug
- Performance unpredictable

---

### Compiled (New - Planned)

```sql
-- Generated for graph rule
CREATE OR REPLACE FUNCTION graph_venues_on_create(
  p_record JSONB,
  p_user_id INT
) RETURNS VOID AS $$
BEGIN
  -- establish_ownership action (pre-compiled)
  INSERT INTO acts_for (user_id, org_id, valid_from)
  VALUES (
    p_user_id,
    (p_record->>'id')::int,
    CURRENT_DATE
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Called in save_venues:**

```plpgsql
-- Execute graph rules (direct function call)
IF v_is_insert THEN
  PERFORM graph_venues_on_create(to_jsonb(v_result), p_user_id);
END IF;
```

**Benefits:**
- No JSONB parsing
- Direct SQL execution
- Atomic with transaction
- Easy to debug and optimize

---

## FK Expansion

### Runtime (Current)

```sql
-- FK includes stored as JSON
fk_includes: {
  "org": "organisations",
  "sites": "sites"
}
```

**At runtime:**

```plpgsql
-- In dzql.generic_get()
l_fk_includes := entity_config.fk_includes;  -- JSONB parse

FOR l_key, l_value IN SELECT * FROM jsonb_each_text(l_fk_includes)
LOOP
  -- Determine if direct or reverse FK
  IF l_key = l_value THEN
    -- Reverse FK (child array)
    l_fk_result := dzql.resolve_reverse_fk(record, l_key, l_value || '.' || entity || '_id');
  ELSE
    -- Direct FK
    l_fk_result := dzql.resolve_direct_fk(record, l_key, l_value);
  END IF;

  -- Merge into result
  l_result := l_result || jsonb_build_object(l_key, l_fk_result);
END LOOP;
```

**Problems:**
- JSONB parsing
- Loop overhead
- Dynamic SQL in resolve functions
- Multiple separate queries

---

### Compiled (New)

```sql
-- In get_venues()
BEGIN
  -- Fetch record
  SELECT * INTO v_record FROM venues WHERE id = p_id;
  v_result := to_jsonb(v_record);

  -- Expand org (direct FK - pre-compiled)
  IF v_record.org_id IS NOT NULL THEN
    v_result := v_result || jsonb_build_object(
      'org',
      (SELECT to_jsonb(t.*) FROM organisations t WHERE t.id = v_record.org_id)
    );
  END IF;

  -- Expand sites (reverse FK - pre-compiled)
  v_result := v_result || jsonb_build_object(
    'sites',
    (SELECT COALESCE(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb)
     FROM sites t
     WHERE t.venue_id = v_record.id)
  );

  RETURN v_result;
END;
```

**Benefits:**
- No loops or JSONB parsing
- Direct SQL queries
- PostgreSQL can optimize joins
- Predictable performance

---

## Debugging & Observability

### Runtime (Current)

**Query Analysis:**
```sql
EXPLAIN ANALYZE SELECT dzql.generic_exec('save', 'venues', '{...}'::jsonb, 42);
```

**Result:**
```
Function Scan on generic_exec
  -> Function Scan on generic_save
    -> Seq Scan on dzql.entities (filter: table_name = 'venues')
    -> Result (JSONB operations)
    -> Function Scan on check_permission
      -> Result (dynamic SQL from path resolution)
    -> Result (dynamic INSERT/UPDATE)
    -> Function Scan on execute_graph_rules
      -> Result (JSONB parsing and dynamic SQL)
    -> Function Scan on resolve_notification_paths
      -> Result (dynamic SQL from path resolution)
```

**Problems:**
- Hard to understand
- Generic query plans
- Can't see actual operations
- Hard to optimize

---

### Compiled (New)

**Query Analysis:**
```sql
EXPLAIN ANALYZE SELECT save_venues('{...}'::jsonb, 42);
```

**Result:**
```
Function Scan on save_venues
  -> Function Scan on can_update_venues
    -> Index Scan on acts_for (org_id, user_id)
  -> Index Scan on venues (id)
  -> Result (INSERT/UPDATE)
  -> Function Scan on graph_venues_on_create
    -> Insert on acts_for
  -> Function Scan on resolve_notification_paths_venues
    -> Index Scan on acts_for (org_id)
```

**Benefits:**
- Clear execution path
- Specific query plans
- Can see index usage
- Easy to optimize

**Standard PostgreSQL Tools Work:**
```sql
-- View slow queries
SELECT * FROM pg_stat_statements
WHERE query LIKE '%save_venues%'
ORDER BY total_time DESC;

-- Analyze specific function
EXPLAIN (ANALYZE, BUFFERS) SELECT save_venues('{...}'::jsonb, 42);

-- View function source
\sf save_venues
```

---

## Development Workflow

### Runtime (Current)

1. **Define entity:**
   ```javascript
   registerEntity('venues', {
     labelField: 'name',
     permissions: { ... },
     graphRules: { ... }
   });
   ```

2. **Server restarts** → Entity registered in database

3. **Immediate use:**
   ```javascript
   await db.api.save.venues({ name: 'MSG' }, userId);
   ```

4. **Debug issues:**
   - Enable query logging
   - Add console.log in generic_exec
   - Inspect dzql.entities table
   - Hope the path resolution works

**Pros:**
- ✅ Fast iteration
- ✅ No build step
- ✅ Dynamic changes

**Cons:**
- ❌ Hard to debug
- ❌ Performance unpredictable
- ❌ No type safety
- ❌ Opaque behavior

---

### Compiled (New)

1. **Define entity:**
   ```sql
   select dzql.register_entity('venues', ...);
   ```

2. **Compile:**
   ```bash
   bun dzql-compile entities/venues.sql -o compiled/
   ```

3. **Review generated SQL:**
   ```bash
   cat compiled/venues.sql
   ```

4. **Deploy:**
   ```bash
   psql < compiled/venues.sql
   ```

5. **Use:**
   ```sql
   SELECT save_venues('{"name": "MSG"}'::jsonb, 42);
   ```

6. **Debug:**
   ```sql
   EXPLAIN ANALYZE SELECT save_venues(...);
   \sf save_venues
   ```

**Pros:**
- ✅ Clear generated SQL
- ✅ Standard debugging tools
- ✅ Predictable performance
- ✅ Git-trackable output

**Cons:**
- ❌ Build step required
- ❌ Slower iteration
- ❌ Less dynamic

---

## Summary Table

| Aspect | Runtime | Compiled | Winner |
|--------|---------|----------|--------|
| **Performance** | Variable | Consistent | ✅ Compiled |
| **Query Planning** | Generic | Specific | ✅ Compiled |
| **Debugging** | Opaque | Transparent | ✅ Compiled |
| **Development Speed** | Fast | Slower | ✅ Runtime |
| **Type Safety** | None | Possible | ✅ Compiled |
| **Optimization** | Hard | Easy | ✅ Compiled |
| **Flexibility** | High | Medium | ✅ Runtime |
| **Learning Curve** | Moderate | Low | ✅ Compiled |
| **Production Readiness** | Good | Better | ✅ Compiled |

## Conclusion

The compiled approach trades **development flexibility** for **production performance and clarity**.

### When to use Runtime (Current):
- ✅ Rapid prototyping
- ✅ Frequent schema changes
- ✅ Learning DZQL
- ✅ Small applications

### When to use Compiled (New):
- ✅ Production applications
- ✅ Performance-critical systems
- ✅ Large teams (reviewable SQL)
- ✅ Complex permission rules
- ✅ Need to debug query plans

### Ideal Approach:
**Use both!**
- Development: Runtime for fast iteration
- Staging: Compile and test
- Production: Deploy compiled functions
