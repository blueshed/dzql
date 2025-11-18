<!--
  Canonical DZQL App.vue Template

  This template demonstrates the three-phase lifecycle:
  1. CONNECTING - Show loading spinner
  2. LOGIN - Show login form (if not authenticated)
  3. READY - Show main app content

  Copy this template to your project and customize as needed.
-->
<script setup>
import { computed, onMounted } from 'vue'
import { useWsStore, useAppStore } from 'dzql/client/stores'

// Import your components
// import LoginView from './components/LoginView.vue'
// import MainLayout from './components/MainLayout.vue'

const wsStore = useWsStore()
const appStore = useAppStore()

// Computed state for template
const state = computed(() => wsStore.appState)
const profile = computed(() => wsStore.profile)
const error = computed(() => wsStore.error)

// Initialize on mount
onMounted(async () => {
  try {
    await appStore.initialize({
      title: 'My DZQL App',
      // wsUrl: 'ws://localhost:3000/ws' // Optional: custom WS URL
    })
  } catch (err) {
    console.error('Failed to initialize app:', err)
  }
})

// Handle authentication success
function handleAuthenticated(userProfile) {
  // Profile is already set by wsStore
  // Fetch metadata after login
  appStore.fetchMetadata()
}

// Handle logout
async function handleLogout() {
  await wsStore.logout()
}
</script>

<template>
  <div class="min-h-screen bg-base-200">
    <!-- Phase 1: CONNECTING -->
    <div v-if="state === 'connecting'" class="hero min-h-screen">
      <div class="hero-content text-center">
        <div>
          <span class="loading loading-spinner loading-lg text-primary"></span>
          <p class="mt-4 text-base-content">Connecting to server...</p>
          <p v-if="error" class="mt-2 text-error text-sm">{{ error }}</p>
        </div>
      </div>
    </div>

    <!-- Phase 2: LOGIN (not authenticated) -->
    <div v-else-if="state === 'login'" class="hero min-h-screen">
      <div class="hero-content">
        <div class="card w-full max-w-md bg-base-100 shadow-xl">
          <div class="card-body">
            <h2 class="card-title justify-center">{{ appStore.title }}</h2>

            <!-- Replace with your LoginView component -->
            <p class="text-center text-base-content/60 py-8">
              Login component goes here
            </p>

            <!-- Example: <LoginView @authenticated="handleAuthenticated" /> -->
          </div>
        </div>
      </div>
    </div>

    <!-- Phase 3: READY (authenticated and connected) -->
    <div v-else-if="state === 'ready'" class="min-h-screen flex flex-col">
      <!-- Replace with your main layout -->
      <div class="navbar bg-base-100 shadow-lg">
        <div class="flex-1">
          <a class="btn btn-ghost text-xl">{{ appStore.title }}</a>
        </div>
        <div class="flex-none gap-2">
          <div class="dropdown dropdown-end">
            <div tabindex="0" role="button" class="btn btn-ghost btn-circle avatar placeholder">
              <div class="bg-neutral text-neutral-content rounded-full w-10">
                <span>{{ profile?.email?.[0]?.toUpperCase() || 'U' }}</span>
              </div>
            </div>
            <ul tabindex="0" class="mt-3 z-[1] p-2 shadow menu menu-sm dropdown-content bg-base-100 rounded-box w-52">
              <li class="menu-title">{{ profile?.email }}</li>
              <li><a @click="handleLogout">Logout</a></li>
            </ul>
          </div>
        </div>
      </div>

      <main class="flex-1 p-4">
        <!-- Replace with your router-view or main content -->
        <div class="card bg-base-100 shadow-xl">
          <div class="card-body">
            <h2 class="card-title">Welcome!</h2>
            <p>Replace this with your main content or &lt;router-view /&gt;</p>

            <div v-if="appStore.hasMetadata" class="mt-4">
              <h3 class="font-bold">Available Entities:</h3>
              <ul class="list-disc list-inside">
                <li v-for="entity in appStore.entityList" :key="entity">
                  {{ entity }}
                </li>
              </ul>
            </div>
          </div>
        </div>
      </main>
    </div>

    <!-- Error State (fallback) -->
    <div v-else class="hero min-h-screen">
      <div class="hero-content text-center">
        <div>
          <p class="text-error">Unknown state: {{ state }}</p>
          <button @click="appStore.initialize()" class="btn btn-primary mt-4">
            Retry
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Ensure full height for proper layout */
html, body, #app {
  height: 100%;
}
</style>
