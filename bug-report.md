# DZQL Bug Report: Permission check in search functions uses unbound variable in dynamic SQL

## Summary

The `search_*` functions generate dynamic SQL that references `p_user_id` as a literal identifier instead of parameterizing it, causing a "column does not exist" error at runtime.

## Affected Code

**File:** `src/cli/codegen/sql.ts` (search function generation)

**Generated output example:** `generated/db/migrations/*_schema.sql` line ~2451

```sql
EXECUTE format('
  SELECT COALESCE(jsonb_agg(to_jsonb(t.*)), ''[]''::jsonb)
  FROM (
    SELECT * FROM venues
    WHERE (EXISTS (SELECT 1 FROM acts_fors WHERE acts_fors.org_id = venues.owner_id AND acts_fors.active = true AND acts_fors.user_id = p_user_id)) %s
    ORDER BY %I %s
    LIMIT %L OFFSET %L
  ) t
', v_where_clause, v_sort_field, v_sort_order, ...);
```

## Problem

Inside `EXECUTE format(...)`, the string `p_user_id` is treated as a column reference in the executed SQL context, not as the PL/pgSQL variable from the outer function scope.

PostgreSQL error:
```
PostgresError: column "p_user_id" does not exist
hint: Perhaps you meant to reference the column "acts_fors.user_id".
```

## Root Cause

The permission compiler (`src/cli/compiler/permissions.ts`) generates:
```sql
acts_fors.user_id = p_user_id
```

This is correct for static SQL but incorrect when embedded in dynamic SQL via `EXECUTE`.

## Solution

Option A: Use `USING` clause to pass `p_user_id` as a parameter:
```sql
EXECUTE format('
  SELECT ...
  WHERE (EXISTS (SELECT 1 FROM acts_fors WHERE acts_fors.org_id = venues.owner_id AND acts_fors.active = true AND acts_fors.user_id = $1)) %s
  ...
', v_where_clause, ...) USING p_user_id;
```

Option B: Interpolate `p_user_id` value into the format string:
```sql
EXECUTE format('
  SELECT ...
  WHERE (EXISTS (SELECT 1 FROM acts_fors WHERE acts_fors.org_id = venues.owner_id AND acts_fors.active = true AND acts_fors.user_id = %L)) %s
  ...
', p_user_id, v_where_clause, ...);
```

Option A is preferred as it avoids SQL injection and is cleaner.

## Steps to Reproduce

1. Define an entity with a permission path that traverses to `user_id`:
   ```typescript
   permissions: {
     view: ['@owner_id->acts_fors[org_id=$]{active}.user_id']
   }
   ```

2. Compile and call `search_*` function

3. Error occurs because `p_user_id` is unbound in dynamic SQL context

## Affected Functions

All `search_*` functions that have view permissions with traversal paths ending in `.user_id`.
