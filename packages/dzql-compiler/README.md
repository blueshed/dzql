# DZQL Compiler

**Transform declarative entity definitions into optimized PostgreSQL stored procedures.**

## Overview

The DZQL Compiler implements the vision described in `vision.md`: it compiles declarative entity configurations into native PostgreSQL functions, eliminating runtime interpretation overhead and enabling PostgreSQL's query optimizer to work effectively.

### From This (Runtime Interpretation):
```sql
SELECT dzql.generic_exec('save', 'venues', '{"name": "MSG"}'::jsonb, user_id);
-- Parses JSON configuration on every request
```

### To This (Compiled Functions):
```sql
SELECT save_venues('{"name": "MSG"}'::jsonb, user_id);
-- Direct function call with logic baked in
-- PostgreSQL optimizer can see everything
```

## Architecture

```
Entity Definition (SQL or JS)
         ↓
    [Parser]
         ↓
       [AST]
         ↓
   [Code Generator]
         ↓
   PostgreSQL Functions
```

### Components

1. **EntityParser** (`src/parser/entity-parser.js`)
   - Parses `dzql.register_entity()` calls from SQL
   - Extracts entity configuration
   - Normalizes to standard format

2. **PathParser** (`src/parser/path-parser.js`)
   - Parses permission/notification path DSL
   - Converts paths to AST for code generation
   - Handles: `@field`, `field->table[filter]{temporal}.target`

3. **PermissionCodegen** (`src/codegen/permission-codegen.js`)
   - Generates `can_<operation>_<table>()` functions
   - Compiles permission paths to SQL
   - Produces optimized permission checks

4. **OperationCodegen** (`src/codegen/operation-codegen.js`)
   - Generates GET, SAVE, DELETE, LOOKUP, SEARCH functions
   - Compiles FK expansions
   - Handles temporal filtering
   - Integrates permission checks

5. **DZQLCompiler** (`src/compiler.js`)
   - Main orchestrator
   - Coordinates parsing and code generation
   - Calculates checksums for reproducibility
   - Produces complete SQL output

## Usage

### Command Line

```bash
# Compile a single file
bun dzql-compile database/init_db/009_venues_domain.sql

# Specify output directory
bun dzql-compile entities/venues.sql -o compiled/

# Watch mode (coming soon)
bun dzql-compile entities/*.sql --watch
```

### Programmatic API

```javascript
import { DZQLCompiler } from '@dzql/compiler';

const compiler = new DZQLCompiler();

// Compile from entity object
const result = compiler.compile({
  tableName: 'todos',
  labelField: 'title',
  searchableFields: ['title', 'description'],
  permissionPaths: {
    view: ['@owner_id'],
    update: ['@owner_id'],
    delete: ['@owner_id'],
    create: []  // Public
  }
});

console.log(result.sql);
console.log(result.checksum);
```

### Compile from SQL

```javascript
import { compileFromSQL } from '@dzql/compiler';

const sql = `
select dzql.register_entity(
  'venues',
  'name',
  array['name', 'address'],
  '{"org": "organisations", "sites": "sites"}',
  false,
  '{}',
  jsonb_build_object('ownership', array['@org_id->acts_for[org_id=$]{active}.user_id']),
  jsonb_build_object('view', array[]::text[], 'update', array['@org_id->acts_for[org_id=$]{active}.user_id'])
);
`;

const result = compileFromSQL(sql);

for (const entity of result.results) {
  console.log(`Compiled ${entity.tableName}`);
  console.log(`Checksum: ${entity.checksum}`);
}
```

## What Gets Generated

For each entity, the compiler generates:

### 1. Permission Check Functions
```sql
CREATE OR REPLACE FUNCTION can_view_venues(p_user_id INT, p_record JSONB)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN true;  -- Compiled permission logic
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
```

### 2. Operation Functions

**GET** - Fetch single record with FK expansion:
```sql
CREATE OR REPLACE FUNCTION get_venues(
  p_id INT,
  p_user_id INT,
  p_on_date TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB;
```

**SAVE** - Upsert with permissions and graph rules:
```sql
CREATE OR REPLACE FUNCTION save_venues(
  p_data JSONB,
  p_user_id INT
) RETURNS JSONB;
```

