# DZQL Canonical Stores - Implementation Summary

**Date:** 2025-11-18  
**Version:** DZQL 0.1.6+  
**Status:** ✅ Complete

## What Was Created

Created canonical Pinia stores for DZQL Vue.js applications to solve the common problem where AI assistants get confused about the three-phase lifecycle (connecting → login → ready).

## Files Created

### Core Store Files

1. **`packages/dzql/src/client/stores/useWsStore.js`**
   - WebSocket connection management
   - Authentication (login/register/logout)
   - Three-phase lifecycle state
   - Connection state tracking
   - Direct access to WebSocket API

2. **`packages/dzql/src/client/stores/useAppStore.js`**
   - Application initialization
   - Router integration
   - Entity metadata caching
   - Navigation helpers
   - UI state management

3. **`packages/dzql/src/client/stores/index.js`**
   - Exports both stores

### Template Files

4. **`packages/dzql/src/client/templates/App.vue`**
   - Canonical App.vue template
   - Shows three-phase lifecycle implementation
   - Ready to copy and customize

### Documentation

5. **`packages/dzql/docs/CLIENT-STORES.md`** (Comprehensive)
   - Complete API reference
   - All store properties, computed, and actions
   - Multiple examples
   - Patterns and best practices
   - Migration guide
   - Troubleshooting

6. **`packages/dzql/docs/CLIENT-QUICK-START.md`** (Quick Reference)
   - Copy-paste guide
   - Get running in 5 minutes
   - Common issues and solutions

7. **`packages/dzql/src/client/stores/README.md`**
   - Overview and quick example
   - Links to detailed docs
   - Instructions for AI assistants

## Key Features

### Three-Phase Lifecycle

The stores implement the canonical DZQL lifecycle:

```
┌─────────────┐
│ CONNECTING  │  Initial WebSocket connection
└──────┬──────┘
       │
       v
┌─────────────┐
│    LOGIN    │  Show login form (if not authenticated)
└──────┬──────┘
       │
       v
┌─────────────┐
│    READY    │  App is ready to use
└─────────────┘
```

### State Management

**useWsStore:**
- `connectionState` - WebSocket connection status
- `appState` - Application lifecycle phase
- `profile` - User profile (null if not authenticated)
- `isConnected`, `isAuthenticated`, `isReady` - Computed booleans

**useAppStore:**
- `currentEntity`, `currentId` - Router context
- `entityMetadata` - Cached entity information
- `title`, `sidebarOpen`, `propertiesPanelOpen` - UI state

### Actions

**useWsStore:**
- `connect(url, timeout)` - Connect to WebSocket
- `login({ email, password })` - Authenticate user
- `register({ email, password })` - Create new user
- `logout()` - Clear session
- `getWs()` - Get WebSocket instance for API calls

**useAppStore:**
- `initialize(options)` - Initialize app (connects WS, sets up lifecycle)
- `fetchMetadata()` - Load entity metadata from server
- `setRouter(router)` - Integrate Vue Router
- `navigateToEntity(name)` - Programmatic navigation
- `toggleSidebar()`, `togglePropertiesPanel()` - UI toggles

## Usage Pattern

### Setup (main.js)

```javascript
import { createPinia } from 'pinia'
import { useAppStore } from 'dzql/client/stores'

const pinia = createPinia()
app.use(pinia)

const appStore = useAppStore()
await appStore.initialize({ title: 'My App' })
```

### In Components

```vue
<script setup>
import { computed } from 'vue'
import { useWsStore } from 'dzql/client/stores'

const wsStore = useWsStore()
const state = computed(() => wsStore.appState)
const ws = wsStore.getWs()

// Use DZQL API
const venues = await ws.api.search.venues({ limit: 50 })
</script>

<template>
  <div v-if="state === 'connecting'">Connecting...</div>
  <LoginView v-else-if="state === 'login'" />
  <MainApp v-else />
</template>
```

