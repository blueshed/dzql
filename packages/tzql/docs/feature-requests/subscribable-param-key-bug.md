# Bug: Subscribable permission check uses param name instead of column name

## Issue

When generating subscribable SQL, the permission check incorrectly uses the param name instead of the actual column name on the root entity.

## Example

Domain:
```javascript
org_dashboard: {
  params: { org_id: "int" },
  root: { entity: "organisations", key: "org_id" },
  canSubscribe: ["@org_id->acts_for[org_id=$]{active}.user_id"]
}
```

Generated SQL:
```sql
-- WRONG: v_root.org_id doesn't exist on organisations table
WHERE acts_for.org_id = v_root.org_id
```

Should be:
```sql
-- CORRECT: organisations.id is the actual column
WHERE acts_for.org_id = v_root.id
```

## Error

```
ERROR: record "v_root" has no field "org_id"
```

## Fix

The compiler should resolve `key: "org_id"` to mean "param org_id maps to the root entity's primary key (id)", not "access v_root.org_id".
