# Add DZQL Entity Skill

You are helping the user add a new entity to the DZQL framework. This involves:

1. Creating the PostgreSQL table
2. Registering the entity with `dzql.register_entity()`
3. Optionally configuring permissions, notifications, and graph rules

## Workflow

### Step 1: Gather Entity Requirements

Ask the user about their entity. Guide them through these aspects:

**Basic Information:**
- Table name (plural, snake_case, e.g., "events", "ticket_types")
- Label field (the field to display in lookups, e.g., "name", "title")
- Searchable fields (array of fields for text search)

**Table Schema:**
- What fields does the table need?
- Data types (text, integer, jsonb, timestamptz, etc.)
- Foreign keys to other entities
- Any unique constraints or indexes needed?

**Advanced Features (optional):**
- Soft delete? (use deleted_at instead of hard delete)
- Temporal fields? (valid_from/valid_to for time-based queries)
- Foreign key includes? (which FKs to auto-dereference in get operations)

### Step 2: Configuration Options

Help the user think through:

**Notification Paths** (who gets notified when records change):
- Examples:
  - `{"ownership": ["@user_id"]}` - Notify the owner
  - `{"org_members": ["@org_id->acts_for[org_id=$]{active}.user_id"]}` - Notify org members
  - `{}` - No targeted notifications (broadcast to all)

**Permission Paths** (who can perform operations):
- Operations: create, view, update, delete
- Examples:
  - `{"view": []}` - Public read access
  - `{"create": ["@org_id->acts_for[org_id=$]{active}.user_id"]}` - Org members can create
  - `{}` - No restrictions (all authenticated users)

**Graph Rules** (automatic relationship management):
- on_create, on_update, on_delete
- Actions: create, update, delete related records
- Example: When creating a venue, automatically create a default area

### Step 3: Generate and Execute SQL

Create SQL that:
1. Creates the table with proper constraints
2. Calls `dzql.register_entity()` with all configuration
3. Adds any necessary indexes

Use the MCP server to execute the SQL (you'll need a custom function for this).

### Step 4: Verify

Use MCP tools to:
- Call `list_entities` to confirm the entity is registered
- Try a simple `save` operation to test it works
- Try `search` to verify searchable fields

## Important Notes

- **Primary Key**: DZQL expects an auto-incrementing integer `id` column as primary key
- **Timestamps**: Consider adding `created_at` and `updated_at` fields
- **Foreign Keys**: Use `table_id` naming convention (e.g., `org_id`, `venue_id`)
- **Path Syntax**: Use `@field->table[filter]{temporal}.target_field` format
- **User Context**: Variables available in paths: `@user_id`, `@id`, `@field_name`, `@now`, `@today`

## Example Entity Registration

```sql
-- Create table
CREATE TABLE IF NOT EXISTS events (
  id serial PRIMARY KEY,
  name text NOT NULL,
  description text,
  venue_id integer REFERENCES venues(id),
  event_date date NOT NULL,
  created_by integer REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Register with DZQL
SELECT dzql.register_entity(
  'events',                                   -- table name
  'name',                                     -- label field
  array['name', 'description'],               -- searchable fields
  '{"venue": "venues", "creator": "users"}',  -- FK includes
  false,                                      -- soft delete
  '{}',                                       -- temporal fields
  jsonb_build_object(
    'venue_org', array['@venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id']
  ),
  jsonb_build_object(
    'view', array[],                          -- public read
    'create', array['@venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id']
  ),
  '{}'                                        -- no graph rules yet
);
```

## Your Approach

1. **Be conversational** - Don't overwhelm with all options at once
2. **Start simple** - Get basic table working first, add advanced features later
3. **Explain as you go** - Help user understand DZQL concepts
4. **Show examples** - Reference similar entities from the venues domain
5. **Verify success** - Always test the entity after creation

## Current System Context

The venues example has these entities you can reference:
- `users` - Basic user accounts
- `organisations` - Companies/groups
- `acts_for` - User-org relationships (temporal)
- `venues` - Physical locations
- `sites` - Specific spots within venues
- `packages` - Service packages
- `products` - Items within packages
- `allocations` - Package-to-site assignments
- `contractor_rights` - Inter-org permissions

Start by asking what kind of entity they want to add!
