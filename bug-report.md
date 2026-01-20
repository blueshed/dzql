# DZQL Compiler Bugs

## Bug 1: Variable not parameterized in subscribable permission check

### Summary

The `venue_my_venues_can_subscribe` function references PL/pgSQL variable `v_id` directly in a SQL string, causing a "column does not exist" error.

## Error

```
PostgresError: column "v_id" does not exist
  hint: "Perhaps you meant to reference the column \"venues.id\".",
  where: "PL/pgSQL function venue_my_venues_can_subscribe(integer,jsonb) line 10 at SQL statement
          PL/pgSQL function get_venue_my_venues(jsonb,integer) line 10 at IF",
  internal_query: "SELECT * FROM venues WHERE id = v_id"
```

## Cause

The generated function builds a SQL query that references the PL/pgSQL variable `v_id` as if it were a column name:

```sql
SELECT * FROM venues WHERE id = v_id
```

This should either:
1. Use a parameterized query with `USING` clause in `EXECUTE`
2. Interpolate the value directly: `WHERE id = ' || v_id || '`

## Location

Generated file: `generated/db/migrations/*_subscribables.sql`
Function: `dzql_v2.venue_my_venues_can_subscribe(integer, jsonb)`

## Related

This is similar to the previously fixed `p_user_id` bug in search functions (fixed in DZQL v0.6.28). The same pattern needs to be applied to subscribable permission check functions.

### Reproduction

1. Define a document subscribable with a permission filter
2. Compile with `bunx dzql`
3. Call `subscribe_venue_my_venues` from client
4. Error occurs in `venue_my_venues_can_subscribe`

---

## Bug 2: Notification paths not compiled into _notify_users functions

### Summary

Entity notification paths defined in the model are not being compiled into the generated `*_notify_users` functions. All notify functions return empty arrays.

### Expected

Venue has notification path in entities.ts:
```typescript
notifications: {
  owner: ["@owner_id->acts_fors[org_id=$]{active}.user_id"],
},
```

The generated `venues_notify_users` function should compile this path and return user IDs of members in the owning organisation.

### Actual

```sql
CREATE OR REPLACE FUNCTION dzql_v2.venues_notify_users(
  p_user_id INT,
  p_data JSONB
) RETURNS INT[]
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN ARRAY[]::INT[];  -- Empty! Path not compiled
END;
$$;
```

### Impact

Users don't receive realtime notifications when data they have access to changes. The notification system is non-functional.

### Location

Generated file: `generated/db/migrations/*_schema.sql`
All `*_notify_users` functions are affected.
