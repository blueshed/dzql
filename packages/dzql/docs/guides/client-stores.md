# DZQL Client Stores Guide

Complete guide to using the canonical DZQL Pinia stores for Vue.js applications.

## Overview

DZQL provides two canonical Pinia stores that handle the complete application lifecycle:

1. **`useWsStore`** - WebSocket connection and authentication management
2. **`useAppStore`** - Application state and navigation

These stores implement the **three-phase lifecycle** that DZQL applications follow:

### Three-Phase Lifecycle

```
┌─────────────┐
│ CONNECTING  │  Initial WebSocket connection
└──────┬──────┘
       │
       ├─ Connected without profile
       │
       v
┌─────────────┐
│    LOGIN    │  Show login form, wait for authentication
└──────┬──────┘
       │
       ├─ User authenticates
       │
       v
┌─────────────┐
│    READY    │  App is ready to use
└─────────────┘
```

## Quick Start

### 1. Install Dependencies

```bash
npm install pinia vue-router
```

### 2. Basic Setup

**main.js:**
```javascript
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { useAppStore } from 'dzql/client/stores'
import App from './App.vue'

const pinia = createPinia()
const app = createApp(App)

app.use(pinia)

// Initialize app store
const appStore = useAppStore()
await appStore.initialize({
  title: 'My DZQL App'
})

app.mount('#app')
```

**App.vue:**
```vue
<script setup>
import { computed } from 'vue'
import { useWsStore } from 'dzql/client/stores'
import LoginView from './components/LoginView.vue'
import MainLayout from './components/MainLayout.vue'

const wsStore = useWsStore()
const state = computed(() => wsStore.appState)
</script>

<template>
  <!-- Phase 1: CONNECTING -->
  <div v-if="state === 'connecting'">
    <span class="loading loading-spinner"></span>
    Connecting...
  </div>

  <!-- Phase 2: LOGIN -->
  <LoginView v-else-if="state === 'login'" />

  <!-- Phase 3: READY -->
  <MainLayout v-else-if="state === 'ready'" />
</template>
```

## Store API Reference

### useWsStore

Manages WebSocket connection and user authentication.

#### State

```javascript
const wsStore = useWsStore()

wsStore.connectionState  // 'disconnected' | 'connecting' | 'connected' | 'error'
wsStore.appState        // 'connecting' | 'login' | 'ready'
wsStore.profile         // User profile object or null
wsStore.error           // Last error message or null
```

#### Computed

```javascript
wsStore.isConnected      // boolean - WebSocket is connected
wsStore.isAuthenticated  // boolean - User is logged in
wsStore.isReady          // boolean - App is ready (connected + authenticated)
wsStore.needsLogin       // boolean - Needs to show login form
wsStore.isConnecting     // boolean - Currently connecting
```

#### Actions

**connect(url, timeout)**

Connect to WebSocket server. URL is auto-detected if not provided.

```javascript
// Auto-detect URL
await wsStore.connect()

// Custom URL (development)
await wsStore.connect('ws://localhost:3000/ws')

// Custom timeout
await wsStore.connect(null, 10000) // 10 seconds
```

**login({ email, password })**

Login with email and password.

```javascript
try {
  const result = await wsStore.login({
    email: 'user@example.com',
    password: 'password123'
  })
  
  console.log('Logged in:', result.profile)
} catch (err) {
  console.error('Login failed:', err.message)
}
```

**register({ email, password })**

Register a new user.

```javascript
try {
  const result = await wsStore.register({
    email: 'newuser@example.com',
    password: 'securepass123'
  })
  
  console.log('Registered:', result.profile)
} catch (err) {
  console.error('Registration failed:', err.message)
}
```

**logout()**

Logout current user and clear session.

```javascript
await wsStore.logout()
```

**disconnect()**

Disconnect from WebSocket.

```javascript
wsStore.disconnect()
```

**getWs()**

Get the WebSocket manager instance for direct API calls.

```javascript
const ws = wsStore.getWs()

// Use DZQL API
const venue = await ws.api.get.venues({ id: 1 })
const created = await ws.api.save.venues({ name: 'New Venue' })

// Call custom functions
const result = await ws.api.myCustomFunction({ param: 'value' })
```

---

### useAppStore

Manages application-level state and navigation.

#### State

```javascript
const appStore = useAppStore()

appStore.title                  // App title
appStore.currentEntity          // Current entity name or null
appStore.currentId              // Current record ID or null
appStore.entityMetadata         // Entity metadata cache object
appStore.isLoadingMetadata      // boolean - Fetching metadata
appStore.sidebarOpen            // boolean - Sidebar visibility
appStore.propertiesPanelOpen    // boolean - Properties panel visibility
```

#### Computed

```javascript
appStore.hasMetadata         // boolean - Metadata loaded
appStore.entityList          // string[] - Sorted list of entity names
appStore.currentEntityMeta   // object - Metadata for current entity
```

#### Actions

**initialize(options)**

Initialize the app (connect to WebSocket and set up lifecycle).

```javascript
await appStore.initialize({
  wsUrl: 'ws://localhost:3000/ws',  // Optional
  title: 'My DZQL App'              // Optional
})
```

