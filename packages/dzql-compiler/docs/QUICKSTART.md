# DZQL Compiler - Quick Start Guide

Get up and running with the DZQL Compiler in 5 minutes.

## Installation

```bash
cd /home/user/dzql/packages/dzql-compiler
bun install
```

## Basic Usage

### 1. Compile Your First Entity

```bash
# Compile the venues domain (9 entities)
bun src/cli/index.js /home/user/dzql/packages/venues/database/init_db/009_venues_domain.sql -o compiled/

# Output will be in compiled/ directory
```

### 2. Examine the Output

```bash
# View generated SQL for venues
cat compiled/venues.sql

# Check checksums
cat compiled/checksums.json
```

### 3. Run the Tests

```bash
# All tests should pass
bun test
```

## What You Get

For each entity, the compiler generates:

### Permission Functions
```sql
can_create_venues(p_user_id INT, p_record JSONB) → BOOLEAN
can_update_venues(p_user_id INT, p_record JSONB) → BOOLEAN
can_delete_venues(p_user_id INT, p_record JSONB) → BOOLEAN
can_view_venues(p_user_id INT, p_record JSONB) → BOOLEAN
```

### CRUD Operations
```sql
get_venues(p_user_id INT, p_id INT) → JSONB
save_venues(p_user_id INT, p_data JSONB) → JSONB
delete_venues(p_user_id INT, p_id INT) → JSONB
lookup_venues(p_user_id INT, p_filter TEXT) → JSONB
search_venues(p_user_id INT, p_filters JSONB, p_search TEXT, ...) → JSONB
```

> **Note:** `p_user_id` is always the first parameter in all functions. See [CODING_STANDARDS.md](./CODING_STANDARDS.md).

## Example: Compile a Simple Entity

Create `examples/todos.sql`:

```sql
select dzql.register_entity(
  'todos',
  'title',
  array['title', 'description'],
  '{}',  -- no FK includes
  false, -- no soft delete
  '{}',  -- no temporal fields
  '{}',  -- no notifications
  jsonb_build_object(
    'view', array[]::text[],      -- public
    'create', array[]::text[],    -- public
    'update', array['@owner_id'], -- owner only
    'delete', array['@owner_id']  -- owner only
  )
);
```

Compile it:

```bash
bun src/cli/index.js examples/todos.sql -o compiled/
```

Result: `compiled/todos.sql` with 5 operations + 4 permission checks.

## Using Compiled Functions

Once deployed to PostgreSQL:

```sql
-- Get a todo (p_user_id first, then p_id)
SELECT get_todos(42, 1);  -- user_id=42, id=1

-- Create a todo (p_user_id first, then p_data)
SELECT save_todos(42, '{"title": "Learn DZQL", "owner_id": 42}'::jsonb);

-- Search todos (p_user_id first)
SELECT search_todos(
  42,             -- user_id
  '{}',           -- filters
  'DZQL',         -- search text
  '{"field": "title", "order": "asc"}', -- sort
  1,              -- page
  25              -- limit
);

-- Delete a todo (p_user_id first, then p_id)
SELECT delete_todos(42, 1);
```

## Development Workflow

### 1. Define Entity

Edit `entities/my_entity.sql`:

```sql
select dzql.register_entity(
  'my_entity',
  'name',
  array['name'],
  '{}',
  false
);
```

### 2. Compile

```bash
bun src/cli/index.js entities/my_entity.sql -o compiled/
```

### 3. Deploy

```bash
psql -U dzql -d dzql < compiled/my_entity.sql
```

### 4. Use

```sql
SELECT save_my_entity(1, '{"name": "Test"}'::jsonb);  -- user_id first, then data
```

## Programmatic API

```javascript
import { DZQLCompiler } from './src/compiler.js';

const compiler = new DZQLCompiler();

// Compile from object
const result = compiler.compile({
  tableName: 'posts',
  labelField: 'title',
  searchableFields: ['title', 'body'],
  permissionPaths: {
    view: [],
    update: ['@author_id']
  }
});

console.log(result.sql);
console.log(result.checksum);

// Compile from SQL
import { readFileSync } from 'fs';

const sql = readFileSync('entities/posts.sql', 'utf-8');
const results = compiler.compileFromSQL(sql);

for (const entity of results.results) {
  console.log(`Compiled ${entity.tableName}: ${entity.checksum}`);
}
```

