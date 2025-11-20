# DZQL API Reference

Complete API documentation for DZQL framework. For tutorials, see [Getting Started Tutorial](../getting-started/tutorial.md). For AI development guide, see [Claude Guide](../for-ai/claude-guide.md).

## Table of Contents

- [The 5 Operations](#the-5-operations)
- [Entity Registration](#entity-registration)
- [Search Operators](#search-operators)
- [Graph Rules](#graph-rules)
- [Permission & Notification Paths](#permission--notification-paths)
- [Custom Functions](#custom-functions)
- [Authentication](#authentication)
- [Real-time Events](#real-time-events)
- [Live Query Subscriptions](#live-query-subscriptions)
- [Temporal Relationships](#temporal-relationships)
- [Error Messages](#error-messages)

---

## The 5 Operations

Every registered entity automatically gets these 5 operations via the proxy API:

### GET - Retrieve Single Record

Fetch a single record by primary key with foreign keys dereferenced.

**Client:**
```javascript
const record = await ws.api.get.{entity}({id: 1});
```

**Server:**
```javascript
const record = await db.api.get.{entity}({id: 1}, userId);
```

**Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | any | yes | Primary key value |
| `on_date` | string | no | Temporal filtering (ISO 8601 date) |

**Returns:** Object with all fields + dereferenced FKs

**Throws:** `"record not found"` if not exists

**Example:**
```javascript
const venue = await ws.api.get.venues({id: 1});
// {id: 1, name: "MSG", org: {id: 3, name: "Org"}, sites: [...]}

// With temporal filtering
const historical = await ws.api.get.venues({id: 1, on_date: '2023-01-01'});
```

---

### SAVE - Create or Update (Upsert)

Insert new record (no `id`) or update existing (with `id`).

**Client:**
```javascript
const record = await ws.api.save.{entity}({...fields});
```

**Server:**
```javascript
const record = await db.api.save.{entity}({...fields}, userId);
```

**Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | any | no | Omit for insert, include for update |
| ...fields | any | varies | Entity-specific fields |

**Returns:** Created/updated record

**Behavior:**
- **No `id`**: INSERT new record
- **With `id`**: UPDATE existing record (partial update supported)
- Triggers graph rules if configured
- Generates real-time event

**Example:**
```javascript
// Insert
const venue = await ws.api.save.venues({
  name: 'Madison Square Garden',
  address: 'NYC',
  org_id: 1
});

// Update (partial)
const updated = await ws.api.save.venues({
  id: 1,
  name: 'Updated Name'  // Only updates name
});
```

---

### DELETE - Remove Record

Delete a record by primary key.

**Client:**
```javascript
const result = await ws.api.delete.{entity}({id: 1});
```

**Server:**
```javascript
const result = await db.api.delete.{entity}({id: 1}, userId);
```

**Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | any | yes | Primary key value |

**Returns:** Deleted record

**Behavior:**
- Hard delete (unless soft delete configured)
- Triggers graph rules if configured
- Generates real-time event

**Example:**
```javascript
const deleted = await ws.api.delete.venues({id: 1});
```

---

### LOOKUP - Autocomplete/Typeahead

Get label-value pairs for autocomplete inputs.

**Client:**
```javascript
const options = await ws.api.lookup.{entity}({p_filter: 'search'});
```

**Server:**
```javascript
const options = await db.api.lookup.{entity}({p_filter: 'search'}, userId);
```

**Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `p_filter` | string | no | Search term (matches label field) |

**Returns:** Array of `{label, value}` objects

**Example:**
```javascript
const options = await ws.api.lookup.venues({p_filter: 'madison'});
// [{label: "Madison Square Garden", value: 1}, ...]
```

---

### SEARCH - Advanced Search with Pagination

Search with filters, sorting, and pagination.

**Client:**
```javascript
const results = await ws.api.search.{entity}({
  filters: {...},
  sort: {field, order},
  page: 1,
  limit: 25
});
```

**Server:**
```javascript
const results = await db.api.search.{entity}({...}, userId);
```

**Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `filters` | object | no | See [Search Operators](#search-operators) |
| `sort` | object | no | `{field: 'name', order: 'asc' | 'desc'}` |
| `page` | number | no | Page number (1-indexed, default: 1) |
| `limit` | number | no | Records per page (default: 25) |

**Returns:**
```javascript
{
  data: [...],    // Array of records
  total: 100,     // Total matching records
  page: 1,        // Current page
  limit: 25       // Records per page
}
```

**Example:**
```javascript
const results = await ws.api.search.venues({
  filters: {
    city: 'New York',
    capacity: {gte: 1000, lt: 5000},
    name: {ilike: '%garden%'},
    _search: 'madison'  // Text search across searchable fields
  },
  sort: {field: 'name', order: 'asc'},
  page: 1,
  limit: 25
});
```

---

## Entity Registration

Register an entity to enable all 5 operations via `dzql.register_entity()`.

### Full Signature

```sql
SELECT dzql.register_entity(
  p_table_name TEXT,
  p_label_field TEXT,
  p_searchable_fields TEXT[],
  p_fk_includes JSONB DEFAULT '{}'::jsonb,
  p_soft_delete BOOLEAN DEFAULT false,
  p_temporal_fields JSONB DEFAULT '{}'::jsonb,
  p_notification_paths JSONB DEFAULT '{}'::jsonb,
  p_permission_paths JSONB DEFAULT '{}'::jsonb,
  p_graph_rules JSONB DEFAULT '{}'::jsonb,
  p_field_defaults JSONB DEFAULT '{}'::jsonb
);
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `p_table_name` | TEXT | **yes** | Table name in database |
| `p_label_field` | TEXT | **yes** | Field used for LOOKUP display |
| `p_searchable_fields` | TEXT[] | **yes** | Fields searchable by SEARCH (min: 1) |
| `p_fk_includes` | JSONB | no | Foreign keys to dereference in GET |
| `p_soft_delete` | BOOLEAN | no | Enable soft delete (default: false) |
| `p_temporal_fields` | JSONB | no | Temporal field config (valid_from/valid_to) |
| `p_notification_paths` | JSONB | no | Who receives real-time updates |
| `p_permission_paths` | JSONB | no | CRUD permission rules |
| `p_graph_rules` | JSONB | no | Automatic relationship management + M2M |
| `p_field_defaults` | JSONB | no | Auto-populate fields on INSERT |

### FK Includes

Configure which foreign keys to dereference in GET operations:

```sql
-- Single object dereference
'{"org": "organisations"}'  -- venue.org_id -> full org object

-- Child array inclusion
'{"sites": "sites"}'  -- Include all child sites (auto-detects FK)

-- Multiple
'{"org": "organisations", "sites": "sites", "venue": "venues"}'
```

**Result example:**
```javascript
{
  id: 1,
  name: "Madison Square Garden",
  org_id: 3,
  org: {id: 3, name: "Venue Management", ...},  // Dereferenced
  sites: [                                       // Child array
    {id: 1, name: "Main Entrance", ...},
    {id: 2, name: "Concourse", ...}
  ]
}
```

### Temporal Fields

Enable temporal relationships with `valid_from`/`valid_to`:

```sql
'{
  "valid_from": "valid_from",  -- Column name for start date
  "valid_to": "valid_to"       -- Column name for end date
}'
```

**Usage:**
```javascript
// Current relationships (default)
const rights = await ws.api.get.contractor_rights({id: 1});

// Historical relationships
const past = await ws.api.get.contractor_rights({id: 1, on_date: '2023-01-01'});
```

### Field Defaults

Auto-populate fields on INSERT with values or variables:

```sql
'{
  "owner_id": "@user_id",     -- Current user ID
  "created_by": "@user_id",   -- Current user ID
  "created_at": "@now",       -- Current timestamp
  "status": "draft"           -- Literal value
}'
```

**Available variables:**
- `@user_id` - Current user ID from `p_user_id`
- `@now` - Current timestamp
- `@today` - Current date
- Literal values - Any JSON value (`"draft"`, `0`, `true`)

**Behavior:**
- Only applied on INSERT (not UPDATE)
- Explicit values override defaults
- Reduces client boilerplate

See [Field Defaults Guide](../guides/field-defaults.md) for details.

### Many-to-Many Relationships

Configure M2M relationships via `graph_rules.many_to_many`:

```sql
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
}'
```

**Client usage:**
```javascript
// Save with relationships in single call
await api.save_brands({
  data: {
    name: "My Brand",
    tag_ids: [1, 2, 3]  // Junction table synced atomically
  }
})

// Response includes tag_ids array
{ id: 5, name: "My Brand", tag_ids: [1, 2, 3] }
```

**Configuration:**
- `junction_table` - Name of junction table
- `local_key` - FK to this entity
- `foreign_key` - FK to target entity
- `target_entity` - Target table name
- `id_field` - Field name for ID array
- `expand` - Include full objects (default: false)

See [Many-to-Many Guide](../guides/many-to-many.md) for details.

### Example Registration (Basic)

```sql
SELECT dzql.register_entity(
  'venues',                              -- table name
  'name',                                -- label field
  array['name', 'address', 'description'], -- searchable
  '{"org": "organisations", "sites": "sites"}', -- FK includes
  false,                                 -- soft delete
  '{}',                                  -- temporal (none)
  '{                                     -- notifications
    "ownership": ["@org_id->acts_for[org_id=$]{active}.user_id"]
  }',
  '{                                     -- permissions
    "create": ["@org_id->acts_for[org_id=$]{active}.user_id"],
    "update": ["@org_id->acts_for[org_id=$]{active}.user_id"],
    "delete": ["@org_id->acts_for[org_id=$]{active}.user_id"],
    "view": []
  }',
  '{                                     -- graph rules
    "on_create": {
      "establish_site": {
        "description": "Create default site",
        "actions": [{
          "type": "create",
          "entity": "sites",
          "data": {"name": "Main Site", "venue_id": "@id"}
        }]
      }
    }
  }',
  '{}'                                   -- field defaults (none)
);
```

### Example Registration (With All Features)

```sql
SELECT dzql.register_entity(
  'resources',
  'title',
  ARRAY['title', 'description'],
  '{"org": "organisations"}',            -- FK includes
  false,                                 -- soft delete
  '{}',                                  -- temporal
  '{}',                                  -- notifications
  '{                                     -- permissions
    "view": [],
    "create": [],
    "update": ["@owner_id"],
    "delete": ["@owner_id"]
  }',
  '{                                     -- graph rules
    "many_to_many": {
      "tags": {
        "junction_table": "resource_tags",
        "local_key": "resource_id",
        "foreign_key": "tag_id",
        "target_entity": "tags",
        "id_field": "tag_ids",
        "expand": false
      },
      "collaborators": {
        "junction_table": "resource_collaborators",
        "local_key": "resource_id",
        "foreign_key": "user_id",
        "target_entity": "users",
        "id_field": "collaborator_ids",
        "expand": true
      }
    }
  }',
  '{                                     -- field defaults
    "owner_id": "@user_id",
    "created_by": "@user_id",
    "created_at": "@now",
    "status": "draft"
  }'
);
```

**Client usage:**
```javascript
// Single call with all features!
const resource = await api.save_resources({
  data: {
    title: "My Resource",
    tag_ids: [1, 2, 3],
    collaborator_ids: [10, 20]
    // owner_id, created_by, created_at, status auto-populated
  }
})

// Response
{
  id: 1,
  title: "My Resource",
  owner_id: 123,              // From field defaults
  created_by: 123,            // From field defaults
  created_at: "2025-11-20...", // From field defaults
  status: "draft",            // From field defaults
  tag_ids: [1, 2, 3],         // M2M IDs
  collaborator_ids: [10, 20], // M2M IDs
  collaborators: [...]        // Full objects (expand: true)
}
```

---

## Search Operators

The SEARCH operation supports advanced filtering via the `filters` object.

### Operator Reference

| Operator | Syntax | Description | Example |
|----------|--------|-------------|---------|
| **Exact match** | `field: value` | Equality | `{name: 'Alice'}` |
| **Greater than** | `{gt: n}` | `>` | `{age: {gt: 18}}` |
| **Greater or equal** | `{gte: n}` | `>=` | `{age: {gte: 18}}` |
| **Less than** | `{lt: n}` | `<` | `{age: {lt: 65}}` |
| **Less or equal** | `{lte: n}` | `<=` | `{age: {lte: 65}}` |
| **Not equal** | `{neq: v}` | `!=` | `{status: {neq: 'deleted'}}` |
| **Between** | `{between: [a, b]}` | `BETWEEN a AND b` | `{age: {between: [18, 65]}}` |
| **LIKE** | `{like: 'pattern'}` | Case-sensitive pattern | `{name: {like: '%Garden%'}}` |
| **ILIKE** | `{ilike: 'pattern'}` | Case-insensitive pattern | `{name: {ilike: '%garden%'}}` |
| **IS NULL** | `field: null` | NULL check | `{description: null}` |
| **IS NOT NULL** | `{not_null: true}` | NOT NULL check | `{description: {not_null: true}}` |
| **IN array** | `field: [...]` | `IN (...)` | `{city: ['NYC', 'LA']}` |
| **NOT IN array** | `{not_in: [...]}` | `NOT IN (...)` | `{status: {not_in: ['deleted']}}` |
| **Text search** | `_search: 'terms'` | Across searchable fields | `{_search: 'madison garden'}` |

### Complete Example

```javascript
const results = await ws.api.search.venues({
  filters: {
    // Exact match
    city: 'New York',
    
    // Comparison
    capacity: {gte: 1000, lt: 5000},
    
    // Pattern matching
    name: {ilike: '%garden%'},
    
    // NULL checks
    description: {not_null: true},
    
    // Arrays
    categories: ['sports', 'music'],
    status: {not_in: ['deleted', 'closed']},
    
    // Text search (across all searchable_fields)
    _search: 'madison square'
  },
  sort: {field: 'capacity', order: 'desc'},
  page: 1,
  limit: 25
});
```

---

## Graph Rules

Automatically manage entity relationships when data changes.

### Structure

```jsonb
{
  "on_create": {
    "rule_name": {
      "description": "Human-readable description",
      "condition": "@after.field = 'value'",  // Optional: only run if condition is true
      "actions": [
        {
          "type": "create|update|delete|validate|execute",
          "entity": "target_table",            // for create/update/delete
          "data": {"field": "@variable"},      // for create/update
          "match": {"field": "@variable"},     // for update/delete
          "function": "function_name",         // for validate/execute
          "params": {"param": "@variable"},    // for validate/execute
          "error_message": "Validation failed" // for validate (optional)
        }
      ]
    }
  },
  "on_update": { /* same structure */ },
  "on_delete": { /* same structure */ }
}
```

### Action Types

| Type | Fields | Description |
|------|--------|-------------|
| `create` | `entity`, `data` | INSERT new record |
| `update` | `entity`, `match`, `data` | UPDATE matching records |
| `delete` | `entity`, `match` | DELETE matching records |
| `validate` | `function`, `params`, `error_message` | Call validation function, rollback if returns false |
| `execute` | `function`, `params` | Fire-and-forget function execution |

### Variables

Variables reference data from the triggering operation:

| Variable | Description | Example |
|----------|-------------|---------|
| `@user_id` | Current authenticated user | `"created_by": "@user_id"` |
| `@id` | Primary key of the record | `"org_id": "@id"` |
| `@field_name` | Any field from the record | `"org_id": "@org_id"` |
| `@now` | Current timestamp | `"created_at": "@now"` |
| `@today` | Current date | `"valid_from": "@today"` |

### Common Patterns

#### Creator Becomes Owner
```jsonb
{
  "on_create": {
    "establish_ownership": {
      "description": "Creator becomes member of organisation",
      "actions": [{
        "type": "create",
        "entity": "acts_for",
        "data": {
          "user_id": "@user_id",
          "org_id": "@id",
          "valid_from": "@today"
        }
      }]
    }
  }
}
```

#### Cascade Delete
```jsonb
{
  "on_delete": {
    "cascade_venues": {
      "description": "Delete all venues when org is deleted",
      "actions": [{
        "type": "delete",
        "entity": "venues",
        "match": {"org_id": "@id"}
      }]
    }
  }
}
```

#### Temporal Transition
```jsonb
{
  "on_create": {
    "expire_previous": {
      "description": "End previous temporal relationship",
      "actions": [{
        "type": "update",
        "entity": "acts_for",
        "match": {
          "user_id": "@user_id",
          "org_id": "@org_id",
          "valid_to": null
        },
        "data": {
          "valid_to": "@valid_from"
        }
      }]
    }
  }
}
```

#### Data Validation
```jsonb
{
  "on_create": {
    "validate_positive_price": {
      "description": "Ensure price is positive",
      "actions": [{
        "type": "validate",
        "function": "validate_positive_value",
        "params": {"p_value": "@price"},
        "error_message": "Price must be positive"
      }]
    }
  }
}
```

**Note:** Validation function must return BOOLEAN:
```sql
CREATE FUNCTION validate_positive_value(p_value INT)
RETURNS BOOLEAN AS $$
  SELECT p_value > 0;
$$ LANGUAGE sql;
```

#### Conditional Execution
```jsonb
{
  "on_update": {
    "prevent_posted_changes": {
      "description": "Prevent modification of posted records",
      "condition": "@before.status = 'posted'",
      "actions": [{
        "type": "validate",
        "function": "always_false",
        "params": {},
        "error_message": "Cannot modify posted records"
      }]
    }
  }
}
```

**Available in conditions:** `@before.field`, `@after.field`, `@user_id`, and SQL expressions.

#### Fire-and-Forget Actions
```jsonb
{
  "on_create": {
    "send_notification": {
      "description": "Notify external system",
      "actions": [{
        "type": "execute",
        "function": "log_event",
        "params": {"p_event": "New record created", "p_record_id": "@id"}
      }]
    }
  }
}
```

**Note:** Execute actions don't affect transaction. Function errors are logged but don't rollback.

### Execution

- **Atomic**: All rules execute in the same transaction
- **Sequential**: Actions execute in order within each rule
- **Rollback**: If any action fails, entire transaction rolls back
- **Events**: Each action generates its own audit event

---

## Permission & Notification Paths

Paths use a unified syntax for both permissions and notifications.

### Path Syntax

```
@field->table[filter]{temporal}.target_field
```

**Components:**
- `@field` - Start from a field in the current record
- `->table` - Navigate to related table
- `[filter]` - WHERE clause (`$` = current field value)
- `{temporal}` - Apply temporal filtering (`{active}` = valid now)
- `.target_field` - Extract this field as result

### Permission Paths

Control who can perform CRUD operations:

```sql
'{
  "create": ["@org_id->acts_for[org_id=$]{active}.user_id"],
  "update": ["@org_id->acts_for[org_id=$]{active}.user_id"],
  "delete": ["@org_id->acts_for[org_id=$]{active}.user_id"],
  "view": []  -- Empty array = public access
}'
```

**Permission types:**
- `create` - Who can create records
- `update` - Who can modify records
- `delete` - Who can remove records
- `view` - Who can read records (empty = public)

**Behavior:**
- User's `user_id` must be in resolved set of user_ids
- Checked before operation executes
- Empty array = allow all
- Missing permission type = deny all

### Notification Paths

Determine who receives real-time updates:

```sql
'{
  "ownership": ["@org_id->acts_for[org_id=$]{active}.user_id"],
  "sponsorship": ["@sponsor_org_id->acts_for[org_id=$]{active}.user_id"]
}'
```

**Behavior:**
- Resolves to array of user_ids or `null`
- `null` = broadcast to all authenticated users
- Array = send only to specified users
- Multiple paths = union of all resolved user_ids

### Path Examples

```sql
-- Direct user reference
'@user_id'

-- Via organization
'@org_id->acts_for[org_id=$]{active}.user_id'

-- Via nested relationship
'@venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id'

-- Via multiple relationships
'@package_id->packages.owner_org_id->acts_for[org_id=$]{active}.user_id'
```

---

## Custom Functions

Extend DZQL with custom PostgreSQL or Bun functions.

### PostgreSQL Functions

Create stored procedures and call via proxy API:

```sql
CREATE OR REPLACE FUNCTION my_function(
  p_user_id INT,           -- REQUIRED: First parameter
  p_param TEXT DEFAULT 'default'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Your logic here
  RETURN jsonb_build_object('result', p_param);
END;
$$;
```

**Call:**
```javascript
const result = await ws.api.my_function({param: 'value'});
```

**Conventions:**
- First parameter **must** be `p_user_id INT`
- Can access full PostgreSQL ecosystem
- Automatically transactional
- Optional registration in `dzql.registry`

### Bun Functions

Create JavaScript functions in server:

```javascript
// server/api.js
export async function myBunFunction(userId, params = {}) {
  const { param = 'default' } = params;
  
  // Can use db.api for database access
  // const data = await db.api.get.users({id: userId}, userId);
  
  return { result: param };
}
```

**Server setup:**
```javascript
import * as customApi from './server/api.js';
const server = createServer({ customApi });
```

**Call:**
```javascript
const result = await ws.api.myBunFunction({param: 'value'});
```

**Conventions:**
- First parameter is `userId` (number)
- Second parameter is `params` object
- Can access `db.api.*` operations
- Can use any npm packages
- Return JSON-serializable data

### Function Comparison

| Feature | PostgreSQL | Bun |
|---------|-----------|-----|
| **Language** | SQL/PL/pgSQL | JavaScript |
| **Access to** | Database only | Database + npm ecosystem |
| **Transaction** | Automatic | Manual (via db.api) |
| **Performance** | Faster (no network) | Slower (WebSocket overhead) |
| **Use case** | Data-heavy operations | Complex business logic |

---

## Authentication

JWT-based authentication with automatic user_id injection.

### Register User

```javascript
const result = await ws.api.register_user({
  email: 'user@example.com',
  password: 'secure-password'
});
```

**Returns:**
```javascript
{
  user_id: 1,
  email: 'user@example.com',
  token: 'eyJ...',
  profile: {...}
}
```

### Login

```javascript
const result = await ws.api.login_user({
  email: 'user@example.com',
  password: 'password'
});
```

**Returns:** Same as register

### Logout

```javascript
await ws.api.logout();
```

### Token Storage

```javascript
// Save token
localStorage.setItem('dzql_token', result.token);

// Auto-connect with token
const ws = new WebSocketManager();
await ws.connect();  // Automatically uses token from localStorage
```

### User ID Injection

- **Client**: `user_id` automatically injected from JWT
- **Server**: `user_id` must be passed explicitly as second parameter

```javascript
// Client
const user = await ws.api.get.users({id: 1});  // userId auto-injected

// Server
const user = await db.api.get.users({id: 1}, userId);  // userId explicit
```

---

## Real-time Events

All database changes trigger WebSocket events.

### Event Flow

1. Database trigger fires on INSERT/UPDATE/DELETE
2. Notification paths resolve affected user_ids
3. Event written to `dzql.events` table
4. PostgreSQL NOTIFY on 'dzql' channel
5. Bun server filters by `notify_users`
6. WebSocket message sent to affected clients

### Listening for Events

```javascript
const unsubscribe = ws.onBroadcast((method, params) => {
  console.log(`Event: ${method}`, params);
});

// Stop listening
unsubscribe();
```

### Event Format

**Method:** `"{table}:{operation}"`
- Examples: `"users:insert"`, `"venues:update"`, `"sites:delete"`

**Params:**
```javascript
{
  table: 'venues',
  op: 'insert' | 'update' | 'delete',
  pk: {id: 1},           // Primary key
  before: {...},         // Old values (null for insert)
  after: {...},          // New values (null for delete)
  user_id: 123,          // Who made the change
  at: '2025-01-01T...',  // Timestamp
  notify_users: [1, 2]   // Who to notify (null = all)
}
```

### Event Handling Pattern

```javascript
ws.onBroadcast((method, params) => {
  const data = params.after || params.before;
  
  if (method === 'todos:insert') {
    state.todos.push(data);
  } else if (method === 'todos:update') {
    const idx = state.todos.findIndex(t => t.id === data.id);
    if (idx !== -1) state.todos[idx] = data;
  } else if (method === 'todos:delete') {
    state.todos = state.todos.filter(t => t.id !== data.id);
  }
  
  render();
});
```

---

## Live Query Subscriptions

Subscribe to denormalized documents and receive automatic updates when underlying data changes. Subscriptions use a PostgreSQL-first architecture where all change detection happens in the database.

For complete documentation, see **[Live Query Subscriptions Guide](../guides/subscriptions.md)** and **[Quick Start](../getting-started/subscriptions-quick-start.md)**.

### Quick Example

```javascript
// Subscribe to venue with all related data
const { data, unsubscribe } = await ws.api.subscribe_venue_detail(
  { venue_id: 123 },
  (updatedVenue) => {
    // Called automatically when venue, org, or sites change
    console.log('Updated:', updatedVenue);
    // updatedVenue = { id: 123, name: '...', org: {...}, sites: [...] }
  }
);

// Initial data available immediately
console.log('Initial:', data);

// Later: cleanup
await unsubscribe();
```

### Creating a Subscribable

Define subscribables in SQL:

```sql
SELECT dzql.register_subscribable(
  'venue_detail',                                               -- Name
  '{"subscribe": ["@org_id->acts_for[org_id=$]{active}.user_id"]}'::jsonb,  -- Permissions
  '{"venue_id": "int"}'::jsonb,                                -- Parameters
  'venues',                                                     -- Root table
  '{
    "org": "organisations",
    "sites": {"entity": "sites", "filter": "venue_id=$venue_id"}
  }'::jsonb                                                     -- Relations
);
```

### Compile and Deploy

```bash
# Compile subscribable to PostgreSQL functions
bun packages/dzql/src/compiler/cli/compile-subscribable.js venue.sql | psql $DATABASE_URL
```

This generates three functions:
- `venue_detail_can_subscribe(user_id, params)` - Permission check
- `get_venue_detail(params, user_id)` - Query builder
- `venue_detail_affected_documents(table, op, old, new)` - Change detector

### Subscription Lifecycle

1. **Subscribe**: Client calls `ws.api.subscribe_<name>(params, callback)`
2. **Permission Check**: `<name>_can_subscribe()` validates access
3. **Initial Query**: `get_<name>()` returns denormalized document
4. **Register**: Server stores subscription in-memory
5. **Database Change**: Any relevant table modification
6. **Detect**: `<name>_affected_documents()` identifies affected subscriptions
7. **Re-query**: `get_<name>()` fetches fresh data
8. **Update**: Callback invoked with new data

### Unsubscribe

```javascript
// Method 1: Use returned unsubscribe function
const { unsubscribe } = await ws.api.subscribe_venue_detail(...);
await unsubscribe();

// Method 2: Direct unsubscribe call
await ws.api.unsubscribe_venue_detail({ venue_id: 123 });
```

### Architecture Benefits

- **PostgreSQL-First**: All logic executes in database, not application code
- **Zero Configuration**: Pattern matching on method names - no server changes needed
- **Type Safe**: Compiled functions validated at deploy time
- **Efficient**: In-memory registry, PostgreSQL does matching
- **Secure**: Permission paths enforced at database level
- **Scalable**: Stateless server, can add instances freely

### Common Patterns

**Single Table:**
```sql
SELECT dzql.register_subscribable(
  'user_settings',
  '{"subscribe": ["@user_id"]}'::jsonb,
  '{"user_id": "int"}'::jsonb,
  'user_settings',
  '{}'::jsonb
);
```

**With Relations:**
```sql
SELECT dzql.register_subscribable(
  'booking_detail',
  '{"subscribe": ["@user_id"]}'::jsonb,
  '{"booking_id": "int"}'::jsonb,
  'bookings',
  '{
    "venue": "venues",
    "customer": "users",
    "items": {"entity": "booking_items", "filter": "booking_id=$booking_id"}
  }'::jsonb
);
```

**Multiple Permission Paths (OR logic):**
```sql
SELECT dzql.register_subscribable(
  'venue_admin',
  '{
    "subscribe": [
      "@owner_id",
      "@org_id->acts_for[org_id=$]{active}.user_id"
    ]
  }'::jsonb,
  '{"venue_id": "int"}'::jsonb,
  'venues',
  '{"sites": {"entity": "sites", "filter": "venue_id=$venue_id"}}'::jsonb
);
```

### See Also

- **[Live Query Subscriptions Guide](../guides/subscriptions.md)** - Complete reference
- **[Quick Start Guide](../getting-started/subscriptions-quick-start.md)** - 5-minute tutorial
- **[Permission Paths](#permission--notification-paths)** - Path DSL syntax

---

## Temporal Relationships

Handle time-based relationships with `valid_from`/`valid_to` fields.

### Configuration

```sql
SELECT dzql.register_entity(
  'contractor_rights',
  'contractor_name',
  array['contractor_name'],
  '{"contractor_org": "organisations", "venue": "venues"}',
  false,
  '{
    "valid_from": "valid_from",
    "valid_to": "valid_to"
  }',
  '{}', '{}'
);
```

### Usage

```javascript
// Get current relationships (default)
const rights = await ws.api.get.contractor_rights({id: 1});

