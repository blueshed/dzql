# DZQL Blog Example

A simple blog application demonstrating DZQL's compiled workflow with real-time notifications.

## Quick Start

```bash
# Compile entities to SQL
bun run compile

# Start PostgreSQL (loads init_db/*.sql automatically)
bun run up

# Connect to database
bun run psql
```

## What's Inside

**Source:** `entities/blog.sql` contains:
- CREATE TABLE statements (users, posts, comments)
- Seed data
- DZQL entity registrations

**Compiled Output:** `init_db/` (auto-generated):
- `000_dzql_core.sql` - DZQL infrastructure
- `001_schema.sql` - Tables & seed data (extracted from entities)
- `users.sql` - CRUD functions
- `posts.sql` - CRUD functions
- `comments.sql` - CRUD functions

## Workflow

1. Edit `entities/blog.sql`
2. Run `bun run compile` - generates SQL to `init_db/`
3. Run `bun run down && bun run up` - restart database with new functions

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
