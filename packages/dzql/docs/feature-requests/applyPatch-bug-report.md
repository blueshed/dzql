# DZQL Bug Report

## Generated Store applyPatch Doesn't Match Data Structure

**Severity:** High (Breaking)

**Status:** ✅ FIXED

**Description:**
The generated Pinia store's `applyPatch` function assumes a flat data structure, but the subscribable SQL was returning nested wrapper objects.

**SQL was returning:**
```json
{
  "venues": {...},
  "sites": [
    { "sites": { "id": 1, "name": "..." }, "allocations": [...] },
    { "sites": { "id": 2, "name": "..." }, "allocations": [...] }
  ]
}
```

**Fix:**
Updated `subscribable_sql.ts` to use JSONB concatenation (`||`) to merge entity fields with nested includes into a flat structure:

```sql
SELECT jsonb_agg(
  row_to_json(rel.*) || jsonb_build_object(
    'allocations', COALESCE((
      SELECT jsonb_agg(row_to_json(nested.*))
      FROM allocations nested
      WHERE nested.site_id = rel.id
    ), '[]'::jsonb))
)
```

**SQL now returns:**
```json
{
  "venues": {...},
  "sites": [
    { "id": 1, "name": "...", "allocations": [...] },
    { "id": 2, "name": "...", "allocations": [...] }
  ]
}
```

This flat structure matches what `applyPatch` and `handleArrayPatch` expect, so realtime updates now work correctly for nested includes.

---

## Bug 2: json/jsonb Type Mismatch in Subscribable SQL

**Severity:** Critical (Blocking)

**Status:** ✅ FIXED

**Description:**
The generated subscribable SQL used `row_to_json()` which returns `json` type, but concatenated it with `jsonb_build_object()` which returns `jsonb`. PostgreSQL cannot concatenate these types.

**Generated SQL (before):**
```sql
row_to_json(rel.*) || jsonb_build_object(...)
```

**Error:**
```
operator does not exist: json || jsonb
```

**Fix:**
Changed to use `to_jsonb()` instead of `row_to_json()` when concatenating with nested includes:

```sql
to_jsonb(rel.*) || jsonb_build_object(...)
```

---

## Environment

- dzql version: local development (linked)
- Database: PostgreSQL 17 (Docker)
- Client: Vue 3 + Pinia + TypeScript
- Runtime: Bun
