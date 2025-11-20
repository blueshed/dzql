# DZQL Blog Example

A simple blog application demonstrating DZQL's compiled workflow with real-time notifications and M2M relationships.

## Two Workflows

### Development (Delete & Rebuild)

Fast iteration with a clean slate every time:

```bash
# 1. Edit entities
vim entities/blog.sql

# 2. Compile
bun run compile

# 3. Rebuild database (docker compose down -v destroys ALL data!)
bun run db:rebuild

# 4. Test
bun test
```

**Use when:**
- Starting development
- Testing schema changes
- No valuable data to preserve

**Note:** `docker compose down -v` removes volumes, ensuring a true clean slate.

### Production (Migrations)

Incremental schema evolution preserving data:

```bash
# 1. Create migration
bun run migrate:new add_post_categories

# 2. Edit entities
vim entities/blog.sql

# 3. Compile to init_db/
bun run compile

# 4. Copy functions to migration
# Edit migrations/00X_*.sql and paste from init_db/

# 5. Apply migration
bun run migrate:up
```

**Use when:**
- Production database
- Preserving existing data
- Incremental changes

## What's Inside

**Source:** `entities/blog.sql` contains:
- CREATE TABLE statements (users, posts, comments, tags)
- Seed data
- DZQL entity registrations (with M2M support)

**Compiled Output:** `init_db/` (auto-generated):
- `000_dzql_core.sql` - DZQL infrastructure (events, registry, entities table)
- `001_schema.sql` - Tables & seed data (extracted from entities)
- `002_auth.sql` - register_user, login_user functions
- `users.sql` - CRUD functions
- `tags.sql` - CRUD functions
- `posts.sql` - CRUD functions (with M2M tag support!)
- `comments.sql` - CRUD functions

**Migrations:** `migrations/` (manual evolution):
- `001_add_tags_to_posts.sql` - Example M2M migration
- `README.md` - Migration guide

## Development Workflow

1. Edit `entities/blog.sql`
2. Run `bun run compile` - generates SQL to `init_db/`
3. Run `bun run db:rebuild` - restart database with new functions

## Database

- **URL**: `postgresql://dzql:dzql@localhost:5432/dzql_blog`
- **User**: `dzql`
- **Password**: `dzql`

## Generated Functions

For each entity you get:

```sql
-- Permissions
can_view_users(p_user_id INT, p_record JSONB) → BOOLEAN
can_create_users(p_user_id INT, p_record JSONB) → BOOLEAN
can_update_users(p_user_id INT, p_record JSONB) → BOOLEAN
can_delete_users(p_user_id INT, p_record JSONB) → BOOLEAN

-- CRUD
get_users(p_user_id INT, p_id INT) → JSONB
save_users(p_user_id INT, p_data JSONB) → JSONB
delete_users(p_user_id INT, p_id INT) → VOID
lookup_users(p_user_id INT, p_filter TEXT) → TABLE(value, label)
search_users(p_user_id INT, ...) → TABLE(...)
```

## Try It

```sql
-- Create a user
SELECT save_users(0, '{"name": "Alice", "email": "alice@test.com"}'::jsonb);

-- Create a post
SELECT save_posts(1, '{"title": "Hello", "content": "World", "author_id": 1}'::jsonb);

-- Search posts
SELECT * FROM search_posts(1, '{}'::jsonb, null, null, 1, 10);
```

## Learn More

- [DZQL Documentation](../dzql/docs/)
- [Compiler Guide](../dzql/docs/compiler/)
- [Coding Standards](../dzql/docs/compiler/CODING_STANDARDS.md)
