# DZQL Compiler Bug: Wrong parameter name in on_delete graph rules

## Summary
The DZQL compiler generates `p_record` in on_delete graph rule functions, but the function parameter is named `p_old_record`.

## Error
```
PostgresError: column "p_record" does not exist
code: 42703
```

## Affected Files
- `packages/database/init_db/sites.sql` - `_graph_sites_on_delete` function
- `packages/database/init_db/venues.sql` - `_graph_venues_on_delete` function

## Example of Generated Code (Wrong)
```sql
CREATE OR REPLACE FUNCTION _graph_sites_on_delete(
  p_user_id INT,
  p_old_record JSONB  -- Parameter is named p_old_record
) RETURNS VOID AS $$
BEGIN
  -- Cannot delete site with allocations
  IF NOT _site_has_no_allocations(p_site_id => (p_record->>'id')) THEN  -- BUG: uses p_record
    RAISE EXCEPTION 'Cannot delete site - it has allocations';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

## Expected Code (Correct)
```sql
CREATE OR REPLACE FUNCTION _graph_sites_on_delete(
  p_user_id INT,
  p_old_record JSONB
) RETURNS VOID AS $$
BEGIN
  -- Cannot delete site with allocations
  IF NOT _site_has_no_allocations(p_site_id => (p_old_record->>'id')) THEN  -- Should use p_old_record
    RAISE EXCEPTION 'Cannot delete site - it has allocations';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

## Entity Definition
The entity definition in `entities.sql` uses `@id` which should expand to the correct parameter:

```sql
'{"on_delete": {"prevent_with_allocations": {"description": "Cannot delete site with allocations", "actions": [{"type": "validate", "function": "_site_has_no_allocations", "params": {"p_site_id": "@id"}, "error_message": "Cannot delete site - it has allocations"}]}}}'
```

## Root Cause
In the compiler, when generating `_graph_<table>_on_delete` functions, the `@id` parameter reference is being expanded to `p_record->>'id'` instead of `p_old_record->>'id'`.

## Workaround
Manually edit the generated SQL files to change `p_record` to `p_old_record` in the on_delete graph rule functions.
