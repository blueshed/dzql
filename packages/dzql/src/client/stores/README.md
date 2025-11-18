# DZQL Canonical Pinia Stores

**The official, AI-friendly Pinia stores for DZQL Vue.js applications.**

## Why These Stores Exist

When building DZQL apps, developers (and AI assistants) often struggle with:

1. **Three-phase lifecycle** - connecting → login → ready
2. **WebSocket connection management** - reconnection, error handling
3. **Authentication flow** - token storage, profile management  
4. **Router integration** - navigation, state synchronization
5. **Inconsistent patterns** - every project does it differently

These canonical stores solve all of these problems with a **simple, consistent pattern** that AI can easily understand and replicate.

## The Stores

### `useWsStore` - WebSocket & Auth

Manages:
- WebSocket connection (with auto-reconnect)
- User authentication (login/register/logout)
- Connection state tracking
- Three-phase app lifecycle

### `useAppStore` - Application State

Manages:
- App initialization
- Router integration
- Entity metadata caching
- Navigation helpers
- UI state (sidebars, panels)

## Quick Example

```vue
<script setup>
import { computed } from 'vue'
import { useWsStore, useAppStore } from 'dzql/client/stores'

const wsStore = useWsStore()
const appStore = useAppStore()

const state = computed(() => wsStore.appState)
const ws = wsStore.getWs()

// Use DZQL API
const venues = await ws.api.search.venues({ limit: 50 })
</script>

<template>
  <!-- Three-phase lifecycle -->
  <div v-if="state === 'connecting'">Connecting...</div>
  <LoginView v-else-if="state === 'login'" />
  <MainApp v-else-if="state === 'ready'" />
</template>
```

## Documentation

- **[Quick Start](../../../docs/reference/client.md)** - Get running in 5 minutes
- **[Complete Guide](../../../docs/guides/client-stores.md)** - Full API reference and patterns

## Files

- `useWsStore.js` - WebSocket connection and authentication
- `useAppStore.js` - Application state and navigation
- `index.js` - Exports both stores

## For AI Assistants

When helping users with DZQL apps:

1. **Always use these stores** - Don't create custom connection logic
2. **Follow the three-phase lifecycle** - connecting → login → ready
3. **Use computed for reactive state** - `const profile = computed(() => wsStore.profile)`
4. **Get WS instance for API calls** - `const ws = wsStore.getWs()`

**Example prompt for AI:**

> "I'm using the canonical DZQL stores from `dzql/client/stores`. The pattern is:
> 1. useWsStore for WebSocket connection (three phases: connecting, login, ready)
> 2. useAppStore for app state and navigation
> 3. Access DZQL API via `wsStore.getWs().api.get.venues({ id: 1 })`
> Please follow this pattern."

## Version

These stores are available in DZQL v0.1.6+

## License

MIT