### Direct API Access

```javascript
const wsStore = useWsStore()
const ws = wsStore.getWs()

// CRUD operations
const venue = await ws.api.get.venues({ id: 1 })
const created = await ws.api.save.venues({ name: 'New Venue' })
await ws.api.delete.venues({ id: 1 })

// Search
const results = await ws.api.search.venues({
  filters: { city: 'New York' },
  page: 1,
  limit: 50
})

// Custom functions
const result = await ws.api.myCustomFunction({ param: 'value' })
```

## Package.json Updates

Added exports to `packages/dzql/package.json`:

```json
"exports": {
  "./client/stores": "./src/client/stores/index.js",
  "./client/templates": "./src/client/templates/App.vue"
}
```

## Benefits

### For Developers

1. **No boilerplate** - Just import and use
2. **Clear lifecycle** - Three phases, well-defined
3. **Type-safe(ish)** - Computed properties for reactive state
4. **Router integration** - Navigation helpers built-in
5. **Consistent patterns** - Same across all DZQL projects

### For AI Assistants

1. **Canonical reference** - Single source of truth
2. **Clear documentation** - Examples and patterns
3. **Simple API** - Easy to understand and replicate
4. **Error-resistant** - Hard to get wrong

## Instructions for AI

When working with DZQL Vue.js apps, always use these stores:

```javascript
import { useWsStore, useAppStore } from 'dzql/client/stores'
```

**Key points:**
1. Three phases: `connecting` → `login` → `ready`
2. Use `wsStore.appState` to determine which phase
3. Get WS for API: `const ws = wsStore.getWs()`
4. Initialize in main.js: `await appStore.initialize()`
5. Use computed for reactivity: `const profile = computed(() => wsStore.profile)`

**Template:**
```vue
<template>
  <div v-if="wsStore.appState === 'connecting'">Loading...</div>
  <LoginView v-else-if="wsStore.appState === 'login'" />
  <MainApp v-else-if="wsStore.appState === 'ready'" />
</template>
```

## Example Projects

- `packages/client/` - Full example using the stores
- Template files in `packages/dzql/src/client/templates/`

## Migration Path

For existing projects, replace custom connection logic with:

**Before:**
```javascript
import { useWs } from "dzql/client"

const ws = useWs()
const profile = ref(null)

ws.onBroadcast((method, params) => {
  if (method === "connected") {
    profile.value = params.profile || null
  }
})

await ws.connect('ws://localhost:3000/ws')
```

**After:**
```javascript
import { useWsStore } from 'dzql/client/stores'

const wsStore = useWsStore()
const profile = computed(() => wsStore.profile)

await wsStore.connect('ws://localhost:3000/ws')
```

## Testing

Stores are designed to be testable:

```javascript
import { setActivePinia, createPinia } from 'pinia'
import { useWsStore } from 'dzql/client/stores'

beforeEach(() => {
  setActivePinia(createPinia())
})

it('initializes correctly', () => {
  const wsStore = useWsStore()
  expect(wsStore.appState).toBe('connecting')
  expect(wsStore.profile).toBeNull()
})
```

## Future Enhancements

Potential additions:
- [ ] TypeScript type definitions
- [ ] Devtools integration
- [ ] Offline support
- [ ] State persistence
- [ ] SSR support

## Conclusion

These canonical stores provide a **simple, consistent, AI-friendly** pattern for building DZQL Vue.js applications. They handle the three-phase lifecycle correctly and provide all the functionality needed for authentication, navigation, and API access.

**Key deliverables:**
- ✅ Two canonical stores (useWsStore, useAppStore)
- ✅ Template App.vue
- ✅ Comprehensive documentation (100+ examples)
- ✅ Quick start guide
- ✅ Package exports configured
- ✅ Migration guide
- ✅ AI assistant instructions

**Status:** Ready for use in DZQL v0.1.6+