**fetchMetadata()**

Fetch entity metadata from server. Called automatically after authentication.

```javascript
await appStore.fetchMetadata()
```

**setRouter(router)**

Set Vue Router instance to enable programmatic navigation.

```javascript
import { createRouter } from 'vue-router'

const router = createRouter({ ... })
appStore.setRouter(router)
```

**Navigation Methods:**

```javascript
// Navigate to entity list
appStore.navigateToEntity('venues')

// Navigate to entity detail
appStore.navigateToEntityDetail('venues', 123)
appStore.navigateToEntityDetail('venues', 'new')

// Navigate to home
appStore.navigateToHome()

// Set context manually (without navigation)
appStore.setContext('venues', 123)
```

**UI Toggles:**

```javascript
appStore.toggleSidebar()
appStore.togglePropertiesPanel()
```

---

## Complete Examples

### Example 1: Basic App with Router

**main.js:**
```javascript
import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import { createPinia } from 'pinia'
import { useAppStore } from 'dzql/client/stores'
import App from './App.vue'

// Create Pinia
const pinia = createPinia()

// Create Router
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('./views/Home.vue') },
    { path: '/:entity', name: 'entity-list', component: () => import('./views/EntityList.vue') },
    { path: '/:entity/:id', name: 'entity-detail', component: () => import('./views/EntityDetail.vue') }
  ]
})

// Create App
const app = createApp(App)
app.use(pinia)
app.use(router)

// Initialize
const appStore = useAppStore()
appStore.setRouter(router)
await appStore.initialize()

app.mount('#app')
```

**App.vue:**
```vue
<script setup>
import { computed } from 'vue'
import { useWsStore, useAppStore } from 'dzql/client/stores'
import LoginView from './components/LoginView.vue'

const wsStore = useWsStore()
const appStore = useAppStore()

const state = computed(() => wsStore.appState)
const profile = computed(() => wsStore.profile)

async function handleLogout() {
  await wsStore.logout()
}
</script>

<template>
  <div class="app">
    <!-- CONNECTING -->
    <div v-if="state === 'connecting'" class="loading-screen">
      <div class="spinner"></div>
      <p>Connecting...</p>
    </div>

    <!-- LOGIN -->
    <LoginView v-else-if="state === 'login'" />

    <!-- READY -->
    <div v-else-if="state === 'ready'">
      <nav>
        <h1>{{ appStore.title }}</h1>
        <div class="user-menu">
          <span>{{ profile.email }}</span>
          <button @click="handleLogout">Logout</button>
        </div>
      </nav>
      
      <main>
        <router-view />
      </main>
    </div>
  </div>
</template>
```

**LoginView.vue:**
```vue
<script setup>
import { ref } from 'vue'
import { useWsStore } from 'dzql/client/stores'

const wsStore = useWsStore()
const email = ref('')
const password = ref('')
const error = ref(null)

async function handleLogin() {
  try {
    error.value = null
    await wsStore.login({
      email: email.value,
      password: password.value
    })
  } catch (err) {
    error.value = err.message
  }
}
</script>

<template>
  <div class="login-form">
    <h2>Login</h2>
    
    <form @submit.prevent="handleLogin">
      <input v-model="email" type="email" placeholder="Email" required />
      <input v-model="password" type="password" placeholder="Password" required />
      <button type="submit">Login</button>
    </form>
    
    <p v-if="error" class="error">{{ error }}</p>
  </div>
</template>
```

---

### Example 2: Using DZQL API

**EntityList.vue:**
```vue
<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useWsStore, useAppStore } from 'dzql/client/stores'

const route = useRoute()
const wsStore = useWsStore()
const appStore = useAppStore()

const entity = computed(() => route.params.entity)
const records = ref([])
const loading = ref(false)

async function loadRecords() {
  const ws = wsStore.getWs()
  loading.value = true
  
  try {
    const result = await ws.api.search[entity.value]({
      filters: {},
      page: 1,
      limit: 50
    })
    
    records.value = result.data
  } catch (err) {
    console.error('Failed to load records:', err)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadRecords()
})

function createNew() {
  appStore.navigateToEntityDetail(entity.value, 'new')
}

function editRecord(id) {
  appStore.navigateToEntityDetail(entity.value, id)
}
</script>

<template>
  <div>
    <div class="header">
      <h2>{{ entity }}</h2>
      <button @click="createNew">New</button>
    </div>
    
    <div v-if="loading">Loading...</div>
    
    <table v-else>
      <tbody>
        <tr v-for="record in records" :key="record.id" @click="editRecord(record.id)">
          <td>{{ record.id }}</td>
          <td>{{ record.name || record.title || record.email }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
```

---

## Patterns and Best Practices

### Pattern 1: Reactive State in Components

```vue
<script setup>
import { computed } from 'vue'
import { useWsStore } from 'dzql/client/stores'

const wsStore = useWsStore()

// Use computed for reactive access
const profile = computed(() => wsStore.profile)
const isAuthenticated = computed(() => wsStore.isAuthenticated)

// Direct access to actions
async function login() {
  await wsStore.login({ email: '...', password: '...' })
}
</script>

<template>
  <div v-if="isAuthenticated">
    Welcome, {{ profile.email }}!
  </div>
</template>
```

