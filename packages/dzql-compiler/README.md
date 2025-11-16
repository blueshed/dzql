# DZQL Compiler

> **⚠️ DEPRECATED**: This package has been integrated into the main `dzql` package.
> 
> **Please use `dzql` instead:**
> ```bash
> # Install the main package
> bun add dzql
> 
> # Use the compiler via CLI
> dzql compile entities/venues.sql -o compiled/
> 
> # Or programmatically
> import { DZQLCompiler } from 'dzql/compiler';
> ```
> 
> **Documentation**: See [dzql compiler docs](../dzql/docs/compiler/)

---

**Transform declarative DZQL entity definitions into optimized PostgreSQL stored procedures.**

[![Tests](https://img.shields.io/badge/tests-55%20passing-brightgreen)](./tests/)
[![Standards](https://img.shields.io/badge/coding%20standards-enforced-blue)](./docs/CODING_STANDARDS.md)
[![Status](https://img.shields.io/badge/status-deprecated-orange)]()

## Migration Guide

This standalone compiler package is deprecated. The compiler is now part of the main `dzql` package.

### Before (deprecated):
```bash
bun add @dzql/compiler
bun dzql-compile entities/venues.sql
```

### After (recommended):
```bash
bun add dzql
dzql compile entities/venues.sql
```

All functionality remains the same. See the [main dzql package](../dzql/) for updated documentation.

## What is this?

The DZQL Compiler eliminates runtime interpretation overhead by compiling your entity definitions into native PostgreSQL functions. Instead of parsing configuration on every request, the compiler generates optimized SQL that PostgreSQL's query optimizer can work with directly.

### From This (Runtime):
```sql
SELECT dzql.generic_exec('save', 'venues', '{"name": "MSG"}'::jsonb, user_id);
-- Parses JSON configuration every time
```

### To This (Compiled):
```sql
SELECT save_venues(user_id, '{"name": "MSG"}'::jsonb);
-- Direct function call, fully optimized
```

## Quick Start

```bash
# Install
bun install

# Compile an entity definition
bun src/cli/index.js examples/test-graph-rules.sql -o compiled/

# Run tests
bun test  # 55 tests passing
```

## Generated Functions

For each entity, the compiler generates:

- **4 Permission Functions**: `can_view_*`, `can_create_*`, `can_update_*`, `can_delete_*`
- **5 CRUD Operations**: `get_*`, `save_*`, `delete_*`, `lookup_*`, `search_*`
- **Helper Functions**: `_graph_*`, `_resolve_notification_paths_*` (internal, prefixed with `_`)

All functions follow [DZQL Coding Standards](./docs/CODING_STANDARDS.md) with `p_user_id` as the first parameter.

## Documentation

### Getting Started
- **[Quick Start Guide](./docs/QUICKSTART.md)** - Get up and running in 5 minutes
- **[Coding Standards](./docs/CODING_STANDARDS.md)** - Required conventions for generated code

### Reference
- **[Feature Comparison](./docs/COMPARISON.md)** - Runtime vs Compiled approach
- **[Project Summary](./docs/SUMMARY.md)** - What was built and how
- **[Advanced Filters](./docs/ADVANCED_FILTERS.md)** - Search filter operators

### Development
- **[Session Summary](./docs/SESSION_SUMMARY.md)** - Development history and decisions
- **[Overnight Build](./docs/OVERNIGHT_BUILD.md)** - Initial build narrative

## Architecture

```
Entity Definition (SQL/JS)
         ↓
    [Parser] ────── Extracts config from dzql.register_entity()
         ↓
  [Code Generators]
    ├── PermissionCodegen ── Generates can_* functions
    ├── OperationCodegen ─── Generates CRUD functions
    ├── NotificationCodegen ─ Generates _resolve_* helpers
    └── GraphRulesCodegen ── Generates _graph_* helpers
         ↓
  PostgreSQL Functions
```

## Example

**Input** (`entities/todos.sql`):
```sql
select dzql.register_entity(
  'todos',
  'title',
  array['title', 'description'],
  '{}',
  false,
  '{}',
  '{}',
  jsonb_build_object(
    'view', array[]::text[],      -- public
    'update', array['@owner_id']  -- owner only
  )
);
```

**Compile**:
```bash
bun src/cli/index.js entities/todos.sql -o compiled/
```

**Output** (`compiled/todos.sql`):
```sql
-- 4 permission functions
CREATE FUNCTION can_view_todos(p_user_id INT, p_record JSONB) ...
CREATE FUNCTION can_create_todos(p_user_id INT, p_record JSONB) ...
CREATE FUNCTION can_update_todos(p_user_id INT, p_record JSONB) ...
CREATE FUNCTION can_delete_todos(p_user_id INT, p_record JSONB) ...

-- 5 CRUD operations
CREATE FUNCTION get_todos(p_user_id INT, p_id INT) ...
CREATE FUNCTION save_todos(p_user_id INT, p_data JSONB) ...
CREATE FUNCTION delete_todos(p_user_id INT, p_id INT) ...
CREATE FUNCTION lookup_todos(p_user_id INT, p_filter TEXT) ...
CREATE FUNCTION search_todos(p_user_id INT, p_filters JSONB, ...) ...
```

**Use**:
```sql
-- Get a todo
SELECT get_todos(42, 1);

-- Create a todo
SELECT save_todos(42, '{"title": "Learn DZQL"}'::jsonb);

-- Search todos
SELECT search_todos(42, '{}', 'DZQL', null, 1, 25);
```

## CLI Usage

```bash
# Compile single file
bun dzql-compile entities/venues.sql

# Specify output directory
bun dzql-compile entities/venues.sql -o dist/compiled/

# Verbose mode
DZQL_COMPILER_VERBOSE=true bun dzql-compile entities/venues.sql
```

## Programmatic API

```javascript
import { DZQLCompiler } from '@dzql/compiler';

const compiler = new DZQLCompiler();

// Compile from entity object
const result = compiler.compile({
  tableName: 'todos',
  labelField: 'title',
  searchableFields: ['title'],
  permissionPaths: {
    view: [],
    update: ['@owner_id']
  }
});

console.log(result.sql);
console.log(result.checksum);  // SHA-256 for reproducibility
```

## Features

### ✅ Implemented
- Entity parsing from SQL
- All 4 permission functions generated
- All 5 CRUD operations (GET, SAVE, DELETE, LOOKUP, SEARCH)
- FK expansion (direct and reverse)
- Temporal filtering
- Graph rules compilation
- Notification path compilation
- Advanced search filter operators
- Checksum generation
- CLI tool
- Comprehensive test suite (55 tests)

### 🎯 Coding Standards
- `p_user_id INT` always first parameter
- Helper functions prefixed with `_` (not websocket callable)
- All parameters use `p_` prefix
- All SQL keywords UPPERCASE
- SECURITY DEFINER on all functions

See [CODING_STANDARDS.md](./docs/CODING_STANDARDS.md) for complete details.

## Testing

```bash
# Run all tests
bun test

# Run specific test file
bun test tests/sql-validation.test.js

# Verbose output
bun test --verbose
```

**Test Coverage**:
- SQL structure validation (42 tests)
- Parser functionality (12 tests)
- Integration tests (1 test)

All tests validate that generated code follows coding standards.

## Why Compile?

### Performance
- **Eliminates runtime parsing** - Configuration compiled once
- **Better query plans** - PostgreSQL optimizer sees full function logic
- **Reduced function overhead** - Direct calls vs generic dispatcher

### Security
- **Type safety** - PostgreSQL validates all generated SQL
- **Helper protection** - `_` prefix prevents websocket access
- **Explicit user context** - `p_user_id` first makes security obvious

### Maintainability
- **Version control** - Generated SQL is git-trackable
- **Reproducible builds** - Checksums verify consistency
- **Clear audit trail** - See exactly what runs in production

## Project Structure

```
packages/dzql-compiler/
├── README.md              # This file
├── package.json
├── src/
│   ├── compiler.js        # Main orchestrator
│   ├── index.js          # Public API
│   ├── cli/
│   │   └── index.js      # CLI tool
│   ├── parser/
│   │   ├── entity-parser.js  # Parses register_entity()
│   │   └── path-parser.js    # Parses permission paths
│   └── codegen/
│       ├── permission-codegen.js   # can_* functions
│       ├── operation-codegen.js    # CRUD functions
│       ├── notification-codegen.js # _resolve_* helpers
│       └── graph-rules-codegen.js  # _graph_* helpers
├── tests/
│   ├── compiler.test.js       # Parser & compiler tests
│   └── sql-validation.test.js # Generated SQL tests
├── examples/
│   ├── test-graph-rules.sql  # Example entity definition
│   └── compiled/             # Compiled output
└── docs/                     # Complete documentation
```

## Contributing

When modifying the compiler:

1. **Follow coding standards** - See [CODING_STANDARDS.md](./docs/CODING_STANDARDS.md)
2. **Update tests** - Ensure all 55 tests pass
3. **Update docs** - Keep documentation in sync
4. **Test compilation** - Verify with `bun test`
5. **Check examples** - Recompile and review output

## License

MIT

## Related

- **DZQL Framework**: [../dzql/](../dzql/)
- **Example App**: [../venues/](../venues/)
- **Vision Document**: [../../vision.md](../../vision.md)
