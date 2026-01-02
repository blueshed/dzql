<script setup lang="ts">
import { useDzql } from '@/composables/useDzql'
import LoginView from '@/components/LoginView.vue'

const { ready, user, logout, connectionError, connect } = useDzql()

function retry() {
  connect()
}
</script>

<template>
  <!-- Connection Error -->
  <div v-if="connectionError" class="min-h-screen flex items-center justify-center bg-gray-100">
    <div class="text-center max-w-md">
      <div class="text-red-500 text-5xl mb-4">!</div>
      <h2 class="text-xl font-semibold text-gray-800 mb-2">Connection Failed</h2>
      <p class="text-gray-600 mb-4">{{ connectionError }}</p>
      <button
        @click="retry"
        class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md"
      >
        Retry
      </button>
    </div>
  </div>

  <!-- Phase 1: Connecting -->
  <div v-else-if="!ready" class="min-h-screen flex items-center justify-center bg-gray-100">
    <div class="text-center">
      <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
      <p class="mt-4 text-gray-600">Connecting...</p>
    </div>
  </div>

  <!-- Phase 2: Login -->
  <LoginView v-else-if="!user" />

  <!-- Phase 3: Ready -->
  <div v-else class="min-h-screen bg-gray-100">
    <header class="bg-white shadow">
      <div class="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
        <h1 class="text-xl font-bold text-gray-900">
          <router-link to="/">DZQL App</router-link>
        </h1>
        <div class="flex items-center gap-4">
          <span class="text-gray-600">{{ user.name || user.email }}</span>
          <button
            @click="logout"
            class="px-3 py-1 text-sm bg-gray-200 hover:bg-gray-300 rounded"
          >
            Logout
          </button>
        </div>
      </div>
    </header>
    <main class="max-w-7xl mx-auto px-4 py-8">
      <router-view />
    </main>
  </div>
</template>
