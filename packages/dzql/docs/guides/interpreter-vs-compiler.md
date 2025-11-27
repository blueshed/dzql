# Interpreter vs Compiler Mode

DZQL offers two execution modes for your entities. Understanding when to use each is fundamental to getting the best out of the framework.

## Quick Summary

| Aspect | Interpreter | Compiler |
|--------|-------------|----------|
| **Setup** | Register entity, use immediately | Register entity, compile, deploy SQL |
| **Performance** | ~8-12ms per operation | ~2-4ms per operation |
| **Debugging** | Opaque (dynamic SQL) | Transparent (static SQL) |
| **Best For** | Development, prototyping | Production, performance-critical |

## How It Works

### Interpreter Mode (Runtime)

Entity configuration is stored as JSON in `dzql.entities` table and parsed at runtime:

```
Client Request → generic_exec() → Parse JSON config → Build SQL → Execute
```

**Characteristics:**
- Zero build step - changes take effect immediately
- JSON config parsed on every request
- Dynamic SQL generated at runtime
- Generic query plans (harder to optimize)

**Usage:**
```sql
-- Register entity
SELECT dzql.register_entity('todos', 'title', ARRAY['title'], ...);

-- Use immediately via generic executor
SELECT dzql.generic_exec('save', 'todos', '{"title": "Buy milk"}'::jsonb, 1);
```

### Compiler Mode (Static)

Entity configuration is compiled into dedicated PostgreSQL functions:

```
Entity Definition → dzql compile → Static SQL Functions → Deploy → Execute
```

**Characteristics:**
- Build step required
- No JSON parsing at runtime
- Static SQL with specific query plans
- PostgreSQL can optimize and cache plans

**Usage:**
```bash
# Compile entities to SQL
dzql compile entities.sql -o compiled/

# Deploy to database
psql < compiled/entities.sql
```

```sql
-- Use compiled functions directly
SELECT save_todos('{"title": "Buy milk"}'::jsonb, 1);
```

## The Server Automatically Chooses

The DZQL server (`db.js`) automatically tries compiled functions first:

```javascript
// In callDZQLOperation()
try {
  // Try compiled function: save_todos()
  const result = await sql.unsafe(`SELECT save_todos($1, $2)`, [data, userId]);
  return result[0].result;
} catch (error) {
  // If compiled function doesn't exist, fall back to interpreter
  if (error.message.includes('save_todos') && error.code === '42883') {
    return await sql`SELECT dzql.generic_exec('save', 'todos', ${data}, ${userId})`;
  }
  throw error;
}
```

This means you can:
1. Start with interpreter mode during development
2. Compile and deploy when ready for production
3. Mix and match - some entities compiled, others interpreted

## Performance Comparison

### Interpreter (Runtime Parsing)

```sql
SELECT dzql.generic_exec('save', 'venues', '{"name": "MSG"}'::jsonb, 42);
```

**Execution steps:**
1. Fetch entity config from `dzql.entities` (table lookup)
2. Parse `permission_paths` JSONB
3. Build permission query dynamically
4. Parse `graph_rules` JSONB
5. Execute rules via dynamic SQL
6. Parse `notification_paths` JSONB
7. Resolve paths dynamically
8. Execute the actual save

**Cost:** ~8-12ms, 3-5 JSONB parses, unpredictable query plans

### Compiler (Pre-built Functions)

```sql
SELECT save_venues('{"name": "MSG"}'::jsonb, 42);
```

**Execution steps:**
1. Call `can_update_venues()` - pre-compiled permission check
2. Execute INSERT/UPDATE - direct SQL
3. Call `graph_venues_on_create()` - pre-compiled graph rules
4. Call `resolve_notification_paths_venues()` - pre-compiled
5. Done

**Cost:** ~2-4ms, 0 JSONB parses, optimized query plans

## When to Use Each

### Use Interpreter When:
- Rapid prototyping and development
- Schema changes frequently
- Learning DZQL concepts
- Small applications with low traffic
- Need maximum flexibility

### Use Compiler When:
- Production deployments
- Performance is critical
- Need predictable query performance
- Want reviewable/auditable SQL
- Large teams (generated SQL is easy to review)
- Complex permission or graph rules

### Recommended Workflow:
1. **Development:** Use interpreter for fast iteration
2. **Staging:** Compile and test performance
3. **Production:** Deploy compiled functions

## Compiling Entities

### Via CLI

```bash
# Single file
dzql compile database/entities.sql -o compiled/

# Multiple files
dzql compile database/*.sql -o compiled/
```

### Programmatically

```javascript
import { DZQLCompiler } from 'dzql/compiler';

const compiler = new DZQLCompiler();
const result = compiler.compileFromSQL(sqlContent);

console.log(result.sql);  // Generated PostgreSQL functions
```

### What Gets Generated

For each entity, the compiler generates:

| Function | Purpose |
|----------|---------|
| `get_{entity}(id, user_id)` | Retrieve single record |
| `save_{entity}(data, user_id)` | Create or update |
| `delete_{entity}(id, user_id)` | Delete record |
| `lookup_{entity}(term, user_id)` | Autocomplete search |
| `search_{entity}(filters, user_id)` | Paginated search |
| `can_view_{entity}(user_id, record)` | Permission check |
| `can_create_{entity}(user_id, record)` | Permission check |
| `can_update_{entity}(user_id, record)` | Permission check |
| `can_delete_{entity}(user_id, record)` | Permission check |

## Debugging

### Interpreter Mode

Debugging is harder because SQL is generated dynamically:

```sql
-- You see this
EXPLAIN ANALYZE SELECT dzql.generic_exec('save', 'venues', '...');

-- But the actual query is hidden inside
```

### Compiler Mode

Standard PostgreSQL tools work:

```sql
-- See the actual function
\sf save_venues

-- Analyze performance
EXPLAIN ANALYZE SELECT save_venues('{"name": "MSG"}'::jsonb, 42);

-- Check slow queries
SELECT * FROM pg_stat_statements WHERE query LIKE '%save_venues%';
```

## Feature Parity

Both modes support the same features:

| Feature | Interpreter | Compiler |
|---------|-------------|----------|
| CRUD operations | ✅ | ✅ |
| Permission paths | ✅ | ✅ |
| Graph rules | ✅ | ✅ |
| Notification paths | ✅ | ✅ |
| FK includes | ✅ | ✅ |
| Many-to-many | ✅ | ✅ |
| Field defaults | ✅ | ✅ |
| Soft delete | ✅ | ✅ |
| Temporal fields | ✅ | ✅ |

The difference is purely in execution speed and debuggability, not functionality.

## See Also

- [Compiler Quickstart](../compiler/QUICKSTART.md) - Get started with compilation
- [Compiler Comparison](../compiler/COMPARISON.md) - Detailed side-by-side analysis
- [API Reference](../reference/api.md) - The 5 operations