**DELETE** - Soft or hard delete with cascades:
```sql
CREATE OR REPLACE FUNCTION delete_venues(
  p_id INT,
  p_user_id INT
) RETURNS JSONB;
```

**LOOKUP** - Autocomplete/dropdown data:
```sql
CREATE OR REPLACE FUNCTION lookup_venues(
  p_filter TEXT DEFAULT NULL,
  p_user_id INT DEFAULT NULL,
  p_limit INT DEFAULT 50
) RETURNS JSONB;
```

**SEARCH** - Advanced search with pagination:
```sql
CREATE OR REPLACE FUNCTION search_venues(
  p_filters JSONB DEFAULT '{}',
  p_search TEXT DEFAULT NULL,
  p_sort JSONB DEFAULT NULL,
  p_page INT DEFAULT 1,
  p_limit INT DEFAULT 25,
  p_user_id INT DEFAULT NULL
) RETURNS JSONB;
```

### 3. Notification Path Resolution
```sql
CREATE OR REPLACE FUNCTION resolve_notification_paths_venues(
  p_record JSONB
) RETURNS INT[] AS $$;
```

## Example Output

See `examples/compiled/` for complete generated SQL files from the venues domain.

## Current Status

### ✅ Working
- Entity parsing from SQL
- Permission function generation (structure)
- All 5 CRUD operations (GET, SAVE, DELETE, LOOKUP, SEARCH)
- FK expansion (direct and reverse)
- Temporal filtering
- Checksum generation for reproducibility
- CLI tool

### 🚧 In Progress
- Permission path compilation (generates stubs)
- Graph rules compilation
- Notification path compilation
- Advanced filter operators in SEARCH
- INSERT/UPDATE dynamic SQL generation

### 📋 TODO
- Source maps (link generated SQL to entity definitions)
- Test function generation
- Incremental compilation
- Watch mode
- Migration generation
- Subscription matcher functions (for Live Query pattern)

## Testing the Compiler

```bash
# Run the compiler on the venues domain
cd /home/user/dzql/packages/dzql-compiler
bun src/cli/index.js /home/user/dzql/packages/venues/database/init_db/009_venues_domain.sql -o examples/compiled

# Check output
ls examples/compiled/
cat examples/compiled/venues.sql
cat examples/compiled/checksums.json
```

## Performance Benefits

Compiled functions eliminate:
- ❌ JSON parsing on every request
- ❌ Dynamic SQL generation overhead
- ❌ Runtime configuration lookups
- ❌ Generic code paths that can't be optimized

And enable:
- ✅ PostgreSQL query planner optimization
- ✅ Predictable query plans
- ✅ Proper index utilization
- ✅ Debuggable with EXPLAIN ANALYZE
- ✅ Real stack traces in PostgreSQL

## Reproducibility

The compiler generates deterministic output:

```json
{
  "venues": {
    "checksum": "9c116484...",
    "generatedAt": "2025-11-16T01:38:54.321Z",
    "compilationTime": 12
  }
}
```

Same input ALWAYS produces same checksum, enabling:
- Git-trackable compiled SQL
- Build verification
- Incremental compilation
- Change detection

## Integration with Current DZQL

The compiled functions are **compatible** with the current DZQL API:

```javascript
// Current (runtime interpretation)
await db.api.get.venues({ id: 1 }, userId);

// Compiled (could call directly)
await sql`SELECT get_venues(${id}, ${userId})`;

// Or through the same API (by changing server-side routing)
await db.api.get.venues({ id: 1 }, userId);
```

## Migration Path

1. **Phase 1**: Compile simple entities without graph rules
2. **Phase 2**: Deploy alongside runtime DZQL (A/B testing)
3. **Phase 3**: Migrate complex entities with graph rules
4. **Phase 4**: Deprecate generic_exec runtime interpreter

## Development

```bash
# Install dependencies
bun install

# Run tests
bun test

# Lint
bun run lint

# Compile an example
bun src/cli/index.js examples/todos.sql -o dist/
```

## Vision Alignment

This compiler implements the core idea from `vision.md`:

> "Stop building interpreters on top of interpreters. Compile your business logic to where it belongs: the database."

By generating native PostgreSQL functions, we:
- Move complexity to compile time
- Trust the database as the application engine
- Embrace PostgreSQL constraints as features
- Solve hard problems (permissions, notifications) correctly

## License

MIT
