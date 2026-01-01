# DZQL Bug Report

Bugs discovered while building the Venues application with DZQL.

---

## Bug 1: Hidden Fields Exposed in Subscribables

**Severity:** High (Security)

**Status:** ✅ FIXED

**Description:**
Fields marked as `hidden: true` in the domain schema are still exposed when using subscribables. The generated SQL uses `row_to_json(root.*)` which includes all columns regardless of the `hidden` property.

**Fix:**
Added `buildVisibleRowJson` helper in `subscribable_sql.ts` that generates `jsonb_build_object()` with only visible fields instead of `row_to_json(root.*)`. Also updated all other SQL generators (`sql.ts`) to exclude hidden fields from `get_*`, `search_*`, `save_*`, and `delete_*` functions.

---

## Bug 2: Generated Pinia Stores Don't Await Async Subscribe

**Severity:** Medium

**Status:** ✅ FIXED

**Description:**
The generated Pinia stores call the async `subscribe` method but don't await it. This means `store.data` is undefined immediately after calling `store.subscribe()` even though the subscription has been initiated.

**Fix:**
Updated `subscribable_store.ts` to make the `bind` function async. It now:
1. Creates a `ready` Promise that resolves when first data arrives
2. Awaits the `ready` Promise before returning
3. Stores the `ready` Promise so repeat calls can also await it

**Generated Code (after fix):**
```typescript
async function bind(params) {
  const key = JSON.stringify(params);
  if (documents.value[key]) {
    const existing = documents.value[key];
    if (existing.loading.value) {
      await existing.ready;
    }
    return existing;
  }

  const docState = ref(null);
  const loading = ref(true);
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });

  ws.api.subscribe_venue_detail(params, (initialData) => {
    docState.value = initialData;
    loading.value = false;
    resolveReady();
  });

  documents.value[key] = { data: docState, loading, ready };
  await ready;
  return documents.value[key];
}
```

**Usage:**
```typescript
const store = useMyProfileStore();
const { data, loading } = await store.bind({ user_id: 1 });
// data.value is now populated
```

---

## Bug 3: Subscribable Permission Check Uses Param Name Instead of Column Name

**Severity:** High (Breaking)

**Status:** ✅ FIXED

**Description:**
When generating SQL for subscribable permission checks, the compiler uses the parameter name instead of the actual database column name. This causes SQL errors when the param name differs from the column name.

**Fix:**
Updated `compileSubscribePermission` in `subscribable_sql.ts` to map param names to the root entity's `id` column when they match the rootKey. For example, `@org_id` now correctly resolves to `v_root.id` instead of `v_root.org_id`.

---

## Summary

| Bug | Severity | Status | Notes |
|-----|----------|--------|-------|
| Hidden fields exposed | High | ✅ Fixed | Uses `jsonb_build_object` to exclude hidden fields |
| Stores don't await | Medium | ✅ Fixed | `bind()` is now async and awaits first data |
| Permission param/column mismatch | High | ✅ Fixed | Maps param name to `id` column |

---

## Environment

- dzql version: (linked local development version)
- Database: PostgreSQL 17 (via Docker)
- Client: Vue 3 + Pinia + TypeScript
- Runtime: Bun

---

## Related Files

Detailed bug documents created in dzql docs:
- `/packages/tzql/docs/feature-requests/hidden-fields-in-subscribables.md`
- `/packages/tzql/docs/feature-requests/subscribable-param-key-bug.md`
