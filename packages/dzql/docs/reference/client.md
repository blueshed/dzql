# DZQL Client Quick Start

**TL;DR:** Copy-paste guide to get a DZQL Vue.js app running in minutes.

## 1. Install

```bash
npm install dzql pinia vue-router
```

## 2. Copy Template

Copy the canonical App.vue template:
```bash
cp node_modules/dzql/src/client/templates/App.vue src/App.vue
```

Or create it manually:

**src/App.vue:**
```vue
<script setup>
import { computed, onMounted } from 'vue'
import { useWsStore, useAppStore } from 'dzql/client/stores'
import LoginView from './components/LoginView.vue'

const wsStore = useWsStore()
const appStore = useAppStore()
const state = computed(() => wsStore.appState)
const profile = computed(() => wsStore.profile)

onMounted(() => {
  appStore.initialize({ title: 'My App' })
})
</script>

<template>
  <!-- CONNECTING -->
  <div v-if="state === 'connecting'">Connecting...</div>
  
  <!-- LOGIN -->
  <LoginView v-else-if="state === 'login'" />
  
  <!-- READY -->
  <div v-else>
    <nav>
      <h1>{{ appStore.title }}</h1>
      <button @click="wsStore.logout()">Logout</button>
    </nav>
    <router-view />
  </div>
</template>
```

## 3. Create LoginView

**src/components/LoginView.vue:**
```vue
<script setup>
import { ref } from 'vue'
import { useWsStore } from 'dzql/client/stores'

const wsStore = useWsStore()
const email = ref('')
const password = ref('')

async function login() {
  try {
    await wsStore.login({ email: email.value, password: password.value })
  } catch (err) {
    alert(err.message)
  }
}
</script>

<template>
  <form @submit.prevent="login">
    <input v-model="email" type="email" placeholder="Email" required />
    <input v-model="password" type="password" placeholder="Password" required />
    <button type="submit">Login</button>
  </form>
</template>
```

**Registration with options (e.g., organisation name):**
```vue
<script setup>
import { ref } from 'vue'
import { useWsStore } from 'dzql/client/stores'

const wsStore = useWsStore()
const email = ref('')
const password = ref('')
const orgName = ref('')

async function register() {
  try {
    await wsStore.register({
      email: email.value,
      password: password.value,
      options: { org_name: orgName.value }
    })
  } catch (err) {
    alert(err.message)
  }
}
</script>

<template>
  <form @submit.prevent="register">
    <input v-model="email" type="email" placeholder="Email" required />
    <input v-model="password" type="password" placeholder="Password" required />
    <input v-model="orgName" type="text" placeholder="Organisation Name" />
    <button type="submit">Register</button>
  </form>
</template>
```

The `options` parameter allows passing additional JSONB data to the `register_user` and `login_user` PostgreSQL functions. This is useful for:
- Organisation name during registration
- Device ID for login tracking
- Any custom fields your auth functions support

See [API Reference - Authentication](./api.md#authentication) for details on configuring your PostgreSQL functions.

## 4. Setup main.js

**src/main.js:**
```javascript
import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import { createPinia } from 'pinia'
import { useAppStore } from 'dzql/client/stores'
import App from './App.vue'

const pinia = createPinia()

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('./views/Home.vue') },
    { path: '/:entity', name: 'entity-list', component: () => import('./views/EntityList.vue') },
    { path: '/:entity/:id', name: 'entity-detail', component: () => import('./views/EntityDetail.vue') }
  ]
})

const app = createApp(App)
app.use(pinia)
app.use(router)

const appStore = useAppStore()
appStore.setRouter(router)

app.mount('#app')
```

## 5. Use DZQL API

**Any component:**
```vue
<script setup>
import { ref, onMounted } from 'vue'
import { useWsStore } from 'dzql/client/stores'

const wsStore = useWsStore()
const ws = wsStore.getWs()
const venues = ref([])

onMounted(async () => {
  const result = await ws.api.search.venues({ limit: 50 })
  venues.value = result.data
})

async function createVenue() {
  await ws.api.save.venues({ name: 'New Venue' })
}
</script>

<template>
  <div v-for="venue in venues" :key="venue.id">
    {{ venue.name }}
  </div>
  <button @click="createVenue">Create</button>
</template>
```

## That's It! 🎉

You now have:
- ✅ WebSocket connection with auto-reconnect
- ✅ Three-phase lifecycle (connecting → login → ready)
- ✅ Authentication (login/logout)
- ✅ Router integration
- ✅ DZQL API access

## Next Steps

- Read [Client Stores Guide](../guides/client-stores.md) for complete API reference
- Customize the App.vue template
- Add your own components
- Style with Tailwind/DaisyUI

## Common Issues

**"Cannot find module 'dzql/client/stores'"**
- Make sure you're using dzql v0.1.6 or later
- Run `npm install dzql@latest`

**Connection fails**
- Check server is running
- For dev, use explicit URL: `appStore.initialize({ wsUrl: 'ws://localhost:3000/ws' })`

**Router not working**
- Make sure you call `appStore.setRouter(router)` in main.js

## Example Projects

Check `packages/client` for a complete working example.

## Help

For more help, see:
- [Client Stores Guide](../guides/client-stores.md) - Complete documentation
- [GitHub Issues](https://github.com/blueshed/dzql/issues)
