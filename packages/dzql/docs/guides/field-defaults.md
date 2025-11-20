# Field Defaults

Auto-populate fields with default values during entity creation.

## Overview

Field defaults allow you to automatically set field values when creating new records, eliminating the need for clients to manually send fields like `owner_id`, `created_at`, or `status` on every save operation.

## Benefits

- **Less Client Code** - No need to send the same fields repeatedly
- **Prevents Errors** - Can't forget required fields
- **Enforces Security** - Server controls defaults (e.g., current user as owner)
- **Cleaner API** - Focus on actual data, not boilerplate

## Configuration

Field defaults are configured in the 10th parameter of `dzql.register_entity()`:

```sql
SELECT dzql.register_entity(
  'resources',
  'title',
  ARRAY['title'],
  '{}',  -- fk_includes
  false, -- soft_delete
  '{}',  -- temporal_fields
  '{}',  -- notification_paths
  '{}',  -- permission_paths
  '{}',  -- graph_rules
  '{
    "owner_id": "@user_id",
    "created_by": "@user_id",
    "created_at": "@now",
    "status": "draft"
  }'   -- field_defaults (10th parameter)
);
```

## Available Variables

Field defaults support special variables that are resolved at runtime:

| Variable | Value | Example Use Case |
|----------|-------|------------------|
| `@user_id` | Current user ID from `p_user_id` | Ownership, audit trails |
| `@now` | Current timestamp | `created_at`, `updated_at` |
| `@today` | Current date | `valid_from`, `date_created` |
| Literal values | Any JSON value | `"draft"`, `0`, `true` |

## Behavior

### INSERT Operations

Field defaults are **only applied during INSERT** (creating new records):

```javascript
// Client doesn't send owner_id
await api.save_resources({
  data: { title: "Conference Room A" }
})

// Server auto-populates:
// - owner_id = current user ID
// - created_at = current timestamp
// - status = "draft"
```

### UPDATE Operations

Field defaults are **NOT applied during UPDATE** (modifying existing records):

```javascript
// Updating existing record
await api.save_resources({
  data: {
    id: 1,
    title: "Updated Title"
  }
})

// created_at is NOT changed
// owner_id is NOT changed
```

### Explicit Values Override Defaults

If the client explicitly provides a value, it takes precedence:

```javascript
await api.save_resources({
  data: {
    title: "Room A",
    status: "published"  // Overrides "draft" default
  }
})
```

## Common Use Cases

### Ownership Tracking

```sql
SELECT dzql.register_entity(
  'documents',
  'title',
  ARRAY['title'],
  '{}', false, '{}', '{}', '{}', '{}',
  '{
    "owner_id": "@user_id",
    "created_by": "@user_id"
  }'
);
```

### Timestamps

```sql
SELECT dzql.register_entity(
  'posts',
  'title',
  ARRAY['title'],
  '{}', false, '{}', '{}', '{}', '{}',
  '{
    "created_at": "@now",
    "published_at": "@now"
  }'
);
```

### Status/Workflow

```sql
SELECT dzql.register_entity(
  'orders',
  'order_number',
  ARRAY['order_number'],
  '{}', false, '{}', '{}', '{}', '{}',
  '{
    "status": "pending",
    "priority": "normal",
    "auto_process": "true"
  }'
);
```

### Multi-Tenant

```sql
SELECT dzql.register_entity(
  'items',
  'name',
  ARRAY['name'],
  '{}', false, '{}', '{}', '{}', '{}',
  '{
    "tenant_id": "@user_id",
    "created_at": "@now",
    "is_active": "true"
  }'
);
```

## Security Considerations

Field defaults improve security by:

1. **Preventing client-side tampering** - Server controls sensitive defaults
2. **Enforcing ownership** - Can't set wrong `owner_id`
3. **Audit trail integrity** - Timestamps set server-side
4. **Consistent initialization** - Every record starts in known state

## Example: Before vs After

### Before (Manual)

```javascript
// Client must remember to send owner_id every time
await api.save_tags({
  data: {
    name: "Important",
    owner_id: user.id,        // ← Easy to forget
    created_at: new Date(),   // ← Manual
    status: "active"          // ← Repetitive
  }
})
```

### After (Automatic)

```javascript
// Client sends only actual data
await api.save_tags({
  data: {
    name: "Important"
    // owner_id, created_at, status auto-populated!
  }
})
```

## Backwards Compatibility

Field defaults are **completely optional**:

- Entities without field defaults work exactly as before
- No migration needed for existing entities
- Can be added incrementally

## Implementation Details

### Storage

Field defaults are stored in the `dzql.entities` table:

```sql
SELECT field_defaults FROM dzql.entities WHERE table_name = 'resources';
```

Result:
```json
{
  "owner_id": "@user_id",
  "created_at": "@now",
  "status": "draft"
}
```

### Resolution

Variables are resolved in `generic_save()` using the existing `dzql.resolve_graph_variable()` function:

1. Check if field is missing in `p_data`
2. Get default value from entity config
3. If starts with `@`, resolve the variable
4. Add to data being inserted

## See Also

- [Entity Registration](../reference/api.md#register_entity) - Full registration API
- [Many-to-Many Support](./many-to-many.md) - Relationship defaults
- [Custom Functions](./custom-functions.md) - Extending entities