### Pattern 2: Listening to WebSocket Broadcasts

```javascript
import { onMounted, onUnmounted } from 'vue'
import { useWsStore } from 'dzql/client/stores'

const wsStore = useWsStore()
const ws = wsStore.getWs()

onMounted(() => {
  // Listen for real-time updates
  const cleanup = ws.onBroadcast((method, params) => {
    if (method === 'venues:update') {
      console.log('Venue updated:', params.after)
      // Refresh your data
    }
  })
  
  onUnmounted(() => {
    cleanup()
  })
})
```

### Pattern 3: Global Navigation

```javascript
import { useAppStore } from 'dzql/client/stores'

const appStore = useAppStore()

// Navigate from anywhere in your app
function goToVenues() {
  appStore.navigateToEntity('venues')
}

function createNewVenue() {
  appStore.navigateToEntityDetail('venues', 'new')
}
```

### Pattern 4: Error Handling

```javascript
import { useWsStore } from 'dzql/client/stores'

const wsStore = useWsStore()

async function saveRecord(data) {
  const ws = wsStore.getWs()
  
  try {
    const result = await ws.api.save.venues(data)
    return result
  } catch (err) {
    if (err.message.includes('Permission denied')) {
      // Handle permission error
      alert('You do not have permission to save this record')
    } else if (err.message.includes('not found')) {
      // Handle not found
      alert('Record not found')
    } else {
      // Generic error
      console.error('Save failed:', err)
      alert('Failed to save: ' + err.message)
    }
    throw err
  }
}
```

---

## Common Issues and Solutions

### Issue: AI Gets the Pattern Wrong

**Problem:** When asking AI to help, it often mixes patterns or forgets the three-phase lifecycle.

**Solution:** Always reference this document and the template files:
```
packages/dzql/src/client/stores/useWsStore.js
packages/dzql/src/client/stores/useAppStore.js
packages/dzql/src/client/templates/App.vue
```

Point the AI to these files explicitly:
> "Use the canonical stores from packages/dzql/src/client/stores/ - follow the pattern in useWsStore.js for authentication"

### Issue: Router Integration Confusion

**Problem:** Router state doesn't sync with app state.

**Solution:** Always call `setRouter()` in main.js:
```javascript
const appStore = useAppStore()
appStore.setRouter(router)
```

### Issue: WebSocket Not Connecting

**Problem:** Connection fails or times out.

**Solution:** Check:
1. Server is running
2. URL is correct (auto-detection works in browser, use explicit URL in dev)
3. CORS settings allow WebSocket connections
4. Check browser console for errors

```javascript
// Use explicit URL during development
await appStore.initialize({
  wsUrl: import.meta.env.DEV ? 'ws://localhost:3000/ws' : null
})
```

### Issue: Metadata Not Loading

**Problem:** `appStore.entityMetadata` is empty.

**Solution:** Metadata loads after authentication. Make sure:
```javascript
// Option 1: Happens automatically after login
await wsStore.login({ email, password })
// fetchMetadata() called automatically

// Option 2: Call manually
await appStore.fetchMetadata()
```

---

## Migration Guide

### From Old Pattern to New Stores

**Before (old pattern in packages/client/src/stores/main.js):**
```javascript
import { useWs } from "dzql/client"

export const useProfileStore = defineStore('profile', () => {
  const ws = useWs()
  const profile = ref(null)
  
  ws.onBroadcast(async (method, params) => {
    if (method === "connected") {
      profile.value = params.profile || null
    }
  })
  
  const connect = async () => {
    await ws.connect('ws://localhost:3000/ws')
  }
  
  return { profile, connect }
})
```

**After (new canonical pattern):**
```javascript
import { useWsStore, useAppStore } from 'dzql/client/stores'

// In main.js
const appStore = useAppStore()
await appStore.initialize()

// In components
const wsStore = useWsStore()
const profile = computed(() => wsStore.profile)
```

---

## TypeScript Support

The stores are written in JavaScript but work perfectly with TypeScript projects. Type definitions coming soon!

---

## Testing

### Unit Testing Stores

```javascript
import { setActivePinia, createPinia } from 'pinia'
import { useWsStore } from 'dzql/client/stores'

describe('useWsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })
  
  it('initializes with correct state', () => {
    const wsStore = useWsStore()
    
    expect(wsStore.connectionState).toBe('disconnected')
    expect(wsStore.appState).toBe('connecting')
    expect(wsStore.profile).toBeNull()
  })
})
```

---

## Summary

The DZQL canonical stores provide:

✅ **Three-phase lifecycle** - connecting → login → ready  
✅ **Automatic auth handling** - Token storage, profile management  
✅ **Router integration** - Programmatic navigation  
✅ **Metadata caching** - Entity information  
✅ **Direct WebSocket access** - For DZQL API calls  
✅ **Clear patterns** - Easier for AI to understand  

Use these stores as the foundation for all DZQL Vue.js applications!
