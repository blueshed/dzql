<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useWs } from 'dzql/client'
import LoginView from './components/LoginView.vue'
import Navbar from './components/Navbar.vue'
import ThreePanelLayout from './components/ThreePanelLayout.vue'
import ContextPanel from './components/ContextPanel.vue'
import ContentPanel from './components/ContentPanel.vue'
import PropertiesPanel from './components/PropertiesPanel.vue'
import HelloView from './components/hello.vue'
import NotificationContainer from './components/NotificationContainer.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'

const ws = useWs()
const route = useRoute()
const state = ref('connecting')
const userProfile = ref(null)

// Computed labels for panels
const pageTitle = computed(() => {
  return 'DZQL Admin'
})

const contentLabel = computed(() => {
  if (route.params.entity) {
    return route.params.entity.charAt(0).toUpperCase() + route.params.entity.slice(1)
  }
  return 'Home'
})

const propertiesLabel = computed(() => {
  if (route.params.id === 'new') return 'New'
  if (route.params.id) return `Edit #${route.params.id}`
  return 'Properties'
})

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
  localStorage.removeItem('dzql_token')
  userProfile.value = null
  state.value = 'login'
  // Reconnect to get fresh state
  ws.connect()
}
</script>

<template>
  <div class="min-h-screen bg-base-200">
    <!-- Notification Container -->
    <NotificationContainer />

    <!-- Confirmation Dialog -->
    <ConfirmDialog />

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
    <div v-else-if="state === 'content'" class="min-h-screen flex flex-col">
      <Navbar :user="userProfile" @logout="handleLogout" />
      <main class="flex-1 min-h-0">
        <ThreePanelLayout
          :title="pageTitle"
          :context-label="'Entities'"
          :content-label="contentLabel"
          :properties-label="propertiesLabel"
        >
          <template #context>
            <ContextPanel />
          </template>

          <template #content>
            <ContentPanel v-if="route.params.entity" :entity="route.params.entity" />
            <HelloView v-else />
          </template>

          <template #properties>
            <PropertiesPanel
              v-if="route.params.entity"
              :entity="route.params.entity"
              :id="route.params.id"
            />
            <div v-else class="flex items-center justify-center h-full p-8 text-center">
              <div class="text-base-content/60">
                <p class="text-sm">Select an item to view properties</p>
              </div>
            </div>
          </template>
        </ThreePanelLayout>
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