## Verifying Compilation

### Check Checksums

```javascript
import { readFileSync } from 'fs';

const checksums = JSON.parse(readFileSync('compiled/checksums.json', 'utf-8'));

console.log(checksums.venues);
// {
//   checksum: "9c116484...",
//   generatedAt: "2025-11-16T01:38:54.321Z",
//   compilationTime: 12
// }
```

### Test Functions

```sql
-- Test permission check (p_user_id first)
SELECT can_update_venues(42, '{"org_id": 1}'::jsonb);

-- Test GET with FK expansion (p_user_id first, then p_id)
SELECT get_venues(42, 1);
-- Returns: { id: 1, name: "...", org: { id: 1, name: "..." }, sites: [...] }

-- Test SEARCH (p_user_id first)
SELECT search_venues(42, '{}', 'garden', null, 1, 10);
-- Returns: { data: [...], total: 5, page: 1, limit: 10 }
```

## Common Patterns

### Public Read, Owner Write

```sql
select dzql.register_entity(
  'blog_posts',
  'title',
  array['title', 'body'],
  '{}',
  false,
  '{}',
  '{}',
  jsonb_build_object(
    'view', array[]::text[],      -- anyone can read
    'create', array[]::text[],    -- anyone can create
    'update', array['@author_id'], -- only author can update
    'delete', array['@author_id']  -- only author can delete
  )
);
```

### Organization-Scoped

```sql
select dzql.register_entity(
  'projects',
  'name',
  array['name', 'description'],
  '{"org": "organisations"}',
  false,
  '{}',
  '{}',
  jsonb_build_object(
    'view', array['@org_id->members[org_id=$]{active}.user_id'],
    'update', array['@org_id->members[org_id=$,role=admin]{active}.user_id'],
    'delete', array['@org_id->members[org_id=$,role=admin]{active}.user_id'],
    'create', array['@org_id->members[org_id=$]{active}.user_id']
  )
);
```

### Temporal Data

```sql
select dzql.register_entity(
  'memberships',
  'user_id',
  array['user_id', 'org_id'],
  '{"user": "users", "org": "organisations"}',
  false,
  '{"valid_from": "valid_from", "valid_to": "valid_to"}', -- temporal!
  '{}',
  '{}'
);
```

## Debugging

### View Generated SQL

```bash
# Pretty print generated SQL
cat compiled/venues.sql | less

# Search for specific function
grep -A 20 "CREATE OR REPLACE FUNCTION get_venues" compiled/venues.sql
```

### Check Compilation Errors

```bash
# Compile with verbose output
DZQL_COMPILER_VERBOSE=true bun src/cli/index.js entities/my_entity.sql -o compiled/
```

### Test in PostgreSQL

```sql
-- Enable query logging
SET log_statement = 'all';

-- Test function (p_user_id first)
SELECT get_venues(42, 1);

-- View execution plan
EXPLAIN ANALYZE SELECT get_venues(42, 1);
```

## Next Steps

1. **Compile existing entities** - Try compiling your current DZQL entities
2. **Review generated SQL** - Understand what the compiler produces
3. **Test in staging** - Deploy to a test database and verify behavior
4. **Benchmark performance** - Compare runtime vs compiled versions
5. **Report issues** - Let us know what works and what doesn't!

## Need Help?

- **README.md** - Complete documentation
- **SUMMARY.md** - What was built and how
- **tests/compiler.test.js** - Usage examples
- **examples/compiled/** - Real compiled output

## Resources

- Vision document: `/home/user/dzql/vision.md`
- Current DZQL: `/home/user/dzql/packages/dzql/`
- Example apps: `/home/user/dzql/packages/venues/`

Happy compiling! 🚀
