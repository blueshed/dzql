# Database Migrations

This directory contains database migration files for evolving the blog schema in production.

## Concept

Unlike `init_db/` which rebuilds from scratch, migrations allow **incremental schema changes** on live databases:

- ✅ Add new columns to existing tables
- ✅ Create new tables
- ✅ Update DZQL compiled functions
- ✅ Add custom functions
- ✅ Preserve existing data

## Migration Pattern

Each migration follows this structure:

```sql
-- ============================================================================
-- Migration NNN: Description
-- ============================================================================

BEGIN;

-- Part 1: Schema changes (ALTER TABLE, CREATE TABLE)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS new_field TEXT;

-- Part 2: Drop old DZQL functions
DROP FUNCTION IF EXISTS save_posts(INT, JSONB);

-- Part 3: Install new compiled functions
-- (Paste from init_db/*.sql after running compile)
CREATE OR REPLACE FUNCTION save_posts(...) ...

-- Part 4: Custom functions (if needed)
CREATE OR REPLACE FUNCTION my_custom_function(...) ...

-- Part 5: Register custom functions
INSERT INTO dzql.registry (fn_regproc) VALUES ('my_custom_function'::regproc);

COMMIT;
```

## Workflow

### When to Use init_db/ (Development)
Use the `init_db/` approach when:
- Starting a new project
- Development environment (can drop/recreate)
- Testing schema changes
- No production data

```bash
bun run compile  # Regenerate init_db/*.sql
bun run down && bun run up  # Rebuild database
```

### When to Use migrations/ (Production)
Use migrations when:
- Production database with live data
- Cannot drop and recreate
- Need to preserve existing records
- Incremental schema evolution

```bash
# 1. Update entity definition
vim entities/blog.sql

# 2. Compile to temporary location
bun run compile:migration

# 3. Create migration file
cp migrations/template.sql migrations/00X_description.sql

# 4. Edit migration, paste compiled functions
vim migrations/00X_description.sql

# 5. Apply migration
psql $DATABASE_URL -f migrations/00X_description.sql
```

## Example: Adding M2M Tags

**Before:** Posts have no tags

**Migration 001:**
1. Create `tags` table
2. Create `post_tags` junction table
3. Update posts entity registration with M2M config
4. Recompile functions
5. Drop old `save_posts()`, install new version with M2M sync

**After:** Posts support `tag_ids: [1, 2, 3]` in single atomic call

See `001_add_tags_to_posts.sql` for complete example.

## Migration Numbering

- `001_initial_schema.sql` - Usually generated from init_db
- `002_add_feature.sql` - Add new feature
- `003_fix_bug.sql` - Fix schema issue
- etc.

Keep migrations **idempotent** when possible:
- `CREATE TABLE IF NOT EXISTS`
- `ALTER TABLE ADD COLUMN IF NOT EXISTS`
- `ON CONFLICT DO NOTHING`

## Migration Tracking

Consider creating a migrations table:

```sql
CREATE TABLE IF NOT EXISTS dzql.migrations (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

-- In each migration
INSERT INTO dzql.migrations (name) VALUES ('001_add_tags_to_posts');
```

## See Also

- Hump project (`/Users/peterb/Workshop/hump/migrations`) - Real-world migration examples
- [DZQL Compiler Guide](../../dzql/docs/compiler/README.md) - How to compile functions
