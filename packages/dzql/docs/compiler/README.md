# DZQL Compiler Documentation

The DZQL Compiler transforms declarative entity definitions into optimized PostgreSQL stored procedures.

## Quick Start

- **[Quickstart Guide](QUICKSTART.md)** - Get started with the compiler in 5 minutes

## Guides

- **[Advanced Filters](ADVANCED_FILTERS.md)** - Complex search operators and patterns
- **[Coding Standards](CODING_STANDARDS.md)** - Best practices for DZQL code

## Reference

- **[Comparison](COMPARISON.md)** - How DZQL compares to other approaches
- **[Session Summary](SESSION_SUMMARY.md)** - Development session documentation
- **[Summary](SUMMARY.md)** - Compiler overview and architecture
- **[Overnight Build](OVERNIGHT_BUILD.md)** - Batch compilation process

## Using the Compiler

### Via CLI

```bash
dzql compile database/domain.sql -o compiled/
```

### Programmatically

```javascript
import { DZQLCompiler } from 'dzql/compiler';

const compiler = new DZQLCompiler();
const result = compiler.compileFromSQL(sqlContent);

console.log(result.sql);  // Generated PostgreSQL
```

### Registering Entities

```sql
SELECT dzql.register_entity(
  'todos',                              -- Table name
  'title',                              -- Label field
  array['title', 'description'],        -- Searchable fields
  '{}'::jsonb,                          -- FK includes
  false,                                -- Soft delete
  '{}'::jsonb,                          -- Graph rules
  jsonb_build_object(                   -- Notification paths
    'owner', array['@user_id']
  ),
  jsonb_build_object(                   -- Permission paths
    'view', array['@user_id'],
    'create', array['@user_id'],
    'update', array['@user_id'],
    'delete', array['@user_id']
  ),
  '{}'::jsonb                           -- Temporal config
);
```

This generates 5 PostgreSQL functions:
- `get_todos(params, user_id)` - Retrieve single record
- `save_todos(params, user_id)` - Create or update
- `delete_todos(params, user_id)` - Delete record
- `lookup_todos(params, user_id)` - Autocomplete
- `search_todos(params, user_id)` - Search with filters

## Architecture

The compiler uses a three-phase approach:

1. **Parse** - Extract entity definitions from SQL
2. **Generate** - Create optimized PostgreSQL functions
3. **Deploy** - Execute generated SQL

All business logic runs in PostgreSQL, not application code.

## See Also

- [Main Documentation](../) - Full DZQL documentation
- [API Reference](../reference/api.md) - The 5 operations
- [For AI](../for-ai/claude-guide.md) - AI-assisted development