// Get historical relationships
const past = await ws.api.get.contractor_rights({
  id: 1,
  on_date: '2023-01-01'
});
```

### Path Syntax with Temporal

```sql
-- Current relationships only
'@org_id->acts_for[org_id=$]{active}.user_id'

-- All relationships (past and present)
'@org_id->acts_for[org_id=$].user_id'
```

---

## Error Messages

Common error messages and their meanings:

| Error | Cause | Solution |
|-------|-------|----------|
| `"record not found"` | GET on non-existent ID | Check ID exists, handle 404 |
| `"Permission denied: view on users"` | User not in permission path | Check permissions, authenticate |
| `"entity users not configured"` | Entity not registered | Call `dzql.register_entity()` |
| `"Column foo does not exist in table users"` | Invalid filter field | Check searchable_fields config |
| `"Invalid function name: foo"` | Function doesn't exist | Create function or check spelling |
| `"Function not found"` | Custom function not registered | Export from api.js or create SQL function |
| `"Authentication required"` | Not logged in | Call `login_user()` first |
| `"Invalid token"` | Expired/invalid JWT | Re-authenticate |

---

## Server-Side API

For backend/Bun scripts, use `db.api`:

```javascript
import { db, sql } from 'dzql';

// Direct SQL queries
const users = await sql`SELECT * FROM users WHERE active = true`;

// DZQL operations (require explicit userId)
const user = await db.api.get.users({id: 1}, userId);
const saved = await db.api.save.users({name: 'John'}, userId);
const results = await db.api.search.users({filters: {}}, userId);
const deleted = await db.api.delete.users({id: 1}, userId);
const options = await db.api.lookup.users({p_filter: 'jo'}, userId);

// Custom functions
const result = await db.api.myCustomFunction({param: 'value'}, userId);
```

**Key difference:** Server-side requires explicit `userId` as second parameter; client-side auto-injects from JWT.

---

## See Also

- [Getting Started Tutorial](../getting-started/tutorial.md) - Hands-on tutorial
- [Claude Guide](../for-ai/claude-guide.md) - AI development guide
- [Project README](../../../../README.md) - Project overview
- [Venues Example](../../../venues/) - Complete working application
