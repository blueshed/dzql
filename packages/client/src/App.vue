<script setup>
import { ref, onMounted } from 'vue'
import { useWs } from 'zeroql/client'
import LoginView from './components/LoginView.vue'
import Navbar from './components/Navbar.vue'

const ws = useWs()
const state = ref('connecting')
const userProfile = ref(null)

onMounted(() => {
  // Listen for the connected broadcast
  ws.onBroadcast((method, params) => {
    if (method === 'connected') {
      userProfile.value = params.profile
      state.value = params.profile ? 'content' : 'login'
    }
  })
})

const handleAuth = (profile) => {
  userProfile.value = profile
  state.value = 'content'
}

const handleLogout = async () => {
  try {
    await ws.call('logout')
  } catch (err) {
    console.error('Logout error:', err)
  }
  localStorage.removeItem('zeroql_token')
  userProfile.value = null
  state.value = 'login'
  // Reconnect to get fresh state
  ws.connect()
}
</script>

<template>
  <div class="min-h-screen bg-base-200">
    <!-- Connecting State -->
    <div v-if="state === 'connecting'" class="hero min-h-screen">
      <div class="hero-content text-center">
        <div>
          <span class="loading loading-spinner loading-lg text-primary"></span>
          <p class="mt-4 text-base-content">Connecting to server...</p>
        </div>
      </div>
    </div>

    <!-- Login State -->
    <LoginView v-else-if="state === 'login'" @authenticated="handleAuth" />

    <!-- Content State -->
    <div v-else-if="state === 'content'" class="min-h-screen">
      <Navbar :user="userProfile" @logout="handleLogout" />
      <main class="content">
        <div class="h-full overflow-y-auto">
          <div class="container mx-auto px-4 py-8">
            <router-view />
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<style>
/* Ensure full height for proper layout */
html, body, #app {
  height: 100%;
}
</style>
