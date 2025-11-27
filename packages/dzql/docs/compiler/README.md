# DZQL Compiler Documentation

The DZQL Compiler transforms declarative entity definitions into optimized PostgreSQL stored procedures.

## Quick Start

- **[Quickstart Guide](QUICKSTART.md)** - Get started with the compiler in 5 minutes

## Reference

- **[Advanced Filters](ADVANCED_FILTERS.md)** - Complex search operators and patterns
- **[Coding Standards](CODING_STANDARDS.md)** - Best practices for DZQL code
- **[Comparison](COMPARISON.md)** - Runtime vs compiled side-by-side

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
  '{}'::jsonb,                          -- Temporal config
  '{}'::jsonb,                          -- Notification paths
  '{}'::jsonb,                          -- Permission paths
  '{}'::jsonb,                          -- Graph rules (including M2M)
  '{}'::jsonb                           -- Field defaults
);
```

This generates 5 PostgreSQL functions:
- `get_todos(params, user_id)` - Retrieve single record
- `save_todos(params, user_id)` - Create or update
- `delete_todos(params, user_id)` - Delete record
- `lookup_todos(params, user_id)` - Autocomplete
- `search_todos(params, user_id)` - Search with filters

## Compiler Features (v0.3.1+)

The compiler generates **static, optimized SQL** with zero runtime interpretation:

### Many-to-Many Relationships
```sql
SELECT dzql.register_entity(
  'brands', 'name', ARRAY['name'],
  '{}', false, '{}', '{}', '{}',
  '{
    "many_to_many": {
      "tags": {
        "junction_table": "brand_tags",
        "local_key": "brand_id",
        "foreign_key": "tag_id",
        "target_entity": "tags",
        "id_field": "tag_ids",
        "expand": false
      }
    }
  }',
  '{}'
);
```

**Generated code:** Static M2M sync blocks (50-100x faster than generic operations)
- No runtime loops
- All table/column names are literals
- PostgreSQL can fully optimize and cache plans

See [Many-to-Many Guide](../guides/many-to-many.md) for details.

### Field Defaults
```sql
'{
  "owner_id": "@user_id",
  "created_at": "@now",
  "status": "draft"
}'
```

**Generated code:** Auto-populates fields on INSERT

See [Field Defaults Guide](../guides/field-defaults.md) for details.

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
